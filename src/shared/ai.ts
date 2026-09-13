import { samePath } from './vaults'

// What an agent may reach, v0.4. The rules:
//
//   - One switch over all of it, off until it is turned on. Turning it off
//     keeps the choices underneath, so turning it back on is one move.
//   - Under the switch, the vaults and the workspaces in them, chosen one by
//     one, in Settings.
//   - A workspace made later is not chosen. It is ticked on its own or not at
//     all.
//   - What is not chosen is not there. An agent is never told it exists.
//
// Kept in state.json beside the theme and not in a vault, for the theme's
// reason and one of its own: a vault copied to another machine must not arrive
// with an agent already let into it.
//
// A workspace is chosen by the id in its workspace.json rather than by its
// folder. Renaming a workspace never moves the folder, but a person can, and a
// choice that quietly lapsed when they did would be a door that shut on its
// own - or, worse, one that opened for the next folder given the old name.
export type AiAccess = {
  on: boolean
  // Vault folder -> the ids of the workspaces in it an agent may reach.
  vaults: Record<string, string[]>
}

// What an absent or unreadable key means: off, with nothing chosen.
export const aiOff = (): AiAccess => ({ on: false, vaults: {} })

// The file is one a person can edit, so it is read rather than believed. True
// and nothing else turns the switch on - a hand-written "yes" is not a switch
// anybody turned. Two spellings of one vault, which Windows treats as one
// folder, become one entry.
export function readAiAccess(value: unknown): AiAccess {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return aiOff()
  const raw = value as Record<string, unknown>
  const vaults: Record<string, string[]> = {}
  const listed = raw.vaults
  if (listed !== null && typeof listed === 'object' && !Array.isArray(listed)) {
    for (const [path, ids] of Object.entries(listed as Record<string, unknown>)) {
      if (path === '' || !Array.isArray(ids)) continue
      const known = Object.keys(vaults).find((one) => samePath(one, path)) ?? path
      const clean = ids.filter((id): id is string => typeof id === 'string' && id !== '')
      const merged = [...new Set([...(vaults[known] ?? []), ...clean])]
      if (merged.length > 0) vaults[known] = merged
    }
  }
  return { on: raw.on === true, vaults }
}

// The vaults an agent may look in. None while the switch is off, which is the
// whole of what the switch does.
export function reachableVaults(access: AiAccess): string[] {
  return access.on ? Object.keys(access.vaults) : []
}

// One tick in Settings. The vault is found by the same two spellings
// readAiAccess folds together, and a vault left with nothing chosen goes from
// the file rather than staying as an empty list nobody can see a reason for.
export function chooseWorkspace(access: AiAccess, vaultPath: string, id: string, chosen: boolean): AiAccess {
  const key = Object.keys(access.vaults).find((one) => samePath(one, vaultPath)) ?? vaultPath
  const was = access.vaults[key] ?? []
  const ids = chosen ? [...new Set([...was, id])] : was.filter((one) => one !== id)
  const vaults = { ...access.vaults }
  if (ids.length > 0) vaults[key] = ids
  else delete vaults[key]
  return { on: access.on, vaults }
}

// Whether the line says what changed, the two values: a short
// notice, or nothing. The same answer covers "Changed outside Bothy",
// so it is not a key under `ai` - a text editor can change a card with the
// switch off.
export type ChangeNotices = 'short' | 'none'

export const CHANGE_NOTICES_DEFAULT: ChangeNotices = 'short'

export function readChangeNotices(value: unknown): ChangeNotices {
  return value === 'short' || value === 'none' ? value : CHANGE_NOTICES_DEFAULT
}

// What Settings, under AI, shows. A workspace is named by its folder on the way
// back in, because the one thing a workspace with no id yet cannot be named by
// is its id.
export type AiWorkspaceRow = { folder: string; name: string; id: string | null; chosen: boolean }
export type AiVaultRow = { path: string; readable: boolean; workspaces: AiWorkspaceRow[] }
export type AiConnect = { json: string; command: string; server: string; built: boolean }
export type AiSettings = { on: boolean; vaults: AiVaultRow[]; notices: ChangeNotices; connect: AiConnect }

// The server as an agent's client starts it, written out both ways
// The settings block most clients take pasted in, and one command for the
// shell this machine has. Quoted with single quotes, since a folder can hold a
// dollar sign and neither shell expands anything inside those.
export function connectText(
  exe: string,
  server: string,
  env: Record<string, string>,
  platform: string
): { json: string; command: string } {
  const json = JSON.stringify({ mcpServers: { bothy: { command: exe, args: [server], env } } }, null, 2)
  const pairs = Object.entries(env)
  if (platform === 'win32') {
    const quote = (text: string): string => `'${text.replace(/'/g, "''")}'`
    // Piped, or PowerShell does not wait. electron.exe is a windowed program to
    // Windows, and PowerShell hands the prompt back as soon as one starts:
    // measured, it exited at 488 ms and the server's answers after the
    // first never came out. Through a pipe it waits, carries every line both
    // ways, and exits some 60 ms after its input ends.
    return {
      json,
      command: [...pairs.map(([key, value]) => `$env:${key} = ${quote(value)}`), `& ${quote(exe)} ${quote(server)} | Out-Default`].join('; ')
    }
  }
  const quote = (text: string): string => `'${text.replace(/'/g, "'\\''")}'`
  return { json, command: [...pairs.map(([key, value]) => `${key}=${quote(value)}`), quote(exe), quote(server)].join(' ') }
}

// Whether one workspace is open to an agent. A workspace with no id in its
// file cannot have been chosen, so it never is.
export function reachable(access: AiAccess, vaultPath: string, workspaceId: string | null): boolean {
  if (!access.on || !workspaceId) return false
  const vault = Object.keys(access.vaults).find((one) => samePath(one, vaultPath))
  return vault !== undefined && access.vaults[vault].includes(workspaceId)
}
