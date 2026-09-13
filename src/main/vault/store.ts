import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Card, Column, Label, Vault, Workspace } from '../../shared/types'
import { listFiles, whenAdded } from './attach'
import { parseCard } from './format'
import { hashText } from './hash'
import { readTemplates } from './template'
import { newId } from '../../shared/id'
import { cleanBackground } from '../../shared/background'
import { LABEL_COLORS, labelKeyOf } from '../../shared/labels'
import { COLUMN_FIELDS } from '../../shared/schema/columns'
import { TABS } from '../../shared/schema/workspace'

const DEFAULT_LABEL_COLOR = '#8b8b96'

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    return jsonOf(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

function jsonOf(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return null
  }
}

// Two shapes. An entry with a `key` is one of the six colours, and what it
// carries is the note somebody hung on it - the colour comes from the app
// unless the file names one, since the file always wins. An entry with only a
// name is a label from before the six: it is read, drawn and kept, and nothing
// in the app writes another one.
function readLabels(value: unknown): Label[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const label = (entry ?? {}) as Record<string, unknown>
    const named = typeof label.color === 'string' ? label.color : null
    const key = typeof label.key === 'string' ? labelKeyOf(label.key) : null
    if (key) {
      return [
        {
          key,
          name: typeof label.name === 'string' ? label.name : '',
          color: named ?? LABEL_COLORS[key]
        }
      ]
    }
    if (typeof label.name !== 'string') return []
    return [{ name: label.name, color: named ?? DEFAULT_LABEL_COLOR }]
  })
}

const COLUMN_KEYS: readonly string[] = COLUMN_FIELDS.map((field) => field.name)

function readColumns(value: unknown): Column[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const column = (entry ?? {}) as Record<string, unknown>
    const cards = Array.isArray(column.cards)
      ? column.cards.filter((id): id is string => typeof id === 'string')
      : []
    const extra: Record<string, unknown> = {}
    for (const [key, own] of Object.entries(column)) {
      if (!COLUMN_KEYS.includes(key)) extra[key] = own
    }
    return [
      {
        id: typeof column.id === 'string' ? column.id : newId('c'),
        title: typeof column.title === 'string' ? column.title : 'Untitled',
        cards,
        wipLimit: typeof column.wipLimit === 'number' ? column.wipLimit : undefined,
        extra
      }
    ]
  })
}

// columns.json as its own text says it, and nothing more: no card the order does
// not name is added to it and no id without a file is taken out. v0.4 step 6:
// two writers of the order are merged over the file, not over the board built
// from it. Null when it does not parse.
export function parseColumnsFile(text: string): { columns: Column[]; extra: Record<string, unknown> } | null {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return null
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null
  const record = body as Record<string, unknown>
  const extra: Record<string, unknown> = { formatVersion: 1 }
  for (const [key, value] of Object.entries(record)) {
    if (key !== 'columns') extra[key] = value
  }
  return { columns: readColumns(record.columns), extra }
}

async function readCards(dir: string, notes: string[]): Promise<Card[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }

  const cards: Card[] = []
  for (const name of names.filter((n) => n.toLowerCase().endsWith('.md')).sort()) {
    const file = join(dir, name)
    const card = parseCard(file, await readFile(file, 'utf8'))
    if (card.broken) notes.push(`${name}: frontmatter did not parse (${card.broken})`)
    cards.push(card)
  }
  return cards
}

// One workspace, read the way the window reads it. Exported for the server an
// agent talks to, so what an agent is shown is what the board shows.
export async function readWorkspace(path: string, name: string): Promise<Workspace> {
  const notes: string[] = []
  const meta = await readJson(join(path, 'workspace.json'))
  if (!meta) notes.push('workspace.json missing or unreadable, falling back to defaults')

  let columnsText: string | null = null
  try {
    columnsText = await readFile(join(path, 'kanban', 'columns.json'), 'utf8')
  } catch {
    columnsText = null
  }
  const columnFile = columnsText === null ? null : jsonOf(columnsText)
  if (!columnFile) notes.push('kanban/columns.json missing or unreadable')
  const columnsSeen = {
    columns: columnsText === null ? [] : (parseColumnsFile(columnsText)?.columns ?? []),
    hash: columnsText === null ? null : hashText(columnsText)
  }

  const columns = readColumns(columnFile?.columns)
  const columnsExtra: Record<string, unknown> = { formatVersion: 1 }
  for (const [key, value] of Object.entries(columnFile ?? {})) {
    if (key !== 'columns') columnsExtra[key] = value
  }
  const cards = await readCards(join(path, 'kanban', 'cards'), notes)

  const listed = new Set(columns.flatMap((column) => column.cards))
  const orphans = cards.filter((card) => !listed.has(card.id)).map((card) => card.id)
  if (orphans.length > 0 && columns.length > 0) {
    columns[0].cards = [...columns[0].cards, ...orphans]
  }

  // Ids that no file backs. Kept out of the column so the view never asks for a
  // card that is not there.
  const known = new Set(cards.map((card) => card.id))
  for (const column of columns) {
    const missing = column.cards.filter((id) => !known.has(id))
    if (missing.length > 0) {
      notes.push(`${column.title}: ${missing.length} card id(s) with no file`)
      column.cards = column.cards.filter((id) => known.has(id))
    }
  }

  const background = cleanBackground(meta?.background)
  const files = await listFiles(path)

  const identity = identityOf(meta, name)

  return {
    path,
    id: identity.id ?? newId('w'),
    name: identity.name,
    labels: readLabels(meta?.labels),
    lastTab: TABS.find((tab) => tab === meta?.lastTab) ?? 'kanban',
    // Only there when one was chosen, so a workspace without one has the same
    // shape it had before there was such a thing.
    ...(background ? { background } : {}),
    // True and nothing else counts: a hand-edited "yes" or 1 is not a mark
    // anybody made with this app.
    ...(meta?.bookmarked === true ? { bookmarked: true as const } : {}),
    columns,
    columnsExtra,
    columnsSeen,
    cards,
    // Read with the workspace, like files/, and with the same notes list: a
    // template that does not parse is left out and said so, rather than sitting
    // in the menu and making empty cards.
    templates: await readTemplates(path, notes),
    files,
    added: await whenAdded(path, files),
    orphans,
    notes
  }
}

// A workspace's id and name as its file gives them. The id is null when the
// file has none: the window makes one up for the session, but a made-up id is
// not one anybody can have chosen to let an agent in by.
function identityOf(
  meta: Record<string, unknown> | null,
  folder: string
): { id: string | null; name: string } {
  return {
    id: typeof meta?.id === 'string' ? meta.id : null,
    name: typeof meta?.name === 'string' ? meta.name : folder
  }
}

export async function workspaceIdentity(
  path: string,
  folder: string
): Promise<{ id: string | null; name: string }> {
  return identityOf(await readJson(join(path, 'workspace.json')), folder)
}

// Every folder directly under the vault is a workspace, apart from the ones
// whose name starts with a dot. One rule, so the window and the server an agent
// talks to cannot disagree about what a workspace is.
export async function workspaceFolders(path: string): Promise<{ name: string; path: string }[]> {
  const entries = await readdir(path, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => ({ name: entry.name, path: join(path, entry.name) }))
}

export async function readVault(path: string): Promise<Vault> {
  const workspaces: Workspace[] = []
  for (const folder of await workspaceFolders(path)) {
    workspaces.push(await readWorkspace(folder.path, folder.name))
  }
  return { path, workspaces }
}
