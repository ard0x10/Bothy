import type { Card, Workspace } from '../../shared/types'
import { dueState, type DueState } from './dates'

// What the kanban is narrowed to. Step 4 of v0.2, and we decided the one
// question it had: this dies with the window. Nothing about it is written to
// workspace.json, and the format does not change.
//
// The reason is the difference between a tab and a filter. A tab is a place, so
// coming back to where you were is a kindness. A filter is a subtraction, and a
// subtraction restored a week later is a kanban full of gaps with nothing to
// tell it apart from cards that are actually gone - which, in an app whose one
// promise is that nothing is lost, is the worst thing it could suggest. The
// price is honest: the filter is set again each time it is wanted.
export type Filter = {
  tags: string[]
  due: DueState[]
  priority: string[]
  // Widening rather than narrowing: archived cards are off the kanban by
  // default, and this is the checkbox that brings them back. Parked in step 1
  // and it lands here, on by nobody.
  archived: boolean
}

export const NO_FILTER: Filter = { tags: [], due: [], priority: [], archived: false }

// Anything at all set. What the bar uses to decide it may not be put away: a
// filter nobody can see is indistinguishable from cards that went missing.
export function isOn(filter: Filter): boolean {
  return (
    filter.tags.length > 0 ||
    filter.due.length > 0 ||
    filter.priority.length > 0 ||
    filter.archived
  )
}

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

// Within a group, any. Across groups, all. Two things picked out of one group
// is somebody widening ("urgent OR budget"); two things picked out of different
// groups is somebody narrowing ("urgent AND late"), and reading it the other
// way would make the second click empty the screen.
export function matches(card: Card, filter: Filter): boolean {
  if (filter.tags.length > 0) {
    if (!filter.tags.some((want) => card.tags.some((tag) => same(tag, want)))) return false
  }
  if (filter.due.length > 0 && !filter.due.includes(dueState(card.due))) return false
  if (filter.priority.length > 0) {
    const own = card.priority ?? ''
    if (!filter.priority.some((want) => same(want, own))) return false
  }
  return true
}

// Why a card is not drawn, for every card that is not. Archived and filtered
// out are two reasons for the same thing and they are answered in one pass, so
// the list, the column count and the bar cannot drift apart the way two copies
// of a rule always eventually do.
//
// The reason is kept rather than thrown away because the two are not the same
// news. Archiving is a deliberate thing done to one card and it has a screen of
// its own; counting it in "3 hidden" would put a permanent line on every column
// that ever had a card archived out of it, and would quietly change what step 1
// settled. The line and the count are about the filter.
export type Hidden = ReadonlyMap<string, 'archived' | 'filtered'>

export function hiddenIds(cards: Card[], filter: Filter): Hidden {
  const out = new Map<string, 'archived' | 'filtered'>()
  for (const card of cards) {
    if (card.archived && !filter.archived) out.set(card.id, 'archived')
    else if (!matches(card, filter)) out.set(card.id, 'filtered')
  }
  return out
}

// How many of one column's cards the filter is holding back. Archived ones are
// not counted: they were put away one at a time, on purpose, and saying so on
// every column for ever would be noise rather than news.
export function filteredOut(cardIds: readonly string[], hidden: Hidden): number {
  let n = 0
  for (const id of cardIds) if (hidden.get(id) === 'filtered') n++
  return n
}

// What the bar can offer, taken from the workspaces rather than made up: the
// labels they define plus whatever the cards carry that they have not heard of,
// the same rule the card panel's tag picker follows. A value nothing carries is
// a row that can only ever empty the screen.
//
// A list rather than one workspace since step 7. The kanban passes the one it
// is showing; the calendar spans the whole vault, and offering it only the
// selected folder's labels would hide every tag the other folders use behind a
// bar that looked complete.
export function tagChoices(workspaces: Workspace[]): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  const add = (name: string): void => {
    if (seen.has(name.toLowerCase())) return
    seen.add(name.toLowerCase())
    names.push(name)
  }
  // A colour is offered by its own word, which is what a card carries,
  // and only when a workspace has said something about it, since the six exist
  // everywhere and six rows nothing wears would be six ways to empty the board.
  // A colour in use arrives anyway, off the cards below.
  for (const workspace of workspaces) {
    for (const label of workspace.labels) add(label.key ?? label.name)
  }
  for (const workspace of workspaces) for (const card of workspace.cards) card.tags.forEach(add)
  return names
}

// Priority is a field the app owns, keeps and until step 4 never showed. There
// is no fixed set of values on disk, so the choices are the ones actually in
// use, in the order they are first met.
export function priorityChoices(workspaces: Workspace[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const workspace of workspaces) {
    for (const card of workspace.cards) {
      const own = card.priority
      if (!own || seen.has(own.toLowerCase())) continue
      seen.add(own.toLowerCase())
      out.push(own)
    }
  }
  return out
}

// Fixed, unlike the two above: these are the five answers dueState can give,
// and they are worth offering whether or not a card is currently in each.
export const DUE_CHOICES: { id: DueState; label: string }[] = [
  { id: 'late', label: 'Late' },
  { id: 'today', label: 'Today' },
  { id: 'soon', label: 'Soon' },
  { id: 'later', label: 'Later' },
  { id: 'none', label: 'No date' }
]

export function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]
}
