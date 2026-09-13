// What Bothy keeps on disk, described once. Step 1 of v0.4.
//
// Every file an agent may read or write - a card, a workspace's columns and its
// settings, a canvas - has its fields listed in this folder, one file here for
// each kind of file there. The readers and writers take their names and their
// order from these lists, and so will the tools an agent is handed and the
// guide written for one. A field changed in one of these lists is changed for
// all of them. A field added anywhere else is one these lists do not describe,
// and a check says so rather than an agent finding out.
//
// A description, not a validator. What a value may be is written down so that
// whoever writes the file can be told; the app's own readers stay as forgiving
// as they were, because a card that will not open over one bad date is worse
// than one that opens and draws no date.

export type Value =
  | { is: 'text' }
  | { is: 'number' }
  | { is: 'boolean' }
  // Written only while it is on. Off is no key at all, never false.
  | { is: 'true' }
  // 2026-09-20
  | { is: 'day' }
  // 2026-09-20T14:22:00.000Z
  | { is: 'moment' }
  // #rrggbb, or #rrggbbaa for a colour that is partly see-through.
  | { is: 'colour' }
  // One of the listed words. `open` when a word the app does not offer is still
  // kept and shown rather than dropped.
  | { is: 'one of'; values: readonly string[]; open?: true }
  // A letter, an underscore and hex digits: k_7f2a.
  | { is: 'id'; prefix: string; digits: number }
  // A bare name in the workspace's files/ folder. Never a path.
  | { is: 'file name' }
  // [x, y]
  | { is: 'point' }
  | { is: 'list'; of: Value }
  | { is: 'map'; fields: readonly Field[] }
  | { is: 'either'; of: readonly Value[] }

export type Field = {
  name: string
  value: Value
  // In every file the app writes. An absent optional field means its default,
  // or nothing at all when it has none.
  required?: true
  default?: unknown
  // What the field is for, for whoever reads the file without the app, in the
  // words a tool description or a guide would use.
  means: string
}
