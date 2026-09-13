// The board's own ground, step 5 of the kanban's look. The decision:
// a plain colour or a gradient for now, pictures later. Both are drawn by the
// stylesheet, so this costs the build nothing.
//
// One key in workspace.json, written for whoever opens that file next - a
// person or an agent - as much as for this app. The type says which of the two
// it is, and the colours are the six digit hex every other colour here is:
//
//   "background": { "type": "color", "color": "#2d3e5c" }
//   "background": { "type": "gradient", "from": "#2d3e5c", "to": "#5a2436" }
//
// No key is the default, and it means what it says: the board sits on the
// app's own ground and follows the theme.
export type Background =
  | { type: 'color'; color: string }
  | { type: 'gradient'; from: string; to: string }

// What <input type="color"> produces, and the only thing let through. The value
// goes straight into an inline style, so anything else is a board that paints
// wrong with nothing to say why - the argument cleanColors makes for the theme.
const HEX = /^#[0-9a-f]{6}$/i

const hex = (value: unknown): string | null =>
  typeof value === 'string' && HEX.test(value) ? value.toLowerCase() : null

// Undefined for anything that is not one of the two shapes, a shape a later
// version might add included. That is read as no background rather than
// guessed at.
export function cleanBackground(value: unknown): Background | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const entry = value as Record<string, unknown>
  if (entry.type === 'color') {
    const color = hex(entry.color)
    return color ? { type: 'color', color } : undefined
  }
  if (entry.type === 'gradient') {
    const from = hex(entry.from)
    const to = hex(entry.to)
    return from && to ? { type: 'gradient', from, to } : undefined
  }
  return undefined
}

// One direction, top left to bottom right. There is no control for it, so there
// is no key for it either: a value nobody can set is a value nobody can read
// back as meaning something.
export function backgroundCss(background: Background): string {
  return background.type === 'color'
    ? background.color
    : `linear-gradient(135deg, ${background.from}, ${background.to})`
}

export function sameBackground(a: Background | undefined, b: Background | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

// What the picker offers before anyone reaches for a colour of their own. This
// file's own colours, not taken from anywhere. They are the user's choice once
// picked, like a label's colour, which is why they live here and not in the
// theme blocks of the stylesheet.
//
// The first nine were too dark and too dull, and measured they
// were. Against the dark theme's column the best of them stood at 1.83 to 1
// and the worst at 1.37, so the columns sank into the ground meant to hold
// them up. The rule since is one from outside this file: every colour, and
// every point along a gradient, stands at least 3 to 1 against the column
// ground of both themes - the contrast asked of any part of a screen a person
// has to tell apart from what is beside it. That leaves a band of lightness,
// and every hue here is at its most vivid at the light end of the band, so
// that is where each one sits: 4.2 to 1 on the dark column, 3.1 on the light.
//
// How vivid is a choice, not a measurement: 85 in a hundred of the most the
// screen can show at that lightness. All of it is one channel at zero, and
// that reads as a warning light rather than as a ground. The grey keeps a
// trace of blue.
export const COLOR_PRESETS: readonly string[] = [
  '#2c80e2',
  '#308d8d',
  '#2f923a',
  '#83842b',
  '#ac742b',
  '#d45a2b',
  '#eb376a',
  '#d138dc',
  '#748192'
]

export const GRADIENT_PRESETS: readonly (readonly [string, string])[] = [
  ['#2c80e2', '#eb376a'],
  ['#308d8d', '#2c80e2'],
  ['#d45a2b', '#d138dc'],
  ['#2f923a', '#83842b'],
  ['#748192', '#2c80e2']
]
