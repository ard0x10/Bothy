import type { Clash } from './merge'
import { samePath } from './vaults'

// What the window's hand is on, v0.4 step 6. Where an agent and a
// hand change the same thing, the hand stands, and an agent that would change
// it is refused and told so. The server is another process and cannot see the
// window, so the window says it in a file next to state.json - not in the vault,
// which is the user's and which a hand does not leave traces in.
//
//   { "pid": 1234, "items": [{ "workspace": "D:\\Vault\\My Project",
//       "kind": "canvas", "id": "o_1a2b3c4d", "fields": ["text"] }] }
//
// `pid` is the app's. A file whose process is gone says nothing: a window that
// closed without emptying it would otherwise hold those objects shut forever.
// `fields` are what merge.ts calls fields; a card being dragged is ['place'].

export const EDITING_FILE = 'editing.json'

export type EditingItem = { workspace: string; kind: 'canvas' | 'kanban'; id: string; fields: string[] }

export type Editing = { pid: number; items: EditingItem[] }

// Read, not believed: anything that is not the shape above is nothing.
export function readEditing(value: unknown): Editing | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (typeof record.pid !== 'number' || !Array.isArray(record.items)) return null
  const items = record.items.flatMap((entry): EditingItem[] => {
    if (entry === null || typeof entry !== 'object') return []
    const one = entry as Record<string, unknown>
    if (typeof one.workspace !== 'string' || typeof one.id !== 'string') return []
    if (one.kind !== 'canvas' && one.kind !== 'kanban') return []
    const fields = Array.isArray(one.fields) ? one.fields.filter((field): field is string => typeof field === 'string') : []
    return fields.length > 0 ? [{ workspace: one.workspace, kind: one.kind, id: one.id, fields }] : []
  })
  return { pid: record.pid, items }
}

// The items for one workspace and one kind, as clashes merge.ts can meet.
export function editingIn(editing: Editing | null, workspace: string, kind: EditingItem['kind']): Clash[] {
  if (!editing) return []
  return editing.items
    .filter((item) => item.kind === kind && samePath(item.workspace, workspace))
    .map((item) => ({ id: item.id, fields: item.fields }))
}
