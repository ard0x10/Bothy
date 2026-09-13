import { access, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Card } from '../../shared/types'
import { parseCard, serializeCard } from './format'
import { newId } from '../../shared/id'
import { writeText } from './writer'

// The file name comes from the title and then never changes again. Renaming on
// every edit would break links other programs hold, and a folder full of ids is
// not a folder anyone wants to open.
export function slug(title: string): string {
  const cleaned = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return cleaned || 'card'
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

// The first free `<base>.md` in a folder, making the folder if it is not there.
// Templates want the same rule cards have - nothing is overwritten, the second
// one to want a name takes `-2` - so it is one function rather than a copy that
// drifts.
export async function freeFile(dir: string, base: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  for (let n = 1; ; n++) {
    const file = join(dir, n === 1 ? `${base}.md` : `${base}-${n}.md`)
    if (!(await exists(file))) return file
  }
}

// `seed` is what a template puts on the card before it is written. Empty for an
// ordinary new card, which is the path every earlier step measures, so the two
// share one road to disk rather than two that can disagree about what a new
// card is. What it may not carry is the card's own identity: the id, the file
// and the hash are set here, after the seed, so no template can name them.
export async function createCard(
  workspacePath: string,
  title: string,
  seed: Partial<Card> = {}
): Promise<Card> {
  const dir = join(workspacePath, 'kanban', 'cards')

  const file = await freeFile(dir, slug(title))
  const card: Card = {
    tags: [],
    checklists: [],
    files: [],
    body: '',
    extra: {},
    ...seed,
    id: newId(),
    title: title.trim() || 'Untitled',
    file,
    hash: '',
    created: new Date().toISOString().slice(0, 10)
  }

  const text = serializeCard(card)
  await writeText(file, text)
  // Parse what actually landed, so the card in the app is the card on disk,
  // hash included, rather than the object we hoped we wrote.
  return parseCard(file, text)
}
