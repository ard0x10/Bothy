import { newId } from './id'
import { boxOf } from './geometry'
import { boundsOfPoints, type Point } from './scribble'
import type { Box } from './viewport'
import {
  ALIGNS,
  CANVAS_TYPES,
  DEFAULTS,
  FONTS,
  OBJECT_ID_WIDTH,
  SHAPES,
  TEXT_STYLE_FIELDS,
  VALIGNS
} from './schema/canvas'

export { CANVAS_TYPES, DEFAULTS, FONTS, OBJECT_ID_WIDTH, SHAPES }

// The canvas file, v0.3 step 2. What a workspace draws on lives in
// canvas/canvas.json, one file per workspace, and this is the shape of it.
//
// An object is kept as the file wrote it: an id, a type, and the rest of its
// keys in their own order. A typed mirror of every field was the other way, and
// it loses the thing this format promises - a field the app has never heard of
// survives being read and written back. Two lists of field names, one here and
// one in the file, drift, and on a write the one in the code wins silently. So
// the file's own shape is what is held, and the parts the app draws with are
// read through the helpers below.
//
// The fields themselves, their defaults and what each one means are in
// schema/canvas.ts, which is also what an agent is told.

export type CanvasObject = {
  id: string
  // 'box' | 'text' | 'draw' | 'arrow' | 'image', and whatever a later version
  // or an agent writes. An unknown type is carried, not drawn and not dropped.
  type: string
  // Everything else the object holds, in file order. `id` and `type` are not in
  // here: they are written first, so keeping a second copy of them would let
  // the two disagree.
  props: Record<string, unknown>
}

export type CanvasFile = {
  workspacePath: string
  objects: CanvasObject[]
  // formatVersion, and any top level key we do not own, so a file written by
  // something else keeps what it came with.
  extra: Record<string, unknown>
  // Set when the file could not be read as a canvas. A file in this state is
  // never written over: what is on disk is the user's drawing, and an empty
  // canvas written on top of a file we failed to parse is the one loss this
  // format cannot undo.
  broken: string | null
  // What was quietly corrected while reading. Shown, not hidden - the same way
  // a card with unreadable frontmatter is reported rather than skipped.
  notes: string[]
  // The fingerprint of the text this was read from, v0.4 step 6: what the
  // window's next write is held to. Absent on a file that could not be read.
  hash?: string
}

// What a write held to a fingerprint answers: written, or the file as it is now
// because something else wrote it first.
export type CanvasWrite = { ok: true; hash: string } | { ok: false; disk: CanvasFile }

// Eight digits wide. Why eight, and not the four a card has, is written beside
// the width in the schema.
export function newObjectId(): string {
  return newId('o', OBJECT_ID_WIDTH)
}

// Colour is the one field with no default value, and that is deliberate. A
// written colour is absolute - step 9 of v0.2 settled that a drawn thing does
// not change colour when the theme does. But an object that never named one,
// which is what a hand written or agent written object usually is, has to stay
// readable on both a light and a dark canvas, so it follows the surface it is
// drawn on instead of carrying a hex that is invisible on one of them.
export const INHERIT_COLOR = null

// What the rail calls each of the faces the schema lists.
export const FONT_NAMES: Record<string, string> = { sans: 'Sans', serif: 'Serif', mono: 'Mono' }

// What each one is on screen. Sans is the app's own face, so it is inherited
// rather than named a second time.
export function fontCss(font: string): string {
  if (font === 'serif') return 'serif'
  if (font === 'mono') return 'ui-monospace, monospace'
  return 'inherit'
}

export type TextAlign = (typeof ALIGNS)[number]
export type TextValign = (typeof VALIGNS)[number]

export type TextStyle = {
  size: number
  color: string | null
  // The marker behind every line of the words. The whole of the text or
  // none of it: a word of its own was put on the shelf the same day.
  highlight: string | null
  bold: boolean
  italic: boolean
  underline: boolean
  align: TextAlign
  valign: TextValign
  font: string
  lineHeight: number
  // Anything under textStyle the app does not know. Carried for the same reason
  // the object's own extra keys are.
  extra: Record<string, unknown>
}

