import type { Card, Column } from '../../shared/types'
import { newId } from '../../shared/id'
import { createCard } from './create'
import { writeColumns } from './columns'
import { createWorkspace } from './workspace'

// The workspace the welcome screen offers to an empty vault. A new workspace
// otherwise comes with no columns, because the app does not put content on disk
// nobody asked for; this one is asked for by name, with a button that says it
// is an example, so it is the one place the app writes cards of its own.
//
// Everything it holds is ordinary: plain card files and a columns.json, the
// same as a workspace made by hand. Thrown away from the sidebar like any other
// once it has done its job, and nothing in the app treats it differently.
export const EXAMPLE_NAME = 'Getting started'

type ExampleCard = { title: string; seed: Partial<Card> }

// A day as the card files write it, counted in the machine's own calendar so
// "today" is the day on the person's clock.
function day(offset: number): string {
  const at = new Date()
  at.setDate(at.getDate() + offset)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
}

// One column per stage and a card or two in each, every card about one thing
// the app does and how to reach it. The shortcut is passed in rather than
// written down here: it is whatever the person's capture key is right now.
function exampleColumns(captureKey: string): { title: string; cards: ExampleCard[] }[] {
  return [
    {
      title: 'To do',
      cards: [
        {
          title: 'Open a card to see what it holds',
          seed: {
            tags: ['blue'],
            body:
              'Click a card to open it. Besides this description a card carries tags, dates, ' +
              'a priority, checklists, attachments and fields of your own.',
            checklists: [
              {
                name: 'Try it',
                items: [
                  { text: 'Give this card another tag', done: false },
                  { text: 'Set a due date', done: false },
                  { text: 'Tick this item', done: false }
                ]
              }
            ]
          }
        },
        {
          title: 'Take a note from anywhere',
          seed: {
            tags: ['purple'],
            body:
              `Press ${captureKey} in any program. A small box opens: type a title, pick the ` +
              'workspace and column, press Enter, and the card is waiting here. ' +
              'The key can be changed in Settings.'
          }
        },
        {
          title: 'Draw on the canvas',
          seed: {
            tags: ['green'],
            body:
              'Every workspace has a canvas beside its board, for boxes, arrows, pictures and ' +
              'drawing by hand. Switch to it from the bar at the bottom, or with Ctrl+2.'
          }
        }
      ]
    },
    {
      title: 'Doing',
      cards: [
        {
          title: 'Drag a card to another column',
          seed: {
            tags: ['yellow'],
            priority: 'medium',
            start: day(0),
            due: day(2),
            body:
              'Cards move between columns by hand. Drag this one to Done. ' +
              'It has dates, so it also shows on the calendar (Ctrl+3).'
          }
        }
      ]
    },
    {
      title: 'Done',
      cards: [
        {
          title: 'Open your first vault',
          seed: {
            body:
              'A vault is a folder of workspaces, kept as Markdown and JSON on your disk. ' +
              'Make a workspace of your own from New workspace in the sidebar, and throw ' +
              'this one away when you no longer need it.'
          }
        }
      ]
    }
  ]
}

export async function createExampleWorkspace(vaultPath: string, captureKey: string): Promise<string> {
  const path = await createWorkspace(vaultPath, EXAMPLE_NAME)
  const columns: Column[] = []
  for (const stage of exampleColumns(captureKey)) {
    const ids: string[] = []
    // One at a time, top to bottom: each card takes the first free file name,
    // and the order they are made in is the order the column lists them.
    for (const card of stage.cards) ids.push((await createCard(path, card.title, card.seed)).id)
    columns.push({ id: newId('c'), title: stage.title, cards: ids, extra: {} })
  }
  await writeColumns({ workspacePath: path, columns, extra: {} })
  return path
}
