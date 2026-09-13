import { reachable, reachableVaults, type AiAccess } from '../shared/ai'
import { samePath } from '../shared/vaults'
import { workspaceFolders, workspaceIdentity } from '../main/vault/store'
import { answer, refusal, type Tool, type ToolResult } from './result'

export const NOTHING_CHOSEN =
  'AI access is on, but no workspace has been chosen for it. Workspaces are chosen in Bothy Settings, under AI.'

export type OpenWorkspace = { vault: string; id: string; name: string; path: string }

// The workspaces an agent may use, in every vault it may look in, and nothing
// else. A vault that is gone, or a chosen id no folder carries any more, opens
// nothing and says nothing: what is not there to use is not there.
export async function openWorkspaces(access: AiAccess): Promise<OpenWorkspace[]> {
  const open: OpenWorkspace[] = []
  for (const vault of reachableVaults(access)) {
    let folders: { name: string; path: string }[]
    try {
      folders = await workspaceFolders(vault)
    } catch {
      continue
    }
    for (const folder of folders) {
      const { id, name } = await workspaceIdentity(folder.path, folder.name)
      if (id !== null && reachable(access, vault, id)) open.push({ vault, id, name, path: folder.path })
    }
  }
  return open
}

// How a workspace is named back to an agent in every answer: enough to say
// which one it was, not where on the disk it lives.
export const named = ({ id, name, vault }: OpenWorkspace) => ({ id, name, vault })

export const WORKSPACE_INPUT = {
  workspace: { type: 'string', description: 'The id of the workspace, from list_workspaces.' },
  vault: {
    type: 'string',
    description: 'The vault folder the workspace is in, from list_workspaces. Needed only when two open workspaces share an id.'
  }
} as const

type Found = { ok: true; workspace: OpenWorkspace } | { ok: false; result: ToolResult }

// The one workspace a call is about. A workspace nobody chose is answered the
// way one that does not exist is, word for word: the rule is that it is not
// there, and a different sentence would say that it is.
//
// A copied workspace folder carries its id with it, so two vaults can each
// hold a workspace with the same id. That is not guessed at: the agent is told
// where both are and asked to say which.
export async function findWorkspace(args: Record<string, unknown>, access: AiAccess): Promise<Found> {
  const id = typeof args.workspace === 'string' ? args.workspace : ''
  if (id === '') {
    return { ok: false, result: refusal('Say which workspace: workspace takes an id from list_workspaces.') }
  }
  const vault = typeof args.vault === 'string' && args.vault !== '' ? args.vault : null
  const open = (await openWorkspaces(access)).filter(
    (one) => one.id === id && (vault === null || samePath(one.vault, vault))
  )
  if (open.length === 1) return { ok: true, workspace: open[0] }
  if (open.length === 0) {
    const where = vault === null ? '' : ` in ${vault}`
    return {
      ok: false,
      result: refusal(`No workspace with the id ${id} is open to this agent${where}. list_workspaces gives the ones that are.`)
    }
  }
  const vaults = [...new Set(open.map((one) => one.vault))]
  if (vaults.length === open.length) {
    return {
      ok: false,
      result: refusal(`${open.length} open workspaces have the id ${id}, in ${vaults.join(' and ')}. Say which one with vault.`)
    }
  }
  return {
    ok: false,
    result: refusal(
      `More than one workspace in ${vaults.join(' and ')} has the id ${id}, so they cannot be told apart. A copied workspace keeps its id; one of them needs an id of its own in its workspace.json.`
    )
  }
}

export const LIST_WORKSPACES: Tool = {
  name: 'list_workspaces',
  description:
    'List the Bothy workspaces this agent may use, with the vault folder each one is in. A workspace holds one kanban and one canvas. Other tools take a workspace id from this list.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  run: async (_args, access) => {
    const workspaces = (await openWorkspaces(access)).map(named)
    return answer(workspaces.length > 0 ? { workspaces } : { workspaces, note: NOTHING_CHOSEN })
  }
}
