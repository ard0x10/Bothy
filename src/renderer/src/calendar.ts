import type { Card, Vault } from '../../shared/types'
import { matches, type Filter } from './filter'

// The calendar's arithmetic, kept away from the view so it can be measured
// without a screen. Everything here works in whole local days: a card carries a
// date, not a moment, and the grid is a grid of days.

const DAY = 86_400_000

// One square of the month grid.
export type Day = {
  // YYYY-MM-DD in local time. This is the id a drop target carries, so it has
  // to be the same string the spans are keyed by.
  key: string
  date: Date
  // Days from the neighbouring months fill the first and last week out. They
  // are drawn dimmer, but they take drops like any other day.
  inMonth: boolean
  today: boolean
}

export function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

// Local midnight, never UTC. `new Date('2026-09-12')` is midnight UTC, which is
// the day before anywhere west of Greenwich, and a calendar that draws a card
// on the wrong square is worse than no calendar at all.
//
// Two shapes arrive here. The panel writes YYYY-MM-DD, but a hand-written file
// can say `due: 2026-09-12` unquoted, which YAML reads as a date and the loader
// stringifies into a full local date string. Both are answered, and anything
// else is treated as no date rather than guessed at.
export function parseDay(value: string | undefined): Date | null {
  if (!value) return null
  const text = value.trim()
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
  if (iso) {
    const [, y, m, d] = iso
    const date = new Date(Number(y), Number(m) - 1, Number(d))
    // Rejects 2026-02-30 rather than letting it roll into March.
    if (date.getMonth() !== Number(m) - 1 || date.getDate() !== Number(d)) return null
    return date
  }
  const at = Date.parse(text)
  if (Number.isNaN(at)) return null
  const parsed = new Date(at)
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate())
}

export function addDays(key: string, by: number): string {
  const date = parseDay(key)
  if (!date) return key
  // Through the date parts rather than by milliseconds: a day is not always
  // 86400000 ms long, and adding one across a DST change would land at 23:00
  // the same day and lose the move.
  return dayKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + by))
}

// Whole days from a to b. Rounded because the two ends can sit either side of a
// DST change and be an hour apart from a whole number.
export function daysBetween(a: string, b: string): number {
  const from = parseDay(a)
  const to = parseDay(b)
  if (!from || !to) return 0
  return Math.round((to.getTime() - from.getTime()) / DAY)
}

// Which weekday a week starts on, as the user's own locale has it: Monday here,
// Sunday in the US. Asked of the platform rather than fixed, and falls back to
// Monday where the browser does not answer.
export function firstDayOfWeek(locale?: string): number {
  try {
    const info = (new Intl.Locale(locale ?? 'en-US') as unknown as { weekInfo?: { firstDay?: number } })
      .weekInfo
    const first = info?.firstDay
    // weekInfo counts Monday as 1 and Sunday as 7; Date counts Sunday as 0.
    if (typeof first === 'number' && first >= 1 && first <= 7) return first % 7
  } catch {
    // Older engines have no Intl.Locale at all.
  }
  return 1
}

// Six weeks, always. A month needs five or six depending on where it starts,
// and a grid that changes height as you page through it makes the whole view
// jump for a reason that has nothing to do with the work.
export function monthGrid(anchor: Date, today: Date, firstDay: number): Day[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const lead = (first.getDay() - firstDay + 7) % 7
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - lead)
  const todayKey = dayKey(today)

  const days: Day[] = []
  for (let i = 0; i < 42; i++) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    const key = dayKey(date)
    days.push({
      key,
      date,
      inMonth: date.getMonth() === anchor.getMonth() && date.getFullYear() === anchor.getFullYear(),
      today: key === todayKey
    })
  }
  return days
}

// A card on the calendar: which days it covers, and where it came from. The
// workspace travels with it because the calendar reaches across the whole
// vault, and a card with no home on screen is a card you cannot place.
export type Span = {
  card: Card
  workspacePath: string
  workspaceName: string
  // Both inclusive, both YYYY-MM-DD.
  from: string
  to: string
  // Which of the card's two dates the single-day span came from. The drag has
  // to write back to the field it read, or dragging a card that only has a
  // start date would silently give it a due date instead.
  field: 'start' | 'due' | 'both'
}

