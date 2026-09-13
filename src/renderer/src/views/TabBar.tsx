import { Fragment } from 'react'
import type { View } from '../../../shared/types'
import { useVault } from '../store'
import { Icon, type IconName } from './Icon'

// Floating and centred over the content rather than docked to an edge: the
// work is the thing, and the views it switches between are one control, not a
// piece of the frame competing with the sidebar for the eye.
//
// Three since step 7. Only the first two are a workspace's own tab; the
// calendar is global and is not written into workspace.json, which is why the
// type here is View rather than Tab.
//
// And a fourth button that is not a view: Workspaces opens the sheet
// that moves between them. We put a line before the calendar, so the bar
// reads as two pairs - the two views that belong to a workspace, then the two
// things that reach across all of them.
const TABS: { id: View; icon: IconName; label: string; key: string }[] = [
  { id: 'kanban', icon: 'kanban', label: 'Kanban', key: 'Ctrl+1' },
  { id: 'canvas', icon: 'canvas', label: 'Canvas', key: 'Ctrl+2' },
  { id: 'calendar', icon: 'calendar', label: 'Calendar', key: 'Ctrl+3' }
]

export function TabBar() {
  const tab = useVault((state) => state.tab)
  const setTab = useVault((state) => state.setTab)
  const switcherOpen = useVault((state) => state.switcherOpen)
  const openSwitcher = useVault((state) => state.openSwitcher)

  return (
    <nav className="tabs" aria-label="View">
      {TABS.map((entry) => (
        <Fragment key={entry.id}>
          {entry.id === 'calendar' && <span className="tabs-line" aria-hidden="true" />}
          <button
            className={entry.id === tab ? 'tab is-current' : 'tab'}
            data-view={entry.id}
            aria-current={entry.id === tab}
            title={`${entry.label} (${entry.key})`}
            onClick={() => void setTab(entry.id)}
          >
            <Icon name={entry.icon} />
            {entry.label}
          </button>
        </Fragment>
      ))}
      <button
        className="tab"
        data-act="workspaces"
        aria-haspopup="dialog"
        aria-expanded={switcherOpen}
        title="Switch workspace (Ctrl+4)"
        onClick={() => openSwitcher(!switcherOpen)}
      >
        <Icon name="workspaces" />
        Workspaces
      </button>
    </nav>
  )
}
