import { useEffect, useRef, useState } from 'react'

// A menu's three ways out: Escape, a press outside, or its button again. The
// button is inside the box, so pressing it again closes the menu rather than
// closing it on the way down and opening it again on the way up. Escape stops
// here, or it would reach App and put an open card down with it.
//
// The card's menus, the kanban's ⋯ and each column's ⋯ all open through this.
export function useMenu() {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent): void => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    const key = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('pointerdown', away, true)
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('pointerdown', away, true)
      document.removeEventListener('keydown', key, true)
    }
  }, [open])

  return { open, setOpen, box }
}
