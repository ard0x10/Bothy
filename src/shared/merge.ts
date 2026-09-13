import type { CanvasObject } from './canvas'
import type { Column } from './types'

// Two writers, one file, v0.4 step 6.
//
// A file read at one moment (the base) has since been changed twice: once by
// the one about to write (mine) and once on disk by someone else (disk). These
// put the two together instead of letting either one be written over.
//
// Two answers, and this is the whole of them:
// - a change to one thing and a change to another thing are both kept. The
//   things are as small as the file allows: a field of a canvas object, the
//   place of one card.
// - where both changed the same thing, one of them stands. Which one is the
//   caller's to say (`prefer`): the window keeps the hand's, and a tool refuses
//   instead, so it asks with 'disk' and looks at what clashed.
//
// Pure and typed over plain data, so the rule can be measured
// without a window or a server, and the window and the server cannot decide the
// same case two ways.

export type Prefer = 'mine' | 'disk'

// What both sides changed, by id. A field is a key of an object's props, or
// `textStyle.<name>`; '*' is the object itself (one side took it off, the other
// changed it); 'place' is where a card sits.
export type Clash = { id: string; fields: string[] }

type Merged<T> = { value: T; clashes: Clash[] }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

// Compared by content and not by key order: a file an editor wrote back with
// its keys in another order has not changed anything.
function canon(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canon(value[key])}`)
      .join(',')}}`
  }
  return value === undefined ? 'undefined' : JSON.stringify(value)
}

export const sameValue = (a: unknown, b: unknown): boolean => canon(a) === canon(b)

// One value three ways. Undefined is "not there".
function pickOne(base: unknown, mine: unknown, disk: unknown, prefer: Prefer): { value: unknown; clash: boolean } {
  if (sameValue(mine, base)) return { value: disk, clash: false }
  if (sameValue(disk, base) || sameValue(mine, disk)) return { value: mine, clash: false }
  return { value: prefer === 'mine' ? mine : disk, clash: true }
}

// The keys of both, mine's order first, so a file written by the window keeps
// the order the window writes and a key added on disk goes on the end.
const keysOf = (mine: Record<string, unknown>, disk: Record<string, unknown>): string[] => [
  ...Object.keys(mine),
  ...Object.keys(disk).filter((key) => !(key in mine))
]

// A record field by field, with the fields that clashed. `nested` names keys
// whose value is itself merged field by field (a canvas object's textStyle).
export function mergeFields(
  base: Record<string, unknown>,
  mine: Record<string, unknown>,
  disk: Record<string, unknown>,
  prefer: Prefer,
  nested: readonly string[] = []
): { fields: Record<string, unknown>; clashes: string[] } {
  const fields: Record<string, unknown> = {}
  const clashes: string[] = []
  for (const key of keysOf(mine, disk)) {
    const [b, m, d] = [base[key], mine[key], disk[key]]
    if (nested.includes(key) && [b, m, d].every((one) => one === undefined || isRecord(one)) && (isRecord(m) || isRecord(d))) {
      const inner = mergeFields(
        (b as Record<string, unknown>) ?? {},
        (m as Record<string, unknown>) ?? {},
        (d as Record<string, unknown>) ?? {},
        prefer
      )
      clashes.push(...inner.clashes.map((name) => `${key}.${name}`))
      if (Object.keys(inner.fields).length > 0) fields[key] = inner.fields
      else if (m !== undefined && d !== undefined) fields[key] = {}
      continue
    }
    const one = pickOne(b, m, d, prefer)
    if (one.clash) clashes.push(key)
    if (one.value !== undefined) fields[key] = one.value
  }
  return { fields, clashes }
}

