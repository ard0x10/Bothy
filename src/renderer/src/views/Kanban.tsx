import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DraggableSyntheticListeners,
  type UniqueIdentifier
} from '@dnd-kit/core'
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Column, Template, Workspace } from '../../../shared/types'
import {
  COLOR_PRESETS,
  GRADIENT_PRESETS,
  backgroundCss,
  sameBackground,
  type Background
} from '../../../shared/background'
import { useVault, useWorkspace } from '../store'
import {
  COLUMN_PREFIX,
  LANE_PREFIX,
  columnOf,
  isLane,
  moveCard,
  placeColumn,
  readTarget,
  sameOrder
} from '../dnd'
import { drawn } from '../archive'
import { filteredOut, hiddenIds, type Hidden } from '../filter'
import { FilterBar, FilterToggle } from './FilterBar'
import { CardTile } from './CardTile'
import { NameBox } from './NameBox'
import { SortableCard } from './SortableCard'
import { Icon } from './Icon'
import { useMenu } from './useMenu'

function ColumnBody({
  column,
  workspace,
  hidden
}: {
  column: Column
  workspace: Workspace
  hidden: Hidden
}) {
  // The list needs its own drop area or an empty column has nothing to aim at.
  const { setNodeRef, isOver } = useDroppable({ id: `${COLUMN_PREFIX}${column.id}` })
  const openId = useVault((state) => state.openId)
  const openCard = useVault((state) => state.openCard)
  const byId = new Map(workspace.cards.map((card) => [card.id, card]))
  // Hidden ids stay in column.cards and only leave this list, whether they are
  // hidden for being archived or for not matching the filter. Dropping is
  // resolved by the id of the card underneath, and moveCard indexes the full
  // array, so hiding rows here shifts nothing.
  const shown = drawn(column, hidden)
  const away = filteredOut(column.cards, hidden)

  return (
    <div ref={setNodeRef} className={isOver ? 'column-cards is-over' : 'column-cards'}>
      <SortableContext items={shown} strategy={verticalListSortingStrategy}>
        {shown.map((id) => {
          const card = byId.get(id)
          return card ? (
            <SortableCard
              key={id}
              card={card}
              workspace={workspace}
              open={id === openId}
              onOpen={() => openCard(id)}
            />
          ) : null
        })}
      </SortableContext>
      {away > 0 && (
        <p className="column-hidden">
          {shown.length === 0
            ? `${away} card${away === 1 ? '' : 's'} here, all hidden`
            : `${away} more hidden`}
        </p>
      )}
    </div>
  )
}

// Where a column is taken hold of. Handed down by the column that owns the
// drag, and put on the head only while it is a head: a head that has turned
// into a rename box or a question is not something to carry off.
type Grip = {
  ref: (node: HTMLElement | null) => void
  listeners: DraggableSyntheticListeners
}

