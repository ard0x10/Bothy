// What a workspace opens on when you go into it, one answer for the whole app.
// The kanban every time, or the tab it was left on. The tab a workspace was
// left on is written down either way, so choosing the second answer later
// brings back exactly where each workspace was.
export type WorkspaceOpens = 'kanban' | 'last'

export const WORKSPACE_OPENS_DEFAULT: WorkspaceOpens = 'kanban'

// state.json is a file a person can edit and an older version can leave
// behind, so what comes back from it is checked rather than believed.
export function readWorkspaceOpens(value: unknown): WorkspaceOpens {
  return value === 'kanban' || value === 'last' ? value : WORKSPACE_OPENS_DEFAULT
}
