// Moving what is held, scaling what is held, and gathering up what a selection
// rectangle went over. Step 7 of v0.3.
//
// No DOM and no React, for the same reason the viewport, the geometry and the
// scribble beside it have none: this is the part that has to be right, and it
// can be measured without a window. Every number here is a world coordinate -
// the pointer's travel is divided by the zoom before it gets here.

import {
  DEFAULTS,
  endpointOf,
  isArrow,
  isImage,
  isStroke,
  numberOf,
  placeOf,
  pointsOf,
  type CanvasObject
} from './canvas'
import { HANDLE_AT, MIN_SIZE, boxOf, lockedResize, resizeBox, type Handle } from './geometry'
import { boundsOfPoints, round, roundPoint, translate, type Point } from './scribble'
import type { Box } from './viewport'

// What moving this object by (dx, dy) writes. Every kind of object answers it
// its own way, and there is one place that knows which: a box has an x and a y,
// a scribble has only its points, and an arrow has neither - it has two ends,
// and a bound end is not the arrow's to move.
//
// Null means the object has nothing that moving it would change, which is what
// an arrow tied at both ends is. It is not a failure and it is not skipped
// silently either: the caller knows the difference between "moved nothing" and
// "there was nothing to move".
export function movedProps(
  object: CanvasObject,
  dx: number,
  dy: number
): Record<string, unknown> | null {
  if (isStroke(object)) return { points: translate(pointsOf(object), dx, dy) }

  if (isArrow(object)) {
    const moved: Record<string, unknown> = {}
    for (const which of ['from', 'to'] as const) {
      const end = endpointOf(object, which)
      // A bound end is wherever the thing it is tied to has got to. Writing a
      // point into it would be writing down a copy of somebody else's position,
      // which is the one thing this format does not do.
      if (end !== null && 'x' in end) {
        moved[which] = { x: Math.round(end.x + dx), y: Math.round(end.y + dy) }
      }
    }
    return Object.keys(moved).length > 0 ? moved : null
  }

  const box = boxOf(object.props)
  // Only x and y. The width and the height did not change, and writing them
  // back on every move would put the same number in the file a hundred times a
  // drag and make a real change to them indistinguishable from a move.
  return { x: Math.round(box.x + dx), y: Math.round(box.y + dy) }
}

export type Scale = { at: { x: number; y: number }; sx: number; sy: number }

// What pulling a handle does to a rectangle, as two factors and a corner to
// scale away from. The edges the handle does not touch stay where they are,
// the same rule resizeBox works to - this is that rule written as a scale
// rather than as a new rectangle, because a scribble is scaled rather than
// resized: it has no width and height of its own to set.
//
// An axis with no extent does not scale, and that is not a rounding guard, it
// is the only answer there is. A scribble drawn dead straight has a height of
// nought; every factor that could be asked for is a division by it, and the
// stroke would either vanish or fly off the plane. So a flat stroke stretches
// along the direction it has and keeps the one it has not.
export function scaleFor(box: Box, handle: Handle, dx: number, dy: number, min = MIN_SIZE): Scale {
  const at = HANDLE_AT[handle]
  let sx = 1
  let x = box.x
  let sy = 1
  let y = box.y

  if (at.fx !== 0.5 && box.w > 0) {
    const w = Math.max(min, at.fx === 0 ? box.w - dx : box.w + dx)
    sx = w / box.w
    x = at.fx === 0 ? box.x + box.w - w : box.x
  }
  if (at.fy !== 0.5 && box.h > 0) {
    const h = Math.max(min, at.fy === 0 ? box.h - dy : box.h + dy)
    sy = h / box.h
    y = at.fy === 0 ? box.y + box.h - h : box.y
  }

  return { at: { x, y }, sx, sy }
}

// How much thicker the pen gets when the drawing is scaled by sx across and sy
// down. We settled the behaviour: the pen scales with the drawing, so a
// scribble doubled in size is the same scribble seen closer rather than the
// same shape drawn with a finer pen.
//
// Pulled square that is simply the factor. Pulled one way only it cannot be:
// a stroke stretched four times across has its up-and-down parts four times
// thicker and its left-and-right parts exactly as thick as they were, and one
// number has to stand for both. The geometric mean is the one that does it
// without favouring an axis - it is the factor that would cover the same area -
// so a 4x stretch across comes out twice as thick rather than four times.
export const penScale = (sx: number, sy: number): number => Math.sqrt(sx * sy)

// The proportion a drag on this object has to keep, or null when it may be
// pulled any which way. We settled it: an image keeps its proportions, and
// Shift lets go of them.
//
// It is the object's OWN width over its own height, not the picture's. An image
// squashed once with Shift held is that shape now, and a later drag that keeps
// its proportions has to keep the ones it has rather than snapping it back to
// what the file was born as - a lock that undoes an edit is not a lock.
//
// The rule lives here rather than in the view because this is the half that can
// be measured without a window, which is the same reason moving and scaling are
// here.
export function lockFor(object: CanvasObject, free: boolean): number | null {
  if (free || !isImage(object)) return null
  const box = boxOf(object.props)
  return box.w > 0 && box.h > 0 ? box.w / box.h : null
}

// What pulling a handle on this object writes.
//
// An arrow answers null on purpose. It has no corners to pull: the two things
// that can be taken hold of on an arrow are its ends, and pointing an end
// somewhere else is not a resize - it is the arrow being told what it joins.
export function resizedProps(
  object: CanvasObject,
  handle: Handle,
  dx: number,
  dy: number,
  ratio: number | null = null
): Record<string, unknown> | null {
  if (isArrow(object)) return null

  if (isStroke(object)) {
    const points = pointsOf(object)
    const box = boundsOfPoints(points)
    if (!box) return null
    const { at, sx, sy } = scaleFor(box, handle, dx, dy)
    const out: Record<string, unknown> = {
      points: points.map(([x, y]) =>
        roundPoint([at.x + (x - box.x) * sx, at.y + (y - box.y) * sy] as Point)
      )
    }
    const grew = penScale(sx, sy)
    // Written only when it actually changed, so a drag along one axis of a flat
    // stroke does not put a strokeWidth into a file that never had one.
    if (grew !== 1) {
      out.strokeWidth = round(numberOf(object, 'strokeWidth', DEFAULTS.strokeWidth) * grew)
    }
    return out
  }

  const box = boxOf(object.props)
  const next = ratio === null ? resizeBox(box, handle, dx, dy) : lockedResize(box, handle, dx, dy, ratio)
  return {
    x: Math.round(next.x),
    y: Math.round(next.y),
    w: Math.round(next.w),
    h: Math.round(next.h)
  }
}

const inside = (p: Point, rect: Box): boolean =>
  p[0] >= rect.x && p[0] <= rect.x + rect.w && p[1] >= rect.y && p[1] <= rect.y + rect.h

export function rectsOverlap(a: Box, b: Box): boolean {
  return (
    a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y
  )
}

// Which side of the line through a and b the point c falls on, by sign.
const side = (a: Point, b: Point, c: Point): number =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

const onSpan = (a: Point, b: Point, c: Point): boolean =>
  Math.min(a[0], b[0]) <= c[0] &&
  c[0] <= Math.max(a[0], b[0]) &&
  Math.min(a[1], b[1]) <= c[1] &&
  c[1] <= Math.max(a[1], b[1])

export function segmentsCross(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d1 = side(p3, p4, p1)
  const d2 = side(p3, p4, p2)
  const d3 = side(p1, p2, p3)
  const d4 = side(p1, p2, p4)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true
  }
  // The collinear cases, where a sign is nought: an end sitting exactly on the
  // other line. A hand cannot aim at that, but a file written by an agent can
  // hold it, and "touching" has to mean touching.
  if (d1 === 0 && onSpan(p3, p4, p1)) return true
  if (d2 === 0 && onSpan(p3, p4, p2)) return true
  if (d3 === 0 && onSpan(p1, p2, p3)) return true
  if (d4 === 0 && onSpan(p1, p2, p4)) return true
  return false
}

export function segmentHitsRect(a: Point, b: Point, rect: Box): boolean {
  if (inside(a, rect) || inside(b, rect)) return true
  const corners: Point[] = [
    [rect.x, rect.y],
    [rect.x + rect.w, rect.y],
    [rect.x + rect.w, rect.y + rect.h],
    [rect.x, rect.y + rect.h]
  ]
  for (let i = 0; i < 4; i++) {
    if (segmentsCross(a, b, corners[i], corners[(i + 1) % 4])) return true
  }
  return false
}

// Whether the selection rectangle went over this object.
//
// We settled what a selection rectangle takes: whatever it touches, rather
// than only what it encloses. Which puts the whole weight on what "touches"
// means, and for a drawn line it is not its rectangle. A circle drawn by hand
// is a line, and the rectangle around it is mostly the empty air inside it - a
// selection drawn in that air touches nothing at all, and taking the circle
// would be the app answering a question nobody asked. The same argument
// objectAt makes about what an arrow may bind to, in the other direction.
//
// So a stroke is asked segment by segment, and an arrow is asked as the segment
// it is actually drawn as. A box is its rectangle, because that is what a box
// is.
export function hits(object: CanvasObject, ends: { from: Point; to: Point } | null, rect: Box): boolean {
  if (isArrow(object)) {
    // An arrow whose binding points at nothing is not drawn, and a rectangle
    // cannot go over something that is not on the surface.
    return ends ? segmentHitsRect(ends.from, ends.to, rect) : false
  }
  if (isStroke(object)) {
    const points = pointsOf(object)
    if (points.length === 1) return inside(points[0], rect)
    for (let i = 1; i < points.length; i++) {
      if (segmentHitsRect(points[i - 1], points[i], rect)) return true
    }
    return false
  }
  const place = placeOf(object)
  return place ? rectsOverlap(place, rect) : false
}

// Everything the rectangle went over, in file order - which is the order they
// are drawn in, so a selection reads bottom to top the way the canvas does.
export function gathered(
  objects: CanvasObject[],
  rect: Box,
  endsOf: (object: CanvasObject) => { from: Point; to: Point } | null
): string[] {
  const out: string[] = []
  for (const object of objects) {
    if (hits(object, isArrow(object) ? endsOf(object) : null, rect)) out.push(object.id)
  }
  return out
}
