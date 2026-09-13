// Labels. They moved off names and onto colour. Six are ready in every
// workspace, a card may wear any number of them, and a colour may be given a
// name - the name is a note about the colour, not the thing itself.
//
// What a card carries in its file is the colour's own word:
//
//   tags:
//     - green
//     - red
//
// The word rather than an id, and the word rather than the hex, for two
// reasons. A card written by hand or by an agent says what it means, which is
// the promise the whole format makes; and a name given to a colour later
// rewrites nothing, because no card ever held the name.
//
// Pure data and pure functions, so both windows and the tests can read them.

import type { Label } from './types'

export const LABEL_KEYS = ['green', 'yellow', 'orange', 'red', 'purple', 'blue'] as const

export type LabelKey = (typeof LABEL_KEYS)[number]

// The six. Absolute colours, like everything else the user's file holds: a
// label written down in one theme is the same label in the other.
//
// They are held to a rule rather than to a value, the way the board's
// background presets have been, and the rule is
// this: every one of them stands at least 3 to 1 against
// `--bg-card` AND `--bg-column` in BOTH themes. That is what makes a bare
// colour readable as a mark - on a card, on the board's column, on a light
// page and on a dark one - without a border to prop it up.
//
// The band that rule leaves is narrow: a relative luminance between about 0.20
// and 0.30, since anything lighter fails against the white card and anything
// darker fails against the dark one. So these are mid-tones by arithmetic, not
// by taste - which is why the yellow is an olive rather than a lemon, and why
// all six come out at the same lightness, L* 53 give or take a tenth.
//
// That is also why the second rule is about hue and not about brightness: with
// lightness spent on the contrast, telling green from yellow is all that is
// left, so the six are held to at least 20 of CIE Lab distance from each other
// - an order of magnitude over the 2.3 two colours have to differ by to be seen
// as two at all, because a label is recognised from memory rather than held up
// against the one beside it. The warm three are the tight corner: yellow and
// orange sit 27 apart and everything else is over 40.
export const LABEL_COLORS: Record<LabelKey, string> = {
  green: '#2e8f5e',
  yellow: '#858228',
  orange: '#ad722d',
  red: '#e8403a',
  purple: '#b05cd0',
  blue: '#3b7fd9'
}

// Which of the six a tag is, or null when it is a name somebody wrote. Without
// case, the way a tag has always been matched: a card that says "Green" is
// wearing the green label.
export function labelKeyOf(tag: string): LabelKey | null {
  const lower = tag.toLowerCase()
  return (LABEL_KEYS as readonly string[]).includes(lower) ? (lower as LabelKey) : null
}

// What to call a colour that was never named. The colour's own word, so a
// filter row and a search hit have something to say - the kanban card shows the
// colour itself and says nothing.
export const labelWord = (key: string): string => key.charAt(0).toUpperCase() + key.slice(1)

// The words a label is shown by where words are needed. A name if it was given
// one, the colour's word if not.
export const labelText = (label: Label): string =>
  label.name || (label.key ? labelWord(label.key) : '')

// One of the six, as a workspace's own list of labels has it. A workspace is
// free to name a colour and free to write a different hex for it - the file
// wins over the default, which is the same rule every other field follows.
// Given the list rather than the workspace, so the one place with no workspace
// to hand - a tag asked about across the whole vault - can still ask.
export function colourLabel(labels: Label[], key: LabelKey): Label {
  const own = labels.find((label) => label.key === key)
  return { key, name: own?.name ?? '', color: own?.color ?? LABEL_COLORS[key] }
}
