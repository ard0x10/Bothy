import type { Field } from './field'

// <workspace>/kanban/columns.json: the columns, and the order of every card in
// them. The order lives here rather than in the cards, so moving a card writes
// this one file instead of rewriting every card it passes.
export const COLUMNS = {
  where: '<workspace>/kanban/columns.json',
  means:
    'The columns of the kanban, left to right, and the cards in each, top to bottom. Keys not listed here, on the file or on a column, are kept.'
} as const

// In the order they are written.
export const COLUMN_FIELDS = [
  {
    name: 'id',
    value: { is: 'id', prefix: 'c', digits: 4 },
    required: true,
    means: 'Fixed for the life of the column.'
  },
  { name: 'title', value: { is: 'text' }, required: true, means: 'The name at the head of the column.' },
  {
    name: 'cards',
    value: { is: 'list', of: { is: 'id', prefix: 'k', digits: 4 } },
    required: true,
    means: 'The ids of the cards in the column, top to bottom. A card file no column lists is shown at the end of the first column, and nothing is written until it is moved.'
  },
  { name: 'wipLimit', value: { is: 'number' }, means: 'How many cards the column is meant to hold at most.' }
] as const satisfies readonly Field[]

export type ColumnFieldName = (typeof COLUMN_FIELDS)[number]['name']

export const COLUMNS_FIELDS = [
  {
    name: 'formatVersion',
    value: { is: 'number' },
    required: true,
    default: 1,
    means: 'The version of this file format.'
  },
  {
    name: 'columns',
    value: { is: 'list', of: { is: 'map', fields: COLUMN_FIELDS } },
    required: true,
    means: 'The columns, left to right.'
  }
] as const satisfies readonly Field[]
