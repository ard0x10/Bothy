import { useEffect, useState } from 'react'
import { COLOR_TOKENS, type ColorToken, type Colors } from '../../../shared/colors'
import { APP_KEYS, acceleratorFromEvent, acceleratorText, appKeyText, CAPTURE_DEFAULT } from '../../../shared/keys'
import { CANVAS_KEYS, keyText } from '../../../shared/viewport'
import { fileName } from '../../../shared/paths'
import type { SettingsNow } from '../../../shared/settings'
import { applyColors, currentColors } from '../theme'
import type { Base, ThemeChoice, Themes } from '../../../shared/themes'
import type { CardView } from '../../../shared/cardview'
import type { WorkspaceOpens } from '../../../shared/opening'
import type { AiSettings, ChangeNotices } from '../../../shared/ai'
import { Icon } from './Icon'
import { NameBox } from './NameBox'
import { useMenu } from './useMenu'

// The settings window, D3: a window of its own, opened by a button.
//
// What it takes from a settings page is the ROW GRAMMAR -
// a label, a sentence under it saying what it does, and the control on the
// right - and not its contents. Two things were deliberately left behind:
//
//   - the General page. Its rows are an account, a licence, updates and
//     plugins, and this app has none of them. Three honest sections beat six
//     with three of them empty.
//   - the "Search settings…" box, which exists because there are twenty
//     sections to search. Over four it would be the single clearest sign that
//     a shape was copied rather than chosen.
//
// The three sections are not invented either. Each is something the panel was
// already carrying: the theme switch and the colours sheet came out of it, and
// the vault list is the same list D2's foot menu reads.

// AI joined them in v0.4 step 9, and its name was already given: the server
// and the guide both tell a person to look "in Settings, under AI".
const SECTIONS = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'keys', label: 'Shortcuts' },
  { id: 'vault', label: 'Vault' },
  { id: 'ai', label: 'AI' }
] as const

type Section = (typeof SECTIONS)[number]['id']

// Eleven rows, because we picked eleven tokens. Each says what it paints in
// the app's own words rather than in the variable's name - "Cards" is something
// you can point at on screen, --bg-card is something you have to know the
// stylesheet to place. Moved here whole from the sheet this window replaces.
const COLOR_ROWS: { token: ColorToken; label: string; hint: string }[] = [
  { token: 'bg-app', label: 'Window', hint: 'Behind everything' },
  { token: 'bg-column', label: 'Columns', hint: 'The strips a card sits in' },
  { token: 'bg-card', label: 'Cards', hint: 'And the sheets that open over them' },
  { token: 'bg-card-hover', label: 'Card under the pointer', hint: 'Slightly apart from the rest' },
  { token: 'text', label: 'Text', hint: 'Titles, and anything being read' },
  { token: 'text-dim', label: 'Quiet text', hint: 'Counts, dates, hints - the second layer' },
  { token: 'border', label: 'Lines', hint: 'Every edge and divider' },
  { token: 'accent', label: 'Accent', hint: 'What is selected, chosen or due today' },
  { token: 'on-accent', label: 'Text on the accent', hint: 'Must stay readable against it' },
  { token: 'late', label: 'Overdue', hint: 'A date that has gone past' },
  { token: 'soon', label: 'Due soon', hint: 'A date coming up' }
]

// The three at the top of the theme list. The files in the themes folder come
// under them.
const BUILT_IN: { id: ThemeChoice; label: string }[] = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'custom', label: 'Custom' }
]

const BASES: { id: Base; label: string }[] = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' }
]

// Where a card opens. Both stay, and the choice lives
// here; the middle is what a fresh install opens with.
const CARD_VIEWS: { id: CardView; label: string; hint: string }[] = [
  { id: 'sheet', label: 'Centre', hint: 'Over the window, with the rest dimmed behind it' },
  { id: 'panel', label: 'Side panel', hint: 'Down the right side, with the kanban still in reach' }
]

// What a workspace opens on when you go into it.
const OPENS: { id: WorkspaceOpens; label: string; hint: string }[] = [
  { id: 'kanban', label: 'Kanban', hint: 'Every workspace opens on its kanban' },
  { id: 'last', label: 'Last tab', hint: 'Each workspace opens where you left it' }
]

// A colour input reports continuously while the pointer moves inside the
// picker, so the write waits: the last set to arrive within the pause is the
// one that lands, which is also the only one the user meant. The same number
// the store used when this lived in the panel.
const SAVE_PAUSE = 250

