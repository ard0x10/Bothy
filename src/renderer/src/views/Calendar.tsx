import { useMemo, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import { Icon } from './Icon'
import {
  addDays,
  daysBetween,
  firstDayOfWeek,
  monthGrid,
  moved,
  placeWeek,
  spansOf,
  weeksOf,
  type Bar,
  type Day,
  type Span
} from '../calendar'
import { dueState } from '../dates'
import { coverColor } from '../../../shared/cover'
import { useVault } from '../store'
import { FilterBar, FilterToggle } from './FilterBar'

// The third view, and the only one that is not about a single workspace: we
// decided the calendar is global, because work divides into folders but a day
// does not. Which workspace is selected in the sidebar changes nothing here.

const DAY_PREFIX = 'day:'
const SPAN_PREFIX = 'span:'

const spanId = (span: Span): string => `${SPAN_PREFIX}${span.workspacePath} ${span.card.id}`

function monthName(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

// Weekday headings taken from the same locale that decided which day the week
// starts on, so the two cannot disagree.
function weekdayNames(firstDay: number): string[] {
  const names: string[] = []
  // 2024-01-07 was a Sunday, so adding a weekday number to it lands on that
  // weekday without any calendar arithmetic of our own.
  for (let i = 0; i < 7; i++) {
    const date = new Date(2024, 0, 7 + ((firstDay + i) % 7))
    names.push(date.toLocaleDateString(undefined, { weekday: 'short' }))
  }
  return names
}

// The rows of one week: the day numbers, a row for each lane of bars, and
// whatever height is left. Written out because a day spans `1 / -1`, and -1 is
// the last line of the rows a template names. Left to grid-auto-rows there were
// none, -1 was the first line, and every day was the top 20px of its week: its
// edge, its shading and the place a card lands all stopped there, and the rest
// of the week read as one box the days ran into.
function weekRows(lanes: number): string {
  return ['24px', ...Array.from({ length: lanes }, () => '20px'), 'minmax(8px, 1fr)'].join(' ')
}

// The day under a point, read off the grid rather than worked out from a bar: a
// bar that crosses a week is two shapes, and only the one under the hand knows
// which day the hand is on.
function dayAt(x: number, y: number): string | null {
  for (const node of document.elementsFromPoint(x, y)) {
    const day = node.closest<HTMLElement>('.calendar-day')
    if (day?.dataset.day) return day.dataset.day
  }
  return null
}

// Its column is written out as well. A day spans every row, so a column that
// holds a bar in any lane is taken as far as placement goes, and a day left to
// find its own walked past those into columns the grid made up beyond the
// seventh. The bars are drawn over the days on purpose, which only an explicit
// column allows.
function DayCell({ day, column }: { day: Day; column: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: `${DAY_PREFIX}${day.key}` })
  const classes = ['calendar-day']
  if (!day.inMonth) classes.push('is-outside')
  if (day.today) classes.push('is-today')
  if (isOver) classes.push('is-over')

  return (
    <div
      ref={setNodeRef}
      className={classes.join(' ')}
      data-day={day.key}
      style={{ gridColumn: column }}
    >
      <span className="calendar-daynum">{day.date.getDate()}</span>
    </div>
  )
}

function BarItem({ bar, many }: { bar: Bar; many: boolean }) {
  const openCardAt = useVault((state) => state.openCardAt)
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: spanId(bar.span) })

  const classes = ['calendar-bar', `is-${dueState(bar.span.card.due)}`]
  if (bar.opensLeft) classes.push('opens-left')
  if (bar.opensRight) classes.push('opens-right')
  if (isDragging) classes.push('is-dragging')
  if (bar.span.card.archived) classes.push('is-archived')

  return (
    <button
      ref={setNodeRef}
      className={classes.join(' ')}
      style={{ gridColumn: `${bar.from + 1} / ${bar.to + 2}`, gridRow: bar.lane + 2 }}
      title={`${bar.span.card.title} - ${bar.span.workspaceName}`}
      onClick={() => void openCardAt(bar.span.workspacePath, bar.span.card.id)}
      {...listeners}
      {...attributes}
    >
      {/* The colour cover only. A picture has no room on a 20px bar, and its
          file name painted as a background is nothing at all. */}
      {coverColor(bar.span.card) && (
        <span className="calendar-bar-cover" style={{ background: coverColor(bar.span.card) }} />
      )}
      <span className="calendar-bar-title">{bar.span.card.title}</span>
      {many && <span className="calendar-bar-where">{bar.span.workspaceName}</span>}
    </button>
  )
}

