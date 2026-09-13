import { Fragment, useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import type { Workspace } from '../../../shared/types'
import { useVault, useWorkspace } from '../store'
import { PALETTE_ROWS, buildIndex, splitHits, type Hit } from '../search'
import { resolveAcross } from '../labels'
import { labelText } from '../../../shared/labels'

// One surface for the three things the spec asks of it: find a card anywhere in
// the vault, go somewhere, run something.
//
// D5 settled what it is FOR, now that the panel searches too: this is the quick
// jump. It closes on the answer, it takes a screenful, and it does not narrow.
// The panel is where a search is worked on - sorted, filtered, come back to.
// The two are not kept apart by hoping the user notices: the bridge row at the
// foot of the results carries the query over, so the difference is something
// the app offers rather than something to find out.
//
// The mode comes from what is typed. Nothing typed shows the commands, so the
// palette says what it can do the first time it is opened. Plain text searches
// cards. A leading ">" asks for commands again once text is in the box, which
// is the prefix every comparable product uses.
const COMMAND_PREFIX = '>'

export type Command = {
  id: string
  title: string
  hint?: string
  run: () => void
}

export function Palette() {
  const open = useVault((state) => state.paletteOpen)
  const seed = useVault((state) => state.paletteSeed)
  const closePalette = useVault((state) => state.closePalette)
  const vault = useVault((state) => state.vault)
  const workspacePath = useVault((state) => state.workspacePath)
  const openId = useVault((state) => state.openId)
  const workspace = useWorkspace()

  const [query, setQuery] = useState('')
  const [at, setAt] = useState(0)

  // Opening is what resets the box, so a palette closed mid-search does not
  // come back holding yesterday's query.
  useEffect(() => {
    if (open) {
      setQuery(seed)
      setAt(0)
    }
  }, [open, seed])

  // Built when the palette opens and again whenever the vault moves under it,
  // so a card written while the palette is up is findable without closing it.
  // Nothing is cached between openings: the spec puts an index cache behind a
  // measurement, and there has been none.
  const index = useMemo(() => (open ? buildIndex(vault) : null), [open, vault])

  const commands = useMemo(
    () => buildCommands(workspace, vault?.workspaces ?? [], workspacePath, openId),
    [workspace, vault, workspacePath, openId]
  )

  const asCommand = query.startsWith(COMMAND_PREFIX)
  const text = asCommand ? query.slice(COMMAND_PREFIX.length).trim() : query.trim()
  const mode: 'cards' | 'commands' = asCommand || text === '' ? 'commands' : 'cards'

  const shown = mode === 'commands' ? filterCommands(commands, text) : []
  // A screenful, and the count of everything there was. The palette does not
  // grow to fit an answer - that is what the panel is for - so it has to be
  // able to SAY there is more rather than quietly ending the list.
  const answer = mode === 'cards' && index ? index.search(text, PALETTE_ROWS) : { hits: [], total: 0 }
  const found = answer.hits

  // How live and archived hits are laid out is settled in search.ts rather than
  // here, because D4 put a second surface on the same query: a panel and a
  // palette with their own copy of this rule are two searches that can disagree
  // about the same words.
  const { hits, live, archived, hidden } = splitHits(found)
  // The bridge to the panel, D5. Offered whenever there is an answer at all,
  // not only when the answer overflowed: "work on these" is a reasonable thing
  // to want about three hits as well as about three hundred.
  const bridge = mode === 'cards' && hits.length > 0
  // It counts as a row. A control that only a mouse can reach, in a surface
  // whose whole point is that the hands stay on the keys, is a control that is
  // there for show - so the arrow keys walk onto it and Enter takes it.
  const count = (mode === 'commands' ? shown.length : hits.length) + (bridge ? 1 : 0)

  if (!open) return null

  const choose = (chosen: number): void => {
    if (mode === 'commands') {
      const command = shown[chosen]
      if (!command) return
      closePalette()
      command.run()
      return
    }
    if (bridge && chosen === hits.length) {
      // The store closes the palette and opens the panel, rather than this
      // doing half of it and asking for the other half: the rail needs an open
      // panel to live on, and setSection is the one place that knows it.
      useVault.getState().openSearch(text)
      return
    }
    const hit = hits[chosen]
    if (!hit) return
    closePalette()
    void useVault.getState().openCardAt(hit.workspacePath, hit.card.id)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setAt((now) => (count === 0 ? 0 : (now + 1) % count))
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setAt((now) => (count === 0 ? 0 : (now - 1 + count) % count))
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      choose(at)
    }
    // Escape is deliberately not handled here. The window owns it, so there is
    // one place that decides whether it closes the palette or the card.
  }

  return (
    <div className="palette-scrim" onMouseDown={closePalette}>
      <div className="palette" onMouseDown={(event) => event.stopPropagation()}>
        <input
          className="palette-input"
          autoFocus
          spellCheck={false}
          value={query}
          placeholder="Search the vault, or > for commands"
          onChange={(event) => {
            setQuery(event.target.value)
            setAt(0)
          }}
          onKeyDown={onKeyDown}
        />

        <p className="palette-mode">
          {mode === 'commands' ? 'Commands' : 'Cards in this vault'}
          <span className="palette-count">{count}</span>
        </p>

        {count === 0 && (
          <p className="palette-empty">
            {mode === 'commands' ? 'No command matches that.' : 'Nothing in the vault says that.'}
          </p>
        )}

        <ul className="palette-list">
          {mode === 'commands'
            ? shown.map((command, i) => (
                <li key={command.id}>
                  <button
                    className={rowClass(i === at)}
                    onMouseMove={() => setAt(i)}
                    onClick={() => choose(i)}
                  >
                    <span className="palette-row-title">{command.title}</span>
                    {command.hint && <span className="palette-hint">{command.hint}</span>}
                  </button>
                </li>
              ))
            : hits.map((hit, i) => (
                <Fragment key={hit.key}>
                  {i === live.length && (
                    <li className="palette-group">
                      <span>Archive ({archived.length})</span>
                    </li>
                  )}
                  <li>
                    <button
                      className={rowClass(i === at)}
                      onMouseMove={() => setAt(i)}
                      onClick={() => choose(i)}
                    >
                      <span className="palette-row-head">
                        <span className="palette-row-title">{hit.card.title}</span>
                        <span className="palette-where">{hit.workspaceName}</span>
                      </span>
                      <HitTags hit={hit} workspaces={vault?.workspaces ?? []} />
                      {hit.snippet && <span className="palette-snippet">{hit.snippet}</span>}
                    </button>
                  </li>
                </Fragment>
              ))}
          {mode === 'cards' && hidden > 0 && (
            <li className="palette-more">+{hidden} more in the archive</li>
          )}
          {bridge && (
            <li>
              {/* Deliberately NOT palette-row / palette-row-title, even though
                  it is a row with a title in it. Those two selectors are what
                  the whole run means by "a card the search found", and a bridge
                  wearing them makes every count of the answers one too many -
                  which is exactly what happened the first time this was
                  written. A class is a claim about what a thing IS. */}
              <button
                className={at === hits.length ? 'palette-bridge is-at' : 'palette-bridge'}
                onMouseMove={() => setAt(hits.length)}
                onClick={() => choose(hits.length)}
              >
                <span className="palette-bridge-title">
                  {answer.total > hits.length
                    ? 'Show all ' + answer.total + ' in the panel'
                    : 'Show these in the panel'}
                </span>
                {/* Said here rather than assumed: the reason to cross is that
                    the other side can do things this one cannot. */}
                <span className="palette-bridge-why">Sort them, narrow them, keep them open.</span>
              </button>
            </li>
          )}
        </ul>
      </div>
    </div>
  )
}

