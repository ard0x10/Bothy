import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { serializeColumns } from '../main/vault/columns'
import { createCard } from '../main/vault/create'
import { parseCard, serializeCard } from '../main/vault/format'
import { hashText } from '../main/vault/hash'
import { parseColumnsFile, readWorkspace } from '../main/vault/store'
import { editingIn } from '../shared/editing'
import { mergeColumns, mergeFields, overlap, placesChanged, sameValue } from '../shared/merge'
import { readHands } from './state'
import { trashCard } from '../main/vault/trash'
import { writeIfUnchanged } from '../main/vault/writer'
import type { AiAction } from '../shared/aitrail'
import { isImageName } from '../shared/image'
import { CARD_FIELDS, KNOWN, type CardFieldName } from '../shared/schema/card'
import { KEEP_DAYS } from '../shared/trash'
import type { Card, Column, Workspace } from '../shared/types'
import { COLOUR, problemWith, withDefaults } from './check'
import { schemaOf } from './describe'
import { hold } from './hold'
import { findCard } from './read'
import { answer, refusal, type Tool } from './result'
import { recordAiChange } from './trail'
import { WORKSPACE_INPUT, findWorkspace, named, type OpenWorkspace } from './workspaces'

// The tools that write a card, v0.4 step 4. Every write goes down a road the
// window already uses: a card is made by createCard and written by
// serializeCard, the order by serializeColumns, a card thrown away by
// trashCard. What is added here is only what an agent needs and a hand does
// not: its input checked before anything is written, and a refusal it can act
// on.
//
// A tool reads the workspace and writes in the same call, and every write is
// held to what was read. A card or a columns.json that changed in between is
// not written over. Since v0.4 step 6 it is merged: what changed on
// disk that this call does not touch is kept, and a call that touches what
// changed is refused and told what. See writeCard and writeOrder.

// What an agent may set on a card. The id, created and modified are the app's
// to write, and archiving has a tool of its own.
export const WRITABLE: readonly CardFieldName[] = ['title', 'cover', 'tags', 'start', 'due', 'priority', 'checklists', 'files']
const FIELDS = CARD_FIELDS.filter((field) => WRITABLE.includes(field.name))
const CLEARABLE = [...WRITABLE.filter((name) => name !== 'title'), 'body']

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const CARD_INPUT = { type: 'string', description: 'The id of the card, from read_kanban.' } as const

const FIELD_INPUTS = {
  ...Object.fromEntries(FIELDS.map((field) => [field.name, schemaOf(field.value)])),
  body: { type: 'string', description: 'The text under the frontmatter, as markdown. Replaces the whole body.' },
  other: {
    type: 'object',
    description: 'Frontmatter keys the app does not own, as read_card gives them in other. A key set to null is taken out.'
  }
}

const COLUMN_INPUT = { type: 'string', description: 'The id of a column, from read_kanban.' } as const

const PLACE_INPUTS = {
  at: {
    type: 'string',
    enum: ['top', 'bottom'],
    description: 'The top or the bottom of the column. The bottom when neither at nor before is given.'
  },
  before: { type: 'string', description: 'The id of a card in that column to go in front of.' }
} as const

const FIELDS_TOLD =
  'The fields are the ones read_card describes, and take only what the app itself writes: the colour words for tags, low, medium or high for priority, and in files and a picture cover only names already in the workspace files/ folder.'

type Changes = {
  set: Partial<Card>
  clear: string[]
  body?: string
  other: Record<string, unknown>
}