const ALIGN_WORDS: readonly string[] = ALIGNS
const VALIGN_WORDS: readonly string[] = VALIGNS

const STYLE_KEYS: readonly string[] = TEXT_STYLE_FIELDS.map((field) => field.name)

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const bool = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback

// The object's textStyle, with every absent field filled in. Reading it through
// one function is what keeps the panel and the drawing from each having their
// own idea of what "not set" looks like.
export function styleOf(object: CanvasObject): TextStyle {
  const style = record(object.props.textStyle)
  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(style)) {
    if (!STYLE_KEYS.includes(key)) extra[key] = value
  }
  return {
    size: num(style.size, DEFAULTS.size),
    color: typeof style.color === 'string' ? style.color : INHERIT_COLOR,
    highlight: typeof style.highlight === 'string' ? style.highlight : null,
    bold: bool(style.bold, DEFAULTS.bold),
    italic: bool(style.italic, DEFAULTS.italic),
    underline: bool(style.underline, DEFAULTS.underline),
    align: (ALIGN_WORDS.includes(String(style.align)) ? style.align : DEFAULTS.align) as TextAlign,
    valign: (VALIGN_WORDS.includes(String(style.valign)) ? style.valign : DEFAULTS.valign) as TextValign,
    font: typeof style.font === 'string' ? style.font : DEFAULTS.font,
    lineHeight: num(style.lineHeight, DEFAULTS.lineHeight),
    extra
  }
}

// A number off an object, with the default for that field. Absent, or a string
// where a number belongs, both mean the default: a file can be edited by hand,
// and a canvas that refuses to open because one key says "12px" would be worse
// than one that draws it at the default and says so.
export function numberOf(object: CanvasObject, key: string, fallback = 0): number {
  return num(object.props[key], fallback)
}

export function textOf(object: CanvasObject): string {
  return typeof object.props.text === 'string' ? object.props.text : ''
}

// The points of a scribble, absolute, in the order they were drawn. Anything
// that is not a pair of finite numbers is dropped rather than drawn at 0,0.
export function pointsOf(object: CanvasObject): Point[] {
  const raw = object.props.points
  if (!Array.isArray(raw)) return []
  const out: Point[] = []
  for (const point of raw) {
    if (!Array.isArray(point) || point.length < 2) continue
    const [x, y] = point
    if (typeof x !== 'number' || typeof y !== 'number') continue
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    out.push([x, y])
  }
  return out
}

export type Bound = { of: string; at?: Point }

export type Endpoint = Bound | { x: number; y: number } | null

// Where on the bound object the end is tied, as a fraction of its box: [0, 0]
// is the top left corner and [1, 0.5] the middle of the right edge. A fraction
// rather than a point, because a fraction is the one form that survives the box
// being moved AND resized without a second copy of the box's position living in
// the arrow.
function anchorOf(end: Record<string, unknown>): Point | undefined {
  const at = end.at
  if (!Array.isArray(at) || at.length < 2) return undefined
  const [fx, fy] = at
  if (typeof fx !== 'number' || typeof fy !== 'number') return undefined
  if (!Number.isFinite(fx) || !Number.isFinite(fy)) return undefined
  // A file can be written by hand. A fraction outside the box is pulled back to
  // its edge rather than dropped: the end is bound, and the whole of a binding
  // is that the arrow is touching that object.
  const clamp = (value: number): number => Math.max(0, Math.min(1, value))
  return [clamp(fx), clamp(fy)]
}

// An arrow end: bound to an object, or a fixed point. The binding is the
// source and the coordinates are the copy, so a bound end is answered as the
// binding even if the file also carries an x and y next to it.
//
// A bound end may also carry `at`: the place on that object it was tied
// to. Without it the end aims at the middle and touches wherever that line
// crosses the edge, which is what every older arrow does.
export function endpointOf(object: CanvasObject, key: 'from' | 'to'): Endpoint {
  const end = record(object.props[key])
  if (typeof end.of === 'string' && end.of) {
    const at = anchorOf(end)
    return at ? { of: end.of, at } : { of: end.of }
  }
  if (typeof end.x === 'number' && typeof end.y === 'number') return { x: end.x, y: end.y }
  return null
}

