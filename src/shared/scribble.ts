// Free-hand strokes. Step 5 of v0.3.
//
// A scribble is a list of absolute points in the order the hand drew them, and
// this file is everything that is done to that list: thinning it, finding what
// it encloses, and turning it into a path. No DOM and no React, for the same
// reason the viewport and the geometry are out here - this is the part that has
// to be right, and it can be measured without a window.

import type { Box } from './viewport'

export type Point = [number, number]

// How far a point sits off the segment from a to b. The segment rather than the
// infinite line through the two: a scribble is allowed to come back to where it
// started - a circle does - and the line through a pair of points that are the
// same point does not exist. Off the ends of the segment the answer is the
// distance to the nearer end, which is what "how far from the drawn line" means
// on a stroke that doubles back.
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const vx = b[0] - a[0]
  const vy = b[1] - a[1]
  const wx = p[0] - a[0]
  const wy = p[1] - a[1]
  const length = vx * vx + vy * vy
  if (length === 0) return Math.hypot(wx, wy)
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / length))
  return Math.hypot(wx - t * vx, wy - t * vy)
}

// Whether a hand that went from a to b passed within reach of a stroke: the
// eraser's question. The hand's travel against each piece of the
// stroke rather than its last point against the stroke, because a quick hand
// reports a point every few dozen pixels and a thin line lying between two of
// them would be stepped over.
export function strokeMeets(points: Point[], a: Point, b: Point, reach: number): boolean {
  if (points.length === 1) return distanceToSegment(points[0], a, b) <= reach
  for (let i = 1; i < points.length; i++) {
    if (segmentsApart(points[i - 1], points[i], a, b) <= reach) return true
  }
  return false
}

// How far apart two segments come. Nothing, if they cross; otherwise one of
// the four ends is where they are closest.
function segmentsApart(p: Point, q: Point, a: Point, b: Point): number {
  if (crosses(p, q, a, b)) return 0
  return Math.min(
    distanceToSegment(p, a, b),
    distanceToSegment(q, a, b),
    distanceToSegment(a, p, q),
    distanceToSegment(b, p, q)
  )
}

function crosses(p: Point, q: Point, a: Point, b: Point): boolean {
  const side = (o: Point, s: Point, t: Point): number =>
    (s[0] - o[0]) * (t[1] - o[1]) - (s[1] - o[1]) * (t[0] - o[0])
  const d1 = side(a, b, p)
  const d2 = side(a, b, q)
  const d3 = side(p, q, a)
  const d4 = side(p, q, b)
  return d1 * d2 < 0 && d3 * d4 < 0
}

// Ramer-Douglas-Peucker. Keep the two ends, find the point furthest from the
// line between them, and if it is further than the tolerance keep it and do the
// same to both halves. What survives is the points that carry the shape: the
// corner of an L is the furthest point from its own two ends, so it is the
// first thing kept, and the thirty points along one of its arms are the first
// things dropped.
//
// Which is why this is the right family for a hand: the parts of a stroke a
// person meant are exactly the parts that stick out from a straight line, and
// the parts they did not mean - the tremor between them - do not.
//
// Written with an explicit stack rather than recursion. A stroke is a few
// hundred points on a normal day and a few thousand on a slow careful one, and
// the worst case for this algorithm is a call per point.
export function simplify(points: Point[], epsilon: number): Point[] {
  if (points.length <= 2 || epsilon <= 0) return points.slice()

  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1

  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [from, to] = stack.pop() as [number, number]
    if (to - from < 2) continue
    let far = -1
    let worst = epsilon
    for (let i = from + 1; i < to; i++) {
      const away = distanceToSegment(points[i], points[from], points[to])
      // Strictly further, so a tolerance of exactly the distance drops it: the
      // tolerance is the size of a deviation that does not matter.
      if (away > worst) {
        worst = away
        far = i
      }
    }
    if (far === -1) continue
    keep[far] = 1
    stack.push([from, far], [far, to])
  }

  const out: Point[] = []
  for (let i = 0; i < points.length; i++) if (keep[i] === 1) out.push(points[i])
  return out
}

