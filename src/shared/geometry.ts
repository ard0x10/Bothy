// Moving and resizing a box, in world units. Step 4 of v0.3.
//
// Kept apart from the view for the same reason the viewport is: this is the
// part that has to be right, and it can be measured without a window. Every
// number here is a world coordinate - the pointer's travel is divided by the
// zoom before it gets here, so nothing in this file knows what a screen is.

import type { Box } from './viewport'

// Smaller than this and a box has no room for a handle, let alone a word.
export const MIN_SIZE = 24

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

// Where a handle sits on the box, as a fraction of its width and height. One
// table, used to place the handles and to work out what dragging one does, so
// the two cannot disagree about which corner is which.
export const HANDLE_AT: Record<Handle, { fx: number; fy: number }> = {
  nw: { fx: 0, fy: 0 },
  n: { fx: 0.5, fy: 0 },
  ne: { fx: 1, fy: 0 },
  e: { fx: 1, fy: 0.5 },
  se: { fx: 1, fy: 1 },
  s: { fx: 0.5, fy: 1 },
  sw: { fx: 0, fy: 1 },
  w: { fx: 0, fy: 0.5 }
}

export function handlePoint(box: Box, handle: Handle): { x: number; y: number } {
  const at = HANDLE_AT[handle]
  return { x: box.x + box.w * at.fx, y: box.y + box.h * at.fy }
}

export function moveBox(box: Box, dx: number, dy: number): Box {
  return { ...box, x: box.x + dx, y: box.y + dy }
}

// Dragging one handle. The edges the handle does not touch stay where they are,
// which is the whole of what a resize means: the opposite corner is an anchor,
// not a thing that follows.
//
// A drag past the far edge stops at the minimum rather than turning the box
// inside out. Flipping was the other answer and it is worse here: the box holds
// text, and text that suddenly reads backwards is not a resize anybody meant.
export function resizeBox(box: Box, handle: Handle, dx: number, dy: number, min = MIN_SIZE): Box {
  const at = HANDLE_AT[handle]
  let { x, y, w, h } = box

  if (at.fx === 0) {
    const width = Math.max(min, w - dx)
    x = x + w - width
    w = width
  } else if (at.fx === 1) {
    w = Math.max(min, w + dx)
  }

  if (at.fy === 0) {
    const height = Math.max(min, h - dy)
    y = y + h - height
    h = height
  } else if (at.fy === 1) {
    h = Math.max(min, h + dy)
  }

  return { x, y, w, h }
}

// What a drag from one point to another encloses, as a box. Used when a box is
// drawn out rather than dropped: either direction round, and a click that never
// travelled is not a box at all.
export function boxFromDrag(
  from: { x: number; y: number },
  to: { x: number; y: number }
): Box | null {
  const w = Math.abs(to.x - from.x)
  const h = Math.abs(to.y - from.y)
  if (w < MIN_SIZE || h < MIN_SIZE) return null
  return { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), w, h }
}

export function boxOf(props: Record<string, unknown>): Box {
  const num = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return { x: num(props.x, 0), y: num(props.y, 0), w: num(props.w, 0), h: num(props.h, 0) }
}

// Everything handed to it, in one box, or null when it was handed nothing.
//
// It used to decide for itself which boxes counted, dropping any with no width
// or height. Step 5 made that wrong rather than merely narrow: a scribble drawn
// straight across is a real thing on the plane with a height of zero, and it
// was being left out of the fit. The question "does this object have a place at
// all" is about the object, not about its rectangle, so it moved to placeOf in
// canvas.ts and this is a union again.
export function boundsOf(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null
  const left = Math.min(...boxes.map((box) => box.x))
  const top = Math.min(...boxes.map((box) => box.y))
  const right = Math.max(...boxes.map((box) => box.x + box.w))
  const bottom = Math.max(...boxes.map((box) => box.y + box.h))
  return { x: left, y: top, w: right - left, h: bottom - top }
}

export const CURSOR: Record<Handle, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize'
}

// Dragging one handle when the shape may not be squashed. Step 8 of v0.3: we
// settled that an image keeps its proportions unless Shift says otherwise.
//
// The ratio is the object's own width over its own height rather than the
// picture's, and that is the point of taking it as an argument. An image pulled
// out of shape once with Shift held keeps THAT shape on every later drag - the
// lock holds what is there, it does not put back what the file was born as.
//
// Which axis the drag drives is the handle's own question. A corner drives
// both, and the larger of the two answers wins so the shape follows the hand on
// whichever axis it travelled furthest; an edge drives one, and the other comes
// off the ratio. The side the handle did not touch stays put, the same rule
// resizeBox works to - and where the handle touched neither side of an axis,
// that axis is anchored at its top or its left, because the drag said nothing
// about it and something has to hold still.
export function lockedResize(
  box: Box,
  handle: Handle,
  dx: number,
  dy: number,
  ratio: number,
  min = MIN_SIZE
): Box {
  if (!(ratio > 0) || !Number.isFinite(ratio)) return resizeBox(box, handle, dx, dy, min)
  const at = HANDLE_AT[handle]
  const free = resizeBox(box, handle, dx, dy, 1)

  let width: number
  if (at.fx !== 0.5 && at.fy !== 0.5) width = Math.max(free.w, free.h * ratio)
  else if (at.fx !== 0.5) width = free.w
  else width = free.h * ratio

  // Both sides have to clear the minimum, and the height is the width divided
  // by the ratio - so the width's floor is whichever of the two is higher. Held
  // here rather than by clamping each side afterwards, which would break the
  // ratio at exactly the size where it is easiest to see.
  const w = Math.max(min, min * ratio, width)
  const h = w / ratio

  return {
    x: at.fx === 0 ? box.x + box.w - w : box.x,
    y: at.fy === 0 ? box.y + box.h - h : box.y,
    w,
    h
  }
}

// How big an image is when it is put on the canvas. We settled the behaviour:
// scaled to fit what is on screen rather than dropped at its own pixel size.
//
// The share is of each axis, not of the area, and half is not a taste. Dropping
// something is placing it, and a placement has to be visible next to what it is
// being placed beside - at the full width of the view a drop would be
// indistinguishable from a zoom, and there would be nothing on screen to say
// where it landed. Half of each axis is the largest factor at which the image
// and as much canvas again both fit.
//
// It only ever shrinks. An icon is already smaller than the view and blowing it
// up to fill half of one would be the app inventing pixels it does not have.
export function fitSize(
  natural: { w: number; h: number },
  visible: { w: number; h: number },
  share: number
): { w: number; h: number } {
  if (!(natural.w > 0) || !(natural.h > 0)) return { w: 0, h: 0 }
  // A window can be dragged smaller than any image, and the view can be zoomed
  // in past it. Below the minimum there is no room for a handle, so that is the
  // floor rather than a share of a strip of pixels.
  const room = {
    w: Math.max(MIN_SIZE, visible.w * share),
    h: Math.max(MIN_SIZE, visible.h * share)
  }
  const factor = Math.min(1, room.w / natural.w, room.h / natural.h)
  return {
    w: Math.max(1, Math.round(natural.w * factor)),
    h: Math.max(1, Math.round(natural.h * factor))
  }
}
