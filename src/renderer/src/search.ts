import MiniSearch from 'minisearch'
import type { Card, Vault } from '../../shared/types'
import { matches, type Filter } from './filter'

// Search reaches across the whole vault, not just the workspace on screen. The
// main process already hands over every workspace with its cards, so the index
// is built here from what the app is holding and never asks disk a second time.

export type Hit = {
  // Position in the index, which is also the document id. Ids off the cards
  // themselves would collide: two files in different workspaces, or even two in
  // one folder, are free to carry the same `id:` and one of them would be lost.
  key: number
  card: Card
  workspacePath: string
  workspaceName: string
  // Text around the first term that matched, for reading the hit without
  // opening it. Empty only when the card has no body at all.
  snippet: string
}

// How many rows each surface asks for. The palette is a place to jump from, so
// it takes a screenful; the panel is a place to work in, so it takes enough
// that a filter has something to narrow.
export const PALETTE_ROWS = 20
export const PANEL_ROWS = 200

export type Found = {
  // The page, already cut to the limit that was asked for.
  hits: Hit[]
  // How many there were BEFORE the cut. D5 needs this and it is not a nicety:
  // the panel filters what search returns, so filtering a page of 20 down to 3
  // and saying "3" is a lie about the vault. It is also what lets the palette's
  // bridge row say how many are waiting rather than just that some are.
  total: number
}

export type Index = {
  size: number
  search: (query: string, limit?: number) => Found
}

type Entry = { card: Card; workspacePath: string; workspaceName: string }
type Doc = { key: number; title: string; body: string; tags: string }

const SEARCH_OPTIONS = {
  // A palette is typed into a letter at a time, so a query is nearly always a
  // half written word.
  prefix: true,
  fuzzy: 0.2,
  // Scope decision from the spec: title, description, tags. A title is what the
  // user is usually aiming at, so it outranks a mention in the body.
  boost: { title: 3, tags: 2 },
  // Every word has to land somewhere, so a second word narrows the list instead
  // of widening it.
  combineWith: 'AND' as const
}

export function buildIndex(vault: Vault | null): Index {
  const entries: Entry[] = []
  for (const workspace of vault?.workspaces ?? []) {
    for (const card of workspace.cards) {
      entries.push({ card, workspacePath: workspace.path, workspaceName: workspace.name })
    }
  }

  const mini = new MiniSearch<Doc>({
    fields: ['title', 'body', 'tags'],
    idField: 'key',
    // Nothing is copied into the index. A hit is resolved back through
    // `entries`, so a result always carries the card the app is holding rather
    // than a snapshot that went stale the moment the file changed.
    storeFields: []
  })

  mini.addAll(
    entries.map((entry, key) => ({
      key,
      title: entry.card.title,
      // A card that failed to parse keeps its whole file as the body,
      // frontmatter and all. It stays findable that way instead of dropping out
      // of search because the app could not read its fields.
      body: entry.card.body,
      tags: entry.card.tags.join(' ')
    }))
  )

  return {
    size: entries.length,
    search: (query, limit = PALETTE_ROWS) => {
      const text = query.trim()
      if (!text) return { hits: [], total: 0 }
      const terms = text.split(/\s+/)
      // Counted before the cut, and the snippets are built after it. MiniSearch
      // has already scored everything by the time it answers, so the count is
      // free; a snippet is a scan of a card's whole body, and building one for
      // a row nobody is going to see is the part that is not.
      const scored = mini.search(text, SEARCH_OPTIONS)
      const hits = scored.slice(0, limit).map((result) => {
        const entry = entries[result.id as number]
        return {
          key: result.id as number,
          card: entry.card,
          workspacePath: entry.workspacePath,
          workspaceName: entry.workspaceName,
          snippet: snippetFor(entry.card.body, terms)
        }
      })
      return { hits, total: scored.length }
    }
  }
}

// How an answer is laid out, which is a question both surfaces that show hits
// now have to answer the same way. The palette settled it in v0.2 and D4's
// panel joined it: an archived card is still findable, because a search that
// says "nothing" about something the vault is holding is the same lie as
// deleting it. It is just never mixed in - live hits first, then a divider
// saying how many are in the archive, then the archive itself.
//
// Written here rather than in either view for one reason: two views with their
// own copy of this are two searches that can disagree about the same query, and
// the one the user checks is whichever one is wrong.

