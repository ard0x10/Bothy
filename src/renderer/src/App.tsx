import { useEffect, useState } from 'react'
import { setChangeNotices, useVault } from './store'
import { applyColors } from './theme'
import { Sidebar } from './views/Sidebar'
import { Kanban } from './views/Kanban'
import { Canvas } from './views/Canvas'
import { Calendar } from './views/Calendar'
import { TabBar } from './views/TabBar'
import { CardPanel } from './views/CardPanel'
import { Palette } from './views/Palette'
import { Trash } from './views/Trash'
import { Archive } from './views/Archive'
import { Keys } from './views/Keys'
import { Switcher } from './views/Switcher'
import { APP_NAME } from '../../shared/app'
import { matchKey } from '../../shared/viewport'
import { matchAppKey } from '../../shared/keys'
import { isTyping } from './views/Canvas'
import { targetOf } from '../../shared/capture'
import { fileName } from '../../shared/paths'
import type { CaptureTarget } from '../../shared/types'
import { CARD_VIEW_DEFAULT, type CardView } from '../../shared/cardview'

export function App() {
  const vault = useVault((state) => state.vault)
  const workspacePath = useVault((state) => state.workspacePath)
  const tab = useVault((state) => state.tab)
  const loading = useVault((state) => state.loading)
  const load = useVault((state) => state.load)
  const reloadOutside = useVault((state) => state.reloadOutside)
  const choose = useVault((state) => state.choose)

  useEffect(() => {
    void load()
  }, [load])


  useEffect(() => {
    // A change out on disk arrives per file. Editors often touch a file more
    // than once per save, so settle first and read the folder once.
    let timer: ReturnType<typeof setTimeout> | undefined
    // Which files changed while it settled. Every one of them was written by
    // something other than this window - main keeps its own writes out - so
    // what changed in them is said on the line, v0.4 step 7.
    let files: string[] = []
    return window.api.onChange((change) => {
      // The canvas is read on its own, so a write to it does not have to take
      // the whole vault through a reload. This is also the road an agent's edit
      // arrives on in v0.4: the file is the source, and something outside this
      // window writing to it is a change like any other.
      if (/canvas\.json$/i.test(change.file)) {
        void useVault.getState().reloadCanvas()
        return
      }
      files.push(change.file)
      clearTimeout(timer)
      timer = setTimeout(() => {
        const settled = files
        files = []
        void reloadOutside(settled)
      }, 150)
    })
  }, [reloadOutside])

  // Who made a change, when it was an agent, v0.4 step 4. The change itself has
  // already come in above; this only puts a line on screen saying so.
  useEffect(() => window.api.onAiChange((changes) => useVault.getState().aiChanged(changes)), [])

  // Everywhere a captured card could land, told to main whenever it changes.
  // Main cannot work this out: which workspaces exist and which one is selected
  // is this window's own state, and the little capture box has no vault of its
  // own to ask.
  //
  // Compared as text rather than by identity: this is rebuilt on every render
  // and reload, and sending it again on a reload that changed nothing would
  // reach across to the box for no reason.
  const target = JSON.stringify(targetOf(vault, workspacePath))
  useEffect(() => {
    void window.api.setCaptureTarget(JSON.parse(target) as CaptureTarget)
  }, [target])

  // A title caught while the window was somewhere else entirely. The card is
  // made here rather than in main, so there is one place that decides what a
  // new card is.
  useEffect(
    () =>
      window.api.onCaptured(
        (title, where) => void useVault.getState().captureCard(title, where)
      ),
    []
  )

  // The colours are chosen in the settings window now, D3, and worn here. Main
  // sends the stored set to every window from the handler that stores it, so
  // this window repaints while that one is open - which is the whole reason a
  // separate window was allowed to hold a live palette.
  useEffect(() => window.api.onColors((colors) => applyColors(colors)), [])

  // Where a card opens, chosen in the settings window. Listening before asking,
  // so a change made between the two is not lost; until the answer arrives it
  // is the default.
  const [cardView, setCardView] = useState<CardView>(CARD_VIEW_DEFAULT)
  useEffect(() => {
    const stop = window.api.onCardView(setCardView)
    void window.api.cardViewNow().then(setCardView)
    return stop
  }, [])

  // What a workspace opens on, chosen in the settings window. The store asks for
  // it as the vault loads; a change arrives here.
  useEffect(
    () => window.api.onWorkspaceOpens((value) => useVault.getState().setWorkspaceOpens(value)),
    []
  )

  // Whether the line says what an agent or something outside Bothy changed,
  // chosen in Settings under AI. Listening before asking, for the same
  // reason as the card view.
  useEffect(() => {
    const stop = window.api.onChangeNotices(setChangeNotices)
    void window.api.changeNoticesNow().then(setChangeNotices)
    return stop
  }, [])

  // Something else asked for a folder - the settings window, today. It is done
  // HERE rather than there for the reason a captured card is made here: the
  // vault this window is showing and the vault main is watching have to be the
  // same one, and two roads to opening a folder is two answers to which one
  // that is.
  useEffect(
    () =>
      window.api.onVaultAsked((path) => {
        const state = useVault.getState()
        if (path === null) {
          void state.choose()
          return
        }
        // A folder on the list that will not open is the ordinary case, not a
        // failure to hide: a drive that is not plugged in, a folder that was
        // moved. Said out loud here, because the window that asked has no
        // vault of its own to say it about.
        void state.switchVault(path).then((ok) => {
          if (!ok) state.setNotice(fileName(path) + ' is not where it was. Nothing was changed.')
        })
      }),
    []
  )

  // The shortcut is registered with the system and another program may already
  // own it. Asked once on the way up, because a key that quietly does nothing
  // is indistinguishable from a feature that was never built.
  useEffect(() => {
    void window.api.captureStatus().then((status) => {
      if (status.ok) return
      useVault
        .getState()
        .setNotice(`${status.accelerator} is taken by something else, so quick capture is off.`)
    })
  }, [])

  // Every shortcut is bound here rather than inside the view it acts on. Escape
  // is the reason: with the palette over an open card, two components each
  // holding their own listener would both answer it and the order between them
  // would be whichever mounted first.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const state = useVault.getState()

      // Matched through the table the `?` sheet renders, D2, for the reason
      // the canvas keys already were: a sheet typed out beside the handler says
      // what somebody believed the keys were, and it goes stale in silence.
      const bound = matchAppKey(event)
      if (bound === 'palette') {
        event.preventDefault()
        if (state.paletteOpen) state.closePalette()
        else state.openPalette('')
        return
      }
      // A bare "new card" would have to guess which column it lands in, so it
      // opens the palette on the commands that name one.
      if (bound === 'new-card') {
        event.preventDefault()
        state.openPalette('>New card')
        return
      }
      // A key each rather than a cycle. The third view arrived in step 7 and
      // this is why it cost nothing: Ctrl+Tab would have had to decide whether
      // the calendar sits between the other two or after them.
      if (bound === 'kanban' || bound === 'canvas' || bound === 'calendar') {
        event.preventDefault()
        void state.setTab(bound)
        return
      }
      // Not a view, so not setTab: the fourth button on the bar opens a sheet
      // over whichever view is on screen, and the key does what it does.
      if (bound === 'workspaces') {
        event.preventDefault()
        state.openSwitcher(!state.switcherOpen)
        return
      }
      // The canvas keys, and only while the canvas is what is on screen: they
      // are Ctrl and a digit, which means something else everywhere the canvas
      // is not. Matched through the same table the help sheet renders, so the
      // sheet cannot list a key nothing is listening for.
      // Not while something is being typed into: Delete is bound here without
      // a modifier, and a box being edited would lose itself to its own
      // backspace.
      if (state.tab === 'canvas' && !state.paletteOpen && !isTyping(event.target)) {
        const action = matchKey(event)
        if (action) {
          event.preventDefault()
          state.canvasAction(action)
          return
        }
      }
      if (bound === 'save') {
        event.preventDefault()
        if (state.dirty) void state.saveDraft()
        return
      }
      // Top down, one owner. The palette sits over the two sheets, which sit
      // over the card panel.
      if (bound === 'close') {
        if (state.paletteOpen) state.closePalette()
        else if (state.keysOpen) state.setKeys(false)
        else if (state.switcherOpen) state.openSwitcher(false)
        else if (state.vaultMenuOpen) state.openVaultMenu(false)
        else if (state.archiveOpen) state.closeArchive()
        else if (state.trashOpen) state.closeTrash()
        else if (state.canvasKeysOpen) state.setCanvasKeys(false)
        else if (state.editingId) state.editObject(null)
        else if (state.selectedIds.length > 0) state.selectObjects([])
        else if (state.openId) void state.closeCard()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (loading) return <div className="boot" />

  if (!vault) {
    return (
      <div className="welcome">
        <p className="welcome-mark">{APP_NAME}</p>
        <p className="welcome-line">Pick a folder to keep your work in. Nothing leaves it.</p>
        <button className="welcome-button" onClick={choose}>
          Choose vault
        </button>
      </div>
    )
  }

  return (
    <div className="layout">
      <Sidebar />
      <main className="content">
        {tab === 'kanban' ? <Kanban /> : tab === 'calendar' ? <Calendar /> : <Canvas />}
        {/* The panel opens over the calendar too. A card reached from there is
            in whichever workspace owns it - openCardAt selects that folder
            first - so what the panel shows is always the card's own labels and
            columns, never the ones that happened to be on screen. */}
        {tab !== 'canvas' && <CardPanel as={cardView} />}
        <TabBar />
      </main>
      <Trash />
      <Archive />
      <Keys />
      <Switcher />
      <Palette />
    </div>
  )
}
