// A title is a line of plain text, and a line of plain text with an address in
// it is the ordinary way a link reaches a card: pasted into the box that names
// it. This is what finds the address again when the card is drawn.
//
// http and https only, which is the same net main's guard casts - it hands
// those two to the system browser and drops everything else. A wider net here
// would paint something blue that pressing it cannot open.
const LINK = /https?:\/\/\S+/g

// Trailing punctuation belongs to the sentence, not to the address. A link at
// the end of "see https://example.com." stops before the full stop, and a
// closing bracket only comes along if the address opened one.
const TRAILING = /[.,;:!?'"]+$/

export type TitlePart = { text: string; href: string | null }

export function partsOf(title: string): TitlePart[] {
  const parts: TitlePart[] = []
  let at = 0
  for (const found of title.matchAll(LINK)) {
    const start = found.index ?? 0
    let text = found[0].replace(TRAILING, '')
    while (text.endsWith(')') && (text.match(/\(/g)?.length ?? 0) < (text.match(/\)/g)?.length ?? 0)) {
      text = text.slice(0, -1)
    }
    if (text === '') continue
    if (start > at) parts.push({ text: title.slice(at, start), href: null })
    parts.push({ text, href: text })
    at = start + text.length
  }
  if (at < title.length) parts.push({ text: title.slice(at), href: null })
  return parts
}
