import { readFile, readdir, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { Card, CardMoved } from '../../shared/types'
import { cleanBackground } from '../../shared/background'
import { referencedFiles } from '../../shared/transfer'
import { TRASH } from '../../shared/trash'
import { attachBytes, isAttachmentName, resolveAttachment } from './attach'
import { readCanvas } from './canvas'
import { CANVAS_TRASHED } from './trash'
import { freeFile } from './create'
import { parseCard, serializeCard } from './format'
import { forgetWrite, oneNameAtATime, writeText } from './writer'

// A card leaving one workspace for another, v0.5. The window decides which
// column it lands in; everything on disk happens here.
//
// A card is a file plus the pictures and files it names, and those live in the
// workspace's own files/ folder. So the move is three things rather than one:
// the attachments are written into the target's folder, the card is written
// beside the target's other cards with whatever names they landed under, and
// the source's copies go only once nothing left behind still names them.
//
// Written and then removed rather than renamed, and that is not a detail. The
// writer marks what this app writes so the watcher does not report it as a
// change from outside (see writer.ts); a rename is a file appearing that
// nothing claimed, and the window would put a line up about a card it had just
// moved itself.

// Both folders have to be workspaces of one vault. The window only ever offers
// the vault's own, so this is the door being locked rather than a case being
// handled: a path that arrived from anywhere else cannot reach a folder outside
// the one the user opened.
function sameVault(from: string, to: string): boolean {
  const plain = (path: string): string => path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return plain(dirname(from)) === plain(dirname(to)) && plain(from) !== plain(to)
}

const cardsDir = (workspacePath: string): string => join(workspacePath, 'kanban', 'cards')

// Where the trash keeps what came out of this workspace. Its cards can still be
// put back, so a picture one of them names is a picture in use.
const trashBucket = (workspacePath: string): string =>
  join(dirname(workspacePath), TRASH, basename(workspacePath))

async function filesIn(dir: string, ending: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((name) => name.toLowerCase().endsWith(ending))
  } catch {
    return []
  }
}

// What a workspace still points at, read off disk rather than taken from what
// the window believes. Lower case throughout: on Windows two names that differ
// only in case are one file, and a sweep that missed that would delete a
// picture something still shows.
async function namesInUse(workspacePath: string): Promise<Set<string> | null> {
  const used = new Set<string>()
  const add = (name: unknown): void => {
    if (typeof name === 'string' && name !== '') used.add(name.toLowerCase())
  }

  for (const dir of [cardsDir(workspacePath), trashBucket(workspacePath)]) {
    for (const name of await filesIn(dir, '.md')) {
      const file = join(dir, name)
      let card
      try {
        card = parseCard(file, await readFile(file, 'utf8'))
      } catch {
        // A card that cannot be read is a card whose names cannot be counted,
        // and deleting on a count that is short is the one mistake here that
        // cannot be undone.
        return null
      }
      // One that did not parse is the same answer for the same reason: its
      // frontmatter is where the names would have been, and an empty list off
      // a file that failed is not a file with no attachments.
      if (card.broken) return null
      card.files.forEach(add)
      add(card.cover)
    }
  }

  const canvas = await readCanvas(workspacePath)
  // The same rule: a canvas that did not parse is not a canvas with nothing on
  // it, whatever an empty objects list would suggest.
  if (canvas.broken) return null
  referencedFiles(canvas.objects).forEach(add)

  // And the objects the trash is holding, one file each.
  const bucket = trashBucket(workspacePath)
  for (const name of await filesIn(bucket, CANVAS_TRASHED)) {
    try {
      const held = JSON.parse(await readFile(join(bucket, name), 'utf8')) as {
        object?: Record<string, unknown>
      }
      add(held.object?.file)
    } catch {
      return null
    }
  }

  try {
    const meta = JSON.parse(
      await readFile(join(workspacePath, 'workspace.json'), 'utf8')
    ) as Record<string, unknown>
    const background = cleanBackground(meta.background)
    if (background?.type === 'image') add(background.name)
  } catch {
    // No workspace.json, or one that does not parse. The board has no picture
    // it could be showing either way, so this one is not a reason to keep.
  }

  return used
}