// What the call asks to change on a card, checked against the schema and the
// workspace, or the sentence saying why not.
function changesFrom(args: Record<string, unknown>, workspace: Workspace, creating: boolean): Changes | string {
  const set: Record<string, unknown> = {}
  for (const field of FIELDS) {
    const value = args[field.name]
    if (value === undefined) continue
    const problem = problemWith(value, field.value, field.name)
    if (problem) return problem
    set[field.name] = withDefaults(value, field.value)
  }

  if (typeof set.title === 'string') {
    if (set.title.trim() === '') return 'title cannot be empty.'
    set.title = set.title.trim()
  }
  if (Array.isArray(set.files)) {
    const missing = (set.files as string[]).filter((name) => !workspace.files.includes(name))
    if (missing.length > 0) {
      return `files/ has no ${missing.join(', ')}. A card lists only files already in files/, and an agent cannot put one there yet.`
    }
  }
  if (typeof set.cover === 'string' && !COLOUR.test(set.cover)) {
    if (!isImageName(set.cover)) return `cover takes a colour or the name of a picture in files/, and ${set.cover} is neither.`
    if (!workspace.files.includes(set.cover)) return `files/ has no ${set.cover}, so it cannot be the cover.`
  }

  let body: string | undefined
  if (args.body !== undefined) {
    if (typeof args.body !== 'string') return 'body takes text.'
    body = args.body
  }

  const other: Record<string, unknown> = {}
  if (args.other !== undefined) {
    if (!isRecord(args.other)) return 'other takes an object of frontmatter keys.'
    for (const [key, value] of Object.entries(args.other)) {
      if (key === '' || (KNOWN as readonly string[]).includes(key)) {
        return `other cannot hold ${key || 'an empty key'}: ${key ? 'it is a field the app owns, so give it on its own' : 'a key needs a name'}.`
      }
      if (creating && value === null) continue
      other[key] = value
    }
  }

  const clear: string[] = []
  if (!creating && args.clear !== undefined) {
    if (!Array.isArray(args.clear)) return `clear takes a list of field names: ${CLEARABLE.join(', ')}.`
    for (const name of args.clear) {
      if (typeof name !== 'string' || !CLEARABLE.includes(name)) {
        return `clear takes ${CLEARABLE.join(', ')}, not ${JSON.stringify(name)}.`
      }
      if (set[name] !== undefined || (name === 'body' && body !== undefined)) return `${name} is both given and cleared.`
      clear.push(name)
    }
  }

  return { set: set as Partial<Card>, clear, body, other }
}

function applied(card: Card, changes: Changes): Card {
  const next: Card = { ...card, ...changes.set, extra: { ...card.extra } }
  if (changes.body !== undefined) next.body = changes.body
  for (const [key, value] of Object.entries(changes.other)) {
    if (value === null) delete next.extra[key]
    else next.extra[key] = value
  }
  for (const name of changes.clear) {
    if (name === 'body') next.body = ''
    else if (name === 'tags' || name === 'checklists' || name === 'files') next[name] = []
    else (next as Record<string, unknown>)[name] = undefined
  }
  return next
}

type Place = { at: 'top' | 'bottom' } | { before: string }

function placeFrom(args: Record<string, unknown>): Place | string {
  if (args.at !== undefined && args.before !== undefined) return 'Give at or before, not both.'
  if (args.before !== undefined) {
    return typeof args.before === 'string' && args.before !== ''
      ? { before: args.before }
      : 'before takes the id of a card in the column.'
  }
  if (args.at === undefined) return { at: 'bottom' }
  return args.at === 'top' || args.at === 'bottom' ? { at: args.at } : `at takes top or bottom, not ${JSON.stringify(args.at)}.`
}

function columnFrom(args: Record<string, unknown>, workspace: Workspace): Column | string {
  const id = typeof args.column === 'string' ? args.column : ''
  const column = workspace.columns.find((one) => one.id === id)
  if (column) return column
  if (workspace.columns.length === 0) return `${workspace.name} has no columns, and columns are made in the app, not by an agent.`
  const list = workspace.columns.map((one) => `${one.id} (${one.title})`).join(', ')
  return id === '' ? `Say which column: column takes an id, one of ${list}.` : `${workspace.name} has no column ${id}. Its columns are ${list}.`
}

// The columns with one card taken out of wherever it was and put in its new
// place. Before a card means in front of it as the column stands once the card
// being placed has left it.
function placed(columns: Column[], cardId: string, columnId: string, place: Place): Column[] | string {
  const without = columns.map((column) => ({ ...column, cards: column.cards.filter((id) => id !== cardId) }))
  const target = without.find((column) => column.id === columnId)
  if (!target) return `There is no column ${columnId}.`
  let at = 'at' in place ? (place.at === 'top' ? 0 : target.cards.length) : target.cards.indexOf(place.before)
  if ('before' in place) {
    if (place.before === cardId) return 'A card cannot go in front of itself.'
    if (at === -1) return `${place.before} is not in ${target.title}. read_kanban gives the order of every column.`
  }
  at = Math.max(0, at)
  target.cards = [...target.cards.slice(0, at), cardId, ...target.cards.slice(at)]
  return without
}

