import { mkdir, readFile, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { canvasPath, parseCanvas, serializeCanvas, type ParsedCanvas } from '../main/vault/canvas'
import { hashText } from '../main/vault/hash'
import { trashCanvasObjects } from '../main/vault/trash'
import { writeIfUnchanged } from '../main/vault/writer'
import { wordsOfObject, type AiAction } from '../shared/aitrail'
import { tie } from '../shared/arrow'
import {
  DEFAULTS,
  NEW_ARROW,
  NEW_BOX,
  NEW_TEXT,
  endpointOf,
  isArrow,
  isStroke,
  newObjectId,
  placeOf,
  type CanvasObject,
  type Endpoint
} from '../shared/canvas'
import type { Field } from '../shared/schema/field'
import { CANVAS_OBJECTS, CANVAS_TYPES, TEXT_STYLE_FIELDS, type CanvasType } from '../shared/schema/canvas'
import { KEEP_DAYS } from '../shared/trash'
import type { Box } from '../shared/viewport'
import { problemWith } from './check'
import { schemaOf } from './describe'
import { hold } from './hold'
import { answer, refusal, type Tool, type ToolResult } from './result'
import { readHands } from './state'
import { editingIn } from '../shared/editing'
import { changedOn, mergeCanvas, overlap, type Clash } from '../shared/merge'
import { recordAiChanges } from './trail'
import { WORKSPACE_INPUT, findWorkspace, named, type OpenWorkspace } from './workspaces'

// The tools that write a canvas, v0.4 step 5. Every write goes down the road the
// window's own file takes: canvas.json read by parseCanvas and written by
// serializeCanvas, so a type or a field this build has never heard of rides
// along. A new object starts as one put down by a click in the window does, and
// a tied arrow end is fixed with the window's own tie.
//
// Three answers shape this file:
// - a box or a text is not put anywhere the agent did not say. There is no
//   looking for room: x and y, or beside a named object, or a refusal.
// - what an agent takes off goes to the trash for as long as a card would, and
//   the window's Ctrl+Z can take back anything an agent did while it is open
//   (that half is the window's reloadCanvas).
// - the line on screen names objects by their words, as it names cards.
//
// Every call reads the canvas and writes it once, held to what was read. A
// canvas that changed in between is not written over: see save, v0.4 step 6.

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const fieldsOf = (type: CanvasType): readonly Field[] => CANVAS_OBJECTS[type].fields

const pick = (fields: readonly Field[], names: readonly string[]): Field[] =>
  names.map((name) => fields.find((field) => field.name === name) as Field)

// What an agent may give each type, taken from the schema. The id and type are
// the app's, a drawing's points are a hand's, and an image's file is whatever
// was put in files/.
const PLACE_NAMES = ['x', 'y', 'w', 'h'] as const
const BOX_STYLE = fieldsOf('box').filter((field) => !['id', 'type', ...PLACE_NAMES].includes(field.name))
const ARROW_FIELDS = fieldsOf('arrow').filter((field) => !['id', 'type'].includes(field.name))
export const WRITABLE: Record<CanvasType, Field[]> = {
  box: [...pick(fieldsOf('box'), PLACE_NAMES), ...BOX_STYLE],
  text: [...pick(fieldsOf('text'), PLACE_NAMES), ...BOX_STYLE],
  arrow: ARROW_FIELDS,
  draw: pick(fieldsOf('draw'), ['stroke', 'strokeWidth', 'opacity']),
  image: pick(fieldsOf('image'), [...PLACE_NAMES, 'rotation', 'opacity', 'radius'])
}
const ADDABLE = ['box', 'text', 'arrow'] as const
type Addable = (typeof ADDABLE)[number]

// Beside an object, `near`, and how far from it.
const SIDES = ['right', 'below', 'left', 'above'] as const
type Side = (typeof SIDES)[number]
const GAP = 40

// What words take up, for an agent choosing a size. Not measured: a server has
// no screen to lay a line out on. Roughly the width of an average letter of the
// app's sans face, and the line height the schema gives.
const LETTER = 0.55

// ---- reading and writing the file -------------------------------------------

type Loaded = { open: OpenWorkspace; path: string; baseline: string; canvas: ParsedCanvas }

async function load(open: OpenWorkspace): Promise<Loaded | ToolResult> {
  const path = canvasPath(open.path)
  let text: string | null = null
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    // A workspace with no canvas.json has an empty canvas, as the window reads it.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      const why = error instanceof Error ? error.message : String(error)
      return refusal(`The canvas of ${open.name} could not be read (${why}). Bothy does not draw it and will not write over it.`)
    }
  }
  const canvas = parseCanvas(text ?? '{"formatVersion":1,"objects":[]}')
  if (canvas.broken !== null) {
    return refusal(`The canvas of ${open.name} could not be read (${canvas.broken}). Bothy does not draw it and will not write over it.`)
  }
  if (canvas.extra.formatVersion !== 1) {
    return refusal(
      `The canvas of ${open.name} says formatVersion ${JSON.stringify(canvas.extra.formatVersion)}. This Bothy knows version 1 and does not write over a format it does not know.`
    )
  }
  // A canvas.json that was not there is held to still not being there: the
  // fingerprint of nothing matches no file with anything in it.
  return { open, path, baseline: hashText(text ?? ''), canvas }
}

