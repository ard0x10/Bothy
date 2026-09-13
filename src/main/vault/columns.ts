import { join } from 'node:path'
import { COLUMN_FIELDS } from '../../shared/schema/columns'
import type { Column, ColumnsSeen } from '../../shared/types'
import { mergeColumns, mergeFields, placesChanged } from '../../shared/merge'
import { hashText } from './hash'
import { parseColumnsFile } from './store'
import { writeIfUnchanged, writeText } from './writer'

export type ColumnsFile = {
  workspacePath: string
  columns: Column[]
  extra: Record<string, unknown>
}

// Keys the file keeps in the schema's order. Anything else the user added rides
// along after them, both on the file and on each column. A number that is not a
// number is not written, so a limit nobody set leaves no key behind.
function shape(column: Column): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of COLUMN_FIELDS) {
    const value = column[field.name]
    if (field.value.is === 'number' ? typeof value === 'number' : value !== undefined) {
      out[field.name] = value
    }
  }
  return { ...out, ...column.extra }
}

export function serializeColumns(file: ColumnsFile): string {
  const { formatVersion = 1, ...rest } = file.extra
  const body = {
    formatVersion,
    ...rest,
    columns: file.columns.map(shape)
  }
  return `${JSON.stringify(body, null, 2)}\n`
}

export async function writeColumns(file: ColumnsFile): Promise<void> {
  const target = join(file.workspacePath, 'kanban', 'columns.json')
  await writeText(target, serializeColumns(file))
}

// The window's write of the order, v0.4 step 6. Held to what the window last
// read; a file that moved on is put together with the window's order card by
// card (shared/merge.ts), the hand's place standing where both moved one card,
// and that is written instead. Merged here rather than in the
// window because this is where the file is, so the file read and the file
// written over are one and the same.
//
// `moved` are the cards this window moved, and `heard` the cards the agents'
// trails it heard lately name: which of two neighbours moved is known, not
// guessed from the orders (see movedCards in shared/merge.ts).
export async function writeColumnsOver(
  file: ColumnsFile,
  seen: ColumnsSeen | null,
  moved: readonly string[] = [],
  heard: readonly string[] = []
): Promise<{ merged: boolean; seen: ColumnsSeen; outside: string[] }> {
  const target = join(file.workspacePath, 'kanban', 'columns.json')
  let columns = file.columns
  let extra = file.extra
  let baseline = seen?.hash ?? null
  let merged = false
  // The cards the file had moved since it was last read, v0.4 step 7. None of
  // it is this window's, and the watcher may never get to say so: by the time it
  // does, the window has read back the merged order and finds nothing new.
  let before = seen?.columns ?? file.columns
  const outside = new Set<string>()
  for (let attempt = 0; attempt < 4; attempt++) {
    const text = serializeColumns({ ...file, columns, extra })
    const written = await writeIfUnchanged(target, text, baseline)
    if (written.ok) return { merged, seen: { columns, hash: written.hash }, outside: [...outside] }
    const disk = parseColumnsFile(written.disk)
    // A file that does not parse is not the window's to put an order over.
    if (!disk) throw new Error('columns.json was changed by something else and can no longer be read, so the order was not written over it')
    for (const { id } of placesChanged(before, disk.columns, new Set(heard))) outside.add(id)
    before = disk.columns
    columns = mergeColumns(seen?.columns ?? file.columns, file.columns, disk.columns, 'mine', { mine: new Set(moved), disk: new Set(heard) }).value
    extra = mergeFields(file.extra, file.extra, disk.extra, 'mine').fields
    baseline = hashText(written.disk)
    merged = true
  }
  throw new Error('columns.json kept changing while the order was being written')
}
