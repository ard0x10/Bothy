import { join } from 'node:path'

// The app's icon, for the frame and the taskbar while a window is up. The
// Start Menu shortcut points at the same file (scripts/install-shortcut.ps1),
// and a pinned taskbar icon is the shortcut's, so the two have to agree.
//
// The .ico holds each size drawn on its own from resources/icon.svg rather than
// one picture shrunk, which is what keeps 16 px from turning into a smudge.
// Bundled into out/main/index.js, so __dirname is out/main and the repo root is
// two up.
export const ICON = join(__dirname, '../../resources/icon.ico')
