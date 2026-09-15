import { create } from 'zustand'
import type {
  Card,
  CaptureWhere,
  Column,
  Tab,
  Vault,
  View,
  Workspace
} from '../../shared/types'
import { clampWidth, type SidebarSection, type SidebarState } from '../../shared/sidebar'
import type { Background } from '../../shared/background'
import type { SearchSort } from './search'
import { moveCard } from './dnd'
import { NO_FILTER, isOn, matches, toggle, type Filter } from './filter'
import { newId } from '../../shared/id'
import { MIN_SIZE, boundsOf, fitSize } from '../../shared/geometry'
import {
  IMAGE_SHARE,
  NEW_ARROW,
  NEW_BOX,
  NEW_DRAW,
  NEW_MARKER,
  NEW_TEXT,
  copiesOf,
  endpointOf,
  isArrow,
  kindOf,
  newObjectId,
  placeOf,
  reordered,
  boxOfObject,
  type CanvasFile,
  type CanvasObject,
  type CanvasWrite,
  type Endpoint,
  type Shape
} from '../../shared/canvas'
import { changedOn, mergeCanvas, sameValue, type CanvasBody } from '../../shared/merge'
import type { EditingItem } from '../../shared/editing'
import { arrowEnds, tie } from '../../shared/arrow'
import { colourLabel, labelKeyOf } from '../../shared/labels'
import { shiftFor } from '../../shared/transfer'
import { AI_NOTICE_MS, aiNotice, type AiChange } from '../../shared/aitrail'
import { CHANGE_NOTICES_DEFAULT, type ChangeNotices } from '../../shared/ai'
import {
  OUTSIDE_HOLD_MS,
  cardsChangedOutside,
  objectsChangedOutside,
  outsideNotice,
  sameThing,
  type OutsideChange
} from '../../shared/outside'
import { placeIn, targetOf } from '../../shared/capture'
import { buildSvg, toPng, textBytes } from './canvas-export'
import { kanbanPng } from './kanban-export'
import { extensionForType, fileUrl, pastedName } from '../../shared/image'
import { WORKSPACE_OPENS_DEFAULT, type WorkspaceOpens } from '../../shared/opening'
import {
  noHistory,
  redo as redoStep,
  remember,
  undo as undoStep,
  type History,
  type Step
} from '../../shared/history'
import { boundsOfPoints, roundPoint, translate, type Point } from '../../shared/scribble'
import {
  ORIGIN,
  fit,
  panBy,
  resetZoom,
  sameViewport,
  toWorld,
  zoomStep,
  type Box,
  type CanvasAction,
  type Size,
  type Viewport
} from '../../shared/viewport'

// Which tool the rail is on. 'select' moves and resizes what is there; the
// others put something new on the surface.
export type CanvasTool = 'select' | 'box' | 'text' | 'draw' | 'arrow' | 'image'

// Which pen the pen is. The highlighter is a pen with settings of
// its own; the eraser is a pen that takes lines away.
export type PenKind = 'pen' | 'highlighter' | 'eraser'

type Seed = 'newBox' | 'newText' | 'newDraw' | 'newMarker' | 'newArrow'

// Which set of defaults a tool draws from. A total map rather than a chain of
// ifs, so adding a tool is a line here and the compiler asks for it.
const SEED_OF: Record<CanvasTool, Seed> = {
  select: 'newBox',
  box: 'newBox',
  text: 'newText',
  draw: 'newDraw',
  arrow: 'newArrow',
  // An image has no settings to carry into the next one - it is a file, and the
  // file is the whole of it. Pointed at the box's seed for the same reason
  // select is: nothing in the rail asks for it, and a hole in this table would
  // be a crash rather than an empty panel.
  image: 'newBox'
}

// The highlighter keeps its own: one set to a pen's width is a pen, and a
// colour chosen for the pen turning up on the highlighter is a surprise.
// Exported for the settings bar, so what it shows and what a press on it
// changes are one answer rather than two.
export const seedOf =(state: { tool: CanvasTool; pen: PenKind }): Seed =>
  state.tool === 'draw' && state.pen === 'highlighter' ? 'newMarker' : SEED_OF[state.tool]

export type Conflict = { disk: string; mine: string }

type State = {
  vault: Vault | null
  workspacePath: string | null
  loading: boolean
  // Which view the content column is showing. Kanban and canvas belong to the
  // workspace, not to the window: switching away and back returns to the tab
  // that workspace was left on, and that answer is on disk. The calendar is the
  // exception in both directions - it is not written down, and moving between
  // workspaces does not take you out of it, because it was never showing one
  // workspace in the first place.
  tab: View
  // The card whose panel is open, and the copy being edited. The draft is held
  // apart from the vault so a reload triggered by some other file cannot pull
  // the ground out from under what is being typed.
  openId: string | null
  draft: Card | null
  dirty: boolean
  conflict: Conflict | null

  // The palette is one surface for search, navigation and commands. Its seed is
  // what the box starts out holding, so a shortcut can drop the user straight
  // into command mode.
  paletteOpen: boolean
  paletteSeed: string
  // The column whose "Add card" box should open itself and take focus. A
  // command cannot name a card that does not exist yet, so it hands the naming
  // back to the kanban rather than inventing a title.
  composingIn: string | null
  // Same idea, for the two other things that get named before they exist.
  composingWorkspace: boolean
  composingColumn: boolean
  // The column a card was just made in. The board reads it once, takes that
  // column's scroll to its end so the new card is somewhere it can be seen,
  // and puts it back to null: news about a moment, not a state the board is in.
  landedIn: string | null
  trashOpen: boolean
  archiveOpen: boolean

  // What the kanban is narrowed to, and whether the bar is unfolded. Neither is
  // written anywhere: we decided this filter dies with the window, so there
  // is no workspace.json key and no format change. It is cleared when the
  // workspace changes, because a filter set on one folder's labels means
  // nothing on the next one's and would only subtract cards for no reason
  // anybody could see.
  filter: Filter
  filterOpen: boolean

  // Which workspaces the calendar is showing, empty meaning all of them - which
  // is the whole point of the view, so it is where it starts.
  //
  // Deliberately not part of Filter. A workspace narrowing means nothing on a
  // kanban, which shows one workspace already; carried in there it would be a
  // criterion the kanban's own bar could not display or switch off, and this
  // app's rule since step 4 is that a filter nobody can see is
  // indistinguishable from cards that went missing.
  calendarWorkspaces: string[]

  // The folders this app has opened before, most recent first, and whether the
  // menu at the foot of the panel is showing them. The list is asked for rather
  // than derived from the vault on screen: it is the one thing the window knows
  // about folders it is not in.
  vaults: string[]
  vaultMenuOpen: boolean

  // The help sheet the `?` at the foot opens. Apart from canvasKeysOpen, which
  // is the canvas's own sheet in its own corner: this one lists the keys that
  // work everywhere and it has to be reachable from a board, where the canvas
  // sheet is not on screen at all.
  keysOpen: boolean

  // The sheet the fourth button on the tab bar opens: every workspace as
  // a card, the bookmarked ones first. Not a view, so not `tab`: it is opened
  // over whichever view is on screen and put away again.
  switcherOpen: boolean

  // How wide the left panel is and whether it is open at all, D1. Seeded from
  // the launch argument for the same reason the colours are: this is what the
  // first frame is already drawn with, not something asked for afterwards.
  // Held whole rather than as two fields, because it is written back whole and
  // a width that travels without its collapsed flag is the pair drifting.
  sidebar: SidebarState
  // What a workspace opens on, chosen in Settings under Vault.
  workspaceOpens: WorkspaceOpens

  // Which of the panel's two lists is on, D4. Not part of `sidebar` above and
  // not on disk with it: that pair is a preference the user set, this is where
  // a task got to. See SIDEBAR_SECTIONS for the whole argument.
  section: SidebarSection

  // What the panel's Search section is asking, D5. Held here rather than inside
  // the component for the thing D5 is about: the section is somewhere you are,
  // so walking to the workspace list and back has to find the search where it
  // was left. A useState in SearchPane is thrown away the moment the rail moves.
  //
  // On disk with none of it, for the reason the section itself is not: this is
  // where a task got to, not what the user wants the app to be.
  searchQuery: string
  searchSort: SearchSort
  // The search's OWN filter, not the kanban's. Same shape, different question:
  // the kanban narrows one workspace and this narrows the vault.
  searchFilter: Filter
  // Which workspaces the search may answer from. Empty means all of them, the
  // same way an empty tag list means every tag.
  searchScope: string[]

  // One line of news about something that just happened and left nothing on
  // screen to see. Two things use it, and both are cases where the app did what
  // was asked and the result is invisible: a card born while a filter is on,
  // and a template written into a folder nobody is looking at. It is cleared
  // the moment the sentence stops being true.
  notice: string | null
  setNotice: (text: string | null) => void
  // What an agent just did, said on the same line, v0.4 step 4. See aiChanged.
  aiChanged: (changes: AiChange[]) => void
  // The vault read again after files changed on disk that this window did not
  // write, and what changed in them said on the line, v0.4 step 7.
  reloadOutside: (files: string[]) => Promise<void>

  // Where the canvas is looking, and which workspace that answer belongs to.
  // Kept here rather than in the view because the shortcuts are bound in one
  // place for the whole window - the rule Escape set in v0.1 - and a key press
  // has to reach the same viewport the surface is drawing.
  viewport: Viewport
  viewportFor: string | null
  // What the surface measured itself as. Zooming from a button or a key has to
  // hold the middle of the window still, and nothing outside the view knows
  // where that is.
  canvasSize: Size
  canvasKeysOpen: boolean
  setCanvasSize: (size: Size) => void
  loadViewport: (workspacePath: string) => Promise<void>
  setViewport: (viewport: Viewport) => void
  panCanvas: (dx: number, dy: number) => void
  canvasAction: (action: CanvasAction) => void
  setCanvasKeys: (open: boolean) => void

  // The canvas of the workspace on screen, held as it came off disk. Step 4 of
  // v0.3. The file is the source: what is drawn is read from here, edits go
  // back into here, and the writer puts this on disk - there is no second copy
  // of the drawing anywhere.
  canvas: CanvasFile | null
  canvasFor: string | null
  // Which tool the rail is on, what is selected, and what is being typed into.
  // A list rather than one id since step 7: a selection rectangle takes
  // everything it went over, and what it took moves, is coloured and is deleted
  // as one thing.
  tool: CanvasTool
  selectedIds: string[]
  editingId: string | null
  // Where undo goes back to. Whole canvases, and why is in history.ts.
  history: History<CanvasFile>
  // What the next box and the next text will look like. The rail's inner column
  // edits the selection when there is one and these when there is not, so the
  // same swatch means "make it this" and "make the next one this".
  newBox: Record<string, unknown>
  newText: Record<string, unknown>
  newDraw: Record<string, unknown>
  newMarker: Record<string, unknown>
  newArrow: Record<string, unknown>
  // Which shape Shapes puts down and which pen the pen is. Kept while the
  // tool changes, so a category pressed again makes what it made last.
  shape: Shape
  pen: PenKind

  // The card a hand is dragging on the board, v0.4 step 6, for editing.json.
  cardInHand: string | null
  holdCard: (id: string | null) => void
  loadCanvas: (workspacePath: string) => Promise<void>
  // `quiet` when what is read back is main's own write for this window, which
  // is not a change from outside Bothy.
  reloadCanvas: (quiet?: boolean) => Promise<void>
  // The edit held back for the disk, written now, and settled once it is. For
  // something about to write canvas.json from outside the window - putting an
  // object back from the trash - which would otherwise be overwritten by it.
  settleCanvas: () => Promise<void>
  setTool: (tool: CanvasTool) => void
  setShape: (shape: Shape) => void
  setPen: (pen: PenKind) => void
  // The three ways a selection is made: put down whole - a click, or whatever a
  // selection rectangle gathered - added to and taken from one at a time, and
  // everything at once.
  selectObjects: (ids: string[]) => void
  toggleObject: (id: string) => void
  selectAll: () => void
  editObject: (id: string | null) => void
  addObject: (type: CanvasTool, box: Box) => void
  // A finished stroke, already thinned. Its own door rather than addObject's,
  // because a scribble is not a rectangle: it has no width and height of its
  // own and it does not open for typing.
  addStroke: (points: Point[]) => void
  // An arrow, with each end already decided: a binding or a fixed point.
  addArrow: (from: Endpoint, to: Endpoint) => void
  addImage: (
    file: string,
    natural: { w: number; h: number },
    at: { x: number; y: number },
    mark?: string | null
  ) => string | null
  // The three ways a picture gets onto the plane, step 8. They differ only in
  // where the files come from, and they all come out at putDown.
  // Names already in files/, onto the plane. Apart from the three above because
  // they all end here, and because a check can reach it without a file picker
  // or a clipboard in the way.
  putImages: (names: (string | null)[], at: { x: number; y: number } | null) => Promise<void>
  dropImages: (sources: string[], at: { x: number; y: number }) => Promise<void>
  pickImages: (at: { x: number; y: number } | null) => Promise<void>
  pasteImages: (files: File[]) => Promise<void>
  // One end of an existing arrow, pointed somewhere else.
  repoint: (id: string, which: 'from' | 'to', end: Endpoint, mark?: string | null) => void
  // A change to one object, or to several of them in one write. The mark is
  // what makes the hundred events of a drag one press of Ctrl+Z; history.ts has
  // the rule, and gesture() below hands out the marks.
  patchObject: (id: string, props: Record<string, unknown>, mark?: string | null) => void
  patchMany: (
    patches: Array<{ id: string; props: Record<string, unknown> }>,
    mark?: string | null
  ) => void
  // Typing into a box. Its own door, because what makes one move while a word
  // is being typed is a pause rather than a gesture, and only the store knows
  // when the last write went out.
  patchText: (id: string, text: string) => void
  removeObjects: (ids: string[]) => void
  // The More menu on the settings bar: the held objects to the top or the
  // bottom of the drawing, and copies of them.
  orderObjects: (ids: string[], to: 'front' | 'back') => void
  duplicateObjects: (ids: string[]) => void
  // What the eraser takes, under the mark of the gesture that took it.
  eraseObjects: (ids: string[], mark: string) => void
  // Step 9, the doors out and the one back in.
  //
  // What a picture export covers is the selection when there is one and the
  // whole canvas when there is not. That is not a new idea: it is the rule the
  // tool rail has followed since step 4 - a press means "this selection", or
  // "the next thing" when nothing is held - and an export that always took
  // everything would leave no way at all to send one box.
  exportCanvasFile: () => Promise<void>
  importCanvasFile: () => Promise<void>
  exportPicture: (kind: 'png' | 'svg') => Promise<void>
  // The kanban as a PNG. The board is the one on screen, handed in by the
  // menu that asked; `ground` is the answer to the one question the menu asks.
  exportKanban: (board: HTMLElement, ground: boolean) => Promise<void>
  // A fresh name for a gesture about to start. Everything written under one
  // name is one move to undo, however many events it took.
  gesture: (kind: string) => string
  undoCanvas: () => void
  redoCanvas: () => void
  // The two the rail calls: whatever is selected, or the defaults for the tool
  // that is on. The mark is for a setting that is dragged rather than pressed,
  // A colour well or a strength slider sends a write for every step of the
  // hand, and all of them are one move to undo.
  patchTarget: (props: Record<string, unknown>, mark?: string | null) => void
  patchTargetStyle: (style: Record<string, unknown>, mark?: string | null) => void

  load: () => Promise<void>
  reload: () => Promise<void>
  choose: () => Promise<void>
  select: (path: string) => Promise<void>
  setTab: (tab: View) => Promise<void>
  applyColumns: (columns: Column[]) => void
  // The workspace to write, defaulting to the one on screen. Named only by the
  // quick capture box, which can put a card in a folder the window is not in.
  saveColumns: (workspacePath?: string, moved?: string[]) => Promise<void>

  openPalette: (seed?: string) => void
  closePalette: () => void
  composeIn: (columnId: string | null) => void
  composeWorkspace: (on: boolean) => void
  composeColumn: (on: boolean) => void
  landed: (columnId: string | null) => void
  openTrash: () => void
  closeTrash: () => void
  openArchive: () => void
  closeArchive: () => void

  setFilterOpen: (open: boolean) => void
  toggleFilterTag: (name: string) => void
  toggleFilterDue: (state: Filter['due'][number]) => void
  toggleFilterPriority: (value: string) => void
  showArchived: (on: boolean) => void
  clearFilter: () => void
  toggleCalendarWorkspace: (path: string) => void
  // Two verbs rather than one setter, because they are written down at
  // different moments: the button is one decision and lands at once, the handle
  // reports every mouse move and only the last one is worth a file write.
  loadVaults: () => Promise<void>
  openVaultMenu: (open: boolean) => void
  // Answers false when the folder could not be opened - moved, or on a drive
  // that is not plugged in. The caller says so; the row stays on the list.
  switchVault: (path: string) => Promise<boolean>
  setKeys: (open: boolean) => void
  openSwitcher: (open: boolean) => void

  toggleSidebar: () => void
  // Shutting it on purpose, which the toggle cannot do: the caller knows the
  // panel has answered what it was opened for, and a toggle there would open
  // a panel that was already closed.
  closeSidebar: () => void
  setWorkspaceOpens: (value: WorkspaceOpens) => void
  // Opening the panel is part of it. The rail is only on screen while the panel
  // is, so a section chosen from anywhere else - a shortcut, a command - would
  // otherwise set a list nobody can see.
  setSection: (section: SidebarSection) => void

  setSearchQuery: (query: string) => void
  setSearchSort: (sort: SearchSort) => void
  setSearchFilter: (filter: Filter) => void
  clearSearchFilter: () => void
  setSearchScope: (paths: string[]) => void
  // The bridge out of the palette, D5. Closes the palette, opens the panel on
  // the Search section, and hands the query over - so the same words carry on
  // in the surface that can sort and narrow them.
  openSearch: (query: string) => void
  // `commit` is false while the handle is still held. See dragSidebar.
  dragSidebar: (width: number, commit: boolean) => void

  addWorkspace: (name: string) => Promise<void>
  renameWorkspace: (path: string, name: string) => Promise<void>
  // The ground of the board on screen. Null takes it away.
  setBackground: (background: Background | null) => Promise<void>
  // In the Bookmarks section or out of it. Any workspace, not only the one on
  // screen: the section's own rows take a mark off.
  setBookmark: (path: string, on: boolean) => Promise<void>
  // The note hung on one of the six label colours. An empty name takes it
  // off again.
  nameLabel: (key: string, name: string) => Promise<void>
  trashWorkspace: (path: string) => Promise<void>

  addColumn: (title: string) => Promise<void>
  renameColumn: (columnId: string, title: string) => Promise<void>
  moveColumn: (columnId: string, by: number) => Promise<void>
  removeColumn: (columnId: string) => Promise<string | null>

  openCard: (id: string) => void
  openCardAt: (workspacePath: string, cardId: string) => Promise<void>
  closeCard: () => Promise<void>
  editCard: (patch: Partial<Card>) => void
  saveDraft: () => Promise<void>
  resolveConflict: (keep: 'mine' | 'theirs') => Promise<void>
  moveToColumn: (cardId: string, columnId: string) => void
  addCard: (columnId: string, title: string, template?: string | null) => Promise<void>
  addImageCards: (columnId: string, pictures: File[]) => Promise<void>
  saveAsTemplate: () => Promise<void>
  captureCard: (title: string, where?: CaptureWhere | null) => Promise<void>
  trashCard: (cardId: string) => Promise<void>
  setArchived: (cardId: string, archived: boolean) => Promise<void>
  setCardDates: (workspacePath: string, cardId: string, dates: Partial<Card>) => Promise<void>
}

