import { LABEL_KEYS } from '../labels'
import type { Field } from './field'

// A card: one .md file in <workspace>/kanban/cards/, YAML frontmatter on top and
// free text below it. Only id and title are required, and an empty field is not
// written, so a plain card lives on three lines of frontmatter.
//
// Any other key in the frontmatter belongs to whoever wrote it. It is kept,
// shown in the panel and written back exactly as it was, empty values included.
export const CARD = {
  where: '<workspace>/kanban/cards/<file name>.md',
  means:
    'One card. YAML frontmatter holds the fields below; the body under it is free text the app shows as markdown. Keys not listed here are kept and written back untouched.'
} as const

// What the panel offers. Another word in the file is kept and offered back.
export const PRIORITIES = ['low', 'medium', 'high'] as const

// What a day is written as, and what the panel's date box can edit. Anything
// else in a date field is kept and shown as text.
export const DAY = /^\d{4}-\d{2}-\d{2}$/

const CHECKLIST_ITEM_FIELDS = [
  { name: 'text', value: { is: 'text' }, required: true, means: 'What is to be done.' },
  { name: 'done', value: { is: 'boolean' }, required: true, means: 'Whether it is ticked.' }
] as const satisfies readonly Field[]

const CHECKLIST_FIELDS = [
  { name: 'name', value: { is: 'text' }, required: true, default: 'Checklist', means: 'The heading of the list.' },
  {
    name: 'items',
    value: { is: 'list', of: { is: 'map', fields: CHECKLIST_ITEM_FIELDS } },
    required: true,
    means: 'The items, top to bottom.'
  }
] as const satisfies readonly Field[]

// In the order they are written, which is also the list of names a field of the
// user's own may not take: a custom field called `due` would be written twice,
// once from the card and once from its own keys, and the second one would win.
export const CARD_FIELDS = [
  {
    name: 'id',
    value: { is: 'id', prefix: 'k', digits: 4 },
    required: true,
    means: 'Fixed for the life of the card. columns.json lists the card by it; the file name may change, the id does not.'
  },
  {
    name: 'title',
    value: { is: 'text' },
    required: true,
    means: "What the card is called. A new card's file name is made from it once; a new title does not rename the file."
  },
  {
    name: 'archived',
    value: { is: 'true' },
    means: 'Off the kanban but kept, still in its place in columns.json. Taking the key away brings the card back where it was.'
  },
  {
    name: 'cover',
    value: { is: 'either', of: [{ is: 'colour' }, { is: 'file name' }] },
    means: 'A band across the top of the card: a colour, or a picture from files/ when the name ends in an image extension.'
  },
  {
    name: 'tags',
    value: { is: 'list', of: { is: 'one of', values: LABEL_KEYS, open: true } },
    means: 'The colour labels the card wears, by colour word. A workspace may give a colour a name in workspace.json; the card still carries the word. A word that is not one of the colours is a label from before them, and is kept.'
  },
  { name: 'start', value: { is: 'day' }, means: 'The first day of the work.' },
  {
    name: 'due',
    value: { is: 'day' },
    means: 'The last day of the work. Anything that is not a day is kept but is not read as a date.'
  },
  {
    name: 'priority',
    value: { is: 'one of', values: PRIORITIES, open: true },
    means: 'How much the card matters.'
  },
  {
    name: 'checklists',
    value: { is: 'list', of: { is: 'map', fields: CHECKLIST_FIELDS } },
    means: 'Sub tasks. They live here and nowhere else: a "- [ ]" line in the body is text the app does not touch.'
  },
  {
    name: 'files',
    value: { is: 'list', of: { is: 'file name' } },
    means: "Attachments, by bare name in the workspace's files/ folder. A name with no file behind it is kept and shown as missing."
  },
  {
    name: 'created',
    value: { is: 'either', of: [{ is: 'day' }, { is: 'moment' }] },
    means: 'When the card was made. The app writes the day.'
  },
  {
    name: 'modified',
    value: { is: 'either', of: [{ is: 'day' }, { is: 'moment' }] },
    means: 'When the card was last changed.'
  }
] as const satisfies readonly Field[]

export type CardFieldName = (typeof CARD_FIELDS)[number]['name']

export const KNOWN: readonly CardFieldName[] = CARD_FIELDS.map((field) => field.name)
