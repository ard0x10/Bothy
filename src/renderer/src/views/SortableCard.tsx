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
        if (moved < CLICK_SLOP) onOpen()
      }}
    >
      <CardTile card={card} workspace={workspace} />
    </div>
  )
}
