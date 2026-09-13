import type { Card, Column } from '../../shared/types'

// An archived card is not moved and not unlisted. It stays in kanban/cards/ and
// stays in its column in columns.json, and only leaves the screen - which is
// what lets it come back exactly where it was instead of wherever a rebuild
// would have guessed. Everything that decides whether a card is drawn goes
// through here, so the list, the column count and the search grouping cannot
// drift apart the way two copies of a rule always eventually do.

// Called drawn rather than onBoard, and not because the word is banned - it is
// not, as long as nothing could read it as the canvas. It is because the name
// is more accurate here: this answers what a column renders, and a card can now
// fail to be rendered for two different reasons. The set it is given is every
// one of them, archived and filtered out, worked out in one place by hiddenIds
// so nothing has to ask twice and get two answers.
export function drawn(column: Column, hidden: { has: (id: string) => boolean }): string[] {
  return column.cards.filter((id) => !hidden.has(id))
}

// In the order the columns put them, not the order the folder was read in, so
// the archive reads like the board it came off.
export function archivedInOrder(columns: Column[], cards: Card[]): Card[] {
  const byId = new Map(cards.map((card) => [card.id, card]))
  const seen = new Set<string>()
  const out: Card[] = []
  for (const column of columns) {
    for (const id of column.cards) {
      const card = byId.get(id)
      if (card?.archived && !seen.has(id)) {
        seen.add(id)
        out.push(card)
      }
    }
  }
  // A card no column lists cannot happen while the vault reader is putting
  // orphans back, but the archive is the one screen where a card going missing
  // would look like data loss, so it is swept up rather than trusted away.
  for (const card of cards) if (card.archived && !seen.has(card.id)) out.push(card)
  return out
}

export function columnTitleOf(columns: Column[], cardId: string): string {
  return columns.find((column) => column.cards.includes(cardId))?.title ?? ''
}
