import { basename } from 'node:path'
import { readCanvas } from '../main/vault/canvas'
import { readWorkspace } from '../main/vault/store'
import { endpointOf, placeOf, pointsOf, type CanvasObject } from '../shared/canvas'
import { boundsOf } from '../shared/geometry'
import { labelKeyOf } from '../shared/labels'
import { CANVAS, CANVAS_OBJECTS, CANVAS_TYPES, type CanvasType } from '../shared/schema/canvas'
import { CARD, CARD_FIELDS, KNOWN, type CardFieldName } from '../shared/schema/card'
import { COLUMN_FIELDS } from '../shared/schema/columns'
import type { Field } from '../shared/schema/field'
import type { Card, Workspace } from '../shared/types'
import type { Box } from '../shared/viewport'
import { describeFields, type Told } from './describe'
import { answer, refusal, type Tool, type ToolResult } from './result'
import { WORKSPACE_INPUT, findWorkspace, named } from './workspaces'

// The reading tools, v0.4 step 3. Nothing here reads a file itself: the kanban
// comes from the reader the window uses and the canvas from the canvas reader,
// so a card the board shows one way cannot reach an agent another way. What is
// added here is only what an agent is spared - a card's body in the kanban, the
// values nobody changed from their default, the points of a scribble.

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const empty = (value: unknown): boolean =>
  value === undefined || value === '' || (Array.isArray(value) && value.length === 0)

// The names a workspace has given its colours, for the colour words in front
// of the agent. A colour with no name is left out: its word is all there is.
function colourNames(workspace: Workspace, tags: string[] | null): Record<string, string> | null {
  const names: Record<string, string> = {}
  for (const label of workspace.labels) {
    if (!label.key || !label.name) continue
    if (tags !== null && !tags.some((tag) => labelKeyOf(tag) === label.key)) continue
    names[label.key] = label.name
  }
  return Object.keys(names).length > 0 ? names : null
}

// ---- the kanban ------------------------------------------------------------

const SUMMARY: readonly CardFieldName[] = ['id', 'title', 'tags', 'due', 'priority']

function summary(card: Card): Record<string, unknown> {
  // Shown rather than dropped, as the board shows it: a card that went missing
  // from the answer would read as a card that is not there.
  if (card.broken) return { id: card.id, file: basename(card.file), broken: card.broken }
  const items = card.checklists.flatMap((list) => list.items)
  const out: Record<string, unknown> = {}
  for (const name of SUMMARY) if (!empty(card[name])) out[name] = card[name]
  if (card.archived) out.archived = true
  if (items.length > 0) out.checklist = `${items.filter((item) => item.done).length}/${items.length}`
  if (card.files.length > 0) out.files = card.files.length
  return out
}

export const READ_KANBAN: Tool = {
  name: 'read_kanban',
  description: [
    "Read one workspace's kanban as the app shows it: the columns left to right, and the cards in each top to bottom. Cards come without their body; read_card gives one card whole.",
    'Each column has:',
    ...describeFields(COLUMN_FIELDS.filter((field) => field.name !== 'cards')),
    '- cards: the cards in it, top to bottom.',
    'Each card has, leaving out what is empty:',
    ...describeFields(CARD_FIELDS.filter((field) => SUMMARY.includes(field.name))),
    '- checklist: ticked items / all items, across its checklists.',
    '- files: how many attachments it lists.',
    '- archived: true. Archived cards are left out and counted in archived, unless archived is asked for.',
    'A card whose frontmatter does not parse has only id, file and broken, the reason.',
    'labels maps a colour word to the name this workspace gave that colour. notes are what the app put right while reading.'
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      ...WORKSPACE_INPUT,
      archived: { type: 'boolean', description: 'Include archived cards, in their places. Off by default, as on the board.' }
    },
    required: ['workspace'],
    additionalProperties: false
  },
  run: async (args, access) => {
    const found = await findWorkspace(args, access)
    if (!found.ok) return found.result
    const workspace = await readWorkspace(found.workspace.path, basename(found.workspace.path))
    const withArchived = args.archived === true
    const cards = new Map(workspace.cards.map((card) => [card.id, card]))

    let archived = 0
    const columns = workspace.columns.map((column) => {
      const shown: Record<string, unknown>[] = []
      for (const id of column.cards) {
        const card = cards.get(id)
        if (!card) continue
        if (card.archived) {
          archived += 1
          if (!withArchived) continue
        }
        shown.push(summary(card))
      }
      return {
        id: column.id,
        title: column.title,
        ...(column.wipLimit !== undefined ? { wipLimit: column.wipLimit } : {}),
        cards: shown
      }
    })

    const labels = colourNames(workspace, null)
    return answer({
      workspace: named(found.workspace),
      ...(labels ? { labels } : {}),
      columns,
      ...(!withArchived && archived > 0 ? { archived } : {}),
      ...(workspace.notes.length > 0 ? { notes: workspace.notes } : {})
    })
  }
}

