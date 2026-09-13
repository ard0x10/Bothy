// Where the canvas is looking. Step 3 of v0.3.
//
// The surface is infinite and the objects on it hold absolute coordinates, so
// the whole of "where am I" is one translation and one scale. Screen = world *
// k + (x, y). Nothing here touches the DOM: the maths is what has to be right,
// and it is measured on its own rather than through a window.
//
// This lives in shared rather than with the view because main keeps it. Pan
// changes every frame a hand is moving, and writing that into canvas.json would
// put a disk write and a watcher event behind every mouse move - so the
// viewport is an app setting, next to the theme, keyed by workspace. What that
// costs is small and worth saying out loud: carry a workspace to another
// machine and the drawing comes with it, the place you were standing does not.

export type Viewport = { x: number; y: number; k: number }
export type Size = { w: number; h: number }
export type Box = { x: number; y: number; w: number; h: number }

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 4

// What the buttons step through. Ends are the limits, so a button always lands
// on a number the user can read rather than an arbitrary multiple of the last
// one, and holding zoom in cannot walk past MAX_ZOOM by a rounding error.
export const ZOOM_STOPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]

// Room left around the objects when fitting them on screen, in screen pixels.
export const FIT_PADDING = 48

// One world unit is one screen pixel at 100%, and the grid is every 32 of them.
export const GRID = 32

export const ORIGIN: Viewport = { x: 0, y: 0, k: 1 }

export const clampZoom = (k: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k))

export function toWorld(view: Viewport, px: number, py: number): { x: number; y: number } {
  return { x: (px - view.x) / view.k, y: (py - view.y) / view.k }
}

export function toScreen(view: Viewport, x: number, y: number): { x: number; y: number } {
  return { x: x * view.k + view.x, y: y * view.k + view.y }
}

export function panBy(view: Viewport, dx: number, dy: number): Viewport {
  return { ...view, x: view.x + dx, y: view.y + dy }
}

// Zoom with a point held still - the one under the cursor, or the middle of the
// surface when a button was pressed. Without it the canvas slides away from
// whatever the user was looking at, which is the whole difference between
// zooming and being moved.
export function zoomTo(view: Viewport, k: number, px: number, py: number): Viewport {
  const next = clampZoom(k)
  const at = toWorld(view, px, py)
  return { x: px - at.x * next, y: py - at.y * next, k: next }
}

const NEAR = 1e-6

// The next stop up or down from where the zoom is now. A zoom that landed
// between stops - the wheel does that - steps to the next one past it rather
// than to the nearest, so a button press always moves.
export function zoomStep(view: Viewport, dir: 1 | -1, px: number, py: number): Viewport {
  const stops = dir === 1 ? ZOOM_STOPS : [...ZOOM_STOPS].reverse()
  const next = stops.find((stop) => (dir === 1 ? stop > view.k + NEAR : stop < view.k - NEAR))
  return zoomTo(view, next ?? view.k, px, py)
}

// Everything on screen, or the origin when there is nothing to fit - which is
// what an empty canvas is, and what step 3 ships. Zoom in past 100% is not part
// of fitting: one small box would otherwise fill the window at 4x and read as
// something being wrong.
//
// A thing with no thickness in one direction still has a place. This used to
// treat a height of nought as nothing to fit and go home instead, and step 5
// made that reachable: a scribble drawn dead straight is exactly that shape,
// and pressing fit with one on the canvas walked away from it. So the zoom is
// decided by whichever direction has a size, and a stroke with no size at all -
// a pen that was clicked rather than dragged - is centred at 100% rather than
// being somewhere the window will not go.
export function fit(box: Box | null, size: Size, padding = FIT_PADDING): Viewport {
  if (!box) return { x: size.w / 2, y: size.h / 2, k: 1 }
  const room = { w: Math.max(1, size.w - padding * 2), h: Math.max(1, size.h - padding * 2) }
  const across = box.w > 0 ? room.w / box.w : Infinity
  const down = box.h > 0 ? room.h / box.h : Infinity
  const tight = Math.min(across, down)
  const k = clampZoom(Math.min(1, Number.isFinite(tight) ? tight : 1))
  return {
    x: size.w / 2 - (box.x + box.w / 2) * k,
    y: size.h / 2 - (box.y + box.h / 2) * k,
    k
  }
}

// 100% again, without moving what is in the middle of the window.
export function resetZoom(view: Viewport, size: Size): Viewport {
  return zoomTo(view, 1, size.w / 2, size.h / 2)
}

export const percent = (k: number): number => Math.round(k * 100)

