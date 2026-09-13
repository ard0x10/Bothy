import {
  DEFAULTS,
  boxOfObject,
  cornersOf,
  fileOf,
  fillOf,
  inkOf,
  isArrow,
  isImage,
  isStroke,
  numberOf,
  pointsOf,
  shapeOf,
  strokeOf,
  styleOf,
  textOf,
  type CanvasObject,
  type TextStyle
} from './canvas'
import { boxOf, boundsOf } from './geometry'
import { boundsOfPoints, strokePath } from './scribble'
import { dashOf, dashPattern, headOf, headPath, type Ends } from './arrow'
import type { Box } from './viewport'

// The canvas as an SVG that opens somewhere other than here. Step 9 of v0.3,
// and the place where a debt written down in step 4 comes due.
//
// On screen a box's words are in a <foreignObject> with a div in it, because
// SVG <text> does not wrap and a box is exactly "these words fit in this
// width". That was the right call for the surface and the wrong thing to hand
// anybody else: a foreignObject is HTML inside SVG, and an SVG carrying HTML
// is an SVG that only a browser can draw. Illustrator, Inkscape and most
// viewers show an empty rectangle where the words were.
//
// One thing about that WAS checked and turned out to be false, and it is
// written down rather than quietly dropped: this build's own engine renders a
// foreignObject perfectly well when the SVG is loaded as an <img>, which is
// how the PNG below is made. So the PNG never needed this. The reason that is
// left standing is the exported SVG, and it is a reason no check here can
// reach - there is no Inkscape in the run. It is a stated reason, not a
// measured one.
//
// What IS measured is the other half, and it is the half worth having: laid
// out as <text>, the words in an exported drawing are still words. They can be
// selected, searched and restyled by whoever opens the file. Inside a
// foreignObject they are markup that most things throw away.
//
// So the lines are laid out here, once, into <text> and <tspan>. It is the
// measuring and line breaking that choosing SVG was meant to avoid, and it is
// paid for exactly once, at the door, rather than on every frame.

// How a word's width is asked for. Injected rather than reached for, because
// this runs where there is a DOM to measure with and is checked where there is
// not - and a wrap that can only be checked by looking at it is one nobody
// checks.
export type Measure = (text: string, style: TextStyle) => number

export type SvgOptions = {
  // The colour of ink that named none of its own. On screen that is var(--text)
  // and it follows the theme; an exported file has no theme to follow, so the
  // value has to be resolved here or every unnamed stroke exports as the word
  // "var(--text)", which is not a colour and draws as black in some viewers and
  // as nothing in others.
  ink: string
  // What goes behind the drawing, or null for nothing at all. We settled
  // this: nothing at all.
  background: string | null
  measure: Measure
  // A picture's bytes, by the name the object carries. An exported SVG that
  // pointed at bothy-file:// would draw nothing anywhere but inside this app,
  // and pointing it at a path on this disk would be the one thing every other
  // part of this format refuses to do.
  images: Map<string, string>
  // Which objects to draw, already chosen by the caller.
  objects: CanvasObject[]
  // Arrow ends, resolved by the caller because only it has the whole canvas to
  // look a binding up in - an arrow may be bound to a box that is not in the
  // selection being exported.
  endsFor: (object: CanvasObject) => Ends | null
}

// The families a font name means in a file that has left this machine. The
// object carries 'sans' or 'mono', which on screen resolve through CSS; an
// exported file has no CSS, so the stack is written out. 'Segoe UI' first
// because that is what the app draws in and what the person exporting was
// looking at, with a generic behind it for every machine that does not have it.
const FAMILY: Record<string, string> = {
  sans: "'Segoe UI', system-ui, sans-serif",
  // The generic and nothing in front of it: the face is whichever serif
  // the machine opening the file has, the same as it is on screen.
  serif: 'serif',
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
}

export const familyOf = (font: string): string => FAMILY[font] ?? FAMILY.sans

// Where the first baseline sits inside its line, as a fraction of the font
// size. This is what CSS does with a line box and it is written out here
// because SVG has no line boxes: the text sits centred in a line of
// lineHeight * size, and the baseline is the ascent down from the top of it.
//
// 0.8 is the ascent, and it is an approximation of one - the real number is in
// the font file and differs between them. What it costs if it is off by a
// twentieth is under a pixel of vertical drift at 16pt, which is smaller than
// the difference between two machines' idea of 'Segoe UI'. What it saves is a
// measurer that has to report metrics as well as widths, and therefore a check
// that can only run where there is a DOM.
export const ASCENT = 0.8