// Deleting a column deletes nothing: the cards are files, and they join the
// first column that is left. So it asks once, to say where they are going,
// rather than warning about a loss that is not happening.
function ColumnHead({
  column,
  count,
  first,
  last,
  grip,
  onRefused
}: {
  grip: Grip
  column: Column
  // How many of this column's cards are on the board. Not the same number as
  // column.cards.length once anything is archived, and deliberately so: the
  // badge counts what is on screen, while the delete prompt below counts every
  // file that would move, archived ones included. They measure different things.
  count: number
  first: boolean
  last: boolean
  onRefused: (why: string | null) => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const over = column.wipLimit !== undefined && count > column.wipLimit

  if (renaming) {
    return (
      <header className="column-head">
        <NameBox
          className="column-rename"
          placeholder="Column title"
          initial={column.title}
          onCommit={(title) => void useVault.getState().renameColumn(column.id, title)}
          onCancel={() => setRenaming(false)}
        />
      </header>
    )
  }

  if (confirming) {
    return (
      <header className="column-head is-asking">
        <span className="column-ask">
          {column.cards.length > 0
            ? `Delete, and move ${column.cards.length} card(s) left?`
            : 'Delete this column?'}
        </span>
        <button
          className="column-confirm-yes"
          onClick={() => {
            setConfirming(false)
            void useVault
              .getState()
              .removeColumn(column.id)
              .then(onRefused)
          }}
        >
          Yes
        </button>
        <button className="column-act" onClick={() => setConfirming(false)}>
          No
        </button>
      </header>
    )
  }

  return (
    <header
      ref={grip.ref}
      className="column-head"
      onPointerDown={(event) => {
        // Its buttons stay buttons. A press on one that wanders a few pixels
        // on the way to the click is still that button, not a column leaving.
        // The menu's box too, which is not a button between its rows.
        if ((event.target as Element).closest('button, .column-menu')) return
        grip.listeners?.onPointerDown?.(event)
      }}
    >
      {/* One click on the name opens it for renaming, where it took
          two. A press that travels is the grip's instead: the sensor wants 4
          pixels before a column leaves, and a click is a press that did not. */}
      <h2 onClick={() => setRenaming(true)}>{column.title}</h2>
      <span className={over ? 'count is-over-limit' : 'count'}>
        {count}
        {column.wipLimit ? ` / ${column.wipLimit}` : ''}
      </span>
      <ColumnMenu
        first={first}
        last={last}
        onRename={() => setRenaming(true)}
        onMove={(by) => void useVault.getState().moveColumn(column.id, by)}
        onDelete={() => {
          onRefused(null)
          setConfirming(true)
        }}
      />
    </header>
  )
}

// What used to be four marks along the head, there only while the column was
// hovered: rename, move left, move right, delete. One ⋯ at the right
// end of the head, with the card count just before it. The rows carry the
// titles the marks did.
function ColumnMenu({
  first,
  last,
  onRename,
  onMove,
  onDelete
}: {
  first: boolean
  last: boolean
  onRename: () => void
  onMove: (by: -1 | 1) => void
  onDelete: () => void
}) {
  const { open, setOpen, box } = useMenu()
  const act = (run: () => void): void => {
    setOpen(false)
    run()
  }

  return (
    <div className="column-menu-anchor" ref={box}>
      <button
        className="column-menu-button"
        title="Column actions"
        aria-label="Column actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name="more" />
      </button>

      {open && (
        <div className="column-menu" role="menu">
          <button
            className="column-menu-item"
            role="menuitem"
            title="Rename column"
            onClick={() => act(onRename)}
          >
            <Icon name="pencil" />
            Rename
          </button>
          <button
            className="column-menu-item"
            role="menuitem"
            title="Move column left"
            disabled={first}
            onClick={() => act(() => onMove(-1))}
          >
            <Icon name="arrow-left" />
            Move left
          </button>
          <button
            className="column-menu-item"
            role="menuitem"
            title="Move column right"
            disabled={last}
            onClick={() => act(() => onMove(1))}
          >
            <Icon name="arrow-right" />
            Move right
          </button>
          <button
            className="column-menu-item"
            role="menuitem"
            title="Delete column"
            onClick={() => act(onDelete)}
          >
            <Icon name="trash" />
            Delete
          </button>
        </div>
      )}
    </div>
  )
}

// What the workspace has in templates/, offered above the button that opened
// it. A template that is gone by the time it is clicked is answered by main,
// not guessed at here.
function TemplateMenu({
  templates,
  onPick,
  onClose
}: {
  templates: Template[]
  onPick: (template: Template) => void
  onClose: () => void
}) {
  const box = useRef<HTMLDivElement | null>(null)

  // A menu that can only be dismissed by choosing something is a trap. Escape
  // is stopped here rather than left to the window, which would read it as
  // "close the card" and take the panel behind this down instead.
  useEffect(() => {
    const away = (event: PointerEvent): void => {
      if (!box.current?.contains(event.target as Node)) onClose()
    }
    const key = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('pointerdown', away, true)
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('pointerdown', away, true)
      document.removeEventListener('keydown', key, true)
    }
  }, [onClose])

  return (
    <div className="template-menu" ref={box}>
      {templates.length === 0 ? (
        // The button is not hidden when there are none, because a button that
        // appears once you already know about the feature is a feature nobody
        // finds. So the empty menu is where the answer lives.
        <p className="template-empty">
          No templates yet. Open a card and choose Save as template from its menu.
        </p>
      ) : (
        templates.map((template) => (
          <button
            key={template.file}
            className="template-pick"
            title={template.file}
            onClick={() => onPick(template)}
          >
            {template.name}
          </button>
        ))
      )}
    </div>
  )
}