// Where one card sits, or null when it has no date at all. Cards without dates
// are not on the calendar: the step is "dated cards appear", and a vault-wide
// pool of everything undated would be a second kanban down the side.
export function spanOf(card: Card): { from: string; to: string; field: Span['field'] } | null {
  const start = parseDay(card.start)
  const due = parseDay(card.due)
  if (start && due) {
    // A card whose start is after its due date is a mistake on disk, not a
    // shape to draw. The due date wins - it is the day the card is about - and
    // the calendar leaves the file alone rather than tidying it.
    if (start.getTime() > due.getTime()) return { from: dayKey(due), to: dayKey(due), field: 'due' }
    return { from: dayKey(start), to: dayKey(due), field: 'both' }
  }
  if (due) return { from: dayKey(due), to: dayKey(due), field: 'due' }
  if (start) return { from: dayKey(start), to: dayKey(start), field: 'start' }
  return null
}

// Every dated card in the vault, narrowed the same way the kanban is. `only`
// limits it to a set of workspace paths; empty means all of them, which is the
// point of the view.
export function spansOf(vault: Vault | null, filter: Filter, only: readonly string[] = []): Span[] {
  const wanted = new Set(only)
  const out: Span[] = []
  for (const workspace of vault?.workspaces ?? []) {
    if (wanted.size > 0 && !wanted.has(workspace.path)) continue
    for (const card of workspace.cards) {
      // A card that did not parse has no dates worth trusting, and the kanban
      // already shows it as broken where it can be fixed.
      if (card.broken) continue
      if (card.archived && !filter.archived) continue
      if (!matches(card, filter)) continue
      const where = spanOf(card)
      if (!where) continue
      out.push({
        card,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        from: where.from,
        to: where.to,
        field: where.field
      })
    }
  }
  return out
}

// What a span dropped on the calendar writes back. `to` is its new first day
// and the length is kept, so a three-day card stays three days long. Which day
// that is the view decides: the card moves by as many days as the
// hand travelled, so it lands where the bar being carried is.
export function moved(span: Span, to: string): Partial<Card> {
  const length = daysBetween(span.from, span.to)
  if (span.field === 'both') return { start: to, due: addDays(to, length) }
  if (span.field === 'start') return { start: to }
  return { due: to }
}

// One row of the grid, and the bars laid across it. A bar is clipped to the
// week it is drawn in, so a card running from Friday to Tuesday is two bars -
// which is what a month grid can honestly show.
export type Bar = {
  span: Span
  // 0-6 within the week.
  from: number
  to: number
  // Whether the card carries on past this week's edge, so the bar can say so
  // rather than pretending it ends there.
  opensLeft: boolean
  opensRight: boolean
  lane: number
}

// Bars stacked so none overlaps another, in an order that does not change as
// cards are edited: longest first, then by start, then by id. Without the last
// two a card whose title changed would jump to another row.
export function placeWeek(week: Day[], spans: Span[]): Bar[] {
  const first = week[0]?.key
  const last = week[week.length - 1]?.key
  if (!first || !last) return []

  const touching = spans
    .filter((span) => daysBetween(span.from, last) >= 0 && daysBetween(first, span.to) >= 0)
    .sort((a, b) => {
      const lengthA = daysBetween(a.from, a.to)
      const lengthB = daysBetween(b.from, b.to)
      if (lengthA !== lengthB) return lengthB - lengthA
      const startA = daysBetween(first, a.from)
      const startB = daysBetween(first, b.from)
      if (startA !== startB) return startA - startB
      return a.card.id < b.card.id ? -1 : a.card.id > b.card.id ? 1 : 0
    })

  const lanes: number[][] = []
  const bars: Bar[] = []
  for (const span of touching) {
    const from = Math.max(0, daysBetween(first, span.from))
    const to = Math.min(6, daysBetween(first, span.to))
    let lane = 0
    for (;;) {
      const taken = lanes[lane] ?? []
      if (!taken.some((day) => day >= from && day <= to)) {
        lanes[lane] = taken
        for (let day = from; day <= to; day++) taken.push(day)
        break
      }
      lane++
    }
    bars.push({
      span,
      from,
      to,
      opensLeft: daysBetween(span.from, first) > 0,
      opensRight: daysBetween(last, span.to) > 0,
      lane
    })
  }
  return bars
}

export function weeksOf(grid: Day[]): Day[][] {
  const weeks: Day[][] = []
  for (let i = 0; i < grid.length; i += 7) weeks.push(grid.slice(i, i + 7))
  return weeks
}
