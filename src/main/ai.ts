import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import {
  chooseWorkspace,
  connectText,
  readAiAccess,
  readChangeNotices,
  type AiConnect,
  type AiSettings,
  type AiVaultRow,
  type ChangeNotices
} from '../shared/ai'
import { readVaults, samePath } from '../shared/vaults'
import { userDataDir } from '../mcp/state'
import { workspaceFolders, workspaceIdentity } from './vault/store'
import { giveWorkspaceId } from './vault/workspace'
import { readState, writeState } from './state'

// Settings, under AI, v0.4 step 9. What the page shows is read from state.json
// and from the folders every time, never kept: the server an agent talks to
// reads the same file on every call, and a page holding its own copy could say
// a workspace was open that the file no longer lets in.
//
// One change at a time. Two ticks close together each read the file and write
// it back, and the second must read what the first wrote.
let turn: Promise<unknown> = Promise.resolve()

function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const next = turn.then(work, work)
  turn = next.catch(() => undefined)
  return next
}

export async function aiSettingsNow(): Promise<AiSettings> {
  const state = await readState()
  const access = readAiAccess(state.ai)
  // Every folder this app knows, and a chosen one it no longer lists: a choice
  // that stayed in the file with no row to take it off would be a door nobody
  // could find to shut.
  const paths = readVaults(state.vaults)
  for (const path of Object.keys(access.vaults)) {
    if (!paths.some((one) => samePath(one, path))) paths.push(path)
  }
  const vaults: AiVaultRow[] = []
  for (const path of paths) {
    const key = Object.keys(access.vaults).find((one) => samePath(one, path))
    const chosen = key === undefined ? [] : access.vaults[key]
    try {
      const workspaces = []
      for (const folder of await workspaceFolders(path)) {
        const { id, name } = await workspaceIdentity(folder.path, folder.name)
        const known = id === '' ? null : id
        workspaces.push({ folder: folder.name, name, id: known, chosen: known !== null && chosen.includes(known) })
      }
      vaults.push({ path, readable: true, workspaces })
    } catch {
      // A drive that is not plugged in. What was chosen in it stays in the file.
      vaults.push({ path, readable: false, workspaces: [] })
    }
  }
  return { on: access.on, vaults, notices: readChangeNotices(state.changeNotices), connect: connection() }
}

// The server beside this build, on the electron this app is running on. The
// settings folder is named only when it is not the one the server would work
// out for itself, which is the case in a test run and nowhere else.
function connection(): AiConnect {
  const server = join(__dirname, '../mcp/bothy-mcp.cjs')
  const env: Record<string, string> = { ELECTRON_RUN_AS_NODE: '1' }
  const own = app.getPath('userData')
  if (!samePath(own, userDataDir({ ...process.env, BOTHY_USER_DATA: '' }))) env.BOTHY_USER_DATA = own
  return { ...connectText(process.execPath, server, env, process.platform), server, built: existsSync(server) }
}

export function setAiOn(on: boolean): Promise<AiSettings> {
  return inTurn(async () => {
    const access = readAiAccess((await readState()).ai)
    await writeState({ ai: { ...access, on } })
    return aiSettingsNow()
  })
}

// A workspace ticked or not. Nothing is changed while the switch is
// off, so the refusal is here and not only in the page - a page that let a
// press through would otherwise change a choice the person was shown as locked.
export function setAiWorkspace(vault: unknown, folder: unknown, chosen: boolean): Promise<AiSettings> {
  return inTurn(async () => {
    const state = await readState()
    const access = readAiAccess(state.ai)
    if (!access.on || typeof vault !== 'string' || typeof folder !== 'string') return aiSettingsNow()
    const listed = [...readVaults(state.vaults), ...Object.keys(access.vaults)]
    if (!listed.some((one) => samePath(one, vault))) return aiSettingsNow()
    let folders: { name: string; path: string }[]
    try {
      folders = await workspaceFolders(vault)
    } catch {
      return aiSettingsNow()
    }
    const found = folders.find((one) => one.name === folder)
    if (!found) return aiSettingsNow()
    let { id } = await workspaceIdentity(found.path, found.name)
    if (id === null || id === '') {
      if (!chosen) return aiSettingsNow()
      id = await giveWorkspaceId(found.path)
    }
    await writeState({ ai: chooseWorkspace(access, vault, id, chosen) })
    return aiSettingsNow()
  })
}

export async function changeNoticesNow(): Promise<ChangeNotices> {
  return readChangeNotices((await readState()).changeNotices)
}

export function setChangeNotices(value: unknown): Promise<ChangeNotices> {
  return inTurn(async () => {
    if (value === 'short' || value === 'none') await writeState({ changeNotices: value })
    return changeNoticesNow()
  })
}
