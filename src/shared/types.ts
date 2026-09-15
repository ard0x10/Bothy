import type { Background } from './background'
import type { TABS } from './schema/workspace'

// The two views a workspace can be looking at. The canvas itself is v0.3; in
// v0.1 the tab is real, reachable and remembered, and what it opens says so.
//
// This is what goes in workspace.json, and it stayed two when the calendar
// arrived: see View below.
export type Tab = (typeof TABS)[number]

// What the content column is showing. The calendar is a third tab on screen but
// not a third value on disk, because it does not belong to a workspace - it
// reaches across the whole vault. Writing it into one workspace's file would
// mean leaving the calendar in workspace A and coming back to find B remembers
// a view that was never about B. So `lastTab` keeps its two values, the format
// does not change, and the calendar dies with the window the way a filter does.
export type View = Tab | 'calendar'

// One of the six colours a workspace can put on a card, or a name somebody
// wrote before the six. `key` is the colour's own word and is what the card's file
// carries; `name` is the note a person hung on that colour, empty when none was
// given. A label with no key is a legacy named tag: it keeps working, it keeps
// its colour, and nothing in this app makes another one.
export type Label = { name: string; color: string; key?: string }

export type ChecklistItem = { text: string; done: boolean }
export type Checklist = { name: string; items: ChecklistItem[] }

export type Card = {
  id: string
  title: string
  file: string
  // Fingerprint of the file this card was read from. Autosave sends it back so
  // the write can be refused when the file moved on without us.
  hash: string
  tags: string[]
  checklists: Checklist[]
  // Names of files in the workspace's files/ folder. Bare names, never paths:
  // the folder is fixed, and a name that cannot hold a separator cannot point
  // at anything outside the workspace being carried around.
  files: string[]
  body: string
  cover?: string
  start?: string
  due?: string
  priority?: string
  created?: string
  modified?: string
  // Off the kanban but not thrown away. The card keeps its place in
  // columns.json, so coming back out of the archive puts it where it was
  // rather than wherever a rebuild would have guessed.
  archived?: boolean
  // Fields the app does not know about. Kept so a hand written file survives a
  // round trip instead of losing whatever the user put there.
  extra: Record<string, unknown>
  // Parse error message. A broken card is shown and never rewritten.
  broken?: string
  // True when the file had no id and we made one up. It reaches disk on the
  // next write, not on load.
  idIsNew?: boolean
}

export type Column = {
  id: string
  title: string
  cards: string[]
  wipLimit?: number
  // Same promise as a card: whatever else the user put on a column survives a
  // rewrite.
  extra: Record<string, unknown>
}

// What the window last knew was in columns.json, v0.4 step 6: the order as the
// file says it rather than the board built from it (no card added for being
// unlisted, no id taken out for having no file), and the fingerprint of that
// text. A hash of null is a file that was not there.
export type ColumnsSeen = { columns: Column[]; hash: string | null }

// A card that has not been made yet. Step 5 of v0.2: templates live in the
// workspace's own templates/ folder, in the card format and nothing else, so
// one can be written by hand, read by anything that reads a card, and carried
// along when the folder is copied to another machine.
//
// What it carries is the shape of a card, never its history: no id, no dates,
// no attachments. A due date on a template would be an absolute day frozen at
// the moment the template was written, and every card born from it would land
// already late.
export type Template = {
  // What the menu shows: the title inside the file, which falls back to the
  // file name the way a card's does.
  name: string
  // The bare file name inside templates/, which is what a card is asked to be
  // made from. Bare, for the reason attachments are: the folder is fixed, and
  // a name that cannot hold a separator cannot point outside the workspace.
  file: string
  tags: string[]
  checklists: Checklist[]
  body: string
  cover?: string
  priority?: string
  extra: Record<string, unknown>
}

export type Workspace = {
  path: string
  id: string
  name: string
  labels: Label[]
  lastTab: Tab
  // The board's ground, absent unless someone chose one. See background.ts.
  background?: Background
  // In the Bookmarks section of the panel. Absent rather than false, for
  // the background's reason.
  bookmarked?: true
  columns: Column[]
  // Top level keys of columns.json we do not own, formatVersion included.
  columnsExtra: Record<string, unknown>
  // columns.json as it was when this was read, v0.4 step 6: what the window's
  // next write of the order is held to and merged over.
  columnsSeen?: ColumnsSeen
  cards: Card[]
  // What is sitting in templates/, read once with the workspace the same way
  // files/ is. A workspace with no templates/ folder has no templates, which is
  // the ordinary case rather than an error.
  templates: Template[]
  // What is actually sitting in files/. Read once with the workspace so the
  // panel can tell an attachment that is there from a name with nothing behind
  // it, without asking the disk again for every card that opens.
  files: string[]
  // When each of those arrived in files/, in milliseconds, by name. A file
  // whose time could not be read is simply not in it.
  added: Record<string, number>
  // Cards on disk that no column lists. Put at the end of the first column in
  // memory only, since opening a vault should not write to it.
  orphans: string[]
  notes: string[]
}

// Everywhere a quickly captured card could land, as the window last knew it.
// Sent to the little capture box so it can say where it is dropping into before
// anything is typed: the box closes on its own and the card is not on screen
// afterwards, so a box that does not name the place is the same as losing the
// card.
//
// It carries the whole vault rather than one landing because of the decision:
// the box picks, so it has to be able to offer. `path` is the workspace
// the window itself is in, which is what the box opens on.
export type CapturePlace = {
  path: string
  name: string
  columns: { id: string; title: string }[]
}

export type CaptureTarget = {
  places: CapturePlace[]
  path: string | null
}

// One capture's destination, as the box chose it. Ids rather than titles: two
// columns may be called the same thing, and a title is what the user is free to
// change while the box sits open.
export type CaptureWhere = {
  path: string
  columnId: string
}

export type Vault = {
  path: string
  workspaces: Workspace[]
}

export type VaultChange = {
  kind: 'add' | 'change' | 'unlink'
  file: string
  at: number
}

export type SaveResult =
  | { ok: true; hash: string }
  | { ok: false; disk: string; mine: string }

// One thing waiting in .trash. `path` is where it sits now, which is also what
// identifies it: putting it back is worked out from where it is, not from
// anything the renderer remembers about it.
export type TrashEntry = {
  path: string
  // 'canvas' is a thing an agent took off a canvas, v0.4 step 5.
  kind: 'card' | 'workspace' | 'canvas'
  // What to call it on screen. For a workspace that is the name in its
  // workspace.json, which is what the user saw in the sidebar, and it can
  // differ from the folder: renaming a workspace never moves the folder.
  name: string
  // The file or folder name it is stored under, which is where it goes back to.
  folder: string
  // The workspace it came out of. Empty when the entry is a workspace.
  workspace: string
  at: string
  // False when the place it came from is gone, or something is already sitting
  // where it would land.
  restorable: boolean
}

// Which of the two nos an attachment got. 'refused' is the name never being
// one a card may carry; 'failed' is a name that was fine and had nothing behind
// it, or a shell that would not take it.
export type OpenResult = 'opened' | 'refused' | 'failed'

export type RestoreResult = { ok: true; path: string } | { ok: false; why: string }
