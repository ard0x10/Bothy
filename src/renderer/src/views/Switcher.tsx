import { useLayoutEffect, useState } from 'react'
import { useVault } from '../store'
import { backgroundCss } from '../../../shared/background'
import type { Workspace } from '../../../shared/types'
import { Icon } from './Icon'

// The workspace switcher: the bookmarked
// workspaces on top, every workspace under them, each one a card wearing its
// own background, a search box over both and a bookmark on every card. The
// fourth button on the tab bar opens it, and so does Ctrl+4.
//
// A sheet over the board rather than a view of its own, the pick: it is for
// leaving what is on screen, so what is on screen waits behind it.
//
// In the middle of the kanban both ways: not over the tab bar,
// where it first stood. The middle of the content beside the sidebar rather
// than of the window: with the sidebar open those are two places, and a sheet
// off to one side of the board reads as belonging to something else. Its width
// and its room are the card sheet's: 720 and never past 92 in a hundred of the
// room, and never nearer than 12vh to the top or the foot.
type Room = { left: number; top: number; width: number; height: number }

function roomOf(content: DOMRect | undefined): Room {
  return content
    ? { left: content.left, top: content.top, width: content.width, height: content.height }
    : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
}

export function Switcher() {
  const open = useVault((state) => state.switcherOpen)
  const openSwitcher = useVault((state) => state.openSwitcher)
  const vault = useVault((state) => state.vault)
  const current = useVault((state) => state.workspacePath)
  const select = useVault((state) => state.select)
  const setBookmark = useVault((state) => state.setBookmark)
  const [query, setQuery] = useState('')
  const [room, setRoom] = useState<Room | null>(null)

  // Measured before the first paint, so the sheet is never seen anywhere else,
  // and again whenever the window changes size under it. It opens on an empty
  // search every time: a search left over from last time would be workspaces
  // missing for a reason nobody on screen can see.
  useLayoutEffect(() => {
    if (!open) {
      setRoom(null)
      return
    }
    setQuery('')
    const measure = (): void =>
      setRoom(roomOf(document.querySelector('.content')?.getBoundingClientRect()))
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open])

  if (!open || !vault || !room) return null

  const close = (): void => openSwitcher(false)
  // Through select, like every other way into a workspace, so an open card is
  // written before it goes. The sheet is put away once the move is made.
  const go = (path: string): void => void select(path).then(close)

  const needle = query.trim().toLocaleLowerCase()
  const shown =
    needle === ''
      ? vault.workspaces
      : vault.workspaces.filter((workspace) =>
          workspace.name.toLocaleLowerCase().includes(needle)
        )
  const marked = shown.filter((workspace) => workspace.bookmarked === true)

  const card = (workspace: Workspace) => {
    const here = workspace.path === current
    const on = workspace.bookmarked === true
    return (
      <li key={workspace.path} className="switcher-item">
        <button
          className={here ? 'switcher-card is-current' : 'switcher-card'}
          aria-current={here}
          title={workspace.name}
          onClick={() => go(workspace.path)}
        >
          {/* The board's own ground, drawn the way the kanban draws it. A
              workspace with none shows the app's ground, which is what its
              kanban sits on. */}
          <span
            className="switcher-ground"
            style={
              workspace.background ? { background: backgroundCss(workspace.background) } : undefined
            }
          />
          <span className="switcher-name">{workspace.name}</span>
        </button>
        {/* Over the card rather than inside it: a button inside a button is
            two presses the browser will not tell apart. */}
        <button
          className={on ? 'switcher-mark is-on' : 'switcher-mark'}
          aria-pressed={on}
          title={on ? 'Remove from bookmarks' : 'Add to bookmarks'}
          aria-label={on ? 'Remove from bookmarks' : 'Add to bookmarks'}
          onClick={() => void setBookmark(workspace.path, !on)}
        >
          <Icon name={on ? 'bookmark-on' : 'bookmark'} />
        </button>
      </li>
    )
  }

  return (
    <div className="switcher-scrim" onPointerDown={close}>
      {/* The kanban's own box, laid over it, so the sheet is put in its middle
          by layout rather than by arithmetic on a height that changes with
          every letter typed into the search. A press on it is a press
          outside the sheet, and reaches the scrim. */}
      <div
        className="switcher-room"
        style={{ left: room.left, top: room.top, width: room.width, height: room.height }}
      >
        <section
          className="switcher"
          role="dialog"
          aria-modal="true"
          aria-label="Switch workspace"
          style={{
            width: Math.min(720, room.width * 0.92),
            maxHeight: room.height - window.innerHeight * 0.24
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <header className="switcher-head">
            <span className="switcher-find">
              <Icon name="search" />
              <input
                className="switcher-search"
                autoFocus
                placeholder="Search workspaces"
                aria-label="Search workspaces"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && shown.length > 0) go(shown[0].path)
                }}
              />
            </span>
            <button className="panel-icon" title="Close (Esc)" aria-label="Close" onClick={close}>
              <Icon name="close" />
            </button>
          </header>

          <div className="switcher-body">
            {/* While searching, only if something in it matches: an empty
                Bookmarks under a search says nothing the list below does not. */}
            {(needle === '' || marked.length > 0) && (
              <section className="switcher-part" data-part="bookmarks">
                <h3 className="switcher-part-head">
                  <Icon name="bookmark" />
                  Bookmarks
                </h3>
                {marked.length === 0 ? (
                  <p className="switcher-empty">
                    No bookmarks yet. The bookmark on a card below adds its workspace here.
                  </p>
                ) : (
                  <ul className="switcher-grid">{marked.map(card)}</ul>
                )}
              </section>
            )}

            <section className="switcher-part" data-part="all">
              <h3 className="switcher-part-head">
                <Icon name="folder" />
                All workspaces
              </h3>
              {shown.length === 0 ? (
                <p className="switcher-empty">
                  {needle === ''
                    ? 'No workspaces yet.'
                    : `Nothing here has “${query.trim()}” in its name.`}
                </p>
              ) : (
                <ul className="switcher-grid">{shown.map(card)}</ul>
              )}
            </section>
          </div>
        </section>
      </div>
    </div>
  )
}