export function Settings() {
  const [section, setSection] = useState<Section>('appearance')
  const [now, setNow] = useState<SettingsNow | null>(null)

  // Asked for as this mounts, rather than handed over when the window was
  // built. Measured: main pushing the moment the window object exists
  // reaches a renderer that has not subscribed yet, and the first window of a
  // run hears nothing at all and then never asks again.
  useEffect(() => {
    void window.api.settingsNow().then(setNow)
  }, [])

  // Which vault is open can change while this window is on screen - by the
  // road below, or by someone using the panel's own foot menu. Pushed from the
  // one place a vault becomes the current one.
  useEffect(
    () =>
      window.api.onVault((vault) =>
        setNow((was) => (was ? { ...was, vault: vault.path, vaults: vault.vaults } : was))
      ),
    []
  )

  // The colours this window wears, from main, whichever theme they came from.
  useEffect(() => window.api.onColors((colors) => applyColors(colors)), [])

  // The theme rows, pushed whenever main stores a change or a file in the
  // themes folder moves. What comes back is what was STORED, so a value the
  // guard refused corrects the control instead of leaving it showing a choice
  // nothing is painted in.
  useEffect(
    () => window.api.onThemes((themes) => setNow((was) => (was ? { ...was, themes } : was))),
    []
  )

  if (!now) return <div className="settings-boot" />

  return (
    <div className="settings">
      <nav className="settings-nav">
        <p className="settings-nav-head">Bothy</p>
        {SECTIONS.map((one) => (
          <button
            key={one.id}
            className={one.id === section ? 'settings-tab is-on' : 'settings-tab'}
            aria-current={one.id === section}
            onClick={() => setSection(one.id)}
          >
            {one.label}
          </button>
        ))}
      </nav>

      <div className="settings-body">
        <h1 className="settings-title">{SECTIONS.find((one) => one.id === section)?.label}</h1>
        {section === 'appearance' && <Appearance now={now} setNow={setNow} />}
        {section === 'keys' && <Shortcuts now={now} setNow={setNow} />}
        {section === 'vault' && <VaultSection now={now} setNow={setNow} />}
        {section === 'ai' && <AiSection />}
      </div>
    </div>
  )
}

type Part = {
  now: SettingsNow
  setNow: (patch: (was: SettingsNow | null) => SettingsNow | null) => void
}

// One row: what it is, what it does, and the control. The sentence is the part
// worth defending - every setting in this app has a reason, and a reason that
// only exists in a comment is a reason the person changing it never gets.
function Row(props: { name: string; why: string; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-row-say">
        <p className="settings-row-name">{props.name}</p>
        <p className="settings-row-why">{props.why}</p>
      </div>
      <div className="settings-row-do">{props.children}</div>
    </div>
  )
}

/* --- Appearance ----------------------------------------------------------- */

