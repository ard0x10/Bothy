import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  dropField,
  fieldText,
  isBlock,
  keyProblem,
  kindOf,
  readFieldText,
  renameField,
  setField
} from '../../../shared/fields'
import { fileName } from '../../../shared/paths'
import { coverImage } from '../../../shared/cover'
import { fileUrl, isImageName } from '../../../shared/image'
import type { Card, Workspace } from '../../../shared/types'
import { addedAgo } from '../dates'
import { useVault, useWorkspace } from '../store'
import { renderMarkdown } from '../markdown'
import { resolveLabel } from '../labels'
import { LABEL_KEYS, colourLabel, labelKeyOf, labelText, labelWord } from '../../../shared/labels'
import { DAY, PRIORITIES } from '../../../shared/schema/card'
import { Checklists } from './Checklists'
import { Icon, type IconName } from './Icon'
import { NameBox } from './NameBox'
import { useMenu } from './useMenu'
import type { CardView } from '../../../shared/cardview'

// Long enough that a sentence is one write instead of forty, short enough that
// the file is current by the time the user reaches for another program.
const AUTOSAVE_MS = 500

// The parts of a card that stay out of sight until they hold something or are
// asked for, so the panel stays plain and easy to use. The title and
// the description are always there; a checklist is there once one is added.
type Part = 'tags' | 'dates' | 'priority' | 'files' | 'fields'

function partsIn(card: Card): Set<Part> {
  const parts = new Set<Part>()
  if (card.tags.length > 0) parts.add('tags')
  if (card.start || card.due) parts.add('dates')
  if (card.priority) parts.add('priority')
  if (card.files.length > 0) parts.add('files')
  if (Object.keys(card.extra).length > 0) parts.add('fields')
  return parts
}

// What the Add menu holds: the parts that did not earn a button of their own.
const MORE: { part: Part; label: string; icon: IconName }[] = [
  { part: 'priority', label: 'Priority', icon: 'flag' },
  { part: 'files', label: 'Files', icon: 'file' },
  { part: 'fields', label: 'Custom field', icon: 'fields' }
]

