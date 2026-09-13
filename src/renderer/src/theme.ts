import { COLOR_TOKENS, type Colors } from '../../shared/colors'

// Step 9 of v0.2, and the whole of how a custom colour reaches the window.
//
// Written as an inline style on the root element rather than as a third block
// in the stylesheet. An inline style beats both `:root {}` and the light
// theme's media query without anyone having to win a specificity argument, so
// the same eleven declarations sit over whichever theme is on - which is the
// shape we picked: one set, laid over the theme, rather than a set per
// theme.
//
// A token the user has not touched is REMOVED rather than set to the value the
// theme currently gives it. Writing the current value back would look
// identical and be a different thing: it would freeze that token against the
// next theme change, so a light-theme user who once opened this sheet would
// keep light greys after switching to dark, with nothing to undo it.
export function applyColors(colors: Colors): void {
  const root = document.documentElement
  for (const token of COLOR_TOKENS) {
    const value = colors[token]
    if (value) root.style.setProperty(`--${token}`, value)
    else root.style.removeProperty(`--${token}`)
  }
}

// What a token is painted with right now, custom or not: the colour the picker
// has to open on, or the user would start from a value nobody is looking at.
// Read off the resolved style rather than off the stylesheet, so it is the
// answer the window arrived at - theme, media query and any override included.
export function currentColors(): Record<string, string> {
  const style = getComputedStyle(document.documentElement)
  const now: Record<string, string> = {}
  for (const token of COLOR_TOKENS) now[token] = style.getPropertyValue(`--${token}`).trim()
  return now
}