export function Calendar() {
  const vault = useVault((state) => state.vault)
  const filter = useVault((state) => state.filter)
  const only = useVault((state) => state.calendarWorkspaces)
  const setCardDates = useVault((state) => state.setCardDates)

  // Which month is on screen. Local to the view on purpose: like the filter, it
  // is a place you are looking rather than a thing about the work, and nothing
  // about it is written down.
  const [anchor, setAnchor] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  // The bar in the hand, and the day the hand took hold of it on.
  const [dragging, setDragging] = useState<{ span: Span; held: string } | null>(null)

  const sensors = useSensors(
    // A few pixels of travel before a drag starts, so a click stays a click and
    // opens the card. Same number as the kanban.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  )

  const firstDay = useMemo(() => firstDayOfWeek(navigator.language), [])
  const today = new Date()
  const grid = useMemo(() => monthGrid(anchor, today, firstDay), [anchor, firstDay, today.getDate()])
  const weeks = useMemo(() => weeksOf(grid), [grid])

  const workspaces = vault?.workspaces ?? []
  const spans = useMemo(() => spansOf(vault, filter, only), [vault, filter, only])
  // What is being held back, counted against an unnarrowed calendar: every
  // dated card in the vault, minus the ones that got through. The archive
  // checkbox is carried over rather than forced on, because archived cards are
  // not what the number is about - the kanban made that distinction in step 4
  // and counting them here would put a permanent figure on the bar.
  const all = useMemo(
    () => spansOf(vault, { tags: [], due: [], priority: [], archived: filter.archived }, []),
    [vault, filter.archived]
  )
  const hidden = all.length - spans.length

  const names = useMemo(() => weekdayNames(firstDay), [firstDay])
  const many = only.length !== 1 && workspaces.length > 1

  const onDragStart = (event: DragStartEvent): void => {
    const id = String(event.active.id)
    const span = spans.find((one) => spanId(one) === id)
    if (!span) return setDragging(null)
    // Where the press was, not where the drag began: the bar has not moved yet
    // at the press, so the day under it is the day that was taken hold of.
    const press = event.activatorEvent as PointerEvent | null
    const held = press ? dayAt(press.clientX, press.clientY) : null
    setDragging({ span, held: held ?? span.from })
  }

  // The card lands where the bar in the hand is: it moves by as many days as
  // the hand did, from the day it took hold of to the day it lets go over. We
  // chose that over "the day let go on is the first day", which moved a
  // card picked up by its middle and put back where it was.
  const onDragEnd = (event: DragEndEvent): void => {
    const held = dragging
    setDragging(null)
    const over = event.over ? String(event.over.id) : ''
    if (!held || !over.startsWith(DAY_PREFIX)) return
    const by = daysBetween(held.held, over.slice(DAY_PREFIX.length))
    if (by === 0) return
    void setCardDates(
      held.span.workspacePath,
      held.span.card.id,
      moved(held.span, addDays(held.span.from, by))
    )
  }

  const shift = (by: number): void =>
    setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + by, 1))

  return (
    <section className="calendar">
      {/* The kanban's head: one line, the name in the middle. What moves the
          month stands before the name, so a longer month does not push it. */}
      <header className="calendar-head">
        <div className="calendar-title">
          <div className="calendar-steps">
            <button
              className="calendar-today"
              onClick={() => setAnchor(new Date(today.getFullYear(), today.getMonth(), 1))}
            >
              Today
            </button>
            <button
              className="calendar-step"
              onClick={() => shift(-1)}
              title="Previous month"
              aria-label="Previous month"
            >
              <Icon name="chevron-left" />
            </button>
            <button
              className="calendar-step"
              onClick={() => shift(1)}
              title="Next month"
              aria-label="Next month"
            >
              <Icon name="chevron-right" />
            </button>
          </div>
          <h2 className="calendar-month">{monthName(anchor)}</h2>
          <div className="calendar-tools">
            <span className="calendar-count">
              {spans.length === 1 ? '1 dated card' : `${spans.length} dated cards`}
            </span>
            <FilterToggle scope />
          </div>
        </div>
        <FilterBar workspaces={workspaces} hidden={hidden} scope />
      </header>

      {/* The day under the hand, rather than the one the bar in it covers
          most: with days the whole height of their week a bar is always over
          some, and the most-covered day of a three-day bar is its middle. */}
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <div className="calendar-grid">
          <div className="calendar-names">
            {names.map((name) => (
              <span key={name} className="calendar-name">
                {name}
              </span>
            ))}
          </div>

          {weeks.map((week) => {
            const bars = placeWeek(week, spans)
            const lanes = bars.reduce((most, bar) => Math.max(most, bar.lane + 1), 0)
            return (
              <div
                key={week[0].key}
                className="calendar-week"
                style={{ gridTemplateRows: weekRows(lanes) }}
              >
                {week.map((day, i) => (
                  <DayCell key={day.key} day={day} column={i + 1} />
                ))}
                {bars.map((bar) => (
                  <BarItem key={spanId(bar.span)} bar={bar} many={many} />
                ))}
              </div>
            )
          })}
        </div>

        <DragOverlay dropAnimation={null}>
          {dragging ? (
            <div className="calendar-bar is-overlay">
              <span className="calendar-bar-title">{dragging.span.card.title}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </section>
  )
}
