import { serializeCanvas } from '../main/vault/canvas'
import { serializeColumns } from '../main/vault/columns'
import { slug } from '../main/vault/create'
import { serializeCard } from '../main/vault/format'
import { describeFields } from '../mcp/describe'
import { describeObjects } from '../mcp/read'
import { ACCESS_OFF } from '../mcp/tools'
import { AI_ACTIONS, AI_CANVAS_ACTIONS, AI_TRAIL, aiNotice, type AiChange } from '../shared/aitrail'
import { USER_DATA_NAME } from '../shared/app'
import { NEW_ARROW, NEW_BOX, NEW_TEXT, OBJECT_ID_WIDTH, type CanvasObject } from '../shared/canvas'
import { EDITING_FILE, type Editing } from '../shared/editing'
import { LABEL_KEYS } from '../shared/labels'
import { CANVAS, CANVAS_FIELDS } from '../shared/schema/canvas'
import { CARD, CARD_FIELDS, PRIORITIES } from '../shared/schema/card'
import { COLUMNS, COLUMNS_FIELDS, COLUMN_FIELDS } from '../shared/schema/columns'
import { WORKSPACE, WORKSPACE_FIELDS } from '../shared/schema/workspace'
import { KEEP_DAYS, TRASH } from '../shared/trash'
import type { Card, Column } from '../shared/types'

// The guide for an agent with no MCP server, v0.4 step 7. In the
// repo only, nothing in a vault; written from the schema and never by hand;
// its examples run in the tests. So the fields come from src/shared/schema
// through describeFields, the same lines the tools are described with, and
// every example file is written by the app's own writer, so the guide cannot
// show a file the app would not write. What is prose here is what the schema
// cannot say: the order of steps, and what Bothy does while it is open.
//
// docs/format.md is what this function writes, byte for byte, through
// `npm run docs`.

export const GUIDE_FILE = 'docs/format.md'

// One workspace, followed from the first file to the last.
const VAULT = 'D:\\Vault'
const FOLDER = 'My Project'
const HERE = `${VAULT}\\${FOLDER}`
const DAY = '2026-09-20'
const STAMP = '2026-09-20T14-22-00-000Z'
const AT = 1789906920000

const fence = (info: string, body: string): string => `\`\`\`${info}\n${body.endsWith('\n') ? body : `${body}\n`}\`\`\``
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

const card = (fields: Pick<Card, 'id' | 'title'> & Partial<Card>): Card => ({
  file: '',
  hash: '',
  tags: [],
  checklists: [],
  files: [],
  body: '',
  extra: {},
  ...fields
})
const column = (id: string, title: string, cards: string[], more: Partial<Column> = {}): Column => ({ id, title, cards, extra: {}, ...more })
const order = (...columns: Column[]): string => serializeColumns({ workspacePath: HERE, columns, extra: { formatVersion: 1 } })
const sheet = (...objects: CanvasObject[]): string => serializeCanvas({ objects, extra: { formatVersion: 1 } })

// A trail file and the line Bothy puts up for it.
function trail(made: Omit<AiChange, 'at'>[], view: 'kanban' | 'canvas', at: number, tag: string): string[] {
  const changes: AiChange[] = made.map((one) => ({ at, ...one }))
  return [
    fence(`json settings/${AI_TRAIL}/${at}-${tag}.json`, json(changes.length === 1 ? changes[0] : changes)),
    '',
    `Bothy shows: \`${aiNotice(changes, HERE, view)}\``
  ]
}
const change = (more: Partial<AiChange> & Pick<AiChange, 'title' | 'action'>): Omit<AiChange, 'at'> => ({
  workspace: HERE,
  workspaceName: FOLDER,
  ...more
})

// A field list as markdown, from the tool descriptions' own lines.
const fields = (lines: string[]): string => lines.join('\n')
const objects = (): string =>
  describeObjects()
    .map((line) => (line.startsWith(' ') ? line : `- ${line}`))
    .join('\n')

