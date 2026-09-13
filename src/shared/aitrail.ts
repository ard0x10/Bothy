import { samePath } from './vaults'

// What the window is told about an agent's writes, v0.4 step 4. A
// short notice. Changes that come close
// together make one line naming the cards, and the line goes by itself in a
// few seconds.
//
// The server an agent talks to is another process and cannot reach the window.
// So each write it makes leaves one small file in the app's settings folder -
// never in a vault, which an agent's bookkeeping has no business in - and main,
// watching that folder, hands the window what it finds and deletes it. One file
// a call rather than one list for everybody, so two agents writing at the same
// moment cannot each rewrite the list over the other's entry.
export const AI_TRAIL = 'ai-trail'

// How long the line stays up after the last change it carries. "A few
// seconds": five reads three card titles at an ordinary pace, with a moment
// first for the eye to find the line.
export const AI_NOTICE_MS = 5000

// How many titles one line names before it counts the rest.
export const AI_NOTICE_NAMES = 3

export const AI_ACTIONS = ['added', 'changed', 'moved', 'archived', 'unarchived', 'trashed'] as const
export type AiAction = (typeof AI_ACTIONS)[number]

// What can happen to a thing on the canvas, v0.4 step 5. It has no column and
// no archive.
export const AI_CANVAS_ACTIONS = ['added', 'changed', 'trashed'] as const satisfies readonly AiAction[]

export type AiChange = {
  at: number
  // The workspace folder, which is what the window knows a workspace by, and
  // its name, for when it is not the one on screen.
  workspace: string
  workspaceName: string
  // A card, by its id. Or, since step 5, a canvas object by its id and its
  // type: one of the two, never both.
  card?: string
  object?: string
  kind?: string
  // A card's title. A canvas object's words, which an arrow does not have, so
  // for an object this may be empty and the object is named by its type.
  title: string
  action: AiAction
  // The column a card was added to or moved into, by its title.
  column?: string
}

// A file in a folder anybody can write to is read, not believed.
export function readAiChange(value: unknown): AiChange | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const text = (key: string): string | null =>
    typeof raw[key] === 'string' && raw[key] !== '' ? (raw[key] as string) : null
  const workspace = text('workspace')
  const card = text('card')
  const object = text('object')
  const action = AI_ACTIONS.find((one) => one === raw.action)
  if (workspace === null || action === undefined || (card === null) === (object === null)) return null
  const at = typeof raw.at === 'number' && Number.isFinite(raw.at) ? raw.at : 0
  const workspaceName = text('workspaceName') ?? workspace

  if (object !== null) {
    const kind = text('kind')
    const title = typeof raw.title === 'string' ? raw.title : null
    const canvasAction = AI_CANVAS_ACTIONS.find((one) => one === action)
    if (kind === null || title === null || canvasAction === undefined) return null
    return { at, workspace, workspaceName, object, kind, title, action: canvasAction }
  }

  const title = text('title')
  if (title === null) return null
  const column = text('column')
  return {
    at,
    workspace,
    workspaceName,
    card: card as string,
    title,
    action,
    ...(column !== null ? { column } : {})
  }
}

// What one trail file holds: a change, or since step 5 the list of them one
// call made. A canvas drawn in one call is many objects, and one file keeps
// them in the order they were made, where a file each would reach the window
// in whatever order the disk reports them. An entry that does not read is left
// out; the rest of the list still counts.
export function readAiChanges(value: unknown): AiChange[] {
  const list = Array.isArray(value) ? value : [value]
  return list.map(readAiChange).filter((change): change is AiChange => change !== null)
}

// How a canvas object is named when it has no words: by what it is.
const A_KIND: Record<string, string> = {
  box: 'a box',
  text: 'a text',
  arrow: 'an arrow',
  draw: 'a drawing',
  image: 'an image'
}

export const thing = (change: { title: string; kind?: string }): string =>
  change.title !== '' ? `"${change.title}"` : (A_KIND[change.kind ?? ''] ?? 'an object')

