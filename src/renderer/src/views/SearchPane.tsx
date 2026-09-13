import { Fragment, useMemo, useState } from 'react'
import { useVault } from '../store'
import {
  PANEL_ROWS,
  SEARCH_SORTS,
  SORT_LABELS,
  buildIndex,
  filterHits,
  sortHits,
  splitHits,
  type SearchSort
} from '../search'
import { DUE_CHOICES, isOn, priorityChoices, tagChoices, toggle } from '../filter'
import { HitTags } from './Palette'

// The Search section of the rail, D4, with D5's sort and filter on top.
//
// It is not the palette in a narrower box. The palette is modal and it closes
// on the answer: a hit is chosen, the surface goes away, and the next question
// starts from an empty box. Here the list stays - and since D5 the query, the
// ordering and the narrowing stay too, because they live in the store rather
// than in this component. Walking to the workspace list and back finds the
// search where it was left, which is what makes it a section rather than a
// thing that happened.
//
// What it deliberately does NOT do is commands. The palette is two things
// wearing one box; D5 settled how they divide - the palette keeps the quick
// jump, this keeps the work - and the bridge row in the palette says so out
// loud rather than leaving the difference to be discovered.
export function SearchPane() {
  const vault = useVault((state) => state.vault)
  const openCardAt = useVault((state) => state.openCardAt)
  const query = useVault((state) => state.searchQuery)
  const setQuery = useVault((state) => state.setSearchQuery)
  const sort = useVault((state) => state.searchSort)
  const setSort = useVault((state) => state.setSearchSort)
  const filter = useVault((state) => state.searchFilter)
  const setFilter = useVault((state) => state.setSearchFilter)
  const clearFilter = useVault((state) => state.clearSearchFilter)
  const scope = useVault((state) => state.searchScope)
  const setScope = useVault((state) => state.setSearchScope)

  // Only the fold is local. Whether a drawer is open is about this render of
  // this panel; everything the drawer SETS is about the search, and outlives it.
  const [open, setOpen] = useState(false)

  // Rebuilt when the vault moves under it, so a card written while the section
  // is open is findable without leaving it. The same rule the palette uses, and
  // for the same reason: nothing is cached between builds because the spec puts
  // an index cache behind a measurement and there has been none.
  const index = useMemo(() => buildIndex(vault), [vault])

  const text = query.trim()
  // Asked for far more rows than the palette takes, and this is not greed: the
  // filter below runs on what search returned, so a page of 20 narrowed to 3
  // would report 3 when the vault holds forty. `total` is what search counted
  // before any cut, which is the number the row about hidden results reads.
  const found = text ? index.search(text, PANEL_ROWS) : { hits: [], total: 0 }
  const narrowed = filterHits(found.hits, filter, scope)
  // Sorted before the archive is split off rather than after, so the ordering
  // is the same rule inside both groups.
  const { hits, live, archived, hidden } = splitHits(sortHits(narrowed, sort))

  const on = isOn(filter) || scope.length > 0
  const workspaces = vault?.workspaces ?? []
  // What the filter can offer comes off the vault rather than being made up -
  // the same rule the kanban's bar follows. A value nothing carries is a row
  // that can only ever empty the list.
  const tags = tagChoices(workspaces)
  const priorities = priorityChoices(workspaces)

  // How many search found and this panel is not showing, and why. Kept apart
  // from `hidden`, which is about the archive: "the filter is holding 12 back"
  // and "there are 12 more than fit" are different news and a person acts on
  // them differently.
  const cut = Math.max(0, found.total - found.hits.length)
  const removed = found.hits.length - narrowed.length

  return (
    <div className="sidebar-search-pane">
      <input
        className="sidebar-search-box"
        spellCheck={false}
        value={query}
        placeholder="Search the vault"
        onChange={(event) => setQuery(event.target.value)}
      />

      {/* The two controls sit above the answer rather than in a sheet over it,
          for the reason the kanban's bar does: you aim a filter by watching
          what it does to the list, and a panel laid over the list hides the
          only feedback there is. */}
      <div className="sidebar-search-tools">
        <label className="sidebar-search-sort">
          <span>Sort</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as SearchSort)}>
            {SEARCH_SORTS.map((one) => (
              <option key={one} value={one}>
                {SORT_LABELS[one]}
              </option>
            ))}
          </select>
        </label>

        <button
          className={on ? 'sidebar-search-filter-toggle is-on' : 'sidebar-search-filter-toggle'}
          aria-expanded={open || on}
          onClick={() => setOpen(!open)}
        >
          Filter
        </button>
        {on && (
          <button className="sidebar-search-filter-clear" onClick={clearFilter}>
            Clear
          </button>
        )}
      </div>

      {/* Folded away only while it is doing nothing. A narrowing nobody can see
          is indistinguishable from a vault that has lost the cards - and this
          app's one promise is that nothing is lost. */}
      {(open || on) && (
        <div className="sidebar-search-filter">
          {/* The group the kanban cannot have: it is one workspace already, and
              this is looking at all of them. */}
          {workspaces.length > 1 && (
            <Group name="Workspace">
              {workspaces.map((workspace) => (
                <Chip
                  key={workspace.path}
                  label={workspace.name}
                  on={scope.includes(workspace.path)}
                  data={workspace.path}
                  onClick={() => setScope(toggle(scope, workspace.path))}
                />
              ))}
            </Group>
          )}

          {tags.length > 0 && (
            <Group name="Tag">
              {tags.map((tag) => (
                <Chip
                  key={tag}
                  label={tag}
                  on={filter.tags.includes(tag)}
                  data={tag}
                  onClick={() => setFilter({ ...filter, tags: toggle(filter.tags, tag) })}
                />
              ))}
            </Group>
          )}

          <Group name="Due">
            {DUE_CHOICES.map((choice) => (
              <Chip
                key={choice.id}
                label={choice.label}
                on={filter.due.includes(choice.id)}
                data={choice.id}
                onClick={() => setFilter({ ...filter, due: toggle(filter.due, choice.id) })}
              />
            ))}
          </Group>

          {priorities.length > 0 && (
            <Group name="Priority">
              {priorities.map((value) => (
                <Chip
                  key={value}
                  label={value}
                  on={filter.priority.includes(value)}
                  data={value}
                  onClick={() =>
                    setFilter({ ...filter, priority: toggle(filter.priority, value) })
                  }
                />
              ))}
            </Group>
          )}

          {/* The archive is not a group here, and that is not an oversight. The
              kanban's checkbox WIDENS - archived cards are off the board until
              it is ticked. Search never hid them in the first place; they are
              answered under a divider of their own. One word meaning "let them
              in" on one surface and "they are already in" on another is how a
              shared control ends up wrong on one of them. */}
          <p className="sidebar-search-filter-note">
            Archived cards are always answered, under their own heading.
          </p>
        </div>
      )}

      {/* Before a word is typed the section says what it is holding rather than
          nothing. A count is also the one thing here a person can check: an
          index that came back empty looks exactly like a vault with no cards
          in it, and this is where the two stop looking the same. */}
      {text === '' ? (
        <p className="sidebar-search-idle">
          <span className="sidebar-search-count">{index.size}</span>
          {index.size === 1 ? ' card in this vault' : ' cards in this vault'}
        </p>
      ) : (
        <p className="sidebar-search-mode">
          Cards
          <span className="sidebar-search-count">{hits.length}</span>
        </p>
      )}

      {text !== '' && hits.length === 0 && (
        <p className="sidebar-search-empty">
          {/* Two different answers, and the difference is what the user does
              next. "Nothing says that" means try other words; "the filter is
              holding them back" means the words were fine. A single sentence
              for both would send half the users the wrong way. */}
          {found.total === 0
            ? 'Nothing in the vault says that.'
            : 'The filter is holding all ' + found.total + ' of them back.'}
        </p>
      )}

      <ul className="sidebar-search-list">
        {hits.map((hit, i) => (
          <Fragment key={hit.key}>
            {i === live.length && (
              <li className="sidebar-search-group">Archive ({archived.length})</li>
            )}
            <li>
              <button
                className="sidebar-search-row"
                onClick={() => void openCardAt(hit.workspacePath, hit.card.id)}
              >
                <span className="sidebar-search-head">
                  <span className="sidebar-search-title">{hit.card.title}</span>
                  <span className="sidebar-search-where">{hit.workspaceName}</span>
                </span>
                <HitTags hit={hit} workspaces={workspaces} />
                {hit.snippet && <span className="sidebar-search-snippet">{hit.snippet}</span>}
              </button>
            </li>
          </Fragment>
        ))}
        {hidden > 0 && <li className="sidebar-search-more">+{hidden} more in the archive</li>}
        {/* Two different pieces of news, said separately. One is something the
            user did and can undo; the other is a limit of the surface. */}
        {removed > 0 && hits.length > 0 && (
          <li className="sidebar-search-held">The filter is holding {removed} back.</li>
        )}
        {cut > 0 && (
          <li className="sidebar-search-more">
            +{cut} more than this panel shows. Narrow the words.
          </li>
        )}
      </ul>

      {/* The panel button that used to say this left with D4: two surfaces
          called Search, one of them a section and one of them a modal, is one
          name for two things. The shortcut still opens the palette, so it is
          said here - where the person who wants the other half is standing. */}
      <p className="sidebar-search-hint">Ctrl+P for the palette, and for commands</p>
    </div>
  )
}

function Group({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="sidebar-search-group-row">
      <p className="sidebar-search-group-name">{name}</p>
      <div className="sidebar-search-chips">{children}</div>
    </div>
  )
}

function Chip({
  label,
  on,
  data,
  onClick
}: {
  label: string
  on: boolean
  data: string
  onClick: () => void
}) {
  return (
    <button
      className={on ? 'sidebar-search-chip is-on' : 'sidebar-search-chip'}
      aria-pressed={on}
      data-chip={data}
      onClick={onClick}
    >
      {label}
    </button>
  )
}
