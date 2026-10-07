import { fileUrl, isImageName } from './image'

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
//   "background": { "type": "image", "name": "meadow.jpg" }
//
// No key is the default, and it means what it says: the board sits on the
// app's own ground and follows the theme.
//
// A picture is named the way a card's attachment is named: a bare file name in
// the workspace's own files/ folder. Both the ones the app ships and the one a
// person chooses are copied in there, which keeps the rule the whole format is
// built on - a workspace is a folder you can move, and the ground moves with it.
export type Background =
  | { type: 'color'; color: string }
  | { type: 'gradient'; from: string; to: string }
  | { type: 'image'; name: string }

// What <input type="color"> produces, and the only thing let through. The value
// goes straight into an inline style, so anything else is a board that paints
// wrong with nothing to say why - the argument cleanColors makes for the theme.
const HEX = /^#[0-9a-f]{6}$/i

const hex = (value: unknown): string | null =>
  typeof value === 'string' && HEX.test(value) ? value.toLowerCase() : null

// A bare name of a picture, and nothing that could reach out of files/. The
// same rule attachments go by, written here because this file is read in both
// processes and that one is main's. Main checks it again when the url is
// resolved, so this is the door and not the lock.
const picture = (value: unknown): string | null => {
  if (typeof value !== 'string' || value === '' || value === '.' || value === '..') return null
  if (/[\\/]/.test(value) || /^[a-zA-Z]:/.test(value)) return null
  if (/[<>:"|?*\u0000-\u001f]/.test(value)) return null
  return isImageName(value) ? value : null
}

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
  if (entry.type === 'image') {
    const name = picture(entry.name)
    return name ? { type: 'image', name } : undefined
  }
  return undefined
}

// One direction, top left to bottom right. There is no control for it, so there
// is no key for it either: a value nobody can set is a value nobody can read
// back as meaning something.
//
// A picture is asked for from the folder it sits in, which is why the workspace
// comes in. It covers the board and is centred: the ground is whatever size the
// window is and the board is wider still, so a picture laid at its own size
// would be a picture with an edge in the middle of the screen. Cover crops
// instead, and centring decides what the crop keeps.
export function backgroundCss(background: Background, workspacePath: string): string {
  if (background.type === 'color') return background.color
  if (background.type === 'gradient') {
    return `linear-gradient(135deg, ${background.from}, ${background.to})`
  }
  return `#0000 url("${fileUrl(workspacePath, background.name)}") center / cover no-repeat`
}

// The ground again, worn by the workspace's row in the sidebar, and darker
// than the board wears it so a white name can stand on it. How much darker is
// worked out, not picked: the least black laid over it that puts white at 7 to
// 1 against the lightest point of the ground, the contrast asked of body text
// at its strictest. The presets above sit at 4 to 1 with white, so each one
// comes out about a third darker and keeps its hue. A picture is any colour at
// all, so it is shaded for the worst one it could hold, which is white.
//
// The ink is written here rather than in the theme blocks for that reason: the
// shade is measured against this white, and a theme that changed one without
// the other would undo the measurement.
export const GROUND_INK = '#ffffff'
const GROUND_CONTRAST = 7

const channel = (value: number): number => {
  const v = value / 255
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

const lightness = (rgb: number[]): number =>
  0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2])

const rgbOf = (color: string): number[] =>
  [1, 3, 5].map((at) => parseInt(color.slice(at, at + 2), 16))

// In hundredths, rounded up, so the shade never lands a hair short of the
// contrast it was worked out for.
export function groundShade(background: Background): number {
  const stops =
    background.type === 'color'
      ? [rgbOf(background.color)]
      : background.type === 'gradient'
        ? [rgbOf(background.from), rgbOf(background.to)]
        : [[255, 255, 255]]
  const lightest = stops.reduce((a, b) => (lightness(a) >= lightness(b) ? a : b))
  for (let step = 0; step <= 100; step++) {
    const left = 1 - step / 100
    const under = lightness(lightest.map((value) => value * left))
    if (1.05 / (under + 0.05) >= GROUND_CONTRAST) return step / 100
  }
  return 1
}

export function shadedGroundCss(background: Background, workspacePath: string): string {
  const shade = `rgb(0 0 0 / ${groundShade(background)})`
  return `linear-gradient(${shade}, ${shade}), ${backgroundCss(background, workspacePath)}`
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

// The pictures the app ships with, in resources/backgrounds/. Picking one
// copies it into the workspace's files/ the same way choosing one of your own
// does, so nothing here is a name only this app can resolve: what lands in
// workspace.json is a file sitting next to it.
//
// They are white while there are no photographs to put here yet. The names are
// the thing to keep when the pictures arrive - a workspace already wearing
// photo-3 keeps wearing it, because its own copy is in its own folder. Each
// white one carries its own name inside the file, because a copy is settled by
// content: six files holding the same bytes would be one file in the folder,
// and picking the third would leave the first one ticked.
export const PHOTO_PRESETS: readonly string[] = [
  'photo-1.png',
  'photo-2.png',
  'photo-3.png',
  'photo-4.png',
  'photo-5.png',
  'photo-6.png'
]

export const GRADIENT_PRESETS: readonly (readonly [string, string])[] = [
  ['#2c80e2', '#eb376a'],
  ['#308d8d', '#2c80e2'],
  ['#d45a2b', '#d138dc'],
  ['#2f923a', '#83842b'],
  ['#748192', '#2c80e2']
]