// Past this many the archive stops listing and says how many more there are, so
// it never pushes live results off the screen.
export const ARCHIVE_ROWS = 5

export type Split = {
  // Everything that is on screen, in the order it is drawn. The divider goes
  // before index `live.length`.
  hits: Hit[]
  live: Hit[]
  archived: Hit[]
  // Archived hits that did not fit. Zero is the ordinary case.
  hidden: number
}

export function splitHits(found: Hit[], rows = ARCHIVE_ROWS): Split {
  const live = found.filter((hit) => !hit.card.archived)
  const archived = found.filter((hit) => hit.card.archived)
  return {
    hits: [...live, ...archived.slice(0, rows)],
    live,
    archived,
    hidden: Math.max(0, archived.length - rows)
  }
}

// How the panel may order an answer, D5. Relevance is what search itself says
// and it is the default, because it is the only one of these that is about the
// query rather than about the cards.
//
// The other three are fields the format already carries. Nothing invented: a
// sort by something the app would have to guess at is a sort that is wrong
// quietly.
export const SEARCH_SORTS = ['relevance', 'title', 'modified', 'due'] as const
export type SearchSort = (typeof SEARCH_SORTS)[number]

export const SORT_LABELS: Record<SearchSort, string> = {
  relevance: 'Relevance',
  title: 'Title',
  modified: 'Last edited',
  due: 'Due date'
}

// A card with no date is not early and not late - it has not answered. So it
// goes to the end whichever way the list is read, rather than sorting as the
// year 1970 and burying the cards that did answer.
const missingLast = (a: string | undefined, b: string | undefined): number | null => {
  if (a === b) return 0
  if (!a) return 1
  if (!b) return -1
  return null
}

export function sortHits(hits: Hit[], sort: SearchSort): Hit[] {
  if (sort === 'relevance') return hits
  // A copy: the caller's array is what search handed back, and sorting it in
  // place would reorder a result somebody else is still reading.
  const out = [...hits]
  if (sort === 'title') {
    out.sort((a, b) => a.card.title.localeCompare(b.card.title))
    return out
  }
  const field = sort === 'due' ? 'due' : 'modified'
  out.sort((a, b) => {
    const left = a.card[field]
    const right = b.card[field]
    const missing = missingLast(left, right)
    if (missing !== null) return missing
    // Due dates read forward - what is closest is what matters. Edits read
    // backward - what happened last is what matters.
    return sort === 'due'
      ? String(left).localeCompare(String(right))
      : String(right).localeCompare(String(left))
  })
  return out
}

// The panel's filter, D5. Deliberately NOT the kanban's filter object even
// though it is the same shape: the kanban is looking at one workspace and this
// is looking at the whole vault, so "urgent" narrows two different things and
// one checkbox setting both is a surprise rather than a convenience.
//
// `scope` is the group the kanban cannot have - it is already one workspace.
// Empty means every folder, the same way an empty tag list means every tag.
export function filterHits(hits: Hit[], filter: Filter, scope: readonly string[]): Hit[] {
  return hits.filter((hit) => {
    if (scope.length > 0 && !scope.includes(hit.workspacePath)) return false
    return matches(hit.card, filter)
  })
}

const BEFORE = 30
const AFTER = 90

// Where the word was found, with enough either side to recognise the sentence.
// The match is looked for literally: the index is fuzzy, this is not, so a
// typo simply falls back to the opening of the card.
export function snippetFor(body: string, terms: string[]): string {
  const flat = body.replace(/\s+/g, ' ').trim()
  if (!flat) return ''

  const lower = flat.toLowerCase()
  let at = -1
  for (const term of terms) {
    const found = lower.indexOf(term.toLowerCase())
    if (found >= 0 && (at < 0 || found < at)) at = found
  }

  const from = at < 0 ? 0 : Math.max(0, at - BEFORE)
  const to = Math.min(flat.length, from + BEFORE + AFTER)
  return (from > 0 ? '…' : '') + flat.slice(from, to) + (to < flat.length ? '…' : '')
}