// v0.4 step 6. A write held to what was read, and what to do when the
// file moved on in between: put the two together (shared/merge.ts), and write
// that instead - unless both changed the same field, where the other writer
// stands and this call is refused whole. A hand in the window (editing.json)
// has got there first by definition. Tried a few times, since the file can move
// on again between reading it back and writing.
const ATTEMPTS = 4

type Saved = { ok: true; objects: CanvasObject[] } | { ok: false; refusal: ToolResult }

async function save(loaded: Loaded, objects: CanvasObject[], taking = false): Promise<Saved> {
  const mine = changedOn(loaded.canvas.objects, objects)
  const held = overlap(mine, editingIn(await readHands(), loaded.open.path, 'canvas'))
  if (held.length > 0) return { ok: false, refusal: refusal(clashSentence(loaded, held, mine, 'was being edited in the app', taking)) }

  await mkdir(dirname(loaded.path), { recursive: true })
  const base = { objects: loaded.canvas.objects, extra: loaded.canvas.extra }
  let body = { objects, extra: loaded.canvas.extra }
  let baseline = loaded.baseline
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt === 0) await hold('canvas')
    const written = await writeIfUnchanged(loaded.path, serializeCanvas(body), baseline)
    if (written.ok) return { ok: true, objects: body.objects }
    const disk = parseCanvas(written.disk)
    if (disk.broken !== null || disk.extra.formatVersion !== 1) {
      return { ok: false, refusal: refusal(`The canvas of ${loaded.open.name} was written by something else after it was read, and can no longer be read as a canvas Bothy knows, so nothing was written over it. read_canvas says what is wrong with it.`) }
    }
    const merged = mergeCanvas(base, { objects, extra: loaded.canvas.extra }, disk, 'disk')
    const clashed = overlap(mine, merged.clashes)
    if (clashed.length > 0) return { ok: false, refusal: refusal(clashSentence(loaded, clashed, mine, 'changed on disk after it was read', taking)) }
    body = merged.value
    baseline = hashText(written.disk)
  }
  return { ok: false, refusal: refusal(`The canvas of ${loaded.open.name} kept changing on disk while this was being written, so nothing was written. Give the change again.`) }
}

// One sentence an agent can act on: which object, what happened to it, what of
// the call was not written, and where to look. The first object that clashed is
// named; the rest of the call is said to be unwritten, since nothing of it is.
function clashSentence(loaded: Loaded, clashed: Clash[], mine: Clash[], why: string, taking: boolean): string {
  const first = clashed[0]
  const object = loaded.canvas.objects.find((one) => one.id === first.id)
  const words = object ? wordsOfObject(object.props.text) : ''
  const name = words ? `"${words}"` : object ? `The ${object.type} ${object.id}` : `The object ${first.id}`
  const fields = first.fields.filter((field) => field !== '*')
  const what =
    taking || fields.length === 0
      ? taking
        ? 'so it was not taken off'
        : 'so it was not changed'
      : `so its ${fields.join(' and ')} ${fields.length > 1 ? 'were' : 'was'} not changed`
  const refusedFields = new Set(first.fields)
  const more = mine.some((one) => one.id !== first.id || one.fields.some((field) => !refusedFields.has(field)))
  return `${name} ${why}, ${what}.${more ? ' Nothing else in this call was written either.' : ''} read_canvas shows it as it is now.`
}

