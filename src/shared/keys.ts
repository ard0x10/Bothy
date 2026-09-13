// The keys that work everywhere, and the sheet that says so. Step D2.
//
// The canvas learned this in v0.3 and the reason is written there: a help sheet
// that is typed out beside the handler says what somebody believed the keys
// were, and it goes stale without a sound. So this is one table - App.tsx
// matches through it, the `?` sheet renders it - and the text of a row is
// worked out from the same fields rather than written next to them.
//
// The canvas keys are not repeated here. They live in shared/viewport.ts with
// the arithmetic they drive, and the sheet shows both lists under their own
// headings, because "everywhere" and "only on the canvas" is exactly the
// difference a person needs to be told.

export type AppAction =
  | 'palette'
  | 'new-card'
  | 'kanban'
  | 'canvas'
  | 'calendar'
  | 'workspaces'
  | 'save'
  | 'close'

export type AppKey = {
  action: AppAction
  label: string
  ctrl: boolean
  // Matched against event.key, lowercased. The canvas matches on event.code
  // instead, because zoom lands on whichever key carries `=` on a layout; these
  // are letters and digits a person is told about by name.
  key: string
}

export const APP_KEYS: AppKey[] = [
  { action: 'palette', label: 'Search and commands', ctrl: true, key: 'p' },
  { action: 'new-card', label: 'New card', ctrl: true, key: 'n' },
  { action: 'kanban', label: 'Board', ctrl: true, key: '1' },
  { action: 'canvas', label: 'Canvas', ctrl: true, key: '2' },
  { action: 'calendar', label: 'Calendar', ctrl: true, key: '3' },
  { action: 'workspaces', label: 'Switch workspace', ctrl: true, key: '4' },
  { action: 'save', label: 'Save the open card', ctrl: true, key: 's' },
  // No modifier, and it is in the table rather than beside it because it is the
  // key most people try first. What it closes depends on what is open, which
  // the handler decides; the sheet only has to say that it does.
  { action: 'close', label: 'Close what is open', ctrl: false, key: 'escape' }
]

const KEY_TEXT: Record<string, string> = { escape: 'Esc' }

export function appKeyText(key: AppKey): string {
  const name = KEY_TEXT[key.key] ?? key.key.toUpperCase()
  return key.ctrl ? 'Ctrl + ' + name : name
}

// What main registered with the system, said the way the rest of the sheet says
// keys. The accelerator is electron's syntax - `CommandOrControl+Alt+N` - and it
// is the right thing to store and the wrong thing to show: the run found that
// string on screen, which is the sheet telling a person to press a word.
export function acceleratorText(accelerator: string, platform: string): string {
  return accelerator
    .split('+')
    .map((part) => {
      if (part === 'CommandOrControl' || part === 'CmdOrCtrl')
        return platform === 'darwin' ? 'Cmd' : 'Ctrl'
      if (part === 'Command' || part === 'Cmd' || part === 'Super') return 'Cmd'
      if (part === 'Control') return 'Ctrl'
      return part
    })
    .join(' + ')
}

export type AppKeyLike = { key: string; ctrlKey: boolean; metaKey: boolean }

export function matchAppKey(event: AppKeyLike): AppAction | null {
  const ctrl = event.ctrlKey || event.metaKey
  const key = event.key.toLowerCase()
  for (const binding of APP_KEYS) {
    if (binding.ctrl !== ctrl) continue
    if (binding.key === key) return binding.action
  }
  return null
}

/* --- the one key that is not this window's, D3 ----------------------------- */
//
// Quick capture is registered with the operating system rather than listened
// for in a window, which is the whole reason it works while Bothy is behind
// whatever you are doing - and the whole reason it is the one binding that can
// be REFUSED. Another program may already own it. So it is the first key here
// that a person can change, and everything below exists because of what that
// costs: the string is written to state.json, read back at the next launch and
// handed straight to Electron, so a value that is not an accelerator is quick
// capture silently off with nothing on screen to say why.
export const CAPTURE_DEFAULT = 'CommandOrControl+Alt+N'

// Held apart from the modifiers because these are the parts a key press can
// contribute, and the order they are written in is the order they are read in.
const MODIFIERS = ['CommandOrControl', 'Alt', 'Shift'] as const

const PLAIN = /^[A-Z0-9]$/
const FUNCTION = /^F([1-9]|1[0-9]|2[0-4])$/

// What we will store, and it is narrower than what Electron would accept. Two
// rules, and both are about a key that reaches across the whole machine:
//
//   - at least one modifier. A bare letter registered globally takes that
//     letter away from every other program on the desktop, including the one
//     the person is typing into.
//   - a key we can name. Electron's accelerator syntax covers media keys and
//     punctuation that no two layouts agree on; a capture key nobody can find
//     again is worse than the one they started with.
export function readAccelerator(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null
  const parts = value.split('+')
  const key = parts[parts.length - 1]
  const mods = parts.slice(0, -1)
  if (mods.length === 0) return null
  // Written out in one order, so the same combination cannot be stored two
  // ways and read back as two different keys.
  const kept = MODIFIERS.filter((one) => mods.includes(one))
  if (kept.length !== mods.length) return null
  if (!PLAIN.test(key) && !FUNCTION.test(key)) return null
  return [...kept, key].join('+')
}

export type AcceleratorEvent = {
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  // Read rather than `key`, for the reason the canvas reads it: the letter on
  // the key is a fact about the layout, and a person who binds the key beside
  // A wants that key back on the next launch whichever letter it prints.
  code: string
}

// What a person pressed, as the string main will register. Null while the
// press is not a binding yet - modifiers held with nothing else, which is what
// every recording control sees on the way to a real combination.
export function acceleratorFromEvent(event: AcceleratorEvent): string | null {
  const mods: string[] = []
  if (event.ctrlKey || event.metaKey) mods.push('CommandOrControl')
  if (event.altKey) mods.push('Alt')
  if (event.shiftKey) mods.push('Shift')
  const code = event.code
  const key = /^Key[A-Z]$/.test(code)
    ? code.slice(3)
    : /^Digit[0-9]$/.test(code)
      ? code.slice(5)
      : FUNCTION.test(code)
        ? code
        : ''
  if (key === '') return null
  return readAccelerator([...mods, key].join('+'))
}
