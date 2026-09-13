import { createHash } from 'node:crypto'
import { basename as pathBasename, resolve } from 'node:path'
import { parse, stringify } from 'yaml'
import { CARD_FIELDS, KNOWN, type CardFieldName } from '../../shared/schema/card'
import type { Card, Checklist } from '../../shared/types'
import { hashText } from './hash'

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/

// The write order, and the list of names a custom field is not allowed to take,
// are the same list: the card's fields in the schema.
export { KNOWN }

type Front = Record<string, unknown>

// A file with no id still needs one to be referred to, and it has to be the
// same one on every load or the card jumps around between reloads. Derived from
// the path, so it is stable until the id is written into the file.
function idFromPath(file: string): string {
  return `k_${createHash('sha1').update(resolve(file).toLowerCase()).digest('hex').slice(0, 4)}`
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || value instanceof Date) return String(value)
  return undefined
}

function asTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(asString).filter((tag): tag is string => !!tag)
}

function asChecklists(value: unknown): Checklist[] {
  if (!Array.isArray(value)) return []
  return value.map((list) => {
    const raw = (list ?? {}) as Record<string, unknown>
    const items = Array.isArray(raw.items) ? raw.items : []
    return {
      name: asString(raw.name) ?? 'Checklist',
      items: items.map((item) => {
        const entry = (item ?? {}) as Record<string, unknown>
        return { text: asString(entry.text) ?? '', done: entry.done === true }
      })
    }
  })
}

// How each field of the schema comes off the frontmatter. Keyed by the schema's
// own names, so a field added there stops the build until it is given a way in
// here, and a name left here after the schema dropped it stops the build too.
const READ: { [Name in CardFieldName]: (front: Front, file: string) => Card[Name] } = {
  id: (front, file) => asString(front.id) ?? idFromPath(file),
  title: (front, file) => asString(front.title) ?? basename(file),
  archived: (front) => (front.archived === true ? true : undefined),
  cover: (front) => asString(front.cover),
  tags: (front) => asTags(front.tags),
  start: (front) => asString(front.start),
  due: (front) => asString(front.due),
  priority: (front) => asString(front.priority),
  checklists: (front) => asChecklists(front.checklists),
  files: (front) => asTags(front.files),
  created: (front) => asString(front.created),
  modified: (front) => asString(front.modified)
}

export function parseCard(file: string, text: string): Card {
  const match = FRONTMATTER.exec(text)
  const body = match ? text.slice(match[0].length) : text

  let front: Record<string, unknown> = {}
  if (match) {
    try {
      front = (parse(match[1]) ?? {}) as Record<string, unknown>
    } catch (error) {
      // Decision 4 of the format: a card we cannot read is flagged, kept whole
      // and never written back over.
      return {
        id: idFromPath(file),
        title: basename(file),
        file,
        hash: hashText(text),
        tags: [],
        checklists: [],
        files: [],
        body: text,
        extra: {},
        broken: error instanceof Error ? error.message : String(error)
      }
    }
  }

  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(front)) {
    if (!(KNOWN as readonly string[]).includes(key)) extra[key] = value
  }

  const own = Object.fromEntries(
    KNOWN.map((name) => [name, READ[name](front, file)])
  ) as Pick<Card, CardFieldName>

  return {
    ...own,
    idIsNew: asString(front.id) ? undefined : true,
    file,
    hash: hashText(text),
    body,
    extra
  }
}

export function serializeCard(card: Card): string {
  if (card.broken) {
    throw new Error(`Refusing to rewrite a card that failed to parse: ${card.file}`)
  }

  const front: Record<string, unknown> = {}

  // A field this app owns is dropped when it is empty: an untouched card should
  // not carry `due:` with nothing after it. The app can always put the key back,
  // because it knows the key exists.
  const put = (key: string, value: unknown): void => {
    const empty =
      value === undefined ||
      value === null ||
      value === '' ||
      (Array.isArray(value) && value.length === 0)
    if (!empty) front[key] = value
  }

  for (const field of CARD_FIELDS) {
    const value = card[field.name]
    // A field that is only ever true is written only when it is on. A card that
    // is not archived carries no key at all rather than `archived: false`, the
    // same way an empty `due` is left out.
    put(field.name, field.value.is === 'true' ? (value === true ? true : undefined) : value)
  }

  // A field this app does not own gets no such filter. It used to share the one
  // above, which meant `note: ""` written by hand or by an agent was gone after
  // the first save, and nothing said so - the format promises the opposite, and
  // whoever wrote the key cannot put it back because they never learn it left.
  // Only undefined is dropped, and only because it has no YAML to write.
  for (const [key, value] of Object.entries(card.extra)) {
    if (value !== undefined) front[key] = value
  }

  const body = card.body.replace(/^\n+/, '')
  return `---\n${stringify(front)}---\n\n${body}`
}

function basename(file: string): string {
  return pathBasename(file).replace(/\.md$/i, '') || 'Untitled'
}
