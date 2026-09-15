import { readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { Card, Checklist, Template } from '../../shared/types'
import { coverColor } from '../../shared/cover'
import { parseCard, serializeCard } from './format'
import { freeFile, slug } from './create'
import { oneNameAtATime, writeText } from './writer'

// Step 5 of v0.2. A template is a card that has not been made yet, and it is
// kept as a card file in the workspace's own templates/ folder rather than as
// a section of some settings file. Three things follow from that and all three
// are the point: it can be written by hand in any editor, it is read by the
// same parser the cards go through, and it travels with the folder - the same
// promise attachments were given in step 3.
export const TEMPLATES = 'templates'

export function templatesDir(workspacePath: string): string {
  return join(workspacePath, TEMPLATES)
}

// What may be asked for. A bare file name ending in .md, so the folder cannot
// be stepped out of: the directory is fixed here the way files/ is, and a name
// that could hold a separator could name something outside the workspace. It
// is stricter than the attachment rule rather than a copy of it, because a
// template is always a card file and nothing else.
export function isTemplateFile(name: string): boolean {
  if (!name || !/\.md$/i.test(name)) return false
  if (/[\\/]/.test(name)) return false
  if (/^[a-zA-Z]:/.test(name)) return false
  return !/[<>:"|?*\u0000-\u001f]/.test(name)
}

// A card is born with nothing ticked, whatever the template file happens to
// say. One rule in one place: it is used when a template is written from a
// card as well, so the file on disk and the card that comes out of it cannot
// tell two different stories.
export function freshChecklists(lists: Checklist[]): Checklist[] {
  return lists.map((list) => ({
    name: list.name,
    items: list.items.map((item) => ({ text: item.text, done: false }))
  }))
}

function toTemplate(file: string, card: Card): Template {
  return {
    name: card.title,
    file,
    tags: card.tags,
    checklists: card.checklists,
    body: card.body,
    // A colour and nothing else. A template carries no attachments, so a
    // picture cover would name a file the card born from it does not have.
    cover: coverColor(card),
    priority: card.priority,
    extra: card.extra
  }
}

// Everything in templates/, in name order. A template whose frontmatter does
// not parse is left out and said out loud through the same notes a broken card
// uses: a template that silently does nothing is worse than one that is
// missing, because the menu would offer it and the card would come out empty.
export async function readTemplates(
  workspacePath: string,
  notes: string[] = []
): Promise<Template[]> {
  const dir = templatesDir(workspacePath)
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }

  const out: Template[] = []
  for (const name of names.filter(isTemplateFile).sort((a, b) => a.localeCompare(b))) {
    const card = parseCard(join(dir, name), await readFile(join(dir, name), 'utf8'))
    if (card.broken) {
      notes.push(`templates/${name}: frontmatter did not parse (${card.broken})`)
      continue
    }
    out.push(toTemplate(name, card))
  }
  return out
}

// One template by the name a card was asked to be made from, or null. Every
// path that reaches the disk from the renderer goes through the name rule
// above, so a request for `../../elsewhere.md` reads nothing.
export async function readTemplate(
  workspacePath: string,
  name: string
): Promise<Template | null> {
  if (!isTemplateFile(name)) return null
  const file = join(templatesDir(workspacePath), name)
  try {
    const card = parseCard(file, await readFile(file, 'utf8'))
    return card.broken ? null : toTemplate(name, card)
  } catch {
    return null
  }
}

// What a card born from this template starts out holding. Deliberately not in
// here: the id, the dates and the attachments. A due date would be the day the
// template was written rather than the day the card is wanted, and a card is
// the only thing that gets to own an id.
export function cardSeed(template: Template): Partial<Card> {
  return {
    tags: [...template.tags],
    checklists: freshChecklists(template.checklists),
    body: template.body,
    cover: coverColor(template),
    priority: template.priority,
    extra: { ...template.extra }
  }
}

// Writes one, from a card that is open. The file is named after the card's
// title the same way the card's own file was, and nothing is ever overwritten:
// the second template to want a name takes `-2`, because the file already
// there is somebody's and nobody asked for it to go.
//
// The title is written into the file, so the menu shows what the card was
// called rather than the flattened file name. Renaming a template afterwards
// is editing that line, or renaming the file - both are just a folder.
export async function saveTemplate(workspacePath: string, card: Card): Promise<string> {
  const dir = templatesDir(workspacePath)
  return oneNameAtATime(dir, () => writeTemplate(dir, card))
}

async function writeTemplate(dir: string, card: Card): Promise<string> {
  const file = await freeFile(dir, slug(card.title))
  const stored: Card = {
    // No id: an id belongs to a card, and a template is not one. serializeCard
    // drops the key rather than writing an empty one.
    id: '',
    title: card.title,
    file,
    hash: '',
    tags: card.tags,
    checklists: freshChecklists(card.checklists),
    files: [],
    body: card.body,
    cover: coverColor(card),
    priority: card.priority,
    extra: card.extra
  }
  await writeText(file, serializeCard(stored))
  return basename(file)
}