type Loaded = { workspace: Workspace; order: string | null; file: { columns: Column[] } | null }

// The workspace as the window reads it, and columns.json as its own text says,
// taken first: a write of the order is held to the file this call saw, and
// merged over it if the file moved on.
async function load(open: OpenWorkspace): Promise<Loaded> {
  let order: string | null = null
  let file: Loaded['file'] = null
  try {
    const text = await readFile(join(open.path, 'kanban', 'columns.json'), 'utf8')
    order = hashText(text)
    file = parseColumnsFile(text)
  } catch {
    order = null
  }
  return { workspace: await readWorkspace(open.path, basename(open.path)), order, file }
}

// v0.4 step 6. Tried a few times: the file can move on again between
// reading it back and writing. See canvas.ts, which does the same for a canvas.
const ATTEMPTS = 4

const LOOK_AT_BOARD = 'read_kanban shows the board as it is now.'

// The order written the way the window's saveColumns writes it: a card whose
// id was made up on reading has that id written into its file first, so the
// order never names an id no file carries, and a card that does not parse
// stays out of the order. Null when it was written, or the sentence saying why
// not, ending in `so`: what that means for this call.
//
// A columns.json that moved on in between is merged with this call's order,
// card by card. A card this call moves that was also moved on disk, or is
// being dragged in the window, is refused: the other hand got there first.
//
// `moved` is what this call moves. The order alone cannot say which of two
// neighbours moved, and it refused an agent over the card it had moved
// past: see movedCards in shared/merge.ts.
async function writeOrder(loaded: Loaded, columns: Column[], so: string, moved: readonly string[]): Promise<string | null> {
  const { workspace } = loaded
  for (const card of workspace.cards) {
    if (!card.idIsNew || card.broken) continue
    const written = await writeIfUnchanged(card.file, serializeCard(card), card.hash)
    if (!written.ok) return `${basename(card.file)} changed on disk while its id was being written into it, ${so}. ${LOOK_AT_BOARD}`
  }
  const broken = new Set(workspace.cards.filter((card) => card.broken).map((card) => card.id))
  const mineOrder = columns.map((column) => ({ ...column, cards: column.cards.filter((id) => !broken.has(id)) }))
  const base = loaded.file?.columns ?? workspace.columns
  const known = new Set(moved)
  const mine = placesChanged(base, mineOrder, known)
  const titleOf = (id: string): string => `"${workspace.cards.find((card) => card.id === id)?.title ?? id}"`

  const dragged = overlap(mine, editingIn(await readHands(), workspace.path, 'kanban'))
  if (dragged.length > 0) return `${titleOf(dragged[0].id)} was being dragged in the app, ${so}. ${LOOK_AT_BOARD}`

  const path = join(workspace.path, 'kanban', 'columns.json')
  let body = mineOrder
  let extra = workspace.columnsExtra
  let baseline = loaded.order
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt === 0) await hold('columns')
    const written = await writeIfUnchanged(path, serializeColumns({ workspacePath: workspace.path, columns: body, extra }), baseline)
    if (written.ok) return null
    const disk = parseColumnsFile(written.disk)
    if (!disk) return `columns.json was written by something else after the board was read and no longer parses, ${so}. ${LOOK_AT_BOARD}`
    const merged = mergeColumns(base, mineOrder, disk.columns, 'disk', { mine: known })
    const clashed = overlap(mine, merged.clashes)
    if (clashed.length > 0) return `${titleOf(clashed[0].id)} was moved on disk after the board was read, ${so}. ${LOOK_AT_BOARD}`
    body = merged.value
    extra = disk.extra
    baseline = hashText(written.disk)
  }
  return `columns.json kept changing on disk while this was being written, ${so}. Give the change again.`
}

// ---- a card, field by field -----------------------------------------------------

