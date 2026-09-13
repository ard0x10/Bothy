import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { canvasBody, parseCanvas } from './vault/canvas'
import { attachBytes, resolveAttachment } from './vault/attach'
import {
  dataUrl,
  referencedFiles,
  takeEmbedded,
  FILES_KEY,
  type ExportResult,
  type ImportResult
} from '../shared/transfer'
import type { CanvasObject } from '../shared/canvas'

// The disk half of step 9. Taking a canvas out of a workspace and bringing one
// back in - the shape of what travels is in shared/transfer, and this is what
// reads and writes it.
//
// Everything here writes OUTSIDE the vault, or reads from outside it, which is
// why none of it goes down writer.ts's road: that road exists to stage a write
// inside a watched folder and mark it as ours, and a file on the user's desktop
// is neither.

// A canvas, plus the pictures it points at, as one file.
//
// We settled the shape: the pictures ride inside, base64, rather than being
// packed beside it. So what is written here is the same JSON canvas.json holds
// with one more key at the top - which means the `objects` in an export are
// character for character the ones on disk, and the only thing that has been
// added is the part that would otherwise have gone missing.
// The pictures a set of objects points at, as data urls, by name.
//
// Both exports need this and neither can get it in the window. <img> draws an
// attachment down the bothy-file scheme, but a fetch of one is refused
// whatever the policy says (see images.ts), so the bytes only ever come from
// here - through resolveAttachment, which is the same gate the scheme itself
// goes through.
//
// A name the rule refuses, or a file that is not there, is left out rather
// than failing the whole export. Both are drawn as missing on screen and both
// keep their object: the format's rule for a name with nothing behind it is
// that it stays and waits, and an export that dropped the object would turn a
// missing picture into a missing thing on the canvas.
export async function embedFiles(
  workspacePath: string,
  names: string[]
): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  for (const name of names) {
    const path = resolveAttachment(workspacePath, name)
    if (path === null) continue
    try {
      const bytes = await readFile(path)
      files[name] = dataUrl(name, bytes.toString('base64'))
    } catch {
      // Not there. Said by its absence from the map, which is what every
      // caller already reads as "draw this one as missing".
    }
  }
  return files
}

export async function exportCanvas(
  workspacePath: string,
  target: string,
  objects: CanvasObject[],
  extra: Record<string, unknown>
): Promise<ExportResult> {
  const files = await embedFiles(workspacePath, referencedFiles(objects))

  // The key goes last, after everything the canvas itself carries, so that the
  // top of an exported file still reads the way canvas.json does and a person
  // opening it in an editor sees formatVersion and objects before a wall of
  // base64.
  const out: Record<string, unknown> = canvasBody({ objects, extra })
  if (Object.keys(files).length > 0) out[FILES_KEY] = files

  try {
    await writeFile(target, `${JSON.stringify(out, null, 2)}\n`, 'utf8')
    return { ok: true, path: target }
  } catch (error) {
    return { ok: false, why: error instanceof Error ? error.message : String(error) }
  }
}

// The way back. The file is read, its pictures are written into the
// workspace's files/ folder, and the objects come back with their `file` names
// pointing at whatever those pictures ended up being called.
//
// The names can change on the way in and that is the whole reason this returns
// objects rather than a file. attachBytes settles a picture by its content: an
// incoming shot.png whose bytes are already in the folder under another name
// becomes that name, and one whose bytes are new but whose name is taken
// becomes shot-2.png. Either way the object has to be told, or it points at
// somebody else's picture - which is the one failure worth more than the
// import.
export async function importCanvas(workspacePath: string, source: string): Promise<ImportResult> {
  let text: string
  try {
    text = await readFile(source, 'utf8')
  } catch (error) {
    return { ok: false, why: error instanceof Error ? error.message : String(error) }
  }

  const parsed = parseCanvas(text)
  if (parsed.broken !== null) return { ok: false, why: parsed.broken }

  const { files, notes } = takeEmbedded(parsed.extra)
  const all = [...parsed.notes, ...notes]

  const renamed = new Map<string, string>()
  for (const [name, base64] of Object.entries(files)) {
    try {
      const bytes = Buffer.from(base64, 'base64')
      const landed = await attachBytes(workspacePath, name, bytes)
      if (landed !== name) all.push(`${name} came in as ${landed}`)
      renamed.set(name, landed)
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error)
      all.push(`${name} could not be written into files/ (${why})`)
    }
  }

  // Only the names that actually moved are rewritten. An object naming a file
  // the export did not carry is left pointing where it pointed - it may well be
  // a picture already sitting in this workspace's folder, and rewriting it to
  // nothing would break the one case that needs no work at all.
  const objects = parsed.objects.map((object) => {
    const name = typeof object.props.file === 'string' ? object.props.file : null
    const landed = name === null ? undefined : renamed.get(name)
    if (landed === undefined || landed === name) return object
    return { ...object, props: { ...object.props, file: landed } }
  })

  return { ok: true, objects, notes: all, name: basename(source) }
}

// A picture or a drawing, written where the user asked for it. Bytes rather
// than text for both, because a PNG is bytes and an SVG written as UTF-8 bytes
// by the window is the same file as one written as a string here - and one road
// is easier to keep than two.
export async function saveBytes(target: string, bytes: Uint8Array): Promise<ExportResult> {
  try {
    await writeFile(target, bytes)
    return { ok: true, path: target }
  } catch (error) {
    return { ok: false, why: error instanceof Error ? error.message : String(error) }
  }
}