function Appearance({ now, setNow }: Part) {
  const themes = now.themes

  // What each token is painted with right now. Read from this window rather
  // than kept in a table: a hard-coded copy of the palette would be a second
  // place the colours live, and it would be wrong the moment the base changed
  // underneath it. The base moves through the media query, so that is listened
  // to as well.
  const [themed, setThemed] = useState<Record<string, string>>(() => currentColors())
  useEffect(() => setThemed(currentColors()), [themes.colors, themes.theme, themes.customBase])
  useEffect(() => {
    const light = matchMedia('(prefers-color-scheme: light)')
    const read = (): void => setThemed(currentColors())
    light.addEventListener('change', read)
    return () => light.removeEventListener('change', read)
  }, [])

  const answer = (next: Themes): void => setNow((was) => (was ? { ...was, themes: next } : was))

  // The write waits; the paint does not. Applying here as well as on the way
  // back from main is what makes dragging inside the picker feel like paint
  // rather than like a form.
  const [saving, setSaving] = useState<ReturnType<typeof setTimeout> | undefined>()
  const paint = (colors: Colors): void => {
    applyColors(colors)
    setNow((was) => (was ? { ...was, themes: { ...was.themes, colors } } : was))
    clearTimeout(saving)
    setSaving(setTimeout(() => void window.api.setColors(colors), SAVE_PAUSE))
  }

  const pickTheme = (theme: ThemeChoice): void => {
    setNow((was) => (was ? { ...was, themes: { ...was.themes, theme } } : was))
    void window.api.setTheme(theme).then(answer)
  }

  const pickBase = (customBase: Base): void => {
    setNow((was) => (was ? { ...was, themes: { ...was.themes, customBase } } : was))
    void window.api.setCustomBase(customBase).then(answer)
  }

  const [folderFailed, setFolderFailed] = useState(false)
  const openFolder = (): void => {
    void window.api.openThemesFolder().then((opened) => setFolderFailed(!opened))
  }

  // Save as theme: a name, then the file. What is written is the colours on
  // screen, all eleven, so the file looks the same wherever it is opened.
  const [naming, setNaming] = useState(false)
  const [saved, setSaved] = useState<{ ok: boolean; text: string } | null>(null)
  const save = (name: string): void => {
    void window.api.saveTheme(name, currentColors()).then((result) =>
      setSaved(
        'file' in result
          ? { ok: true, text: `Saved as ${result.file} in the themes folder.` }
          : { ok: false, text: result.problem }
      )
    )
  }

  // Written through main and answered with what was kept, so the switch ends
  // on the stored value rather than on the click. The window that owns the
  // vault hears it on the same push.
  const setCardView = (cardView: CardView): void => {
    setNow((was) => (was ? { ...was, cardView } : was))
    void window.api
      .setCardView(cardView)
      .then((held) => setNow((was) => (was ? { ...was, cardView: held } : was)))
  }

  const custom = themes.theme === 'custom'
  const changed = Object.keys(themes.colors).length
  const chosenFile = themes.files.find((file) => file.file === themes.theme)

  return (
    <>
      <Row name="Theme" why="Dark, light, your own colours, or a theme file from the themes folder.">
        <ThemePicker themes={themes} onPick={pickTheme} />
        <button
          className="theme-folder"
          title="Open the themes folder"
          aria-label="Open the themes folder"
          onClick={openFolder}
        >
          <Icon name="folder" />
        </button>
      </Row>

      {/* Said on the row: the list still says the file's name, and the window
          is dark, and without this a person has two answers and no reason. */}
      {themes.missing && (
        <p className="settings-warn theme-missing">
          {chosenFile?.problem
            ? `${chosenFile.name} cannot be used: ${chosenFile.problem} Dark is showing until the file is fixed.`
            : `${themes.theme} is not in the themes folder. Dark is showing until it is back.`}
        </p>
      )}
      {folderFailed && (
        <p className="settings-warn">The themes folder could not be opened: {themes.folder}</p>
      )}

      <Row name="Card details" why="Where a card opens when you click it.">
        <div className="settings-choices" role="group" aria-label="Card details">
          {CARD_VIEWS.map((entry) => (
            <button
              key={entry.id}
              className={entry.id === now.cardView ? 'view-choice is-on' : 'view-choice'}
              aria-pressed={entry.id === now.cardView}
              title={entry.hint}
              onClick={() => setCardView(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </Row>

      {custom && (
        <>
          <Row
            name="Colours"
            why="Your own colours over the base below. A colour you have not changed follows the base."
          >
            <span className="settings-note">
              {changed === 0 ? 'Following the base' : `${changed} of ${COLOR_TOKENS.length} changed`}
            </span>
            <button
              className="settings-act theme-save-open"
              title="Write these colours to a file in the themes folder"
              onClick={() => {
                setSaved(null)
                setNaming(true)
              }}
            >
              Save as theme…
            </button>
            <button
              className="colors-reset"
              title="Put every colour back to the base"
              disabled={changed === 0}
              onClick={() => paint({})}
            >
              Reset all
            </button>
          </Row>

          {naming && (
            <div className="theme-save">
              <NameBox
                className="theme-save-name"
                placeholder="Name the theme and press Enter"
                onCommit={save}
                onCancel={() => setNaming(false)}
              />
            </div>
          )}
          {saved && (
            <p className={saved.ok ? 'settings-note theme-saved' : 'settings-warn theme-saved'}>
              {saved.text}
            </p>
          )}

          <Row
            name="Base"
            why="What is underneath: the shadows, the scrollbars, and every colour you have not changed."
          >
            <div className="settings-choices" role="group" aria-label="Base">
              {BASES.map((entry) => (
                <button
                  key={entry.id}
                  className={entry.id === themes.customBase ? 'base-choice is-on' : 'base-choice'}
                  aria-pressed={entry.id === themes.customBase}
                  onClick={() => pickBase(entry.id)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </Row>

          <ul className="colors-list">
            {COLOR_ROWS.map((row) => {
              const set = themes.colors[row.token]
              const value = set ?? themed[row.token] ?? '#000000'
              return (
                <li key={row.token} className={set ? 'colors-row is-set' : 'colors-row'}>
                  <input
                    className="colors-swatch"
                    type="color"
                    value={value}
                    aria-label={row.label}
                    onChange={(event) => paint({ ...themes.colors, [row.token]: event.target.value })}
                  />
                  <span className="colors-name">
                    {row.label}
                    <span className="colors-hint">{row.hint}</span>
                  </span>
                  <span className="colors-value">{value}</span>
                  <button
                    className="colors-act"
                    title="Back to the base's colour"
                    disabled={!set}
                    onClick={() => {
                      // Dropped rather than written with the value it has. Writing
                      // the current value back would look identical and be a
                      // different thing: it would freeze that token against the
                      // next base change, with nothing to undo it.
                      const colors = { ...themes.colors }
                      delete colors[row.token]
                      paint(colors)
                    }}
                  >
                    Reset
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </>
  )
}

// The theme list: a button that says the theme on, and a menu of the three
// built in and then the files. Drawn by the app rather than as a native select,
// whose list is drawn by the desktop and would not wear the theme it offers.
function ThemePicker({ themes, onPick }: { themes: Themes; onPick: (theme: ThemeChoice) => void }) {
  const { open, setOpen, box } = useMenu()
  const pick = (theme: ThemeChoice): void => {
    setOpen(false)
    onPick(theme)
  }
  const shown =
    BUILT_IN.find((entry) => entry.id === themes.theme)?.label ??
    themes.files.find((file) => file.file === themes.theme)?.name ??
    themes.theme

  return (
    <div className="theme-picker" ref={box}>
      <button
        className="theme-select"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Theme"
        onClick={() => setOpen(!open)}
      >
        <span className="theme-select-name">{shown}</span>
        <Icon name="chevron-down" />
      </button>
      {open && (
        <div className="theme-menu" role="menu">
          {BUILT_IN.map((entry) => (
            <ThemeOption
              key={entry.id}
              name={entry.label}
              on={entry.id === themes.theme}
              onPick={() => pick(entry.id)}
            />
          ))}
          {themes.files.length > 0 && <div className="theme-menu-line" role="separator" />}
          {themes.files.map((file) => (
            <ThemeOption
              key={file.file}
              name={file.name}
              on={file.file === themes.theme}
              // A file that does not read stays in the list, greyed, saying why.
              problem={file.problem}
              title={file.problem ?? (file.author ? `${file.file}, by ${file.author}` : file.file)}
              onPick={() => pick(file.file)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ThemeOption(props: {
  name: string
  on: boolean
  problem?: string
  title?: string
  onPick: () => void
}) {
  return (
    <button
      className="theme-option"
      role="menuitemradio"
      aria-checked={props.on}
      disabled={props.problem !== undefined}
      title={props.title}
      onClick={props.onPick}
    >
      <span className="theme-option-tick">{props.on ? <Icon name="check" /> : null}</span>
      <span className="theme-option-name">{props.name}</span>
    </button>
  )
}

/* --- Shortcuts ------------------------------------------------------------ */

function Shortcuts({ now, setNow }: Part) {
  const [recording, setRecording] = useState(false)
  // The combination the desktop would not give us, kept so the row can name it.
  // Without this the refusal is invisible - the keys simply do not change, and
  // a control that ignores you is indistinguishable from one that is broken.
  const [refused, setRefused] = useState<string | null>(null)

  const put = async (accelerator: string): Promise<void> => {
    const held = await window.api.setCaptureKey(accelerator)
    setNow((was) => (was ? { ...was, capture: held } : was))
    setRefused(held.accelerator === accelerator ? null : accelerator)
  }

  useEffect(() => {
    if (!recording) return
    const onKey = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        setRecording(false)
        return
      }
      // Null while only modifiers are down, which is every press on the way to
      // a real combination. Waiting is the right answer to it, not refusing.
      const next = acceleratorFromEvent(event)
      if (!next) return
      setRecording(false)
      void put(next)
    }
    // Capturing, so a key never reaches whatever else is on this page while it
    // is being recorded.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording])

  const shown = acceleratorText(now.capture.accelerator, window.api.platform)

  return (
    <>
      <Row
        name="Quick capture"
        why="Opens the capture box from anywhere, even when Bothy is behind another window."
      >
        <button
          className={recording ? 'settings-record is-recording' : 'settings-record'}
          onClick={() => {
            setRefused(null)
            setRecording(!recording)
          }}
        >
          {recording ? 'Press a combination…' : shown}
        </button>
        <button
          className="settings-act"
          disabled={now.capture.accelerator === CAPTURE_DEFAULT}
          onClick={() => void put(CAPTURE_DEFAULT)}
        >
          Reset
        </button>
      </Row>

      {/* Said on the row rather than in a line at the bottom: this is the one
          setting in the app that another program can veto, and the person
          reading it is looking at the row when they wonder why nothing
          happened. */}
      {refused && (
        <p className="settings-warn">
          {acceleratorText(refused, window.api.platform)} is taken by something else. Still on{' '}
          {shown}.
        </p>
      )}
      {!now.capture.ok && (
        <p className="settings-warn">
          Nothing is holding {shown} right now, so quick capture is off. Try another combination.
        </p>
      )}

      {/* The rest are this window's own keys, and they are listed rather than
          settable - which is a scope line rather than a shrug. A global key can
          be vetoed by the desktop and so it has to be movable; these cannot
          collide with anything outside the app, and the sheet behind `?` is
          where a person looks for them. Both lists come out of the same tables
          the handlers match through, so neither can say a key nothing listens
          for. */}
      <p className="settings-group">Everywhere in Bothy</p>
      <dl className="settings-keys">
        {APP_KEYS.map((key) => (
          <div key={key.action} className="settings-key">
            <dt>{key.label}</dt>
            <dd>{appKeyText(key)}</dd>
          </div>
        ))}
      </dl>

      <p className="settings-group">On the canvas</p>
      <dl className="settings-keys">
        {CANVAS_KEYS.map((key) => (
          <div key={key.action} className="settings-key">
            <dt>{key.label}</dt>
            <dd>{keyText(key)}</dd>
          </div>
        ))}
      </dl>
    </>
  )
}

/* --- Vault ---------------------------------------------------------------- */

function VaultSection({ now, setNow }: Part) {
  // Nothing here opens a folder. It asks the window that owns the vault to do
  // it, which is the capture box's argument about cards applied to folders: one
  // road in, or the two roads disagree about which folder is open.
  const ask = (path: string | null): void => void window.api.askVault(path)

  // Written through main and answered with what was kept, the way Card details is.
  const setOpens = (workspaceOpens: WorkspaceOpens): void => {
    setNow((was) => (was ? { ...was, workspaceOpens } : was))
    void window.api
      .setWorkspaceOpens(workspaceOpens)
      .then((held) => setNow((was) => (was ? { ...was, workspaceOpens: held } : was)))
  }

  return (
    <>
      <Row name="Vault folder" why="Everything you make lives here. Nothing leaves it.">
        <span className="settings-path" title={now.vault ?? undefined}>
          {now.vault ?? 'No vault is open'}
        </span>
      </Row>

      <Row
        name="Open another"
        why="Points Bothy at a different folder. The one you leave is kept on the list below."
      >
        <button className="settings-act settings-other" onClick={() => ask(null)}>
          Choose a folder…
        </button>
      </Row>

      <Row name="Opening a workspace" why="What shows when you go into a workspace.">
        <div className="settings-choices" role="group" aria-label="Opening a workspace">
          {OPENS.map((entry) => (
            <button
              key={entry.id}
              className={entry.id === now.workspaceOpens ? 'opens-choice is-on' : 'opens-choice'}
              aria-pressed={entry.id === now.workspaceOpens}
              title={entry.hint}
              onClick={() => setOpens(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </Row>

      <p className="settings-group">Folders this app knows</p>
      <ul className="settings-vaults">
        {now.vaults.map((path) => (
          <li key={path}>
            <button
              className="settings-vault"
              role="menuitemradio"
              aria-checked={path === now.vault}
              title={path}
              onClick={() => ask(path)}
            >
              <span className="settings-vault-tick">
                {path === now.vault ? <Icon name="check" /> : null}
              </span>
              <span className="settings-vault-name">{fileName(path)}</span>
              <span className="settings-vault-path">{path}</span>
            </button>
          </li>
        ))}
      </ul>
      {/* A folder that will not open is the ordinary case rather than a failure
          to hide - a drive that is not plugged in, a folder that was moved - so
          the row stays where it is and the window that tried says so. */}
    </>
  )
}

/* --- AI, v0.4 step 9 ------------------------------------------------------ */

// The two values.
const NOTICES: { id: ChangeNotices; label: string; hint: string }[] = [
  { id: 'short', label: 'Short notice', hint: 'A line for a few seconds, then it goes' },
  { id: 'none', label: 'Nothing', hint: 'The change shows, and nothing says so' }
]

function AiSection() {
  const [ai, setAi] = useState<AiSettings | null>(null)

  // Asked for here rather than inside settings:now: this is the one page that
  // walks every known vault's folders, and the other three should not wait on
  // it. A vault opened while the page is up is one more list of workspaces.
  useEffect(() => {
    void window.api.aiSettingsNow().then(setAi)
    return window.api.onVault(() => void window.api.aiSettingsNow().then(setAi))
  }, [])

  if (!ai) return null

  const setNotices = (value: ChangeNotices): void => {
    void window.api
      .setChangeNotices(value)
      .then((held) => setAi((was) => (was ? { ...was, notices: held } : was)))
  }

  return (
    <>
      <Row
        name="AI access"
        why="Agents you connect can read, change and delete cards and the canvas in the workspaces ticked below. What they delete goes to the trash."
      >
        <div className="settings-choices" role="group" aria-label="AI access">
          {[false, true].map((on) => (
            <button
              key={String(on)}
              className={on === ai.on ? 'ai-choice is-on' : 'ai-choice'}
              aria-pressed={on === ai.on}
              onClick={() => void window.api.setAiOn(on).then(setAi)}
            >
              {on ? 'On' : 'Off'}
            </button>
          ))}
        </div>
      </Row>

      <p className="settings-group">Workspaces an agent may use</p>
      {/* With the switch off the choices stay where they are, faded,
          and cannot be changed. Main refuses a change then as well. */}
      <div className={ai.on ? 'settings-ai' : 'settings-ai is-locked'} aria-disabled={!ai.on}>
        {ai.vaults.length === 0 && <p className="settings-note">No vault has been opened yet.</p>}
        {ai.vaults.map((vault) => (
          <section key={vault.path} className="settings-ai-vault">
            <p className="settings-ai-vault-head">
              <span className="settings-vault-name">{fileName(vault.path)}</span>
              <span className="settings-vault-path" title={vault.path}>
                {vault.path}
              </span>
            </p>
            {!vault.readable ? (
              <p className="settings-note">
                This folder cannot be read right now. What was chosen in it is kept.
              </p>
            ) : vault.workspaces.length === 0 ? (
              <p className="settings-note">There are no workspaces in this folder.</p>
            ) : (
              <ul className="settings-ai-workspaces">
                {vault.workspaces.map((one) => (
                  <li key={one.folder}>
                    <label className="settings-ai-workspace">
                      <input
                        type="checkbox"
                        checked={one.chosen}
                        disabled={!ai.on}
                        onChange={(event) =>
                          void window.api
                            .setAiWorkspace(vault.path, one.folder, event.target.checked)
                            .then(setAi)
                        }
                      />
                      <span>{one.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      {/* Not tied to the switch: it covers changes made outside Bothy
          too, and a text editor can make one with the switch off. */}
      <Row
        name="Notices"
        why="The line that says what an agent changed, or that something changed outside Bothy."
      >
        <div className="settings-choices" role="group" aria-label="Notices">
          {NOTICES.map((entry) => (
            <button
              key={entry.id}
              className={entry.id === ai.notices ? 'notice-choice is-on' : 'notice-choice'}
              aria-pressed={entry.id === ai.notices}
              title={entry.hint}
              onClick={() => setNotices(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </Row>

      <p className="settings-group">Connecting an agent</p>
      <Row name="Server settings" why="Paste this into your AI client's server settings.">
        <CopyButton text={ai.connect.json} />
      </Row>
      <pre className="settings-code">{ai.connect.json}</pre>
      <Row name="From a terminal" why="The same server as one command, for a client started from a terminal.">
        <CopyButton text={ai.connect.command} />
      </Row>
      <pre className="settings-code">{ai.connect.command}</pre>
      {!ai.connect.built && (
        <p className="settings-warn">The server file is not there yet: {ai.connect.server}</p>
      )}
    </>
  )
}

// Says it copied for a moment, so a press that worked does not look like one
// that went nowhere.
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <button
      className="settings-act settings-copy"
      onClick={() => void window.api.copyText(text).then(() => setCopied(true))}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}