// A card as the fields merge.ts puts together: the app's own, the body, and the
// user's keys as other.<key>.
function cardFields(card: Card): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const name of KNOWN) out[name] = (card as Record<string, unknown>)[name]
  out.body = card.body
  for (const [key, value] of Object.entries(card.extra)) out[`other.${key}`] = value
  return out
}

function cardOf(fields: Record<string, unknown>, disk: Card): Card {
  const next: Card = { ...disk, extra: {} }
  for (const name of KNOWN) (next as Record<string, unknown>)[name] = fields[name]
  next.body = typeof fields.body === 'string' ? fields.body : ''
  for (const [key, value] of Object.entries(fields)) {
    if (key.startsWith('other.')) next.extra[key.slice('other.'.length)] = value
  }
  return next
}

// A card written over what was read, or merged with what was written in
// between, field by field. Null when it was written, or the refusal's sentence.
async function writeCard(card: Card, next: Card): Promise<string | null> {
  const base = cardFields(card)
  const mine = cardFields(next)
  const changed = [...new Set([...Object.keys(base), ...Object.keys(mine)])].filter((key) => !sameValue(base[key], mine[key]))
  let text = serializeCard(next)
  let baseline: string = card.hash
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt === 0) await hold('card')
    const written = await writeIfUnchanged(card.file, text, baseline)
    if (written.ok) return null
    const disk = parseCard(card.file, written.disk)
    if (disk.broken) {
      return `${basename(card.file)} was written by something else after it was read and no longer parses (${disk.broken}), so nothing was written over it. read_card gives its text as it is.`
    }
    const merged = mergeFields(base, mine, cardFields(disk), 'disk')
    const clashed = merged.clashes.filter((key) => changed.includes(key))
    if (clashed.length > 0) {
      const names = clashed.map((key) => key.replace(/^other\./, ''))
      const more = changed.some((key) => !clashed.includes(key))
      return `"${card.title}" changed on disk after it was read, so its ${names.join(' and ')} ${names.length > 1 ? 'were' : 'was'} not changed.${more ? ' Nothing else in this call was written either.' : ''} read_card shows it as it is now.`
    }
    text = serializeCard(cardOf(merged.fields, disk))
    baseline = hashText(written.disk)
  }
  return `"${card.title}" kept changing on disk while this was being written, so nothing was written. Give the change again.`
}

const record = (open: OpenWorkspace, card: { id: string; title: string }, action: AiAction, column?: string) =>
  recordAiChange({
    workspace: open.path,
    workspaceName: open.name,
    card: card.id,
    title: card.title,
    action,
    ...(column !== undefined ? { column } : {})
  })

const unreadable = (card: Card): string =>
  `${basename(card.file)} does not parse (${card.broken}), and Bothy does not write over a card it cannot read. read_card gives its text as it is.`


const cardId = (args: Record<string, unknown>): string => (typeof args.card === 'string' ? args.card : '')

const SAY_WHICH = 'Say which card: card takes an id from read_kanban.'

export const CREATE_CARD: Tool = {
  name: 'create_card',
  description: [
    "Make a card in a column of a workspace's kanban.",
    'title and column are needed. The card goes to the bottom of the column unless at or before says otherwise, and its file name follows the title once and never changes.',
    FIELDS_TOLD,
    'The answer gives the new card its id and says where it sits.'
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: { ...WORKSPACE_INPUT, column: COLUMN_INPUT, ...PLACE_INPUTS, ...FIELD_INPUTS },
    required: ['workspace', 'column', 'title'],
    additionalProperties: false
  },
  run: async (args, access) => {
    const found = await findWorkspace(args, access)
    if (!found.ok) return found.result
    if (typeof args.title !== 'string' || args.title.trim() === '') return refusal('title is needed: what the card is called.')
    const loaded = await load(found.workspace)
    const { workspace } = loaded

    const column = columnFrom(args, workspace)
    if (typeof column === 'string') return refusal(column)
    const place = placeFrom(args)
    if (typeof place === 'string') return refusal(place)
    const changes = changesFrom(args, workspace, true)
    if (typeof changes === 'string') return refusal(changes)
    // Tried before the card exists, so a refusal leaves nothing behind.
    const trial = placed(workspace.columns, '', column.id, place)
    if (typeof trial === 'string') return refusal(trial)

    const { title, ...fields } = changes.set
    const card = await createCard(workspace.path, title as string, {
      ...fields,
      ...(changes.body !== undefined ? { body: changes.body } : {}),
      extra: changes.other
    })
    const columns = placed(workspace.columns, card.id, column.id, place) as Column[]
    const failed = await writeOrder(loaded, columns, 'so the new card was not given its place', [card.id])
    await record(found.workspace, card, 'added', column.title)
    if (failed) {
      return refusal(
        `The card ${card.id} was made. ${failed} Until it has a place the app shows it at the end of the first column; move_card can put it where it belongs.`
      )
    }
    return answer({
      workspace: named(found.workspace),
      card: { id: card.id, title: card.title, file: basename(card.file) },
      column: { id: column.id, title: column.title },
      position: (columns.find((one) => one.id === column.id) as Column).cards.indexOf(card.id) + 1
    })
  }
}