// ---- a card ----------------------------------------------------------------

// The one card an id names in a workspace, or what an agent is told when it
// names none or more than one. Shared with the tools that write, so reading a
// card and changing it cannot disagree about which card an id is.
export function findCard(
  workspace: Workspace,
  id: string
): { ok: true; card: Card } | { ok: false; result: ToolResult } {
  const matches = workspace.cards.filter((card) => card.id === id)
  if (matches.length === 1) return { ok: true, card: matches[0] }
  if (matches.length === 0) {
    return {
      ok: false,
      result: refusal(
        `No card has the id ${id} in ${workspace.name}. read_kanban lists the cards, and the archived ones when archived is true.`
      )
    }
  }
  return {
    ok: false,
    result: refusal(
      `${matches.length} card files carry the id ${id}: ${matches.map((card) => basename(card.file)).join(', ')}. They cannot be told apart until one has an id of its own.`
    )
  }
}

// Where a card sits as the app shows it: its column, its place counting from 1
// among all of that column's cards, and whether columns.json lists it at all.
export function placeIn(
  workspace: Workspace,
  id: string
): { column?: { id: string; title: string }; position?: number; unlisted?: true } {
  const column = workspace.columns.find((one) => one.cards.includes(id))
  if (!column) return {}
  return {
    column: { id: column.id, title: column.title },
    position: column.cards.indexOf(id) + 1,
    ...(workspace.orphans.includes(id) ? { unlisted: true as const } : {})
  }
}

export const READ_CARD: Tool = {
  name: 'read_card',
  description: [
    'Read one card whole.',
    `A card is ${CARD.where}. ${CARD.means}`,
    'fields holds its frontmatter in the order the app writes it, leaving out what is empty:',
    ...describeFields(CARD_FIELDS),
    'other holds the frontmatter keys the app does not own, as written. body is the text under the frontmatter.',
    "column and position say where it sits, position counting from 1 among all of the column's cards, archived ones too. unlisted is true when columns.json does not list it and the app shows it at the end of the first column. missingFiles names attachments with no file behind them.",
    'A card whose frontmatter does not parse comes with broken, the reason, and text, the whole file as it is.'
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      ...WORKSPACE_INPUT,
      card: { type: 'string', description: `The id of the card, from read_kanban. ${CARD_FIELDS[0].means}` }
    },
    required: ['workspace', 'card'],
    additionalProperties: false
  },
  run: async (args, access) => {
    const id = typeof args.card === 'string' ? args.card : ''
    if (id === '') return refusal('Say which card: card takes an id from read_kanban.')
    const found = await findWorkspace(args, access)
    if (!found.ok) return found.result
    const workspace = await readWorkspace(found.workspace.path, basename(found.workspace.path))

    const lookup = findCard(workspace, id)
    if (!lookup.ok) return lookup.result
    const card = lookup.card
    const where = placeIn(workspace, card.id)

    if (card.broken) {
      return answer({
        workspace: named(found.workspace),
        ...where,
        id: card.id,
        file: basename(card.file),
        broken: card.broken,
        text: card.body
      })
    }

    const fields: Record<string, unknown> = {}
    for (const name of KNOWN) if (!empty(card[name])) fields[name] = card[name]
    const missing = card.files.filter((name) => !workspace.files.includes(name))
    const labels = colourNames(workspace, card.tags)

    return answer({
      workspace: named(found.workspace),
      ...where,
      file: basename(card.file),
      fields,
      ...(Object.keys(card.extra).length > 0 ? { other: card.extra } : {}),
      ...(missing.length > 0 ? { missingFiles: missing } : {}),
      ...(labels ? { labels } : {}),
      body: card.body
    })
  }
}

// ---- the canvas ------------------------------------------------------------

function fieldsOf(type: string): readonly Field[] | null {
  return (CANVAS_TYPES as readonly string[]).includes(type) ? CANVAS_OBJECTS[type as CanvasType].fields : null
}

// A field at its default says nothing an absent one does not, and the schema
// says what every default is, so the agent is told the defaults once in the
// description instead of on every object. A field the app always writes stays
// whatever it holds. A type or a key the schema does not know stays as it is.
function withoutDefaults(values: Record<string, unknown>, fields: readonly Field[] | null): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(values)) {
    const field = fields?.find((one) => one.name === key)
    if (field && !field.required && field.default !== undefined && value === field.default) continue
    if (field && field.value.is === 'map' && isRecord(value)) {
      const rest = withoutDefaults(value, field.value.fields)
      if (Object.keys(rest).length === 0 && !field.required) continue
      out[key] = rest
      continue
    }
    out[key] = value
  }
  return out
}

