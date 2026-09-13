// How wide the left panel is, and whether it is open at all. Step D1.
//
// The panel is the guest of the content, not the other way round: 210 pixels of
// chrome standing in front of an infinite plane is the thing this step exists
// to end. So the width is the user's to set, and both answers are remembered.
//
// It lives in shared for the reason the viewport does - the arithmetic is what
// has to be right, and it is measured on its own rather than through a window -
// and it is kept by main, in state.json, because it is one answer for the whole
// app rather than a fact about a vault. A window cannot be 210 wide for one
// folder and 380 for the next.

export type SidebarState = { width: number; collapsed: boolean }

// Today's fixed width, which is what an install that has never touched the
// handle keeps getting.
export const SIDEBAR_DEFAULT = 210

// What is left when it is closed: the strip that holds the open/close button
// and nothing else. Not zero, and we settled why - the content's own top left
// is already taken in both views (the canvas rail sits at 16,16 and the kanban
// title at 18), so a button floating there would land on top of one of them and
// would need a patch per view to get out of the way. A strip needs one rule.
//
// D4 put the icon rail in this slot while the panel is open, and left the slot
// exactly this wide when it is closed: the rail closes with the
// panel rather than always showing, which is what keeps the canvas's own
// rail where it is. Measured before the choice was made: with a rail that
// stayed, a closed panel put two vertical icon columns 17px apart.
export const SIDEBAR_RAIL = 34

// What the list itself needs. Below this the workspace rows lose their two act
// buttons to the ellipsis and the panel becomes a list of half-names.
export const SIDEBAR_LIST_MIN = 168

// The panel's own right border, which is inside its width rather than beside
// it: box-sizing is border-box app-wide, so the number written on flex-basis is
// what the rail, the list AND this line share. Measured rather than assumed -
// at a minimum of 168 + 34 the list came back 167 wide, one short, and this is
// the one.
export const SIDEBAR_BORDER = 1

// The rail is not part of the list's minimum: it takes its 34 out of the panel
// before the list gets any, so a minimum written as 168 would leave the list
// about 124 and the rows would lose the two act buttons the number exists to
// keep. Derived rather than typed, so the parts cannot drift - and above the
// maximum the panel stops being a panel and starts being the other half of the
// window.
export const SIDEBAR_MIN = SIDEBAR_LIST_MIN + SIDEBAR_RAIL + SIDEBAR_BORDER
export const SIDEBAR_MAX = 420

// Which list the panel is showing. Three, the third being the workspaces
// people keep going back to.
//
// Deliberately not in state.json, unlike the width and the open/closed answer.
// Those are preferences - what the user wants a panel to be. Which section is
// showing is where a task got to: "search" is the state of having asked
// something, and an app reopened tomorrow is not still asking it. So it lives
// in the store and starts at the list.
export const SIDEBAR_SECTIONS = ['workspaces', 'search', 'bookmarks'] as const
export type SidebarSection = (typeof SIDEBAR_SECTIONS)[number]

// How long the panel takes to open or close: it moves
// rather than jumps. Short, because it is in the way of what the hand reached
// for; a card's panel comes in over 140.
export const SIDEBAR_SLIDE_MS = 180

export const clampWidth = (width: number): number =>
  Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(width)))

// What the panel actually takes out of the window, in either state. One
// function so the strip's width is stated once: the layout, the drag and the
// checks all ask here rather than each carrying their own copy of 34.
export const sidebarWidth = (state: SidebarState): number =>
  state.collapsed ? SIDEBAR_RAIL : clampWidth(state.width)

// Checked rather than believed, like readViewport: state.json is a file a
// person can edit and an older version can leave behind, and a width that
// arrives as a string or a NaN is a panel that opens with no width at all.
export function readSidebar(value: unknown): SidebarState {
  const fallback: SidebarState = { width: SIDEBAR_DEFAULT, collapsed: false }
  if (typeof value !== 'object' || value === null) return fallback
  const saved = value as Partial<Record<keyof SidebarState, unknown>>
  const width = saved.width
  return {
    width: typeof width === 'number' && Number.isFinite(width) ? clampWidth(width) : SIDEBAR_DEFAULT,
    collapsed: saved.collapsed === true
  }
}

// The same road the colours take, and for the same reason. The renderer cannot
// read state.json, and an ipc round trip lands a frame late: a panel saved at
// 380 would paint once at 210 and jump, which is the flash step 8 of v0.2 went
// out of its way to avoid on the theme. Main hands the answer over as a launch
// argument and the preload reads it back before any page script runs.
const ARG = '--bothy-sidebar='

export function sidebarArgument(state: SidebarState): string {
  return ARG + JSON.stringify(state)
}

export function sidebarFromArguments(argv: readonly string[]): SidebarState {
  const found = argv.find((arg) => arg.startsWith(ARG))
  if (!found) return readSidebar(null)
  try {
    // Guarded on the way in as well as on the way out. It comes from main, but
    // it comes through a command line, and a value that arrives torn should
    // open the panel at its default rather than at nothing.
    return readSidebar(JSON.parse(found.slice(ARG.length)))
  } catch {
    return readSidebar(null)
  }
}