// Things with ids, in an order: a canvas's objects, a board's columns. Each is
// merged by `fields`, taken off where one side took it off and the other left
// it alone, and put in the order of whichever side changed the order - mine if
// both did - with what only the other side has put back after what it followed.
function mergeById<T extends { id: string }>(
  base: readonly T[],
  mine: readonly T[],
  disk: readonly T[],
  prefer: Prefer,
  fields: (base: T | undefined, mine: T, disk: T) => { value: T; clashes: string[] }
): Merged<T[]> {
  const index = (list: readonly T[]) => new Map(list.map((one) => [one.id, one]))
  const [b, m, d] = [index(base), index(mine), index(disk)]
  const clashes: Clash[] = []
  const kept = new Map<string, T>()

  for (const id of new Set([...m.keys(), ...d.keys(), ...b.keys()])) {
    const [was, mineNow, diskNow] = [b.get(id), m.get(id), d.get(id)]
    if (mineNow && diskNow) {
      const merged = fields(was, mineNow, diskNow)
      if (merged.clashes.length > 0) clashes.push({ id, fields: merged.clashes })
      kept.set(id, merged.value)
    } else if (mineNow && !diskNow) {
      // Gone from disk. Kept only if it is new on this side, or this side changed it.
      if (!was) kept.set(id, mineNow)
      else if (!sameValue(mineNow, was)) {
        clashes.push({ id, fields: ['*'] })
        if (prefer === 'mine') kept.set(id, mineNow)
      }
    } else if (!mineNow && diskNow) {
      if (!was) kept.set(id, diskNow)
      else if (!sameValue(diskNow, was)) {
        clashes.push({ id, fields: ['*'] })
        if (prefer === 'disk') kept.set(id, diskNow)
      }
    }
  }

  const ids = (list: readonly T[]) => list.map((one) => one.id)
  const reordered = (list: readonly T[]) => {
    const shared = ids(list).filter((id) => b.has(id))
    return shared.join('\n') !== ids(base).filter((id) => shared.includes(id)).join('\n')
  }
  const [lead, follow] = !reordered(mine) && reordered(disk) ? [disk, mine] : [mine, disk]
  const order = ids(lead).filter((id) => kept.has(id))
  const followIds = ids(follow)
  followIds.forEach((id, at) => {
    if (!kept.has(id) || order.includes(id)) return
    let before = at - 1
    while (before >= 0 && !order.includes(followIds[before])) before--
    order.splice(before < 0 ? 0 : order.indexOf(followIds[before]) + 1, 0, id)
  })
  return { value: order.map((id) => kept.get(id) as T), clashes }
}

// ---- a canvas ------------------------------------------------------------------

export type CanvasBody = { objects: CanvasObject[]; extra: Record<string, unknown> }

const objectFields = (object: CanvasObject): Record<string, unknown> => ({ type: object.type, ...object.props })

export function mergeCanvas(base: CanvasBody, mine: CanvasBody, disk: CanvasBody, prefer: Prefer): Merged<CanvasBody> {
  const objects = mergeById(base.objects, mine.objects, disk.objects, prefer, (was, m, d) => {
    const merged = mergeFields(was ? objectFields(was) : {}, objectFields(m), objectFields(d), prefer, ['textStyle'])
    const { type, ...props } = merged.fields
    return { value: { id: m.id, type: String(type ?? m.type), props }, clashes: merged.clashes }
  })
  const extra = mergeFields(base.extra, mine.extra, disk.extra, prefer)
  const clashes = [...objects.clashes, ...(extra.clashes.length > 0 ? [{ id: '', fields: extra.clashes }] : [])]
  return { value: { objects: objects.value, extra: extra.fields }, clashes }
}

