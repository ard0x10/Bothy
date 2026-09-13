import { join } from 'node:path'
import { app, BrowserWindow, nativeTheme, shell } from 'electron'
import { APP_ID, APP_NAME } from '../shared/app'
import { closeVaultWatcher, registerIpc } from './ipc'
import { watchAiTrail } from './aitrail'
import { writeHands } from './editing'
import { registerCapture, releaseCapture } from './capture'
import { closeSettings } from './settings'
import { ICON } from './icon'
import { privilegeImageScheme, registerImageProtocol } from './images'
import { colorsNow, readState, sidebarNow } from './state'
import { colorsArgument } from '../shared/colors'
import { sidebarArgument } from '../shared/sidebar'

// Before the app is ready, and before anything else in this file runs. A scheme
// registered after that point is registered too late to be privileged, and the
// failure is silent: images simply never load.
privilegeImageScheme()

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 600,
    title: APP_NAME,
    icon: ICON,
    // The ground the frame paints before the page does. It follows a custom
    // --bg-app when there is one (step 9), because a window whose own ground
    // disagrees with the page shows the difference for exactly as long as the
    // load takes.
    backgroundColor: colorsNow()['bg-app'] ?? '#16161a',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      // Step 9. The colours travel with the window rather than being asked for
      // afterwards: the preload reads this before any page script runs, so the
      // first frame is already painted in them.
      // D1 travels the same way and for the same reason: a panel saved at 380
      // that paints once at 210 and jumps is the flash this road exists to
      // avoid.
      additionalArguments: [colorsArgument(colorsNow()), sidebarArgument(sidebarNow())]
    }
  })

  // Showing only once the first frame is painted avoids a white flash.
  registerIpc(window)

  // Held for as long as this window lives and no longer: the shortcut works
  // while Bothy is running,
  // background or minimised, and the keys go back to the system when it quits.
  registerCapture(window)
  // What an agent writes while this window is up, and only then: see
  // main/aitrail.ts.
  const stopAiTrail = watchAiTrail(window)
  // Nothing in hand yet, whatever a window before this one left behind; and
  // nothing once this one is gone. See main/editing.ts.
  void writeHands([]).catch(() => undefined)
  window.once('closed', () => {
    void writeHands([]).catch(() => undefined)
    void stopAiTrail()
    releaseCapture()
    // Electron already takes a child down with its parent, so this is the belt
    // rather than the braces - and it is here because the alternative is a
    // settings window outliving the app by however long that promise holds.
    closeSettings()
  })

  window.once('ready-to-show', () => window.show())

  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // A link in a card description is the user's text, not ours. Following it in
  // place would replace the app with a web page and there is no way back, so
  // every navigation away from the renderer goes to the system browser instead.
  window.webContents.on('will-navigate', (event, url) => {
    if (url === window.webContents.getURL()) return
    event.preventDefault()
    if (/^https?:/i.test(url)) void shell.openExternal(url)
  })

  const devServer = process.env.ELECTRON_RENDERER_URL
  if (devServer) {
    window.loadURL(devServer)
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  app.setName(APP_NAME)
  // The other half of the scheme. It has to be here rather than beside the
  // window, because a protocol belongs to the session and the window is only
  // the first thing that asks on it.
  registerImageProtocol()
  // Before the first window, not after it. Electron decides the frame colour
  // and what prefers-color-scheme reports from this, so setting it late means
  // the window opens in the wrong theme and corrects itself a frame later -
  // which is the flash every themed app is judged by.
  // Also fills the colour cache the window is about to be built from, which is
  // why it stays a single read rather than one per thing it answers.
  const { theme } = await readState()
  if (theme === 'light' || theme === 'dark') nativeTheme.themeSource = theme
  // Without this the taskbar files our window under electron.exe, and pinning
  // it produces a shortcut that launches Electron with no app. It has to be set
  // before the first window exists.
  app.setAppUserModelId(APP_ID)
  createWindow()
})

app.on('window-all-closed', () => {
  // Unchanged by step 6, and deliberately: the shortcut
  // lives only as long as the app does, so there is nothing here to keep alive
  // after the last window goes.
  releaseCapture()
  closeSettings()
  void closeVaultWatcher().finally(() => app.quit())
})