// What a new object starts as, and what the tool rail edits when nothing is
// selected. Step 4 of v0.3.
//
// A text is the same geometry as a box with no fill and no border. They stay
// two types because the file says what was meant - an arrow binds to a box, and
// an agent reading the canvas should not have to guess which boxes are really
// labels - but everything below treats them the same except for what they start
// as.
export const NEW_BOX = {
  w: 200,
  h: 120,
  fill: '#f6d365',
  stroke: '#00000022',
  strokeWidth: 1,
  radius: 8,
  textStyle: { size: 16, align: 'center', valign: 'middle' }
} as const

export const NEW_TEXT = {
  w: 240,
  h: 64,
  textStyle: { size: 24, align: 'left', valign: 'top' }
} as const

// The pen, step 5. No colour of its own on purpose: a stroke that never named
// one follows the surface, so a scribble drawn in the dark theme is still there
// in the light one. Naming a colour makes it absolute, like everything else
// that is drawn.
export const NEW_DRAW = {
  strokeWidth: 2
} as const

// The highlighter. A stroke like the pen's, with a colour, a width
// and a strength of its own: see-through, so what it is drawn over can still be
// read, and wide, since a highlighter at a pen's width is a pen. It names a
// colour where the pen does not, because a highlighter that followed the
// surface would be a grey wash in one theme and a white one in the other.
export const NEW_MARKER = {
  stroke: '#f6d365',
  strokeWidth: 16,
  opacity: 0.4
} as const

// The arrow, step 6. No colour of its own for the same reason the pen has
// none: an arrow that never named one follows the surface and is there in both
// themes. The head and the dash are left out too - they have defaults, and the
// format's rule is that a field nobody set is a field nobody writes.
export const NEW_ARROW = {
  strokeWidth: 2
} as const

// A rectangle writes nothing, the format's rule for a value nobody chose.
export type Shape = (typeof SHAPES)[number]

export const shapeOf = (object: CanvasObject): Shape =>
  SHAPES.includes(object.props.shape as Shape) ? (object.props.shape as Shape) : 'rect'

// The corners of a shape that has corners, inside its box. One list for the
// surface and for the export, so the two cannot draw different triangles.
export function cornersOf(shape: Shape, box: Box): Point[] {
  const { x, y, w, h } = box
  if (shape === 'triangle') return [[x + w / 2, y], [x + w, y + h], [x, y + h]]
  if (shape === 'diamond') {
    return [[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]]
  }
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
}

// What a picture's strength can be set to. Quarters, because that is the
// coarsest set that still holds a half - which is the ordinary value for a
// reference being drawn over - and because a strength nobody can tell from the
// one beside it is not a second setting.
export const IMAGE_OPACITIES = [1, 0.75, 0.5, 0.25]

// How much of what is on screen a dropped image may take up, on each axis.
// What the number means and why it is a half is in fitSize, in geometry - this
// is only where the canvas keeps it, so the drop, the paste and the file picker
// cannot each have their own.
export const IMAGE_SHARE = 0.5

// What the pen can be set to, in world units - so a thick line stays thick
// relative to the drawing rather than to the window. Doubling each time,
// because that is what a width has to do to look like a different pen: 3 next
// to 2 is the same pen on a bad day.
export const PEN_WIDTHS = [1, 2, 4, 8, 16]

// The colours a box or a pen can be given. Absolute values, not theme tokens -
// step 9 of v0.2 settled that what is drawn keeps its colour when the theme
// moves. Chosen to sit on both a light and a dark surface, because a canvas is
// one drawing seen through two themes.
export const CANVAS_PALETTE = [
  '#f6d365',
  '#f0a58f',
  '#e08f8f',
  '#8fbce0',
  '#8fd0a8',
  '#c9a8e0',
  '#d8d8de',
  '#ffffff',
  '#2b2b33'
]

