import type { BrowserWindow } from 'electron'

// No menu bar, and no key that brings one back.
//
// `autoHideMenuBar` only hides the menu Electron builds when an app builds none
// of its own: Alt still drops File, Edit, View and Window over the top of the
// window. Not one of those four is this app's, and the three keys that reach
// the app - the palette, the views, quick capture - are listed under Shortcuts.
// So the window is given no menu at all, and Alt has nothing left to open.
//
// Windows and Linux only. On macOS the menu belongs to the application rather
// than to a window, Alt does not open it there, and taking it away would take
// the desktop's own keys with it.
export function noMenuBar(window: BrowserWindow): void {
  if (process.platform === 'darwin') return
  window.removeMenu()
}
