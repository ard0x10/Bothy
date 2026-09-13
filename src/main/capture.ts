import { join } from 'node:path'
import { BrowserWindow, globalShortcut } from 'electron'
import { colorsArgument } from '../shared/colors'
import { CAPTURE_DEFAULT, readAccelerator } from '../shared/keys'
import { captureKeyNow, colorsNow, writeCaptureKey } from './state'
import { IPC } from '../shared/ipc'
import type { CaptureTarget, CaptureWhere } from '../shared/types'

// Step 6 of v0.2. The shortcut
// works only while Bothy is running - in the background, minimised, behind
// whatever you are doing - and not once it has quit. So there is no tray icon
// and no background process, and v0.1's "the last window closing ends the app"
// is untouched. The shortcut is held for the life of the app and handed back to
// the system when it goes.
// What it is when nothing has been chosen. The keys themselves live in
// shared/keys.ts with the guard that reads them back, because the string is
// stored, read at the next launch and handed straight to Electron.
//
// D3 made it settable, which step 6 had said out loud it was not: "a binding
// the user can change wants a settings surface, and v0.2 has none." There is
// one now. What has not changed is the thing that made it worth saying - it
// must not fail silently, because another program may already own these keys.
let accelerator = CAPTURE_DEFAULT
let registered = false
let box: BrowserWindow | null = null

// Where a captured card could land, as the window last told us. Main cannot
// work this out for itself: which workspaces exist and which one is selected is
// the window's own state, and asking the disk would only ever guess.
let target: CaptureTarget = { places: [], path: null }

// The box's width, and its height with nothing open in it: the 1px edge, 16 of
// room, the input, 8, the row of menus, 16 of room and the edge again.
// It was a fixed 168, and the 62 under the menus held nothing. It is what
// the box opens at, so the first frame is already the right shape; after that
// the box says how tall it is itself (see fitCapture).
const WIDTH = 560
const RESTING = 1 + 16 + 32 + 8 + 32 + 16 + 1
// The input alone, which is what is left when there is no workspace to offer,
// and the most a list can ask for. The list scrolls inside its own 168 long
// before the second, so it only stops a torn number reaching the window.
const SHORTEST = 1 + 16 + 32 + 16 + 1
const TALLEST = 480

export function setCaptureTarget(next: CaptureTarget): void {
  target = next
  if (box && !box.isDestroyed()) box.webContents.send(IPC.captureTarget, target)
}

// Asked for by the box on the way up, rather than only pushed at it.
//
// Found by hand: pushing alone loses the first one every time. show()
// sends the moment the window object exists, which is long before its renderer
// has loaded the page and subscribed - so the very first box of a run heard
// nothing, said "nowhere to put it yet", and refused to save. Nothing pushed
// again afterwards because nothing had changed, so it stayed that way until the
// user happened to switch workspace. A pull cannot race: the box asks when it
// is ready to be answered.
export function captureTargetNow(): CaptureTarget {
  return target
}

export function captureStatus(): { accelerator: string; ok: boolean } {
  return { accelerator, ok: registered }
}

// D3. The answer is what is HELD, not what was asked for, and that is the whole
// design of this function: a global accelerator is the operating system's to
// give, and it can say no. So a refused change leaves the old keys working and
// comes back saying so, rather than storing a binding nothing is listening for
// and leaving quick capture off until somebody notices.
export async function setCaptureKey(
  parent: BrowserWindow,
  value: unknown
): Promise<{ accelerator: string; ok: boolean }> {
  const wanted = readAccelerator(value)
  // Refused by the guard rather than by the desktop: not an accelerator we are
  // willing to store. Nothing moves, and the caller sees the key it still has.
  if (!wanted) return captureStatus()
  if (wanted === accelerator && registered) return captureStatus()

  const previous = accelerator
  const held = registered
  if (held) globalShortcut.unregister(previous)

  if (globalShortcut.register(wanted, () => showCapture(parent))) {
    accelerator = wanted
    registered = true
    await writeCaptureKey(wanted)
    return captureStatus()
  }

  // Put back what was working. Without this, trying a combination another
  // program owns would cost the user the one they already had - the unregister
  // above has already happened by the time we find out.
  accelerator = previous
  registered = held ? globalShortcut.register(previous, () => showCapture(parent)) : false
  return captureStatus()
}

