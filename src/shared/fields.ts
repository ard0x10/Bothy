import { parse, stringify } from 'yaml'
import { KNOWN } from './schema/card'

// The card's own fields, in the order they are written, which is also the list
// of names a custom field may not take. It is the card's list in the schema
// since v0.4, so the panel, the writer and whatever an agent is told cannot hold
// three different ideas of what a card is.
export { KNOWN }

export type FieldKind = 'text' | 'number' | 'boolean' | 'empty' | 'list' | 'map'

export type FieldRead = { ok: true; value: unknown } | { ok: false; why: string }

// What the panel says a value is. Shown next to the field, because the whole
// contract here is that the box holds YAML and the reader cannot otherwise tell
// whether `4500` ended up a number or the four characters.
export function kindOf(value: unknown): FieldKind {
  if (value === null || value === undefined) return 'empty'
  if (Array.isArray(value)) return 'list'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'object') return 'map'
  return 'text'
}

// A list or a map has no single line to sit on, so the panel hands it a block
// with the same shape it has in the file instead of one-lining it.
export function isBlock(value: unknown): boolean {
  const kind = kindOf(value)
  return kind === 'list' || kind === 'map'
}

// The text that sits to the right of `key:` in the file. Editing a custom field
// is editing that text and nothing else, so this has to be what the file shows:
// an empty string reads back as the two quote characters, because that is how
// the file has to spell it to mean an empty string rather than nothing.
export function fieldText(value: unknown): string {
  if (value === undefined) return ''
  const written = stringify(value)
  return written.endsWith('\n') ? written.slice(0, -1) : written
}

// And back, through the same parser the file goes through. What you type means
// what it would mean on that line: `0800` is the number 800 here because it is
// there too, `true` is a boolean, `"true"` is text, and an empty box is an
// empty line, which YAML reads as null. Measured before it was decided - a box
// that kept everything as text would have turned `budget: 4500` into
// `budget: "4500"` on the first edit and said nothing, which is the loss the
// format spends a whole rule forbidding.
export function readFieldText(text: string): FieldRead {
  try {
    return { ok: true, value: parse(text) ?? null }
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error)
    return { ok: false, why: why.split('\n')[0] }
  }
}

// Why a name cannot be used, or null when it can. `taken` is the rest of the
// card's fields; the name being edited is not among them.
export function keyProblem(name: string, taken: Iterable<string>): string | null {
  if (!name) return 'A field needs a name.'
  if ((KNOWN as readonly string[]).includes(name)) return `The app writes ${name} itself.`
  for (const other of taken) {
    if (other === name) return `${name} is already on this card.`
  }
  return null
}

// A key cannot be renamed in place, so this rebuilds the object - walking the
// old order, or a field would drop to the bottom of the frontmatter every time
// its name was corrected. Order is the only thing the user can see about these
// fields on disk, so moving one is an edit nobody asked for.
export function renameField(
  fields: Record<string, unknown>,
  from: string,
  to: string
): Record<string, unknown> {
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) next[key === from ? to : key] = value
  return next
}

export function setField(
  fields: Record<string, unknown>,
  key: string,
  value: unknown
): Record<string, unknown> {
  return { ...fields, [key]: value }
}

export function dropField(
  fields: Record<string, unknown>,
  key: string
): Record<string, unknown> {
  const next = { ...fields }
  delete next[key]
  return next
}
