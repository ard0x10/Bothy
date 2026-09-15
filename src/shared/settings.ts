import type { Themes } from './themes'
import type { CardView } from './cardview'
import type { WorkspaceOpens } from './opening'

// Everything the settings window opens knowing, D3.
//
// One shape and one channel rather than five calls, because it is one question:
// "what am I about to show". Five would each land in their own frame and the
// page would fill in a row at a time, which is the flash this app has spent two
// steps not doing.
//
// It is PULLED as the window mounts rather than pushed at it when the window is
// built - see settingsNow in main/ipc.ts for what pushing costs. What
// changes afterwards is pushed, on the channels that already existed for it.
export type SettingsNow = {
  // The picker, the custom set and the files in the folder. What each token is
  // actually painted with is read off the window itself: a copy of a theme's
  // values kept here would be wrong the moment the theme moved.
  themes: Themes
  // Where a card opens in the window that owns the vault.
  cardView: CardView
  // What a workspace opens on.
  workspaceOpens: WorkspaceOpens
  // What quick capture is registered under and whether the desktop actually
  // gave it to us. Both, because a key that is stored and not held is the one
  // row on this page that can be a lie on a given machine.
  capture: { accelerator: string; ok: boolean }
  vault: string | null
  vaults: string[]
}
