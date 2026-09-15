// Someone who has told the system they want less movement gets what the app
// used to do: the panel is there or it is not, and a column arrives at its end
// rather than travelling there. One answer, read the same way everywhere, so
// the two surfaces cannot disagree about what the setting means.
export const stillness = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches
