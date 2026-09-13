// Arrows, step 6 of v0.3.
//
// An arrow is two ends. Each end is either a fixed point on the plane or a
// binding to another object, and the binding is the source: where a bound end
// actually lands is worked out every time it is drawn and never written to the
// file. Move the box and the arrow follows, because there was never a copy of
// the box's position to go stale.
//
// We settled how a bound end behaves in step 6: it aimed at the middle of the
// thing it is bound to and touched wherever that line crossed the edge, so the
// touching point slid round the box as the box moved.
//
// That was taken back, because an arrow joining two objects slid along their
// edges whenever the objects moved. A bound end now remembers WHERE on the object it was
// tied - the point the arrow was drawn touching, as a fraction of that object's
// box. Move the box, resize it, and the arrow leaves from the same place on it;
// what changes is only the line between.
//
// The fraction is the whole of the format's growth, and it is one key: `at` in
// the same object as `of`. An end with no `at` is still an end that aims at the
// middle, which is what every older arrow is and what a hand written
// `{ "of": "o_..." }` means.
//
// The price of this: two boxes that
// swap sides leave the arrow crossing over one of them, because the place it
// leaves by is now a decision made once rather than every frame.
//
// Pure maths, no DOM, like the viewport and the scribble beside it.

import {
  boxOfObject,
  endpointOf,
  isArrow,
  isStroke,
  placeOf,
  type CanvasObject,
  type Endpoint
} from './canvas'
import { HANDLE_AT } from './geometry'
import { ARROW_DASHES, ARROW_HEADS } from './schema/canvas'
import type { Point } from './scribble'
import type { Box } from './viewport'

export { ARROW_DASHES, ARROW_HEADS }

export type ArrowHead = (typeof ARROW_HEADS)[number]
export type ArrowDash = (typeof ARROW_DASHES)[number]

export const headOf = (object: CanvasObject): ArrowHead =>
  ARROW_HEADS.includes(object.props.head as ArrowHead) ? (object.props.head as ArrowHead) : 'arrow'

export const dashOf = (object: CanvasObject): ArrowDash =>
  ARROW_DASHES.includes(object.props.dash as ArrowDash) ? (object.props.dash as ArrowDash) : 'solid'

// A dash and the gap after it, in world units, so the pattern belongs to the
// drawing rather than to how close you happen to be standing. One pair for an
// arrow and for a box's border, on screen and in the export, so the
// four places that draw a dash cannot draw four different ones.
export const dashPattern = (width: number): [number, number] => [width * 3, width * 2]

const middleOf = (box: Box): Point => [box.x + box.w / 2, box.y + box.h / 2]

// Where a line aimed at the middle of a box leaves it. The box is a rectangle,
// so this is the smaller of the two ratios: how far along the direction the
// half width is reached, and how far along the half height is. Whichever is
// reached first is the side the line goes out of, and the maths never has to
// ask which side that was.
export function clipToBox(box: Box, towards: Point): Point {
  const middle = middleOf(box)
  const dx = towards[0] - middle[0]
  const dy = towards[1] - middle[1]
  if (dx === 0 && dy === 0) return middle
  const across = dx === 0 ? Infinity : box.w / 2 / Math.abs(dx)
  const down = dy === 0 ? Infinity : box.h / 2 / Math.abs(dy)
  const t = Math.min(across, down)
  if (!Number.isFinite(t)) return middle
  return [middle[0] + dx * t, middle[1] + dy * t]
}

// Where a point on a box is, as a fraction of it - the form an arrow's `at` is
// written in. Worked out by aiming from the middle through the point and taking
// the edge, so what is remembered is always ON the object: a press in the
// middle of a box is a press on the edge nearest that press, and an end buried
// inside the box would be an arrow that stops under the thing it points at.
//
// Null when there is nothing to remember: a box with no size, or a press on the
// exact middle, where no edge is nearer than any other. Null is an end that
// aims at the middle, which is where step 6 left it.
export function anchorIn(box: Box, at: Point): Point | null {
  if (box.w <= 0 || box.h <= 0) return null
  const edge = clipToBox(box, at)
  const fx = (edge[0] - box.x) / box.w
  const fy = (edge[1] - box.y) / box.h
  if (Math.abs(fx - 0.5) < 1e-9 && Math.abs(fy - 0.5) < 1e-9) return null
  // Three places is a thousandth of the box: a fifth of a pixel on a box 200
  // wide, and a shorter number in the file than the float it came from.
  const round = (value: number): number => Math.round(value * 1000) / 1000
  return [round(fx), round(fy)]
}

