import { useRef } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Card, Workspace } from '../../../shared/types'
import { CardTile } from './CardTile'

type Props = { card: Card; workspace: Workspace; open: boolean; onOpen: () => void }

// The pointer has to travel this far before the gesture counts as a drag rather
// than a click. Same number the drag sensor uses, so the two never disagree
// about which one just happened.
const CLICK_SLOP = 4

export function SortableCard({ card, workspace, open, onOpen }: Props) {
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
        down.current = { x: event.clientX, y: event.clientY }
        listeners?.onPointerDown?.(event)
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
