import { referencedFiles } from '../../shared/transfer'
import { arrowEnds, type Ends } from '../../shared/arrow'
import { toSvg, familyOf, type Measure } from '../../shared/svg'
import type { CanvasObject, TextStyle } from '../../shared/canvas'

// The window's half of step 9: turning what is on the plane into a picture
// somebody else can open.
//
// It is here rather than in main for two reasons that are the same reason. The
// lines have to be measured in a font, and only a window has fonts; and the
// PNG is made by drawing the SVG, which only a window can do. Main is asked
// where to put the result and nothing else.

// Measuring a run of text. One canvas for the whole run rather than one per
// call - a 2d context is not free to make, and a box of forty words asks this
// forty times.
let bench: CanvasRenderingContext2D | null = null

export const measureWith: Measure = (text: string, style: TextStyle): number => {
  if (bench === null) {
    const surface = document.createElement('canvas')
    bench = surface.getContext('2d')
    if (bench === null) throw new Error('no 2d context to measure text with')
  }
  // The same three things the surface draws with, in the order the CSS font
  // shorthand wants them. Weight and style are in it because a bold word is
  // wider than the same word is not, and a wrap measured in the wrong weight
  // breaks the line in the wrong place.
  const weight = style.bold ? '700' : '400'
  const slant = style.italic ? 'italic ' : ''
  bench.font = `${slant}${weight} ${style.size}px ${familyOf(style.font)}`
  return bench.measureText(text).width
}

// Every picture the drawing points at, as a data url, asked of main.
//
// Asked of main rather than fetched down the scheme the canvas draws them
// with, and that was not the first design. <img> reaches the scheme and fetch
// does not - the page is served from file:, so it is a cross origin request
// from an opaque origin, and neither connect-src nor an allow-origin header
// got it through. Both were tried, both were backed out, and the note is in
// images.ts so it is not tried a third time.
//
// Which leaves this the better shape anyway: reading a file is main's job, it
// goes through resolveAttachment the same as everything else that touches
// files/, and the export no longer depends on the window's network stack to
// do a disk read.
//
// A picture that could not be read is left out of the map rather than failing
// the export. It is the same picture that is drawn as missing on screen, and
// an export refused because of one is an export nobody can do anything about.
export async function imagesFor(
  workspacePath: string,
  objects: CanvasObject[]
): Promise<Map<string, string>> {
  const names = referencedFiles(objects)
  if (names.length === 0) return new Map()
  return new Map(Object.entries(await window.api.embedFiles(workspacePath, names)))
}

// The colour unnamed ink is drawn in, read off the page rather than held as a
// second copy of the theme. An exported file has no theme to follow, so this is
// the moment the value has to become a value - and the honest one is the one
// that is on screen at the moment the export is asked for.
export function inkNow(): string {
  const found = getComputedStyle(document.documentElement).getPropertyValue('--text').trim()
  // A build with no stylesheet loaded is not a thing that happens in the app,
  // but it is a thing that happens in a check, and an empty fill attribute
  // draws as black in some viewers and as nothing in others.
  return found === '' ? '#1b1b21' : found
}

export type SvgInput = {
  workspacePath: string
  // What to draw. The caller has already chosen - the selection if there is
  // one, the whole canvas if there is not.
  objects: CanvasObject[]
  // The whole canvas, so an arrow bound to a box that is not in the selection
  // can still find it. An arrow in a selection of one is still an arrow
  // between two things.
  all: CanvasObject[]
  background: string | null
}

export async function buildSvg(input: SvgInput): Promise<string | null> {
  const byId = new Map(input.all.map((object) => [object.id, object]))
  const endsFor = (object: CanvasObject): Ends | null =>
    arrowEnds(object, (id) => byId.get(id))
  return toSvg({
    objects: input.objects,
    endsFor,
    ink: inkNow(),
    background: input.background,
    measure: measureWith,
    images: await imagesFor(input.workspacePath, input.objects)
  })
}

// The SVG, drawn.
//
// One pixel per world unit. Not a preference: the canvas's own units are what
// the drawing is written in, so a box 200 wide comes out 200 pixels and a
// person who wants it bigger has an answer that does not need a setting. Any
// multiplier here would be a number nobody chose applied to everybody's export.
//
// Drawing it through an <img> is why the SVG has to be self contained: an
// image is loaded in its own context and reaches nothing of this page, so a
// stylesheet, a CSS variable or a bothy-file: url in it is nothing at all by
// the time it is drawn. That is what toSvg resolves before this is called.
//
// It is NOT the reason the words are laid out as <text> - that was the claim
// and the check says otherwise, this engine draws a foreignObject in an <img>
// without complaint. The reason is in svg.ts, and it is about the SVG.
export async function toPng(svg: string): Promise<Uint8Array> {
  try {
    const image = await load(svgUrl(svg))
    const surface = document.createElement('canvas')
    // The natural size of the SVG is the width and height it wrote for itself,
    // which is the frame in world units.
    surface.width = Math.max(1, Math.round(image.naturalWidth || image.width))
    surface.height = Math.max(1, Math.round(image.naturalHeight || image.height))
    const context = surface.getContext('2d')
    if (context === null) throw new Error('no 2d context to draw the export on')
    // Nothing is painted underneath. We settled that: the background is
    // whatever the picture is later put on, and a canvas starts transparent.
    context.drawImage(image, 0, 0, surface.width, surface.height)
    const blob = await new Promise<Blob | null>((resolve) =>
      surface.toBlob((made) => resolve(made), 'image/png')
    )
    if (blob === null) throw new Error('the drawing could not be turned into a PNG')
    return new Uint8Array(await blob.arrayBuffer())
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error))
  }
}

// The SVG as something an <img> may load. A data url rather than a blob url,
// and that is not a style choice: the page's own Content-Security-Policy says
// img-src 'self' data: bothy-file:, so a blob url is refused - silently, as an
// onerror with nothing in it. Measured, after the first version of this drew
// nothing at all.
//
// Widening the policy to allow blob: was the other way, and it is the wrong
// one: the policy is what stops this window loading a picture from anywhere on
// the machine, and an export is not a reason to loosen it. Percent-encoded
// rather than base64 because base64 is a third larger and the SVG already
// holds every picture on the canvas.
export function svgUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function load(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('the drawing could not be read back as an image'))
    image.src = url
  })
}

export const textBytes = (text: string): Uint8Array => new TextEncoder().encode(text)