// Ink that can be read on a given fill. A box carries an absolute colour, so
// text with no colour of its own cannot simply follow the theme when it is
// sitting on one: white ink on a yellow note is what that would come to in the
// dark theme. With no fill there is nothing to read against and the surface's
// own colour is right, which is what null means to the view.
export function inkFor(fill: string | null): string | null {
  if (!fill) return null
  const hex = fill.replace('#', '')
  if (hex.length < 6) return null
  const channel = (at: number): number => {
    const value = parseInt(hex.slice(at, at + 2), 16) / 255
    // sRGB, so the eye's answer is not the number in the file.
    return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
  }
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
  return luminance > 0.42 ? '#1b1b21' : '#f2f2f5'
}

// A colour's two halves: which colour it is, and how strong. The format
// has always allowed #rrggbbaa; the border and the fill are where a person can
// now set the second half, so the swatch that says which colour is on has to
// look past it.
export function rgbOf(colour: string): string {
  let hex = colour.replace('#', '').toLowerCase()
  if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('')
  return '#' + hex.slice(0, 6)
}

export function alphaOf(colour: string | null): number {
  if (!colour) return 1
  let hex = colour.replace('#', '')
  if (hex.length === 4) hex = [...hex].map((c) => c + c).join('')
  if (hex.length !== 8) return 1
  const value = parseInt(hex.slice(6, 8), 16)
  return Number.isFinite(value) ? value / 255 : 1
}

// Full strength is written as six digits, the way an unset field is written as
// nothing: the file carries what was chosen and no more.
export function withAlpha(colour: string, alpha: number): string {
  const rgb = rgbOf(colour)
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
  return a >= 255 ? rgb : rgb + a.toString(16).padStart(2, '0')
}

export const fillOf = (object: CanvasObject): string | null =>
  typeof object.props.fill === 'string' ? object.props.fill : null

export const strokeOf = (object: CanvasObject): string | null =>
  typeof object.props.stroke === 'string' ? object.props.stroke : null

// An object carries points, so it is a stroke rather than a rectangle. Asked of
// the file rather than of the type name: a type this build has never heard of
// that still holds points is a line somebody drew, and a 'draw' with no points
// is not.
export const isStroke = (object: CanvasObject): boolean => pointsOf(object).length > 0

// And what makes a thing an arrow is that it has two ends, for the same reason:
// a type this build has never heard of that carries a from and a to is a line
// between two things, and it is drawn as one.
export const isArrow = (object: CanvasObject): boolean =>
  endpointOf(object, 'from') !== null && endpointOf(object, 'to') !== null

// The name of the file in the workspace's files/ folder, step 8. A bare name
// and nothing else - a name that could hold a separator could point outside the
// workspace, and then the copy that was the whole point would be pointing at
// one machine again. Checked here rather than only where it is resolved, so a
// canvas edited by hand into `"file": "../../../secrets"` draws nothing rather
// than being refused one layer further down.
export function fileOf(object: CanvasObject): string | null {
  const name = object.props.file
  if (typeof name !== 'string' || name === '' || name === '.' || name === '..') return null
  if (/[\\/]/.test(name)) return null
  if (/^[a-zA-Z]:/.test(name)) return null
  return name
}

// An object carries the name of a file, so it is a picture - asked of the file
// rather than of the type name, the same as isStroke and isArrow. A type this
// build has never heard of that names a file is something somebody put on the
// canvas out of their folder, and an 'image' with no file is not.
export const isImage = (object: CanvasObject): boolean => fileOf(object) !== null

// The three kinds of thing the tool rail knows how to settle, asked of the
// object rather than of its type name, the same way isStroke and isArrow are.
//
// It matters beyond the rail since step 7: a selection can hold a box and a
// pen stroke at once, and `stroke` means the ink of a line on one of them and
// the border of a rectangle on the other. One press must not mean both.
export type Kind = 'arrow' | 'stroke' | 'image' | 'shape'

