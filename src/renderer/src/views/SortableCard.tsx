import { useRef } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Card, Workspace } from '../../../shared/types'
import { CardTile } from './CardTile'

type Props = {
  card: Card
  workspace: Workspace
  open: boolean
  onOpen: () => void
  // The right press, with the box the card is standing in. The board is the one
  // that holds it: what comes up covers the whole window, and a card inside a
  // column that scrolls cannot lay anything over its own column.
  onHold: (rect: { left: number; top: number; width: number }) => void
}

// The pointer has to travel this far before the gesture counts as a drag rather
// than a click. Same number the drag sensor uses, so the two never disagree
// about which one just happened.
const CLICK_SLOP = 4

export function SortableCard({ card, workspace, open, onOpen, onHold }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id
  })
  const down = useRef<{ x: number; y: number } | null>(null)

  const classes = ['sortable']
  if (isDragging) classes.push('is-dragging')
  if (open) classes.push('is-open')

  return (
    <div
      ref={setNodeRef}
      className={classes.join(' ')}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onPointerDown={(event) => {
        // The left button opens a card and carries it. A press of any other is
        // on its way to the menu below, and was opening the card as well: the
        // release that follows it lands here like any other release, and
        // nothing here used to ask which button it was.
        if (event.button !== 0) {
          down.current = null
          return
        }
        down.current = { x: event.clientX, y: event.clientY }
        listeners?.onPointerDown?.(event)
      }}
      onContextMenu={(event) => {
        // The window's own menu is for text and links, and there is neither
        // here: this press belongs to the card.
        event.preventDefault()
        // A right press can also start a drag, and a card being carried is not
        // a card to hold still. Nothing is measured while one is in the air.
        if (isDragging) return
        const box = event.currentTarget.getBoundingClientRect()
        onHold({ left: box.left, top: box.top, width: box.width })
      }}
      onPointerUp={(event) => {
        const from = down.current
        down.current = null
        if (!from) return
        const moved = Math.hypot(event.clientX - from.x, event.clientY - from.y)
        // A link in the title is followed rather than opened as a card, the
        // same rule the description goes by: the press is told apart by where
        // it landed. The card still opens from anywhere else on it, and a drag
        // can still start on the link, since the press reaches this box either
        // way and only a press that stayed put counts as a press.
        //
        // The window is asked for the address rather than left to follow the
        // link itself: the drag sensor takes the default off pointerdown, so
        // the browser never turns this into a click and an untouched link would
        // simply do nothing. Where it goes from there is main's open handler,
        // the same door the description's links go through.
        const link = (event.target as HTMLElement).closest('a')
        if (link) {
          const href = link.getAttribute('href')
          if (href && moved < CLICK_SLOP) window.open(href, '_blank', 'noopener')
          return
        }
        if (moved < CLICK_SLOP) onOpen()
      }}
    >
      <CardTile card={card} workspace={workspace} />
    </div>
  )
}