// Where it stands is the user's, from Settings: in the middle of the window over
// a scrim, or down the right side beside the board. What is inside is the same
// in both, so it is one component with two ways of standing.
export function CardPanel({ as }: { as: CardView }) {
  const workspace = useWorkspace()
  const draft = useVault((state) => state.draft)
  const dirty = useVault((state) => state.dirty)
  const conflict = useVault((state) => state.conflict)
  const editCard = useVault((state) => state.editCard)
  const saveDraft = useVault((state) => state.saveDraft)
  const closeCard = useVault((state) => state.closeCard)

  // The parts this card held when it opened, and any asked for since. Kept per
  // card: a part the user empties while the card is open stays where it is
  // rather than vanishing under the pointer, and one asked for and left empty
  // is gone the next time the card opens. Set during render rather than in an
  // effect, so the first frame of a card is already its own.
  const [asked, setAsked] = useState<{ id: string; parts: ReadonlySet<Part> }>({
    id: '',
    parts: new Set()
  })
  if (draft && asked.id !== draft.id) setAsked({ id: draft.id, parts: partsIn(draft) })
  if (!draft && asked.id !== '') setAsked({ id: '', parts: new Set() })

  // Waiting on the timer while a conflict is on screen would keep firing writes
  // the user has not answered for yet.
  useEffect(() => {
    if (!dirty || conflict) return
    const timer = setTimeout(() => void saveDraft(), AUTOSAVE_MS)
    return () => clearTimeout(timer)
  }, [dirty, conflict, draft, saveDraft])

  // Escape used to be bound here. It moved to App, which is the only place that
  // can see whether the palette is sitting on top of this panel.

  if (!draft || !workspace) return null

  const had = asked.id === draft.id ? asked.parts : partsIn(draft)
  // And whatever it holds now, so a value written from outside shows up.
  const holds = partsIn(draft)
  const see = (part: Part): boolean => had.has(part) || holds.has(part)
  const reveal = (part: Part): void =>
    setAsked((was) => ({ id: was.id, parts: new Set([...was.parts, part]) }))

  // The band only for a picture that is in files/. One named and not there is
  // said in Files as missing; a band over nothing would say it a second time,
  // louder, over the one place the head is read from.
  const named = draft.broken ? null : coverImage(draft)
  const cover = named && workspace.files.includes(named) ? named : null
  const classes = ['panel']
  if (as === 'sheet') classes.push('is-sheet')
  if (cover) classes.push('has-cover')

  // A file dragged in from the desktop brings Files out, so it has somewhere
  // to land on a card that had none.
  const box = (
    <aside
      className={classes.join(' ')}
      onDragEnter={(event) => {
        if (!draft.broken && event.dataTransfer?.types.includes('Files')) reveal('files')
      }}
    >
      {cover && <CoverBand workspacePath={workspace.path} name={cover} />}
      <header className="panel-head">
        <select
          className="panel-column"
          value={columnOfCard(workspace, draft.id) ?? ''}
          onChange={(event) => useVault.getState().moveToColumn(draft.id, event.target.value)}
        >
          {workspace.columns.map((column) => (
            <option key={column.id} value={column.id}>
              {column.title}
            </option>
          ))}
        </select>
        <span className="panel-state">{dirty ? 'saving…' : 'saved'}</span>
        {!draft.broken && (
          <CoverMenu card={draft} workspace={workspace} onPick={(next) => editCard({ cover: next })} />
        )}
        <CardMenu card={draft} />
        <button
          className="panel-icon"
          title="Close (Esc)"
          aria-label="Close"
          onClick={() => void closeCard()}
        >
          <Icon name="close" />
        </button>
      </header>

      {conflict && <ConflictBanner disk={conflict.disk} mine={conflict.mine} />}

      {draft.archived && (
        <p className="panel-archived">
          Archived. It keeps its place and comes back to the column it left.
        </p>
      )}

      <div className="panel-body">
        {draft.broken ? (
          <BrokenEditor card={draft} onEdit={(body) => editCard({ body })} />
        ) : (
          <>
            <Title value={draft.title} onChange={(title) => editCard({ title })} />
            <div className="card-actions">
              <AddMenu onPick={reveal} />
              <button className="card-action" onClick={() => reveal('tags')}>
                <Icon name="tag" />
                Tags
              </button>
              <button className="card-action" onClick={() => reveal('dates')}>
                <Icon name="clock" />
                Dates
              </button>
              {/* A checklist is added outright rather than brought out empty:
                  an empty list of lists has nothing to show. */}
              <button
                className="card-action"
                title="Add a checklist"
                onClick={() =>
                  editCard({ checklists: [...draft.checklists, { name: 'Checklist', items: [] }] })
                }
              >
                <Icon name="checklist" />
                Checklist
              </button>
            </div>
            {see('tags') && (
              <Tags card={draft} workspace={workspace} onChange={(tags) => editCard({ tags })} />
            )}
            {see('dates') && <Dates card={draft} onChange={editCard} />}
            {see('priority') && (
              <Priority value={draft.priority} onChange={(priority) => editCard({ priority })} />
            )}
            <Description value={draft.body} onChange={(body) => editCard({ body })} />
            {draft.checklists.length > 0 && (
              <Checklists
                lists={draft.checklists}
                onChange={(checklists) => editCard({ checklists })}
              />
            )}
            {see('files') && (
              <Attachments
                card={draft}
                workspace={workspace}
                onEdit={editCard}
              />
            )}
            {/* Keyed by the card so the half typed text in a box belongs to the
                card it was typed on, and does not follow the panel to the next
                one when the user clicks away mid edit. */}
            {see('fields') && (
              <Fields key={draft.id} card={draft} onChange={(extra) => editCard({ extra })} />
            )}
          </>
        )}
      </div>
    </aside>
  )

  if (as === 'panel') return box

  // A press on the scrim puts the card down the way Escape does, through
  // closeCard: the last keystrokes are written first, and a conflict nobody
  // has answered keeps it open. Only the scrim itself; a press that starts in
  // the box belongs to the box.
  return (
    <div
      className="panel-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) void closeCard()
      }}
    >
      {box}
    </div>
  )
}

function columnOfCard(workspace: Workspace, cardId: string): string | undefined {
  return workspace.columns.find((column) => column.cards.includes(cardId))?.id
}

/* Menus -------------------------------------------------------------------- */