function build(parent: BrowserWindow): BrowserWindow {
  const window = new BrowserWindow({
    width: WIDTH,
    // One input, and under it the two menus, and nothing else. The size
    // is the page's, not the frame's: a frameless window measured 3.2 taller
    // inside than the height it was given, so the number here is the content.
    height: RESTING,
    useContentSize: true,
    // Frameless and unresizable: this is one line of text and a place to put
    // it, not a window anyone wants to arrange. It centres itself over whatever
    // is on screen rather than remembering a position, because the whole point
    // is that it appears where you are looking.
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: colorsNow()['bg-app'] ?? '#16161a',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      // The box is built the first time it is wanted, which can be long after
      // the colours were last changed - so it is handed whatever they are now,
      // and a themed app does not open one window in someone else's palette.
      additionalArguments: [colorsArgument(colorsNow())]
    }
  })

  // Clicking away puts it down. A capture box that stays up after you have gone
  // back to what you were doing is a window to manage, which is the thing it
  // exists to avoid.
  window.on('blur', () => window.hide())

  // Hidden rather than destroyed, so the second capture of the day does not pay
  // for a window and a renderer again. It is a real window either way, so the
  // app still ends when the main one closes.
  window.on('close', () => {
    box = null
  })

  const devServer = process.env.ELECTRON_RENDERER_URL
  if (devServer) {
    void window.loadURL(`${devServer}#capture`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'capture' })
  }

  // Tied to the window that owns the vault: when that goes, this goes with it,
  // rather than being left behind as the one window keeping a quit app alive.
  parent.once('closed', () => {
    if (!window.isDestroyed()) window.destroy()
  })

  return window
}

// Kept for the box that is already up and listening, which is every box after
// the first. What a freshly built one knows comes from its own asking - see
// captureTargetNow - and not from this line.
export function showCapture(parent: BrowserWindow): void {
  if (!box || box.isDestroyed()) box = build(parent)
  box.webContents.send(IPC.captureTarget, target)
  box.center()
  box.show()
  box.focus()
}

// The box as tall as what is in it, asked for by the box. The page measures
// because only it knows how tall its rows came out and whether a list is open
// under them. Only the bottom edge moves: the top stays where it is, so the
// input does not slide away from the caret while a list opens under it.
export function fitCapture(height: unknown): void {
  if (!box || box.isDestroyed()) return
  if (typeof height !== 'number' || !Number.isFinite(height)) return
  const next = Math.min(TALLEST, Math.max(SHORTEST, Math.ceil(height)))
  const [width, now] = box.getContentSize()
  if (now !== next) box.setContentSize(width, next)
}

export function hideCapture(): void {
  if (box && !box.isDestroyed()) box.hide()
}

// The title comes back from the box and is handed to the window that owns the
// vault, which makes the card the same way every other card is made. Nothing is
// written from here: a second road to disk is a second set of rules about what
// a new card is, and they drift.
export function passToWindow(
  parent: BrowserWindow,
  title: string,
  where: CaptureWhere | null
): void {
  hideCapture()
  if (!parent.isDestroyed()) parent.webContents.send(IPC.captureCard, title, where)
}

export function registerCapture(parent: BrowserWindow): boolean {
  // Read from state rather than from the constant: main has already read
  // state.json by the time this runs, and a launch that registered the default
  // and corrected itself afterwards would be a window whose help sheet says one
  // key while the desktop holds another.
  accelerator = captureKeyNow()
  registered = globalShortcut.register(accelerator, () => showCapture(parent))
  return registered
}

export function releaseCapture(): void {
  globalShortcut.unregister(accelerator)
  registered = false
  if (box && !box.isDestroyed()) box.destroy()
  box = null
}