export function baselineOf(style: TextStyle, line: number): number {
  const step = style.size * style.lineHeight
  return line * step + (step - style.size) / 2 + style.size * ASCENT
}

// The words of one paragraph, broken to fit a width.
//
// The line breaks the user typed are kept - the text is plain and the surface
// draws it pre-wrap, so a blank line in a box is a blank line the person put
// there and not whitespace to collapse. Each of those is wrapped on its own.
//
// A single word wider than the box is broken across lines rather than allowed
// to run out the side, which is what overflow-wrap: break-word does on screen.
// Without it a pasted url would leave the box and be cut off by the edge of the
// exported picture.
export function wrapText(text: string, width: number, style: TextStyle, measure: Measure): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    if (paragraph === '') {
      lines.push('')
      continue
    }
    let line = ''
    for (const word of paragraph.split(/(\s+)/)) {
      if (word === '') continue
      const wider = line + word
      // Leading space on a fresh line is dropped, the way a browser drops it:
      // a wrap that happened at a space should not indent the line after it.
      if (line === '' && /^\s+$/.test(word)) continue
      if (measure(wider, style) <= width || line === '') {
        line = wider
        // A word on its own that is still too wide has to be cut, and cut here
        // rather than left to the viewer, which would not cut it at all.
        if (line !== '' && measure(line, style) > width && !/\s/.test(line.trim())) {
          const broken = breakWord(line, width, style, measure)
          for (const piece of broken.slice(0, -1)) lines.push(piece)
          line = broken[broken.length - 1]
        }
        continue
      }
      lines.push(line.replace(/\s+$/, ''))
      line = /^\s+$/.test(word) ? '' : word
    }
    lines.push(line.replace(/\s+$/, ''))
  }
  return lines
}

function breakWord(word: string, width: number, style: TextStyle, measure: Measure): string[] {
  const pieces: string[] = []
  let piece = ''
  for (const character of word) {
    if (piece !== '' && measure(piece + character, style) > width) {
      pieces.push(piece)
      piece = character
      continue
    }
    piece += character
  }
  pieces.push(piece)
  return pieces
}

// Where the block of lines starts, given how tall it is and where in the box it
// was asked to sit. The same three values the surface uses, worked out the same
// way, because an export that put the words somewhere else than the screen did
// would be a picture of a canvas nobody drew.
export function blockTop(box: Box, style: TextStyle, lines: number): number {
  const height = lines * style.size * style.lineHeight
  if (style.valign === 'middle') return box.y + (box.h - height) / 2
  if (style.valign === 'bottom') return box.y + box.h - height
  return box.y
}

// Where a line starts across the box, and which way it is anchored. Told to the
// viewer as an anchor rather than measured into an x, so a viewer whose font is
// a little wider than ours still centres the line instead of centring where our
// font would have put it.
export function anchorOf(style: TextStyle): { anchor: string; at: (box: Box) => number } {
  if (style.align === 'center') return { anchor: 'middle', at: (box) => box.x + box.w / 2 }
  if (style.align === 'right') return { anchor: 'end', at: (box) => box.x + box.w }
  return { anchor: 'start', at: (box) => box.x }
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Numbers in the file, short. Three decimals is under a thousandth of a world
// unit, which is far below anything the eye or a printer can find, and it
// keeps an exported canvas from being mostly digits.
const n = (value: number): string => String(Math.round(value * 1000) / 1000)

const dashes = (width: number): string => dashPattern(width).map(n).join(' ')

// How much room is left around the drawing.
//
// It is not decoration and it is not a guess: the bounds of a stroke are the
// bounds of its POINTS, and a pen of width W drawn along that edge puts W/2 of
// ink outside it. Without this a 16-wide line loses eight units of itself on
// every side of the picture. So the margin is the widest half-pen present, and
// then a little air on top of it so the drawing is not welded to the edge.
export const AIR = 12

export function marginFor(objects: CanvasObject[]): number {
  let widest = 0
  for (const object of objects) {
    if (!isStroke(object) && !isArrow(object)) continue
    widest = Math.max(widest, numberOf(object, 'strokeWidth', DEFAULTS.strokeWidth))
  }
  return widest / 2 + AIR
}

// The box the export covers: everything being drawn, plus that margin. Null
// when there is nothing that is anywhere - a canvas holding only objects of a
// type this build cannot place has no picture to make of it.
export function frameOf(objects: CanvasObject[], endsFor: (o: CanvasObject) => Ends | null): Box | null {
  const boxes: Box[] = []
  for (const object of objects) {
    if (isArrow(object)) {
      const ends = endsFor(object)
      if (ends === null) continue
      const found = boundsOfPoints([ends.from, ends.to])
      if (found) boxes.push(found)
      continue
    }
    if (isStroke(object)) {
      const found = boundsOfPoints(pointsOf(object))
      if (found) boxes.push(found)
      continue
    }
    const box = boxOf(object.props)
    if (box.w > 0 && box.h > 0) boxes.push(box)
  }
  const bounds = boundsOf(boxes)
  if (bounds === null) return null
  const margin = marginFor(objects)
  return {
    x: bounds.x - margin,
    y: bounds.y - margin,
    w: bounds.w + margin * 2,
    h: bounds.h + margin * 2
  }
}

// The whole thing. A standalone SVG: a viewBox that is the frame above, a
// width and height in the drawing's own units so a viewer that ignores the
// viewBox still gets the right shape, and nothing in it that points anywhere
// off this file.
export function toSvg(options: SvgOptions): string | null {
  const { objects, endsFor } = options
  const frame = frameOf(objects, endsFor)
  if (frame === null) return null

  const parts: string[] = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"` +
      ` width="${n(frame.w)}" height="${n(frame.h)}"` +
      ` viewBox="${n(frame.x)} ${n(frame.y)} ${n(frame.w)} ${n(frame.h)}">`
  )
  if (options.background !== null) {
    parts.push(
      `<rect x="${n(frame.x)}" y="${n(frame.y)}" width="${n(frame.w)}" height="${n(frame.h)}"` +
        ` fill="${escapeXml(options.background)}"/>`
    )
  }

  for (const object of objects) {
    const drawn = drawObject(object, options)
    if (drawn !== null) parts.push(drawn)
  }

  parts.push('</svg>')
  return parts.join('\n')
}