function rowClass(current: boolean): string {
  return current ? 'palette-row is-at' : 'palette-row'
}

// Colours come from the workspace the card lives in, not the one on screen. Two
// folders are free to give the same tag different colours.
export function HitTags({ hit, workspaces }: { hit: Hit; workspaces: Workspace[] }) {
  if (hit.card.tags.length === 0) return null
  const owner = workspaces.find((workspace) => workspace.path === hit.workspacePath)
  return (
    <span className="palette-tags">
      {hit.card.tags.map((tag) => {
        const label = resolveAcross(owner ? [owner] : [], tag)
        return (
          <span key={tag} className="palette-tag" style={{ background: label.color }}>
            {labelText(label)}
          </span>
        )
      })}
    </span>
  )
}

// Substring, not the fuzzy index: a command list is short and read by eye, and
// a palette that guesses at a command name is a palette that runs the wrong one.
function filterCommands(commands: Command[], text: string): Command[] {
  if (!text) return commands
  const terms = text.toLowerCase().split(/\s+/)
  return commands.filter((command) => {
    const title = command.title.toLowerCase()
    return terms.every((term) => title.includes(term))
  })
}

export function buildCommands(
  workspace: Workspace | null,
  workspaces: Workspace[],
  workspacePath: string | null,
  openId: string | null
): Command[] {
  const commands: Command[] = []
  const store = (): ReturnType<typeof useVault.getState> => useVault.getState()

  // Naming the card is left to the kanban, where the file name is decided. A
  // command that made one up would put an "Untitled" file on disk under a name
  // nobody chose.
  for (const column of workspace?.columns ?? []) {
    commands.push({
      id: `new:${column.id}`,
      title: `New card in ${column.title}`,
      run: () => store().composeIn(column.id)
    })
  }

  commands.push({
    id: 'new-column',
    title: 'New column',
    run: () => store().composeColumn(true)
  })

  for (const other of workspaces) {
    if (other.path === workspacePath) continue
    commands.push({
      id: `go:${other.path}`,
      title: `Go to ${other.name}`,
      run: () => void store().select(other.path)
    })
  }

  commands.push({
    id: 'new-workspace',
    title: 'New workspace',
    run: () => store().composeWorkspace(true)
  })
  commands.push({
    id: 'trash',
    title: 'Open the trash',
    run: () => store().openTrash()
  })

  if (openId) {
    commands.push({
      id: 'save',
      title: 'Save now',
      hint: 'Ctrl+S',
      run: () => void store().saveDraft()
    })
    commands.push({
      id: 'trash',
      title: 'Move card to trash',
      run: () => void store().trashCard(openId)
    })
    commands.push({
      id: 'close',
      title: 'Close card',
      hint: 'Esc',
      run: () => void store().closeCard()
    })
  }

  commands.push({
    id: 'reload',
    title: 'Reload from disk',
    run: () => void store().reload()
  })
  commands.push({
    id: 'vault',
    title: 'Open another vault…',
    run: () => void store().choose()
  })

  return commands
}
