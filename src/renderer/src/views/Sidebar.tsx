import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useVault } from '../store'
import { APP_NAME } from '../../../shared/app'
import { fileName } from '../../../shared/paths'
import { stillness } from '../motion'
import { NameBox } from './NameBox'
import { SearchPane } from './SearchPane'
import { Icon, type IconName } from './Icon'
import {
  SIDEBAR_BORDER,
  SIDEBAR_RAIL,
  SIDEBAR_SLIDE_MS,
  clampWidth,
  type SidebarSection
} from '../../../shared/sidebar'

// The icon rail, D4. Three sections, the third for the workspaces people
// keep going back to.
//
// Drawn, like every icon in the app. D2 once wrote two marks here as
// backslash-u escapes in JSX text, six characters on screen that no check ever
// read; the run reads what these buttons hold.
type Section = { section: SidebarSection; icon: IconName; label: string }

const SECTIONS: Section[] = [
  { section: 'workspaces', icon: 'folder', label: 'Workspaces' },
  { section: 'search', icon: 'search', label: 'Search' },
  { section: 'bookmarks', icon: 'bookmark', label: 'Bookmarks' }
]

// The same curve all the way through the slide: quick off the mark and easing
// into where it stops, so the hand that pressed sees it answer at once.
const SLIDE_EASING = 'cubic-bezier(0.2, 0, 0, 1)'

// Picking a workspace from the panel is what the panel was opened for, so it
// gets out of the way once it has answered: the board that was chosen is what
// the window is for, not the list it was chosen from.
//
// Only when the pick actually moves. Pressing the row you are already on
// changes nothing, and a panel that shut on that would be answering a question
// nobody asked. Shut after the move rather than with it, because leaving a
// workspace can be refused - the last keystrokes may have hit a clash on disk -
// and a panel that closed on a move that did not happen would be telling the
// user they had gone somewhere they had not.
function useGoTo(): (path: string) => void {
  const current = useVault((state) => state.workspacePath)
  const select = useVault((state) => state.select)
  const closeSidebar = useVault((state) => state.closeSidebar)
  return (path) => {
    if (path === current) return
    void select(path).then(() => {
      if (useVault.getState().workspacePath === path) closeSidebar()
    })
  }
}

