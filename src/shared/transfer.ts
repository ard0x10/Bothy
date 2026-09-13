import { fileOf, type CanvasObject } from './canvas'

// Taking a canvas out of a workspace and bringing one back in. Step 9 of v0.3.
//
// Step 2 wrote that "export is this file itself", and step 8 made that
// sentence incomplete rather than wrong: canvas.json still holds the whole
// drawing, but a picture on it is a bare name in files/ and a canvas.json sent
// on its own arrives with its pictures gone. We settled what to do about it -
// the pictures travel inside the file, as base64 - so an export is one .json
// and nothing else has to be remembered to send with it.
//
// The shape of that is here, and so is the way back.

// The extra top level key an exported canvas carries, and the only thing about
// it that differs from the file on disk. It is a map of file name to data url,
// not bytes hung off each object, and the reason is step 8's rule: the same
// picture put down three times is ONE file. Bytes on the object would write it
// three times, and a canvas with a photograph in four places would export at
// four times its own weight.
//
// Keeping it at the top also means `objects` in an export is character for
// character what is in canvas.json. The export is the file plus its pictures,
// which is as close to step 2's sentence as it can now be got.
export const FILES_KEY = 'files'

export type Embedded = Record<string, string>

// What we hand a data url as. The media type rather than a bare base64 blob,
// because the type is what says how to decode the bytes, and an attachment
// name is allowed to have no extension at all - so the name cannot always be
// asked instead.
const TYPE_FOR: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
  svg: 'image/svg+xml'
}

// application/octet-stream for anything unrecognised rather than a guess. An
// <img> sniffs the bytes anyway; a wrong type stated confidently is worse than
// none, because it is the one thing a stricter reader would believe.
export function mediaTypeFor(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return 'application/octet-stream'
  return TYPE_FOR[name.slice(dot + 1).toLowerCase()] ?? 'application/octet-stream'
}

export function dataUrl(name: string, base64: string): string {
  return `data:${mediaTypeFor(name)};base64,${base64}`
}

// The name of every file the drawing actually points at, once each, in the
// order it is first pointed at. Once each because of the rule above, and in
// order so that exporting the same canvas twice gives the same bytes - a file
// whose key order moves about cannot be diffed, and a canvas is a thing people
// will keep in version control next to the rest of the vault.
//
// Asked through fileOf, which is what the drawing itself asks, so a name a
// hand-edited canvas put a separator into is left out of the export the same
// way it is left off the screen.
export function referencedFiles(objects: CanvasObject[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const object of objects) {
    const name = fileOf(object)
    if (name === null || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

// The base64 out of a data url, or null when it is not one. Null rather than
// treating the whole string as base64, because a `file` entry that is a path
// or a url to somewhere else is a thing we must not write into the workspace
// under the name it asked for.
export function base64Of(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /^data:[^,]*;base64,([A-Za-z0-9+/=]*)$/.exec(value.trim())
  return match === null ? null : match[1]
}

// What an import found in the file it was handed. `objects` is what will be
// drawn; `files` is what has to be written into files/ before it can be. Notes
// are carried the way the canvas reader carries them - what was quietly left
// out is said, not hidden.
export type Incoming = {
  objects: CanvasObject[]
  files: Embedded
  notes: string[]
}

// Pulls the embedded map off a parsed canvas. The map is dropped from `extra`
// on the way past, and that is the point of doing it here: without it, an
// imported canvas would carry every picture's bytes back into canvas.json as
// an unknown top level key that the writer faithfully preserves forever. The
// bytes belong in files/, which is where this puts them; keeping a second copy
// in the file the app writes on every drag would be the one thing the format
// was built to avoid.
export function takeEmbedded(extra: Record<string, unknown>): {
  files: Embedded
  rest: Record<string, unknown>
  notes: string[]
} {
  const rest: Record<string, unknown> = {}
  const files: Embedded = {}
  const notes: string[] = []

  for (const [key, value] of Object.entries(extra)) {
    if (key !== FILES_KEY) {
      rest[key] = value
      continue
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      notes.push('the files section was not a map of names, so no pictures came in')
      continue
    }
    for (const [name, encoded] of Object.entries(value as Record<string, unknown>)) {
      const base64 = base64Of(encoded)
      if (base64 === null) {
        notes.push(`${name} was not carried as a data url and was left out`)
        continue
      }
      files[name] = base64
    }
  }

  return { files, rest, notes }
}

// Where the incoming drawing is put down. We settled that an import lands
// BESIDE what is already on the canvas rather than replacing it, so it needs a
// place to land, and this is how far it moves to get there.
//
// To the right of everything already drawn, with a gap. Right rather than
// below because a canvas grows sideways - the drawings people make on one are
// rows of boxes with arrows between them - and a gap rather than flush because
// two drawings touching at the edge read as one drawing.
//
// The shift is applied to the incoming objects, not to the view: the file the
// import came from said where its own things are relative to each other, and
// that is the only part of its coordinates worth keeping.
export const IMPORT_GAP = 80

export function shiftFor(
  mine: { x: number; w: number } | null,
  theirs: { x: number } | null
): number {
  if (mine === null || theirs === null) return 0
  return mine.x + mine.w + IMPORT_GAP - theirs.x
}

// What the two doors answer with. Here rather than beside the code that builds
// them because the window and the bridge both have to name these, and neither
// of them may reach into main.
export type ExportResult = { ok: true; path: string } | { ok: false; why: string }

export type ImportResult =
  | { ok: true; objects: CanvasObject[]; notes: string[]; name: string }
  | { ok: false; why: string }