function drawObject(object: CanvasObject, options: SvgOptions): string | null {
  const opacity = numberOf(object, 'opacity', DEFAULTS.opacity)
  const wrap = (body: string): string =>
    opacity === 1 ? body : `<g opacity="${n(opacity)}">${body}</g>`

  if (isStroke(object)) {
    const points = pointsOf(object)
    if (points.length === 0) return null
    const width = numberOf(object, 'strokeWidth', DEFAULTS.strokeWidth)
    const ink = strokeOf(object) ?? options.ink
    return wrap(
      `<path d="${strokePath(points)}" fill="none" stroke="${escapeXml(ink)}"` +
        ` stroke-width="${n(width)}" stroke-linecap="round" stroke-linejoin="round"/>`
    )
  }

  if (isArrow(object)) {
    const ends = options.endsFor(object)
    // An arrow bound to something that is not here is not drawn, which is the
    // format's own rule for it - not a rule this exporter invented.
    if (ends === null) return null
    const width = numberOf(object, 'strokeWidth', DEFAULTS.strokeWidth)
    const ink = strokeOf(object) ?? options.ink
    const head = headOf(object)
    const dash = dashOf(object) === 'dashed' ? ` stroke-dasharray="${dashes(width)}"` : ''
    const bits = [
      `<line x1="${n(ends.from[0])}" y1="${n(ends.from[1])}" x2="${n(ends.to[0])}"` +
        ` y2="${n(ends.to[1])}" stroke="${escapeXml(ink)}" stroke-width="${n(width)}"${dash}/>`
    ]
    if (head === 'arrow' || head === 'both') {
      bits.push(`<path d="${headPath(ends.to, ends.from, width)}" fill="${escapeXml(ink)}"/>`)
    }
    if (head === 'both') {
      bits.push(`<path d="${headPath(ends.from, ends.to, width)}" fill="${escapeXml(ink)}"/>`)
    }
    return wrap(bits.join(''))
  }

  if (isImage(object)) {
    const name = fileOf(object)
    const data = name === null ? undefined : options.images.get(name)
    // A picture whose file is not there is drawn as nothing rather than as the
    // "missing" placeholder the surface shows. The placeholder is a thing to
    // click on so it can be found and dealt with; an exported picture is not
    // clickable, and a grey box with a filename in it in the middle of somebody
    // else's document is worse than a gap.
    if (data === undefined) return null
    const box = boxOf(object.props)
    const rotation = numberOf(object, 'rotation', DEFAULTS.rotation)
    const middle = { x: box.x + box.w / 2, y: box.y + box.h / 2 }
    const turn = rotation
      ? ` transform="rotate(${n(rotation)} ${n(middle.x)} ${n(middle.y)})"`
      : ''
    // preserveAspectRatio none for the same reason the surface uses none: what
    // the picture is shaped like is the object's width and height, which Shift
    // may have squashed on purpose.
    return wrap(
      `<image x="${n(box.x)}" y="${n(box.y)}" width="${n(box.w)}" height="${n(box.h)}"` +
        `${turn} preserveAspectRatio="none" href="${escapeXml(data)}"/>`
    )
  }

  return drawBox(object, options, wrap)
}