// Saves of the open card, one at a time. The panel saves on a timer and it is
// also saved on the way out - leaving a card, a workspace or a tab - so two of
// them can start within a millisecond of each other, and measured on Windows
// both ways of overlapping go wrong: the second read the file the first had
// just written, did not recognise the hash, and put a conflict on screen that
// nothing on disk had caused; when they got closer still, both wrote and the
// rename failed with EPERM. Neither is a clash the user made, so they queue.
let saves: Promise<void> = Promise.resolve()
function queued(work: () => Promise<void>): Promise<void> {
  saves = saves.then(work, work)
  return saves
}

// The tab a workspace opens on: the kanban, or the tab it was last left on as
// read from its workspace.json, whichever Settings says. Used only when the
// view moves to a different workspace: a reload triggered by some file changing
// must not pull the user out of the tab they are looking at.
function tabOf(vault: Vault | null, path: string | null, opens: WorkspaceOpens): Tab {
  if (opens === 'kanban') return 'kanban'
  return vault?.workspaces.find((w) => w.path === path)?.lastTab ?? 'kanban'
}

// The same question once the calendar exists. Moving to another workspace while
// the calendar is up changes nothing about what is on screen - it was already
// showing every workspace - so the view is kept. This is also what makes
// opening a card from the calendar work at all: that goes through select(), and
// re-deriving the tab there would drop the user back onto a kanban.
function viewFor(current: View, vault: Vault | null, path: string | null, opens: WorkspaceOpens): View {
  return current === 'calendar' ? current : tabOf(vault, path, opens)
}

// Keeps the chosen workspace pointed at something real after a reload, and
// falls back to the first one when the folder it pointed at is gone.
function settle(vault: Vault | null, wanted: string | null): string | null {
  if (!vault || vault.workspaces.length === 0) return null
  if (wanted && vault.workspaces.some((w) => w.path === wanted)) return wanted
  return vault.workspaces[0].path
}

// The three colour actions used to live here, D3 took them to the settings
// window, and what is left in their place is the reason the move was safe: the
// set is stored by MAIN and pushed back to every window, so neither window
// holds a copy that can drift from the other. This window listens in App.tsx
// and paints; it no longer owns an answer about colour at all.

// The last part of a path, whichever kind of separator it was written with.
// Only ever used to put a name in front of a person - the path itself is main's
// business and never comes apart here.
const leafOf = (path: string): string => path.split(SEPARATOR).filter(Boolean).pop() ?? path

const SEPARATOR = /[\\/]/

const count = (many: number): string => (many === 1 ? '1 object' : `${many} objects`)

// What an export covers. The selection, or everything - and taken in the order
// the objects sit in the file rather than the order they were picked in, so
// exporting the same five things twice gives the same file.
function chosen(state: { canvas: CanvasFile | null; selectedIds: string[] }): CanvasObject[] {
  const objects = state.canvas?.objects ?? []
  if (state.selectedIds.length === 0) return objects
  const held = new Set(state.selectedIds)
  return objects.filter((object) => held.has(object.id))
}

// Incoming objects, given ids that are free here and moved to the right of what
// is already drawn.
//
// An id is kept when nothing here has it, which is the ordinary case of
// importing into another workspace, and minted when something does. Either way
// the arrows are rewritten through the same map: an arrow bound to a box whose
// id had to change would otherwise point at whatever object here happens to
// already hold that id, which is worse than pointing at nothing.
function place(mine: CanvasObject[], theirs: CanvasObject[]): CanvasObject[] {
  const taken = new Set(mine.map((object) => object.id))
  const renamed = new Map<string, string>()
  for (const object of theirs) {
    const id = taken.has(object.id) ? newObjectId() : object.id
    taken.add(id)
    renamed.set(object.id, id)
  }

  const here = boundsOf(mine.map(boxOfObject).filter((box) => box.w > 0 || box.h > 0))
  const incoming = boundsOf(theirs.map(boxOfObject).filter((box) => box.w > 0 || box.h > 0))
  const dx = shiftFor(here, incoming)

  return theirs.map((object) => {
    const props: Record<string, unknown> = { ...object.props }
    if (Array.isArray(props.points)) {
      const points = (props.points as unknown[]).filter(
        (point): point is Point =>
          Array.isArray(point) &&
          point.length >= 2 &&
          typeof point[0] === 'number' &&
          typeof point[1] === 'number'
      )
      props.points = translate(points, dx, 0)
    } else if (typeof props.x === 'number') {
      props.x = props.x + dx
    }
    for (const key of ['from', 'to'] as const) {
      const end = props[key]
      if (end === null || typeof end !== 'object' || Array.isArray(end)) continue
      const one = { ...(end as Record<string, unknown>) }
      // A binding first: an end that names an object is that object's problem,
      // and the coordinates beside it are a copy the format says to ignore.
      if (typeof one.of === 'string') {
        const to = renamed.get(one.of)
        // Bound to something that did not come with it. Left as it is rather
        // than pointed anywhere: the format's rule is that such an arrow waits,
        // and the id it names may well turn up here later.
        if (to !== undefined) one.of = to
      } else if (typeof one.x === 'number') {
        one.x = one.x + dx
      }
      props[key] = one
    }
    return { id: renamed.get(object.id) as string, type: object.type, props }
  })
}

