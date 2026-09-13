import type { Workspace } from '../../../shared/types'
import {
  DUE_CHOICES,
  isOn,
  priorityChoices,
  tagChoices,
  type Filter
} from '../filter'
import { resolveAcross } from '../labels'
import { labelText } from '../../../shared/labels'
import { useVault } from '../store'
import { Icon } from './Icon'

// Whether the filter is doing something and whether its bar is out. Read by
// the button in the kanban's head and by the bar under it, which must agree.
function useFilterState(scope?: boolean) {
  const filter = useVault((state) => state.filter)
  const open = useVault((state) => state.filterOpen)
  const only = useVault((state) => state.calendarWorkspaces)
  const on = isOn(filter) || (scope === true && only.length > 0)
  // Folded away only while it is doing nothing. A filter nobody can see is
  // indistinguishable from cards that went missing, and this app's one promise
  // is that nothing goes missing.
  return { filter, open, only, on, unfolded: open || on }
}

// In the kanban's head, an icon rather than a word, and before the ⋯.
// It wears the bar's frame while cards are being hidden.
export function FilterToggle({ scope }: { scope?: boolean }) {
  const setOpen = useVault((state) => state.setFilterOpen)
  const { open, on, unfolded } = useFilterState(scope)
  return (
    <button
      className={on ? 'filter-toggle is-on' : 'filter-toggle'}
      title="Filter"
      aria-label="Filter"
      aria-expanded={unfolded}
      onClick={() => setOpen(!open)}
    >
      <Icon name="filter" />
    </button>
  )
}

// Above the columns rather than in a sheet of its own: a filter is a thing you
// aim, and you aim it by watching what it does to the kanban. A panel laid over
// the cards would hide the only feedback there is. Folded, it is not there at
// all: its button is in the head, so it has no row of its own to keep.
//
// It takes a list of workspaces rather than one since step 7. The kanban hands
// it the folder it is showing; the calendar hands it every folder in the vault,
// because that is what the calendar is drawing.
export function FilterBar({
  workspaces,
  hidden,
  scope
}: {
  workspaces: Workspace[]
  hidden: number
  // The calendar's extra group. Absent on the kanban, where narrowing by
  // workspace would be a control that cannot do anything: the kanban is one
  // workspace already.
  scope?: boolean
}) {
  const clear = useVault((state) => state.clearFilter)
  const { filter, only, on, unfolded } = useFilterState(scope)
  if (!unfolded) return null

  return (
    <div className={on ? 'filter is-on' : 'filter'}>
      {on && (
        <div className="filter-head">
          <span className="filter-count">
            {hidden === 0 ? 'nothing hidden' : `${hidden} hidden`}
          </span>
          <button className="filter-clear" onClick={clear}>
            Clear
          </button>
        </div>
      )}

      <div className="filter-body">
        {scope && <Scope workspaces={workspaces} only={only} />}
        <Tags workspaces={workspaces} filter={filter} />
        <Dues filter={filter} />
        <Priorities workspaces={workspaces} filter={filter} />
        <Archived filter={filter} />
      </div>
    </div>
  )
}

function Group({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <section className="filter-group">
      <h4 className="filter-group-name">{name}</h4>
      <div className="filter-chips">{children}</div>
    </section>
  )
}

// How somebody who wants one workspace's calendar gets it. Nothing picked means
// all of them, which is the view's whole reason for existing, so an empty set
// is shown as nothing selected rather than as everything selected: the chips
// are what you add, not what you take away.
function Scope({ workspaces, only }: { workspaces: Workspace[]; only: string[] }) {
  const toggleWorkspace = useVault((state) => state.toggleCalendarWorkspace)
  if (workspaces.length < 2) return null

  return (
    <Group name="Workspace">
      {workspaces.map((workspace) => (
        <button
          key={workspace.path}
          className={only.includes(workspace.path) ? 'filter-chip is-on' : 'filter-chip'}
          onClick={() => toggleWorkspace(workspace.path)}
        >
          {workspace.name}
        </button>
      ))}
    </Group>
  )
}

function Tags({ workspaces, filter }: { workspaces: Workspace[]; filter: Filter }) {
  const toggleTag = useVault((state) => state.toggleFilterTag)
  const names = tagChoices(workspaces)
  if (names.length === 0) return null

  const on = (name: string): boolean =>
    filter.tags.some((tag) => tag.toLowerCase() === name.toLowerCase())

  return (
    <Group name="Tags">
      {names.map((name) => {
        const label = resolveAcross(workspaces, name)
        return (
          <button
            key={name}
            className={on(name) ? 'filter-chip is-on' : 'filter-chip'}
            onClick={() => toggleTag(name)}
          >
            <span className="tag-dot" style={{ background: label.color }} />
            {labelText(label)}
          </button>
        )
      })}
    </Group>
  )
}

function Dues({ filter }: { filter: Filter }) {
  const toggleDue = useVault((state) => state.toggleFilterDue)
  return (
    <Group name="Due">
      {DUE_CHOICES.map((choice) => (
        <button
          key={choice.id}
          className={filter.due.includes(choice.id) ? 'filter-chip is-on' : 'filter-chip'}
          onClick={() => toggleDue(choice.id)}
        >
          {choice.label}
        </button>
      ))}
    </Group>
  )
}

// Only the values the cards actually carry. Priority has no fixed set on disk,
// so offering one would mean offering rows that can do nothing but empty the
// kanban.
function Priorities({ workspaces, filter }: { workspaces: Workspace[]; filter: Filter }) {
  const togglePriority = useVault((state) => state.toggleFilterPriority)
  const values = priorityChoices(workspaces)
  if (values.length === 0) return null

  const on = (value: string): boolean =>
    filter.priority.some((entry) => entry.toLowerCase() === value.toLowerCase())

  return (
    <Group name="Priority">
      {values.map((value) => (
        <button
          key={value}
          className={on(value) ? 'filter-chip is-on' : 'filter-chip'}
          onClick={() => togglePriority(value)}
        >
          {value}
        </button>
      ))}
    </Group>
  )
}

// The one control here that widens instead of narrowing. Planned since
// step 1 and parked until this bar existed to hold it.
function Archived({ filter }: { filter: Filter }) {
  const showArchived = useVault((state) => state.showArchived)
  return (
    <Group name="Archive">
      <label className="filter-check">
        <input
          type="checkbox"
          className="filter-archived"
          checked={filter.archived}
          onChange={(event) => showArchived(event.target.checked)}
        />
        Show archived
      </label>
    </Group>
  )
}
