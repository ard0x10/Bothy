// Short ids, readable in a file a person may open. Both sides need them now
// that columns are created in the renderer, so the one implementation lives
// here rather than being written twice.
//
// The width is a parameter because the canvas needs a wider one: four hex
// digits is 65,536 values, which a board of dozens of cards lives inside and a
// canvas of hundreds of objects does not. The reasoning, with the numbers, is
// on OBJECT_ID_WIDTH in shared/canvas.ts.
const HEX = '0123456789abcdef'

export function newId(prefix = 'k', width = 4): string {
  let id = ''
  // Drawn a digit at a time rather than sliced off a random float: the float
  // gives a variable number of digits, so asking it for eight was a short id
  // some of the time and nothing said so.
  for (let i = 0; i < width; i++) id += HEX[Math.floor(Math.random() * 16)]
  return `${prefix}_${id}`
}
