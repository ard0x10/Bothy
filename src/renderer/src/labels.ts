import type { Label, Workspace } from '../../shared/types'
import { colourLabel, labelKeyOf } from '../../shared/labels'

// A tag the workspace has never heard of still needs a dot. Pointed at the
// theme's own variable rather than a hex value, or the one colour in the app
// that is written in JavaScript would stay a dark-theme grey on a light page -
// and it was written twice, here and in the palette, which is the second half
// of the same bug.
const FALLBACK = 'var(--text-dim)'

// What a tag on a card is. One of the six colours if it says one of their
// words - with whatever name the workspace hung on that colour - and otherwise
// a tag somebody wrote: matched without case, shown in the spelling the
// workspace uses, because a card may say "Urgent" where the workspace defines
// "urgent".
export function resolveLabel(workspace: Workspace, tag: string): Label {
  const key = labelKeyOf(tag)
  if (key) return colourLabel(workspace.labels, key)
  const found = workspace.labels.find(
    (label) => !label.key && label.name.toLowerCase() === tag.toLowerCase()
  )
  return found ?? { name: tag, color: FALLBACK }
}

// The same question across several workspaces, for the calendar's filter bar.
// The first folder that defines the tag wins: two folders are free to give one
// name two colours and there is no third place that could settle it, so the
// rule is at least stable rather than picking a different one each render.
//
// A colour is answered by the first folder as well, and for the same reason:
// two folders may have named green two different things.
export function resolveAcross(workspaces: Workspace[], tag: string): Label {
  const key = labelKeyOf(tag)
  if (key) {
    const owner = workspaces.find((workspace) =>
      workspace.labels.some((label) => label.key === key)
    )
    return colourLabel(owner?.labels ?? [], key)
  }
  for (const workspace of workspaces) {
    const found = workspace.labels.find(
      (label) => !label.key && label.name.toLowerCase() === tag.toLowerCase()
    )
    if (found) return found
  }
  return { name: tag, color: FALLBACK }
}
