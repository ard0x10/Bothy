import { AI_NOTICE_NAMES, thing, wordsOfObject } from './aitrail'
import type { CanvasObject } from './canvas'
import { changedOn, placesChanged, sameValue } from './merge'
import type { Card, Column, Vault, Workspace } from './types'
import { samePath } from './vaults'

// A change the window found on disk with nothing to say who made it, v0.4 step
// 7. An agent that writes the files itself and leaves a trail is
// named the way one talking to Bothy's server is (shared/aitrail.ts); anything
// else that changed a card or a canvas object while Bothy was open - that agent
// without a trail, a text editor - is "Changed outside Bothy". Before, such a
// change reached the screen and the line said nothing.
//
// The window cannot tell who wrote a file, only that this window did not: what
// it wrote itself is known by content (main/vault/writer.ts) and never reported.
// So what is found here is set against the trails heard around it, in the store,
// and only what no trail accounts for is said.

export type OutsideChange = {
  workspace: string
  workspaceName: string
  // A card by its id, or a canvas object by its id and its type, as on AiChange.
  card?: string
  object?: string
  kind?: string
  // A card's title, or an object's words, which may be empty.
  title: string
}

// How long a change found on disk waits for a trail before it is said as from
// outside. Measured over 11 writes through Bothy's server: the window
// heard the trail before the file every time, 40 to 77 ms before it (main
// settles the trail folder for 40 ms and the vault for 120), and a trail heard
// first is matched the moment the change is found. No trail was heard after its
// file, so this is not a measured number: it is a margin for that case, about
// twice the longest gap seen, and short enough that nobody reads the line late.
export const OUTSIDE_HOLD_MS = 150

type Thing = { workspace: string; card?: string; object?: string }

// Whether a trail and a change found on disk are about one thing.
export const sameThing = (a: Thing, b: Thing): boolean =>
  samePath(a.workspace, b.workspace) &&
  (a.card !== undefined ? a.card === b.card : a.object !== undefined && a.object === b.object)

// A file inside a folder, compared the way Windows compares paths.
function inside(folder: string, file: string): boolean {
  const plain = (path: string): string => path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return plain(file).startsWith(`${plain(folder)}/`)
}

// A card as its file says it, without what only says where it was read from.
function content(card: Card): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...card }
  delete rest.hash
  delete rest.file
  delete rest.idIsNew
  return rest
}

// A card whose id was made up on reading, now carrying that id in its file and
// nothing else new: Bothy wrote the id down, which the window does before it
// writes the order and its server does the same way (writeOrder, src/mcp). The
// writer also leaves one blank line under the frontmatter however many there
// were, and the reader hands it back as the body's first line (serializeCard),
// so that is not a change either. Measured: a create_card through the
// server put up `Changed outside Bothy: "No id in this one"`, a card nobody had
// touched, whose body had gone from two blank lines to one.
const idWrittenDown = (a: Card, b: Card): boolean =>
  a.idIsNew === true &&
  b.idIsNew !== true &&
  sameValue({ ...content(a), body: `\n${a.body.replace(/^\n+/, '')}` }, content(b))

// The order as columns.json says it, which is what this window last saw of the
// file, rather than the board built from it.
const orderOf = (workspace: Workspace): Column[] => workspace.columnsSeen?.columns ?? workspace.columns

