import type { Column } from '../../shared/types'

export const COLUMN_PREFIX = 'column:'

// A column on the move, taken hold of by its head. It has its own prefix, apart
// from the one above: that one names the empty space inside a column a card is
// dropped into, this one names the column itself, and a drag of one kind may
// only land on its own kind.
export const LANE_PREFIX = 'lane:'

export const isLane = (id: string): boolean => id.startsWith(LANE_PREFIX)

export type DropTarget = { columnId: string; overCardId: string | null }

export function columnOf(columns: Column[], cardId: string): Column | undefined {
  return columns.find((column) => column.cards.includes(cardId))
}

// What the pointer is over: either a card, or the empty space of a column.
export function readTarget(columns: Column[], overId: string): DropTarget | null {
  if (overId.startsWith(COLUMN_PREFIX)) {
    const columnId = overId.slice(COLUMN_PREFIX.length)
    return columns.some((column) => column.id === columnId) ? { columnId, overCardId: null } : null
  }
  const column = columnOf(columns, overId)
  return column ? { columnId: column.id, overCardId: overId } : null
}

function reorder<T>(list: T[], from: number, to: number): T[] {
  const next = [...list]
  next.splice(to, 0, ...next.splice(from, 1))
  return next
}

export function moveCard(columns: Column[], cardId: string, target: DropTarget): Column[] {
  if (target.overCardId === cardId) return columns

  const source = columnOf(columns, cardId)
  if (!source) return columns

  // Inside one column the card slides to the slot it was dropped on, counting
  // positions as they looked before the drag. That is what the list animates
  // during the drag, and the saved order has to agree with it.
  if (source.id === target.columnId) {
    const from = source.cards.indexOf(cardId)
    const over = target.overCardId ? source.cards.indexOf(target.overCardId) : -1
    const to = over === -1 ? source.cards.length - 1 : over
    if (from === to) return columns
    return columns.map((column) =>
      column.id === source.id ? { ...column, cards: reorder(column.cards, from, to) } : column
    )
  }

  // Across columns the card leaves one list and lands in front of whatever it
  // was dropped on, or at the end when it was dropped on empty space.
  return columns.map((column) => {
    if (column.id === source.id) {
      return { ...column, cards: column.cards.filter((id) => id !== cardId) }
    }
    if (column.id !== target.columnId) return column
    const at = target.overCardId ? column.cards.indexOf(target.overCardId) : -1
    const cards = [...column.cards]
    cards.splice(at === -1 ? cards.length : at, 0, cardId)
    return { ...column, cards }
  })
}

// A column takes the slot of the one it was let go over, counting slots as they
// stood before the drag. The same splice a card makes inside one column, for
// the same reason: it is what the row animates while the column is held.
export function placeColumn(columns: Column[], columnId: string, overId: string): Column[] {
  const from = columns.findIndex((column) => column.id === columnId)
  const to = columns.findIndex((column) => column.id === overId)
  if (from === -1 || to === -1 || from === to) return columns
  return reorder(columns, from, to)
}

export function sameOrder(a: Column[], b: Column[]): boolean {
  if (a.length !== b.length) return false
  return a.every((column, i) => {
    const other = b[i]
    return (
      column.id === other.id &&
      column.cards.length === other.cards.length &&
      column.cards.every((id, j) => id === other.cards[j])
    )
  })
}
