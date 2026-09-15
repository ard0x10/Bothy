import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '../shared/ipc'
import type { CanvasFile, CanvasObject, CanvasWrite } from '../shared/canvas'
import type { EditingItem } from '../shared/editing'
import type { ExportResult, ImportResult } from '../shared/transfer'
import type { Viewport } from '../shared/viewport'
import { colorsFromArguments, type Colors } from '../shared/colors'
import type { Base, SaveThemeResult, ThemeChoice, Themes } from '../shared/themes'
import { sidebarFromArguments, type SidebarState } from '../shared/sidebar'
import type { SettingsNow } from '../shared/settings'
import type { CardView } from '../shared/cardview'
import type { WorkspaceOpens } from '../shared/opening'
import type { Background } from '../shared/background'
import type { AiChange } from '../shared/aitrail'
import type { AiSettings, ChangeNotices } from '../shared/ai'
import type {
  CaptureTarget,
  CaptureWhere,
  Card,
  ColumnsSeen,
  Column,
  OpenResult,
  RestoreResult,
  SaveResult,
  Tab,
  TrashEntry,
  Vault,
  VaultChange
} from '../shared/types'

// The renderer never touches node or the file system. Everything it may do is
// listed here.
const api = {
  platform: process.platform,
  chooseVault: (): Promise<Vault | null> => ipcRenderer.invoke(IPC.chooseVault),
  loadVault: (): Promise<Vault | null> => ipcRenderer.invoke(IPC.loadVault),
  reloadVault: (): Promise<Vault | null> => ipcRenderer.invoke(IPC.reloadVault),
  // D2. Answers with the folders this app has opened before, most recent first.
  knownVaults: (): Promise<string[]> => ipcRenderer.invoke(IPC.knownVaults),
  // Null when the folder is not there any more, or when it is not one of the
  // known ones. Both are the same answer to the window: it did not open.
  openVault: (path: string): Promise<Vault | null> =>
    ipcRenderer.invoke(IPC.openVault, path),
  // baseline is the hash the card was read with. Pass null to write anyway,
  // which is only ever the answer to a conflict the user has looked at.
  saveCard: (card: Card, baseline: string | null): Promise<SaveResult> =>
    ipcRenderer.invoke(IPC.saveCard, card, baseline),
  saveCardText: (file: string, text: string, baseline: string | null): Promise<SaveResult> =>
    ipcRenderer.invoke(IPC.saveCardText, file, text, baseline),
  // `template` is a bare file name in the workspace's templates/ folder, or
  // null for the plain new card. Null comes back when a template was named and
  // main could not read it - refused name, or the file is gone.
  createCard: (
    workspacePath: string,
    title: string,
    template: string | null = null
  ): Promise<Card | null> => ipcRenderer.invoke(IPC.createCard, workspacePath, title, template),
  // A card from a picture's bytes, with the picture on it and as its cover.
  // Null when the picture could not be written.
  createImageCard: (workspacePath: string, bytes: Uint8Array, extension: string): Promise<Card | null> =>
    ipcRenderer.invoke(IPC.createImageCard, workspacePath, bytes, extension),
  // Answers with the file name it wrote inside templates/.
  saveTemplate: (workspacePath: string, card: Card): Promise<string> =>
    ipcRenderer.invoke(IPC.saveTemplate, workspacePath, card),
  trashCard: (card: Card, workspacePath: string): Promise<void> =>
    ipcRenderer.invoke(IPC.trashCard, card, workspacePath),
  // Where a dropped file actually is. Electron took File.path away, so this is
  // the only thing that knows, and it has to be asked on this side of the
  // bridge - the object cannot cross it.
  pathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
  // Copies them into the workspace and answers with the names to write on the
  // card. Copies rather than points at them, so a workspace stays something you
  // can move to another machine with everything it needs inside it.
  attachFiles: (workspacePath: string, sources: string[]): Promise<string[]> =>
    ipcRenderer.invoke(IPC.attachFiles, workspacePath, sources),
  openFile: (workspacePath: string, name: string): Promise<OpenResult> =>
    ipcRenderer.invoke(IPC.openFile, workspacePath, name),
  // Paths, to be handed to attachFiles. Empty when the dialog was closed.
  pickFiles: (): Promise<string[]> => ipcRenderer.invoke(IPC.pickFiles),
  // A colour as #rrggbb, or null when the picture could not be read.
  coverColor: (workspacePath: string, name: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC.coverColor, workspacePath, name),
  // The canvas's own way in, step 8. Answers with one name per source, in the
  // order they were given, and null where a file could not be taken in - the
  // canvas puts each picture where it was dropped, so the list has to keep its
  // shape. A name that comes back may be one already in files/: the same image
  // dropped twice is one file.
  pickImages: (): Promise<string[]> => ipcRenderer.invoke(IPC.pickImages),
  attachImages: (workspacePath: string, sources: string[]): Promise<(string | null)[]> =>
    ipcRenderer.invoke(IPC.attachImages, workspacePath, sources),
  // A pasted image: the bytes and the name they should be written under if they
  // are new. Answers with the name actually used, which is an older one when
  // the workspace already holds these bytes.
  attachBytes: (workspacePath: string, name: string, bytes: Uint8Array): Promise<string | null> =>
    ipcRenderer.invoke(IPC.attachBytes, workspacePath, name, bytes),
  // Held to what the window last read of columns.json, v0.4 step 6. Answers
  // whether something written since had to be merged in, and what the file now
  // holds for the next write to be held to.
  saveColumns: (
    file: {
      workspacePath: string
      columns: Column[]
      extra: Record<string, unknown>
    },
    seen: ColumnsSeen | null,
    // The cards this window moved, and the ones agents' trails named: see writeColumnsOver.
    moved: string[] = [],
    heard: string[] = []
  ): Promise<{ merged: boolean; seen: ColumnsSeen; outside: string[] }> => ipcRenderer.invoke(IPC.saveColumns, file, seen, moved, heard),
  // What the hand is on, v0.4 step 6: see shared/editing.ts.
  setEditing: (items: EditingItem[]): Promise<void> => ipcRenderer.invoke(IPC.setEditing, items),
  // The canvas file. It comes back whole, notes and all, and goes back the same
  // way - the window edits what it read rather than sending a change to apply,
  // so a key the app never heard of survives the round trip.
  readCanvas: (workspacePath: string): Promise<CanvasFile> =>
    ipcRenderer.invoke(IPC.readCanvas, workspacePath),
  // Rejects when the file on disk did not parse. Nothing is written in that
  // case, and the caller is told rather than left thinking it landed. Held to
  // the fingerprint given, v0.4 step 6; a file that moved on comes back instead.
  writeCanvas: (file: CanvasFile, baseline: string | null): Promise<CanvasWrite> =>
    ipcRenderer.invoke(IPC.writeCanvas, file, baseline),
  // Step 9, the two doors out and the one back in. Each answers null when the
  // dialog was closed without a choice, which is not a failure and must not be
  // reported as one - the person changed their mind.
  exportCanvas: (
    workspacePath: string,
    suggested: string,
    objects: CanvasObject[],
    extra: Record<string, unknown>
  ): Promise<ExportResult | null> =>
    ipcRenderer.invoke(IPC.exportCanvas, workspacePath, suggested, objects, extra),
  embedFiles: (workspacePath: string, names: string[]): Promise<Record<string, string>> =>
    ipcRenderer.invoke(IPC.embedFiles, workspacePath, names),
  importCanvas: (workspacePath: string): Promise<ImportResult | null> =>
    ipcRenderer.invoke(IPC.importCanvas, workspacePath),
  saveExport: (
    suggested: string,
    extension: string,
    bytes: Uint8Array
  ): Promise<ExportResult | null> =>
    ipcRenderer.invoke(IPC.saveExport, suggested, extension, bytes),
  // Null when this workspace has never been looked at, or when what was saved
  // is not three finite numbers any more.
  readViewport: (workspacePath: string): Promise<Viewport | null> =>
    ipcRenderer.invoke(IPC.readViewport, workspacePath),
  setViewport: (workspacePath: string, viewport: Viewport): Promise<void> =>
    ipcRenderer.invoke(IPC.setViewport, workspacePath, viewport),
  createWorkspace: (vaultPath: string, name: string): Promise<string> =>
    ipcRenderer.invoke(IPC.createWorkspace, vaultPath, name),
  renameWorkspace: (workspacePath: string, name: string): Promise<void> =>
    ipcRenderer.invoke(IPC.renameWorkspace, workspacePath, name),
  setWorkspaceTab: (workspacePath: string, tab: Tab): Promise<void> =>
    ipcRenderer.invoke(IPC.setWorkspaceTab, workspacePath, tab),
  // Null takes the background away.
  setWorkspaceBackground: (workspacePath: string, background: Background | null): Promise<void> =>
    ipcRenderer.invoke(IPC.setWorkspaceBackground, workspacePath, background),
  setWorkspaceBookmark: (workspacePath: string, on: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC.setWorkspaceBookmark, workspacePath, on),
  // An empty name takes the note off the colour again.
  setWorkspaceLabel: (workspacePath: string, key: string, name: string): Promise<void> =>
    ipcRenderer.invoke(IPC.setWorkspaceLabel, workspacePath, key, name),
  // Themes. The stylesheet is not told anything about the base, because
  // nativeTheme moves prefers-color-scheme underneath it; the colours arrive
  // on onColors like any others.
  setTheme: (theme: ThemeChoice): Promise<Themes> => ipcRenderer.invoke(IPC.setTheme, theme),
  setCustomBase: (base: Base): Promise<Themes> => ipcRenderer.invoke(IPC.setCustomBase, base),
  saveTheme: (name: string, colors: Colors): Promise<SaveThemeResult> =>
    ipcRenderer.invoke(IPC.saveTheme, name, colors),
  // False when the desktop would not open it.
  openThemesFolder: (): Promise<boolean> => ipcRenderer.invoke(IPC.openThemesFolder),
  onThemes: (listener: (themes: Themes) => void): (() => void) => {
    const wrapped = (_event: unknown, themes: Themes): void => listener(themes)
    ipcRenderer.on(IPC.themesChanged, wrapped)
    return () => ipcRenderer.off(IPC.themesChanged, wrapped)
  },
  // Colours, step 9 of v0.2. Read from the arguments main built this window
  // with rather than asked for over ipc: this value is already here when the
  // preload runs, which is before any page script and before the first frame,
  // so the window never paints a colour the user replaced. The write goes the
  // usual way, because state.json is main's to touch.
  initialColors: colorsFromArguments(process.argv),
  // Answers with the set that was actually stored, so a value the guard
  // refused can be seen rather than assumed.
  setColors: (colors: Colors): Promise<Colors> => ipcRenderer.invoke(IPC.setColors, colors),
  // D3. The colours are chosen in one window and worn by both, so main sends
  // the stored set back to every window and each one paints itself. The window
  // that sent it hears this too, which is deliberate: it repaints with what was
  // kept rather than with what it asked for.
  onColors: (listener: (colors: Colors) => void): (() => void) => {
    const wrapped = (_event: unknown, colors: Colors): void => listener(colors)
    ipcRenderer.on(IPC.colorsChanged, wrapped)
    return () => ipcRenderer.off(IPC.colorsChanged, wrapped)
  },
  // Where a card opens. Asked for once as the window mounts, then followed.
  cardViewNow: (): Promise<CardView> => ipcRenderer.invoke(IPC.cardViewNow),
  // Answers with what was stored, not with what was asked for.
  setCardView: (view: CardView): Promise<CardView> => ipcRenderer.invoke(IPC.setCardView, view),
  onCardView: (listener: (view: CardView) => void): (() => void) => {
    const wrapped = (_event: unknown, view: CardView): void => listener(view)
    ipcRenderer.on(IPC.cardViewChanged, wrapped)
    return () => ipcRenderer.off(IPC.cardViewChanged, wrapped)
  },
  // What a workspace opens on. Asked for as the vault loads, then followed.
  workspaceOpensNow: (): Promise<WorkspaceOpens> => ipcRenderer.invoke(IPC.workspaceOpensNow),
  setWorkspaceOpens: (value: WorkspaceOpens): Promise<WorkspaceOpens> =>
    ipcRenderer.invoke(IPC.setWorkspaceOpens, value),
  onWorkspaceOpens: (listener: (value: WorkspaceOpens) => void): (() => void) => {
    const wrapped = (_event: unknown, value: WorkspaceOpens): void => listener(value)
    ipcRenderer.on(IPC.workspaceOpensChanged, wrapped)
    return () => ipcRenderer.off(IPC.workspaceOpensChanged, wrapped)
  },
  /* --- Settings, under AI, v0.4 step 9 ------------------------------------- */
  // Each change answers with the whole page again, as main read it back.
  aiSettingsNow: (): Promise<AiSettings> => ipcRenderer.invoke(IPC.aiSettingsNow),
  setAiOn: (on: boolean): Promise<AiSettings> => ipcRenderer.invoke(IPC.setAiOn, on),
  // The workspace by its folder, since one with no id yet has nothing else.
  setAiWorkspace: (vault: string, folder: string, chosen: boolean): Promise<AiSettings> =>
    ipcRenderer.invoke(IPC.setAiWorkspace, vault, folder, chosen),
  copyText: (text: string): Promise<void> => ipcRenderer.invoke(IPC.copyText, text),
  changeNoticesNow: (): Promise<ChangeNotices> => ipcRenderer.invoke(IPC.changeNoticesNow),
  setChangeNotices: (value: ChangeNotices): Promise<ChangeNotices> =>
    ipcRenderer.invoke(IPC.setChangeNotices, value),
  onChangeNotices: (listener: (value: ChangeNotices) => void): (() => void) => {
    const wrapped = (_event: unknown, value: ChangeNotices): void => listener(value)
    ipcRenderer.on(IPC.changeNoticesChanged, wrapped)
    return () => ipcRenderer.off(IPC.changeNoticesChanged, wrapped)
  },
  /* --- the settings window, D3 -------------------------------------------- */
  showSettings: (): Promise<void> => ipcRenderer.invoke(IPC.settingsShow),
  // Everything that page opens knowing, in one answer, asked for as it mounts.
  settingsNow: (): Promise<SettingsNow> => ipcRenderer.invoke(IPC.settingsNow),
  // Answers with what is HELD, which is not always what was asked for: another
  // program may own the new keys, and then the old ones are put back.
  setCaptureKey: (accelerator: string): Promise<{ accelerator: string; ok: boolean }> =>
    ipcRenderer.invoke(IPC.setCaptureKey, accelerator),
  // Asks the window that owns the vault to switch, rather than switching one
  // here. Null means "let me pick one". False comes back when the folder is not
  // one this app knows, which is the guard rather than a failure to report.
  askVault: (path: string | null): Promise<boolean> => ipcRenderer.invoke(IPC.askVault, path),
  // In the window that owns the vault: something else asked for this folder.
  onVaultAsked: (listener: (path: string | null) => void): (() => void) => {
    const wrapped = (_event: unknown, path: string | null): void => listener(path)
    ipcRenderer.on(IPC.askVault, wrapped)
    return () => ipcRenderer.off(IPC.askVault, wrapped)
  },
  // Which vault is open now, and the folders this app knows. Pushed to every
  // window from the one place a vault becomes the current one.
  onVault: (listener: (now: { path: string | null; vaults: string[] }) => void): (() => void) => {
    const wrapped = (_event: unknown, now: { path: string | null; vaults: string[] }): void =>
      listener(now)
    ipcRenderer.on(IPC.vaultChanged, wrapped)
    return () => ipcRenderer.off(IPC.vaultChanged, wrapped)
  },
  // The left panel, D1. Read off the launch arguments for the reason the
  // colours are - it is here before the first frame - and written back when the
  // handle is let go or the button is pressed.
  initialSidebar: sidebarFromArguments(process.argv),
  setSidebar: (sidebar: SidebarState): Promise<SidebarState> =>
    ipcRenderer.invoke(IPC.setSidebar, sidebar),
  trashWorkspace: (workspacePath: string): Promise<void> =>
    ipcRenderer.invoke(IPC.trashWorkspace, workspacePath),
  // Quick capture. The window publishes where a card would land; the little box
  // listens for it, sends a title back, and the window makes the card - so no
  // second road to disk exists to disagree with the first.
  setCaptureTarget: (target: CaptureTarget): Promise<void> =>
    ipcRenderer.invoke(IPC.captureTarget, target),
  // What the box asks for itself as it mounts. The push below is for what
  // changes afterwards; this is the only thing the first box of a run hears.
  captureTarget: (): Promise<CaptureTarget> => ipcRenderer.invoke(IPC.captureTargetNow),
  captureStatus: (): Promise<{ accelerator: string; ok: boolean }> =>
    ipcRenderer.invoke(IPC.captureStatus),
  showCapture: (): Promise<void> => ipcRenderer.invoke(IPC.captureShow),
  submitCapture: (title: string, where: CaptureWhere | null = null): Promise<void> =>
    ipcRenderer.invoke(IPC.captureSubmit, title, where),
  closeCapture: (): Promise<void> => ipcRenderer.invoke(IPC.captureClose),
  // The box's own height, measured by the box. See fitCapture in main.
  fitCapture: (height: number): Promise<void> => ipcRenderer.invoke(IPC.captureFit, height),
  onCaptureTarget: (listener: (target: CaptureTarget) => void): (() => void) => {
    const wrapped = (_event: unknown, target: CaptureTarget): void => listener(target)
    ipcRenderer.on(IPC.captureTarget, wrapped)
    return () => ipcRenderer.off(IPC.captureTarget, wrapped)
  },
  onCaptured: (listener: (title: string, where: CaptureWhere | null) => void): (() => void) => {
    const wrapped = (_event: unknown, title: string, where: CaptureWhere | null): void =>
      listener(title, where)
    ipcRenderer.on(IPC.captureCard, wrapped)
    return () => ipcRenderer.off(IPC.captureCard, wrapped)
  },
  readTrash: (): Promise<TrashEntry[]> => ipcRenderer.invoke(IPC.readTrash),
  // The path is where the item sits in .trash. Main works the rest out from it
  // and refuses anything that is not in the open vault's own trash.
  restoreTrash: (path: string): Promise<RestoreResult> =>
    ipcRenderer.invoke(IPC.restoreTrash, path),
  deleteTrash: (path: string): Promise<RestoreResult> =>
    ipcRenderer.invoke(IPC.deleteTrash, path),
  onChange: (listener: (change: VaultChange) => void): (() => void) => {
    const wrapped = (_event: unknown, change: VaultChange): void => listener(change)
    ipcRenderer.on(IPC.changed, wrapped)
    return () => ipcRenderer.off(IPC.changed, wrapped)
  },
  // What an agent just did, v0.4 step 4. The files themselves arrive on the
  // road above like any other change; this is only who made them.
  onAiChange: (listener: (changes: AiChange[]) => void): (() => void) => {
    const wrapped = (_event: unknown, changes: AiChange[]): void => listener(changes)
    ipcRenderer.on(IPC.aiChanged, wrapped)
    return () => ipcRenderer.off(IPC.aiChanged, wrapped)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