const tell = (loaded: Loaded, objects: CanvasObject[], action: AiAction) =>
  recordAiChanges(
    objects.map((object) => ({
      workspace: loaded.open.path,
      workspaceName: loaded.open.name,
      object: object.id,
      kind: object.type,
      title: wordsOfObject(object.props.text),
      action
    }))
  )

// ---- checking what was given ------------------------------------------------

// The value of one field, held to the schema and to the ranges the schema's
// words give but its types do not.
function problemWithField(value: unknown, field: Field, where: string): string | null {
  const name = `${where}.${field.name}`
  const problem = problemWith(value, field.value, name)
  if (problem) return problem
  if ((field.name === 'w' || field.name === 'h') && (value as number) <= 0) return `${name} takes a number more than 0.`
  if (field.name === 'opacity' && ((value as number) < 0 || (value as number) > 1)) return `${name} takes a number from 0 to 1.`
  if ((field.name === 'strokeWidth' || field.name === 'radius') && (value as number) < 0) return `${name} takes a number of 0 or more.`
  if (field.name === 'textStyle' && isRecord(value) && typeof value.size === 'number' && value.size <= 0) {
    return `${name}.size takes a number more than 0.`
  }
  if ((field.name === 'from' || field.name === 'to') && isRecord(value) && Array.isArray(value.at)) {
    if (!value.at.every((one) => typeof one === 'number' && one >= 0 && one <= 1)) {
      return `${name}.at takes fractions of the object's box, each from 0 to 1.`
    }
  }
  return null
}

type Near = { of: string; side: Side; gap: number }

function nearFrom(value: unknown, where: string): Near | string {
  if (!isRecord(value)) return `${where}.near takes an object: of, and side and gap if wanted.`
  for (const key of Object.keys(value)) {
    if (!['of', 'side', 'gap'].includes(key)) return `${where}.near has no field called ${key}; it takes of, side and gap.`
  }
  if (typeof value.of !== 'string' || value.of === '') return `${where}.near.of takes the id or ref of an object to go beside.`
  const side = value.side === undefined ? 'right' : value.side
  if (!SIDES.includes(side as Side)) return `${where}.near.side takes one of ${SIDES.join(', ')}, not ${JSON.stringify(side)}.`
  const gap = value.gap === undefined ? GAP : value.gap
  if (typeof gap !== 'number' || !Number.isFinite(gap) || gap < 0) return `${where}.near.gap takes a number of 0 or more.`
  return { of: value.of, side: side as Side, gap }
}

// Where a rectangle of this size goes, beside that one.
function beside(target: Box, size: { w: number; h: number }, near: Near): { x: number; y: number } {
  switch (near.side) {
    case 'right':
      return { x: target.x + target.w + near.gap, y: target.y }
    case 'below':
      return { x: target.x, y: target.y + target.h + near.gap }
    case 'left':
      return { x: target.x - near.gap - size.w, y: target.y }
    case 'above':
      return { x: target.x, y: target.y - near.gap - size.h }
  }
}

// What an arrow may be tied to, as the window ties one: something with a place
// that is not a line. A scribble's rectangle is mostly empty space, and an arrow
// tied to an arrow follows nothing anybody can see. See objectAt in arrow.ts.
const tieable = (object: CanvasObject): boolean => !isStroke(object) && !isArrow(object) && placeOf(object) !== null

const a = (type: string): string => `${/^[aeiou]/.test(type) ? 'an' : 'a'} ${type}`

const kinds = (object: CanvasObject): string => `${object.id} is ${a(object.type)}`

// ---- add_to_canvas ------------------------------------------------------------