function shown(object: CanvasObject, withPoints: boolean): Record<string, unknown> {
  const props = withoutDefaults(object.props, fieldsOf(object.type))
  const out: Record<string, unknown> = { id: object.id, type: object.type }
  for (const [key, value] of Object.entries(props)) {
    // A scribble is hundreds of points an agent almost never needs. Where it is
    // and how many there are stands in their place, where the points stood.
    if (key === 'points' && !withPoints && Array.isArray(value)) {
      out.pointCount = pointsOf(object).length
      out.box = placeOf(object)
      continue
    }
    out[key] = value
  }
  return out
}

const meets = (a: Box, b: Box): boolean =>
  a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h

function regionOf(value: unknown): Box | null | 'bad' {
  if (value === undefined) return null
  if (!isRecord(value)) return 'bad'
  const { x, y, w, h } = value
  const numbers = [x, y, w, h].every((one) => typeof one === 'number' && Number.isFinite(one))
  if (!numbers || (w as number) <= 0 || (h as number) <= 0) return 'bad'
  return { x: x as number, y: y as number, w: w as number, h: h as number }
}

export const READ_CANVAS: Tool = {
  name: 'read_canvas',
  description: [
    "Read one workspace's canvas.",
    `The canvas is ${CANVAS.where}. ${CANVAS.means}`,
    'The answer has bounds, the rectangle every object with a place fits in (null when nothing has one); count, how many objects the file holds; and objects, in drawing order.',
    'Each object leaves out the fields at their default, so an absent field means its default. A draw comes with pointCount and box in place of its points, unless points is true. An object of a type not listed here comes as it is.',
    'With region, only what meets that rectangle comes back: objects whose place touches it, and arrows with an end tied to one of those or lying inside it. shown then says how many came back.',
    'The objects and their fields:',
    ...describeObjects()
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      ...WORKSPACE_INPUT,
      region: {
        type: 'object',
        description: 'A rectangle in canvas units, y down. Only what meets it is returned.',
        properties: {
          x: { type: 'number', description: 'The left edge.' },
          y: { type: 'number', description: 'The top edge.' },
          w: { type: 'number', description: 'The width, more than 0.' },
          h: { type: 'number', description: 'The height, more than 0.' }
        },
        required: ['x', 'y', 'w', 'h'],
        additionalProperties: false
      },
      points: { type: 'boolean', description: 'Give each draw its points. Off by default.' }
    },
    required: ['workspace'],
    additionalProperties: false
  },
  run: async (args, access) => {
    const region = regionOf(args.region)
    if (region === 'bad') return refusal('region takes x, y, w and h as numbers, with w and h more than 0.')
    const found = await findWorkspace(args, access)
    if (!found.ok) return found.result

    const file = await readCanvas(found.workspace.path)
    // Not an empty canvas. The window will not draw this file or write over it,
    // and an agent told "nothing here" would go on to put things there.
    if (file.broken !== null) {
      return refusal(
        `The canvas of ${found.workspace.name} could not be read (${file.broken}). Bothy does not draw it and will not write over it.`
      )
    }

    const places = new Map(file.objects.map((object) => [object.id, placeOf(object)]))
    const inRegion = (object: CanvasObject, box: Box): boolean => {
      const place = places.get(object.id)
      if (place) return meets(place, box)
      for (const key of ['from', 'to'] as const) {
        const end = endpointOf(object, key)
        if (end === null) continue
        if ('of' in end) {
          const tied = places.get(end.of)
          if (tied && meets(tied, box)) return true
        } else if (meets({ x: end.x, y: end.y, w: 0, h: 0 }, box)) {
          return true
        }
      }
      return false
    }

    const withPoints = args.points === true
    const objects = file.objects
      .filter((object) => region === null || inRegion(object, region))
      .map((object) => shown(object, withPoints))

    return answer({
      workspace: named(found.workspace),
      bounds: boundsOf([...places.values()].filter((place): place is Box => place !== null)),
      count: file.objects.length,
      ...(region !== null ? { region, shown: objects.length } : {}),
      objects,
      ...(file.notes.length > 0 ? { notes: file.notes } : {})
    })
  }
}

// Every type the schema lists, with its fields. A type whose fields are another
// type's, as a text's are a box's, says so rather than printing them twice.
export function describeObjects(): string[] {
  const lines: string[] = []
  const told: Told = new Map()
  const seen: { type: CanvasType; fields: readonly Field[] }[] = []
  for (const type of CANVAS_TYPES) {
    const { means, fields } = CANVAS_OBJECTS[type]
    const twin = seen.find(
      (one) =>
        one.fields.length === fields.length &&
        one.fields.every((field, i) => field === fields[i] || (field.name === 'type' && fields[i].name === 'type'))
    )
    lines.push(`${type}: ${means}`)
    if (twin) lines.push(`  The fields of a ${twin.type}.`)
    else lines.push(...describeFields(fields.filter((field) => field.name !== 'type'), '  ', told, type))
    seen.push({ type, fields })
  }
  return lines
}
