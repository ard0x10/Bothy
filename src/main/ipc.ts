import { BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { aiSettingsNow, changeNoticesNow, setAiOn, setAiWorkspace, setChangeNotices } from './ai'
import type { AiSettings, ChangeNotices } from '../shared/ai'
import { cleanColors, type Colors } from '../shared/colors'
import type { SidebarState } from '../shared/sidebar'
import { IPC } from '../shared/ipc'
import type {
  CaptureTarget,
  CaptureWhere,
  Card,
  ColumnsSeen,
  OpenResult,
  RestoreResult,
  SaveResult,
  Tab,
  Theme,
  TrashEntry,
  Vault
} from '../shared/types'
import type { CanvasFile, CanvasObject, CanvasWrite } from '../shared/canvas'
import { attachBytes, attachFile, attachImage, resolveAttachment } from './vault/attach'
import { readCanvas, writeCanvasOver } from './vault/canvas'
import { writeHands } from './editing'
import { coverColor } from './cover'
import { embedFiles, exportCanvas, importCanvas, saveBytes } from './transfer'
import { writeColumnsOver, type ColumnsFile } from './vault/columns'
import { createCard } from './vault/create'
import { serializeCard } from './vault/format'
import { readVault } from './vault/store'
import { cardSeed, readTemplate, saveTemplate } from './vault/template'
import {
  captureStatus,
  captureTargetNow,
  fitCapture,
  hideCapture,
  passToWindow,
  setCaptureKey,
  setCaptureTarget,
  showCapture
} from './capture'
import { paintEveryWindow, showSettings } from './settings'
import {
  deleteTrash,
  readTrash,
  restoreTrash,
  sweepTrash,
  trashCard,
  trashWorkspace
} from './vault/trash'
import { watchVault, type WatchHandle } from './vault/watcher'
import { writeIfUnchanged } from './vault/writer'
import {
  createWorkspace,
  renameWorkspace,
  setWorkspaceBackground,
  setWorkspaceBookmark,
  setWorkspaceLabel,
  setWorkspaceTab
} from './vault/workspace'
import type { Background } from '../shared/background'
import { readCardView, type CardView } from '../shared/cardview'
import {
  knownVaults,
  readState,
  readWorkspaceViewport,
  rememberOpenedVault,
  writeSidebar,
  writeState,
  writeWorkspaceViewport
} from './state'
import { isKnownVault } from '../shared/vaults'
import type { SettingsNow } from '../shared/settings'
import type { Viewport } from '../shared/viewport'
import { IMAGE_EXTENSIONS } from '../shared/image'

let watcher: WatchHandle | null = null
let current: string | null = null

function startWatching(path: string, window: BrowserWindow): void {
  watcher = watchVault(path, (change) => {
    if (!window.isDestroyed()) window.webContents.send(IPC.changed, change)
  })
}

async function open(path: string, window: BrowserWindow): Promise<Vault> {
  // Opening the vault is the one moment the trash is known to be quiet, and it
  // is the only thing that ever deletes anything for good. It runs before the
  // read so what it clears cannot show up as an entry a moment later.
  await sweepTrash(path)
  const vault = await readVault(path)
  await watcher?.close()
  current = path
  startWatching(path, window)
  await writeState({ lastVault: path })
  // After the read, not before it: a folder that could not be read is not one
  // the menu should be offering. See rememberOpenedVault.
  await rememberOpenedVault(path)
  // From the one place a vault becomes the current one, so a second window
  // cannot be looking at the name of a folder this app left. The window that
  // asked already knows - it is holding the vault this returns - but it is not
  // the only window on screen any more.
  await tellVault()
  return vault
}

// Sent to every window rather than to the one that asked, for the reason the
// colours are: which vault is open is one answer for the whole app, and D3 put
// a second window on screen that says it out loud.
async function tellVault(): Promise<void> {
  const now = { path: current, vaults: await knownVaults() }
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC.vaultChanged, now)
  }
}

