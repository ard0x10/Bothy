import { join } from 'node:path'
import { BrowserWindow } from 'electron'
import { colorsArgument, type Colors } from '../shared/colors'
import { colorsNow } from './state'
import { IPC } from '../shared/ipc'
import { ICON } from './icon'

// The settings window, D3. A button opens a window of its own rather than a
// sheet over the app, and the choice was about behaviour rather than taste.
//
// It is the second window this app builds, and the first one - the capture box
// - is where the rules came from. Three of them are the SAME and one is
// deliberately the opposite:
//
//   - one bundle, one html, chosen by hash (`#settings`). A second build target
//     was too much machinery for an input box in step 6, and it is still too
//     much for a page of settings.
//   - the colours travel as a launch argument, so the first frame is already in
//     them rather than corrected a frame later.
//   - it asks main for its state as it mounts rather than being pushed at. This
//     is the whole reason: a push sent when the window OBJECT exists arrives
//     before the renderer has subscribed, and the first one of a run hears
//     nothing.
//   - and the opposite: it does NOT hide on blur. The box puts itself down when
//     you look away because by then its work is done; this is a window you work
//     inside, and one that vanished the moment you clicked the window behind it
//     would be unusable for the one thing it is mostly for - watching that
//     window repaint while you pick a colour.
let sheet: BrowserWindow | null = null

function build(parent: BrowserWindow): BrowserWindow {
  const window = new BrowserWindow({
    width: 760,
    height: 620,
    // Below this the two columns stop being two columns: the section list on
    // the left has a width it cannot give up, and the rows on the right are a
    // label, a sentence and a control side by side.
    minWidth: 560,
    minHeight: 440,
    title: 'Settings',
    icon: ICON,
    // Kept above the window it changes, which is what a parent does here. Not
    // for tidiness: colours change live, and the whole point of doing it in a
    // second window is seeing the first one repaint underneath. A settings
    // window that can fall behind the app is one you change a colour in and
    // then go looking for.
    parent,
    // And not modal. The app stays usable while this is open - a person picking
    // an accent wants to click around the board and look at it.
    modal: false,
    frame: true,
    autoHideMenuBar: true,
    backgroundColor: colorsNow()['bg-app'] ?? '#16161a',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      additionalArguments: [colorsArgument(colorsNow())]
    }
  })

  // Destroyed rather than hidden, which is the other half of the box's
  // argument rather than a disagreement with it. The box is hidden because it
  // is opened many times a day and a person should not wait for a renderer to
  // type one line; this is opened rarely, and keeping one alive would be a
  // window holding a copy of every answer on it, going stale in the background.
  window.on('closed', () => {
    sheet = null
  })

  const devServer = process.env.ELECTRON_RENDERER_URL
  if (devServer) {
    void window.loadURL(`${devServer}#settings`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'settings' })
  }

  window.once('ready-to-show', () => window.show())

  return window
}

export function showSettings(parent: BrowserWindow): void {
  if (!sheet || sheet.isDestroyed()) sheet = build(parent)
  else {
    if (sheet.isMinimized()) sheet.restore()
    sheet.show()
  }
  sheet.focus()
}

export function closeSettings(): void {
  if (sheet && !sheet.isDestroyed()) sheet.destroy()
  sheet = null
}

// Every window, whichever one did the changing. The colours are one answer for
// the whole app and there are two windows on screen wearing them, so the one
// that stores them is the one that says so - and it says the STORED set rather
// than the asked-for one, because a value the guard refused must not repaint
// anything anywhere.
export function paintEveryWindow(colors: Colors): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    window.webContents.send(IPC.colorsChanged, colors)
  }
}