// An image is its own kind and not a shape, for exactly the reason the kinds
// exist: `fill` is the paper of a box and is nothing at all behind a picture
// that covers it. A selection holding a box and an image, with one press on a
// swatch, must not write a colour nobody will ever see into the file.
export const kindOf = (object: CanvasObject): Kind =>
  isStroke(object)
    ? 'stroke'
    : isArrow(object)
      ? 'arrow'
      : isImage(object)
        ? 'image'
        : 'shape'

// Where the object is, whatever kind it is. A stroke has no x, y, w and h in
// the file and is not given any: they would be a second copy of what the points
// already say, and the two would drift the first time a point moved. So they
// are worked out from the points, here, once, and everything that needs to know
// where a scribble is asks this - the selection outline, fitting the view, and
// anything a later step adds.
export function boxOfObject(object: CanvasObject): Box {
  const points = pointsOf(object)
  if (points.length > 0) return boundsOfPoints(points) as Box
  return boxOf(object.props)
}

// Where the object is, or null when it is not anywhere. An object with points
// is somewhere even if the line is dead straight and encloses nothing; an
// object with a rectangle is somewhere if the rectangle has a size; an object
// with neither - which is what an unknown type written into the file usually
// is - is not somewhere, and fitting the view around it would drag the window
// off to the origin to include a thing that is not drawn.
export function placeOf(object: CanvasObject): Box | null {
  const points = pointsOf(object)
  if (points.length > 0) return boundsOfPoints(points)
  const box = boxOf(object.props)
  return box.w > 0 && box.h > 0 ? box : null
}

// The colour text is actually drawn in: its own, or the one that can be read on
// the fill underneath it, or the surface's - in that order.
export function inkOf(object: CanvasObject): string | null {
  const own = styleOf(object).color
  return own ?? inkFor(fillOf(object))
}

// The held objects to the top of the drawing or the bottom of it. The
// file's order is the drawing order, so this is the whole of "bring to front":
// the ones that move keep their order among themselves, and so does the rest.
export function reordered(
  objects: CanvasObject[],
  ids: string[],
  to: 'front' | 'back'
): CanvasObject[] {
  const held = new Set(ids)
  const moving = objects.filter((object) => held.has(object.id))
  const staying = objects.filter((object) => !held.has(object.id))
  return to === 'front' ? [...staying, ...moving] : [...moving, ...staying]
}

// How far a copy lands from what it was copied from, in world units. Far enough
// that the copy is seen to be a second thing, near enough that it is plainly
// the same one.
export const COPY_STEP = 16

// Copies of the held objects, each with an id of its own and moved by the step.
// An arrow tied to something that was copied with it is tied to the copy;
// tied to something that stayed behind, it stays tied to that - so a copy of an
// arrow between two boxes that were not copied is a second arrow between them,
// drawn over the first.
export function copiesOf(
  objects: CanvasObject[],
  ids: string[],
  step = COPY_STEP,
  mint: () => string = newObjectId
): CanvasObject[] {
  const held = new Set(ids)
  const taken = objects.filter((object) => held.has(object.id))
  const renamed = new Map(taken.map((object) => [object.id, mint()]))
  return taken.map((object) => {
    // A deep copy: the text style is an object of its own, and a copy that
    // shared it with the original would change both the first time one of them
    // was made bold.
    const props = structuredClone(object.props) as Record<string, unknown>
    if (isStroke(object)) {
      props.points = pointsOf(object).map(([x, y]) => [x + step, y + step])
    } else {
      if (typeof props.x === 'number') props.x = props.x + step
      if (typeof props.y === 'number') props.y = props.y + step
    }
    for (const key of ['from', 'to'] as const) {
      const end = props[key]
      if (end === null || typeof end !== 'object' || Array.isArray(end)) continue
      const one = end as Record<string, unknown>
      if (typeof one.of === 'string') {
        const to = renamed.get(one.of)
        if (to !== undefined) one.of = to
      } else {
        if (typeof one.x === 'number') one.x = one.x + step
        if (typeof one.y === 'number') one.y = one.y + step
      }
    }
    return { id: renamed.get(object.id) as string, type: object.type, props }
  })
}