// The inputs of every type an agent can add, each field once. A stroke and a
// dash mean a border on a box and the line on an arrow: one value, two readings,
// which read_canvas already says.
const inputsOf = (fields: readonly Field[]): Record<string, unknown> =>
  Object.fromEntries(fields.map((field) => [field.name, schemaOf(field.value)]))

const NEAR_INPUT = {
  type: 'object',
  description: `Beside an object on the canvas, or one made earlier in this call: its id or ref, the side (${SIDES.join(', ')}; right unless given) and the gap (${GAP} unless given). The top edges line up beside, the left edges above and below. Nothing is moved out of the way.`,
  properties: {
    of: { type: 'string' },
    side: { type: 'string', enum: [...SIDES] },
    gap: { type: 'number' }
  },
  required: ['of'],
  additionalProperties: false
} as const

const ADD_ITEM = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: [...ADDABLE] },
    ref: { type: 'string', description: 'A name for this object for the rest of the call, so an arrow or near can point at it.' },
    near: NEAR_INPUT,
    ...inputsOf([...WRITABLE.box, ...ARROW_FIELDS])
  },
  required: ['type'],
  additionalProperties: false
}

const seedOf = (type: Addable): Record<string, unknown> =>
  type === 'box' ? NEW_BOX : type === 'text' ? NEW_TEXT : NEW_ARROW