// And back again: the point an `at` names on the box it is tied to.
export const pointIn = (box: Box, at: Point): Point => [
  box.x + at[0] * box.w,
  box.y + at[1] * box.h
]

// Where an end actually is, which is what the OTHER end has to aim at: its own
// point, the place it remembers on the thing it is tied to, or the middle of
// that thing when it remembers none.
export function aimOf(
  end: Endpoint,
  find: (id: string) => CanvasObject | undefined
): Point | null {
  if (end === null) return null
  if (!('of' in end)) return [end.x, end.y]
  const target = find(end.of)
  if (!target) return null
  const box = boxOfObject(target)
  return end.at ? pointIn(box, end.at) : middleOf(box)
}

// A bound end with the place it touches written onto it: where a line to where
// the other end actually is crosses its edge.
//
// That is the point the arrow was DRAWN touching, and using it rather than
// where the hand happened to press is the difference between this and the
// obvious version. A press starts somewhere inside the box - often near its
// middle - and an arrow tied to a projection of that press would leave by a
// side nobody was pointing at. Frozen at what was on screen, drawing an arrow
// looks exactly as it did before, and only what happens afterwards is
// different: the end stays there.
//
// A point end is handed back untouched. There is nothing to remember about a
// place on the plane - it is already where it is.
export function tie(
  end: Endpoint,
  other: Endpoint,
  find: (id: string) => CanvasObject | undefined
): Endpoint {
  if (end === null || !('of' in end)) return end
  // An end that already names a place on the object keeps it. That is an
  // end that came off a port or landed on one, and where it belongs was decided
  // by the hand rather than by the line: working it out again from the other
  // end would move it off the very point it was put on.
  if (end.at) return end
  const target = find(end.of)
  if (!target) return end
  const aim = aimOf(other, find)
  if (aim === null) return { of: end.of }
  const at = anchorIn(boxOfObject(target), aim)
  return at ? { of: end.of, at } : { of: end.of }
}

export type Ends = { from: Point; to: Point }

// The two ends of an arrow, resolved. Null when a binding points at an object
// that is not there: the format says such an arrow is not drawn and not
// deleted either, the same rule an attachment whose file has gone follows. The
// arrow is still in the file, and if the object it names comes back - undone,
// or written by something else - the arrow is there waiting.
export function arrowEnds(
  object: CanvasObject,
  find: (id: string) => CanvasObject | undefined
): Ends | null {
  // What an end is once the object it names has been found: a point of its own,
  // or a box with the place on it that was remembered, if one was.
  type Side = { point: Point } | { box: Box; at?: Point }
  const ends: Record<'from' | 'to', Side | null> = { from: null, to: null }

  for (const key of ['from', 'to'] as const) {
    const end = endpointOf(object, key)
    if (end === null) return null
    if ('of' in end) {
      const target = find(end.of)
      if (!target) return null
      const box = boxOfObject(target)
      ends[key] = end.at ? { box, at: end.at } : { box }
    } else {
      ends[key] = { point: [end.x, end.y] }
    }
  }

  const from = ends.from as Side
  const to = ends.to as Side

  // An end that already knows where it is: a fixed point, or a binding that
  // remembers the place on the object. Null is an end that is still only a box.
  const settled = (side: Side): Point | null =>
    'point' in side ? side.point : side.at ? pointIn(side.box, side.at) : null

  const fromSet = settled(from)
  const toSet = settled(to)

  // What an unsettled end aims at: where the other end actually is, and the
  // middle of the other box when that end is unsettled too. In that order,
  // because the direction a middle-aimed end leaves by is decided by the other
  // end, and clipping both at once would need a direction neither of them has
  // yet.
  const aim = (side: Side, known: Point | null): Point =>
    known ?? ('point' in side ? side.point : middleOf(side.box))

  return {
    from: fromSet ?? clipToBox((from as { box: Box }).box, aim(to, toSet)),
    to: toSet ?? clipToBox((to as { box: Box }).box, aim(from, fromSet))
  }
}