// Naming the card up front is what gives the file on disk a readable name. The
// name is chosen once here and never changes again, since renaming the file on
// every title edit would break whatever else points at it.
//
// Step 5 puts a second door beside the first rather than in front of it: the
// plain button still makes a plain card, and the one next to it makes one from
// a template. A template still has to arrive at the naming box, because the
// file name comes from the title and there is only one moment to choose it.
function AddCard({ columnId, templates }: { columnId: string; templates: Template[] }) {
  const addCard = useVault((state) => state.addCard)
  const composingIn = useVault((state) => state.composingIn)
  const composeIn = useVault((state) => state.composeIn)
  const [typing, setTyping] = useState(false)
  const [menu, setMenu] = useState(false)
  // Which template the box being typed in is for, and null for a plain card.
  const [from, setFrom] = useState<Template | null>(null)

  // The "New card in …" command cannot name the card, so it points at a column
  // and the box here opens itself. Same state the button sets by hand.
  useEffect(() => {
    if (composingIn !== columnId) return
    composeIn(null)
    setFrom(null)
    setTyping(true)
  }, [composingIn, columnId, composeIn])

  if (typing) {
    return (
      <NameBox
        className="add-card-input"
        placeholder="Card title"
        // A card from a template arrives with the template's name already in
        // the box, selected, so Enter takes it and typing replaces it. It has
        // to be a real name rather than a placeholder: the file name comes from
        // the title, and an empty box has nothing to make one out of.
        initial={from?.name ?? ''}
        commitUnchanged
        // A plain card leaves the box open for the next one, the fast way in:
        // type, Enter, type, Enter, and a column is filled without the
        // hand leaving the keyboard. A card from a template does not, because
        // the box arrives with the template's name already in it and a loop
        // there would ask for that same name again and again.
        keepOpen={from === null}
        onCommit={(name) => void addCard(columnId, name, from?.file ?? null)}
        onCancel={() => {
          setTyping(false)
          setFrom(null)
        }}
      />
    )
  }

  return (
    <div className="add-card-row">
      <button className="add-card" onClick={() => setTyping(true)}>
        <Icon name="plus" />
        Add card
      </button>
      <button
        className="add-card-template"
        title="New from template…"
        aria-label="New from template"
        onClick={() => setMenu((open) => !open)}
      >
        <Icon name="template" />
      </button>
      {menu && (
        <TemplateMenu
          templates={templates}
          onClose={() => setMenu(false)}
          onPick={(template) => {
            setMenu(false)
            setFrom(template)
            setTyping(true)
          }}
        />
      )}
    </div>
  )
}

function AddColumn() {
  const composing = useVault((state) => state.composingColumn)
  const composeColumn = useVault((state) => state.composeColumn)
  const addColumn = useVault((state) => state.addColumn)

  if (composing) {
    return (
      <div className="add-column">
        <NameBox
          className="add-column-input"
          placeholder="Column title"
          onCommit={(title) => void addColumn(title)}
          onCancel={() => composeColumn(false)}
        />
      </div>
    )
  }

  return (
    <button className="add-column" onClick={() => composeColumn(true)}>
      <Icon name="plus" />
      Add column
    </button>
  )
}

