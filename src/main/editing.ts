import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { EDITING_FILE, readEditing } from '../shared/editing'
import { writeText } from './vault/writer'

// Main's half of editing.json, v0.4 step 6: the window says what its hand is on
// and this puts it next to state.json, with the app's process id, for the server
// an agent talks to. See shared/editing.ts for the shape and why.
//
// Written whole every time: the list is a handful of items at most, and a file
// that is always the latest word needs no merging. What the window sends is read,
// not believed, before it goes to disk.
export async function writeHands(items: unknown): Promise<void> {
  const editing = readEditing({ pid: process.pid, items }) ?? { pid: process.pid, items: [] }
  const dir = app.getPath('userData')
  await mkdir(dir, { recursive: true })
  await writeText(join(dir, EDITING_FILE), `${JSON.stringify(editing)}\n`)
}