// Every field of every object that differs between two canvases, by id: what a
// side changed. An object on one side only is '*'.
export function changedOn(before: readonly CanvasObject[], after: readonly CanvasObject[]): Clash[] {
  const was = new Map(before.map((one) => [one.id, one]))
  const now = new Map(after.map((one) => [one.id, one]))
  const out: Clash[] = []
  for (const id of new Set([...was.keys(), ...now.keys()])) {
    const [a, b] = [was.get(id), now.get(id)]
    // The window rebuilds only the object it edits and reuses every other one,
    // so most objects are the same object on both sides and cost nothing here.
    // This runs on every change while a hand drags.
    if (a === b) continue
    if (!a || !b) {
      out.push({ id, fields: ['*'] })
      continue
    }
    const [fa, fb] = [objectFields(a), objectFields(b)]
    const fields: string[] = []
    for (const key of new Set([...Object.keys(fa), ...Object.keys(fb)])) {
      if (key === 'textStyle' && (isRecord(fa[key]) || isRecord(fb[key]))) {
        const [sa, sb] = [(fa[key] ?? {}) as Record<string, unknown>, (fb[key] ?? {}) as Record<string, unknown>]
        for (const inner of new Set([...Object.keys(sa), ...Object.keys(sb)])) {
          if (!sameValue(sa[inner], sb[inner])) fields.push(`textStyle.${inner}`)
        }
      } else if (!sameValue(fa[key], fb[key])) fields.push(key)
    }
    if (fields.length > 0) out.push({ id, fields })
  }
  return out
}

// Whether two lists of changes touch the same field of the same thing. A field
// covers the fields inside it: textStyle meets textStyle.size, and '*' meets
// everything on that object.
export function overlap(a: readonly Clash[], b: readonly Clash[]): Clash[] {
  const meets = (x: string, y: string) => x === '*' || y === '*' || x === y || x.startsWith(`${y}.`) || y.startsWith(`${x}.`)
  const out: Clash[] = []
  for (const one of a) {
    const other = b.find((two) => two.id === one.id)
    if (!other) continue
    const fields = one.fields.filter((x) => other.fields.some((y) => meets(x, y)))
    if (fields.length > 0) out.push({ id: one.id, fields })
  }
  return out
}

// ---- a board's order -------------------------------------------------------------

// Which cards a side put somewhere new: into another column, into the board
// from nowhere, or out of step with the cards around it in its own column. The
// cards that stayed in step are the longest run the two orders share, so moving
// one card down a column moves that card and not the ones it passed.
//
// `known` are cards this side is known to have moved: the server's own call, the
// hand's drag, an agent's trail. One order set against another cannot tell
// [a, b] from [b, a]: either card may be the one that moved, and the run kept is
// the neighbour. So a known card is taken out of both orders before the rest are
// compared, and counts as moved when its column, or its place among the cards
// both orders hold, changed. Measured: a card moved up past one neighbour
// named the neighbour on the line and in a refusal, missed the one real clash,
// and a merge in the window put back a card an agent had moved.
function movedCards(base: readonly Column[], side: readonly Column[], known: ReadonlySet<string> = new Set()): Set<string> {
  const without = (columns: readonly Column[]): Column[] =>
    columns.map((column) => ({ ...column, cards: column.cards.filter((id) => !known.has(id)) }))
  const [left, right] = known.size > 0 ? [without(base), without(side)] : [base, side]
  const columnOf = new Map<string, string>()
  for (const column of left) for (const id of column.cards) columnOf.set(id, column.id)
  const moved = new Set<string>()
  for (const column of right) {
    const was = left.find((one) => one.id === column.id)?.cards ?? []
    const stayed = column.cards.filter((id) => columnOf.get(id) === column.id)
    const run = longestShared(was.filter((id) => stayed.includes(id)), stayed)
    for (const id of column.cards) if (!run.has(id)) moved.add(id)
  }
  for (const id of known) {
    const from = base.find((one) => one.cards.includes(id))
    const to = side.find((one) => one.cards.includes(id))
    if (!to) continue
    const among = (column: Column, other: Column): string[] => column.cards.filter((one) => one === id || other.cards.includes(one))
    if (!from || from.id !== to.id || among(from, to).indexOf(id) !== among(to, from).indexOf(id)) moved.add(id)
  }
  return moved
}

function longestShared(a: readonly string[], b: readonly string[]): Set<string> {
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  const run = new Set<string>()
  let [i, j] = [0, 0]
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      run.add(a[i])
      i++
      j++
    } else if (table[i + 1][j] >= table[i][j + 1]) i++
    else j++
  }
  return run
}

