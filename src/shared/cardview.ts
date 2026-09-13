// Where a card opens, one answer for the whole app: a sheet in the middle of
// the window, or the panel from the right. Both stay, and Settings picks
// between them.
//
// A sheet in the middle of the window is what a fresh install opens with, and
// that was the pick too. The panel down the right side is the other answer,
// and the only one the app had until now.
export type CardView = 'sheet' | 'panel'

export const CARD_VIEW_DEFAULT: CardView = 'sheet'

// state.json is a file a person can edit and an older version can leave
// behind, so what comes back from it is checked rather than believed.
export function readCardView(value: unknown): CardView {
  return value === 'sheet' || value === 'panel' ? value : CARD_VIEW_DEFAULT
}
