import { copyFile, mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { hashBytes, hashFile } from './hash'
import { oneNameAtATime } from './writer'

// Attachments are copied into the workspace, never referenced where they sit.
// The reason is the promise the whole format is built on: a workspace has to be
// something you can back up, move to another machine and still open. A card
// pointing at C:\Users\someone\Downloads is a card that works on exactly one
// computer, and says nothing when it stops.
export const FILES = 'files'

export function filesDir(workspacePath: string): string {
  return join(workspacePath, FILES)
}

// What a card is allowed to carry. A bare name and nothing else: no separator,
// no `..`, no drive letter. It is not a style rule - the folder is fixed, so a
// name that could hold a path could point outside the workspace, and then the
// copy that was the whole point would be pointing at a machine again.
export function isAttachmentName(name: string): boolean {
  if (!name || name === '.' || name === '..') return false
  if (/[\\/]/.test(name)) return false
  if (/^[a-zA-Z]:/.test(name)) return false
  // Reserved on Windows, and this app is built for Windows first.
  return !/[<>:"|?*\u0000-\u001f]/.test(name)
}

// Same rule the cards use: the second one to want a name takes `-2`. Nothing is
// ever overwritten, because the file already sitting there belongs to some
// other card and nobody asked for it to go.
async function freeName(dir: string, name: string): Promise<string> {
  const ext = extname(name)
  const stem = name.slice(0, name.length - ext.length) || 'file'
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? `${stem}${ext}` : `${stem}-${n}${ext}`
    try {
      await stat(join(dir, candidate))
    } catch {
      return candidate
    }
  }
}

// Copies one file in and answers with the name the card should carry. The
// source name is cleaned the same way a card's file name is, so what lands in
// the folder is something a person can read and a card can hold.
export async function attachFile(workspacePath: string, source: string): Promise<string> {
  const dir = filesDir(workspacePath)
  await mkdir(dir, { recursive: true })

  const wanted = tidy(basename(source))
  return oneNameAtATime(dir, async () => {
    const name = await freeName(dir, wanted)
    await copyFile(source, join(dir, name))
    return name
  })
}

// Accents and the characters Windows will not take come out; the extension is
// kept, because it is what decides which program opens the file.
function tidy(name: string): string {
  const ext = extname(name)
  const stem = name
    .slice(0, name.length - ext.length)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[<>:"|?*\\/\u0000-\u001f]/g, '-')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 80)
  const kept = ext.replace(/[<>:"|?*\\/\u0000-\u001f]/g, '')
  return (stem || 'file') + kept
}

// Everything sitting in files/, so the panel can tell an attachment that is
// there from a name with nothing behind it. A workspace with no files/ folder
// has no attachments, which is not an error - most workspaces will never grow
// one.
export async function listFiles(workspacePath: string): Promise<string[]> {
  try {
    const entries = await readdir(filesDir(workspacePath), { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

// When each of those came into files/, for the panel's "Added 2 minutes ago".
// Read off the disk rather than written on the card: the card's `files` list is
// bare names by the format's rule, and a date beside each one would change the
// format for a line of small grey text.
//
// The creation time, not the modification time. A copy keeps the time the
// original was last written, which can be years before it was attached; the
// copy itself is born when it is made. What that costs is said here so it is
// not found out later: a vault copied to another machine is born again there,
// and every file in it reads as added the day it arrived.
export async function whenAdded(
  workspacePath: string,
  names: string[]
): Promise<Record<string, number>> {
  const added: Record<string, number> = {}
  for (const name of names) {
    try {
      added[name] = (await stat(join(filesDir(workspacePath), name))).birthtimeMs
    } catch {
      // Gone between the listing and the look. It will be missing on the next
      // read, which is where that is said.
    }
  }
  return added
}

// Where a name resolves to, or null when the name is not one a card may carry.
// Every path handed to the shell goes through here, so a card edited by hand
// into `files: [../../../etc/passwd]` opens nothing.
export function resolveAttachment(workspacePath: string, name: string): string | null {
  if (!isAttachmentName(name)) return null
  return join(filesDir(workspacePath), name)
}

// The canvas asks a different question than a card does, and we settled it:
// the same image dropped twice is one file on disk, shared by both objects.
//
// A card carries a list of the files that belong to it, so a second copy under
// a second name is the honest answer there - two cards, two attachments, and
// deleting one card's file cannot take the other's. A canvas is one surface: a
// screenshot put in three places is one picture looked at three times, and
// three copies of eight megabytes is twenty four megabytes of the same pixels.
//
// Settled by content and never by name, because the name is the one thing about
// a dropped file that carries no information - two shots of the same board are
// both Screenshot 2026-09-10.png and are not the same picture.
//
// The digest is a thunk rather than a string, and that is the whole reason the
// size comes first: a folder with nothing of this length in it is answered
// without either file being read. Dropping a picture into a folder of pictures
// should not cost the folder.
async function sameContent(
  dir: string,
  size: number,
  digest: () => Promise<string>
): Promise<string | null> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return null
  }

  const candidates: string[] = []
  for (const entry of entries) {
    try {
      const found = await stat(join(dir, entry))
      if (found.isFile() && found.size === size) candidates.push(entry)
    } catch {
      // Gone between the listing and the look. Not a match, and not an error
      // either - it is simply not there to be one.
    }
  }
  if (candidates.length === 0) return null

  const wanted = await digest()
  for (const name of candidates) {
    try {
      if ((await hashFile(join(dir, name))) === wanted) return name
    } catch {
      continue
    }
  }
  return null
}

// Copies an image in, or answers with the one already there holding the same
// bytes. Nothing is ever written over: a match is a file that is already what
// the copy would have been.
export async function attachImage(workspacePath: string, source: string): Promise<string> {
  const dir = filesDir(workspacePath)
  await mkdir(dir, { recursive: true })

  const size = (await stat(source)).size
  // The look for the same bytes is inside the turn too, or two copies of one
  // picture arriving together would both find nothing and both be written.
  return oneNameAtATime(dir, async () => {
    const found = await sameContent(dir, size, () => hashFile(source))
    if (found !== null) return found
    const name = await freeName(dir, tidy(basename(source)))
    await copyFile(source, join(dir, name))
    return name
  })
}

// The same for bytes with no file behind them, which is what the clipboard
// hands over. The name is only reached for when the content is new - so the
// same screenshot pasted twice keeps the first paste's name rather than growing
// a -2 beside a file that is already it.
export async function attachBytes(
  workspacePath: string,
  wanted: string,
  bytes: Uint8Array
): Promise<string> {
  const dir = filesDir(workspacePath)
  await mkdir(dir, { recursive: true })

  return oneNameAtATime(dir, async () => {
    const found = await sameContent(dir, bytes.length, async () => hashBytes(bytes))
    if (found !== null) return found
    const name = await freeName(dir, tidy(wanted))
    await writeFile(join(dir, name), bytes)
    return name
  })
}
