import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, nativeTheme, shell } from 'electron'
import { watch, type FSWatcher } from 'chokidar'
import { cleanColors, type Colors } from '../shared/colors'
import { IPC } from '../shared/ipc'
import {
  isThemeFileName,
  listingName,
  readBase,
  readThemeChoice,
  readThemeFile,
  themeFileStem,
  themeFileText,
  THEME_EXT,
  THEMES_FOLDER,
  type Base,
  type SaveThemeResult,
  type ThemeChoice,
  type ThemeFile,
  type ThemeListing,
  type Themes
} from '../shared/themes'
import { readState, writeState } from './state'

// The theme folder sits beside state.json rather than in a vault or beside the
// program: a theme is how this app looks on this machine, and the program's own
// folder is not somewhere every install can write.
export function themesFolder(): string {
  return join(app.getPath('userData'), THEMES_FOLDER)
}

// The frame's ground before the page paints, one per base.
const GROUND: Record<Base, string> = { dark: '#16161a', light: '#f2f2f5' }

let themes: Themes = {
  theme: 'dark',
  customBase: 'dark',
  colors: {},
  files: [],
  missing: false,
  folder: ''
}
let usable = new Map<string, ThemeFile>()
let worn: Colors = {}
let base: Base = 'dark'

// The colours every window wears right now, whichever theme they came from.
// A window is built with these as a launch argument, so its first frame is
// already in them.
export function wornColors(): Colors {
  return worn
}

export function groundColor(): string {
  return worn['bg-app'] ?? GROUND[base]
}

export function themesNow(): Themes {
  return themes
}

async function readFolder(): Promise<{ files: ThemeListing[]; usable: Map<string, ThemeFile> }> {
  const folder = themesFolder()
  let names: string[] = []
  try {
    names = (await readdir(folder)).filter(isThemeFileName)
  } catch {
    // No folder yet is no themes yet.
  }
  const files: ThemeListing[] = []
  const found = new Map<string, ThemeFile>()
  for (const file of names) {
    let text: string
    try {
      text = await readFile(join(folder, file), 'utf8')
    } catch {
      files.push({ file, name: listingName(file), problem: 'The file could not be read.' })
      continue
    }
    const read = readThemeFile(file, text)
    if ('problem' in read) {
      files.push({ file, name: listingName(file), problem: read.problem })
    } else {
      found.set(file, read)
      files.push({ file, name: read.name, ...(read.author ? { author: read.author } : {}) })
    }
  }
  files.sort((a, b) => a.name.localeCompare(b.name) || a.file.localeCompare(b.file))
  return { files, usable: found }
}

// Reads state.json and the folder, and works out what is worn. Sets nativeTheme
// on the way, which is what moves prefers-color-scheme in every window, so the
// base follows without a window being told.
export async function loadThemes(): Promise<Themes> {
  const [state, folder] = await Promise.all([readState(), readFolder()])
  const { theme, customBase } = readThemeChoice(state)
  const colors = cleanColors(state.colors)
  usable = folder.usable

  let missing = false
  if (theme === 'dark' || theme === 'light') {
    base = theme
    worn = {}
  } else if (theme === 'custom') {
    base = customBase
    worn = colors
  } else {
    const file = usable.get(theme)
    if (file) {
      base = file.base
      worn = file.colors
    } else {
      missing = true
      base = 'dark'
      worn = {}
    }
  }
  nativeTheme.themeSource = base
  themes = { theme, customBase, colors, files: folder.files, missing, folder: themesFolder() }
  return themes
}

// Loads, then tells every window: the colours to wear, and the rows to draw.
export async function repaint(): Promise<Themes> {
  const now = await loadThemes()
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    window.webContents.send(IPC.colorsChanged, worn)
    window.webContents.send(IPC.themesChanged, now)
  }
  return now
}

// The theme keys are written together, every time. customBase is always among
// them, because a file without it is read as one written before Custom
// existed.
async function writeTheme(patch: { theme?: ThemeChoice; customBase?: Base; colors?: Colors }): Promise<Themes> {
  await writeState({ theme: themes.theme, customBase: themes.customBase, ...patch })
  return repaint()
}

export async function setTheme(value: unknown): Promise<Themes> {
  await loadThemes()
  const builtIn = value === 'dark' || value === 'light' || value === 'custom'
  // A file is chosen only while it reads. Anything else is refused rather than
  // stored, and the answer is what is on disk afterwards.
  if (!builtIn && !(isThemeFileName(value) && usable.has(value))) return repaint()
  return writeTheme({ theme: value as ThemeChoice })
}

export async function setCustomBase(value: unknown): Promise<Themes> {
  await loadThemes()
  const next = readBase(value)
  if (!next) return repaint()
  return writeTheme({ customBase: next })
}

// The custom set, replaced whole. The stored set goes back out so a value the
// guard refused shows as refused.
export async function setCustomColors(value: unknown): Promise<Colors> {
  await loadThemes()
  const clean = cleanColors(value)
  await writeTheme({ colors: clean })
  return clean
}

// Writes the colours on screen and the custom base as a new file. Never over
// a file that is there: a name already taken gets a number.
export async function saveTheme(name: unknown, colors: unknown): Promise<SaveThemeResult> {
  const clean = typeof name === 'string' ? name.trim() : ''
  if (clean === '') return { problem: 'A theme needs a name.' }
  await loadThemes()
  const folder = themesFolder()
  await mkdir(folder, { recursive: true })
  const text = themeFileText({ name: clean, base: themes.customBase, colors: cleanColors(colors) })
  const stem = themeFileStem(clean)
  for (let n = 1; n < 1000; n++) {
    const file = n === 1 ? stem + THEME_EXT : `${stem}-${n}${THEME_EXT}`
    try {
      await writeFile(join(folder, file), text, { encoding: 'utf8', flag: 'wx' })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
      return { problem: 'The file could not be written.' }
    }
    await repaint()
    return { file }
  }
  return { problem: 'Every name like this one is taken.' }
}

export async function openThemesFolder(): Promise<boolean> {
  const folder = themesFolder()
  await mkdir(folder, { recursive: true })
  return (await shell.openPath(folder)) === ''
}

// A file dropped in, edited, renamed or taken away shows without a restart.
// Settled for a moment first: an editor saving a file can take it away and put
// it back, and the list should not flicker through that.
let watcher: FSWatcher | null = null
let settle: ReturnType<typeof setTimeout> | undefined

export async function watchThemes(): Promise<void> {
  const folder = themesFolder()
  await mkdir(folder, { recursive: true }).catch(() => undefined)
  watcher = watch(folder, { ignoreInitial: true, depth: 0 })
  watcher.on('all', () => {
    clearTimeout(settle)
    settle = setTimeout(() => void repaint(), 120)
  })
}

export async function closeThemesWatcher(): Promise<void> {
  clearTimeout(settle)
  await watcher?.close()
  watcher = null
}
