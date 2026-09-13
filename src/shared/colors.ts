// The colours the user may change, step 9 of v0.2.
//
// We picked the scope: these eleven and not the other six the stylesheet
// declares. The three shadows and the scrim are left out because they are not
// colours - `0 12px 24px rgba(0, 0, 0, 0.45)` wants a text box rather than a
// colour picker, and a value typed wrong in one deletes the shadow with
// nothing on screen to say why. The two washes are left out for the opposite
// reason: each is a color-mix() of an accent that is on this list, so they
// follow it without ever being set.
//
// Together these reach the whole window. Step 8 left the stylesheet with no
// colour written outside its two theme blocks - there is a check that walks
// the file and says so - so a surface these eleven cannot reach is a surface
// painted by a shadow, by a wash, or by the browser's own furniture.
export const COLOR_TOKENS = [
  'bg-app',
  'bg-column',
  'bg-card',
  'bg-card-hover',
  'text',
  'text-dim',
  'border',
  'accent',
  'on-accent',
  'late',
  'soon'
] as const

export type ColorToken = (typeof COLOR_TOKENS)[number]

// One set, laid over whichever theme is on. That was the second answer, and
// it is why this is Partial rather than a full record: only the tokens the
// user actually moved are written down. Someone who changed the accent and
// nothing else still gets the whole light palette when the desktop turns
// light, because the other ten were never taken away from the theme.
export type Colors = Partial<Record<ColorToken, string>>

const TOKENS = new Set<string>(COLOR_TOKENS)

// What <input type="color"> produces, and nothing else. Not a courtesy: this
// value is written into state.json, read back at the next launch and put
// straight into an inline style on the root element, so anything that is not a
// colour is a window that opens wrong with nothing to say why.
const HEX = /^#[0-9a-f]{6}$/i

export function cleanColors(value: unknown): Colors {
  if (typeof value !== 'object' || value === null) return {}
  const clean: Colors = {}
  for (const [token, colour] of Object.entries(value as Record<string, unknown>)) {
    if (!TOKENS.has(token)) continue
    if (typeof colour !== 'string' || !HEX.test(colour)) continue
    clean[token as ColorToken] = colour.toLowerCase()
  }
  return clean
}

// How the saved set reaches the window it paints, before that window paints.
// The renderer cannot read state.json and an ipc round trip lands a frame
// late - which is the flash step 8 went out of its way to avoid - so main
// hands the answer over as an argument and the preload reads it back. One
// road: this is where the renderer learns its colours, and the ipc call below
// only ever writes.
const ARG = '--bothy-colors='

export function colorsArgument(colors: Colors): string {
  return ARG + JSON.stringify(colors)
}

export function colorsFromArguments(argv: readonly string[]): Colors {
  const found = argv.find((arg) => arg.startsWith(ARG))
  if (!found) return {}
  try {
    // Cleaned on the way in as well as on the way out. The argument comes from
    // main, but it comes through a command line, and a value that arrives torn
    // should paint nothing rather than paint wrong.
    return cleanColors(JSON.parse(found.slice(ARG.length)))
  } catch {
    return {}
  }
}