// What used to be three icons in the head: archive, keep as a template, move
// to trash. We chose to put them behind one button, with the card's file
// under a line at the bottom. The titles are the ones the icons carried.
function CardMenu({ card }: { card: Card }) {
  const { open, setOpen, box } = useMenu()
  const act = (run: () => Promise<void>): void => {
    setOpen(false)
    void run()
  }

  return (
    <div className="card-menu-anchor" ref={box}>
      <button
        className="panel-icon"
        title="Card actions"
        aria-label="Card actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name="more" />
      </button>

      {open && (
        <div className="card-menu" role="menu">
          <button
            className="card-menu-item"
            role="menuitem"
            title={
              card.archived
                ? 'Put it back on the kanban, in the column it left'
                : 'Archive: off the kanban, still here'
            }
            onClick={() => act(() => useVault.getState().setArchived(card.id, !card.archived))}
          >
            <Icon name={card.archived ? 'restore' : 'archive'} />
            {card.archived ? 'Put back' : 'Archive'}
          </button>
          {/* The other half of step 5. Without a way in from a card, templates/
              would be a folder you have to already know about, and the feature
              would be one only its author ever uses. It writes a new file and
              leaves this card exactly as it is. */}
          {!card.broken && (
            <button
              className="card-menu-item"
              role="menuitem"
              title="Keep this card's shape as a template"
              onClick={() => act(() => useVault.getState().saveAsTemplate())}
            >
              <Icon name="template" />
              Save as template
            </button>
          )}
          <button
            className="card-menu-item"
            role="menuitem"
            title="Move to trash"
            onClick={() => act(() => useVault.getState().trashCard(card.id))}
          >
            <Icon name="trash" />
            Move to trash
          </button>
          <p className="panel-file" title={card.file}>
            {card.file}
          </p>
        </div>
      )}
    </div>
  )
}

