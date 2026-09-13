import { LABEL_KEYS } from '../labels'
import type { Field } from './field'

// <workspace>/workspace.json: a workspace's name and its settings. Every folder
// directly under the vault is a workspace, and each holds exactly one kanban
// and one canvas.
export const WORKSPACE = {
  where: '<vault>/<workspace>/workspace.json',
  means:
    'The name and settings of one workspace. Keys not listed here are kept when the app changes one of these.'
} as const

// The two views a workspace remembers. The calendar is a view of the whole vault
// and is not one of them.
export const TABS = ['kanban', 'canvas'] as const

const LABEL_FIELDS = [
  {
    name: 'key',
    value: { is: 'one of', values: LABEL_KEYS },
    means: 'Which of the colours this entry is about. An entry with no key is a label from before the colours: a name and a colour of its own.'
  },
  { name: 'name', value: { is: 'text' }, means: 'A name given to the colour. Cards still carry the colour word.' },
  { name: 'color', value: { is: 'colour' }, means: "A colour of the workspace's own for this label, over the app's." }
] as const satisfies readonly Field[]

const BACKGROUND_COLOR_FIELDS = [
  { name: 'type', value: { is: 'one of', values: ['color'] }, required: true, means: 'A plain colour.' },
  { name: 'color', value: { is: 'colour' }, required: true, means: 'The colour, six digits.' }
] as const satisfies readonly Field[]

const BACKGROUND_GRADIENT_FIELDS = [
  {
    name: 'type',
    value: { is: 'one of', values: ['gradient'] },
    required: true,
    means: 'Two colours, top left to bottom right.'
  },
  { name: 'from', value: { is: 'colour' }, required: true, means: 'The top left colour, six digits.' },
  { name: 'to', value: { is: 'colour' }, required: true, means: 'The bottom right colour, six digits.' }
] as const satisfies readonly Field[]

export const WORKSPACE_FIELDS = [
  {
    name: 'formatVersion',
    value: { is: 'number' },
    default: 1,
    means: 'The version of this file format. A file without it is version 1.'
  },
  {
    name: 'id',
    value: { is: 'id', prefix: 'w', digits: 4 },
    required: true,
    means: 'Fixed for the life of the workspace. Renaming a workspace changes its name here and never moves its folder.'
  },
  { name: 'name', value: { is: 'text' }, required: true, means: 'What the workspace is called.' },
  {
    name: 'labels',
    value: { is: 'list', of: { is: 'map', fields: LABEL_FIELDS } },
    required: true,
    means: 'Names given to the colour labels. A colour with no entry is still there, unnamed.'
  },
  {
    name: 'lastTab',
    value: { is: 'one of', values: TABS },
    required: true,
    default: 'kanban',
    means: 'The view the workspace was left on.'
  },
  {
    name: 'background',
    value: {
      is: 'either',
      of: [
        { is: 'map', fields: BACKGROUND_COLOR_FIELDS },
        { is: 'map', fields: BACKGROUND_GRADIENT_FIELDS }
      ]
    },
    means: "The kanban's ground. No key means the app's own, following the theme."
  },
  { name: 'bookmarked', value: { is: 'true' }, means: 'In the Bookmarks section of the sidebar.' }
] as const satisfies readonly Field[]
