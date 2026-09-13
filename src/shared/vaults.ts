// The vaults this app knows about. Step D2.
//
// state.json has held `lastVault` since v0.1 - one string, the folder to open
// on the way up. The foot of the panel asks a different question: which folders
// has this person worked in, so one of them can be switched to without going
// through a file dialog to find something the app already knew.
//
// Most recent first, so the menu is in the order a hand would look for them,
// and capped: a list nobody prunes is a menu that grows until it is useless.
// Eight is what fits under the foot without the menu becoming its own screen.
export const VAULTS_KEPT = 8

// Windows does not distinguish two paths by case, so neither does this. Without
// it, opening the same folder through a dialog that answered `D:\Work` after it
// was remembered as `D:\work` puts the same vault in the menu twice, with a
// tick on one of them. Exported: what an agent may reach is kept by
// vault folder too, and a second spelling of this rule would be a second answer.
export const samePath = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

export function readVaults(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const list: string[] = []
  for (const one of value) {
    if (typeof one !== 'string' || one === '') continue
    if (list.some((seen) => samePath(seen, one))) continue
    list.push(one)
  }
  return list.slice(0, VAULTS_KEPT)
}

// Moved to the front rather than added, so opening one that is already known
// does not leave the list in the order of first sight. The path is stored as it
// was given: it is what gets opened, and the case a person typed is the case
// they see in the menu.
export function rememberVault(list: readonly string[], path: string): string[] {
  return readVaults([path, ...list.filter((one) => !samePath(one, path))])
}

// Whether a path is one of the known ones, asked before anything is opened by
// it. The menu can only offer what is on the list, but the menu is not the only
// thing that can send this message, and a channel that opens any folder a
// renderer names is a channel that opens any folder at all.
export const isKnownVault = (list: readonly string[], path: string): boolean =>
  list.some((one) => samePath(one, path))