// A canvas edit is a whole file in memory and then a write, held back the way
// the card panel holds its own: typing in a box would otherwise be one disk
// write per keystroke. Flushed when the workspace changes rather than left to
// a timer that may not get to run.
let canvasTimer: ReturnType<typeof setTimeout> | undefined
let canvasWaiting: CanvasFile | null = null
const CANVAS_SETTLE_MS = 500

const canvasPending = (): boolean => canvasWaiting !== null

// The last write that went out, for settleCanvas to wait on.
let canvasWriting: Promise<void> = Promise.resolve()

// What makes one burst of typing one move. Bumped every time a write actually
// goes out, so letters typed without a pause are one entry in the history and
// the pause that let the file settle is what starts the next one.
let burst = 0

// Names for gestures. A drag is a hundred writes that are one move, and what
// tells them apart from the next drag is this counter rather than a clock:
// two drags one after the other can be closer together than any window would
// allow for, and they are still two moves.
let gestures = 0

// What the window last knew was on disk, per workspace, v0.4 step 6: the canvas
// as read or as last written, and the fingerprint of that text. Every write is
// held to it, and a file that moved on is put together with the screen over it
// (shared/merge.ts). Per workspace because a write can still be on its way for
// a canvas that is no longer on screen.
const canvasSeen = new Map<string, { body: CanvasBody; hash: string | null }>()

const bodyOf = (file: CanvasFile): CanvasBody => ({ objects: file.objects, extra: file.extra })

const UNREADABLE_CANVAS =
  'canvas.json was changed outside Bothy and no longer reads, so your last change was not saved over it. It is saved as soon as the file reads again.'

// What went wrong, in the words it was thrown with. A call to main comes back
// wrapped by Electron ("Error invoking remote method 'canvas:write': Error: ..."),
// and that wrapping is the plumbing talking, not anything a person can act on.
function plainWhy(error: unknown): string {
  const said = error instanceof Error ? error.message : String(error)
  return said.replace(/^Error invoking remote method '[^']*': /, '').replace(/^Error: /, '')
}

function flushCanvas(): void {
  clearTimeout(canvasTimer)
  const file = canvasWaiting
  canvasWaiting = null
  if (!file) return
  burst++
  // One write at a time, since each is held to what the one before it left.
  canvasWriting = canvasWriting.then(() => sendCanvas(file))
}

async function sendCanvas(first: CanvasFile): Promise<void> {
  let file = first
  for (let attempt = 0; attempt < 4; attempt++) {
    const seen = canvasSeen.get(file.workspacePath)
    let result: CanvasWrite
    try {
      result = await window.api.writeCanvas(file, seen?.hash ?? null)
    } catch (error) {
      // A write nobody is waiting on is a write whose failure nobody hears. The
      // drawing is the user's, so a refusal says so on screen rather than
      // leaving the window showing something that is not on disk.
      useVault.getState().setNotice(`The canvas could not be saved: ${plainWhy(error)}`)
      return
    }
    // Written by something that left a file that does not read. Nothing is put
    // over it, on screen or off, and the screen says so and what brings it back:
    // the file reading again is a change the watcher hands to reloadCanvas, which
    // takes it in and writes what is waiting.
    if (!result.ok && result.disk.broken !== null) {
      useVault.getState().setNotice(UNREADABLE_CANVAS)
      return
    }
    if (result.ok) {
      canvasSeen.set(file.workspacePath, { body: bodyOf(file), hash: result.hash })
      tellHands()
      return
    }
    // Written by something else since this window last read it. On screen, the
    // screen takes it in and puts the result up to be written; away from the
    // screen, the two are put together here and tried again.
    const state = useVault.getState()
    if (state.canvasFor === file.workspacePath && state.canvas) {
      absorb(result.disk)
      return
    }
    if (!seen) {
      useVault.getState().setNotice(UNREADABLE_CANVAS)
      return
    }
    file = { ...file, ...mergeCanvas(seen.body, bodyOf(file), bodyOf(result.disk), 'mine').value }
    canvasSeen.set(file.workspacePath, { body: bodyOf(result.disk), hash: result.disk.hash ?? null })
  }
}

// canvas.json as somebody else left it, taken into the canvas on screen.
// What they changed and what this window changed are both kept; where both
// changed the same field, the window's stands and theirs is one Ctrl+Z away. Their
// write is a move in the history either way.
function absorb(disk: CanvasFile, fromOutside = true): void {
  const state = useVault.getState()
  const { canvas, canvasFor } = state
  if (!canvas || canvas.broken || canvasFor !== disk.workspacePath || disk.broken) return
  const seen = canvasSeen.get(disk.workspacePath)
  const theirs = bodyOf(disk)
  canvasSeen.set(disk.workspacePath, { body: theirs, hash: disk.hash ?? null })
  // Touched and not changed - an editor saving what it opened - is not a move.
  // But the screen may hold what never reached the disk: a save that met a file
  // left unreadable, now put back as it was. Nothing is waiting to write it, so
  // it is put up to be written here.
  if (seen && sameValue(seen.body, theirs)) {
    if (!canvasPending() && !sameValue(bodyOf(canvas), theirs)) stageCanvas(canvas)
    return
  }
  // Said on the line unless a trail accounts for it, v0.4 step 7. Held against
  // what was last seen on disk and not against the screen, which may hold what
  // the hand has not written yet.
  if (fromOutside && seen) {
    const name = state.vault?.workspaces.find((one) => one.path === disk.workspacePath)?.name ?? disk.workspacePath
    outsideChanged(objectsChangedOutside(disk.workspacePath, name, seen.body.objects, theirs.objects))
  }

  const base = seen?.body ?? bodyOf(canvas)
  const mine = bodyOf(canvas)
  const kept = mergeCanvas(base, mine, theirs, 'mine')
  let history = state.history
  if (!sameValue(kept.value, mine)) history = remember(history, canvas, null)
  if (kept.clashes.length > 0) {
    history = remember(history, { ...canvas, ...mergeCanvas(base, mine, theirs, 'disk').value }, null)
  }
  const next: CanvasFile = { ...canvas, ...kept.value }
  const alive = new Set(next.objects.map((object) => object.id))
  useVault.setState({
    canvas: next,
    history,
    selectedIds: state.selectedIds.filter((id) => alive.has(id)),
    editingId: state.editingId !== null && alive.has(state.editingId) ? state.editingId : null
  })
  // What is on screen is not what is on disk: this window's own change, merged
  // in. It goes the way every edit goes, once the hand stops.
  if (!sameValue(kept.value, theirs)) stageCanvas(next)
}

// What the hand is on, told to main for editing.json, v0.4 step 6: every object
// whose change has not reached the disk yet, with the fields changed, and the box
// whose words are open. A card being dragged is added by the board. Sent only
// when it says something new.
let handsSaid = '[]'

function tellHands(): void {
  const { canvas, canvasFor, editingId, cardInHand, workspacePath } = useVault.getState()
  const items: EditingItem[] = []
  if (canvas && canvasFor && !canvas.broken) {
    const seen = canvasSeen.get(canvasFor)
    for (const one of seen ? changedOn(seen.body.objects, canvas.objects) : []) {
      items.push({ workspace: canvasFor, kind: 'canvas', id: one.id, fields: one.fields })
    }
    if (editingId) {
      const open = items.find((item) => item.id === editingId)
      if (!open) items.push({ workspace: canvasFor, kind: 'canvas', id: editingId, fields: ['text'] })
      else if (!open.fields.includes('text') && !open.fields.includes('*')) open.fields.push('text')
    }
  }
  if (cardInHand && workspacePath) items.push({ workspace: workspacePath, kind: 'kanban', id: cardInHand, fields: ['place'] })
  const said = JSON.stringify(items)
  if (said === handsSaid) return
  handsSaid = said
  void window.api.setEditing(items).catch(() => undefined)
}

// Every edit takes the same road: a snapshot of what the canvas was goes into
// the history, the new file goes into memory at once so the surface redraws
// from it, and onto disk once the hand stops.
function writeCanvas(
  file: CanvasFile,
  set: (patch: Partial<State>) => void,
  get: () => State,
  mark: string | null
): void {
  const before = get().canvas
  set({
    canvas: file,
    history: before ? remember(get().history, before, mark) : get().history
  })
  stageCanvas(file)
}

// The disk half on its own. Undo and redo take this road rather than the one
// above: the file they put back came out of the history, and putting it into
// the history again would be a move that undoes itself.
function stageCanvas(file: CanvasFile): void {
  canvasWaiting = file
  clearTimeout(canvasTimer)
  canvasTimer = setTimeout(flushCanvas, CANVAS_SETTLE_MS)
}

// A step out of the history, onto the surface and onto the disk.
//
// The selection is trimmed to what came back. An object the step removed cannot
// stay selected: the rail would be showing the settings of something that is
// not on the surface, and the next colour would go to a thing nobody can see.
function applyStep(
  step: Step<CanvasFile>,
  set: (patch: Partial<State>) => void,
  get: () => State
): void {
  const alive = new Set(step.file.objects.map((object) => object.id))
  set({
    canvas: step.file,
    history: step.history,
    selectedIds: get().selectedIds.filter((id) => alive.has(id)),
    editingId: null
  })
  stageCanvas(step.file)
}

// Whether this patch would leave the object exactly as it is.
//
// A press on something that is already held is a drag of no distance, and it
// used to go all the way through: a move of nought written into the file and an
// entry written into the history. Click around a canvas for a minute and undo
// has a minute of nothing in it, and every one of those presses is a disk
// write. Compared by value rather than by identity, because a patch is built
// fresh every time - the numbers, strings and short lists in it are what has to
// match, not the object holding them.
function changes(object: CanvasObject, props: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(props)) {
    // Undefined removes the key. It is a change if the key is there to remove.
    if (value === undefined) {
      if (key in object.props) return true
      continue
    }
    if (JSON.stringify(object.props[key]) !== JSON.stringify(value)) return true
  }
  return false
}

// Which of the held objects a press in the tool rail is about.
//
// The panel shows one kind of thing at a time and the topmost held object is
// what decides which - that is what the rail draws, so it is what the user is
// answering. What the press changes is every held object of that kind, and not
// the others: `stroke` is a pen's ink on a scribble and a rectangle's border on
// a box, and a selection holding both must not have one press mean both.
function sameKindAsTop(objects: CanvasObject[], ids: string[]): CanvasObject[] {
  const held = new Set(ids)
  const taken = objects.filter((object) => held.has(object.id))
  const top = taken[taken.length - 1]
  if (!top) return []
  const kind = kindOf(top)
  return taken.filter((object) => kindOf(object) === kind)
}

// Undefined removes the key rather than writing it as null. "No fill" is a box
// with no fill in the file, not a box carrying the word null - the format's
// rule since v0.1 is that an empty field is not written.
function merged(
  now: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const next = { ...now }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key]
    else next[key] = value
  }
  return next
}

function withoutKeys(
  from: Record<string, unknown>,
  keys: string[]
): Record<string, unknown> {
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(from)) {
    if (!keys.includes(key)) next[key] = value
  }
  return next
}

// Panning writes a new viewport every frame a hand is moving, and every write
// goes to a file. So it is held back until the hand stops, and flushed when the
// workspace changes rather than left for a timer that may not get to run.
let viewportTimer: ReturnType<typeof setTimeout> | undefined
let viewportPending: { path: string; viewport: Viewport } | null = null
const VIEWPORT_SETTLE_MS = 400

function flushViewport(): void {
  clearTimeout(viewportTimer)
  const pending = viewportPending
  viewportPending = null
  if (pending) void window.api.setViewport(pending.path, pending.viewport)
}

function rememberViewport(path: string, viewport: Viewport): void {
  viewportPending = { path, viewport }
  clearTimeout(viewportTimer)
  viewportTimer = setTimeout(flushViewport, VIEWPORT_SETTLE_MS)
}