// The ⋯ at the end of the board's title, the door that was decided on: everything
// about how this one workspace's board looks goes through here, and its ground
// is the first thing in it. The picker opens inside the same box, with ← back
// to the menu, because a side panel would have to share its place with the
// card panel.
//
// Two more rows sit under it, both asked for: the workspace into the
// Bookmarks section and out of it, and the board out as a PNG. The export
// opens a second page like the picker does, because it asks one question
// before it can do anything - whether the ground goes with the picture.
function BoardMenu({
  background,
  path,
  bookmarked
}: {
  background: Background | undefined
  path: string
  bookmarked: boolean
}) {
  const setBackground = useVault((state) => state.setBackground)
  const setBookmark = useVault((state) => state.setBookmark)
  const exportKanban = useVault((state) => state.exportKanban)
  // The same three ways out as the card's and the column's menus.
  const { open, setOpen, box } = useMenu()
  const [page, setPage] = useState<'menu' | 'background' | 'export'>('menu')

  // The menu is put away first and the board copied after: the copy leaves the
  // head's buttons out, the menu with them, but a picture taken while the menu
  // was still being drawn is not one anybody would expect.
  const exportAs = (ground: boolean): void => {
    const board = box.current?.closest<HTMLElement>('.kanban')
    setOpen(false)
    if (board) void exportKanban(board, ground)
  }

  const pick = (next: Background | null): void => void setBackground(next)
  const chosen = (value: Background): boolean => sameBackground(background, value)

  // What the wells of one's own start from: the board's own values when it is
  // that kind, the first preset otherwise, since a colour well has to be
  // showing some colour.
  const own = background?.type === 'color' ? background.color : COLOR_PRESETS[0]
  const [from, to]: readonly [string, string] =
    background?.type === 'gradient' ? [background.from, background.to] : GRADIENT_PRESETS[0]
  const ownColour =
    background?.type === 'color' && !COLOR_PRESETS.some((color) => chosen({ type: 'color', color }))
  const ownGradient =
    background?.type === 'gradient' &&
    !GRADIENT_PRESETS.some(([a, b]) => chosen({ type: 'gradient', from: a, to: b }))

  const swatch = (value: Background, label: string) => {
    const on = chosen(value)
    return (
      <button
        key={label}
        className={on ? 'background-swatch is-on' : 'background-swatch'}
        role="menuitemradio"
        aria-checked={on}
        title={label}
        style={{ background: backgroundCss(value) }}
        onClick={() => pick(value)}
      />
    )
  }

  return (
    <div className="board-menu-anchor" ref={box}>
      <button
        className="board-menu-button"
        title="Board options"
        aria-label="Board options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setPage('menu')
          setOpen(!open)
        }}
      >
        <Icon name="more" />
      </button>

      {open && (
        <div className="board-menu" role="menu">
          {page === 'menu' ? (
            <>
              <button
                className="board-menu-item"
                role="menuitem"
                onClick={() => setPage('background')}
              >
                Change background…
              </button>
              <button
                className="board-menu-item"
                role="menuitem"
                data-act="bookmark"
                onClick={() => {
                  setOpen(false)
                  void setBookmark(path, !bookmarked)
                }}
              >
                {bookmarked ? 'Remove from bookmarks' : 'Add to bookmarks'}
              </button>
              <button
                className="board-menu-item"
                role="menuitem"
                data-act="export"
                onClick={() => setPage('export')}
              >
                Export as PNG…
              </button>
            </>
          ) : page === 'export' ? (
            <>
              <div className="board-menu-top">
                <button
                  className="board-back"
                  title="Back"
                  aria-label="Back"
                  onClick={() => setPage('menu')}
                >
                  <Icon name="arrow-left" />
                </button>
                <span className="board-menu-title">Export as PNG</span>
              </div>
              <button
                className="board-menu-item"
                role="menuitem"
                data-ground="clear"
                onClick={() => exportAs(false)}
              >
                Transparent background
              </button>
              <button
                className="board-menu-item"
                role="menuitem"
                data-ground="on"
                onClick={() => exportAs(true)}
              >
                With background
              </button>
            </>
          ) : (
            <>
              <div className="board-menu-top">
                <button
                  className="board-back"
                  title="Back"
                  aria-label="Back"
                  onClick={() => setPage('menu')}
                >
                  <Icon name="arrow-left" />
                </button>
                <span className="board-menu-title">Background</span>
              </div>

              <button
                className="background-none"
                role="menuitemradio"
                aria-checked={!background}
                onClick={() => pick(null)}
              >
                <span className="board-menu-tick">
                  {background ? null : <Icon name="check" />}
                </span>
                None
              </button>

              <p className="board-menu-group">Colour</p>
              <div className="background-swatches">
                {COLOR_PRESETS.map((color) => swatch({ type: 'color', color }, color))}
                <input
                  className={
                    ownColour
                      ? 'background-own background-custom-color is-on'
                      : 'background-own background-custom-color'
                  }
                  type="color"
                  value={own}
                  title="A colour of your own"
                  aria-label="A colour of your own"
                  onChange={(event) => pick({ type: 'color', color: event.target.value })}
                />
              </div>

              <p className="board-menu-group">Gradient</p>
              <div className="background-swatches">
                {GRADIENT_PRESETS.map(([a, b]) =>
                  swatch({ type: 'gradient', from: a, to: b }, `${a} → ${b}`)
                )}
              </div>
              <div className="background-custom-gradient">
                <input
                  className={
                    ownGradient
                      ? 'background-own background-custom-from is-on'
                      : 'background-own background-custom-from'
                  }
                  type="color"
                  value={from}
                  title="Gradient from"
                  aria-label="Gradient from"
                  onChange={(event) => pick({ type: 'gradient', from: event.target.value, to })}
                />
                <Icon name="arrow-right" />
                <input
                  className={
                    ownGradient
                      ? 'background-own background-custom-to is-on'
                      : 'background-own background-custom-to'
                  }
                  type="color"
                  value={to}
                  title="Gradient to"
                  aria-label="Gradient to"
                  onChange={(event) => pick({ type: 'gradient', from, to: event.target.value })}
                />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// A column is taken hold of by its head, the way a card is taken hold of by any
// part of itself. Only by the head: everything below it belongs to the cards,
// and a press there is theirs.
function LaneColumn({
  column,
  count,
  first,
  last,
  workspace,
  hidden,
  onRefused
}: {
  column: Column
  count: number
  first: boolean
  last: boolean
  workspace: Workspace
  hidden: Hidden
  onRefused: (why: string | null) => void
}) {
  const { setNodeRef, setActivatorNodeRef, listeners, transform, transition, isDragging } =
    useSortable({ id: LANE_PREFIX + column.id })

  return (
    <section
      ref={setNodeRef}
      className={isDragging ? 'column is-dragging' : 'column'}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <ColumnHead
        column={column}
        count={count}
        first={first}
        last={last}
        grip={{ ref: setActivatorNodeRef, listeners }}
        onRefused={onRefused}
      />
      <ColumnBody column={column} workspace={workspace} hidden={hidden} />
      <AddCard columnId={column.id} templates={workspace.templates} />
    </section>
  )
}

// What flies while a column is held: the column as it stands, with nothing on
// it that could be pressed. The overlay box is given the held column's size,
// so this only has to fill it.
function ColumnFlying({
  column,
  workspace,
  hidden
}: {
  column: Column
  workspace: Workspace
  hidden: Hidden
}) {
  const byId = new Map(workspace.cards.map((card) => [card.id, card]))
  const shown = drawn(column, hidden)
  const over = column.wipLimit !== undefined && shown.length > column.wipLimit

  return (
    <section className="column-overlay">
      <header className="column-head">
        <h2>{column.title}</h2>
        <span className={over ? 'count is-over-limit' : 'count'}>
          {shown.length}
          {column.wipLimit ? ` / ${column.wipLimit}` : ''}
        </span>
        {/* The ⋯ as a picture, not a button: without it the count jumped 36
            to the right the moment the column was lifted. */}
        <span className="column-menu-anchor" aria-hidden="true">
          <span className="column-menu-button">
            <Icon name="more" />
          </span>
        </span>
      </header>
      <div className="column-cards">
        {shown.map((id) => {
          const card = byId.get(id)
          return card ? <CardTile key={id} card={card} workspace={workspace} /> : null
        })}
      </div>
    </section>
  )
}

// One context carries two kinds of drag, and each lands only on its own kind: a
// column among the columns, a card on a card or on a column's empty space. Left
// to one detector over everything, a card let go over a head would read as a
// drop on that column, and a column let go over a card as a drop into it.
//
// A column is placed by the row alone. The columns stand in one line and are
// as tall as their cards, so a centre-to-centre distance would mix how tall a
// column is into the question of where in the line it goes.
const collide: CollisionDetection = (args) => {
  const lane = isLane(String(args.active.id))
  const droppableContainers = args.droppableContainers.filter(
    (container) => isLane(String(container.id)) === lane
  )
  if (!lane) return closestCorners({ ...args, droppableContainers })

  const middle = args.collisionRect.left + args.collisionRect.width / 2
  let best: { id: UniqueIdentifier; away: number } | null = null
  for (const container of droppableContainers) {
    const rect = args.droppableRects.get(container.id)
    if (!rect) continue
    const away = Math.abs(rect.left + rect.width / 2 - middle)
    if (!best || away < best.away) best = { id: container.id, away }
  }
  return best ? [{ id: best.id, data: { value: best.away } }] : []
}

export function Kanban() {
  const workspace = useWorkspace()
  // The ground held to pull the board sideways: which pointer, where it was
  // pressed, and how far the board was scrolled then. Up here with the other
  // hooks, above the early return, for the reason written at `before` below.
  const pan = useRef<{ id: number; x: number; left: number } | null>(null)
  const applyColumns = useVault((state) => state.applyColumns)
  const saveColumns = useVault((state) => state.saveColumns)
  const holdCard = useVault((state) => state.holdCard)
  const [dragging, setDragging] = useState<string | null>(null)
  const [refused, setRefused] = useState<string | null>(null)
  // A refusal is about a column on this board, and this board outlives a
  // switch to another workspace. Found: one met on a board stood over
  // the next board opened. Dropped when the workspace changes.
  useEffect(() => setRefused(null), [workspace?.path])
  const filter = useVault((state) => state.filter)
  const notice = useVault((state) => state.notice)
  const setNotice = useVault((state) => state.setNotice)

  // Worked out once for the whole screen. The column list, the column count and
  // the number the bar reports all read it, so they cannot disagree about which
  // cards are on screen.
  const hidden = hiddenIds(workspace?.cards ?? [], filter)

  // The board as it stood before the gesture. onDragOver moves the card across
  // columns while the pointer is still down, so by the time the drop lands the
  // live board already holds the move - and comparing the result against it
  // said "nothing changed" and wrote nothing. The card sat in its new column on
  // screen and went back to the old one on the next read. This is the thing the
  // comparison has to be made against.
  //
  // Up here with the other hooks, above the early return below. Put after it,
  // this hook is skipped on the renders where there is no workspace - which is
  // a real moment, one render long, every time a workspace is thrown away - and
  // the next render with one throws on the hook count and takes the whole
  // window down with it.
  const before = useRef<Column[] | null>(null)

  const sensors = useSensors(
    // A few pixels of travel before a drag starts, so a click stays a click.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  )

  if (!workspace) return null

  const onDragStart = (event: DragStartEvent): void => {
    before.current = workspace.columns
    setDragging(String(event.active.id))
    // Told to an agent's server, v0.4 step 6: this card is in a hand, and is
    // not moved under it. Let go once its place is written, or nothing was.
    if (!isLane(String(event.active.id))) holdCard(String(event.active.id))
  }

  const onDragOver = (event: DragOverEvent): void => {
    const { active, over } = event
    // A column is not moved mid drag. The row makes room for it as it passes,
    // and the order changes once, where it is let go.
    if (!over || isLane(String(active.id))) return
    const cardId = String(active.id)
    const target = readTarget(workspace.columns, String(over.id))
    const from = columnOf(workspace.columns, cardId)
    // Within one column the preview would fight the sort animation, so only
    // crossing into another column redraws mid drag.
    if (!target || !from || from.id === target.columnId) return
    applyColumns(moveCard(workspace.columns, cardId, target))
  }

  const onDragEnd = (event: DragEndEvent): void => {
    setDragging(null)
    const { active, over } = event
    if (!over || isLane(String(active.id))) holdCard(null)
    if (!over) return

    if (isLane(String(active.id))) {
      before.current = null
      if (!isLane(String(over.id))) return
      const next = placeColumn(
        workspace.columns,
        String(active.id).slice(LANE_PREFIX.length),
        String(over.id).slice(LANE_PREFIX.length)
      )
      if (sameOrder(workspace.columns, next)) return
      applyColumns(next)
      void saveColumns()
      return
    }

    const cardId = String(active.id)
    const target = readTarget(workspace.columns, String(over.id))
    if (!target) {
      holdCard(null)
      return
    }

    const baseline = before.current ?? workspace.columns
    before.current = null

    const next = moveCard(workspace.columns, cardId, target)
    // Against where the card was picked up from, not against where the preview
    // has already put it. A gesture that wandered into another column and came
    // back still writes nothing.
    if (sameOrder(baseline, next)) {
      holdCard(null)
      return
    }
    applyColumns(next)
    void saveColumns(undefined, [cardId]).finally(() => holdCard(null))
  }

  // Pulling the board sideways by its ground. Only the ground itself: a press
  // on a column belongs to that column or to its cards, and a press on the
  // scrollbar under the board belongs to the scrollbar. And only when some of
  // the board is out of sight, or the cursor would say the hand is holding
  // something that cannot move.
  const onPanStart = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const ground = event.currentTarget
    if (event.button !== 0 || event.target !== ground) return
    if (ground.scrollWidth <= ground.clientWidth) return
    // The scrollbar is part of this box, so the target cannot tell it from
    // the ground. It is what lies below the box's client area. Taken as the
    // ground, a press on it started a pull as well as the scrollbar's own
    // drag: two things moving one scroll position.
    const box = ground.getBoundingClientRect()
    if (event.clientY >= box.top + ground.clientTop + ground.clientHeight) return
    ground.setPointerCapture(event.pointerId)
    pan.current = { id: event.pointerId, x: event.clientX, left: ground.scrollLeft }
    ground.classList.add('is-panning')
  }

  const letGo = (ground: HTMLDivElement, id: number): void => {
    pan.current = null
    ground.classList.remove('is-panning')
    if (ground.hasPointerCapture(id)) ground.releasePointerCapture(id)
  }

  const onPan = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const held = pan.current
    if (!held || held.id !== event.pointerId) return
    // Found by hand: once the board started moving it could not be let
    // go of. A move with the button up is a hand that has let go, whatever
    // became of the release that should have said so.
    if ((event.buttons & 1) === 0) {
      letGo(event.currentTarget, held.id)
      return
    }
    // The board follows the hand: pulled left, what was on the right comes in.
    event.currentTarget.scrollLeft = held.left - (event.clientX - held.x)
  }

  const onPanEnd = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (pan.current?.id !== event.pointerId) return
    letGo(event.currentTarget, event.pointerId)
  }

  const draggedCard =
    dragging && !isLane(dragging) ? workspace.cards.find((card) => card.id === dragging) : undefined
  const draggedColumn =
    dragging && isLane(dragging)
      ? workspace.columns.find((column) => LANE_PREFIX + column.id === dragging)
      : undefined

  return (
    <div className="kanban">
      <header className="kanban-head">
        <div className="kanban-title">
          <h1>{workspace.name}</h1>
          {/* The filter first and the ⋯ at the end, where a column
              keeps its own. */}
          <div className="kanban-tools">
            <FilterToggle />
            {/* Keyed by the workspace, so walking to another board closes it and
                starts it on the menu again rather than on the last one's picker. */}
            <BoardMenu
              key={workspace.path}
              background={workspace.background}
              path={workspace.path}
              bookmarked={workspace.bookmarked === true}
            />
          </div>
        </div>
        {refused && <p className="kanban-refused">{refused}</p>}
        {/* Something happened that left nothing on screen to look at: a card
            born into the part of the board a filter is hiding, or a template
            written into a folder. Dismissable, and it goes on its own the
            moment the filter moves. */}
        {notice && (
          <p className="kanban-notice" onClick={() => setNotice(null)} title="Dismiss">
            {notice}
          </p>
        )}
        {/* Inside the head with its button, so the head is the one surface
            that holds the filter and what it opens. */}
        <FilterBar
          workspaces={[workspace]}
          hidden={filteredOut(
            workspace.columns.flatMap((column) => column.cards),
            hidden
          )}
        />
      </header>

      <DndContext
        sensors={sensors}
        collisionDetection={collide}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          // Escape during a drag. The preview may have moved the card into
          // another column, and nothing was saved, so the board has to be put
          // back or the screen keeps a move the file never got.
          const baseline = before.current
          before.current = null
          setDragging(null)
          holdCard(null)
          if (baseline) applyColumns(baseline)
        }}
      >
        {/* The board's ground, step 5. On this box and nowhere else: its
            padding is the space around and between the columns, and 14.4 keeps
            the title strip above it and the columns themselves opaque. */}
        <div
          className="columns"
          style={
            workspace.background ? { background: backgroundCss(workspace.background) } : undefined
          }
          onPointerDown={onPanStart}
          onPointerMove={onPan}
          onPointerUp={onPanEnd}
          onPointerCancel={onPanEnd}
          onLostPointerCapture={onPanEnd}
        >
          <SortableContext
            items={workspace.columns.map((column) => LANE_PREFIX + column.id)}
            strategy={horizontalListSortingStrategy}
          >
            {workspace.columns.map((column, at) => (
              <LaneColumn
                key={column.id}
                column={column}
                count={drawn(column, hidden).length}
                first={at === 0}
                last={at === workspace.columns.length - 1}
                workspace={workspace}
                hidden={hidden}
                onRefused={setRefused}
              />
            ))}
          </SortableContext>

          {/* The one place Add column is not at the end of the row, because
              there is no row. The sentence in the middle of the
              ground and the button under it. */}
          {workspace.columns.length === 0 ? (
            <div className="kanban-empty">
              <p className="empty">No columns yet. Add the first one.</p>
              <AddColumn />
            </div>
          ) : (
            <AddColumn />
          )}
        </div>

        <DragOverlay>
          {draggedCard ? (
            <div className="drag-overlay">
              <CardTile card={draggedCard} workspace={workspace} />
            </div>
          ) : draggedColumn ? (
            <ColumnFlying column={draggedColumn} workspace={workspace} hidden={hidden} />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
