import { useState } from 'react'
import { useVault } from '../store'
import { Icon } from './Icon'

// Where something on the board goes when it leaves this workspace, v0.5. The
// same two pages serve the card held under the right press and the column's ⋯,
// because they are asking one question with a different number of answers: a
// card needs a workspace and then a column of it, a column needs the workspace
// and nothing else.
//
// It draws the rows and the menu that opened it draws the box, so a menu's
// width, its ground and where it stands are still its own.
//
// The second page is the vault's own list, never typed out and never fetched:
// the window already holds every workspace of the open vault, which is what
// makes offering the columns of a board nobody is looking at cost nothing.

// The head of a menu's second page: back, and what this page is about.
export function MenuTop({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="menu-top">
      <button className="menu-back" title="Back" aria-label="Back" onClick={onBack}>
        <Icon name="arrow-left" />
      </button>
      <span className="menu-title">{title}</span>
    </div>
  )
}

export function MoveMenu({
  from,
  column,
  onBack,
  onPick
}: {
  // The workspace it is leaving, which is the one row that is not offered.
  from: string
  // Whether a column has to be chosen as well. A card lands in one; a column
  // lands at the end of the board and has no such question.
  column: boolean
  onBack: () => void
  onPick: (path: string, columnId: string | null) => void
}) {
  const vault = useVault((state) => state.vault)
  const [at, setAt] = useState<string | null>(null)

  const others = vault?.workspaces.filter((one) => one.path !== from) ?? []
  const chosen = others.find((one) => one.path === at) ?? null

  if (chosen === null) {
    return (
      <>
        <MenuTop title="Move to" onBack={onBack} />
        {/* Said rather than left blank, the way the Bookmarks section says it:
            an empty list with no sentence reads as one that failed to load. */}
        {others.length === 0 ? (
          <p className="menu-empty">This vault has no other workspace.</p>
        ) : (
          others.map((workspace) => (
            <button
              key={workspace.path}
              className="menu-row"
              role="menuitem"
              title={workspace.name}
              onClick={() => (column ? setAt(workspace.path) : onPick(workspace.path, null))}
            >
              <span className="menu-row-name">{workspace.name}</span>
              {/* Only where there is another page behind the row. Without a
                  column to choose the press is the whole answer, and an arrow
                  would promise a page that never comes. */}
              {column && <Icon name="chevron-right" />}
            </button>
          ))
        )}
      </>
    )
  }

  return (
    <>
      {/* Back to the workspaces rather than out of the move: a wrong board is
          the mistake this page is for. */}
      <MenuTop title={chosen.name} onBack={() => setAt(null)} />
      {chosen.columns.length === 0 ? (
        <p className="menu-empty">{chosen.name} has no columns yet.</p>
      ) : (
        chosen.columns.map((one) => (
          <button
            key={one.id}
            className="menu-row"
            role="menuitem"
            title={one.title}
            onClick={() => onPick(chosen.path, one.id)}
          >
            <span className="menu-row-name">{one.title}</span>
            <span className="menu-row-count">{one.cards.length}</span>
          </button>
        ))
      )}
    </>
  )
}
