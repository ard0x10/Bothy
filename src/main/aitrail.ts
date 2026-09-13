import { mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { app, type BrowserWindow } from 'electron'
import { watch, type FSWatcher } from 'chokidar'
import { AI_TRAIL, readAiChanges, type AiChange } from '../shared/aitrail'
import { IPC } from '../shared/ipc'

// Main's half of the notice about an agent's writes, v0.4 step 4. The server
// leaves one file a call in <userData>/ai-trail, as shared/aitrail.ts says;
// this hands what each one holds to the window and deletes it.
//
// Emptied when the window opens rather than read. What an agent did while no
// window was up is not news to anybody by now, and the rule is that the
// notice lives and dies with the window.
export function watchAiTrail(window: BrowserWindow): () => Promise<void> {
  const dir = join(app.getPath('userData'), AI_TRAIL)
  let watcher: FSWatcher | null = null
  let closed = false

  const take = async (file: string): Promise<void> => {
    // The server writes under .part and renames; only the finished name counts.
    if (!file.toLowerCase().endsWith('.json')) return
    let text: string
    try {
      text = await readFile(file, 'utf8')
    } catch {
      return
    }
    await rm(file, { force: true }).catch(() => undefined)
    let changes: AiChange[] = []
    try {
      changes = readAiChanges(JSON.parse(text))
    } catch {
      changes = []
    }
    if (changes.length > 0 && !window.isDestroyed()) window.webContents.send(IPC.aiChanged, changes)
  }

  const started = (async () => {
    await mkdir(dir, { recursive: true })
    for (const name of await readdir(dir)) {
      await rm(join(dir, name), { recursive: true, force: true }).catch(() => undefined)
    }
    if (closed) return
    watcher = watch(dir, {
      ignoreInitial: true,
      depth: 0,
      awaitWriteFinish: { stabilityThreshold: 40, pollInterval: 20 }
    })
    watcher.on('add', (file) => void take(file))
  })().catch((error: unknown) => console.error('the AI trail could not be watched:', error))

  return async () => {
    closed = true
    await started
    await watcher?.close()
  }
}