// Windows keeps a watched directory open, and an open directory cannot be
// renamed. Measured: with the watcher running, moving a workspace folder fails
// with EPERM every time, and telling the watcher to drop that subtree does not
// release the handle either. Closing it and starting a new one does.
//
// It only bites the folder itself, which is why trashing a card, a file inside
// a watched folder, has always worked. The gap this opens is one rename long,
// and the alternative is a button that cannot work at all on this platform.
async function withoutWatcher<T>(window: BrowserWindow, work: () => Promise<T>): Promise<T> {
  const path = current
  await watcher?.close()
  watcher = null
  try {
    return await work()
  } finally {
    if (path) startWatching(path, window)
  }
}

export function registerIpc(window: BrowserWindow): void {
  ipcMain.handle(IPC.chooseVault, async () => {
    const picked = await dialog.showOpenDialog(window, {
      title: 'Choose a vault folder',
      properties: ['openDirectory', 'createDirectory']
    })
    if (picked.canceled || !picked.filePaths[0]) return null
    return open(picked.filePaths[0], window)
  })

  // D2. What the foot of the panel lists.
  ipcMain.handle(IPC.knownVaults, async (): Promise<string[]> => knownVaults())

  // Switching to one of them without a file dialog. The path is checked against
  // the list rather than trusted: the menu can only offer what is on it, but the
  // menu is not the only thing that can send this message, and a channel that
  // opens any folder a renderer names is a channel that opens any folder at all.
  //
  // Null for a folder that is no longer there, which is the ordinary case - a
  // drive that is not plugged in, a folder that was moved. The row stays on the
  // list, because a vault on a disk you have not attached is not a vault you
  // have finished with.
  ipcMain.handle(IPC.openVault, async (_event, path: unknown): Promise<Vault | null> => {
    if (typeof path !== 'string') return null
    if (!isKnownVault(await knownVaults(), path)) return null
    try {
      return await open(path, window)
    } catch {
      return null
    }
  })

  ipcMain.handle(IPC.loadVault, async () => {
    const { lastVault } = await readState()
    if (!lastVault) return null
    try {
      return await open(lastVault, window)
    } catch {
      return null
    }
  })

  // Re-read after an outside edit. Deliberately leaves the watcher alone:
  // tearing it down and starting a new one on every change would open a gap
  // where edits go unseen.
  ipcMain.handle(IPC.reloadVault, async () => (current ? readVault(current) : null))

  ipcMain.handle(
    IPC.saveCard,
    async (_event, card: Card, baseline: string | null): Promise<SaveResult> =>
      writeIfUnchanged(card.file, serializeCard(card), baseline)
  )

  // A card whose frontmatter did not parse is edited as the plain text it is.
  // Rebuilding it through serializeCard would throw away whatever the user was
  // in the middle of writing.
  ipcMain.handle(
    IPC.saveCardText,
    async (_event, file: string, text: string, baseline: string | null): Promise<SaveResult> =>
      writeIfUnchanged(file, text, baseline)
  )

  // With no template named this is exactly what it always was. With one, the
  // template is read HERE rather than taken from the renderer: the copy the
  // window is holding was read when the vault was, and a template edited in the
  // folder since then would make a card from a file that no longer says that.
  // The name goes through the templates/ rule on the way, so it can only ever
  // name something in that folder.
  //
  // Null when the name was refused or the file is gone, which is a different
  // answer from an empty card: the title the user typed is not spent on a card
  // that is not the one they asked for.
  ipcMain.handle(
    IPC.createCard,
    async (
      _event,
      workspacePath: string,
      title: string,
      template: string | null = null
    ): Promise<Card | null> => {
      if (!template) return createCard(workspacePath, title)
      const found = await readTemplate(workspacePath, template)
      if (!found) return null
      // An unnamed card born from a template is called after the template. The
      // file name comes from the title and is chosen once, so there has to be
      // one, and this is the only name in the room.
      return createCard(workspacePath, title.trim() || found.name, cardSeed(found))
    }
  )

  // Writes a template from the card that is open, as it stands on screen. The
  // card itself is not touched: making a template out of it is not an edit to
  // it, and the answer is the file name so the window can say what it made.
  ipcMain.handle(
    IPC.saveTemplate,
    async (_event, workspacePath: string, card: Card): Promise<string> =>
      saveTemplate(workspacePath, card)
  )

  // Answers with the names the card should carry. One source that cannot be
  // read is one attachment missing, not a drop that fails whole, so each is
  // copied on its own and the failures are simply not in the answer.
  ipcMain.handle(IPC.attachFiles, async (_event, workspacePath: string, sources: string[]) => {
    const names: string[] = []
    for (const source of sources) {
      try {
        names.push(await attachFile(workspacePath, source))
      } catch {
        // Nothing to say here that the card not growing a row does not say.
      }
    }
    return names
  })

  // The card's own picker. No filter: what a card keeps is whatever the person
  // wants kept with it.
  ipcMain.handle(IPC.pickFiles, async () => {
    const picked = await dialog.showOpenDialog(window, {
      title: 'Add files to this card',
      properties: ['openFile', 'multiSelections']
    })
    return picked.canceled ? [] : picked.filePaths
  })

  ipcMain.handle(
    IPC.coverColor,
    async (_event, workspacePath: string, name: string): Promise<string | null> => {
      try {
        return coverColor(workspacePath, name)
      } catch {
        return null
      }
    }
  )

  // The file picker for the canvas. The filter is the list of what the window
  // can actually draw rather than a wider one that would let a .psd through to
  // be copied in and then shown as nothing.
  ipcMain.handle(IPC.pickImages, async () => {
    const picked = await dialog.showOpenDialog(window, {
      title: 'Choose an image',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS }]
    })
    return picked.canceled ? [] : picked.filePaths
  })

  // Copied in, or answered with the copy already there holding the same bytes.
  // One at a time and in order, so several files dropped at once land in the
  // order they were dropped rather than in whatever order the disk finished in.
  ipcMain.handle(IPC.attachImages, async (_event, workspacePath: string, sources: string[]) => {
    const names: (string | null)[] = []
    for (const source of sources) {
      try {
        names.push(await attachImage(workspacePath, source))
      } catch {
        // Null rather than a gap in the list. The window put the images down in
        // the order it was handed them, and a list that silently shortens would
        // put the wrong picture where the third one was dropped.
        names.push(null)
      }
    }
    return names
  })

  ipcMain.handle(
    IPC.attachBytes,
    async (_event, workspacePath: string, name: string, bytes: Uint8Array) => {
      try {
        return await attachBytes(workspacePath, name, bytes)
      } catch {
        return null
      }
    }
  )

  // The only way a path reaches the shell. It says WHICH of the two nos it is
  // giving, because "nothing opened" is also true of a name that was allowed
  // through and simply had no file behind it - and a check that cannot tell
  // those apart stays green while the refusal is gone.
  ipcMain.handle(
    IPC.openFile,
    async (_event, workspacePath: string, name: string): Promise<OpenResult> => {
      const path = resolveAttachment(workspacePath, name)
      if (!path) return 'refused'
      return (await shell.openPath(path)) === '' ? 'opened' : 'failed'
    }
  )

  // Published by the window whenever where a card would land changes. Kept in
  // main because the little box has no vault of its own to ask.
  ipcMain.handle(IPC.captureTarget, async (_event, next: CaptureTarget) => {
    setCaptureTarget(next)
  })

  // The box, on the way up. Pull rather than push, because the push that used
  // to be the box's only source arrives before it can hear anything.
  ipcMain.handle(IPC.captureTargetNow, async () => captureTargetNow())

  // The same door the shortcut opens, without the keyboard. It exists so the
  // run can open the box: everything about it was hand-only before, and a
  // real defect lived in it for two versions precisely because nothing could
  // reach it. Called by the window that owns the vault, which is the one thing
  // that could already open it anyway.
  ipcMain.handle(IPC.captureShow, async () => {
    showCapture(window)
  })

  // What the window asks on the way up, so a shortcut another program already
  // owns is said out loud rather than being a key that does nothing.
  ipcMain.handle(IPC.captureStatus, async () => captureStatus())

  // D3, and the answer is what is HELD rather than what was asked for. See
  // setCaptureKey: the desktop can refuse these keys, and a refusal puts the
  // old ones back rather than leaving quick capture off.
  ipcMain.handle(IPC.setCaptureKey, async (_event, accelerator: unknown) =>
    setCaptureKey(window, accelerator)
  )

  /* --- the settings window, D3 --------------------------------------------- */
  ipcMain.handle(IPC.settingsShow, async () => {
    showSettings(window)
  })

  // Everything that page opens knowing, in one answer. Pulled as it mounts
  // rather than pushed at it when it is built, which is a measured finding rather
  // than a preference: a push sent the moment a window object exists reaches a
  // renderer that has not subscribed yet, and the first window of a run hears
  // nothing at all.
  ipcMain.handle(IPC.settingsNow, async (): Promise<SettingsNow> => {
    const { theme, colors, cardView } = await readState()
    return {
      theme: theme ?? 'system',
      colors: cleanColors(colors),
      cardView: readCardView(cardView),
      capture: captureStatus(),
      vault: current,
      vaults: await knownVaults()
    }
  })

  // The settings window does not open a vault. It asks, and the window that
  // owns the vault does it - which is the capture box's argument about cards,
  // about folders: openVault hands the loaded vault back to whoever called it,
  // so a settings window that called it would leave the main window showing a
  // folder main had already stopped watching.
  //
  // Guarded here as well as there, and null is the one path that skips the
  // guard because it is not a path: it means "let me pick one", and picking is
  // a dialog rather than a folder a renderer named.
  ipcMain.handle(IPC.askVault, async (_event, path: unknown): Promise<boolean> => {
    if (path !== null && typeof path !== 'string') return false
    if (typeof path === 'string' && !isKnownVault(await knownVaults(), path)) return false
    if (window.isDestroyed()) return false
    window.webContents.send(IPC.askVault, path)
    window.focus()
    return true
  })

  // From the box. The card is made in the window, down the one road every card
  // goes down; this only carries the title across.
  ipcMain.handle(IPC.captureSubmit, async (_event, title: string, where: CaptureWhere | null) => {
    passToWindow(window, title, where)
  })

  ipcMain.handle(IPC.captureClose, async () => {
    hideCapture()
  })

  ipcMain.handle(IPC.captureFit, async (_event, height: unknown) => {
    fitCapture(height)
  })

  ipcMain.handle(IPC.trashCard, async (_event, card: Card, workspacePath: string) =>
    trashCard(card.file, workspacePath)
  )

  // Held to what the window last read, and merged over what changed since. v0.4
  // step 6: see writeColumnsOver.
  ipcMain.handle(
    IPC.saveColumns,
    async (
      _event,
      file: ColumnsFile,
      seen: ColumnsSeen | null,
      moved: string[] = [],
      heard: string[] = []
    ): Promise<{ merged: boolean; seen: ColumnsSeen; outside: string[] }> => writeColumnsOver(file, seen, moved, heard)
  )

  // What the window's hand is on, for an agent's server. See main/editing.ts.
  ipcMain.handle(IPC.setEditing, async (_event, items: unknown) => {
    await writeHands(items)
  })

  ipcMain.handle(
    IPC.readViewport,
    async (_event, workspacePath: string): Promise<Viewport | null> =>
      readWorkspaceViewport(workspacePath)
  )

  ipcMain.handle(IPC.setViewport, async (_event, workspacePath: string, viewport: Viewport) => {
    await writeWorkspaceViewport(workspacePath, viewport)
  })

  ipcMain.handle(
    IPC.readCanvas,
    async (_event, workspacePath: string): Promise<CanvasFile> => readCanvas(workspacePath)
  )

  // Refuses a canvas that did not parse, and the refusal reaches the window as
  // a rejected call rather than a quiet success on a file nobody wrote. Held to
  // the fingerprint of what the window last read, v0.4 step 6: a file that moved
  // on comes back for the window to merge with.
  ipcMain.handle(
    IPC.writeCanvas,
    async (_event, file: CanvasFile, baseline: string | null): Promise<CanvasWrite> => writeCanvasOver(file, baseline)
  )

  // Step 9. The save dialog is here rather than in the window because it is the
  // window's own dialog - a modal that belongs to a parent cannot be left
  // behind the app, and a picker the user forgot about is a picker they think
  // has hung.
  ipcMain.handle(
    IPC.exportCanvas,
    async (
      _event,
      workspacePath: string,
      suggested: string,
      objects: CanvasObject[],
      extra: Record<string, unknown>
    ) => {
      const picked = await dialog.showSaveDialog(window, {
        title: 'Export canvas',
        defaultPath: suggested,
        filters: [{ name: 'Canvas', extensions: ['json'] }]
      })
      if (picked.canceled || !picked.filePath) return null
      return exportCanvas(workspacePath, picked.filePath, objects, extra)
    }
  )

  ipcMain.handle(
    IPC.embedFiles,
    async (_event, workspacePath: string, names: string[]): Promise<Record<string, string>> =>
      embedFiles(workspacePath, names)
  )

  ipcMain.handle(IPC.importCanvas, async (_event, workspacePath: string) => {
    const picked = await dialog.showOpenDialog(window, {
      title: 'Import canvas',
      properties: ['openFile'],
      filters: [{ name: 'Canvas', extensions: ['json'] }]
    })
    if (picked.canceled || picked.filePaths.length === 0) return null
    return importCanvas(workspacePath, picked.filePaths[0])
  })

  // The PNG and the SVG. Both are made in the window - it is the only place
  // with a font to measure with and a canvas to rasterise on - so main is only
  // asked where to put them.
  ipcMain.handle(
    IPC.saveExport,
    async (_event, suggested: string, extension: string, bytes: Uint8Array) => {
      const picked = await dialog.showSaveDialog(window, {
        title: `Export ${extension.toUpperCase()}`,
        defaultPath: suggested,
        filters: [{ name: extension.toUpperCase(), extensions: [extension] }]
      })
      if (picked.canceled || !picked.filePath) return null
      return saveBytes(picked.filePath, bytes)
    }
  )

  ipcMain.handle(
    IPC.createWorkspace,
    async (_event, vaultPath: string, name: string): Promise<string> =>
      createWorkspace(vaultPath, name)
  )

  ipcMain.handle(IPC.renameWorkspace, async (_event, workspacePath: string, name: string) =>
    renameWorkspace(workspacePath, name)
  )

  ipcMain.handle(IPC.setWorkspaceTab, async (_event, workspacePath: string, tab: Tab) =>
    setWorkspaceTab(workspacePath, tab)
  )

  ipcMain.handle(
    IPC.setWorkspaceBackground,
    async (_event, workspacePath: string, background: Background | null) =>
      setWorkspaceBackground(workspacePath, background)
  )

  ipcMain.handle(IPC.setWorkspaceBookmark, async (_event, workspacePath: string, on: unknown) =>
    setWorkspaceBookmark(workspacePath, on === true)
  )

  ipcMain.handle(
    IPC.setWorkspaceLabel,
    async (_event, workspacePath: string, key: unknown, name: unknown) =>
      setWorkspaceLabel(
        workspacePath,
        typeof key === 'string' ? key : '',
        typeof name === 'string' ? name : ''
      )
  )

  ipcMain.handle(IPC.trashWorkspace, async (_event, workspacePath: string) =>
    withoutWatcher(window, () => trashWorkspace(workspacePath))
  )

  // Theme. Answered from state.json, applied through nativeTheme, and that one
  // call does all three cases: 'system' hands the question back to the desktop,
  // and either of the other two pins it. The renderer needs no listener of its
  // own, because nativeTheme also decides what prefers-color-scheme reports
  // inside the window - so the stylesheet follows without being told.
  ipcMain.handle(IPC.setTheme, async (_event, theme: Theme): Promise<void> => {
    // Anything else is refused rather than stored: this value is read back on
    // the next launch and handed to Electron, and a bad one would be a window
    // that opens wrong with nothing on screen to say why.
    if (theme !== 'system' && theme !== 'light' && theme !== 'dark') return
    nativeTheme.themeSource = theme
    await writeState({ theme })
  })

  // Where a card opens. Pulled by the window that owns the vault as it mounts,
  // and pushed to every window whenever it is set.
  ipcMain.handle(IPC.cardViewNow, async (): Promise<CardView> =>
    readCardView((await readState()).cardView)
  )

  ipcMain.handle(IPC.setCardView, async (_event, view: unknown): Promise<CardView> => {
    // Anything else is refused rather than stored, and what goes out is what
    // the file holds afterwards, so a refused value moves nothing anywhere.
    if (view === 'sheet' || view === 'panel') await writeState({ cardView: view })
    const held = readCardView((await readState()).cardView)
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC.cardViewChanged, held)
    }
    return held
  })

  // Settings, under AI, v0.4 step 9. See main/ai.ts.
  ipcMain.handle(IPC.aiSettingsNow, (): Promise<AiSettings> => aiSettingsNow())
  ipcMain.handle(IPC.setAiOn, (_event, on: unknown): Promise<AiSettings> => setAiOn(on === true))
  ipcMain.handle(
    IPC.setAiWorkspace,
    (_event, vault: unknown, folder: unknown, chosen: unknown): Promise<AiSettings> =>
      setAiWorkspace(vault, folder, chosen === true)
  )
  ipcMain.handle(IPC.copyText, async (_event, text: unknown): Promise<void> => {
    if (typeof text === 'string') await clipboard.writeText(text)
  })
  ipcMain.handle(IPC.changeNoticesNow, (): Promise<ChangeNotices> => changeNoticesNow())
  ipcMain.handle(IPC.setChangeNotices, async (_event, value: unknown): Promise<ChangeNotices> => {
    const held = await setChangeNotices(value)
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC.changeNoticesChanged, held)
    }
    return held
  })

  // Colours, step 9. Two rules shape this handler: eleven tokens
  // rather than all seventeen, and one set laid over whichever theme is on
  // rather than a set per theme. Whatever the renderer sends is filtered
  // through the same guard the launch argument goes through, and the filtered
  // set is handed back so a refused value is visible rather than silent.
  //
  // The set replaces rather than merges. The renderer holds the whole thing
  // and sends the whole thing, so a token missing from it is a token the user
  // put back - and resetting everything is this call with an empty object.
  ipcMain.handle(IPC.setColors, async (_event, colors: unknown): Promise<Colors> => {
    const clean = cleanColors(colors)
    await writeState({ colors: clean })
    // D3. Until there was a second window this could be left to the renderer
    // that sent it: it had already painted itself, and there was nobody else to
    // tell. Now the window a colour is CHOSEN in is not the window most of it is
    // on, so the stored set goes back out to every window - including the one
    // that sent it, which repaints with what was actually kept rather than with
    // what it asked for.
    paintEveryWindow(clean)
    return clean
  })

  // The left panel, D1. Sent when the handle is let go rather than while it is
  // moving, which is the viewport's argument in miniature: a disk write behind
  // every mouse move is a disk write behind every mouse move. What comes back
  // is what was stored, so a width the guard clamped is visible rather than
  // assumed.
  ipcMain.handle(IPC.setSidebar, async (_event, sidebar: unknown): Promise<SidebarState> =>
    writeSidebar(sidebar)
  )

  // The vault path is not taken from the renderer. It is whatever is open, so a
  // window cannot be talked into reading or emptying a folder elsewhere.
  ipcMain.handle(IPC.readTrash, async (): Promise<TrashEntry[]> =>
    current ? readTrash(current) : []
  )

  ipcMain.handle(IPC.restoreTrash, async (_event, path: string): Promise<RestoreResult> =>
    current ? restoreTrash(current, path) : { ok: false, why: 'No vault is open.' }
  )

  ipcMain.handle(IPC.deleteTrash, async (_event, path: string): Promise<RestoreResult> =>
    current ? deleteTrash(current, path) : { ok: false, why: 'No vault is open.' }
  )
}

export async function closeVaultWatcher(): Promise<void> {
  await watcher?.close()
  watcher = null
  current = null
}