export const ADD_TO_CANVAS: Tool = {
  name: 'add_to_canvas',
  description: [
    "Add boxes, texts and arrows to a workspace's canvas: any number in one call, written at once, drawn on top of what is there.",
    `Each object gives its type and the fields read_canvas describes. A field left out takes what the app gives an object put down by a click: a box is ${NEW_BOX.w} by ${NEW_BOX.h}, filled ${NEW_BOX.fill}, its words centred at size ${NEW_BOX.textStyle.size}; a text is ${NEW_TEXT.w} by ${NEW_TEXT.h}, its words at size ${NEW_TEXT.textStyle.size}.`,
    'A box or a text needs a place: x and y, or near. Bothy does not look for room, so a place that is taken is drawn over.',
    'ref names an object for the rest of the call. An arrow end is {of, at} with the id or ref of a box, a text or an image, or {x, y} on the canvas. An end tied without at is fixed where a line from the other end meets that object, as the app fixes one; an arrow tied to an object moves with it.',
    `Words are not measured for you: a letter is about ${LETTER} of the size wide, and a line ${DEFAULTS.lineHeight} of the size high. Words that do not fit are drawn past the box.`,
    'The answer gives each new object its id, and a box or text its place.'
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      ...WORKSPACE_INPUT,
      objects: { type: 'array', items: ADD_ITEM, minItems: 1, description: 'What to add, drawn in this order.' }
    },
    required: ['workspace', 'objects'],
    additionalProperties: false
  },
  run: async (args, access) => {
    if (!Array.isArray(args.objects) || args.objects.length === 0) {
      return refusal('objects takes a list of what to add, at least one.')
    }
    const found = await findWorkspace(args, access)
    if (!found.ok) return found.result
    const loaded = await load(found.workspace)
    if (!('canvas' in loaded)) return loaded

    const existing = loaded.canvas.objects
    const all = [...existing]
    const byId = (id: string): CanvasObject | undefined => all.find((one) => one.id === id)
    const refs = new Map<string, CanvasObject>()
    const lookup = (name: string): CanvasObject | undefined => refs.get(name) ?? byId(name)
    const made: { object: CanvasObject; ref?: string }[] = []
    const ends: { object: CanvasObject; from: Endpoint; to: Endpoint; where: string }[] = []

    for (const [i, item] of (args.objects as unknown[]).entries()) {
      const where = `objects[${i}]`
      if (!isRecord(item)) return refusal(`${where} takes an object with a type.`)
      const type = item.type
      if (!ADDABLE.includes(type as Addable)) {
        return refusal(`${where}.type takes one of ${ADDABLE.join(', ')}, not ${JSON.stringify(type)}.`)
      }
      const fields = WRITABLE[type as Addable]
      const names = fields.map((field) => field.name)
      const extra = type === 'arrow' ? ['type', 'ref'] : ['type', 'ref', 'near']
      for (const key of Object.keys(item)) {
        if (!names.includes(key) && !extra.includes(key)) {
          return refusal(`${where} is ${a(type as string)}, and ${a(type as string)} has no field called ${key}. It takes ${[...names, ...extra.slice(1)].join(', ')}.`)
        }
      }
      for (const field of fields) {
        if (item[field.name] === undefined) continue
        const problem = problemWithField(item[field.name], field, where)
        if (problem) return refusal(problem)
      }

      let ref: string | undefined
      if (item.ref !== undefined) {
        if (typeof item.ref !== 'string' || item.ref === '') return refusal(`${where}.ref takes a name.`)
        if (refs.has(item.ref)) return refusal(`${where}.ref ${item.ref} is already the name of an object earlier in this call.`)
        if (byId(item.ref)) return refusal(`${where}.ref ${item.ref} is the id of an object on the canvas already; give it another name.`)
        ref = item.ref
      }

      const seed = seedOf(type as Addable)
      let id = newObjectId()
      while (byId(id)) id = newObjectId()

      if (type === 'arrow') {
        for (const key of ['from', 'to'] as const) {
          if (item[key] === undefined) return refusal(`${where}.${key} is missing: an arrow needs both ends.`)
        }
        const { from, to, ...style } = item as Record<string, unknown>
        delete style.type
        delete style.ref
        const object: CanvasObject = { id, type: 'arrow', props: { ...seed, from, to, ...style } }
        ends.push({ object, from: endpointOf(object, 'from'), to: endpointOf(object, 'to'), where })
        all.push(object)
        made.push({ object, ref })
        if (ref) refs.set(ref, object)
        continue
      }

      // A box or a text: its place, or a refusal.
      const hasXY = item.x !== undefined || item.y !== undefined
      if (hasXY && item.near !== undefined) return refusal(`${where} gives both x/y and near; give one.`)
      if (hasXY && (item.x === undefined || item.y === undefined)) return refusal(`${where} needs both x and y.`)
      const style = seed as { w: number; h: number; textStyle: Record<string, unknown> }
      const size = { w: (item.w as number | undefined) ?? style.w, h: (item.h as number | undefined) ?? style.h }
      let at: { x: number; y: number }
      if (hasXY) at = { x: item.x as number, y: item.y as number }
      else if (item.near !== undefined) {
        const near = nearFrom(item.near, where)
        if (typeof near === 'string') return refusal(near)
        const target = lookup(near.of)
        if (!target) return refusal(`${where}.near.of: there is nothing called ${near.of} on the canvas or earlier in this call.`)
        const box = placeOf(target)
        if (!box || isArrow(target)) return refusal(`${where}.near.of: ${kinds(target)}, which has no place to go beside.`)
        at = beside(box, size, near)
      } else {
        return refusal(`${where} needs a place: give x and y, or near with the id or ref of an object to go beside.`)
      }

      // In the order the window writes a new one: see addObject in the store.
      const shape = type === 'box' ? ((item.shape as string | undefined) ?? 'rect') : 'rect'
      const { w: _w, h: _h, textStyle: seedStyle, ...look } = seed as Record<string, unknown>
      if (shape !== 'rect') delete look.radius
      const given = { ...(item as Record<string, unknown>) }
      for (const key of ['type', 'ref', 'near', 'x', 'y', 'w', 'h', 'shape', 'textStyle']) delete given[key]
      const props: Record<string, unknown> = {
        x: at.x,
        y: at.y,
        w: size.w,
        h: size.h,
        ...(shape === 'rect' ? {} : { shape }),
        ...look,
        text: '',
        textStyle: { ...(seedStyle as Record<string, unknown>), ...((item.textStyle as Record<string, unknown> | undefined) ?? {}) },
        ...given
      }
      const object: CanvasObject = { id, type: type as string, props }
      all.push(object)
      made.push({ object, ref })
      if (ref) refs.set(ref, object)
    }

    // The ends once everything is made, since an arrow can tie to an object
    // that comes after it in the list. Both ends are fixed against the other as
    // it was given, which is how the window fixes an arrow a hand draws.
    for (const { object, from, to, where } of ends) {
      for (const [key, end] of [['from', from], ['to', to]] as const) {
        if (end === null || !('of' in end)) continue
        const target = lookup(end.of)
        if (!target) return refusal(`${where}.${key}.of: there is nothing called ${end.of} on the canvas or in this call.`)
        if (!tieable(target)) return refusal(`${where}.${key}.of: ${kinds(target)}. An arrow ties to a box, a text or an image.`)
      }
      const real = (end: Endpoint): Endpoint => (end && 'of' in end ? { ...end, of: (lookup(end.of) as CanvasObject).id } : end)
      const [a, b] = [real(from), real(to)]
      object.props.from = tie(a, b, byId)
      object.props.to = tie(b, a, byId)
    }

    const objects = made.map((one) => one.object)
    const saved = await save(loaded, all)
    if (!saved.ok) return saved.refusal
    await tell(loaded, objects, 'added')
    return answer({
      workspace: named(found.workspace),
      made: made.map(({ object, ref }) => ({
        id: object.id,
        type: object.type,
        ...(ref ? { ref } : {}),
        ...(object.type === 'arrow' ? {} : { x: object.props.x, y: object.props.y, w: object.props.w, h: object.props.h })
      }))
    })
  }
}

