import { app } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Colors } from '../shared/colors'
import { readViewport, type Viewport } from '../shared/viewport'
import { readSidebar, type SidebarState } from '../shared/sidebar'
import { readVaults, rememberVault } from '../shared/vaults'
import { CAPTURE_DEFAULT, readAccelerator } from '../shared/keys'

// The few things that cannot live in a vault, so they sit with the app
// instead: which vault was open last, and - since step 8 of v0.2 - which theme
// the user picked. The theme is here rather than in workspace.json because it
// is one answer for the whole app: a window cannot be light for one folder and
// dark for the next, and "follow the system" is not a fact about a vault.
// The canvas viewport joined them in step 3 of v0.3, keyed by workspace path.
// It is here and not in canvas.json because panning changes it every frame a
// hand is moving: in the vault it would put a disk write and a watcher event
// behind every mouse move. What that costs is that the place you were standing
// does not travel with a workspace, only the drawing does.
// The left panel's width and whether it is open joined them in D1, for the
// same reason the theme is here: it is one answer for the whole app, not a
// fact about a vault.
type AppState = {
  lastVault?: string
  // The folders this app has been pointed at, most recent first. `lastVault`
  // stays what it was - the one to open on the way up - because the two answer
  // different questions and a list whose first entry is also the answer to
  // "which one now" is a list that cannot hold a vault you looked at and left.
  vaults?: unknown
  // What the theme picker holds, and the base under Custom. See
  // shared/themes.ts for how they are read.
  theme?: unknown
  customBase?: unknown
  colors?: Colors
  // Where a card opens. Here for the theme's reason: it is how this app
  // behaves, not a fact about a vault. Unknown, because the file can hold
  // anything; readCardView is what turns it into an answer.
  cardView?: unknown
  // What a workspace opens on. See shared/opening.ts.
  workspaceOpens?: unknown
  viewports?: Record<string, unknown>
  sidebar?: unknown
  // The keys quick capture is registered under, D3. Here rather than in a
  // vault for the reason the theme is: it is held with the operating system
  // for the whole app, and a shortcut that meant one thing in one folder and
  // something else in the next is a shortcut nobody can learn.
  capture?: unknown
  // What an agent may reach, v0.4, read by shared/ai.ts. The server an agent
  // starts reads this same key on every call.
  ai?: unknown
  // Whether the line says what changed. See readChangeNotices.
  changeNotices?: unknown
}

// A cache for the panel: the window is built with
// this value as a launch argument, so it has to be readable without waiting on
// a second read of the file.
let panel: SidebarState = readSidebar(null)

export function sidebarNow(): SidebarState {
  return panel
}

// The same cache again, for the key quick capture is registered under: main
// registers it before the first window exists, and reading the file a second
// time to find out what it is would be a second answer free to disagree with
// the first.
let capture: string = CAPTURE_DEFAULT

export function captureKeyNow(): string {
  return capture
}

export async function writeCaptureKey(accelerator: string): Promise<void> {
  await writeState({ capture: accelerator })
}

const file = (): string => join(app.getPath('userData'), 'state.json')

export async function readState(): Promise<AppState> {
  try {
    const state = JSON.parse(await readFile(file(), 'utf8')) as AppState
    panel = readSidebar(state.sidebar)
    capture = readAccelerator(state.capture) ?? CAPTURE_DEFAULT
    return state
  } catch {
    return {}
  }
}

// Merged, not replaced. With one key in the file the difference never showed;
// with two, `writeState({ lastVault })` would wipe the theme every time a vault
// was chosen - the caller would have to remember every other key there is,
// which is the kind of thing that stays right until somebody adds a third one.
// The viewport for one workspace, or null when there is none to trust. The
// file is one a person can edit and an older version can leave behind, so what
// comes back is checked rather than believed.
export async function readWorkspaceViewport(workspacePath: string): Promise<Viewport | null> {
  const state = await readState()
  return readViewport(state.viewports?.[workspacePath] ?? null)
}

// Merged into the map rather than replacing it, for the reason writeState
// itself gives: a caller that had to remember every other workspace would be
// right until it was not.
export async function writeWorkspaceViewport(
  workspacePath: string,
  viewport: Viewport
): Promise<void> {
  const state = await readState()
  await writeState({ viewports: { ...state.viewports, [workspacePath]: viewport } })
}

// Guarded on the way out as well as on the way in: the renderer is what sends
// this, and what gets written is what the next launch paints with before it can
// be corrected.
export async function knownVaults(): Promise<string[]> {
  return readVaults((await readState()).vaults)
}

// Called by whatever actually opened a folder, rather than by whatever asked
// for one: a path that was chosen and then failed to open is not a vault this
// app knows about, and a menu that offers it is a menu with a dead row in it.
export async function rememberOpenedVault(path: string): Promise<void> {
  const state = await readState()
  await writeState({ vaults: rememberVault(readVaults(state.vaults), path) })
}

export async function writeSidebar(state: unknown): Promise<SidebarState> {
  const clean = readSidebar(state)
  await writeState({ sidebar: clean })
  return clean
}

export async function writeState(patch: AppState): Promise<void> {
  const state = { ...(await readState()), ...patch }
  // After the merge, not inside readState's half of it: readState has just put
  // what the file held into the caches, and the patch on top of it is the whole
  // point of this call.
  panel = readSidebar(state.sidebar)
  capture = readAccelerator(state.capture) ?? CAPTURE_DEFAULT
  await writeFile(file(), `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}