// The tolerance is a distance on the screen, not on the plane, and that is the
// whole of why it is here as a screen number divided by the zoom rather than as
// a world number.
//
// What is being thinned away is the hand: the tremor in a stroke and the
// integer rounding of the pointer are both a fixed size in pixels, and neither
// of them knows what the canvas is zoomed to. A tolerance held in world units
// would mean the same drawing gesture is smoothed forty times harder at 4x than
// at 10% - the user would find that the pen changes character as they zoom,
// with nothing on screen to say why. Held this way the pen behaves the same at
// every zoom, and zooming in is how you draw something finer: at 4x the
// tolerance is a quarter of a world unit, so the drawing keeps four times the
// detail.
//
// One pixel, and the number was measured rather than picked. Four strokes a
// hand makes - a fast arc, a slow circle, a sharp corner, a run of real wiggles
// - captured the way a pointer reports them, with tremor and whole-pixel
// rounding on top, at nine tolerances. At one pixel the drawn line is at worst
// 1.33px from the line that was meant, which is under what an eye can find, and
// the stroke turns 1.24 times as much as the hand meant it to against 5 to 7
// times for the raw capture. Below it the tremor is still there: at 0.75 the
// same strokes still turn three times too much. Above it the shape starts to
// go: 1.5 costs 1.73px and 3.0 costs 3.17. The table is in the design doc,
// section 13.
export const SIMPLIFY_PX = 1

export function toleranceAt(k: number): number {
  return SIMPLIFY_PX / Math.max(k, 1e-6)
}

// Points are kept to two decimals rather than whole numbers, and the reason is
// the zoom again. One world unit is four pixels on screen at 4x, so rounding a
// point to the nearest whole one can move it two pixels from where the hand put
// it - four times coarser than the tolerance above, and visible. Two decimals
// puts that at a fiftieth of a pixel. It costs about three characters a
// coordinate in the file.
export const round = (value: number): number => Math.round(value * 100) / 100

export const roundPoint = (point: Point): Point => [round(point[0]), round(point[1])]

// What a stroke encloses. Null when there is nothing to enclose - which is what
// a scribble with no points is, and what an object that is not a scribble is.
export function boundsOfPoints(points: Point[]): Box | null {
  if (points.length === 0) return null
  let left = points[0][0]
  let right = points[0][0]
  let top = points[0][1]
  let bottom = points[0][1]
  for (const [x, y] of points) {
    if (x < left) left = x
    if (x > right) right = x
    if (y < top) top = y
    if (y > bottom) bottom = y
  }
  return { x: left, y: top, w: right - left, h: bottom - top }
}

export function translate(points: Point[], dx: number, dy: number): Point[] {
  return points.map(([x, y]) => roundPoint([x + dx, y + dy]))
}

// The stroke as an SVG path: straight between the points that survived.
//
// Drawn as it is held, and that is a measured choice rather than a lazy one.
// The obvious thing to do with a thinned stroke is to draw a curve through it -
// quadratics through the midpoints is the classic - and measured against the
// same four strokes it is worse everywhere the thinning actually bites. On the
// sharp corner it is far worse: the curve passes between the kept points rather
// than through them, so at one pixel of tolerance a deliberate right angle came
// out 48px away from where it was drawn. A centripetal Catmull-Rom, which does
// pass through every point, still rounded that corner off by 14.8px, because
// with the arms thinned to two long segments the tangent at the corner points
// along the diagonal.
//
// The straight line is within 1.33px of the meant stroke on all four, corner
// included. The faceting a curve would have been hiding is not there to hide:
// a thinned circle of r=60 keeps 27 points, and the sag of a 14px chord on that
// radius is 0.4px. So the curve was solving a problem the tolerance had already
// solved, and paying for it with the one shape a person draws deliberately.
//
// A single point is a dot, drawn as a segment with no length: a round cap on a
// zero length segment is a circle, and a click with a pen that leaves nothing
// at all is a pen that looks broken.
export function strokePath(points: Point[]): string {
  if (points.length === 0) return ''
  const [first] = points
  if (points.length === 1) return `M ${first[0]} ${first[1]} L ${first[0]} ${first[1]}`
  const parts = [`M ${first[0]} ${first[1]}`]
  for (let i = 1; i < points.length; i++) parts.push(`L ${points[i][0]} ${points[i][1]}`)
  return parts.join(' ')
}
