import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { wordsOfObject } from '../../shared/aitrail'
import type { CanvasObject } from '../../shared/canvas'
import type { RestoreResult, TrashEntry } from '../../shared/types'
import { KEEP_DAYS, TRASH } from '../../shared/trash'
import { canvasPath, parseCanvas, readCanvas, serializeCanvas } from './canvas'
import { hashText } from './hash'
import { forgetWrite, writeIfUnchanged } from './writer'

// Nothing is deleted outright. A card goes to a bucket named after the
// workspace it came from, a whole workspace goes to the top of the trash, and
// the time it was thrown away is written into the name:
//
//   <vault>/.trash/<workspace>/<stamp>__<card>.md
//   <vault>/.trash/<stamp>__<workspace>/
//   <vault>/.trash/<workspace>/<stamp>__<object id>.canvas.json   (v0.4 step 5)
//
// The stamp is what makes an entry an entry. Anything under .trash without one
// was put there by somebody else, and the sweep never touches it.
export { KEEP_DAYS, TRASH }
const DAY = 86_400_000

const STAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z__(.+)$/

function stampNow(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

// The name is written with the colons and the dot taken out, since neither is
// allowed in a file name on Windows. This puts them back.
export function readStamp(entry: string): { at: Date; name: string } | null {
  const found = STAMP.exec(entry)
  if (!found) return null
  const at = new Date(`${found[1]}T${found[2]}:${found[3]}:${found[4]}.${found[5]}Z`)
  if (Number.isNaN(at.getTime())) return null
  return { at, name: found[6] }
}

// The name the workspace was going by. Falls back to the folder when the file
// is missing or unreadable, which is the same fallback the vault reader uses.
async function titleOf(path: string, fallback: string): Promise<string> {
  try {
    const meta = JSON.parse(await readFile(join(path, 'workspace.json'), 'utf8')) as {
      name?: unknown
    }
    return typeof meta.name === 'string' && meta.name ? meta.name : fallback
  } catch {
    return fallback
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export async function trashCard(file: string, workspacePath: string): Promise<void> {
  const dir = join(dirname(workspacePath), TRASH, basename(workspacePath))
  await mkdir(dir, { recursive: true })
  await rename(file, join(dir, `${stampNow()}__${basename(file)}`))
  forgetWrite(file)
}

// What an agent takes off a canvas, v0.4 step 5. It goes to the
// trash for the same 30 days a card does, and can be put back from there. A
// canvas object has no file of its own to move, so it is written out, one file
// an object, beside the cards of the workspace it came from:
//
//   <vault>/.trash/<workspace>/<stamp>__<object id>.canvas.json
//
// holding the object as canvas.json holds it. An object taken off by a hand in
// the window does not come here; Ctrl+Z is how that one comes back.
export const CANVAS_TRASHED = '.canvas.json'

export async function trashCanvasObjects(workspacePath: string, objects: CanvasObject[]): Promise<string[]> {
  const dir = join(dirname(workspacePath), TRASH, basename(workspacePath))
  await mkdir(dir, { recursive: true })
  const stamp = stampNow()
  const paths: string[] = []
  for (const object of objects) {
    const path = join(dir, `${stamp}__${object.id}${CANVAS_TRASHED}`)
    // Staged under a name with no stamp, which the trash never lists, so the
    // screen cannot show an entry that is half written.
    const staged = join(dir, `.${object.id}.part`)
    await writeFile(staged, `${JSON.stringify({ formatVersion: 1, object: { id: object.id, type: object.type, ...object.props } }, null, 2)}\n`, 'utf8')
    await rename(staged, path)
    paths.push(path)
  }
  return paths
}

async function readTrashedObject(path: string): Promise<CanvasObject | null> {
  try {
    const body = JSON.parse(await readFile(path, 'utf8')) as { object?: unknown }
    const raw = body.object
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
    const { id, type, ...props } = raw as Record<string, unknown>
    if (typeof id !== 'string' || id === '' || typeof type !== 'string' || type === '') return null
    return { id, type, props }
  } catch {
    return null
  }
}

// The ids on a workspace's canvas, or null when the canvas cannot take anything
// back: the workspace is gone, or its canvas.json does not parse.
async function idsOnCanvas(workspacePath: string): Promise<Set<string> | null> {
  if (!(await exists(workspacePath))) return null
  const canvas = await readCanvas(workspacePath)
  return canvas.broken === null ? new Set(canvas.objects.map((object) => object.id)) : null
}

const KIND_NAMES: Record<string, string> = { box: 'Box', text: 'Text', arrow: 'Arrow', draw: 'Drawing', image: 'Image' }

function trashName(object: CanvasObject): string {
  const words = wordsOfObject(object.props.text)
  return words !== '' ? `"${words}"` : (KIND_NAMES[object.type] ?? 'Canvas object')
}

// Back onto the canvas it came off, on top, where it was. Written against the
// file as it was read, so a canvas that changed in between is not written over.
async function restoreObject(here: string, workspacePath: string): Promise<RestoreResult> {
  if (!(await exists(workspacePath))) return { ok: false, why: 'The workspace it came from is gone.' }
  const object = await readTrashedObject(here)
  if (!object) return { ok: false, why: 'That file does not hold a canvas object.' }

  const target = canvasPath(workspacePath)
  let text: string | null = null
  try {
    text = await readFile(target, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      return { ok: false, why: `canvas.json could not be read: ${error instanceof Error ? error.message : String(error)}` }
    }
  }
  const canvas = text === null ? { objects: [], extra: { formatVersion: 1 }, broken: null } : parseCanvas(text)
  if (canvas.broken !== null) {
    return { ok: false, why: `canvas.json could not be read (${canvas.broken}), so nothing is put back into it.` }
  }
  if (canvas.objects.some((one) => one.id === object.id)) {
    return { ok: false, why: `${trashName(object)} is already back on the canvas.` }
  }

  await mkdir(dirname(target), { recursive: true })
  // A canvas.json that was not there is held to still not being there: the
  // fingerprint of nothing matches no file that has anything in it.
  const written = await writeIfUnchanged(
    target,
    serializeCanvas({ objects: [...canvas.objects, object], extra: canvas.extra }),
    hashText(text ?? '')
  )
  if (!written.ok) return { ok: false, why: 'The canvas changed while this was being put back. Try again.' }
  await rm(here, { force: true })
  return { ok: true, path: target }
}

export async function trashWorkspace(workspacePath: string): Promise<void> {
  const root = join(dirname(workspacePath), TRASH)
  await mkdir(root, { recursive: true })
  await rename(workspacePath, join(root, `${stampNow()}__${basename(workspacePath)}`))
}

export async function readTrash(vaultPath: string): Promise<TrashEntry[]> {
  const root = join(vaultPath, TRASH)
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }

  const out: TrashEntry[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const stamped = readStamp(entry.name)

    if (stamped) {
      out.push({
        path: join(root, entry.name),
        kind: 'workspace',
        // A renamed workspace keeps its folder, so the folder is not what the
        // user was calling it. Looking for it in here by the name on screen has
        // to work.
        name: await titleOf(join(root, entry.name), stamped.name),
        folder: stamped.name,
        workspace: '',
        at: stamped.at.toISOString(),
        // Putting it back would land on top of a folder that is already there.
        restorable: !(await exists(join(vaultPath, stamped.name)))
      })
      continue
    }

    // Not stamped, so it is a bucket holding the cards of one workspace, and
    // since v0.4 step 5 what an agent took off its canvas.
    const home = join(vaultPath, entry.name, 'kanban', 'cards')
    const back = await exists(home)
    let onCanvas: Set<string> | null | undefined
    for (const file of await readdir(join(root, entry.name))) {
      const card = readStamp(file)
      if (!card) continue
      if (card.name.endsWith(CANVAS_TRASHED)) {
        const object = await readTrashedObject(join(root, entry.name, file))
        if (!object) continue
        // Read once a bucket, and only when it holds a canvas object.
        if (onCanvas === undefined) onCanvas = await idsOnCanvas(join(vaultPath, entry.name))
        out.push({
          path: join(root, entry.name, file),
          kind: 'canvas',
          name: trashName(object),
          folder: card.name,
          workspace: entry.name,
          at: card.at.toISOString(),
          // Gone with its workspace, a canvas that does not parse, or already
          // back - Ctrl+Z in the window can bring it back as well.
          restorable: onCanvas !== null && !onCanvas.has(object.id)
        })
        continue
      }
      out.push({
        path: join(root, entry.name, file),
        kind: 'card',
        name: card.name,
        folder: card.name,
        workspace: entry.name,
        at: card.at.toISOString(),
        // The workspace it came from may itself be in the trash by now.
        restorable: back && !(await exists(join(home, card.name)))
      })
    }
  }

  out.sort((a, b) => (a.at < b.at ? 1 : -1))
  return out
}

// Where the item came from is worked out from where it sits, never from what
// the renderer says, and anything outside this vault's own trash is refused.
export async function restoreTrash(vaultPath: string, path: string): Promise<RestoreResult> {
  const root = resolve(join(vaultPath, TRASH))
  const here = resolve(path)
  if (here !== root && !here.startsWith(root + sep)) {
    return { ok: false, why: 'That is not in this vault trash.' }
  }

  const inRoot = resolve(dirname(here)) === root
  const stamped = readStamp(basename(here))
  if (!stamped) return { ok: false, why: 'That name carries no timestamp.' }
  if (!inRoot && stamped.name.endsWith(CANVAS_TRASHED)) {
    return restoreObject(here, join(vaultPath, basename(dirname(here))))
  }

  const target = inRoot
    ? join(vaultPath, stamped.name)
    : join(vaultPath, basename(dirname(here)), 'kanban', 'cards', stamped.name)

  if (await exists(target)) {
    return { ok: false, why: `${stamped.name} is already back in place.` }
  }
  const home = dirname(target)
  if (!inRoot && !(await exists(home))) {
    return { ok: false, why: 'The workspace it came from is gone.' }
  }

  await rename(here, target)
  return { ok: true, path: target }
}

export async function deleteTrash(vaultPath: string, path: string): Promise<RestoreResult> {
  const root = resolve(join(vaultPath, TRASH))
  const here = resolve(path)
  if (!here.startsWith(root + sep)) {
    return { ok: false, why: 'That is not in this vault trash.' }
  }
  if (!readStamp(basename(here))) return { ok: false, why: 'That name carries no timestamp.' }
  await rm(here, { recursive: true, force: true })
  return { ok: true, path: here }
}

// Runs when a vault is opened. It walks what readTrash returns and nothing
// else, so a file somebody dropped in .trash by hand has no stamp, never
// appears as an entry, and cannot be swept.
export async function sweepTrash(vaultPath: string, now = Date.now()): Promise<string[]> {
  const gone: string[] = []
  for (const entry of await readTrash(vaultPath)) {
    if (now - Date.parse(entry.at) < KEEP_DAYS * DAY) continue
    try {
      await rm(entry.path, { recursive: true, force: true })
      gone.push(entry.path)
    } catch {
      // Held open by something else. It is still past its date next time.
    }
  }
  return gone
}