// The head, as a filled triangle whose tip is the end of the line. Sized off
// the pen rather than fixed, so a thick arrow does not end in a pinhead - and
// in world units, so it grows and shrinks with the drawing like the line does.
//
// Never longer than half the line: a short arrow between two boxes that are
// nearly touching would otherwise be all head.
export function headPath(tip: Point, towards: Point, strokeWidth: number): string {
  const dx = tip[0] - towards[0]
  const dy = tip[1] - towards[1]
  const length = Math.hypot(dx, dy)
  if (length === 0) return ''
  const reach = Math.min(Math.max(strokeWidth, 1) * 4, length / 2)
  const spread = reach * 0.42
  const ux = dx / length
  const uy = dy / length
  const baseX = tip[0] - ux * reach
  const baseY = tip[1] - uy * reach
  const round = (value: number): number => Math.round(value * 100) / 100
  const left: Point = [round(baseX - uy * spread), round(baseY + ux * spread)]
  const right: Point = [round(baseX + uy * spread), round(baseY - ux * spread)]
  return `M ${round(tip[0])} ${round(tip[1])} L ${left[0]} ${left[1]} L ${right[0]} ${right[1]} Z`
}

// What an arrow drawn to this point should bind to: the topmost object whose
// rectangle the point is inside, or nothing.
//
// Topmost, so an arrow binds to what the eye sees - file order is drawing
// order, and the last one drawn is the one on top.
//
// Strokes are not bound to, and the reason is that a scribble's rectangle is
// mostly the empty space around it: a circle drawn by hand is a line, and
// binding to it because the arrow ended somewhere in the middle of that circle
// would be a binding nobody asked for. An arrow can still end at a fixed point
// anywhere over a scribble, which is what pointing at one looks like.
export function objectAt(objects: CanvasObject[], at: Point): CanvasObject | null {
  for (let i = objects.length - 1; i >= 0; i--) {
    const object = objects[i]
    if (isStroke(object)) continue
    if (isArrow(object)) continue
    const box = placeOf(object)
    if (!box) continue
    if (at[0] < box.x || at[0] > box.x + box.w) continue
    if (at[1] < box.y || at[1] > box.y + box.h) continue
    return object
  }
  return null
}

// The four places on an object an arrow ties to by itself: the middle of each
// side snaps an arrow, so two boxes are easy to join.
//
// The middle of each side, and taken from the resize handles' own table rather
// than written out again: the port and the handle that sits on it are the same
// point on the box, and two tables would be free to disagree about it the day
// one of them moves.
export const PORTS = ['n', 'e', 's', 'w'] as const

export type Port = (typeof PORTS)[number]

export const PORT_AT: Record<Port, Point> = {
  n: [HANDLE_AT.n.fx, HANDLE_AT.n.fy],
  e: [HANDLE_AT.e.fx, HANDLE_AT.e.fy],
  s: [HANDLE_AT.s.fx, HANDLE_AT.s.fy],
  w: [HANDLE_AT.w.fx, HANDLE_AT.w.fy]
}

// Which way a port faces, worked out from where it is rather than kept beside
// it: a fraction of 0 is the near edge and 1 is the far one, so doubling the
// distance from the middle gives -1, 0 or 1 on each axis. Used to stand the dot
// off the edge, and derived so that moving a port moves its dot with it.
export const portOut = (at: Point): Point => [(at[0] - 0.5) * 2, (at[1] - 0.5) * 2]

// The nearest point on a box's edge, how far off it the hand is, and which side
// of the edge the hand is on.
//
// The distance is unsigned, and that is what makes the band round an edge
// symmetrical: a hand 5 outside the edge and a hand 5 inside it are both 5 from
// it, and both mean the same thing to the eye.
//
// Outside the box, clamping each axis onto it gives the nearest point of the
// rectangle - that is what nearest means for a point outside. Inside, the
// nearest point is on whichever of the four sides is least far, and a hand on
// the diagonal, equally far from two of them, takes the earlier of the two in
// the order north, south, west, east.
export function edgeNear(box: Box, at: Point): { point: Point; away: number; inside: boolean } {
  const x = Math.min(Math.max(at[0], box.x), box.x + box.w)
  const y = Math.min(Math.max(at[1], box.y), box.y + box.h)
  if (x !== at[0] || y !== at[1]) {
    return { point: [x, y], away: Math.hypot(x - at[0], y - at[1]), inside: false }
  }
  const west = at[0] - box.x
  const east = box.x + box.w - at[0]
  const north = at[1] - box.y
  const south = box.y + box.h - at[1]
  const away = Math.min(west, east, north, south)
  const point: Point =
    away === north
      ? [at[0], box.y]
      : away === south
        ? [at[0], box.y + box.h]
        : away === west
          ? [box.x, at[1]]
          : [box.x + box.w, at[1]]
  return { point, away, inside: true }
}

