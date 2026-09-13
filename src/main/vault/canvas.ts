import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { CanvasFile, CanvasObject, CanvasWrite } from '../../shared/canvas'
import { OBJECT_ID_WIDTH } from '../../shared/schema/canvas'
import { hashText } from './hash'
import { writeIfUnchanged, writeText } from './writer'

// canvas/canvas.json, one per workspace. Step 2 of v0.3 is this file being
// born, read and written; nothing draws it yet.

export function canvasPath(workspacePath: string): string {
  return join(workspacePath, 'canvas', 'canvas.json')
}

// Top level keys the app owns. Anything else in the file rides along in extra,
// in its own order, the way columns.json already works.
const OWN = ['formatVersion', 'objects']

export type ParsedCanvas = Omit<CanvasFile, 'workspacePath'>

function emptyCanvas(): ParsedCanvas {
  return { objects: [], extra: { formatVersion: 1 }, broken: null, notes: [] }
}

// The text a workspace is born with, and what an empty canvas serializes to.
export function blankCanvas(): string {
  return `${JSON.stringify({ formatVersion: 1, objects: [] }, null, 2)}\n`
}

// An id for an object that came without one of its own, made from the object as
// it is written and how many alike came before it, so every read of one file
// gives the same ids. Random before, and measured there: the window and
// Bothy's server each read a canvas holding an object with no id, each made up
// its own, and when the server wrote its id down the window named an object
// nobody had touched as changed outside Bothy. A card with no id has had this
// kind of id, made from its path, all along.
function madeUpId(entry: unknown, taken: ReadonlySet<string>): string {
  const text = JSON.stringify(entry)
  for (let n = 0; ; n++) {
    const id = `o_${hashText(`${text}\n${n}`).slice(0, OBJECT_ID_WIDTH)}`
    if (!taken.has(id)) return id
  }
}

export function parseCanvas(text: string): ParsedCanvas {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error)
    return { ...emptyCanvas(), broken: why.split('\n')[0] }
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ...emptyCanvas(), broken: 'the file is not a JSON object' }
  }

  const file = body as Record<string, unknown>
  const notes: string[] = []
  const objects: CanvasObject[] = []
  const seen = new Set<string>()

  if (file.objects !== undefined && !Array.isArray(file.objects)) {
    notes.push('objects is not a list, so the canvas was read as empty')
  }

  const entries: unknown[] = Array.isArray(file.objects) ? file.objects : []
  const idOf = (entry: unknown): string | null => {
    const id = entry !== null && typeof entry === 'object' ? (entry as Record<string, unknown>).id : undefined
    return typeof id === 'string' && id !== '' ? id : null
  }
  // Every id the file claims, so one made up here never takes the id of an
  // object further down.
  const taken = new Set(entries.map(idOf).filter((id): id is string => id !== null))

  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      notes.push('an entry in objects was not an object and was left out')
      continue
    }
    const props = { ...(entry as Record<string, unknown>) }
    const wanted = idOf(entry)
    // A file can be written by hand or by an agent, and a copied object brings
    // its id with it. Two objects with one id is the failure the wide id is
    // there to make unlikely, not one it makes impossible, so the second one
    // is given its own rather than the two of them being one object to
    // everything that looks the canvas up by id.
    const clash = wanted !== null && seen.has(wanted)
    const id = clash || wanted === null ? madeUpId(entry, new Set([...taken, ...seen])) : wanted
    if (wanted === null) notes.push(`an object had no id and was given ${id}`)
    if (clash) notes.push(`two objects shared the id ${wanted}, the second is now ${id}`)
    seen.add(id)

    const type = typeof props.type === 'string' && props.type !== '' ? props.type : 'unknown'
    if (props.type !== type) notes.push(`${id} has no type and will not be drawn`)
    delete props.id
    delete props.type
    objects.push({ id, type, props })
  }

  const extra: Record<string, unknown> = {
    formatVersion: typeof file.formatVersion === 'number' ? file.formatVersion : 1
  }
  for (const [key, value] of Object.entries(file)) {
    if (!OWN.includes(key)) extra[key] = value
  }

  return { objects, extra, broken: null, notes }
}

// id and type first, then whatever the object came with, in its order. A file
// we touch keeps looking like the ones in the format doc, and an object nobody
// edited comes back out the way it went in.
function shape(object: CanvasObject): Record<string, unknown> {
  return { id: object.id, type: object.type, ...object.props }
}

// The file as an object, before it is text. Apart from serializeCanvas because
// step 9 writes the same body with one more key on it, and two places building
// the same shape is how the export and the file on disk come to disagree about
// what a canvas looks like.
export function canvasBody(
  file: Pick<CanvasFile, 'objects' | 'extra'>
): Record<string, unknown> {
  const { formatVersion = 1, ...rest } = file.extra
  return {
    formatVersion,
    ...rest,
    objects: file.objects.map(shape)
  }
}

export function serializeCanvas(file: Pick<CanvasFile, 'objects' | 'extra'>): string {
  return `${JSON.stringify(canvasBody(file), null, 2)}\n`
}

export async function readCanvas(workspacePath: string): Promise<CanvasFile> {
  let text: string
  try {
    text = await readFile(canvasPath(workspacePath), 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? ''
    // Not there is not a problem: every workspace made before v0.3 has an empty
    // canvas folder, and one of them is an empty canvas. The file is written
    // the first time something is drawn.
    // Its fingerprint is that of nothing, which no file with anything in it has.
    if (code === 'ENOENT') return { workspacePath, ...emptyCanvas(), hash: hashText('') }
    // Anything else - held open, no permission - is a file we could not read,
    // which is not the same as a file with nothing in it.
    const why = error instanceof Error ? error.message : String(error)
    return { workspacePath, ...emptyCanvas(), broken: why }
  }
  return { workspacePath, ...parseCanvas(text), hash: hashText(text) }
}

// The window's write, v0.4 step 6: held to the fingerprint of what the window
// last knew was on disk. A file that moved on is not written over; it comes back,
// read, for the window to put its own change together with (shared/merge.ts).
export async function writeCanvasOver(file: CanvasFile, baseline: string | null): Promise<CanvasWrite> {
  if (file.broken !== null) {
    throw new Error(`canvas.json was not read (${file.broken}), so it is not being written over`)
  }
  const target = canvasPath(file.workspacePath)
  await mkdir(dirname(target), { recursive: true })
  const written = await writeIfUnchanged(target, serializeCanvas(file), baseline)
  if (written.ok) return written
  return { ok: false, disk: { workspacePath: file.workspacePath, ...parseCanvas(written.disk), hash: hashText(written.disk) } }
}

// Refused on a canvas that did not parse. The objects in memory are empty in
// that case, and writing them would replace a drawing we could not read with
// nothing - the one loss this format cannot walk back. Whoever wants that file
// gone can say so on disk.
export async function writeCanvas(file: CanvasFile): Promise<void> {
  if (file.broken !== null) {
    throw new Error(`canvas.json was not read (${file.broken}), so it is not being written over`)
  }
  const target = canvasPath(file.workspacePath)
  // Every workspace made before v0.3 has no canvas folder, and the writer
  // stages into the folder it is writing to - so without this the first thing
  // ever drawn is lost to ENOENT, and lost quietly, because nothing is waiting
  // on that write. Measured: it is what the fixture workspace did.
  await mkdir(dirname(target), { recursive: true })
  await writeText(target, serializeCanvas(file))
}