// How big a picture actually is. Asked of the window rather than by reading the
// file's header in main: Chromium is going to decode this image to draw it, it
// knows every format it can draw, and a header parser of our own would be a
// second opinion about the same bytes.
function measure(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const image = new Image()
    // 300 by 150 is what a browser gives a replaced element with no intrinsic
    // size of its own, which is what an SVG written without a width is. Taken
    // from the rule rather than picked, so the one format that can answer "no
    // size" lands somewhere with a reason behind it.
    const fallback = { w: 300, h: 150 }
    image.onload = () =>
      resolve(
        image.naturalWidth > 0 && image.naturalHeight > 0
          ? { w: image.naturalWidth, h: image.naturalHeight }
          : fallback
      )
    image.onerror = () => resolve(fallback)
    image.src = url
  })
}

// How far apart several pictures put down at once are set. In screen units and
// divided by the zoom: whether one picture hides the one under it is a question
// about what the eye can see, not about the plane. The step is the smallest a
// box may be, which is wider than a handle - so the one underneath is not only
// visible but can be taken hold of.
function stackAt(at: { x: number; y: number }, n: number, k: number): { x: number; y: number } {
  const step = (MIN_SIZE / k) * n
  return { x: at.x + step, y: at.y + step }
}

// The middle of what is on screen, in world units. Where a picture goes when
// the way it arrived did not say where: the picker reached from the rail, and a
// paste, which is a key rather than a place.
function middleOfView(state: State): { x: number; y: number } {
  return toWorld(state.viewport, state.canvasSize.w / 2, state.canvasSize.h / 2)
}