// One canvas object, one sentence. Named by its words, the way a
// card is named by its title. Away from the canvas the sentence says it was the
// canvas, or it reads as news about the board in front of the reader.
function objectSentence(change: AiChange, away: boolean): string {
  const name = thing(change)
  switch (change.action) {
    case 'added':
      return `AI added ${name}${away ? ' to the canvas' : ''}`
    case 'trashed':
      return `AI moved ${name}${away ? ' from the canvas' : ''} to the trash`
    default:
      return `AI changed ${name}${away ? ' on the canvas' : ''}`
  }
}

// How much of a canvas object's words a line or the trash shows: its first line,
// cut where a line on screen would stop being read.
const WORDS_SHOWN = 40

export function wordsOfObject(text: unknown): string {
  if (typeof text !== 'string') return ''
  const first = text.split('\n').map((line) => line.trim()).find((line) => line !== '') ?? ''
  return first.length > WORDS_SHOWN ? `${first.slice(0, WORDS_SHOWN - 1).trimEnd()}…` : first
}

function sentence(change: AiChange): string {
  const title = `"${change.title}"`
  switch (change.action) {
    case 'added':
      return change.column ? `AI added ${title} to ${change.column}` : `AI added ${title}`
    case 'changed':
      return `AI changed ${title}`
    case 'moved':
      return change.column ? `AI moved ${title} to ${change.column}` : `AI moved ${title}`
    case 'archived':
      return `AI archived ${title}`
    case 'unarchived':
      return `AI took ${title} out of the archive`
    case 'trashed':
      return `AI moved ${title} to the trash`
  }
}

// The line for everything an agent did while the last one was up. One card is
// one sentence saying what happened to it; more than one is a count and the
// first few titles, the shape we picked. A card changed twice is one card,
// named by the last thing done to it. A workspace that is not the one on screen
// is named, since otherwise the line reads as news about the board in front of
// the reader.
//
// Canvas objects the same way: one is a sentence, more than one is a count
// of things on the canvas with the first few named. `view` is the tab on
// screen, which is what says whether "the canvas" needs saying.
export function aiNotice(changes: readonly AiChange[], here: string | null, view: string | null = null): string | null {
  type Place = {
    workspace: string
    name: string
    cards: Map<string, AiChange>
    objects: Map<string, AiChange>
    canvasFirst: boolean
  }
  const places: Place[] = []
  // In the order the agent made them, by the time the server wrote each one,
  // and not in the order they reached the window: the watcher hands files over
  // as the disk reports them, and two changes written one after the
  // other came in swapped and the line named them the wrong way round. Changes
  // with one time came in one file, in order, and the sort keeps that order.
  for (const change of [...changes].sort((a, b) => a.at - b.at)) {
    const onCanvas = change.object !== undefined
    let place = places.find((one) => samePath(one.workspace, change.workspace))
    if (!place) {
      place = { workspace: change.workspace, name: change.workspaceName, cards: new Map(), objects: new Map(), canvasFirst: onCanvas }
      places.push(place)
    }
    if (onCanvas) place.objects.set(change.object as string, change)
    else place.cards.set(change.card as string, change)
  }
  if (places.length === 0) return null

  const rest = (count: number): string => (count > AI_NOTICE_NAMES ? ` and ${count - AI_NOTICE_NAMES} more` : '')

  return places
    .flatMap(({ workspace, name, cards, objects, canvasFirst }) => {
      const home = here !== null && samePath(workspace, here)
      const where = home ? '' : ` in ${name}`
      const lines: string[] = []

      const all = [...cards.values()]
      if (all.length === 1) lines.push(sentence(all[0]) + where)
      else if (all.length > 1) {
        const titles = all.slice(0, AI_NOTICE_NAMES).map((one) => one.title).join(', ')
        lines.push(`AI changed ${all.length} cards${where}: ${titles}${rest(all.length)}`)
      }

      const drawn = [...objects.values()]
      if (drawn.length === 1) lines.push(objectSentence(drawn[0], !(home && view === 'canvas')) + where)
      else if (drawn.length > 1) {
        const names = drawn.slice(0, AI_NOTICE_NAMES).map(thing).join(', ')
        lines.push(`AI changed ${drawn.length} things on the canvas${where}: ${names}${rest(drawn.length)}`)
      }

      return canvasFirst ? lines.reverse() : lines
    })
    .join(' · ')
}
