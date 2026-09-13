import { DAY } from '../shared/schema/card'
import type { Field, Value } from '../shared/schema/field'
import { COLOUR } from './check'

// What an agent is told about a field, written from the schema rather than
// beside it. The risk is a change to cards or the canvas leaving
// agents behind; a description typed out here would be exactly that, the way
// the format doc drifted from the code once. So a field added to the
// schema reaches the tool descriptions the next time the server is built, and
// a field taken out leaves them.

function kind(value: Value): string {
  switch (value.is) {
    case 'text':
      return 'text'
    case 'number':
      return 'number'
    case 'boolean':
      return 'true or false'
    case 'true':
      return 'true, or left out for off'
    case 'day':
      return 'day, 2026-09-20'
    case 'moment':
      return 'moment, 2026-09-20T14:22:00.000Z'
    case 'colour':
      return 'colour, #rrggbb or #rrggbbaa'
    case 'one of':
      return `one of: ${value.values.join(', ')}${value.open ? ', or another word, which is kept' : ''}`
    case 'id':
      return `id, ${value.prefix}_ and ${value.digits} hex digits`
    case 'file name':
      return 'bare file name in files/'
    case 'point':
      return 'point, [x, y]'
    case 'list':
      return `list of ${kind(value.of)}`
    case 'map':
      return 'object'
    case 'either':
      return value.of.map(kind).join(' | ')
  }
}

// Where a field, or a shape of fields, was first told. One met again - the id
// every canvas object has, the two ends of an arrow - points back rather than
// being printed a second time. Measured: printed in full, the canvas
// tool's description was 6,373 bytes, and the tool list sits in an agent's
// context whether it ever opens the canvas or not.
export type Told = Map<object, string>

const holdsFields = (value: Value): boolean =>
  value.is === 'map' ||
  (value.is === 'list' && holdsFields(value.of)) ||
  (value.is === 'either' && value.of.some(holdsFields))

// The fields inside a value that holds fields of its own: an object, a list of
// them, or a choice between shapes of them.
function inner(value: Value, indent: string, told: Told, where: string): string[] {
  if (!holdsFields(value)) return []
  const before = told.get(value)
  if (before !== undefined) return [`${indent}(the fields of ${before})`]
  told.set(value, where)
  if (value.is === 'map') return describeFields(value.fields, indent, told, where)
  if (value.is === 'list') return inner(value.of, indent, told, where)
  if (value.is !== 'either') return []
  const shapes = value.of.filter(holdsFields)
  if (shapes.length === 1) return inner(shapes[0], indent, told, where)
  return shapes.flatMap((one, i) => [
    `${indent}${i === 0 ? 'either' : 'or'}:`,
    ...inner(one, `${indent}  `, told, `${where}, ${i === 0 ? 'the first' : 'another'} shape`)
  ])
}

// One line a field: its name, what it holds, whether the app always writes it,
// its default, and what it means.
export function describeFields(
  fields: readonly Field[],
  indent = '',
  told: Told = new Map(),
  where = 'the fields above'
): string[] {
  return fields.flatMap((field) => {
    const before = told.get(field)
    if (before !== undefined) return [`${indent}- ${field.name} (as in ${before})`]
    told.set(field, where)
    const notes = [kind(field.value)]
    if (field.required) notes.push('always written')
    if (field.default !== undefined) notes.push(`default ${JSON.stringify(field.default)}`)
    return [
      `${indent}- ${field.name} (${notes.join('; ')}): ${field.means}`,
      ...inner(field.value, `${indent}  `, told, `${field.name} in ${where}`)
    ]
  })
}

// The same schema as JSON Schema, for the inputs of the tools that write. What
// a value may be travels with each tool; what a field means is said once, in
// read_card, rather than again on every tool that writes it. A list of words is
// closed here even where the schema keeps other words on reading, for the
// reason check.ts gives.
export function schemaOf(value: Value): Record<string, unknown> {
  switch (value.is) {
    case 'text':
    case 'moment':
    case 'id':
    case 'file name':
      return { type: 'string' }
    case 'number':
      return { type: 'number' }
    case 'boolean':
      return { type: 'boolean' }
    case 'true':
      return { type: 'boolean', enum: [true] }
    case 'day':
      return { type: 'string', pattern: DAY.source }
    case 'colour':
      return { type: 'string', pattern: COLOUR.source }
    case 'one of':
      return { type: 'string', enum: [...value.values] }
    case 'point':
      return { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }
    case 'list':
      return { type: 'array', items: schemaOf(value.of) }
    case 'map':
      return {
        type: 'object',
        properties: Object.fromEntries(value.fields.map((field) => [field.name, schemaOf(field.value)])),
        required: value.fields.filter((field) => field.required && field.default === undefined).map((field) => field.name),
        additionalProperties: false
      }
    case 'either':
      return { anyOf: value.of.map(schemaOf) }
  }
}
