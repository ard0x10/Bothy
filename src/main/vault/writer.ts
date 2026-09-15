import { readFile, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { SaveResult } from '../../shared/types'
import { hashText } from './hash'

// What we last put on disk, per file. The watcher compares against this to tell
// our own writes apart from someone editing the file in another program.
// Content, not timing: a fixed ignore window would either drop real edits on a
// slow disk or let our own write through on a fast one.
const written = new Map<string, string>()

const key = (file: string): string => resolve(file).toLowerCase()

// One write at a time per file. Two of them overlapping is not hypothetical:
// the panel saves on a timer and is also saved on the way out, so a keystroke
// and a tab switch can each start one within the same tick. Measured on
// Windows, the two renames onto the same name collide and one comes back
// EPERM - an error nobody is holding, on a save the user thought had landed.
// Queued per file rather than globally: a card and columns.json have no reason
// to wait for each other.
const busy = new Map<string, Promise<void>>()

function afterOthers(file: string, work: () => Promise<void>): Promise<void> {
  const id = key(file)
  const mine = (busy.get(id) ?? Promise.resolve()).then(work, work)
  busy.set(id, mine)
  // Whoever is last out clears the slot, so the map holds only what is in
  // flight rather than one entry per file the app has ever written. Handled on
  // both paths: a rejection belongs to the caller, and reaching for it here
  // through finally() would leave a second copy of it with nobody holding it.
  const clear = (): void => {
    if (busy.get(id) === mine) busy.delete(id)
  }
  void mine.then(clear, clear)
  return mine
}

// One new file at a time per folder. Finding a free name and writing to it are
// two steps, and two new files asked for in the same moment both found the same
// free name, so the second write replaced the first. Measured with two pictures
// pasted into the Add card box back to back: five cards made, four on disk.
// Per folder, like the writes above per file.
const naming = new Map<string, Promise<unknown>>()

export function oneNameAtATime<T>(dir: string, work: () => Promise<T>): Promise<T> {
  const id = key(dir)
  const mine = (naming.get(id) ?? Promise.resolve()).then(work, work)
  naming.set(id, mine)
  const clear = (): void => {
    if (naming.get(id) === mine) naming.delete(id)
  }
  void mine.then(clear, clear)
  return mine
}

export function writeText(file: string, text: string): Promise<void> {
  return afterOthers(file, () => write(file, text))
}

async function write(file: string, text: string): Promise<void> {
  written.set(key(file), hashText(text))
  const temp = tempPath(file)
  try {
    await writeFile(temp, text, 'utf8')
    await renameOnceFree(temp, file)
  } catch (error) {
    // The real file was never touched, so drop the claim we just made.
    written.delete(key(file))
    throw error
  }
}

// The name a write is staged under before it is renamed into place. The
// watcher has to know this shape to keep our own half written files out of
// what it reports, and it is exported so that agreement is something a test can
// check rather than something two files happen to say the same way. Making it
// unique per write instead of per process was tried, to keep two writes to one
// file apart; queueing them does that without moving this out from under the
// watcher, which did not notice and reported every temp file as a new card.
export function tempPath(file: string): string {
  return `${file}.tmp${process.pid}`
}

// Windows refuses to rename over a file somebody else has open, and on this
// platform somebody usually does: the watcher stats what it sees change, a
// reader may be part way through the same file, and the indexer and the virus
// scanner both take a look at anything just written. The lock is momentary, so
// the write waits it out rather than reporting a failure the user cannot act
// on. Bounded, and only for the errors that mean "held right now" - anything
// else, and the first attempt is the answer.
const HELD = new Set(['EPERM', 'EACCES', 'EBUSY'])
const RETRIES = 6
const BACKOFF_MS = 25

async function renameOnceFree(temp: string, file: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(temp, file)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? ''
      if (attempt >= RETRIES || !HELD.has(code)) throw error
      await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS))
    }
  }
}

export function forgetWrite(file: string): void {
  written.delete(key(file))
}

// True when the file on disk still holds exactly what we wrote last.
export async function isOwnWrite(file: string): Promise<boolean> {
  const expected = written.get(key(file))
  if (!expected) return false
  try {
    return hashText(await readFile(file, 'utf8')) === expected
  } catch {
    return false
  }
}

// Autosave writes without being asked, so it has to prove the file still holds
// what we last saw before it puts anything there. A baseline of null means the
// user already looked at both versions and chose ours.
export async function writeIfUnchanged(
  file: string,
  text: string,
  baseline: string | null
): Promise<SaveResult> {
  if (baseline !== null) {
    let disk: string | null = null
    try {
      disk = await readFile(file, 'utf8')
    } catch {
      // Gone from disk. Nothing of the user's is at risk, so put it back.
      disk = null
    }
    if (disk !== null && hashText(disk) !== baseline) {
      return { ok: false, disk, mine: text }
    }
  }
  await writeText(file, text)
  return { ok: true, hash: hashText(text) }
}