function AddMenu({ onPick }: { onPick: (part: Part) => void }) {
  const { open, setOpen, box } = useMenu()

  return (
    <div className="add-menu-anchor" ref={box}>
      <button
        className="card-action"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name="plus" />
        Add
      </button>

      {open && (
        <div className="add-menu" role="menu">
          {MORE.map((one) => (
            <button
              key={one.part}
              className="card-menu-item"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                onPick(one.part)
              }}
            >
              <Icon name={one.icon} />
              {one.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Each part is headed by its icon and its name, the way the row above names
// them, so the button and what it brought out read as the same thing.
function Head({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <h3 className="field-head">
      <Icon name={icon} />
      {children}
    </h3>
  )
}

/* Title -------------------------------------------------------------------- */

function Title({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  return (
    <textarea
      className="panel-title"
      rows={1}
      value={value}
      spellCheck={false}
      onChange={(event) => onChange(event.target.value.replace(/\n/g, ''))}
      onInput={(event) => grow(event.currentTarget)}
      ref={(node) => {
        if (node) grow(node)
      }}
    />
  )
}

// A title is one line of text that happens to wrap. Letting the box follow the
// text keeps the whole title readable without a scrollbar inside it.
function grow(node: HTMLTextAreaElement): void {
  node.style.height = 'auto'
  node.style.height = `${node.scrollHeight}px`
}

/* Tags --------------------------------------------------------------------- */

// Six colours and a tick each: six ready-made colour labels, and a card may
// wear one or more of them.
//
// The six are always all six, in the one order, whether the card wears them or
// not - the point of a colour label is that green is green in every workspace
// and sits in the same place in the list every time it is opened.
//
// Under them, and only when a card carries one, whatever tag was written by
// hand before the six existed or by something that is not this app. It can be
// taken off and it cannot be made here: the app's own answer is a colour now.
// Dropping it off the screen would be the app hiding what is in the file.
function Tags({
  card,
  workspace,
  onChange
}: {
  card: Card
  workspace: Workspace
  onChange: (tags: string[]) => void
}) {
  const nameLabel = useVault((state) => state.nameLabel)
  // Which colour is having its name typed, and null while none is.
  const [naming, setNaming] = useState<string | null>(null)

  const written = useMemo(
    () => card.tags.filter((tag) => labelKeyOf(tag) === null),
    [card.tags]
  )

  const has = (name: string): boolean =>
    card.tags.some((tag) => tag.toLowerCase() === name.toLowerCase())

  const toggle = (name: string): void => {
    onChange(
      has(name)
        ? card.tags.filter((tag) => tag.toLowerCase() !== name.toLowerCase())
        : [...card.tags, name]
    )
  }

  return (
    <section className="field">
      <Head icon="tag">Tags</Head>
      <div className="tag-picker">
        {LABEL_KEYS.map((key) => {
          const label = colourLabel(workspace.labels, key)
          const on = has(key)
          const words = labelText(label)
          return (
            <div className="tag-row" key={key}>
              {naming === key ? (
                <NameBox
                  className="tag-name-box"
                  placeholder={`Name ${labelWord(key)}`}
                  initial={label.name}
                  commitUnchanged
                  allowEmpty
                  onCommit={(given) => void nameLabel(key, given)}
                  onCancel={() => setNaming(null)}
                />
              ) : (
                <button
                  className={on ? 'tag-pick is-on' : 'tag-pick'}
                  data-label={key}
                  aria-pressed={on}
                  title={words}
                  onClick={() => toggle(key)}
                >
                  <span className="tag-mark">{on && <Icon name="check" />}</span>
                  <span className="tag-bar" style={{ background: label.color }}>
                    {label.name}
                  </span>
                </button>
              )}
              <button
                className="tag-name"
                title={label.name ? `Rename ${words}` : `Name ${labelWord(key)}`}
                aria-label={`Name ${labelWord(key)}`}
                onClick={() => setNaming(naming === key ? null : key)}
              >
                <Icon name="pencil" />
              </button>
            </div>
          )
        })}
        {written.map((tag) => {
          const label = resolveLabel(workspace, tag)
          return (
            <div className="tag-row" key={tag}>
              <button className="tag-pick is-on" onClick={() => toggle(tag)} title={label.name}>
                <span className="tag-mark">
                  <Icon name="check" />
                </span>
                <span className="tag-written">
                  <span className="tag-dot" style={{ background: label.color }} />
                  {label.name}
                </span>
              </button>
            </div>
          )
        })}
      </div>
    </section>
  )
}

/* Dates -------------------------------------------------------------------- */


function Dates({ card, onChange }: { card: Card; onChange: (patch: Partial<Card>) => void }) {
  return (
    <section className="field">
      <Head icon="clock">Dates</Head>
      <div className="field-dates">
        <DateBox label="Start" value={card.start} onChange={(start) => onChange({ start })} />
        <DateBox label="Due" value={card.due} onChange={(due) => onChange({ due })} />
      </div>
    </section>
  )
}

// A date the user wrote by hand may not be a calendar day at all ("next
// sprint", a full timestamp). The picker only claims the ones it can round
// trip; anything else stays a text box so editing it does not destroy it.
function DateBox({
  label,
  value,
  onChange
}: {
  label: string
  value: string | undefined
  onChange: (next: string | undefined) => void
}) {
  const plain = value !== undefined && value !== '' && !DAY.test(value)
  return (
    <label className="date-box">
      <span className="field-name">{label}</span>
      <input
        type={plain ? 'text' : 'date'}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value || undefined)}
      />
    </label>
  )
}

/* Attachments -------------------------------------------------------------- */

// Step 3 of v0.2. A file dropped on the panel is COPIED into the workspace's
// files/ folder and the card carries its name.
//
// Copied rather than pointed at, and we decided it that way: a workspace has
// to be something you can back up, move and open on another machine with its
// pictures still in it. A path into somebody's Downloads folder works on one
// computer and goes quiet on every other one.
//
// The card carries a bare name, never a path. The folder is fixed, so a name is
// enough, and a name that cannot hold a separator cannot point outside the
// workspace it travels in.
function Attachments({
  card,
  workspace,
  onEdit
}: {
  card: Card
  workspace: Workspace
  onEdit: (patch: Partial<Card>) => void
}) {
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)

  const here = useMemo(() => new Set(workspace.files), [workspace.files])
  const cover = coverImage(card)

  const bring = async (sources: string[]): Promise<void> => {
    if (sources.length === 0) return
    setBusy(true)
    try {
      const names = await window.api.attachFiles(workspace.path, sources)
      if (names.length > 0) onEdit({ files: [...card.files, ...names] })
    } finally {
      setBusy(false)
    }
  }

  const take = async (dropped: FileList | null): Promise<void> => {
    if (!dropped || dropped.length === 0) return
    // Electron took File.path away, so the only thing that knows where a
    // dropped file is sits on the other side of the bridge. A file with no path
    // behind it is not one this app can copy.
    await bring([...dropped].map((file) => window.api.pathForFile(file)).filter(Boolean))
  }

  // Off the card, never off the disk. The cover goes with its file, unless the
  // same name is still on the card a second time.
  const takeOff = (index: number): void => {
    const name = card.files[index]
    const files = card.files.filter((_, at) => at !== index)
    const patch: Partial<Card> = { files }
    if (name === cover && !files.includes(name)) patch.cover = undefined
    onEdit(patch)
  }

  // Newest at the top, the pick. The card's list is kept in the order the
  // files came, so newest first is that list read from its end - and each row
  // keeps its place in the file, which is what taking one off has to name.
  const rows = card.files.map((name, index) => ({ name, index })).reverse()

  return (
    <section
      className={over ? 'field attach is-over' : 'field attach'}
      onDragOver={(event) => {
        event.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault()
        setOver(false)
        void take(event.dataTransfer?.files ?? null)
      }}
    >
      <div className="attach-head">
        <Head icon="file">Files</Head>
        <button
          className="card-action attach-add"
          title="Choose files to keep with this card"
          onClick={() => void window.api.pickFiles().then(bring)}
        >
          Add
        </button>
      </div>
      {card.files.length === 0 ? (
        <p className="attach-empty">{busy ? 'Copying…' : 'Drop a file here to keep it with this card.'}</p>
      ) : (
        <ul className="attach-list">
          {rows.map(({ name, index }) => {
            // A name with nothing behind it is shown, never quietly dropped:
            // the file may be on a machine this copy of the vault has not been
            // to yet, and rewriting the card would lose the only record of it.
            const there = here.has(name)
            const picture = there && isImageName(name)
            const onCover = name === cover
            const added = workspace.added[name]
            const classes = ['attach-row']
            if (!there) classes.push('is-missing')
            if (onCover) classes.push('is-cover')
            return (
              <li className={classes.join(' ')} key={name + index}>
                <span className="attach-thumb">
                  {picture ? (
                    <img src={fileUrl(workspace.path, name)} alt="" draggable={false} />
                  ) : (
                    <span className="attach-ext">{extensionOf(name)}</span>
                  )}
                </span>
                <span className="attach-text">
                  <span className="attach-name" title={name}>
                    {fileName(name)}
                  </span>
                  <span className="attach-meta">
                    {there ? (
                      added !== undefined && addedAgo(added)
                    ) : (
                      <span className="attach-gone">missing</span>
                    )}
                    {onCover && ' · Cover'}
                  </span>
                </span>
                <button
                  className="panel-icon attach-open"
                  title={there ? 'Open it' : 'Nothing in files/ goes by this name'}
                  aria-label="Open it"
                  disabled={!there}
                  onClick={() => void window.api.openFile(workspace.path, name)}
                >
                  <Icon name="external" />
                </button>
                <FileMenu
                  name={name}
                  picture={picture}
                  onCover={onCover}
                  toggleCover={() => onEdit({ cover: onCover ? undefined : name })}
                  takeOff={() => takeOff(index)}
                />
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// What a file without a picture shows in place of one. Four letters at most,
// so a long invented extension still fits its box.
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1, dot + 5) : 'file'
}

// A file's ⋯: the cover, for a picture, and taking it off the card. Opening it
// has a button of its own beside this, as the one thing done most.
function FileMenu({
  name,
  picture,
  onCover,
  toggleCover,
  takeOff
}: {
  name: string
  picture: boolean
  onCover: boolean
  toggleCover: () => void
  takeOff: () => void
}) {
  const { open, setOpen, box } = useMenu()
  const [up, setUp] = useState(false)
  const act = (run: () => void): void => {
    setOpen(false)
    run()
  }

  return (
    <div className="card-menu-anchor" ref={box}>
      <button
        className="panel-icon attach-more"
        title="More"
        aria-label={`More for ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          // Toward the room it has: a row near the foot of the panel opens its
          // menu upward, where down would be cut off by the panel's own edge.
          const at = event.currentTarget.getBoundingClientRect()
          const room = event.currentTarget.closest('.panel-body')?.getBoundingClientRect()
          setUp(!!room && room.bottom - at.bottom < 96)
          setOpen(!open)
        }}
      >
        <Icon name="more" />
      </button>

      {open && (
        <div className={up ? 'card-menu opens-up' : 'card-menu'} role="menu">
          {picture && (
            <button
              className="card-menu-item attach-cover"
              role="menuitem"
              onClick={() => act(toggleCover)}
            >
              <Icon name="image" />
              {onCover ? 'Remove cover' : 'Make cover'}
            </button>
          )}
          <button
            className="card-menu-item attach-drop"
            role="menuitem"
            title="Take it off this card. The file stays in files/"
            onClick={() => act(takeOff)}
          >
            <Icon name="close" />
            Take off card
          </button>
        </div>
      )}
    </div>
  )
}

/* Cover -------------------------------------------------------------------- */

// The picture over an open card, whole, on a band of its own colour, the
// way a poster on black stands on its own orange. The colour comes
// from main, which is the only side that can read the picture's pixels, and
// until it answers - or when it cannot, for a format its decoder does not
// take - the band is a step up from the panel's ground.
function CoverBand({ workspacePath, name }: { workspacePath: string; name: string }) {
  const url = fileUrl(workspacePath, name)
  const [tone, setTone] = useState<{ url: string; colour: string | null } | null>(null)

  useEffect(() => {
    let live = true
    void window.api.coverColor(workspacePath, name).then((colour) => {
      if (live) setTone({ url, colour })
    })
    return () => {
      live = false
    }
  }, [workspacePath, name, url])

  // A tone worked out for the last picture is not this one's.
  const colour = tone?.url === url ? tone.colour : null
  return (
    <div className="panel-cover" style={colour ? { background: colour } : undefined}>
      <img className="panel-cover-image" src={url} alt="" draggable={false} />
    </div>
  )
}

// The button beside the card's ⋯, there while the card holds a picture or has
// one on its cover. Its menu is the card's pictures, newest first as Files
// lists them, the one on the cover ticked, and a way to take the cover off.
function CoverMenu({
  card,
  workspace,
  onPick
}: {
  card: Card
  workspace: Workspace
  onPick: (cover: string | undefined) => void
}) {
  const { open, setOpen, box } = useMenu()
  const current = coverImage(card)
  const pictures = [...new Set(card.files.filter((name) => coverImage({ cover: name }) !== null))]
  pictures.reverse()
  if (pictures.length === 0 && current === null) return null

  const here = new Set(workspace.files)
  const pick = (cover: string | undefined): void => {
    setOpen(false)
    onPick(cover)
  }

  return (
    <div className="card-menu-anchor" ref={box}>
      <button
        className="panel-icon cover-button"
        title="Cover"
        aria-label="Cover"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name="image" />
      </button>

      {open && (
        <div className="card-menu cover-menu" role="menu">
          {pictures.map((name) => (
            <button
              key={name}
              className="card-menu-item cover-choice"
              role="menuitemradio"
              aria-checked={name === current}
              title={here.has(name) ? name : 'Nothing in files/ goes by this name'}
              disabled={!here.has(name)}
              onClick={() => pick(name)}
            >
              <span className="board-menu-tick">{name === current && <Icon name="check" />}</span>
              <img
                className="cover-thumb"
                src={fileUrl(workspace.path, name)}
                alt=""
                draggable={false}
              />
              <span className="cover-name">{fileName(name)}</span>
            </button>
          ))}
          {current !== null && (
            <button
              className="card-menu-item cover-remove"
              role="menuitem"
              onClick={() => pick(undefined)}
            >
              <Icon name="close" />
              Remove cover
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/* Custom fields ------------------------------------------------------------ */

// The format keeps a field the app has never heard of. This is where the card
// shows it and lets it be edited, which is the whole of step 2.
//
// The rule the section is built on: a value box holds what sits to the right of
// `key:` in the file, and what is typed there is read the way the file reads it.
// So `4500` is a number, `"4500"` is text, and an empty box is an empty line,
// which is null. The alternative - treat every box as text - was measured and
// thrown out: it turns `budget: 4500` into `budget: "4500"` on the first edit
// and says nothing, and the reader on the other end of this format is usually
// an agent working from instructions, which cannot notice.
function Fields({
  card,
  onChange
}: {
  card: Card
  onChange: (fields: Record<string, unknown>) => void
}) {
  // Text mid edit, by field name. A value that does not parse yet lives only
  // here and is never written: half a quoted string is not an edit, and saving
  // it would be the app throwing away what was there.
  const [typing, setTyping] = useState<Record<string, string>>({})
  const [naming, setNaming] = useState<Record<string, string>>({})
  const [adding, setAdding] = useState('')

  const entries = Object.entries(card.extra)
  const others = (mine: string): string[] => entries.map(([key]) => key).filter((key) => key !== mine)

  const type = (key: string, text: string): void => {
    setTyping((was) => ({ ...was, [key]: text }))
    const read = readFieldText(text)
    if (read.ok) onChange(setField(card.extra, key, read.value))
  }

  // Only a box that parses hands control back to the file. One that does not
  // keeps its text, and its complaint, on screen.
  const settle = (key: string): void => {
    setTyping((was) => {
      if (was[key] === undefined || !readFieldText(was[key]).ok) return was
      const next = { ...was }
      delete next[key]
      return next
    })
  }

  // Renaming waits for Enter or for the box to be left. Per keystroke it would
  // write a file full of half typed names, and the reader of those files is not
  // always watching the screen.
  const rename = (key: string): void => {
    const wanted = (naming[key] ?? key).trim()
    if (wanted === key || keyProblem(wanted, others(key))) return
    setNaming((was) => {
      const next = { ...was }
      delete next[key]
      return next
    })
    onChange(renameField(card.extra, key, wanted))
  }

  const addProblem = adding.trim() ? keyProblem(adding.trim(), others('')) : null
  const add = (): void => {
    const name = adding.trim()
    if (!name || keyProblem(name, others(''))) return
    setAdding('')
    // Born empty, which on this format is null, and the value box right next
    // to it is where it stops being empty.
    onChange(setField(card.extra, name, null))
  }

  return (
    <section className="field">
      <Head icon="fields">Custom fields</Head>
      <p className="custom-hint">
        Kept as written, and read the way the file reads them: 4500 is a number, &quot;4500&quot;
        is text, an empty box is nothing at all.
      </p>

      <div className="custom-fields">
        {entries.map(([key, value]) => {
          const shownName = naming[key] ?? key
          const nameTrouble =
            shownName.trim() === key ? null : keyProblem(shownName.trim(), others(key))
          const shownValue = typing[key] ?? fieldText(value)
          const read = readFieldText(shownValue)
          const block = isBlock(value) || shownValue.includes('\n')

          return (
            <div className="custom-row" key={key}>
              <input
                className={nameTrouble ? 'custom-key is-bad' : 'custom-key'}
                value={shownName}
                spellCheck={false}
                onChange={(event) => setNaming((was) => ({ ...was, [key]: event.target.value }))}
                onBlur={() => rename(key)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                }}
              />
              {block ? (
                <textarea
                  className={read.ok ? 'custom-value' : 'custom-value is-bad'}
                  value={shownValue}
                  spellCheck={false}
                  rows={Math.min(6, shownValue.split('\n').length + 1)}
                  onChange={(event) => type(key, event.target.value)}
                  onBlur={() => settle(key)}
                />
              ) : (
                <input
                  className={read.ok ? 'custom-value' : 'custom-value is-bad'}
                  value={shownValue}
                  spellCheck={false}
                  onChange={(event) => type(key, event.target.value)}
                  onBlur={() => settle(key)}
                />
              )}
              <span className="custom-kind">{kindOf(value)}</span>
              <button
                className="custom-drop"
                title={`Remove ${key} from this card`}
                onClick={() => onChange(dropField(card.extra, key))}
              >
                <Icon name="close" />
              </button>
              {(nameTrouble || !read.ok) && (
                <p className="custom-why">{nameTrouble ?? (read.ok ? '' : read.why)}</p>
              )}
            </div>
          )
        })}

        <div className="custom-row custom-new">
          <input
            className={addProblem ? 'custom-key is-bad' : 'custom-key'}
            value={adding}
            placeholder="+ field"
            spellCheck={false}
            onChange={(event) => setAdding(event.target.value)}
            onBlur={add}
            onKeyDown={(event) => {
              if (event.key === 'Enter') add()
            }}
          />
          {addProblem && <p className="custom-why">{addProblem}</p>}
        </div>
      </div>
    </section>
  )
}

/* Priority ----------------------------------------------------------------- */

// A field the app has owned and kept since v0.1 and never once showed. Step 4
// filters by it, and a filter over something the user can neither see nor set
// is a filter over nothing, so this is the control that was missing rather than
// a new feature.

// The same rule the date box follows: what a card was written with by hand is
// not necessarily one of ours, and picking it up must not destroy it. A value
// the app does not know joins the list rather than being replaced by the
// nearest one.
function Priority({
  value,
  onChange
}: {
  value: string | undefined
  onChange: (next: string | undefined) => void
}) {
  const offered: readonly string[] = PRIORITIES
  const known = value && !offered.includes(value) ? [...offered, value] : offered
  return (
    <section className="field">
      <Head icon="flag">Priority</Head>
      <select
        className="priority-box"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value || undefined)}
      >
        <option value="">none</option>
        {known.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </section>
  )
}

/* Description -------------------------------------------------------------- */

function Description({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const [editing, setEditing] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing) area.current?.focus()
  }, [editing])

  const html = useMemo(() => renderMarkdown(value), [value])

  return (
    <section className="field">
      <Head icon="lines">Description</Head>
      {editing ? (
        <textarea
          ref={area}
          className="panel-body-text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => setEditing(false)}
        />
      ) : (
        <div
          className={value.trim() ? 'markdown' : 'markdown is-empty'}
          // A link is followed, not edited. Anywhere else in the box opens the
          // editor, which is how a description is written in the first place,
          // so the two are told apart by where the press landed. Nothing here
          // opens anything: the click navigates, and main's guard turns that
          // into a browser window.
          onClick={(event) => {
            if ((event.target as HTMLElement).closest('a')) return
            setEditing(true)
          }}
          dangerouslySetInnerHTML={{
            __html: value.trim() ? html : '<p>Add a more detailed description…</p>'
          }}
        />
      )}
    </section>
  )
}

/* Broken card -------------------------------------------------------------- */

// Decision 4 of the format: a card whose frontmatter did not parse is never
// rewritten by the app. It is handed back exactly as it sits on disk, and the
// only thing offered is a plain text box to fix it in. Where the file is lives
// in the card's menu, as it does for every card.
function BrokenEditor({ card, onEdit }: { card: Card; onEdit: (text: string) => void }) {
  return (
    <section className="field">
      <p className="panel-broken">
        This file&rsquo;s frontmatter did not parse, so it is shown as written. Fix the YAML and
        it becomes a card again.
      </p>
      <p className="panel-broken-why">{card.broken}</p>
      <textarea
        className="panel-raw"
        value={card.body}
        spellCheck={false}
        onChange={(event) => onEdit(event.target.value)}
      />
    </section>
  )
}

/* Conflict ----------------------------------------------------------------- */

// Decision 5: the app never writes over an outside edit it did not see. Both
// versions go on screen and the user picks; nothing is written until they do.
function ConflictBanner({ disk, mine }: { disk: string; mine: string }) {
  const resolve = useVault((state) => state.resolveConflict)
  const [shown, setShown] = useState<'disk' | 'mine'>('disk')

  return (
    <div className="conflict">
      <p className="conflict-line">
        This file changed outside Bothy, so nothing was saved over it.
      </p>
      <div className="conflict-tabs">
        <button
          className={shown === 'disk' ? 'is-on' : undefined}
          onClick={() => setShown('disk')}
        >
          On disk
        </button>
        <button
          className={shown === 'mine' ? 'is-on' : undefined}
          onClick={() => setShown('mine')}
        >
          Yours
        </button>
      </div>
      <pre className="conflict-text">{shown === 'disk' ? disk : mine}</pre>
      <div className="conflict-actions">
        <button onClick={() => void resolve('theirs')}>Keep the file</button>
        <button onClick={() => void resolve('mine')}>Keep mine</button>
      </div>
    </div>
  )
}