// The attachments this card carries: what it lists, and the picture on its
// front, which may not be one of them.
function attachmentsOf(card: Card): string[] {
  const names = [...card.files, ...(card.cover ? [card.cover] : [])]
  return [...new Set(names.filter((name) => isAttachmentName(name)))]
}

async function moveOne(card: Card, from: string, to: string): Promise<CardMoved> {
  // A card that did not parse is never rewritten, anywhere in this app, and it
  // is not listed in any column either - so a move would put it down in a
  // folder that has nowhere to put it. It stays where it is and says so.
  if (card.broken) {
    return { ok: false, id: card.id, why: 'it could not be read' }
  }

  const notes: string[] = []
  // What each name became in the target. attachBytes settles a picture by its
  // content, so a file whose bytes are already there takes the name they are
  // there under, and one whose name is taken by other bytes takes the next
  // free one. Either way the card has to be told, or it points at somebody
  // else's picture.
  const landed = new Map<string, string>()
  for (const name of attachmentsOf(card)) {
    const source = resolveAttachment(from, name)
    if (source === null) continue
    let bytes: Buffer
    try {
      bytes = await readFile(source)
    } catch {
      // A name with nothing behind it. It travels as it is: the card already
      // draws it as missing, and dropping the name would turn a picture that
      // could be put back into one nobody knows was ever there.
      notes.push(`${name} was not in files/, so it came over as a name only`)
      continue
    }
    const took = await attachBytes(to, name, bytes)
    landed.set(name, took)
    if (took !== name) notes.push(`${name} came in as ${took}`)
  }

  const moved: Card = {
    ...card,
    files: card.files.map((name) => landed.get(name) ?? name),
    ...(card.cover ? { cover: landed.get(card.cover) ?? card.cover } : {})
  }

  const dir = cardsDir(to)
  const base = basename(card.file).replace(/\.md$/i, '') || 'card'
  // The name is found and taken under the same lock the other writers use, so
  // two cards moved at once cannot both be given the first free name.
  const file = await oneNameAtATime(dir, async () => {
    const target = await freeFile(dir, base)
    await writeText(target, serializeCard({ ...moved, file: target }))
    return target
  })

  await rm(card.file, { force: true })
  forgetWrite(card.file)

  // Read back what actually landed, so the card the window puts on the board is
  // the card on disk, fingerprint and all, rather than the one we hoped we
  // wrote.
  return { ok: true, id: card.id, card: parseCard(file, await readFile(file, 'utf8')), notes }
}

// The cards, in the order they were given, and then the sweep. Sequential
// because the folder they are landing in decides names one at a time anyway,
// and a column of thirty cards is not a reason to make thirty writes race.
export async function moveCards(cards: Card[], from: string, to: string): Promise<CardMoved[]> {
  if (!sameVault(from, to)) {
    return cards.map((card) => ({ ok: false, id: card.id, why: 'it is not in this vault' }))
  }

  const done: CardMoved[] = []
  for (const card of cards) {
    try {
      done.push(await moveOne(card, from, to))
    } catch (error) {
      done.push({
        ok: false,
        id: card.id,
        why: error instanceof Error ? error.message : String(error)
      })
    }
  }

  // The names the cards that actually went carried with them, and only those:
  // a card that stayed keeps its pictures whatever happened around it.
  const gone = new Set(done.filter((one) => one.ok).map((one) => one.id))
  const carried = [
    ...new Set(cards.filter((card) => gone.has(card.id)).flatMap((card) => attachmentsOf(card)))
  ]
  // A copy is taken off the workspace it came from once nothing left there
  // points at it from anywhere: another card, a card in the trash, the canvas,
  // an object the trash is holding, or the board's own background. Anything
  // that could not be read counts as a reason to keep, and then the sweep does
  // nothing at all rather than half of what it was asked.
  const used = carried.length > 0 ? await namesInUse(from) : null
  if (used) {
    for (const name of carried) {
      if (used.has(name.toLowerCase())) continue
      const path = resolveAttachment(from, name)
      if (path !== null) await rm(path, { force: true })
    }
  }

  return done
}
