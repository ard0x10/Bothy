import { mkdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { blankCanvas, canvasPath } from './canvas'
import { newId } from '../../shared/id'
import { cleanBackground, type Background } from '../../shared/background'
import type { Tab } from '../../shared/types'
import { labelKeyOf } from '../../shared/labels'
import { writeText } from './writer'

// Windows refuses these outright, and a name ending in a dot or a space is
// accepted and then quietly stored without it. The folder is what a person
// browses to, so the name they typed is kept otherwise: spaces and capitals
// included, unlike a card file name, which has to survive being linked to.
const ILLEGAL = /[<>:"/\\|?*\x00-\x1f]/g

export function folderName(name: string): string {
  const cleaned = name.replace(ILLEGAL, ' ').replace(/\s+/g, ' ').trim().replace(/\.+$/, '').trim()
  return cleaned.slice(0, 60) || 'Workspace'
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function freeFolder(vaultPath: string, base: string): Promise<string> {
  for (let n = 1; ; n++) {
    const path = join(vaultPath, n === 1 ? base : `${base} ${n}`)
    if (!(await exists(path))) return path
  }
}

// A new workspace comes with no columns. Decision 2 of the spec is that the app
// does not put content on disk that nobody asked for, and a column title is the
// user's own workflow, not structure the app gets to guess at.
export async function createWorkspace(vaultPath: string, name: string): Promise<string> {
  const title = name.trim() || 'Workspace'
  const path = await freeFolder(vaultPath, folderName(title))
  await mkdir(join(path, 'kanban', 'cards'), { recursive: true })
  // The canvas, v0.3 step 2. The folder was made from v0.1 on so the shape on
  // disk was the documented one; now the file in it has a schema, so it is
  // written too. An empty canvas is a real answer, and a workspace that has one
  // on disk is one an agent can write into without making the file first.
  await mkdir(join(path, 'canvas'), { recursive: true })

  await writeText(
    join(path, 'workspace.json'),
    `${JSON.stringify({ id: newId('w'), name: title, lastTab: 'kanban', labels: [] }, null, 2)}\n`
  )
  await writeText(
    join(path, 'kanban', 'columns.json'),
    `${JSON.stringify({ formatVersion: 1, columns: [] }, null, 2)}\n`
  )
  await writeText(canvasPath(path), blankCanvas())
  return path
}

// The folder never moves. Same promise the card file name makes: whatever else
// points at it keeps pointing at it, so the new name goes in workspace.json and
// the rest of the file rides along untouched.
export async function renameWorkspace(workspacePath: string, name: string): Promise<void> {
  await editMeta(workspacePath, (meta) => {
    meta.name = name.trim() || 'Workspace'
  })
}

// Which tab the workspace was left on. It is remembered per workspace rather
// than per window, because the answer belongs to the work: a board you are
// mid-sprint on and a canvas you are sketching in are not the same place.
export async function setWorkspaceTab(workspacePath: string, tab: Tab): Promise<void> {
  await editMeta(workspacePath, (meta) => {
    meta.lastTab = tab
  })
}

// The board's ground, step 5. Null takes it away, and it takes the key with it
// rather than writing a value that means none: no key is what a workspace that
// never had one looks like, and there should be one way to say it. Anything
// that does not clean up to a background writes nothing at all - a value torn
// on its way from the window is a reason to leave the board alone, not to
// clear it.
export async function setWorkspaceBackground(
  workspacePath: string,
  background: Background | null
): Promise<void> {
  const clean = background === null ? null : cleanBackground(background)
  if (clean === undefined) return
  await editMeta(workspacePath, (meta) => {
    if (clean === null) delete meta.background
    else meta.background = clean
  })
}

// In the Bookmarks section or not, 339. The key is there only while it is true,
// for the reason the background has none when it is unset: no key is what a
// workspace that was never marked looks like, and there is one way to say it.
// Kept in the folder rather than in the app's state so a rename, which changes
// nothing but the name in this same file, cannot lose it.
export async function setWorkspaceBookmark(workspacePath: string, on: boolean): Promise<void> {
  await editMeta(workspacePath, (meta) => {
    if (on === true) meta.bookmarked = true
    else delete meta.bookmarked
  })
}

// The note hung on one of the six colours, 343. The name is all this writes:
// the colour itself belongs to the app, and a card carries the colour's word,
// so naming green "arda" and naming it something else tomorrow rewrites no
// cards at all.
//
// An empty name takes the entry away rather than writing `"name": ""`, the rule
// the background and the bookmark both follow - no key is what a colour nobody
// named looks like. An entry that carries anything else, a hex of its own for
// instance, keeps its place and loses only the name.
export async function setWorkspaceLabel(
  workspacePath: string,
  key: string,
  name: string
): Promise<void> {
  const clean = labelKeyOf(key)
  if (!clean) return
  const words = name.trim()
  await editMeta(workspacePath, (meta) => {
    const labels = Array.isArray(meta.labels) ? [...(meta.labels as unknown[])] : []
    const at = labels.findIndex(
      (entry) =>
        entry !== null &&
        typeof entry === 'object' &&
        typeof (entry as Record<string, unknown>).key === 'string' &&
        labelKeyOf((entry as Record<string, unknown>).key as string) === clean
    )
    const entry: Record<string, unknown> =
      at === -1 ? { key: clean } : { ...(labels[at] as Record<string, unknown>) }
    if (words) entry.name = words
    else delete entry.name
    const empty = Object.keys(entry).length === 1
    if (at === -1) {
      if (!empty) labels.push(entry)
    } else if (empty) {
      labels.splice(at, 1)
    } else {
      labels[at] = entry
    }
    meta.labels = labels
  })
}

// The id a workspace is chosen by, for a folder whose file has none:
// ticking such a workspace in Settings writes one, and that tick is the only
// thing that does - the window's made-up id for the session is not written.
export async function giveWorkspaceId(workspacePath: string): Promise<string> {
  let id = ''
  await editMeta(workspacePath, (meta) => {
    if (typeof meta.id !== 'string' || meta.id === '') meta.id = newId('w')
    id = meta.id as string
  })
  return id
}

// Every write to workspace.json goes through here, and every one of them is a
// change to one key. The file is read back first so the keys the app does not
// own - and the ones a later version will add - ride along untouched.
async function editMeta(
  workspacePath: string,
  change: (meta: Record<string, unknown>) => void
): Promise<void> {
  const file = join(workspacePath, 'workspace.json')
  let meta: Record<string, unknown>
  try {
    meta = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
  } catch {
    // Missing or unreadable. The edit should still land, so it is rebuilt with
    // the defaults the reader would have used anyway.
    meta = { id: newId('w'), lastTab: 'kanban', labels: [] }
  }
  change(meta)
  await writeText(file, `${JSON.stringify(meta, null, 2)}\n`)
}