function drawBox(
  object: CanvasObject,
  options: SvgOptions,
  wrap: (body: string) => string
): string | null {
  const box = boxOfObject(object)
  if (box.w <= 0 || box.h <= 0) return null
  const fill = fillOf(object)
  const stroke = strokeOf(object)
  const radius = numberOf(object, 'radius', DEFAULTS.radius)
  const width = numberOf(object, 'strokeWidth', DEFAULTS.strokeWidth)
  const rotation = numberOf(object, 'rotation', DEFAULTS.rotation)
  const middle = { x: box.x + box.w / 2, y: box.y + box.h / 2 }

  const bits: string[] = []
  // No fill means no rectangle at all here, unlike on screen where a
  // transparent one is what takes the pointer. There is no pointer in a file.
  if (fill !== null || stroke !== null) {
    const paint =
      ` fill="${fill === null ? 'none' : escapeXml(fill)}"` +
      (stroke === null ? '' : ` stroke="${escapeXml(stroke)}" stroke-width="${n(width)}"`) +
      // A dashed border, 342, the arrow's own pattern.
      (stroke !== null && dashOf(object) === 'dashed' ? ` stroke-dasharray="${dashes(width)}"` : '')
    // The same three the surface draws, from the same corners.
    const shape = shapeOf(object)
    bits.push(
      shape === 'ellipse'
        ? `<ellipse cx="${n(middle.x)}" cy="${n(middle.y)}" rx="${n(box.w / 2)}"` +
            ` ry="${n(box.h / 2)}"${paint}/>`
        : shape === 'rect'
          ? `<rect x="${n(box.x)}" y="${n(box.y)}" width="${n(box.w)}" height="${n(box.h)}"` +
              (radius ? ` rx="${n(radius)}"` : '') +
              `${paint}/>`
          : `<polygon points="${cornersOf(shape, box)
              .map((point) => `${n(point[0])},${n(point[1])}`)
              .join(' ')}" stroke-linejoin="round"${paint}/>`
    )
  }

  const text = textOf(object)
  if (text !== '') {
    const style = styleOf(object)
    const ink = inkOf(object) ?? options.ink
    const lines = wrapText(text, box.w, style, options.measure)
    const { anchor, at } = anchorOf(style)
    const top = blockTop(box, style, lines.length)
    const x = at(box)
    // The marker behind the words, 342: a band one line tall behind each line,
    // as long as the line is and on the side its anchor puts it. A line nobody
    // wrote anything on has nothing to mark, the same as on screen.
    const marker = style.highlight
    if (marker !== null) {
      const step = style.size * style.lineHeight
      lines.forEach((line, index) => {
        if (line === '') return
        const long = options.measure(line, style)
        const left = anchor === 'middle' ? x - long / 2 : anchor === 'end' ? x - long : x
        bits.push(
          `<rect x="${n(left)}" y="${n(top + index * step)}" width="${n(long)}"` +
            ` height="${n(step)}" fill="${escapeXml(marker)}"/>`
        )
      })
    }
    const spans = lines
      .map((line, index) => {
        const y = top + baselineOf(style, index)
        // Every line carries its own x and y rather than leaning on dy. A tspan
        // with no content has no position of its own to advance from, so a
        // blank line in the middle of a box would silently collapse the ones
        // under it - and a blank line is a thing the person typed.
        return `<tspan x="${n(x)}" y="${n(y)}">${escapeXml(line)}</tspan>`
      })
      .join('')
    bits.push(
      `<text text-anchor="${anchor}" font-family="${familyOf(style.font)}"` +
        ` font-size="${n(style.size)}"` +
        (style.bold ? ' font-weight="700"' : '') +
        (style.italic ? ' font-style="italic"' : '') +
        (style.underline ? ' text-decoration="underline"' : '') +
        ` fill="${escapeXml(ink)}"` +
        // xml:space preserve, so a line the person indented stays indented. An
        // SVG viewer collapses runs of spaces without it.
        ' xml:space="preserve">' +
        spans +
        '</text>'
    )
  }

  if (bits.length === 0) return null
  const body = bits.join('')
  return wrap(
    rotation
      ? `<g transform="rotate(${n(rotation)} ${n(middle.x)} ${n(middle.y)})">${body}</g>`
      : body
  )
}
