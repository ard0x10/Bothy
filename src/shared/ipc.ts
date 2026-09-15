export const IPC = {
  chooseVault: 'vault:choose',
  loadVault: 'vault:load',
  reloadVault: 'vault:reload',
  // D2, the foot of the panel: which folders this app knows, and switching to
  // one of them without going through a dialog to find something it already
  // knew. The write side is not here - a vault is remembered by whatever opened
  // it, so there is one road onto the list.
  knownVaults: 'vault:known',
  openVault: 'vault:open',
  // D3, and it is the capture box's argument about cards, about vaults. The
  // settings window must not open one itself: `openVault` hands the loaded
  // vault back to WHOEVER CALLED IT, and the window that owns the vault would
  // go on showing the folder it had while main watched a different one. So the
  // settings window asks, main forwards it to the window that owns the vault,
  // and that window switches down the one road it already had. Null means "let
  // me pick one", which is the same road again.
  askVault: 'vault:ask',
  // Which vault is open and which ones are known, pushed to every window after
  // it changes. The pair to settingsNow, exactly as capture:target is the pair
  // to capture:target-now: pull what you need to open with, listen for what
  // happens next.
  vaultChanged: 'vault:now',
  saveCard: 'card:save',
  saveCardText: 'card:saveText',
  createCard: 'card:create',
  saveTemplate: 'template:save',
  trashCard: 'card:trash',
  attachFiles: 'files:attach',
  openFile: 'files:open',
  // The Add button on a card's Files, the other door beside a drop. Any file at
  // all, unlike the canvas's picker: a card keeps receipts and PDFs as well.
  pickFiles: 'files:pick',
  // The colour a card's picture band is filled with. Main's, because only main
  // can read the picture's pixels - see main/cover.ts.
  coverColor: 'files:coverColor',
  // Images on the canvas, step 8 of v0.3. Apart from files:attach because the
  // canvas answers a different question about a second copy of the same
  // picture: a card gets its own, a canvas shares one. We settled it.
  pickImages: 'files:pickImages',
  attachImages: 'files:attachImages',
  // What the clipboard hands over: bytes and a type, and no file behind them.
  attachBytes: 'files:attachBytes',
  // A card made from a pasted picture, with the picture on it. See main/ipc.ts.
  createImageCard: 'card:create-from-image',
  saveColumns: 'columns:save',
  createWorkspace: 'workspace:create',
  renameWorkspace: 'workspace:rename',
  setWorkspaceTab: 'workspace:tab',
  // The board's ground, step 5 of the kanban's look. One key in workspace.json.
  setWorkspaceBackground: 'workspace:background',
  // A workspace in the Bookmarks section. One key in workspace.json, so
  // the mark goes wherever the folder goes and survives a rename.
  setWorkspaceBookmark: 'workspace:bookmark',
  // The note hung on one of the six label colours. One key in
  // workspace.json, so the name goes wherever the folder goes.
  setWorkspaceLabel: 'workspace:label',
  trashWorkspace: 'workspace:trash',
  // Quick capture, step 6 of v0.2. The window publishes where a captured card
  // would land whenever that changes, main hands it to the little box, and the
  // title comes back the same way - so the card is still made by the one road
  // every other card goes down, in the window that owns the vault.
  captureTarget: 'capture:target',
  // What the box asks on the way up, because a push cannot reach a renderer
  // that has not subscribed yet. See captureTargetNow in main/capture.ts.
  captureTargetNow: 'capture:target-now',
  captureStatus: 'capture:status',
  captureSubmit: 'capture:submit',
  captureClose: 'capture:close',
  captureShow: 'capture:show',
  captureCard: 'capture:card',
  // The box asking to be as tall as what is in it. Only the page knows how
  // tall its rows came out and whether a list is open under them.
  captureFit: 'capture:fit',
  // Themes. Every write answers with the whole picker as main read it back, and
  // themes:changed carries the same thing to every window, whichever one did
  // the changing or whether a file in the folder moved.
  setTheme: 'theme:set',
  setCustomBase: 'theme:set-base',
  saveTheme: 'theme:save',
  openThemesFolder: 'theme:open-folder',
  themesChanged: 'themes:changed',
  // Colours, step 9 of v0.2. The write, and since D3 a push back the other way.
  // Until D3 there was only a write and the comment here said why: the window
  // is told its colours as a launch argument, before it paints, so nothing had
  // to read them back. A second window that can CHANGE them ends that - the
  // settings window is not the window most of the colours are on, and a palette
  // that only repaints the window it was chosen in is a palette nobody can see
  // themselves choosing.
  setColors: 'colors:set',
  // Main to every window, whichever one did the changing. Sent by the handler
  // that stores them, so what is broadcast is what was stored rather than what
  // was asked for - a value the guard refused must not repaint anything.
  colorsChanged: 'colors:changed',
  // Where a card opens: a sheet in the middle or the panel down the right. One
  // answer for the whole app, kept in state.json beside the theme. The window
  // that owns the vault asks for it as it mounts, for the same reason, and then
  // listens; the settings window is handed it inside settings:now.
  cardViewNow: 'cardview:now',
  setCardView: 'cardview:set',
  // Main to every window, sent by the handler that stores it, so what arrives
  // is what was kept.
  cardViewChanged: 'cardview:changed',
  // What a workspace opens on, the kanban or the tab it was left on. Asked
  // for as the vault loads, and pushed to every window when it is set.
  workspaceOpensNow: 'workspace-opens:now',
  setWorkspaceOpens: 'workspace-opens:set',
  workspaceOpensChanged: 'workspace-opens:changed',
  // Settings, under AI, v0.4 step 9. The page asks for what it shows as it
  // opens, and every change answers with the page again, read back from
  // state.json and the folders rather than patched from what was asked.
  aiSettingsNow: 'ai:settings-now',
  setAiOn: 'ai:on',
  setAiWorkspace: 'ai:workspace',
  // Copy on the page goes through main: the settings window is often not the
  // focused one, and the page's own clipboard refuses a document without focus.
  copyText: 'clipboard:copy',
  // Whether the line says what changed. The window that owns the vault asks as
  // it mounts and then listens, the card view's road.
  changeNoticesNow: 'notices:now',
  setChangeNotices: 'notices:set',
  changeNoticesChanged: 'notices:changed',
  // The settings window, D3. A window rather than a sheet, and these
  // three channels are the whole of what it costs.
  settingsShow: 'settings:show',
  // What it asks for as it mounts, rather than what main pushes at it when it
  // is built. The reason: a push sent the moment a window object exists reaches
  // a renderer that has not subscribed yet, and the first one of a run hears
  // nothing at all. See settingsNow in main/ipc.ts.
  settingsNow: 'settings:now',
  // The one binding a person can change, D3. It goes through main because it is
  // registered with the operating system - and it answers with what is actually
  // held now, which is not always what was asked for: another program may own
  // the new keys, and then the old ones are put back rather than left off.
  setCaptureKey: 'capture:key',
  // The canvas file, step 2 of v0.3. Read and write, nothing else: the file is
  // the whole of it, and the window holds what it read until it writes it back.
  readCanvas: 'canvas:read',
  writeCanvas: 'canvas:write',
  // v0.4 step 6: what the window's hand is on, for editing.json.
  setEditing: 'editing:set',
  // Taking a canvas out and bringing one back, step 9. Three channels rather
  // than one because they are three different questions to the disk: a canvas
  // is JSON we assemble with its pictures inside it, an import is a file we
  // read and unpack into files/, and a PNG or an SVG is bytes the window made
  // that main only has to put somewhere.
  exportCanvas: 'canvas:export',
  // The bytes of the pictures a drawing points at. Its own channel because the
  // PNG and the SVG are built in the window and it cannot read them itself -
  // see images.ts for why a fetch of the scheme does not work.
  embedFiles: 'canvas:embedFiles',
  importCanvas: 'canvas:import',
  saveExport: 'canvas:saveExport',
  // The left panel, D1. Only a write, for the reason colours only have a
  // write: the window is handed its width as a launch argument before it
  // paints, so there is nothing here to read it back with and no second road
  // to disagree with the first.
  setSidebar: 'sidebar:set',
  // Where the canvas is looking, step 3. An app setting rather than part of the
  // drawing, so it goes the same way the theme does.
  readViewport: 'viewport:read',
  setViewport: 'viewport:set',
  readTrash: 'trash:read',
  restoreTrash: 'trash:restore',
  deleteTrash: 'trash:delete',
  changed: 'vault:changed',
  // What an agent just did, v0.4 step 4, pushed from main as the server's
  // trail files arrive. See shared/aitrail.ts.
  aiChanged: 'ai:changed'
} as const