const cardsIn = (columns: readonly Column[]): Set<string> => new Set(columns.flatMap((column) => column.cards))

// The column only. Two sides that put a card in the same column agree, even if
// the cards around it put it at another index on each side.
const whereIs = (columns: readonly Column[], id: string): string =>
  columns.find((one) => one.cards.includes(id))?.id ?? ''

// The cards each side is known to have moved, when it is known. See movedCards.
export type KnownMoves = { mine?: ReadonlySet<string>; disk?: ReadonlySet<string> }

export function mergeColumns(
  base: readonly Column[],
  mine: readonly Column[],
  disk: readonly Column[],
  prefer: Prefer,
  known: KnownMoves = {}
): Merged<Column[]> {
  // The columns themselves - which there are, their order, title, limit and the
  // user's own keys - the way a canvas's objects are merged. The cards come after.
  const shape = (column: Column): Record<string, unknown> => ({ title: column.title, wipLimit: column.wipLimit, extra: column.extra })
  const columns = mergeById(base, mine, disk, prefer, (was, m, d) => {
    const merged = mergeFields(was ? shape(was) : {}, shape(m), shape(d), prefer)
    const f = merged.fields
    const value: Column = { id: m.id, title: String(f.title ?? m.title), cards: [], extra: (f.extra as Record<string, unknown>) ?? {} }
    if (typeof f.wipLimit === 'number') value.wipLimit = f.wipLimit
    return { value, clashes: merged.clashes }
  })

  const [inBase, inMine, inDisk] = [cardsIn(base), cardsIn(mine), cardsIn(disk)]
  const [movedMine, movedDisk] = [movedCards(base, mine, known.mine), movedCards(base, disk, known.disk)]
  const goneMine = new Set([...inBase].filter((id) => !inMine.has(id)))
  const goneDisk = new Set([...inBase].filter((id) => !inDisk.has(id)))
  const clashes = [...columns.clashes]

  const mineWins = new Set<string>()
  const drop = new Set<string>()
  for (const id of new Set([...movedMine, ...goneMine])) {
    const diskTouched = movedDisk.has(id) || goneDisk.has(id)
    const agree = diskTouched && whereIs(mine, id) === whereIs(disk, id)
    if (diskTouched && !agree) {
      clashes.push({ id, fields: ['place'] })
      if (prefer === 'disk') continue
    }
    if (goneMine.has(id)) drop.add(id)
    else mineWins.add(id)
  }

  const result: Column[] = columns.value.map((column) => ({
    ...column,
    cards: (disk.find((one) => one.id === column.id)?.cards ?? []).filter((id) => !drop.has(id) && !mineWins.has(id))
  }))
  for (const column of mine) {
    const target = result.find((one) => one.id === column.id)
    if (!target) continue
    column.cards.forEach((id, at) => {
      if (!mineWins.has(id)) return
      let before = at - 1
      while (before >= 0 && !target.cards.includes(column.cards[before])) before--
      target.cards.splice(before < 0 ? 0 : target.cards.indexOf(column.cards[before]) + 1, 0, id)
    })
  }
  // A card is in one place. A column that is gone takes nothing with it: its
  // cards are shown at the end of the first column, as a card no order names is.
  const seen = new Set<string>()
  for (const column of result) {
    column.cards = column.cards.filter((id) => (seen.has(id) ? false : (seen.add(id), true)))
  }
  return { value: result, clashes }
}

// Which cards moved between two orders, as clashes: what a side changed.
export function placesChanged(before: readonly Column[], after: readonly Column[], known: ReadonlySet<string> = new Set()): Clash[] {
  const gone = [...cardsIn(before)].filter((id) => !cardsIn(after).has(id))
  return [...new Set([...movedCards(before, after, known), ...gone])].map((id) => ({ id, fields: ['place'] }))
}