export function Sidebar() {
  const vault = useVault((state) => state.vault)
  const current = useVault((state) => state.workspacePath)
  const goTo = useGoTo()
  const openTrash = useVault((state) => state.openTrash)
  const openArchive = useVault((state) => state.openArchive)
  const menuOpen = useVault((state) => state.vaultMenuOpen)
  const openVaultMenu = useVault((state) => state.openVaultMenu)
  const sidebar = useVault((state) => state.sidebar)
  const section = useVault((state) => state.section)
  const setSection = useVault((state) => state.setSection)
  const toggleSidebar = useVault((state) => state.toggleSidebar)
  const dragSidebar = useVault((state) => state.dragSidebar)
  const composing = useVault((state) => state.composingWorkspace)
  const composeWorkspace = useVault((state) => state.composeWorkspace)
  const addWorkspace = useVault((state) => state.addWorkspace)

  // Which row is being renamed, and which one asked to be thrown away. Both are
  // one at a time: two open questions in a list is two ways to answer the wrong
  // one.
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  // Measured from the panel's own left edge rather than from the window's. They
  // are the same number today, and the day they are not - anything to the left
  // of the panel, which is what D4 is - a drag measured from the window would
  // set a width the panel does not have.
  const nav = useRef<HTMLElement>(null)

  // Opening and closing should move rather than jump. What is drawn
  // is therefore not always what the store says. The store changes at once and
  // is written down at once; the drawing follows. Closing, the open panel is
  // still what is on screen, getting narrower, and the strip takes its place
  // only when the slide is over. Opening, the open panel is drawn at once and
  // grows out of the strip's width.
  //
  // The width is what moves, so the content beside the panel is handed its room
  // a frame at a time and nothing jumps at the end. What is inside the panel
  // does not move with it: it keeps the width it has open and is uncovered, or
  // covered, by the panel's edge - a list that re-wrapped every frame would
  // read as the panel coming apart.
  const [drawnClosed, setDrawnClosed] = useState(sidebar.collapsed)
  const [sliding, setSliding] = useState(false)
  const slide = useRef<Animation | null>(null)
  const opening = useRef(false)
  const openWidth = clampWidth(sidebar.width)

  const slideTo = (from: number, to: number, then: () => void): void => {
    const panel = nav.current
    slide.current?.cancel()
    slide.current = null
    if (!panel || Math.abs(from - to) < 0.5 || stillness()) {
      setSliding(false)
      then()
      return
    }
    setSliding(true)
    const run = panel.animate([{ flexBasis: `${from}px` }, { flexBasis: `${to}px` }], {
      duration: SIDEBAR_SLIDE_MS,
      easing: SLIDE_EASING,
      fill: 'forwards'
    })
    slide.current = run
    const done = (): void => {
      if (slide.current !== run) return
      slide.current = null
      // The last frame of the slide is held until the panel's own width has
      // been written; let go first, and for a frame the panel is back at the
      // width it started from.
      flushSync(() => {
        setSliding(false)
        then()
      })
      run.cancel()
    }
    run.onfinish = done
    // And a clock of its own behind it. A window nobody can see draws no
    // frames, and an animation with no frames never says it finished: the
    // panel would stay half closed until the window came back.
    window.setTimeout(done, SIDEBAR_SLIDE_MS + 60)
  }

  const widthNow = (): number => nav.current?.getBoundingClientRect().width ?? openWidth

  useLayoutEffect(() => {
    if (sidebar.collapsed) {
      if (!drawnClosed) slideTo(widthNow(), SIDEBAR_RAIL, () => setDrawnClosed(true))
    } else if (drawnClosed) {
      // The open panel has to be in the document before it can grow, so it is
      // drawn first and the slide starts in the effect below, before a paint.
      opening.current = true
      setDrawnClosed(false)
    } else if (slide.current) {
      // Pressed again halfway through closing: it turns round from where it is.
      slideTo(widthNow(), openWidth, () => {})
    }
  }, [sidebar.collapsed])

  useLayoutEffect(() => {
    if (!opening.current) return
    opening.current = false
    slideTo(SIDEBAR_RAIL, openWidth, () => {})
  }, [drawnClosed])

  useEffect(() => () => slide.current?.cancel(), [])

  // The handle keeps the pointer for the whole drag, so the width goes on
  // following the hand when it leaves the four pixels it started in - and it
  // stops following when the button comes up anywhere at all, including outside
  // the window. Without the capture, a drag that outran the handle would let go
  // silently and leave the panel at whatever width it had got to.
  const grip = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const left = nav.current?.getBoundingClientRect().left ?? 0
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    const move = (moved: PointerEvent): void => dragSidebar(moved.clientX - left, false)
    const up = (ended: PointerEvent): void => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
      dragSidebar(ended.clientX - left, true)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }

  // A menu that only closes by its own button is a menu that gets left open
  // behind whatever the next click was for. Pointerdown rather than click, so
  // it closes on the press that starts the next thing rather than on the
  // release, and mounted only while it is open.
  useEffect(() => {
    if (!menuOpen) return
    const away = (event: PointerEvent): void => {
      const at = event.target as Element | null
      if (at?.closest?.('.sidebar-vault-menu, .sidebar-vault')) return
      openVaultMenu(false)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [menuOpen, openVaultMenu])

  // The open/close button. Closed: in the middle of the strip, and
  // the whole strip opens the panel, not only the button. Open: the
  // same, in the rail under the sections, and everything from their line down
  // closes it. The button keeps its 32 and has no click of its own in either:
  // its press reaches the box around it, which is what opens or closes, so one
  // press cannot do it twice on the way up.
  const button = (
    <button
      className="sidebar-toggle"
      title={sidebar.collapsed ? 'Show the sidebar' : 'Hide the sidebar'}
      aria-expanded={!sidebar.collapsed}
    >
      <Icon name={sidebar.collapsed ? 'expand' : 'collapse'} />
    </button>
  )

  // What is left when it is closed. Deliberately not the whole panel with
  // `display: none` on its contents: a hidden workspace list is still a list
  // the keyboard can walk into, and a Tab that lands on a button nobody can see
  // is worse than one that lands on nothing.
  //
  // The rail goes with it, and that is the choice rather than a shortcut.
  // A rail that stayed would put a second column of icons beside the canvas's
  // own rail - measured at 17 pixels apart with the panel closed - and the fix
  // for that is moving the canvas's tools somewhere they have never been.
  if (drawnClosed) {
    return (
      <nav
        className="sidebar is-collapsed"
        ref={nav}
        style={{ flexBasis: SIDEBAR_RAIL }}
        onClick={toggleSidebar}
      >
        {button}
      </nav>
    )
  }

  // While it slides the list keeps the width it has open. Worked out from the
  // same three numbers the panel's width is, so it cannot disagree with them.
  const held = sliding
    ? { flex: 'none', width: openWidth - SIDEBAR_RAIL - SIDEBAR_BORDER }
    : undefined

  return (
    <nav
      className={sliding ? 'sidebar is-sliding' : 'sidebar'}
      ref={nav}
      style={{ flexBasis: openWidth }}
    >
      <div className="sidebar-rail">
        {/* Divided from the button by a line: one of these changes what the
            panel is showing and the other changes whether there is a panel at
            all, and a column of three identical squares says they are three of
            the same thing. The sections first, so the button they
            are divided from is below them. */}
        <div className="sidebar-rail-sections" role="tablist" aria-label="Panel sections">
          {SECTIONS.map((one) => (
            <button
              key={one.section}
              className={`sidebar-rail-item${section === one.section ? ' is-on' : ''}`}
              role="tab"
              title={one.label}
              aria-label={one.label}
              aria-selected={section === one.section}
              data-section={one.section}
              onClick={() => setSection(one.section)}
            >
              <Icon name={one.icon} />
            </button>
          ))}
        </div>
        <div className="sidebar-rail-hide" onClick={toggleSidebar}>
          {button}
        </div>
      </div>

      <div className="sidebar-body" style={held}>
        {section === 'search' ? (
          <SearchPane />
        ) : section === 'bookmarks' ? (
          <Bookmarks />
        ) : (
          <>
            <ul className="sidebar-list">
              {vault?.workspaces.map((workspace) => (
                <li key={workspace.path} className="sidebar-row">
                  {renaming === workspace.path ? (
                    <NameBox
                      className="sidebar-rename"
                      placeholder="Workspace name"
                      initial={workspace.name}
                      onCommit={(name) =>
                        void useVault.getState().renameWorkspace(workspace.path, name)
                      }
                      onCancel={() => setRenaming(null)}
                    />
                  ) : confirming === workspace.path ? (
                    <span className="sidebar-confirm">
                      <span className="sidebar-confirm-ask">Move to trash?</span>
                      <button
                        className="sidebar-confirm-yes"
                        onClick={() => {
                          setConfirming(null)
                          void useVault.getState().trashWorkspace(workspace.path)
                        }}
                      >
                        Yes
                      </button>
                      <button className="sidebar-act" onClick={() => setConfirming(null)}>
                        No
                      </button>
                    </span>
                  ) : (
                    <>
                      <button
                        className={
                          workspace.path === current ? 'sidebar-item is-current' : 'sidebar-item'
                        }
                        onClick={() => goTo(workspace.path)}
                      >
                        {workspace.name}
                      </button>
                      {/* At rest these took the name's room without
                          being there. They stand over the end of the row now,
                          and the name gives way to them only while they show. */}
                      <span className="sidebar-acts">
                        <button
                          className="sidebar-act"
                          title="Rename"
                          onClick={() => {
                            setConfirming(null)
                            setRenaming(workspace.path)
                          }}
                        >
                          <Icon name="pencil" />
                        </button>
                        <button
                          className="sidebar-act"
                          title="Move to trash"
                          onClick={() => {
                            setRenaming(null)
                            setConfirming(workspace.path)
                          }}
                        >
                          <Icon name="trash" />
                        </button>
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>

            {composing ? (
              <NameBox
                className="sidebar-new-input"
                placeholder="Workspace name"
                onCommit={(name) => void addWorkspace(name)}
                onCancel={() => composeWorkspace(false)}
              />
            ) : (
              <button className="sidebar-new" onClick={() => composeWorkspace(true)}>
                <Icon name="plus" />
                New workspace
              </button>
            )}

            <button className="sidebar-archive" onClick={openArchive}>
              Archive
            </button>

            <button className="sidebar-trash" onClick={openTrash}>
              Trash
            </button>
          </>
        )}

        {/* The theme switch and the Colours button used to be above this. D3
            moved both into the settings window: they are the two settings this
            app had, and a panel is for what you are working on rather than for
            how it looks.

            The foot is outside the section, and that is the point of it: which
            vault is open is the same answer whichever list is showing, and a
            foot that changed with the rail would be saying it is part of the
            list rather than under it. */}
        <Foot />
      </div>

      {/* The edge itself, not a bar beside it: the panel's right border is what
          a hand aims at, so the handle sits on top of it and is four pixels
          wider than it in both directions. */}
      <div
        className="sidebar-grip"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the sidebar"
        onPointerDown={grip}
      />
    </nav>
  )
}

// The Bookmarks section. We chose what it holds: workspaces, the ones
// they keep going back to. Marked from the ⋯ by a kanban's name, listed here in
// the vault's own order, and taken off from here or from the same menu.
//
// Its own rows rather than the workspace list's classes: that list is what the
// rest of the panel means by "the workspaces", and a second list wearing its
// name would be counted as it.
function Bookmarks() {
  const vault = useVault((state) => state.vault)
  const current = useVault((state) => state.workspacePath)
  const goTo = useGoTo()
  const setBookmark = useVault((state) => state.setBookmark)
  const marked = vault?.workspaces.filter((workspace) => workspace.bookmarked === true) ?? []

  // Said rather than left blank. An empty section with no sentence reads as a
  // section that failed to load, and the way in is not on this panel.
  if (marked.length === 0) {
    return (
      <p className="sidebar-marks-empty">
        No bookmarks yet. Add a workspace from the menu beside its name on the kanban.
      </p>
    )
  }

  return (
    <ul className="sidebar-marks">
      {marked.map((workspace) => (
        <li key={workspace.path} className="sidebar-mark-row">
          <button
            className={workspace.path === current ? 'sidebar-mark is-current' : 'sidebar-mark'}
            onClick={() => goTo(workspace.path)}
          >
            {workspace.name}
          </button>
          {/* One button, waiting for the hand the way a workspace row's two
              do: over the end of the row, taking no room until it shows. */}
          <button
            className="sidebar-mark-act"
            title="Remove from bookmarks"
            aria-label="Remove from bookmarks"
            onClick={() => void setBookmark(workspace.path, false)}
          >
            <Icon name="close" />
          </button>
        </li>
      ))}
    </ul>
  )
}

// The foot of the panel, D2. Three things, and the first one is the answer to
// "what am I working on" - which is why it sits apart from the workspace list
// above it rather than being the first row of it.
//
// It replaces two rows that used to be at opposite ends of the panel: a vault
// name at the top that could not be clicked, and an "Open another vault" button
// at the bottom that had nothing to do with the buttons around it. They were
// halves of one thing.
function Foot() {
  const vault = useVault((state) => state.vault)
  const vaults = useVault((state) => state.vaults)
  const open = useVault((state) => state.vaultMenuOpen)
  const openVaultMenu = useVault((state) => state.openVaultMenu)
  const switchVault = useVault((state) => state.switchVault)
  const choose = useVault((state) => state.choose)
  const setKeys = useVault((state) => state.setKeys)
  const setNotice = useVault((state) => state.setNotice)

  const go = async (path: string): Promise<void> => {
    // A folder on the list that will not open is the ordinary case, not a
    // failure to hide: a drive that is not plugged in, a folder that was moved.
    // It is said out loud and the row stays where it is.
    if (!(await switchVault(path))) {
      openVaultMenu(false)
      setNotice(fileName(path) + ' is not where it was. Nothing was changed.')
    }
  }

  return (
    <div className="sidebar-foot">
      {open && (
        <div className="sidebar-vault-menu" role="menu">
          {vaults.map((path) => (
            <button
              key={path}
              className="sidebar-vault-row"
              role="menuitemradio"
              aria-checked={path === vault?.path}
              title={path}
              onClick={() => void go(path)}
            >
              {/* The tick has a slot whether or not it is filled, so the names
                  line up and the open one is the only row that is different. */}
              <span className="sidebar-vault-tick">
                {path === vault?.path ? <Icon name="check" /> : null}
              </span>
              {fileName(path)}
            </button>
          ))}
          <button className="sidebar-vault-other" onClick={choose}>
            Open another vault…
          </button>
        </div>
      )}

      <button
        className="sidebar-vault"
        title={vault?.path}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => openVaultMenu(!open)}
      >
        {vault ? fileName(vault.path) : APP_NAME}
      </button>

      <button className="sidebar-foot-act" title="Keys" onClick={() => setKeys(true)}>
        <Icon name="help" />
      </button>
      {/* D3. For one step this opened the colours sheet, because a gear that
          does nothing is worse than a gear that does the smaller true thing.
          Now it opens the window that holds the colours and everything else.

          It was a typed character before, and before D3 an escape that sat
          on screen as six characters because no check read what the button
          said. Both buttons here are drawn now, and the run reads what they
          hold rather than finding them by title. */}
      <button
        className="sidebar-foot-act"
        title="Settings"
        onClick={() => void window.api.showSettings()}
      >
        <Icon name="gear" />
      </button>
    </div>
  )
}
