import type { CapturePlace, CaptureTarget, CaptureWhere, Vault } from './types'

// Where a quick capture is allowed to go, and where it goes when nobody says
// otherwise. Both live here rather than in the box, because the box has no
// vault: it is one line of text and two menus in a window of its own, and
// everything it is allowed to offer has to arrive from the window that read the
// folders.
//
// The window sends this whenever it changes. Working it out in main instead
// would mean a second reader of the same folders, and two readers of one thing
// disagree eventually.
export function targetOf(vault: Vault | null, workspacePath: string | null): CaptureTarget {
  const places: CapturePlace[] = (vault?.workspaces ?? []).map((workspace) => ({
    path: workspace.path,
    name: workspace.name,
    columns: workspace.columns.map((column) => ({ id: column.id, title: column.title }))
  }))
  return { places, path: workspacePath }
}

// Which folder a capture is aimed at, columns or no columns. Split out from
// placeIn below because the box has to be able to stand in a workspace that
// cannot take a card: that is what every new workspace is, and the menu is how
// you get out of one.
//
// `wanted` is what the box asked for and it can be out of date by the time it
// arrives - the box may have sat open while the folder was renamed away. Then
// the window's own workspace answers, and the note is kept rather than refused.
export function workspaceIn(
  target: CaptureTarget,
  wanted?: CaptureWhere | null
): CapturePlace | null {
  const at = (path: string | null): CapturePlace | undefined =>
    path ? target.places.find((place) => place.path === path) : undefined
  // We settled the default: the workspace being worked in. A capture
  // is a thing you drop without looking, and the place you are is the place you
  // mean far more often than any other.
  return (wanted ? at(wanted.path) : undefined) ?? at(target.path) ?? target.places[0] ?? null
}

// The one place that decides where a capture lands, so the menus the box shows
// and the card the window writes can never disagree about it. The box calls it
// to choose what to open on; the window calls it again on what came back.
//
// Null means the aimed-at workspace cannot take a card. It does NOT then look
// for one that can: sending a note to a folder nobody named would be the worst
// kind of quiet, since the whole gesture is typing without looking. The box
// says so instead and the menu is one click away.
//
// A column that has gone missing under an open box falls to the first one,
// which is where an unchosen capture goes in any case.
export function placeIn(target: CaptureTarget, wanted?: CaptureWhere | null): CaptureWhere | null {
  const place = workspaceIn(target, wanted)
  if (!place || place.columns.length === 0) return null
  const column =
    wanted && wanted.path === place.path
      ? place.columns.find((one) => one.id === wanted.columnId)
      : undefined
  return { path: place.path, columnId: (column ?? place.columns[0]).id }
}