export const UPDATE_CARD: Tool = {
  name: 'update_card',
  description: [
    'Change a card. Only what is given changes; everything else on the card, keys the app does not own included, stays as it is.',
    'clear takes out fields, or empties the body. A new title does not rename the file.',
    FIELDS_TOLD
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      ...WORKSPACE_INPUT,
      card: CARD_INPUT,
      ...FIELD_INPUTS,
      clear: { type: 'array', items: { type: 'string', enum: CLEARABLE }, description: 'Fields to take out.' }
    },
    required: ['workspace', 'card'],
    additionalProperties: false
  },
  run: async (args, access) => {
    const id = cardId(args)
    if (id === '') return refusal(SAY_WHICH)
    const found = await findWorkspace(args, access)
    if (!found.ok) return found.result
    const { workspace } = await load(found.workspace)
    const lookup = findCard(workspace, id)
    if (!lookup.ok) return lookup.result
    const card = lookup.card
    if (card.broken) return refusal(unreadable(card))

    const changes = changesFrom(args, workspace, false)
    if (typeof changes === 'string') return refusal(changes)
    const names = [
      ...Object.keys(changes.set),
      ...(changes.body !== undefined ? ['body'] : []),
      ...Object.keys(changes.other).map((key) => `other.${key}`),
      ...changes.clear
    ]
    if (names.length === 0) return refusal('Nothing to change: give a field, body, other or clear.')

    const next = applied(card, changes)
    const text = serializeCard(next)
    if (text === serializeCard(card)) {
      return answer({ workspace: named(found.workspace), card: { id, title: card.title }, unchanged: true })
    }
    const failed = await writeCard(card, next)
    if (failed) return refusal(failed)
    await record(found.workspace, next, 'changed')
    return answer({ workspace: named(found.workspace), card: { id, title: next.title }, changed: names })
  }
}

export const MOVE_CARD: Tool = {
  name: 'move_card',
  description:
    'Move a card to a column, or to another place in its own column: the bottom unless at or before says otherwise. An archived card can be moved too; it keeps the new place for when it comes back.',
  inputSchema: {
    type: 'object',
    properties: { ...WORKSPACE_INPUT, card: CARD_INPUT, column: COLUMN_INPUT, ...PLACE_INPUTS },
    required: ['workspace', 'card', 'column'],
    additionalProperties: false
  },
  run: async (args, access) => {
    const id = cardId(args)
    if (id === '') return refusal(SAY_WHICH)
    const found = await findWorkspace(args, access)
    if (!found.ok) return found.result
    const loaded = await load(found.workspace)
    const { workspace } = loaded
    const lookup = findCard(workspace, id)
    if (!lookup.ok) return lookup.result
    const card = lookup.card
    if (card.broken) return refusal(`${unreadable(card)} The app keeps a card it cannot read out of the order.`)

    const column = columnFrom(args, workspace)
    if (typeof column === 'string') return refusal(column)
    const place = placeFrom(args)
    if (typeof place === 'string') return refusal(place)
    const columns = placed(workspace.columns, card.id, column.id, place)
    if (typeof columns === 'string') return refusal(columns)

    const where = {
      workspace: named(found.workspace),
      card: { id, title: card.title },
      column: { id: column.id, title: column.title },
      position: (columns.find((one) => one.id === column.id) as Column).cards.indexOf(card.id) + 1
    }
    // Already there, and there in the file too: a card the app only shows at
    // the end of the first column is not listed, and placing it is a change.
    const same = columns.every((one, i) => one.cards.join() === workspace.columns[i].cards.join())
    if (same && !workspace.orphans.includes(card.id)) return answer({ ...where, unchanged: true })

    const failed = await writeOrder(loaded, columns, 'so it was not moved', [card.id])
    if (failed) return refusal(failed)
    await record(found.workspace, card, 'moved', column.title)
    return answer(where)
  }
}