export function sameViewport(a: Viewport, b: Viewport): boolean {
  return a.x === b.x && a.y === b.y && a.k === b.k
}

// What came back from state.json. It is a file on disk that a person can edit
// and a version of this app can leave behind, so nothing in it is taken on
// trust: a viewport that is not three finite numbers is no viewport, and the
// canvas opens at the origin rather than somewhere off the edge of the world
// with no way back.
export function readViewport(value: unknown): Viewport | null {
  if (value === null || typeof value !== 'object') return null
  const view = value as Record<string, unknown>
  const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
  if (!ok(view.x) || !ok(view.y) || !ok(view.k)) return null
  return { x: view.x, y: view.y, k: clampZoom(view.k) }
}

// The grid drawn at this zoom. Far out, every 32 units would be a grey wash, so
// the spacing steps up in multiples of four until the dots are far enough apart
// to read as dots. Returned in screen pixels because that is where it is drawn.
export function gridStep(k: number, least = 12): number {
  let step = GRID * k
  while (step < least) step *= 4
  return step
}

export type CanvasAction =
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | 'fit'
  | 'delete'
  | 'select-all'
  | 'undo'
  | 'redo'

export type CanvasKey = {
  action: CanvasAction
  label: string
  ctrl: boolean
  shift: boolean
  // Matched on KeyboardEvent.code, not key. Fit is Shift and 1, and on the
  // layouts this app is written on that key reports itself as "!" the moment
  // Shift is down - a binding written against `key` would simply never fire,
  // and nothing would say so. `code` is the key's place on the board, which is
  // what a shortcut means. More than one because the numeric pad is a second
  // place for the same thing.
  codes: string[]
}

// The bindings and the help sheet are one table. The sheet used to be the kind
// of thing that goes stale silently - it says what somebody believed the keys
// were - so it is not written twice: the handler matches through this list and
// the sheet renders it, and the text of each row is worked out from the same
// fields rather than typed alongside them.
export const CANVAS_KEYS: CanvasKey[] = [
  { action: 'zoom-in', label: 'Zoom in', ctrl: true, shift: false, codes: ['Equal', 'NumpadAdd'] },
  {
    action: 'zoom-out',
    label: 'Zoom out',
    ctrl: true,
    shift: false,
    codes: ['Minus', 'NumpadSubtract']
  },
  { action: 'zoom-reset', label: '100%', ctrl: true, shift: false, codes: ['Digit0', 'Numpad0'] },
  { action: 'fit', label: 'Fit to view', ctrl: false, shift: true, codes: ['Digit1'] },
  // Step 4 borrowed this one early, because a canvas that can be drawn on and
  // not cleared is a trap. Step 7 is what it was borrowed from, and now it
  // takes the whole selection rather than the one object.
  {
    action: 'delete',
    label: 'Delete',
    ctrl: false,
    shift: false,
    codes: ['Delete', 'Backspace']
  },
  { action: 'select-all', label: 'Select all', ctrl: true, shift: false, codes: ['KeyA'] },
  { action: 'undo', label: 'Undo', ctrl: true, shift: false, codes: ['KeyZ'] },
  // Shift and the same key rather than Ctrl+Y, because Ctrl+Y is the one of the
  // two that is not the same on every desktop.
  { action: 'redo', label: 'Redo', ctrl: true, shift: true, codes: ['KeyZ'] }
]

// What a code looks like on a keyboard. Only the ones bound above: a map that
// tried to name every key would be a second keyboard layout to maintain.
const CODE_TEXT: Record<string, string> = {
  Equal: '=',
  Minus: '-',
  Digit0: '0',
  Digit1: '1',
  Delete: 'Delete',
  KeyA: 'A',
  KeyZ: 'Z'
}

// How a row reads on the sheet. Derived, so a binding cannot say one thing and
// the sheet another.
export function keyText(key: CanvasKey): string {
  const parts: string[] = []
  if (key.ctrl) parts.push('Ctrl')
  if (key.shift) parts.push('Shift')
  parts.push(CODE_TEXT[key.codes[0]] ?? key.codes[0])
  return parts.join(' + ')
}

export type KeyLike = { code: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }

export function matchKey(event: KeyLike): CanvasAction | null {
  const ctrl = event.ctrlKey || event.metaKey
  for (const binding of CANVAS_KEYS) {
    if (binding.ctrl !== ctrl) continue
    if (binding.shift !== event.shiftKey) continue
    if (binding.codes.includes(event.code)) return binding.action
  }
  return null
}
