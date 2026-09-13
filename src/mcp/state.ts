import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { USER_DATA_NAME } from '../shared/app'
import { aiOff, readAiAccess, type AiAccess } from '../shared/ai'
import { EDITING_FILE, readEditing, type Editing } from '../shared/editing'

// The server an agent starts is not the app, and has no Electron to ask where
// the app keeps state.json. So the answer Electron gives - its appData folder
// for this platform, then the name from package.json - is worked out here the
// same way.
//
// BOTHY_USER_DATA overrides it. The tests use that so a run never reads or
// writes the real settings, and a person with more than one copy of the app
// can point a server at the one they mean.
export function userDataDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir()
): string {
  if (env.BOTHY_USER_DATA) return env.BOTHY_USER_DATA
  const base =
    platform === 'win32'
      ? (env.APPDATA ?? join(home, 'AppData', 'Roaming'))
      : platform === 'darwin'
        ? join(home, 'Library', 'Application Support')
        : (env.XDG_CONFIG_HOME ?? join(home, '.config'))
  return join(base, USER_DATA_NAME)
}

// What the window's hand is on, v0.4 step 6: see shared/editing.ts. Read before
// every write, like the switch below. A file left by a window whose process is
// gone is nothing - asked of the system rather than of the file's age, since a
// box can be typed into for as long as anybody likes.
export async function readHands(): Promise<Editing | null> {
  try {
    const editing = readEditing(JSON.parse(await readFile(join(userDataDir(), EDITING_FILE), 'utf8')) as unknown)
    return editing && alive(editing.pid) ? editing : null
  } catch {
    return null
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // There, and not ours to signal.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

// Read on every call and never kept. The switch is turned in the app while an
// agent's session may already be running, and a server that remembered the
// answer it started with would keep a door open that was shut a minute ago.
export async function readAccess(): Promise<AiAccess> {
  try {
    const state = JSON.parse(await readFile(join(userDataDir(), 'state.json'), 'utf8')) as unknown
    const ai = state !== null && typeof state === 'object' ? (state as Record<string, unknown>).ai : null
    return readAiAccess(ai)
  } catch {
    // No file, or one that does not parse: nobody has turned anything on.
    return aiOff()
  }
}