export const useVault = create<State>((set, get) => ({
  vault: null,
  workspacePath: null,
  loading: true,
  tab: 'kanban',
  openId: null,
  draft: null,
  dirty: false,
  conflict: null,
  paletteOpen: false,
  paletteSeed: '',
  composingIn: null,
  composingWorkspace: false,
  composingColumn: false,
  landedIn: null,
  trashOpen: false,
  archiveOpen: false,
  filter: NO_FILTER,
  filterOpen: false,
  calendarWorkspaces: [],
  sidebar: window.api.initialSidebar,
  workspaceOpens: WORKSPACE_OPENS_DEFAULT,
  section: 'workspaces',
  searchQuery: '',
  searchSort: 'relevance',
  searchFilter: NO_FILTER,
  searchScope: [],
  vaults: [],
  vaultMenuOpen: false,
  keysOpen: false,
  switcherOpen: false,
  notice: null,

  viewport: ORIGIN,
  viewportFor: null,
  canvasSize: { w: 0, h: 0 },
  canvasKeysOpen: false,

  setNotice: (text) => set({ notice: text }),

  // Changes close together are one line naming the cards, and the
  // line goes by itself. So while the line is still up a new change joins it
  // and starts its time again; once it has gone, or something else has taken
  // the line, the next change starts a line of its own. The timer only ever
  // takes down its own sentence - a notice the app put up since is not its to
  // clear.
  //
  // Since v0.4 step 7 a trail also accounts for what changed on disk: the same
  // thing found changed from outside, waiting or already on the line, is this
  // agent's and is not said twice.
  aiChanged: (changes) => {
    const heard = Date.now()
    aiLately = [...aiLately.filter((one) => heard - one.heard < AI_NOTICE_MS), ...changes.map((change) => ({ change, heard }))]
    const theirs = (one: OutsideChange): boolean => changes.some((change) => sameThing(change, one))
    outsideWaiting = outsideWaiting.filter((one) => !theirs(one))
    const line = lineUp()
    putLine([...line.changes, ...changes], line.outside.filter((one) => !theirs(one)))
  },

  setCanvasSize: (size) => {
    if (get().canvasSize.w === size.w && get().canvasSize.h === size.h) return
    set({ canvasSize: size })
  },

  setCanvasKeys: (open) => set({ canvasKeysOpen: open }),

  canvas: null,
  canvasFor: null,
  tool: 'select',
  selectedIds: [],
  editingId: null,
  history: noHistory<CanvasFile>(),
  newBox: { ...NEW_BOX, textStyle: { ...NEW_BOX.textStyle } },
  newText: { ...NEW_TEXT, textStyle: { ...NEW_TEXT.textStyle } },
  newDraw: { ...NEW_DRAW },
  newMarker: { ...NEW_MARKER },
  newArrow: { ...NEW_ARROW },
  shape: 'rect',
  pen: 'pen',
  cardInHand: null,
  holdCard: (id) => set({ cardInHand: id }),

  loadCanvas: async (workspacePath) => {
    if (get().canvasFor === workspacePath) return
    flushCanvas()
    // Read after any write still on its way, or what was read is older than
    // what it says was last seen.
    await canvasWriting
    const file = await window.api.readCanvas(workspacePath)
    if (useVault.getState().workspacePath !== workspacePath) return
    canvasSeen.set(workspacePath, { body: bodyOf(file), hash: file.hash ?? null })
    set({
      canvas: file,
      canvasFor: workspacePath,
      selectedIds: [],
      editingId: null,
      history: noHistory<CanvasFile>()
    })
    // A canvas that did not parse is not a canvas to draw on. Saying so is the
    // whole of what the app can do about it: the file is the user's drawing and
    // the writer refuses to put anything over it.
    if (file.broken) set({ notice: `canvas.json could not be read: ${file.broken}` })
  },

  // Somebody else wrote the file - a text editor, or an agent. Until v0.4 step 6
  // this was skipped while a hand was typing or a save was held back, and the
  // next save wrote the whole canvas over what they wrote. Now it is taken in
  // whatever the hand is doing, and merged with it: see absorb.
  //
  // Their write is a move of its own in the history: the first
  // Ctrl+Z goes back to the canvas as it was just before it, and any further
  // back goes past it the way it goes past a move of ours. An editor's write is
  // a move the same way: the window cannot tell who wrote the file, only that
  // it was not this window.
  reloadCanvas: async (quiet = false) => {
    const { canvasFor } = get()
    if (!canvasFor) return
    // A write of ours on its way decides what was last seen. Read after it.
    await canvasWriting
    const file = await window.api.readCanvas(canvasFor)
    if (useVault.getState().canvasFor !== canvasFor) return
    if (file.broken) return
    absorb(file, !quiet)
  },

  // Written until nothing is waiting: a write that met a change from outside puts
  // the merged canvas up to be written again.
  settleCanvas: async () => {
    for (let round = 0; round < 4; round++) {
      flushCanvas()
      await canvasWriting
      if (!canvasPending()) return
    }
  },

  setTool: (tool) =>
    set((state) => ({
      tool,
      // Picking a drawing tool puts the selection down: the rail's inner column
      // is about to start meaning "the next one" rather than "these ones".
      selectedIds: tool === 'select' ? state.selectedIds : [],
      editingId: null
    })),
  setShape: (shape) => set({ shape, tool: 'box', selectedIds: [], editingId: null }),
  setPen: (pen) => set({ pen, tool: 'draw', selectedIds: [], editingId: null }),

  selectObjects: (ids) => set({ selectedIds: ids, editingId: null }),
  toggleObject: (id) =>
    set((state) => ({
      selectedIds: state.selectedIds.includes(id)
        ? state.selectedIds.filter((one) => one !== id)
        : [...state.selectedIds, id],
      editingId: null
    })),
  selectAll: () =>
    set({ selectedIds: (get().canvas?.objects ?? []).map((object) => object.id), editingId: null }),
  editObject: (id) => set({ editingId: id, selectedIds: id ? [id] : get().selectedIds }),

  gesture: (kind) => `${kind}#${++gestures}`,

  addObject: (type, box) => {
    const canvas = get().canvas
    if (!canvas || canvas.broken) return
    const seed = type === 'text' ? get().newText : get().newBox
    const style = seed.textStyle as Record<string, unknown>
    // A shape other than the rectangle says which, and has no corner to round.
    const shape = type === 'box' ? get().shape : 'rect'
    const object: CanvasObject = {
      id: newObjectId(),
      type,
      props: {
        x: Math.round(box.x),
        y: Math.round(box.y),
        w: Math.round(box.w),
        h: Math.round(box.h),
        ...(shape === 'rect' ? {} : { shape }),
        ...withoutKeys(
          seed,
          shape === 'rect' ? ['w', 'h', 'textStyle'] : ['w', 'h', 'textStyle', 'radius']
        ),
        text: '',
        textStyle: { ...style }
      }
    }
    // Appended, because the order in the file is the order things are drawn in.
    // A new object belongs on top of what was already there.
    writeCanvas({ ...canvas, objects: [...canvas.objects, object] }, set, get, null)
    set({ selectedIds: [object.id], editingId: object.id, tool: 'select' })
  },

  addStroke: (points) => {
    const canvas = get().canvas
    if (!canvas || canvas.broken) return
    if (points.length === 0) return
    const object: CanvasObject = {
      id: newObjectId(),
      type: 'draw',
      // The points last, so the readable half of the object is at the top of it
      // in the file rather than after four hundred numbers.
      props: { ...get()[seedOf(get())], points: points.map(roundPoint) }
    }
    writeCanvas({ ...canvas, objects: [...canvas.objects, object] }, set, get, null)
    // The pen stays in hand and the new stroke is not selected. Drawing is a
    // thing done several times in a row, and a tool that put itself away after
    // every stroke would be one click of ceremony per line - while selecting it
    // would turn the rail's panel from "the next one" into "this one" under a
    // hand that is about to draw the next one.
  },

  addArrow: (from, to) => {
    const canvas = get().canvas
    if (!canvas || canvas.broken) return
    if (from === null || to === null) return
    // Where each bound end touches, frozen onto it. Both ends are tied
    // against the OTHER end as it was before either of them remembered
    // anything, so what is written is exactly the line that was on screen when
    // the hand let go - and from then on the ends stay where they were put.
    const find = (id: string): CanvasObject | undefined =>
      canvas.objects.find((one) => one.id === id)
    const object: CanvasObject = {
      id: newObjectId(),
      type: 'arrow',
      props: { ...get().newArrow, from: tie(from, to, find), to: tie(to, from, find) }
    }
    writeCanvas({ ...canvas, objects: [...canvas.objects, object] }, set, get, null)
    // The tool stays in hand and nothing is selected, the same as the pen: one
    // arrow is rarely the only arrow, and selecting the one just drawn would
    // turn the panel from "the next one" into "this one" under a hand that is
    // about to draw the next one.
  },

  // A picture onto the plane, step 8. The file is already in the workspace by
  // the time this runs: copying it in is main's half, and what comes back is
  // the name to write - which may be a name that was already there, because
  // We settled that the same image dropped twice is one file.
  //
  // The size is worked out here rather than by the caller because this is where
  // both halves of the question are: how big the picture is, and how much of
  // the plane is on screen to put it on. We settled the behaviour - fitted to
  // the view rather than dropped at its own pixel size.
  //
  // The point given is the middle of the picture, not its corner. A box put
  // down by a click is its own size and its corner can be aimed at; an image is
  // whatever size the fit makes it, so aiming a corner would land it somewhere
  // nobody chose.
  addImage: (file, natural, at, mark = null) => {
    const canvas = get().canvas
    if (!canvas || canvas.broken) return null
    const view = get().viewport
    const screen = get().canvasSize
    // What is on screen, in world units. A view zoomed to 4x is showing a
    // quarter of the plane it would at 1x, and half of what is on screen is
    // what the share is a share of.
    const visible = { w: screen.w / view.k, h: screen.h / view.k }
    const size = fitSize(natural, visible, IMAGE_SHARE)
    if (size.w === 0 || size.h === 0) return null

    const object: CanvasObject = {
      id: newObjectId(),
      type: 'image',
      props: {
        x: Math.round(at.x - size.w / 2),
        y: Math.round(at.y - size.h / 2),
        w: size.w,
        h: size.h,
        file
      }
    }
    // Marked, so three files dropped in one go are one move to walk back out
    // of. Dropping three pictures is one thing a hand did.
    writeCanvas({ ...canvas, objects: [...canvas.objects, object] }, set, get, mark)
    set({ selectedIds: [object.id], editingId: null, tool: 'select' })
    return object.id
  },

  // Names already in files/, onto the plane. One mark for the lot, so three
  // pictures dropped in one go are one move to walk back out of - dropping
  // three files is one thing a hand did.
  putImages: async (names, at) => {
    const where = get().workspacePath
    if (!where) return
    const mark = get().gesture('image')
    let placed = 0
    for (const name of names) {
      if (name === null) continue
      const natural = await measure(fileUrl(where, name))
      // The workspace can be changed while a file is being read. Putting the
      // picture down now would put it on a canvas that is not the one it was
      // dropped on, and name a file that is not in that workspace's folder.
      if (get().workspacePath !== where) return
      const spot = at ?? middleOfView(get())
      get().addImage(name, natural, stackAt(spot, placed, get().viewport.k), mark)
      placed++
    }
    // Said rather than swallowed. A file that could not be taken in is a
    // picture the user put down and cannot see, and silence there reads as the
    // drop having missed.
    const lost = names.filter((name) => name === null).length
    if (lost > 0) {
      set({
        notice: lost === 1 ? 'One image could not be added' : `${lost} images could not be added`
      })
    }
  },

  dropImages: async (sources, at) => {
    const where = get().workspacePath
    if (!where || sources.length === 0) return
    await get().putImages(await window.api.attachImages(where, sources), at)
  },

  pickImages: async (at) => {
    const where = get().workspacePath
    if (!where) return
    const sources = await window.api.pickImages()
    if (sources.length === 0) return
    await get().putImages(await window.api.attachImages(where, sources), at)
  },

  // The clipboard hands over bytes and a type and no file at all - a screenshot
  // has never been on the disk - so this is the one way in that has to write
  // the file itself, and the one that has to make up a name.
  pasteImages: async (files) => {
    const where = get().workspacePath
    if (!where) return
    const names: (string | null)[] = []
    // One clock reading for the lot. Two pictures pasted together are one
    // paste, and what tells them apart on disk is the folder handing the second
    // one a -2 rather than a second that may or may not have ticked over.
    const at = new Date()
    for (const file of files) {
      const extension = extensionForType(file.type)
      // A type the window could not draw. Refused at the door rather than
      // written into files/ and then shown as a picture that is missing.
      if (extension === null) {
        names.push(null)
        continue
      }
      const bytes = new Uint8Array(await file.arrayBuffer())
      names.push(await window.api.attachBytes(where, pastedName(at, extension), bytes))
    }
    await get().putImages(names, null)
  },

  // Step 9. The selection when there is one, the whole canvas when there is
  // not - the same rule for all three doors, so there is nothing to remember
  // about which one takes what.
  exportCanvasFile: async () => {
    const { canvas, workspacePath } = get()
    if (!canvas || canvas.broken || !workspacePath) return
    const going = chosen(get())
    if (going.length === 0) {
      set({ notice: 'There is nothing on the canvas to export' })
      return
    }
    const result = await window.api.exportCanvas(
      workspacePath,
      `${leafOf(workspacePath)}-canvas.json`,
      going,
      canvas.extra
    )
    // Null is the dialog closed with nothing chosen. Not a failure, and a
    // notice about it would be the app arguing with a decision.
    if (result === null) return
    set({
      notice: result.ok
        ? `Exported ${count(going.length)} to ${leafOf(result.path)}`
        : `The canvas could not be exported: ${result.why}`
    })
  },

  // We settled where an import lands: beside what is already drawn, not over
  // it. So this is an ordinary edit - one write, one entry in the history, and
  // Ctrl+Z takes the whole thing back out again.
  importCanvasFile: async () => {
    const { canvas, workspacePath } = get()
    if (!canvas || canvas.broken || !workspacePath) return
    const result = await window.api.importCanvas(workspacePath)
    if (result === null) return
    if (!result.ok) {
      set({ notice: `That file could not be read as a canvas: ${result.why}` })
      return
    }
    // The workspace can be changed while the picker is open, and the pictures
    // have already been written into the folder of the one that was open when
    // it opened. Landing the objects on a different canvas would name files
    // that are not in its folder.
    const now = get()
    if (now.workspacePath !== workspacePath || !now.canvas || now.canvas.broken) return
    if (result.objects.length === 0) {
      set({ notice: `There was nothing on the canvas in ${result.name}` })
      return
    }

    const landed = place(now.canvas.objects, result.objects)
    writeCanvas(
      { ...now.canvas, objects: [...now.canvas.objects, ...landed] },
      set,
      get,
      get().gesture('import')
    )
    set({
      selectedIds: landed.map((object) => object.id),
      editingId: null,
      tool: 'select',
      // What was quietly changed on the way in is said, the same way the canvas
      // reader says what it corrected. A picture that came in under another
      // name is a thing the person would otherwise find out about by noticing
      // it.
      notice:
        `Imported ${count(landed.length)} from ${result.name}` +
        (result.notes.length > 0 ? ` (${result.notes.join('; ')})` : '')
    })
    get().canvasAction('fit')
  },

  exportPicture: async (kind) => {
    const { canvas, workspacePath } = get()
    if (!canvas || canvas.broken || !workspacePath) return
    const going = chosen(get())
    if (going.length === 0) {
      set({ notice: 'There is nothing on the canvas to export' })
      return
    }
    let bytes: Uint8Array
    try {
      const svg = await buildSvg({
        workspacePath,
        objects: going,
        all: canvas.objects,
        // We settled it: nothing behind the drawing.
        background: null
      })
      if (svg === null) {
        set({ notice: 'Nothing on the canvas has a place to draw it in' })
        return
      }
      bytes = kind === 'svg' ? textBytes(svg) : await toPng(svg)
    } catch (error) {
      set({ notice: `The picture could not be made: ${plainWhy(error)}` })
      return
    }
    const result = await window.api.saveExport(
      `${leafOf(workspacePath)}-canvas.${kind}`,
      kind,
      bytes
    )
    if (result === null) return
    set({
      notice: result.ok
        ? `Exported ${leafOf(result.path)}`
        : `The picture could not be saved: ${result.why}`
    })
  },

  exportKanban: async (board, ground) => {
    const workspacePath = get().workspacePath
    if (!workspacePath) return
    if (!board.querySelector('.column')) {
      set({ notice: 'There are no columns to export' })
      return
    }
    let bytes: Uint8Array
    try {
      bytes = await kanbanPng(board, ground, workspacePath)
    } catch (error) {
      set({ notice: `The picture could not be made: ${plainWhy(error)}` })
      return
    }
    const result = await window.api.saveExport(`${leafOf(workspacePath)}-kanban.png`, 'png', bytes)
    if (result === null) return
    set({
      notice: result.ok
        ? `Exported ${leafOf(result.path)}`
        : `The picture could not be saved: ${result.why}`
    })
  },

  repoint: (id, which, end, mark = null) => {
    if (end === null) return
    // An end pointed at something else is tied where it lands, the same as one
    // that was drawn there, against where the arrow's OTHER end actually
    // is, which is the place it remembers if it remembers one. A loose point on
    // its way through a drag has nothing to tie, and tie() hands it straight
    // back.
    const objects = get().canvas?.objects ?? []
    const find = (one: string): CanvasObject | undefined =>
      objects.find((object) => object.id === one)
    const arrow = find(id)
    const other = arrow ? endpointOf(arrow, which === 'from' ? 'to' : 'from') : null
    get().patchObject(id, { [which]: tie(end, other, find) }, mark)
  },

  patchObject: (id, props, mark = null) => get().patchMany([{ id, props }], mark),

  patchMany: (patches, mark = null) => {
    const canvas = get().canvas
    if (!canvas || canvas.broken || patches.length === 0) return
    const held = new Map(canvas.objects.map((object) => [object.id, object]))
    const real = new Map<string, Record<string, unknown>>()
    for (const one of patches) {
      const object = held.get(one.id)
      if (object && changes(object, one.props)) real.set(one.id, one.props)
    }
    // Nothing here would change anything, so nothing is written and nothing is
    // remembered. See changes() above for what that is guarding against.
    if (real.size === 0) return
    // One write for the lot. Several of them would be several entries in the
    // history, and moving five boxes is one move however many boxes it was.
    writeCanvas(
      {
        ...canvas,
        objects: canvas.objects.map((object) => {
          const props = real.get(object.id)
          return props ? { ...object, props: merged(object.props, props) } : object
        })
      },
      set,
      get,
      mark
    )
  },

  patchText: (id, text) => get().patchObject(id, { text }, `text:${id}#${burst}`),

  removeObjects: (ids) => {
    const canvas = get().canvas
    if (!canvas || canvas.broken || ids.length === 0) return
    const going = new Set(ids)
    writeCanvas(
      { ...canvas, objects: canvas.objects.filter((one) => !going.has(one.id)) },
      set,
      get,
      null
    )
    set({ selectedIds: [], editingId: null })
  },

  orderObjects: (ids, to) => {
    const canvas = get().canvas
    if (!canvas || canvas.broken || ids.length === 0) return
    const next = reordered(canvas.objects, ids, to)
    // Already where it was asked to go: nothing written, nothing to undo.
    if (next.every((object, index) => object === canvas.objects[index])) return
    writeCanvas({ ...canvas, objects: next }, set, get, null)
  },

  duplicateObjects: (ids) => {
    const canvas = get().canvas
    if (!canvas || canvas.broken || ids.length === 0) return
    const copies = copiesOf(canvas.objects, ids)
    if (copies.length === 0) return
    // On top of the drawing, where something just made belongs.
    writeCanvas({ ...canvas, objects: [...canvas.objects, ...copies] }, set, get, null)
    // The copies are what is held afterwards, so a drag takes them off the
    // originals and a second press copies the copy.
    set({ selectedIds: copies.map((copy) => copy.id), editingId: null })
  },

  eraseObjects: (ids, mark) => {
    const canvas = get().canvas
    if (!canvas || canvas.broken || ids.length === 0) return
    const going = new Set(ids)
    writeCanvas(
      { ...canvas, objects: canvas.objects.filter((one) => !going.has(one.id)) },
      set,
      get,
      mark
    )
  },

  undoCanvas: () => {
    const { canvas, history } = get()
    if (!canvas || canvas.broken) return
    const step = undoStep(history, canvas)
    if (step) applyStep(step, set, get)
  },

  redoCanvas: () => {
    const { canvas, history } = get()
    if (!canvas || canvas.broken) return
    const step = redoStep(history, canvas)
    if (step) applyStep(step, set, get)
  },

  patchTarget: (props, mark = null) => {
    const { selectedIds } = get()
    // Every one of them, in one write. A swatch pressed over a selection of
    // five means all five: that is what having taken hold of five things is.
    if (selectedIds.length > 0) {
      const taken = sameKindAsTop(get().canvas?.objects ?? [], selectedIds)
      return get().patchMany(
        taken.map((object) => ({ id: object.id, props })),
        mark
      )
    }
    const key = seedOf(get())
    set({ [key]: merged(get()[key], props) } as Partial<State>)
  },

  patchTargetStyle: (style, mark = null) => {
    const { selectedIds } = get()
    if (selectedIds.length > 0) {
      // Merged into each object's own style rather than laid over the top of
      // it, so two boxes at different sizes both made bold keep their sizes.
      return get().patchMany(
        sameKindAsTop(get().canvas?.objects ?? [], selectedIds).map((object) => ({
          id: object.id,
          props: {
            textStyle: merged(
              (object.props.textStyle ?? {}) as Record<string, unknown>,
              style
            )
          }
        })),
        mark
      )
    }
    const key = seedOf(get())
    const seed = get()[key]
    const now = (seed.textStyle ?? {}) as Record<string, unknown>
    set({ [key]: { ...seed, textStyle: merged(now, style) } } as Partial<State>)
  },


  // Asked for once per workspace. A workspace nobody has looked at opens at the
  // origin, and so does one whose saved viewport no longer reads as three
  // finite numbers - the file it comes from is one a person can edit.
  loadViewport: async (workspacePath) => {
    if (get().viewportFor === workspacePath) return
    flushViewport()
    const saved = await window.api.readViewport(workspacePath)
    // The workspace may have changed again while that was in flight.
    if (useVault.getState().workspacePath !== workspacePath) return
    set({ viewportFor: workspacePath, viewport: saved ?? ORIGIN })
  },

  setViewport: (viewport) => {
    if (sameViewport(get().viewport, viewport)) return
    set({ viewport })
    const path = get().viewportFor
    if (path) rememberViewport(path, viewport)
  },

  panCanvas: (dx, dy) => get().setViewport(panBy(get().viewport, dx, dy)),

  // One road for the buttons and the keys, so the sheet that lists the keys
  // cannot describe something the buttons do differently.
  canvasAction: (action) => {
    const { viewport, canvasSize, setViewport } = get()
    const middle = { x: canvasSize.w / 2, y: canvasSize.h / 2 }
    if (action === 'zoom-in') setViewport(zoomStep(viewport, 1, middle.x, middle.y))
    else if (action === 'zoom-out') setViewport(zoomStep(viewport, -1, middle.x, middle.y))
    else if (action === 'zoom-reset') setViewport(resetZoom(viewport, canvasSize))
    // Everything that is on the canvas, or the origin when nothing is - which
    // is what an empty canvas has to answer with rather than nothing at all.
    else if (action === 'undo') get().undoCanvas()
    else if (action === 'redo') get().redoCanvas()
    else if (action === 'select-all') get().selectAll()
    else if (action === 'delete') get().removeObjects(get().selectedIds)
    else if (action === 'fit') {
      const objects = get().canvas?.objects ?? []
      const find = (id: string): CanvasObject | undefined =>
        objects.find((object) => object.id === id)
      const boxes: Box[] = []
      for (const object of objects) {
        // An arrow is not anywhere on its own - it is wherever the things it
        // joins have got to. So it is asked rather than read, and an arrow
        // whose binding points at nothing is not a place at all.
        if (isArrow(object)) {
          const ends = arrowEnds(object, find)
          if (ends) boxes.push(boundsOfPoints([ends.from, ends.to]) as Box)
          continue
        }
        const box = placeOf(object)
        if (box) boxes.push(box)
      }
      setViewport(fit(boundsOf(boxes), canvasSize))
    }
  },

  // Every one of these takes the notice down with it. The line it puts up says
  // a card is hidden by the filter, and the moment the filter moves that
  // sentence is about a board that no longer exists.
  setFilterOpen: (open) => set({ filterOpen: open }),
  toggleFilterTag: (name) =>
    set((state) => ({
      filter: { ...state.filter, tags: toggle(state.filter.tags, name) },
      notice: null
    })),
  toggleFilterDue: (due) =>
    set((state) => ({
      filter: { ...state.filter, due: toggle(state.filter.due, due) },
      notice: null
    })),
  toggleFilterPriority: (value) =>
    set((state) => ({
      filter: { ...state.filter, priority: toggle(state.filter.priority, value) },
      notice: null
    })),
  showArchived: (on) =>
    set((state) => ({ filter: { ...state.filter, archived: on }, notice: null })),
  clearFilter: () => set({ filter: NO_FILTER, calendarWorkspaces: [], notice: null }),
  toggleCalendarWorkspace: (path) =>
    set((state) => ({
      calendarWorkspaces: toggle(state.calendarWorkspaces, path),
      notice: null
    })),

  // Asked for once on the way up. Which folders this app knows is main's
  // answer, not something to derive from the vault on screen: a vault opened
  // and left is still one this app knows about.
  loadVaults: async () => set({ vaults: await window.api.knownVaults() }),

  openVaultMenu: (open) => set({ vaultMenuOpen: open }),

  setKeys: (open) => set({ keysOpen: open }),

  openSwitcher: (open) => set({ switcherOpen: open }),

  // The same landing as choose(), and deliberately so: which road a vault was
  // opened by - a dialog or this menu - must not leave the window in two
  // different states afterwards.
  switchVault: async (path) => {
    if (get().vault?.path === path) {
      set({ vaultMenuOpen: false })
      return true
    }
    if (get().dirty) await get().saveDraft()
    const vault = await window.api.openVault(path)
    if (!vault) return false
    const workspacePath = settle(vault, null)
    set({
      vault,
      workspacePath,
      tab: tabOf(vault, workspacePath, get().workspaceOpens),
      openId: null,
      draft: null,
      dirty: false,
      vaultMenuOpen: false
    })
    // The list moved: whatever was just opened is now the most recent one.
    await get().loadVaults()
    return true
  },

  // Opening and closing is one decision, so it goes to disk as it happens. The
  // width it reopens at is the one it had, which is why the whole pair is
  // written rather than the flag on its own.
  // Only the answer. The tab on screen stays where it is; the next workspace
  // gone into is what reads it.
  setWorkspaceOpens: (workspaceOpens) => set({ workspaceOpens }),

  toggleSidebar: () => {
    const sidebar = { ...get().sidebar, collapsed: !get().sidebar.collapsed }
    set({ sidebar })
    void window.api.setSidebar(sidebar)
  },

  closeSidebar: () => {
    if (get().sidebar.collapsed) return
    const sidebar = { ...get().sidebar, collapsed: true }
    set({ sidebar })
    void window.api.setSidebar(sidebar)
  },

  // The section is set in the same breath as the panel is opened, because the
  // rail lives inside the panel: choosing "search" while the panel is closed
  // has to end with a search on screen or it did nothing at all. Only written
  // to disk if the panel had to move, since the section itself is not kept.
  setSection: (section) => {
    set({ section })
    if (!get().sidebar.collapsed) return
    const sidebar = { ...get().sidebar, collapsed: false }
    set({ sidebar })
    void window.api.setSidebar(sidebar)
  },

  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setSearchSort: (searchSort) => set({ searchSort }),
  setSearchFilter: (searchFilter) => set({ searchFilter }),
  clearSearchFilter: () => set({ searchFilter: NO_FILTER, searchScope: [] }),
  setSearchScope: (searchScope) => set({ searchScope }),

  // The words come over, the narrowing does not get invented. Whatever filter
  // the section was already carrying stays: the bridge is "show me these in the
  // other surface", and a bridge that also cleared the filter would be
  // answering a question the user did not ask.
  //
  // The palette is closed first so the panel is what is left on screen, and the
  // section is set through setSection rather than by writing the field, because
  // that is the one place that knows the rail needs an open panel to live on.
  openSearch: (query) => {
    set({ paletteOpen: false, searchQuery: query })
    get().setSection('search')
  },

  // Moved on screen at once, written down when the hand lets go. The viewport's
  // argument, at a slower rate: a pointermove is tens of events a second and a
  // file write behind each of them is a file write behind each of them. What is
  // stored is the same number either way; only how often it is stored changes.
  dragSidebar: (width, commit) => {
    const sidebar = { ...get().sidebar, width: clampWidth(width), collapsed: false }
    set({ sidebar })
    if (commit) void window.api.setSidebar(sidebar)
  },

  load: async () => {
    const [vault, workspaceOpens] = await Promise.all([
      window.api.loadVault(),
      window.api.workspaceOpensNow()
    ])
    set({ workspaceOpens })
    const workspacePath = settle(vault, get().workspacePath)
    set({ vault, workspacePath, tab: tabOf(vault, workspacePath, get().workspaceOpens), loading: false })
    // After the vault, not beside it. Main puts a folder on the known list as
    // part of opening it, so a list asked for at the same time as the open is a
    // list asked for before the write - and it came back empty, which is a menu
    // with nothing in it until something else happens to refresh it. The run
    // caught it on the first launch of a fresh window, which is the only launch
    // where the two are close enough to race.
    await get().loadVaults()
  },

  reloadOutside: async (files) => {
    const before = get().vault
    await get().reload()
    const after = get().vault
    if (before && after && before.path === after.path) outsideChanged(cardsChangedOutside(before, after, files, trailCards()))
  },

  reload: async () => {
    const vault = await window.api.reloadVault()
    if (!vault) return
    const before = get().workspacePath
    const workspacePath = settle(vault, before)
    set({ vault, workspacePath })
    // Only when the ground moved under us - the folder being shown is gone and
    // settle() landed somewhere else. Re-deriving it on every reload would take
    // the user out of the tab they are in every time a file is touched.
    if (workspacePath !== before) set({ tab: viewFor(get().tab, vault, workspacePath, get().workspaceOpens) })

    const { openId, dirty } = get()
    if (!openId) return
    const fresh = vault.workspaces
      .find((w) => w.path === workspacePath)
      ?.cards.find((card) => card.id === openId)

    // The file behind the open panel is gone.
    if (!fresh) {
      set({ openId: null, draft: null, dirty: false, conflict: null })
      return
    }
    // Nothing of ours is pending, so show what the file now says. When there is
    // an unsaved edit the draft stands and the clash surfaces at save time,
    // where the user gets to see both versions.
    if (!dirty) set({ draft: fresh })
  },

  choose: async () => {
    const vault = await window.api.chooseVault()
    if (vault) {
      const workspacePath = settle(vault, null)
      set({
        vault,
        workspacePath,
        tab: tabOf(vault, workspacePath, get().workspaceOpens),
        openId: null,
        draft: null,
        dirty: false,
        vaultMenuOpen: false
      })
      // Main put it on the list when it opened it; this is the window catching
      // up with that rather than a second place deciding what the list is.
      await get().loadVaults()
    }
  },

  // Leaving a workspace takes the panel down with it, and the autosave timer may
  // still be holding the last keystrokes. Same rule as closing a card: write
  // first, and stay put when the write hits a clash the user has not answered.
  select: async (path) => {
    if (get().workspacePath === path) return
    if (get().dirty) await get().saveDraft()
    if (get().conflict) return
    const view = viewFor(get().tab, get().vault, path, get().workspaceOpens)
    set({
      workspacePath: path,
      tab: view,
      openId: null,
      draft: null,
      dirty: false,
      composingIn: null,
      // A filter is set against one folder's labels and priorities. Carrying it
      // to the next folder would subtract cards there for a reason nobody could
      // see, so it is dropped at the door.
      //
      // Not on the calendar, where that reasoning does not hold: its filter is
      // built from every workspace's labels at once and is narrowing a view that
      // spans all of them. Clearing it because a card was opened from another
      // folder would undo the user's own work behind their back.
      filter: view === 'calendar' ? get().filter : NO_FILTER,
      notice: null
    })
  },

  // Same promise as leaving a workspace: the panel is going off screen, so what
  // is in it is written first and an unanswered clash keeps us where we are.
  // The write to disk is what makes the tab survive a restart, and the copy in
  // memory is updated with it so coming back to this workspace does not read
  // the value the vault was loaded with.
  setTab: async (tab) => {
    const { workspacePath } = get()
    if (!workspacePath || get().tab === tab) return
    if (get().dirty) await get().saveDraft()
    if (get().conflict) return

    // The calendar is not a workspace's tab, so nothing about it is written and
    // `lastTab` is left holding the last kanban-or-canvas answer. Coming back
    // from the calendar therefore lands where the workspace actually was.
    if (tab === 'calendar') {
      set({ tab, openId: null, draft: null, dirty: false, composingIn: null })
      return
    }

    // Read after the save, not before it. The save moves the card's hash
    // forward in here, and writing back a copy taken before it would hand the
    // next save a baseline the file has already moved past - which reads on
    // screen as the file having been changed by somebody else.
    const { vault } = get()
    set({
      tab,
      openId: null,
      draft: null,
      dirty: false,
      composingIn: null,
      vault: vault
        ? {
            ...vault,
            workspaces: vault.workspaces.map((workspace) =>
              workspace.path === workspacePath ? { ...workspace, lastTab: tab } : workspace
            )
          }
        : vault
    })
    await window.api.setWorkspaceTab(workspacePath, tab)
  },

  openPalette: (seed = '') => set({ paletteOpen: true, paletteSeed: seed }),
  closePalette: () => set({ paletteOpen: false }),
  composeIn: (columnId) => set({ composingIn: columnId }),
  composeWorkspace: (on) => set({ composingWorkspace: on }),
  composeColumn: (on) => set({ composingColumn: on }),
  landed: (columnId) => set({ landedIn: columnId }),
  openTrash: () => set({ trashOpen: true }),
  closeTrash: () => set({ trashOpen: false }),
  openArchive: () => set({ archiveOpen: true }),
  closeArchive: () => set({ archiveOpen: false }),

  addWorkspace: async (name) => {
    const { vault } = get()
    if (!vault) return
    const path = await window.api.createWorkspace(vault.path, name)
    await get().reload()
    // Straight to it. Making a folder you are not taken to is a folder you go
    // looking for.
    await get().select(path)
  },

  renameWorkspace: async (path, name) => {
    await window.api.renameWorkspace(path, name)
    await get().reload()
  },

  // On screen at once, on disk behind it. A colour well fires on every step of
  // a drag through the system picker, and each of those is a whole read and
  // rewrite of workspace.json - two of which racing is how the tabs section
  // once lost a write to EPERM with every check green. So they go through
  // writeBackground one at a time, and only the newest one waiting is written.
  setBackground: async (background) => {
    const { workspacePath, vault } = get()
    if (!workspacePath || !vault) return
    set({
      vault: {
        ...vault,
        workspaces: vault.workspaces.map((workspace) => {
          if (workspace.path !== workspacePath) return workspace
          const next = { ...workspace }
          if (background) next.background = background
          else delete next.background
          return next
        })
      }
    })
    await writeBackground(workspacePath, background)
  },

  // A colour named. The name is the app's own list of labels in the folder
  // on screen, so it is written here and pushed to the file; a card carries the
  // colour's word and not the name, so no card is touched by this at all.
  nameLabel: async (key, name) => {
    const { vault, workspacePath } = get()
    const clean = labelKeyOf(key)
    if (!vault || !workspacePath || !clean) return
    const words = name.trim()
    set({
      vault: {
        ...vault,
        workspaces: vault.workspaces.map((workspace) => {
          if (workspace.path !== workspacePath) return workspace
          const rest = workspace.labels.filter((label) => label.key !== clean)
          const own = workspace.labels.find((label) => label.key === clean)
          return {
            ...workspace,
            labels: words
              ? [...rest, { ...colourLabel(workspace.labels, clean), name: words }]
              : own
                ? [...rest, { ...own, name: '' }]
                : rest
          }
        })
      }
    })
    await window.api.setWorkspaceLabel(workspacePath, clean, words)
  },

  setBookmark: async (path, on) => {
    const vault = get().vault
    if (!vault) return
    set({
      vault: {
        ...vault,
        workspaces: vault.workspaces.map((workspace) => {
          if (workspace.path !== path) return workspace
          const next = { ...workspace }
          if (on) next.bookmarked = true
          else delete next.bookmarked
          return next
        })
      }
    })
    await window.api.setWorkspaceBookmark(path, on)
  },

  trashWorkspace: async (path) => {
    await window.api.trashWorkspace(path)
    // The panel may be showing a card that just left the vault, and settle()
    // in reload cannot know that until the read comes back.
    if (get().workspacePath === path) {
      set({ workspacePath: null, openId: null, draft: null, dirty: false, conflict: null })
    }
    await get().reload()
  },

  addColumn: async (title) => {
    const workspace = currentWorkspace(get())
    if (!workspace) return
    const name = title.trim()
    if (!name) return
    get().applyColumns([
      ...workspace.columns,
      { id: newId('c'), title: name, cards: [], extra: {} }
    ])
    await get().saveColumns()
  },

  renameColumn: async (columnId, title) => {
    const workspace = currentWorkspace(get())
    const name = title.trim()
    if (!workspace || !name) return
    get().applyColumns(
      workspace.columns.map((column) =>
        column.id === columnId ? { ...column, title: name } : column
      )
    )
    await get().saveColumns()
  },

  moveColumn: async (columnId, by) => {
    const workspace = currentWorkspace(get())
    if (!workspace) return
    const from = workspace.columns.findIndex((column) => column.id === columnId)
    const to = from + by
    if (from < 0 || to < 0 || to >= workspace.columns.length) return
    const columns = [...workspace.columns]
    const [moved] = columns.splice(from, 1)
    columns.splice(to, 0, moved)
    get().applyColumns(columns)
    await get().saveColumns()
  },

  // Returns why it did not happen, or null when it did. Nothing is deleted
  // here: the cards are files, and they move to the first column that is left.
  removeColumn: async (columnId) => {
    const workspace = currentWorkspace(get())
    if (!workspace) return 'No workspace is open.'
    const going = workspace.columns.find((column) => column.id === columnId)
    if (!going) return 'That column is already gone.'

    const rest = workspace.columns.filter((column) => column.id !== columnId)
    if (going.cards.length > 0 && rest.length === 0) {
      // With no columns left the loader has nowhere to put them, and the cards
      // would sit on disk with nothing on screen showing them.
      return 'Move its cards somewhere first, or this is the last column.'
    }
    if (going.cards.length > 0) {
      rest[0] = { ...rest[0], cards: [...rest[0].cards, ...going.cards] }
    }
    get().applyColumns(rest)
    await get().saveColumns(undefined, going.cards)
    return null
  },

  // Moves land on screen straight away. The file follows in saveColumns, and
  // a write that failed, or met a move from outside, pulls the truth back off disk.
  applyColumns: (columns) => {
    const { vault, workspacePath } = get()
    if (!vault || !workspacePath) return
    set({
      vault: {
        ...vault,
        workspaces: vault.workspaces.map((workspace) =>
          workspace.path === workspacePath ? { ...workspace, columns } : workspace
        )
      }
    })
  },

  saveColumns: async (at, moved = []) => {
    const { vault, workspacePath } = get()
    const workspace = vault?.workspaces.find((w) => w.path === (at ?? workspacePath))
    if (!workspace) return

    try {
      // Some ids were made up at load time because the file had none. Ordering
      // may only point at ids that really exist on disk, so give those files
      // their id now that the user has moved something.
      for (const card of workspace.cards) {
        if (card.idIsNew && !card.broken) await window.api.saveCard(card, card.hash)
      }

      // A card we could not parse never gets one, since writing to it would
      // destroy what the user wrote. It stays out of the ordering and keeps
      // showing up in the first column.
      const unwritable = new Set(
        workspace.cards.filter((card) => card.broken).map((card) => card.id)
      )
      // Held to what was last read of the file, v0.4 step 6. A move written
      // from outside since is merged with this one card by card in main; the
      // board is then read again, since what is on disk is no longer only what
      // this window put there.
      const result = await window.api.saveColumns(
        {
          workspacePath: workspace.path,
          columns: workspace.columns.map((column) => ({
            ...column,
            cards: column.cards.filter((id) => !unwritable.has(id))
          })),
          extra: workspace.columnsExtra
        },
        workspace.columnsSeen ?? null,
        // What this window moved, and what the agents it heard from did: see
        // movedCards in shared/merge.ts.
        moved,
        [...trailCards()]
      )
      if (result.merged) {
        await get().reload()
        // What the file had moved that this window did not, said on the line:
        // the watcher's turn finds nothing once the merged order is read back.
        const now = get().vault?.workspaces.find((one) => one.path === workspace.path)
        outsideChanged(
          result.outside.flatMap((id) => {
            const card = now?.cards.find((one) => one.id === id) ?? workspace.cards.find((one) => one.id === id)
            return card ? [{ workspace: workspace.path, workspaceName: workspace.name, card: id, title: card.title }] : []
          })
        )
        return
      }
      const now = get().vault
      if (now) {
        set({
          vault: {
            ...now,
            workspaces: now.workspaces.map((one) => (one.path === workspace.path ? { ...one, columnsSeen: result.seen } : one))
          }
        })
      }
    } catch (error) {
      // The move is taken back off the screen by the reload, so the screen says
      // why rather than letting a card jump back without a word.
      await get().reload()
      set({ notice: `The move was not saved: ${plainWhy(error)}` })
    }
  },

  openCard: (id) => {
    const card = currentWorkspace(get())?.cards.find((entry) => entry.id === id)
    if (card) set({ openId: id, draft: { ...card }, dirty: false, conflict: null })
  },

  // A search hit may live in a workspace that is not the one on screen, so
  // opening it is a move and an open, in that order.
  openCardAt: async (workspacePath, cardId) => {
    if (get().workspacePath !== workspacePath) {
      await get().select(workspacePath)
      // select refuses while a conflict is unanswered. Opening a card from
      // another folder would then show a card the kanban is not displaying.
      if (get().workspacePath !== workspacePath) return
    }
    get().openCard(cardId)
  },

  closeCard: async () => {
    // Autosave runs on a timer, so closing early would drop the last keystrokes.
    if (get().dirty) await get().saveDraft()
    if (get().conflict) return
    set({ openId: null, draft: null, dirty: false })
  },

  editCard: (patch) => {
    const { draft } = get()
    if (!draft) return
    set({ draft: { ...draft, ...patch }, dirty: true })
  },

  saveDraft: () =>
    queued(async () => {
      const { draft, conflict } = get()
      if (!draft || conflict) return

      const result = draft.broken
        ? await window.api.saveCardText(draft.file, draft.body, draft.hash)
        : await window.api.saveCard(draft, draft.hash)

      if (!result.ok) {
        set({ conflict: { disk: result.disk, mine: result.mine } })
        return
      }
      // The hash moves forward with the file, so the next autosave compares
      // against what we just wrote rather than what we first read.
      const saved = { ...draft, hash: result.hash }
      set({ draft: saved, dirty: false })
      putCard(set, get, saved)
    }),

  resolveConflict: async (keep) => {
    const { draft } = get()
    set({ conflict: null })
    if (!draft) return

    if (keep === 'mine') {
      const result = draft.broken
        ? await window.api.saveCardText(draft.file, draft.body, null)
        : await window.api.saveCard(draft, null)
      if (result.ok) {
        const saved = { ...draft, hash: result.hash }
        set({ draft: saved, dirty: false })
        putCard(set, get, saved)
      }
      return
    }

    set({ dirty: false })
    await get().reload()
    const fresh = currentWorkspace(get())?.cards.find((card) => card.id === draft.id)
    set({ draft: fresh ? { ...fresh } : null, openId: fresh ? draft.id : null })
  },

  moveToColumn: (cardId, columnId) => {
    const workspace = currentWorkspace(get())
    if (!workspace) return
    const next = moveCard(workspace.columns, cardId, { columnId, overCardId: null })
    get().applyColumns(next)
    void get().saveColumns(undefined, [cardId])
  },

  // `template` is the bare file name of one in templates/, or nothing for the
  // plain card. Both go down the same road from here on: the difference is
  // decided in main, which is the only side that reads the folder.
  addCard: async (columnId, title, template = null) => {
    const workspace = currentWorkspace(get())
    if (!workspace) return

    const card = await window.api.createCard(workspace.path, title, template)
    // Only a named template can come back empty handed, and it means the file
    // was refused or is gone. Saying so beats making a card that is not the one
    // that was asked for and looks like it worked.
    if (!card) {
      set({ notice: 'That template could not be read. Nothing was made.' })
      return
    }
    const columns = workspace.columns.map((column) =>
      column.id === columnId ? { ...column, cards: [...column.cards, card.id] } : column
    )
    putCard(set, get, card, columns)
    // Said before the write to disk rather than after it: the card is on screen
    // now, and the column should arrive at it in the same breath rather than a
    // disk write later.
    set({ landedIn: columnId })
    await get().saveColumns(undefined, [card.id])
    // A card made while the filter is on may be born straight into the part of
    // the board that is not drawn. The column already says "1 more hidden";
    // this says which card that is, which is the difference between a count and
    // an answer - and it is the only thing said about a new card, so
    // it matters more than it did.
    //
    // The panel is NOT opened. It was, from v0.1, and it was taken away:
    // adding a card should not bring its details up straight after. A
    // panel over the board is the end of a fast loop, and the loop is what
    // filling a column actually is. So no new card opens a panel any more: the
    // palette's "New card in …" goes through the same box in the column, and a
    // quick capture never opened one either.
    const { filter } = get()
    set({
      notice:
        isOn(filter) && !matches(card, filter)
          ? `"${card.title}" is hidden by the filter.`
          : null
    })
  },

  // Pictures pasted into the Add card box, a card for each. Made one after
  // another so each gets its own name on disk, then put into the column together
  // and written once. Like addCard, no panel opens: the box stays where it was.
  addImageCards: async (columnId, pictures) => {
    const workspace = currentWorkspace(get())
    if (!workspace) return

    const made: Card[] = []
    for (const picture of pictures) {
      const extension = extensionForType(picture.type)
      if (extension === null) continue
      const bytes = new Uint8Array(await picture.arrayBuffer())
      const card = await window.api.createImageCard(workspace.path, bytes, extension)
      if (card) made.push(card)
    }
    if (made.length === 0) {
      set({ notice: 'That picture could not be added.' })
      return
    }

    const now = currentWorkspace(get())
    if (!now || now.path !== workspace.path) return
    const ids = made.map((card) => card.id)
    const columns = now.columns.map((column) =>
      column.id === columnId ? { ...column, cards: [...column.cards, ...ids] } : column
    )
    for (const card of made) putCard(set, get, card, columns)
    set({ landedIn: columnId })
    // The pictures are in files/ already. The list a cover is drawn from is told
    // now rather than when the watcher next looks, or the card would show
    // without its cover for that long.
    const { vault } = get()
    if (vault) {
      set({
        vault: {
          ...vault,
          workspaces: vault.workspaces.map((one) =>
            one.path === workspace.path
              ? { ...one, files: [...new Set([...one.files, ...made.flatMap((card) => card.files)])] }
              : one
          )
        }
      })
    }
    await get().saveColumns(undefined, ids)
    const { filter } = get()
    const hidden = made.filter((card) => isOn(filter) && !matches(card, filter)).length
    set({ notice: hidden > 0 ? `${hidden === 1 ? 'The new card is' : `${hidden} new cards are`} hidden by the filter.` : null })
  },

  // A card caught from the quick capture box, in the workspace and column the
  // box named.
  //
  // It no longer goes through addCard. It used to, so that one place
  // decided what a new card is - but addCard writes to the folder on screen and
  // opens a panel on what it makes, and the whole point of the two menus is
  // that a capture does not have to land where the window is. What still holds
  // is the part that mattered: the card itself is made by main's createCard,
  // which is that one place. Everything around it here is the ordinary way a
  // card is put into a column.
  //
  // The panel is still NOT opened. A capture is something you dropped and
  // walked away from; opening a panel on it would mean the next time the window
  // is looked at, there is an editor open on a card nobody asked to see.
  captureCard: async (title, asked = null) => {
    const { vault, workspacePath } = get()
    // Resolved here as well as in the box, against this window's own copy of
    // the vault. What arrives is what the box could see when it was opened, and
    // a folder can be renamed or a column deleted while it sits there.
    const where = placeIn(targetOf(vault, workspacePath), asked)
    const workspace = vault?.workspaces.find((one) => one.path === where?.path)
    const column = workspace?.columns.find((one) => one.id === where?.columnId)
    if (!where || !workspace || !column) return

    // A capture can arrive at any moment, including a moment while something is
    // half typed - that is the whole point of it, and it is what makes this
    // different from the button. So whatever is on screen is written first, and
    // an unanswered clash stops the capture rather than swallowing the edit.
    if (get().dirty) await get().saveDraft()
    if (get().conflict) {
      set({ notice: 'A card on screen is waiting on an answer. Nothing was captured.' })
      return
    }

    const card = await window.api.createCard(workspace.path, title, null)
    if (!card) return
    const columns = workspace.columns.map((one) =>
      one.id === column.id ? { ...one, cards: [...one.cards, card.id] } : one
    )
    putCard(set, get, card, columns, workspace.path)
    await get().saveColumns(workspace.path, [card.id])
    // The folder is named as well as the column now that it can be one the
    // window is not showing: "Captured into To do" would otherwise be the whole
    // account of a card that went somewhere else entirely.
    set({ notice: `Captured into ${workspace.name} / ${column.title}: ${card.title}` })
  },

  // From the card that is open, as it stands on screen rather than as it last
  // reached disk: what is in front of you is what you meant to keep. The card
  // is not written and not changed - a template is a copy taken of it, and the
  // one thing that changes here is a new file in templates/.
  saveAsTemplate: async () => {
    const { draft } = get()
    const workspace = currentWorkspace(get())
    if (!workspace || !draft || draft.broken) return
    const file = await window.api.saveTemplate(workspace.path, draft)
    // The watcher would bring it in on its own a moment later. Reading now
    // instead, so the menu has it by the time the notice is read.
    await get().reload()
    set({ notice: `Saved as a template: ${file}` })
  },

  // Archiving is an ordinary card write - one field - so it goes down the same
  // road as autosave and queues behind it. Anything else and the panel's next
  // tick would put the copy it is holding straight back over this one.
  setArchived: (cardId, archived) =>
    queued(async () => {
      const state = get()
      const workspace = currentWorkspace(state)
      const known = workspace?.cards.find((entry) => entry.id === cardId)
      if (!workspace || !known || known.broken) return

      // The open card is written from its draft, not from the vault copy, or
      // whatever is being typed at that moment would be thrown away.
      const source = state.openId === cardId && state.draft ? state.draft : known
      const next = { ...source, archived: archived ? true : undefined }

      const result = await window.api.saveCard(next, next.hash)
      if (!result.ok) {
        // A conflict is a question, and it is only askable while the card is on
        // screen. Archiving from the sheet or from a search hit has no panel to
        // put it in, so that case takes what is on disk instead of leaving a
        // question nobody can see.
        if (get().openId === cardId) set({ conflict: { disk: result.disk, mine: result.mine } })
        else await get().reload()
        return
      }

      const saved = { ...next, hash: result.hash }
      putCard(set, get, saved)
      if (get().openId === cardId) set({ draft: saved, dirty: false })
    }),

  // A card moved on the calendar. Named by workspace rather than found in the
  // one on screen, because the calendar reaches across the vault and the card
  // being dragged is very often not in the selected folder.
  setCardDates: (workspacePath, cardId, dates) =>
    queued(async () => {
      const state = get()
      const workspace = state.vault?.workspaces.find((one) => one.path === workspacePath)
      const known = workspace?.cards.find((entry) => entry.id === cardId)
      if (!workspace || !known || known.broken) return

      // Same rule as archiving: the open card is written from its draft, or
      // whatever is being typed at that moment would be thrown away.
      const source = state.openId === cardId && state.draft ? state.draft : known
      const next = { ...source, ...dates }

      const result = await window.api.saveCard(next, next.hash)
      if (!result.ok) {
        // A conflict is a question and it needs a panel to be asked in. Dragging
        // a card whose panel is closed takes what is on disk instead, the same
        // way archiving from the sheet does.
        if (get().openId === cardId) set({ conflict: { disk: result.disk, mine: result.mine } })
        else await get().reload()
        return
      }

      const saved = { ...next, hash: result.hash }
      putCard(set, get, saved, undefined, workspacePath)
      if (get().openId === cardId) set({ draft: saved, dirty: false })
    }),

  trashCard: async (cardId) => {
    const workspace = currentWorkspace(get())
    const card = workspace?.cards.find((entry) => entry.id === cardId)
    if (!workspace || !card) return

    await window.api.trashCard(card, workspace.path)
    const { vault } = get()
    if (vault) {
      set({
        vault: {
          ...vault,
          workspaces: vault.workspaces.map((entry) =>
            entry.path !== workspace.path
              ? entry
              : {
                  ...entry,
                  cards: entry.cards.filter((one) => one.id !== cardId),
                  columns: entry.columns.map((column) => ({
                    ...column,
                    cards: column.cards.filter((id) => id !== cardId)
                  }))
                }
          )
        }
      })
    }
    if (get().openId === cardId) set({ openId: null, draft: null, dirty: false, conflict: null })
    await get().saveColumns(undefined, [cardId])
  }
}))

