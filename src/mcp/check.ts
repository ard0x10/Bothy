import { isAttachmentName } from '../main/vault/attach'
import { DAY } from '../shared/schema/card'
import type { Value } from '../shared/schema/field'

// What an agent hands a writing tool, held to the schema before anything is
// written. The app's readers stay forgiving about a file, for the reason
// field.ts gives; an agent writing one is told exactly what is wrong, in words
// it can act on, because a value the reader quietly drops is a change the agent
// believes it made.
//
// Stricter than reading in one way, on purpose. A list of words marked open is
// open so that a word already in a file is kept, not so that new ones get
// written: an agent writes the words the app offers.

export const COLOUR = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

// A day that is a day: 2026-02-30 has the shape of one and is not.
function isDay(text: string): boolean {
  if (!DAY.test(text)) return false
  const date = new Date(`${text}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text
}

function shown(value: unknown): string {
  const text = JSON.stringify(value) ?? String(value)
  return text.length > 60 ? `${text.slice(0, 57)}...` : text
}

// What is wrong with a value, as a sentence, or null when nothing is.
export function problemWith(value: unknown, spec: Value, name: string): string | null {
  switch (spec.is) {
    case 'text':
      return typeof value === 'string' ? null : `${name} takes text, not ${shown(value)}.`
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : `${name} takes a number, not ${shown(value)}.`
    case 'boolean':
      return typeof value === 'boolean' ? null : `${name} takes true or false, not ${shown(value)}.`
    case 'true':
      return value === true ? null : `${name} takes true, not ${shown(value)}.`
    case 'day':
      return typeof value === 'string' && isDay(value)
        ? null
        : `${name} takes a day written like 2026-09-20, not ${shown(value)}.`
    case 'moment':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value))
        ? null
        : `${name} takes a moment written like 2026-09-20T14:22:00.000Z, not ${shown(value)}.`
    case 'colour':
      return typeof value === 'string' && COLOUR.test(value)
        ? null
        : `${name} takes a colour written #rrggbb or #rrggbbaa, not ${shown(value)}.`
    case 'one of':
      return typeof value === 'string' && spec.values.includes(value)
        ? null
        : `${name} takes one of ${spec.values.join(', ')}, not ${shown(value)}.`
    case 'id':
      return typeof value === 'string' && value !== '' ? null : `${name} takes an id, not ${shown(value)}.`
    case 'file name':
      return typeof value === 'string' && isAttachmentName(value)
        ? null
        : `${name} takes a bare file name in files/, with no folder in it, not ${shown(value)}.`
    case 'point':
      return Array.isArray(value) &&
        value.length === 2 &&
        value.every((one) => typeof one === 'number' && Number.isFinite(one))
        ? null
        : `${name} takes a point [x, y], not ${shown(value)}.`
    case 'list': {
      if (!Array.isArray(value)) return `${name} takes a list, not ${shown(value)}.`
      for (const [i, item] of value.entries()) {
        const problem = problemWith(item, spec.of, `${name}[${i}]`)
        if (problem) return problem
      }
      return null
    }
    case 'map': {
      const names = spec.fields.map((field) => field.name)
      if (!isRecord(value)) return `${name} takes an object with ${names.join(', ')}, not ${shown(value)}.`
      for (const key of Object.keys(value)) {
        if (!names.includes(key)) return `${name} has no field called ${key}; it takes ${names.join(', ')}.`
      }
      for (const field of spec.fields) {
        const own = value[field.name]
        if (own === undefined) {
          if (field.required && field.default === undefined) return `${name}.${field.name} is missing.`
          continue
        }
        const problem = problemWith(own, field.value, `${name}.${field.name}`)
        if (problem) return problem
      }
      return null
    }
    case 'either': {
      const problems = spec.of.map((one) => problemWith(value, one, name))
      return problems.includes(null) ? null : problems.join(' Or ')
    }
  }
}

// A value that passed, with the defaults of anything left out filled in and an
// object's fields put in the schema's order - the order the app writes them in.
export function withDefaults(value: unknown, spec: Value): unknown {
  if (spec.is === 'list' && Array.isArray(value)) return value.map((item) => withDefaults(item, spec.of))
  if (spec.is === 'map' && isRecord(value)) {
    const out: Record<string, unknown> = {}
    for (const field of spec.fields) {
      const own = value[field.name] === undefined ? field.default : value[field.name]
      if (own !== undefined) out[field.name] = withDefaults(own, field.value)
    }
    return out
  }
  return value
}
