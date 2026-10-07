import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Card, Workspace } from '../../../shared/types'
import { useVault, type CardHold as Held } from '../store'
import { CardTile } from './CardTile'
import { Icon } from './Icon'
import { MoveMenu } from './MoveMenu'
import { NameBox } from './NameBox'

// The right press on a card. Everything but that card goes dim, its title
// becomes a box with the whole title taken, and two things it can be told to do
// stand beside it.
//
// The card on screen is a copy laid over the one in the column, at the size and
// place the real one was measured at, the way a card being dragged is a copy.
// The real one is inside a column that scrolls and carries a transform of its
// own while it is sortable, and lifting it out of that over a scrim would mean
// fighting the stacking of everything above it. A copy answers to nothing but
// this box.
//
// Renaming from here writes the card without opening it. That is the whole of
// why this exists: the fast way to fix a title is not a panel over the board.

// How far the menu stands off the card, and how much room it needs on that
// side before it goes round to the other one. The width is the one every other
// menu in the app is, so the page that lists workspaces has the room their
// names need without the box changing size under the hand.
const GAP = 8
const MENU_WIDTH = 236

export function CardHold({
  held,
  workspace,
  onDone
}: {
  held: Held
  workspace: Workspace
  onDone: () => void
}) {
  const openCard = useVault((state) => state.openCard)
  const renameCard = useVault((state) => state.renameCard)
  const trashCard = useVault((state) => state.trashCard)
  const moveCardTo = useVault((state) => state.moveCardTo)
  // The title is edited straight away, which is the point of the press. Once
  // the box is answered or backed out of, the card is still held and the menu
  // is still there.
  const [editing, setEditing] = useState(true)
  // Which page of the menu is showing. The move is a second page in the same
  // box rather than a sheet of its own, the way the board's ⋯ opens the
  // background picker.
  const [page, setPage] = useState<'menu' | 'move'>('menu')
  const card: Card | undefined = workspace.cards.find((entry) => entry.id === held.id)
  // Where the menu's top edge stands. It starts level with the card, and is
  // lifted once the box has been measured if that would carry its foot past the
  // bottom of the window: a card at the end of a long column is pressed near
  // the floor, and the page that lists workspaces is taller than the first one.
  const menu = useRef<HTMLDivElement | null>(null)
  const [menuTop, setMenuTop] = useState(held.rect.top)

  // Before the paint, so a menu that has to rise is never seen standing low
  // first, and again whenever the box changes height: each page is its own
  // height, and the workspace page opens a page of columns inside itself that
  // this component is never told about.
  useLayoutEffect(() => {
    const box = menu.current
    if (!box) return
    const place = (): void => {
      const floor = window.innerHeight - GAP - box.offsetHeight
      setMenuTop(Math.max(GAP, Math.min(held.rect.top, floor)))
    }
    place()
    const watch = new ResizeObserver(place)
    watch.observe(box)
    return () => watch.disconnect()
  }, [held.rect.top])

  // Escape puts the card down. While the box is open it never reaches here:
  // NameBox stops it, and backing out of a name is not the same as letting the
  // card go. Listened for on the way up rather than down, which is what gives
  // the box the first answer.
  useEffect(() => {
    const key = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      // A second page backs out to the first rather than putting the card
      // down: Escape answers the question that is actually on screen.
      if (page === 'move') setPage('menu')
      else onDone()
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onDone, page])

  // A card written from outside, or trashed, while it is being held.
  useEffect(() => {
    if (!card) onDone()
  }, [card, onDone])
  if (!card) return null

  // Whatever is in the box is taken before this goes: pressing the scrim or one
  // of the rows moves the focus, and a box removed from a page cannot be asked
  // what was typed into it afterwards.
  const letGo = (): void => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    onDone()
  }

  const act = (run: () => void): void => {
    letGo()
    run()
  }

  // Beside the card, on the side with room for it. The card is where the press
  // found it, so on a board pulled all the way right the menu would otherwise
  // stand off the edge of the window.
  const right = held.rect.left + held.rect.width + GAP
  const menuLeft =
    right + MENU_WIDTH <= window.innerWidth ? right : Math.max(GAP, held.rect.left - GAP - MENU_WIDTH)

  return (
    <div className="card-hold">
      {/* The press that puts the card down, and the dim that puts the eye on
          it. One box: a scrim that only darkens would need a second one over
          it to catch the press. */}
      <div
        className="card-hold-scrim"
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) letGo()
        }}
        onContextMenu={(event) => {
          // A second right press anywhere else puts this one down rather than
          // opening the window's own menu over a dimmed board.
          event.preventDefault()
          letGo()
        }}
      />

      <div
        className="card-hold-card"
        style={{ left: held.rect.left, top: held.rect.top, width: held.rect.width }}
      >
        <CardTile
          card={card}
          workspace={workspace}
          titleBox={
            editing ? (
              <NameBox
                className="card-hold-title"
                placeholder="Card title"
                initial={card.title}
                onCommit={(title, how) => {
                  void renameCard(card.id, title)
                  // Enter is a person finished with this card. A blur is a
                  // person on their way to one of the rows beside it, and
                  // putting the card down here would take the row out from
                  // under the press that is already on its way.
                  if (how === 'enter') onDone()
                }}
                onCancel={() => setEditing(false)}
              />
            ) : undefined
          }
        />
      </div>

      <div ref={menu} className="card-hold-menu" role="menu" style={{ left: menuLeft, top: menuTop }}>
        {page === 'move' ? (
          <MoveMenu
            from={workspace.path}
            column
            onBack={() => setPage('menu')}
            onPick={(path, columnId) => {
              if (columnId === null) return
              act(() => void moveCardTo(card.id, path, columnId))
            }}
          />
        ) : (
          <>
            <button
              className="card-menu-item"
              role="menuitem"
              data-act="open"
              onClick={() => act(() => openCard(card.id))}
            >
              <Icon name="pencil" />
              Edit card
            </button>
            {/* Between editing the card and throwing it away, which is where it
                belongs: it is the third thing that can be done to a card from
                the board, and the last row is the one nothing should come
                after. */}
            <button
              className="card-menu-item"
              role="menuitem"
              data-act="move"
              onClick={() => setPage('move')}
            >
              <Icon name="transfer" />
              Move to…
            </button>
            <button
              className="card-menu-item"
              role="menuitem"
              data-act="trash"
              onClick={() => act(() => void trashCard(card.id))}
            >
              <Icon name="trash" />
              Move to trash
            </button>
          </>
        )}
      </div>
    </div>
  )
}