// ---- update_canvas ------------------------------------------------------------

// What clear can take out of each type: a field with a default or none, so an
// object with it taken out is still whole. textStyle's fields by name too.
const CLEARABLE: Record<CanvasType, string[]> = Object.fromEntries(
  CANVAS_TYPES.map((type) => [
    type,
    [
      ...WRITABLE[type].filter((field) => !field.required).map((field) => field.name),
      ...(type === 'box' || type === 'text' ? TEXT_STYLE_FIELDS.map((field) => `textStyle.${field.name}`) : [])
    ]
  ])
) as Record<CanvasType, string[]>

const UPDATE_ITEM = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'The id of the object, from read_canvas.' },
    near: { ...NEAR_INPUT, description: 'Move a box, text or image beside another object. ' + NEAR_INPUT.description },
    clear: { type: 'array', items: { type: 'string' }, description: 'Fields to take out, back to their default: a field name, or textStyle.<name>.' },
    ...inputsOf([...WRITABLE.box, ...ARROW_FIELDS])
  },
  required: ['id'],
  additionalProperties: false
}

export const UPDATE_CANVAS: Tool = {
  name: 'update_canvas',
  description: [
    'Change objects on a canvas: any number in one call, written at once. Only what is given changes; everything else an object holds, keys the app does not own included, stays.',
    'A box, a text and an image take a new place or size (x, y, w, h, or near) and the fields read_canvas describes for them; textStyle given is merged into the one the object has. An arrow takes new ends and its look; an end tied without at is fixed against the other end, as add_to_canvas fixes one. A draw takes stroke, strokeWidth and opacity. A type Bothy does not know is not changed.',
    'clear takes fields out, back to their default. Arrows tied to a box that moves go with it.'
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      ...WORKSPACE_INPUT,
      objects: { type: 'array', items: UPDATE_ITEM, minItems: 1, description: 'The objects to change, each by its id.' }
    },
    required: ['workspace', 'objects'],
    additionalProperties: false
  },
  run: async (args, access) => {
    if (!Array.isArray(args.objects) || args.objects.length === 0) {
      return refusal('objects takes a list of changes, each with the id of an object.')
    }
    const found = await findWorkspace(args, access)
    if (!found.ok) return found.result
    const loaded = await load(found.workspace)
    if (!('canvas' in loaded)) return loaded

    // Worked on a copy, each change seeing the ones before it, so a box can be
    // put beside another that moved earlier in the same call.
    const all = loaded.canvas.objects.map((object) => ({ ...object, props: { ...object.props } }))
    const byId = (id: string): CanvasObject | undefined => all.find((one) => one.id === id)
    const seen = new Set<string>()
    const retie: { object: CanvasObject; keys: ('from' | 'to')[] }[] = []
    const report: { id: string; changed: string[] }[] = []

    for (const [i, item] of (args.objects as unknown[]).entries()) {
      const where = `objects[${i}]`
      if (!isRecord(item)) return refusal(`${where} takes an object with an id.`)
      if (typeof item.id !== 'string' || item.id === '') return refusal(`${where}.id takes the id of an object, from read_canvas.`)
      if (seen.has(item.id)) return refusal(`${where}: ${item.id} is changed twice in this call; give its changes together.`)
      seen.add(item.id)
      const object = byId(item.id)
      if (!object) return refusal(`The canvas has no object with the id ${item.id}. read_canvas gives the ids.`)
      if (!(CANVAS_TYPES as readonly string[]).includes(object.type)) {
        return refusal(`${kinds(object)}, a type Bothy does not know, so it is kept as it is and not changed.`)
      }
      const type = object.type as CanvasType
      const fields = WRITABLE[type]
      const names = fields.map((field) => field.name)
      const movable = names.includes('x')
      const extra = movable ? ['id', 'clear', 'near'] : ['id', 'clear']
      for (const key of Object.keys(item)) {
        if (!names.includes(key) && !extra.includes(key)) {
          return refusal(`${where}: ${kinds(object)}, which takes ${[...names, ...extra.slice(1)].join(', ')}, not ${key}.`)
        }
      }
      for (const field of fields) {
        if (item[field.name] === undefined) continue
        const problem = problemWithField(item[field.name], field, where)
        if (problem) return refusal(problem)
      }

      const clear: string[] = []
      if (item.clear !== undefined) {
        if (!Array.isArray(item.clear)) return refusal(`${where}.clear takes a list of field names.`)
        for (const name of item.clear) {
          if (typeof name !== 'string' || !CLEARABLE[type].includes(name)) {
            return refusal(`${where}.clear: ${a(type)} can have ${CLEARABLE[type].join(', ')} taken out, not ${JSON.stringify(name)}.`)
          }
          const [top, inner] = name.split('.')
          const given = item[top]
          if (given !== undefined && (inner === undefined || (isRecord(given) && given[inner] !== undefined))) {
            return refusal(`${where}: ${name} is both given and cleared.`)
          }
          clear.push(name)
        }
      }

      const hasXY = item.x !== undefined || item.y !== undefined
      if (hasXY && item.near !== undefined) return refusal(`${where} gives both x/y and near; give one.`)

      const before = JSON.stringify(object.props)
      const changed: string[] = []
      for (const field of fields) {
        const value = item[field.name]
        if (value === undefined) continue
        if (field.name === 'textStyle') {
          const own = isRecord(object.props.textStyle) ? object.props.textStyle : {}
          object.props.textStyle = { ...own, ...(value as Record<string, unknown>) }
        } else {
          object.props[field.name] = value
        }
        changed.push(field.name)
      }
      for (const name of clear) {
        const [top, inner] = name.split('.')
        if (inner === undefined) delete object.props[top]
        else if (isRecord(object.props.textStyle)) {
          const style = { ...object.props.textStyle }
          delete style[inner]
          object.props.textStyle = style
        }
        changed.push(name)
      }
      if (item.near !== undefined) {
        const near = nearFrom(item.near, where)
        if (typeof near === 'string') return refusal(near)
        const target = byId(near.of)
        if (!target) return refusal(`${where}.near.of: the canvas has nothing with the id ${near.of}.`)
        if (target === object) return refusal(`${where}.near.of: an object cannot go beside itself.`)
        const box = placeOf(target)
        if (!box || isArrow(target)) return refusal(`${where}.near.of: ${kinds(target)}, which has no place to go beside.`)
        const size = placeOf(object) ?? { w: 0, h: 0 }
        Object.assign(object.props, beside(box, size, near))
        changed.push('near')
      }
      const ends = (['from', 'to'] as const).filter((key) => item[key] !== undefined)
      if (ends.length > 0) retie.push({ object, keys: ends })
      if (JSON.stringify(object.props) !== before || ends.length > 0) report.push({ id: object.id, changed })
    }

    // New ends once every object is where this call puts it.
    for (const { object, keys } of retie) {
      for (const key of keys) {
        const end = endpointOf(object, key)
        if (end === null || !('of' in end)) continue
        const target = byId(end.of)
        if (!target) return refusal(`${object.id}.${key}.of: the canvas has nothing with the id ${end.of}.`)
        if (!tieable(target)) return refusal(`${object.id}.${key}.of: ${kinds(target)}. An arrow ties to a box, a text or an image.`)
      }
      const [from, to] = [endpointOf(object, 'from'), endpointOf(object, 'to')]
      if (keys.includes('from')) object.props.from = tie(from, to, byId)
      if (keys.includes('to')) object.props.to = tie(to, from, byId)
    }

    const touched = all.filter(
      (object, i) => JSON.stringify(object.props) !== JSON.stringify(loaded.canvas.objects[i].props)
    )
    if (touched.length === 0) {
      return answer({ workspace: named(found.workspace), unchanged: true })
    }
    const saved = await save(loaded, all)
    if (!saved.ok) return saved.refusal
    await tell(loaded, touched, 'changed')
    const ids = new Set(touched.map((object) => object.id))
    return answer({
      workspace: named(found.workspace),
      changed: report
        .filter((one) => ids.has(one.id))
        .map((one) => {
          const object = byId(one.id) as CanvasObject
          const place = object.type === 'arrow' || isStroke(object) ? {} : { x: object.props.x, y: object.props.y, w: object.props.w, h: object.props.h }
          return { id: one.id, fields: one.changed, ...place }
        })
    })
  }
}