// editing.json follows the hand: whenever the canvas, the words open, or the card
// held changes. tellHands says nothing when nothing new is to be said.
useVault.subscribe((state, before) => {
  if (
    state.canvas !== before.canvas ||
    state.editingId !== before.editingId ||
    state.canvasFor !== before.canvasFor ||
    state.cardInHand !== before.cardInHand
  ) {
    tellHands()
  }
})

// The newest background waiting for each workspace, and the one write in
// flight. See setBackground. The promise handed back settles when the queue is
// empty, so whoever awaits it knows the file holds the last value asked for.
const backgroundWaiting = new Map<string, Background | null>()

// The line an agent's changes are on while it is up, and the timer that takes
// it down. See aiChanged. Since v0.4 step 7 it carries changes from outside
// Bothy as well, said after the agent's.
let aiLine: { text: string; changes: AiChange[]; outside: OutsideChange[] } | null = null
let aiTimer: ReturnType<typeof setTimeout> | undefined
// The line can be turned off in Settings, under AI. Off,
// nothing here stops listening - which card of two a trail moved is still what
// the board's merge needs - only the sentence is not put up, and one already up
// goes with the switch.
let changeNotices: ChangeNotices = CHANGE_NOTICES_DEFAULT
export function setChangeNotices(value: ChangeNotices): void {
  changeNotices = value
  if (value === 'none' && aiLine !== null) {
    if (useVault.getState().notice === aiLine.text) useVault.setState({ notice: null })
    aiLine = null
    clearTimeout(aiTimer)
  }
}
// The trails this window heard lately, and when. A change found on disk that one
// of them accounts for was already said as the agent's. Kept as long as a line
// stays up: measured, a trail comes 40 to 77 ms before its file, and the
// board finds the change a settle and a read after that.
let aiLately: { change: AiChange; heard: number }[] = []
// The cards those trails name, for telling which card of two an order moved.
function trailCards(): Set<string> {
  const now = Date.now()
  return new Set(aiLately.filter((one) => now - one.heard < AI_NOTICE_MS).flatMap(({ change }) => (change.card ? [change.card] : [])))
}
// Changes from outside found and not said yet, waiting for a trail. See
// OUTSIDE_HOLD_MS.
let outsideWaiting: OutsideChange[] = []
let outsideTimer: ReturnType<typeof setTimeout> | undefined