export function guide(): string {
  const todo = column('c_1a2b', 'To do', ['k_0b1e'])
  const doing = column('c_3c4d', 'Doing', [], { wipLimit: 3 })
  const done = column('c_5e6f', 'Done', [])

  const menu = card({
    id: 'k_0b1e',
    title: 'Menu sounds',
    tags: ['blue'],
    due: '2026-10-01',
    priority: 'high',
    checklists: [{ name: 'Checklist', items: [{ text: 'Record the clicks', done: true }, { text: 'Mix them', done: false }] }],
    created: '2026-09-12',
    body: 'Every button on the title screen needs one.\n',
    extra: { estimate: 3 }
  })
  const stinger = card({ id: 'k_7f2a', title: 'Fix the stinger', created: DAY })
  const stingerFile = `${slug(stinger.title)}.md`
  const stingerDated = { ...stinger, due: '2026-09-25', body: 'It clips on the last beat.\n' }

  const plan: CanvasObject = {
    id: 'o_1a2b3c4d',
    type: 'box',
    props: { x: -100, y: -60, ...NEW_BOX, textStyle: { ...NEW_BOX.textStyle }, text: 'Plan' }
  }
  const ask: CanvasObject = {
    id: 'o_5e6f7a8b',
    type: 'text',
    props: { x: 160, y: -32, ...NEW_TEXT, textStyle: { ...NEW_TEXT.textStyle }, text: 'Ask about the budget' }
  }
  const arrow: CanvasObject = { id: 'o_9c0d1e2f', type: 'arrow', props: { from: { of: plan.id }, to: { of: ask.id }, ...NEW_ARROW } }

  const access = { theme: 'dark', ai: { on: true, vaults: { [VAULT]: ['w_3c1a'] } } }
  const hands: Editing = { pid: 20412, items: [{ workspace: HERE, kind: 'canvas', id: plan.id, fields: ['text'] }] }

  const settings = USER_DATA_NAME
  const [cardId, columnId] = [CARD_FIELDS[0].value, COLUMN_FIELDS[0].value]
  const lines: (string | string[])[] = [
    "# Bothy's files, for an agent",
    '',
    '<!-- Written by `npm run docs` from the schema in src/shared/schema and the app\'s own writers. Do not edit it by hand: it is written again from the code. -->',
    '',
    'Bothy is a kanban and a canvas kept as plain files in a folder. This guide is for an agent that reads and writes those files itself. An agent that can connect to Bothy\'s MCP server should use the server instead: it checks every value before writing, and when it refuses it says why.',
    '',
    `Every example is one workspace, \`${FOLDER}\`, in a vault at \`${VAULT}\`, followed from the first file to the last.`,
    '',
    '## Before you touch a workspace',
    '',
    'Bothy keeps its settings outside the vault. Below, that folder is called the settings folder:',
    '',
    `- Windows: \`%APPDATA%\\${settings}\``,
    `- macOS: \`~/Library/Application Support/${settings}\``,
    `- Linux: \`$XDG_CONFIG_HOME/${settings}\`, or \`~/.config/${settings}\` when that is not set`,
    '',
    'The person chooses in Bothy which workspaces an agent may use. Read `state.json` in the settings folder before you read or write anything in a vault, every time: the choice can change while you work.',
    '',
    '- A workspace is yours to use only when `ai.on` is `true` and the `id` in its `workspace.json` is listed under its vault folder in `ai.vaults`. Vault folders are compared without regard to case.',
    '- Anything else - no file, no `ai`, the switch off, the workspace not listed - means: do not read the workspace, do not write it, and do not mention it. A workspace that is not listed is not there.',
    `- When nothing you were asked about is open to you, tell the person, in these words: "${ACCESS_OFF}"`,
    '- The rest of `state.json` is Bothy\'s. Do not write this file.',
    '',
    `Here \`${FOLDER}\` is open to an agent, and no other workspace in \`${VAULT}\` is:`,
    '',
    fence('json settings/state.json', json(access)),
    '',
    '## The vault',
    '',
    '- The vault is a folder. Every folder directly in it is a workspace, except one whose name starts with a dot. A workspace holds one kanban and one canvas.',
    '- The name of a workspace is `name` in its `workspace.json`, not its folder. Renaming a workspace never moves the folder.',
    `- What is thrown away goes to \`${TRASH}\` in the vault, where Bothy keeps it for ${KEEP_DAYS} days and can put it back.`,
    '',
    fence(
      'text',
      [
        `${VAULT}\\`,
        `  ${FOLDER}\\`,
        '    workspace.json',
        '    kanban\\columns.json',
        '    kanban\\cards\\<file name>.md',
        '    canvas\\canvas.json',
        '    files\\             attachments and pictures, by bare name',
        `  ${TRASH}\\`
      ].join('\n')
    ),
    '',
    `### \`${WORKSPACE.where}\``,
    '',
    WORKSPACE.means,
    '',
    fields(describeFields(WORKSPACE_FIELDS)),
    '',
    fence(`json ${FOLDER}/workspace.json`, json({ formatVersion: 1, id: 'w_3c1a', name: FOLDER, labels: [{ key: 'red', name: 'Urgent' }], lastTab: 'kanban' })),
    '',
    `### \`${COLUMNS.where}\``,
    '',
    COLUMNS.means,
    '',
    fields(describeFields(COLUMNS_FIELDS)),
    '',
    fence(`json ${FOLDER}/kanban/columns.json`, order(todo, doing, done)),
    '',
    `### \`${CARD.where}\``,
    '',
    CARD.means,
    '',
    fields(describeFields(CARD_FIELDS)),
    '',
    `The body starts after the line that closes the frontmatter and one empty line. \`estimate\` below is a key of the person's own.`,
    '',
    fence(`md ${FOLDER}/kanban/cards/menu-sounds.md`, serializeCard(menu)),
    '',
    `### \`${CANVAS.where}\``,
    '',
    CANVAS.means,
    '',
    fields(describeFields(CANVAS_FIELDS.filter((field) => field.name !== 'objects'))),
    '- objects: everything drawn, bottom to top. Each object is one of these:',
    '',
    objects(),
    '',
    fence(`json ${FOLDER}/canvas/canvas.json`, sheet(plan)),
    '',
    '## Writing a file',
    '',
    '1. Read the file right before you change it, and write it back whole.',
    '2. Keep every key you did not mean to change, keys this guide does not list included. Bothy keeps them, and so do you.',
    '3. Write the new text to a file beside it named after it with `.tmp` and digits on the end, `columns.json.tmp1` for instance, and rename that over the file. Bothy never reads a file with a name like that, so it never sees half of one.',
    '4. Do not write over a `canvas.json` whose `formatVersion` is not 1. Write `formatVersion` as 1 in a file you make.',
    `5. A new id is a letter, an underscore and random hex digits, used by nothing else in the workspace: \`${cardId.prefix}_\` and ${cardId.digits} digits for a card, \`${columnId.prefix}_\` and ${columnId.digits} for a column, \`o_\` and ${OBJECT_ID_WIDTH} for a canvas object. Never change an id.`,
    '6. A card\'s `id`, `created` and `modified` are Bothy\'s. Give a card you make `created` as the day, and leave the three alone after that.',
    `7. Where a field takes words from a list, write one the list gives: a label is one of ${LABEL_KEYS.join(', ')}; a priority is one of ${PRIORITIES.join(', ')}. A word already in a file that is not on the list is kept, not written anew.`,
    '',
    '## While Bothy is open',
    '',
    'Bothy does not have to be open: what you write is on screen the next time it is. While it is open, it watches the vault and takes in what you write at once. Where the person is changing something at the same moment, both are kept: your change and theirs are put together, and where both of you changed the same field of the same thing, theirs is the one that stays and yours is one Ctrl+Z away. So look before you write.',
    '',
    `Read \`${EDITING_FILE}\` in the settings folder before every write. It lists what the person's hand is on:`,
    '',
    '- `workspace` is the workspace folder; `kind` is `canvas` or `kanban`; `id` is the canvas object or the card.',
    '- `fields` are what is being changed: a field name, `textStyle.<name>` for one inside `textStyle`, `*` for the whole object, `place` for a card being dragged.',
    '- Do not change a field that is listed, or anything on an object listed with `*`, or the place of a card listed with `place`. Tell the person what you left alone, and why.',
    '- Anything else can be changed: it is kept beside what the person is doing.',
    '- `pid` is Bothy\'s process. When no process with that id is running, the file says nothing.',
    '',
    `Here the words of the box \`Plan\` are being typed, so its \`text\` is not yours to change. Its colour still is:`,
    '',
    fence(`json settings/${EDITING_FILE}`, json(hands)),
    '',
    '## Leaving a trail',
    '',
    'Bothy puts a short line on screen for what an agent changed, and learns what changed from a trail. Right after each change is on disk, leave one file in `' + AI_TRAIL + '` in the settings folder. With no trail, Bothy still shows the change, and says it was changed outside Bothy.',
    '',
    `- Write the file under a name that ends in \`.part\`, then rename it to one that ends in \`.json\`. Bothy reads it and deletes it.`,
    '- The file holds one change, or a list of the changes one piece of work made, in the order they were made.',
    '- `at`: when, in milliseconds since 1970. `workspace`: the workspace folder, whole. `workspaceName`: its name.',
    '- `card` or `object`: the id, one of the two. `kind`: an object\'s type. `title`: a card\'s title, or an object\'s words, which may be empty.',
    `- \`action\`: for a card one of ${AI_ACTIONS.join(', ')}; for an object one of ${AI_CANVAS_ACTIONS.join(', ')}. \`column\`: the title of the column a card was added to or moved into.`,
    '',
    '## Recipes',
    '',
    '### Make a card',
    '',
    `1. Pick a file name from the title: lower case, every run of other characters one \`-\`, at most 60 characters, \`card\` when nothing is left. If that name is taken, add \`-2\`, then \`-3\`.`,
    '2. Write the card with a new id, its title and `created`.',
    '3. Put its id in `columns.json`, in the column and at the place it goes.',
    '',
    fence(`md ${FOLDER}/kanban/cards/${stingerFile}`, serializeCard(stinger)),
    '',
    fence(`json ${FOLDER}/kanban/columns.json`, order(todo, { ...doing, cards: [stinger.id] }, done)),
    '',
    ...trail([change({ card: stinger.id, title: stinger.title, action: 'added', column: doing.title })], 'kanban', AT, '3f9a1c2e'),
    '',
    '### Change a card',
    '',
    'Change the fields and the body in the file; leave the rest as it is. A new title does not rename the file. To take a field out, take its key out.',
    '',
    fence(`md ${FOLDER}/kanban/cards/${stingerFile}`, serializeCard(stingerDated)),
    '',
    ...trail([change({ card: stinger.id, title: stinger.title, action: 'changed' })], 'kanban', AT + 1000, '5b2d7e41'),
    '',
    '### Move a card',
    '',
    'Take its id out of the list it is in and put it where it goes. The card file does not change.',
    '',
    fence(`json ${FOLDER}/kanban/columns.json`, order(todo, doing, { ...done, cards: [stinger.id] })),
    '',
    ...trail([change({ card: stinger.id, title: stinger.title, action: 'moved', column: done.title })], 'kanban', AT + 2000, '9e4c0a17'),
    '',
    '### Archive a card',
    '',
    'Add `archived: true` to its frontmatter, and leave its id where it is in `columns.json`. Taking the key out brings the card back to that place.',
    '',
    fence(`md ${FOLDER}/kanban/cards/${stingerFile}`, serializeCard({ ...stingerDated, archived: true })),
    '',
    ...trail([change({ card: stinger.id, title: stinger.title, action: 'archived' })], 'kanban', AT + 3000, '2c8f6b90'),
    '',
    '### Throw a card away',
    '',
    `1. Move its file, unchanged, into \`${TRASH}/<workspace folder>/\` in the vault, named with the time and two underscores in front: the time as \`${STAMP}\`, which is an ISO time with \`:\` and \`.\` written as \`-\`.`,
    '2. Take its id out of `columns.json`.',
    '',
    fence('text move', `${FOLDER}/kanban/cards/${stingerFile}\n${TRASH}/${FOLDER}/${STAMP}__${stingerFile}`),
    '',
    fence(`json ${FOLDER}/kanban/columns.json`, order(todo, doing, done)),
    '',
    ...trail([change({ card: stinger.id, title: stinger.title, action: 'trashed' })], 'kanban', AT + 4000, '7d1e3f52'),
    '',
    '### Add to the canvas',
    '',
    'Put the new objects on the end of `objects`, each with a new id and a place. A field left out takes the default above. An arrow end tied to an object follows it when it moves.',
    '',
    fence(`json ${FOLDER}/canvas/canvas.json`, sheet(plan, ask, arrow)),
    '',
    ...trail(
      [
        change({ object: ask.id, kind: ask.type, title: 'Ask about the budget', action: 'added' }),
        change({ object: arrow.id, kind: arrow.type, title: '', action: 'added' })
      ],
      'canvas',
      AT + 5000,
      '4a6b8c0d'
    ),
    '',
    '### Take something off the canvas',
    '',
    `1. Write the object, as \`objects\` held it, to \`${TRASH}/<workspace folder>/<time>__<id>.canvas.json\` in the vault, the time written as for a card.`,
    '2. Take it out of `objects`. An arrow tied to it stays in the file and is not drawn until the object is back.',
    '',
    fence(`json ${TRASH}/${FOLDER}/${STAMP}__${arrow.id}.canvas.json`, json({ formatVersion: 1, object: { id: arrow.id, type: arrow.type, ...arrow.props } })),
    '',
    fence(`json ${FOLDER}/canvas/canvas.json`, sheet(plan, ask)),
    '',
    ...trail([change({ object: arrow.id, kind: arrow.type, title: '', action: 'trashed' })], 'canvas', AT + 6000, '6f0e2d4c'),
    ''
  ]
  return lines.flat().join('\n')
}