// The cards of a vault that changed between two reads, looking only at the
// files the watcher said changed from outside. A card file touched and not
// changed - an editor saving what it opened - is nothing. A card is named once
// however many of its files changed, by the title it has now, or had when it
// is gone. `known` are the cards the trails heard lately name: a card an agent
// moved past one neighbour is that card, not the neighbour (see movedCards).
export function cardsChangedOutside(
  before: Vault,
  after: Vault,
  files: readonly string[],
  known: ReadonlySet<string> = new Set()
): OutsideChange[] {
  const found: OutsideChange[] = []
  for (const was of before.workspaces) {
    const now = after.workspaces.find((one) => samePath(one.path, was.path))
    const touched = files.filter((file) => inside(was.path, file))
    if (!now || touched.length === 0) continue
    const named = new Map<string, OutsideChange>()
    const name = (card: Card): void => {
      if (!named.has(card.id)) named.set(card.id, { workspace: now.path, workspaceName: now.name, card: card.id, title: card.title })
    }
    for (const file of touched) {
      const a = was.cards.find((card) => samePath(card.file, file))
      const b = now.cards.find((card) => samePath(card.file, file))
      if (a && b && (sameValue(content(a), content(b)) || idWrittenDown(a, b))) continue
      const card = b ?? a
      if (card) name(card)
    }
    if (touched.some((file) => /[\\/]kanban[\\/]columns\.json$/i.test(file))) {
      // Moved in the file and moved on the board, both. The file alone names a
      // card another writer only wrote down where the board already drew it: one
      // no column listed, drawn at the end of the first, which a write of the
      // order lists there. Measured - Bothy's own server did that, and the
      // line named a card nobody had moved. The board alone names what this
      // window moved and has not written yet, which is the hand's.
      const shown = new Set(placesChanged(was.columns, now.columns, known).map((one) => one.id))
      for (const { id } of placesChanged(orderOf(was), orderOf(now), known)) {
        if (!shown.has(id)) continue
        const card = now.cards.find((one) => one.id === id) ?? was.cards.find((one) => one.id === id)
        if (card) name(card)
      }
    }
    found.push(...named.values())
  }
  return found
}

// The objects of a canvas that differ between what was last seen on disk and
// what is on disk now.
export function objectsChangedOutside(
  workspace: string,
  workspaceName: string,
  before: readonly CanvasObject[],
  after: readonly CanvasObject[]
): OutsideChange[] {
  return changedOn(before, after).flatMap(({ id }) => {
    const object = after.find((one) => one.id === id) ?? before.find((one) => one.id === id)
    return object ? [{ workspace, workspaceName, object: id, kind: object.type, title: wordsOfObject(object.props.text) }] : []
  })
}

// The line. For example: `Changed outside Bothy: "Menu sounds"`. More
// than one thing is the names, up to the count the AI line names, in the order
// they were found; a workspace not on screen is named; a canvas object away
// from the canvas says the canvas. There is no verb: the window knows that a
// thing changed, not whether it was moved, renamed or taken away.
export function outsideNotice(changes: readonly OutsideChange[], here: string | null, view: string | null = null): string | null {
  type Place = { workspace: string; name: string; cards: Map<string, OutsideChange>; objects: Map<string, OutsideChange> }
  const places: Place[] = []
  for (const change of changes) {
    let place = places.find((one) => samePath(one.workspace, change.workspace))
    if (!place) {
      place = { workspace: change.workspace, name: change.workspaceName, cards: new Map(), objects: new Map() }
      places.push(place)
    }
    if (change.object !== undefined) place.objects.set(change.object, change)
    else if (change.card !== undefined) place.cards.set(change.card, change)
  }

  const listed = (names: string[]): string =>
    names.slice(0, AI_NOTICE_NAMES).join(', ') + (names.length > AI_NOTICE_NAMES ? ` and ${names.length - AI_NOTICE_NAMES} more` : '')

  const lines = places.flatMap(({ workspace, name, cards, objects }) => {
    const home = here !== null && samePath(workspace, here)
    const where = home ? '' : ` in ${name}`
    const out: string[] = []
    if (cards.size > 0) out.push(`Changed outside Bothy${where}: ${listed([...cards.values()].map((one) => `"${one.title}"`))}`)
    if (objects.size > 0) {
      const canvas = home && view === 'canvas' ? '' : ' on the canvas'
      out.push(`Changed outside Bothy${canvas}${where}: ${listed([...objects.values()].map(thing))}`)
    }
    return out
  })
  return lines.length > 0 ? lines.join(' · ') : null
}