export const ARCHIVE_CARD: Tool = {
  name: 'archive_card',
  description:
    'Put a card in the archive, off the kanban, or bring it back. It keeps its place in its column while it is away, so it comes back where it was.',
  inputSchema: {
    type: 'object',
    properties: {
      ...WORKSPACE_INPUT,
      card: CARD_INPUT,
      archived: { type: 'boolean', description: 'true to put it away, false to bring it back.' }
    },
    required: ['workspace', 'card', 'archived'],
    additionalProperties: false
  },
  run: async (args, access) => {
    const id = cardId(args)
    if (id === '') return refusal(SAY_WHICH)
    if (typeof args.archived !== 'boolean') return refusal('archived takes true to put the card away, or false to bring it back.')
    const found = await findWorkspace(args, access)
    if (!found.ok) return found.result
    const { workspace } = await load(found.workspace)
    const lookup = findCard(workspace, id)
    if (!lookup.ok) return lookup.result
    const card = lookup.card
    if (card.broken) return refusal(unreadable(card))

    const said = { workspace: named(found.workspace), card: { id, title: card.title }, archived: args.archived }
    if ((card.archived === true) === args.archived) return answer({ ...said, unchanged: true })
    const next: Card = { ...card, archived: args.archived ? true : undefined }
    const failed = await writeCard(card, next)
    if (failed) return refusal(failed)
    await record(found.workspace, card, args.archived ? 'archived' : 'unarchived')
    return answer(said)
  }
}

export const DELETE_CARD: Tool = {
  name: 'delete_card',
  description: `Throw a card away. It goes to the vault's trash, where Bothy keeps it for ${KEEP_DAYS} days and can bring it back, and leaves its column.`,
  inputSchema: {
    type: 'object',
    properties: { ...WORKSPACE_INPUT, card: CARD_INPUT },
    required: ['workspace', 'card'],
    additionalProperties: false
  },
  run: async (args, access) => {
    const id = cardId(args)
    if (id === '') return refusal(SAY_WHICH)
    const found = await findWorkspace(args, access)
    if (!found.ok) return found.result
    const loaded = await load(found.workspace)
    const { workspace } = loaded
    const lookup = findCard(workspace, id)
    if (!lookup.ok) return lookup.result
    const card = lookup.card

    // The hold every write has: a file that changed since it was read is not
    // thrown away unseen. A card that does not parse can still go, as it can
    // from the window.
    await hold('card')
    let text: string
    try {
      text = await readFile(card.file, 'utf8')
    } catch {
      return refusal(`${basename(card.file)} is not on disk any more. read_kanban shows the board as it is now.`)
    }
    if (hashText(text) !== card.hash) {
      return refusal(`"${card.title}" changed on disk after it was read, so it was not thrown away. read_card shows it as it is now.`)
    }

    await trashCard(card.file, workspace.path)
    await record(found.workspace, card, 'trashed')
    const said = {
      workspace: named(found.workspace),
      trashed: { id, title: card.title },
      note: `In the trash for ${KEEP_DAYS} days, where Bothy can bring it back.`
    }
    const listed = !workspace.orphans.includes(id) && workspace.columns.some((column) => column.cards.includes(id))
    if (!listed) return answer(said)
    const columns = workspace.columns.map((column) => ({ ...column, cards: column.cards.filter((one) => one !== id) }))
    const failed = await writeOrder(loaded, columns, 'so the order still names its id, which the app leaves out', [id])
    // Not a failure of the deletion. An id no file carries is left off the
    // board when the kanban is read, with a note, and goes the next time the
    // order is written.
    return answer(failed ? { ...said, order: failed } : said)
  }
}
