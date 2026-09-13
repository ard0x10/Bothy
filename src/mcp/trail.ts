import { randomBytes } from 'node:crypto'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AI_TRAIL, type AiChange } from '../shared/aitrail'
import { userDataDir } from './state'

// One change an agent made, left where the app will see it: see
// shared/aitrail.ts. Written under another name and renamed into place, so the
// window's watcher never reads half a file.
//
// A trail that cannot be written is not a write that failed. The card is on
// disk either way; what is lost is a line on a screen, so it is said on stderr
// and the tool answers as it would have.
export async function recordAiChange(change: Omit<AiChange, 'at'>): Promise<void> {
  await leave({ at: Date.now(), ...change })
}

// Everything one call changed, in one file and in the order it was done, v0.4
// step 5. One time for all of them: they are one thing the agent did.
export async function recordAiChanges(changes: Omit<AiChange, 'at'>[]): Promise<void> {
  if (changes.length === 0) return
  const at = Date.now()
  await leave(changes.map((change) => ({ at, ...change })))
}

async function leave(body: AiChange | AiChange[]): Promise<void> {
  try {
    const dir = join(userDataDir(), AI_TRAIL)
    await mkdir(dir, { recursive: true })
    const file = join(dir, `${Date.now()}-${randomBytes(4).toString('hex')}.json`)
    await writeFile(`${file}.part`, JSON.stringify(body), 'utf8')
    await rename(`${file}.part`, file)
  } catch (error) {
    console.error('the change could not be left for the app to show:', error)
  }
}