// What the line carries while it is still the line on screen.
function lineUp(): { changes: AiChange[]; outside: OutsideChange[] } {
  return aiLine !== null && useVault.getState().notice === aiLine.text ? aiLine : { changes: [], outside: [] }
}

// The line goes by itself a few seconds after the last thing that
// joined it. The timer only ever takes down its own sentence.
function putLine(changes: AiChange[], outside: OutsideChange[]): void {
  if (changeNotices === 'none') return
  const { workspacePath, tab } = useVault.getState()
  const text = [aiNotice(changes, workspacePath, tab), outsideNotice(outside, workspacePath, tab)]
    .filter((one): one is string => one !== null)
    .join(' · ')
  if (text === '') return
  aiLine = { text, changes, outside }
  useVault.setState({ notice: text })
  clearTimeout(aiTimer)
  aiTimer = setTimeout(() => {
    if (aiLine !== null && useVault.getState().notice === aiLine.text) useVault.setState({ notice: null })
    aiLine = null
  }, AI_NOTICE_MS)
}

// What changed on disk with no trail to say who did it is "Changed
// outside Bothy". A trail already heard for the same thing takes it off at once;
// the rest waits OUTSIDE_HOLD_MS for one still on its way, and goes on the line.
function outsideChanged(found: OutsideChange[]): void {
  const now = Date.now()
  aiLately = aiLately.filter((one) => now - one.heard < AI_NOTICE_MS)
  const fresh = found.filter((one) => !aiLately.some(({ change }) => sameThing(change, one)))
  if (fresh.length === 0) return
  outsideWaiting = [...outsideWaiting.filter((one) => !fresh.some((two) => sameThing(two, one))), ...fresh]
  clearTimeout(outsideTimer)
  outsideTimer = setTimeout(() => {
    const waiting = outsideWaiting
    outsideWaiting = []
    if (waiting.length === 0) return
    const line = lineUp()
    putLine(line.changes, [...line.outside.filter((one) => !waiting.some((two) => sameThing(two, one))), ...waiting])
  }, OUTSIDE_HOLD_MS)
}
let backgroundWriting: Promise<void> | null = null

