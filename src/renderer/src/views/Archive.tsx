import { useVault, useWorkspace } from '../store'
import { archivedInOrder, columnTitleOf } from '../archive'
import { Icon } from './Icon'

// The sheet looks like the trash sheet and is styled by the same rules, but it
// answers to its own class names. Sharing them was tried first and it broke a
// check one screen over: two buttons matching .sidebar-trash meant the first one
// in the document won, and a querySelector that had always meant "the trash"
// silently started meaning "the archive".
//
// Scoped to the workspace on screen. The kanban is per workspace, and so is
// putting a card back on it; a card archived in another folder is reached
// through search, which crosses the whole vault.
export function Archive() {
  const open = useVault((state) => state.archiveOpen)
  const closeArchive = useVault((state) => state.closeArchive)
  const openCard = useVault((state) => state.openCard)
  const setArchived = useVault((state) => state.setArchived)
  const workspace = useWorkspace()

  if (!open || !workspace) return null

  const cards = archivedInOrder(workspace.columns, workspace.cards)

  return (
    <div className="archive-scrim" onMouseDown={closeArchive}>
      <section className="archive" onMouseDown={(event) => event.stopPropagation()}>
        <header className="archive-head">
          <h2>Archive</h2>
          <span className="archive-note">{workspace.name}</span>
          <button className="panel-icon" title="Close (Esc)" onClick={closeArchive}>
            <Icon name="close" />
          </button>
        </header>

        {cards.length === 0 && (
          <p className="archive-empty">Nothing is archived in this workspace.</p>
        )}

        <ul className="archive-list">
          {cards.map((card) => (
            <li key={card.id} className="archive-row">
              <span className="archive-name" title={card.file}>
                {card.title}
              </span>
              <span className="archive-where">{columnTitleOf(workspace.columns, card.id)}</span>
              <span className="archive-when" />
              <button
                className="archive-act"
                title="Back on the kanban, in the column it left"
                onClick={() => void setArchived(card.id, false)}
              >
                Put back
              </button>
              <button
                className="archive-act"
                title="Open it without taking it out of the archive"
                onClick={() => {
                  closeArchive()
                  openCard(card.id)
                }}
              >
                Open
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