// ---- delete_from_canvas -------------------------------------------------------

export const DELETE_FROM_CANVAS: Tool = {
  name: 'delete_from_canvas',
  description: `Take objects off a canvas. Each goes to the vault's trash, where Bothy keeps it for ${KEEP_DAYS} days and can put it back; while Bothy is open, Ctrl+Z brings it back too. An arrow tied to something taken off stays in the file and is not drawn until that object is back.`,
  inputSchema: {
    type: 'object',
    properties: {
      ...WORKSPACE_INPUT,
      ids: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'The ids of the objects, from read_canvas.' }
    },
    required: ['workspace', 'ids'],
    additionalProperties: false
  },
  run: async (args, access) => {
    const ids = args.ids
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string' && id !== '')) {
      return refusal('ids takes a list of object ids, at least one.')
    }
    const found = await findWorkspace(args, access)
    if (!found.ok) return found.result
    const loaded = await load(found.workspace)
    if (!('canvas' in loaded)) return loaded

    const going = new Set(ids as string[])
    const objects = loaded.canvas.objects
    const missing = [...going].filter((id) => !objects.some((object) => object.id === id))
    if (missing.length > 0) {
      return refusal(`The canvas has no object with the id ${missing.join(', ')}, so nothing was taken off. read_canvas gives the ids.`)
    }

    const trashed = objects.filter((object) => going.has(object.id))
    // Into the trash first, so what leaves the canvas is never only in memory.
    // A canvas that changed in between takes those files back out again: the
    // objects are still on it, and a trash entry for something that never left
    // would be one more thing on a screen that is not true.
    const kept = await trashCanvasObjects(found.workspace.path, trashed)
    const saved = await save(loaded, objects.filter((object) => !going.has(object.id)), true)
    if (!saved.ok) {
      await Promise.all(kept.map((path) => rm(path, { force: true })))
      return saved.refusal
    }
    await tell(loaded, trashed, 'trashed')

    const left = objects
      .filter((object) => !going.has(object.id) && isArrow(object))
      .filter((arrow) =>
        (['from', 'to'] as const).some((key) => {
          const end = endpointOf(arrow, key)
          return end !== null && 'of' in end && going.has(end.of)
        })
      )
      .map((arrow) => arrow.id)
    return answer({
      workspace: named(found.workspace),
      trashed: trashed.map((object) => ({ id: object.id, type: object.type })),
      ...(left.length > 0 ? { arrowsLeft: left, arrowsNote: 'Tied to what was taken off: kept, not drawn, and drawn again if it comes back.' } : {}),
      note: `In the trash for ${KEEP_DAYS} days, where Bothy can put it back.`
    })
  }
}