// Where a point on a box is, as the fraction a bound end carries. Pulled back
// onto the box, because a binding that lands off the object is not a binding,
// and rounded the way anchorIn rounds: a thousandth of the box is a fifth of a
// pixel on one 200 wide, and a shorter number in the file than the float.
export const fractionIn = (box: Box, point: Point): Point => {
  const on = (value: number, from: number, size: number): number => {
    const f = size <= 0 ? 0 : (value - from) / size
    return Math.round(Math.min(Math.max(f, 0), 1) * 1000) / 1000
  }
  return [on(point[0], box.x, box.w), on(point[1], box.y, box.h)]
}

// The port nearest a point on a box: which one, where it is, and how far off.
const nearestPort = (box: Box, at: Point): { port: Port; point: Point; away: number } => {
  let found: { port: Port; point: Point; away: number } | null = null
  for (const port of PORTS) {
    const point = pointIn(box, PORT_AT[port])
    const away = Math.hypot(point[0] - at[0], point[1] - at[1])
    // Strictly nearer, so a hand equally far from two of them takes the earlier
    // of the two in the table's own order rather than the later.
    if (!found || away < found.away) found = { port, point, away }
  }
  return found as { port: Port; point: Point; away: number }
}

// Where an arrow's end lands when the hand lets go near an object: the place on
// the object, the point on the plane that place is, and the port it is if it is
// one. Null when the hand is near nothing. Near an edge, the end shows and lands
// on the nearest point of that edge; dragged inside a box, it lands on the
// middle of one of its four sides.
//
// Three answers, in the order they beat each other:
//
//  1. A PORT, when the hand is within reach of one. A dot is the most explicit
//     thing on the box to aim at, so it wins even over the edge it sits on -
//     which is what makes two boxes joinable middle to middle without the hand
//     being exact.
//  2. A POINT ON THE EDGE, when the hand is within reach of the edge, on either
//     side of it. The nearest point, so the end goes where the hand is rather
//     than where the box would rather it went.
//  3. THE NEAREST PORT AGAIN, when the hand is deeper inside the box than the
//     band - and only when the caller asks for it, which is the whole of what
//     `into` decides. There is no free point to offer in there, so the four are
//     what is left. We settled that this is what an end DRAGGED into a box
//     does: "tied by the line" is not reachable that way any more.
//
//     The press that STARTS an arrow is the caller that says no. A press lands
//     somewhere inside a box - usually near its middle - and the side it is
//     nearest to is not the side the arrow is going to leave by, which is the
//     very thing tying by the line was written to fix: an arrow drawn from the middle of a
//     box to its right leaves by the right edge, whichever edge the press was
//     nearest. Deep inside, that start is left to the line, in the store.
//
// The reach is in world units - the caller divides a distance on the screen by
// the zoom, the same as the eraser and the arrow's own slop, because how near a
// hand got is not a question about what the canvas is zoomed to.
//
// The same things an arrow can bind to at all, and for the same reasons: a
// scribble's rectangle is mostly the empty space around it, and an arrow is not
// something another arrow ties to. Ties between two objects are broken toward
// the topmost, the way objectAt breaks them - file order is drawing order, and
// a hand aims at what the eye can see.
export type Snap = { end: { of: string; at: Point }; point: Point; port: Port | null }

export function snapAt(
  objects: CanvasObject[],
  at: Point,
  reach: number,
  into = true
): Snap | null {
  let best: { snap: Snap; rank: number; away: number } | null = null
  for (const object of objects) {
    if (isStroke(object)) continue
    if (isArrow(object)) continue
    const box = placeOf(object)
    if (!box || box.w <= 0 || box.h <= 0) continue
    const port = nearestPort(box, at)
    const edge = edgeNear(box, at)
    // The copy matters: this ends up in canvas.json, and handing out the shared
    // table would put one array in every arrow that names this port.
    const onPort = (rank: number): { snap: Snap; rank: number; away: number } => ({
      snap: {
        end: { of: object.id, at: [PORT_AT[port.port][0], PORT_AT[port.port][1]] },
        point: port.point,
        port: port.port
      },
      rank,
      away: port.away
    })
    let found: { snap: Snap; rank: number; away: number } | null = null
    if (port.away <= reach) found = onPort(0)
    else if (edge.away <= reach) {
      // Built back out of the fraction rather than from the point it came from,
      // so what is drawn under the hand is the place the file will name and not
      // a hair off it.
      const on = fractionIn(box, edge.point)
      found = {
        snap: { end: { of: object.id, at: on }, point: pointIn(box, on), port: null },
        rank: 1,
        away: edge.away
      }
    } else if (edge.inside && into) found = onPort(2)
    if (!found) continue
    if (
      !best ||
      found.rank < best.rank ||
      (found.rank === best.rank && found.away <= best.away)
    ) {
      best = found
    }
  }
  return best?.snap ?? null
}