function writeBackground(path: string, background: Background | null): Promise<void> {
  backgroundWaiting.set(path, background)
  if (!backgroundWriting) {
    backgroundWriting = (async () => {
      try {
        for (const [where, value] of backgroundWaiting) {
          backgroundWaiting.delete(where)
          await window.api.setWorkspaceBackground(where, value)
        }
      } finally {
        backgroundWriting = null
      }
    })()
  }
  return backgroundWriting
}

function currentWorkspace(state: State): Workspace | null {
  return state.vault?.workspaces.find((w) => w.path === state.workspacePath) ?? null
}

// Puts one card back into the vault, adding it when it is new. Columns come
// along when the caller changed them in the same breath, so the view never
// paints a card that no column lists yet.
function putCard(
  set: (partial: Partial<State>) => void,
  get: () => State,
  card: Card,
  columns?: Column[],
  // Which folder the card belongs to. Defaults to the one on screen, which is
  // every caller but the calendar - that one writes to cards in workspaces the
  // kanban is not showing, and putting them back into the selected one would
  // move the card to a folder the user never touched.
  atPath?: string
): void {
  const { vault } = get()
  const workspacePath = atPath ?? get().workspacePath
  if (!vault || !workspacePath) return
  set({
    vault: {
      ...vault,
      workspaces: vault.workspaces.map((workspace) => {
        if (workspace.path !== workspacePath) return workspace
        const known = workspace.cards.some((entry) => entry.id === card.id)
        return {
          ...workspace,
          columns: columns ?? workspace.columns,
          cards: known
            ? workspace.cards.map((entry) => (entry.id === card.id ? card : entry))
            : [...workspace.cards, card]
        }
      })
    }
  })
}

export function useWorkspace(): Workspace | null {
  return useVault((state) => state.vault?.workspaces.find((w) => w.path === state.workspacePath) ?? null)
}
