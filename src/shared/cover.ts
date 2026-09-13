import { isImageName } from './image'

// A card's cover is one key in its frontmatter, and it has always been a
// colour: a hand-written `cover: "#e0a04a"` drew the thin band across the top
// of the card. Pictures go in the same key -
// `cover: cover.png` is what an agent reading the file would
// expect a picture cover to look like, and a second key would be two answers
// to one question. A colour never ends in .png, so the key says which it is.
//
// The name is bare, like every attachment. The window reaches it through the
// bothy-file scheme, which checks it again on the way to the disk.
export function coverImage(card: { cover?: string }): string | null {
  const cover = card.cover?.trim()
  if (!cover || /[\\/]/.test(cover)) return null
  return isImageName(cover) ? cover : null
}

// What is left once a picture is ruled out. Undefined for a card with no cover
// and for one whose cover is a picture, so a caller that paints a colour paints
// nothing rather than a file name.
// A name with an image extension that is not a picture - one that could hold
// a path - is not a colour either, and paints nothing.
export function coverColor(card: { cover?: string }): string | undefined {
  const cover = card.cover?.trim()
  if (!cover || isImageName(cover)) return undefined
  return cover
}

// The colour a picture's band is filled with when the card is open, taken from
// the picture. A poster on black stands on its own orange, so the question
// this answers is not "what colour is most of it" - that is the black - but
// "what colour is it". The pixels with colour
// in them are weighed by how much, squared, so a title in orange beats a face
// in brown and both beat a black ground however much of it there is. A picture
// with almost no colour in it gets its most common grey instead, and the band
// is that.
//
// Pixels come four bytes each. Main hands over what its decoder holds, which is
// blue first on this machine, so the order is said rather than assumed.
export function pickColor(pixels: Uint8Array, order: 'rgba' | 'bgra' = 'rgba'): string | null {
  const red = order === 'rgba' ? 0 : 2
  const blue = order === 'rgba' ? 2 : 0
  const vivid = new Map<number, number[]>()
  const plain = new Map<number, number[]>()
  let seen = 0
  let lively = 0

  for (let i = 0; i + 3 < pixels.length; i += 4) {
    // Mostly see-through is not part of what the picture looks like on a band.
    if (pixels[i + 3] < 128) continue
    const r = pixels[i + red]
    const g = pixels[i + 1]
    const b = pixels[i + blue]
    seen++
    const high = Math.max(r, g, b)
    const low = Math.min(r, g, b)
    const chroma = (high - low) / 255
    const light = (high + low) / 510
    const colourful = chroma >= 0.15 && light >= 0.12 && light <= 0.9
    if (colourful) lively++
    // Eight steps a channel. Fine enough to keep an orange apart from a brown,
    // coarse enough that one colour is one bucket rather than forty.
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5)
    const into = colourful ? vivid : plain
    const weight = colourful ? chroma * chroma : 1
    const sum = into.get(key) ?? [0, 0, 0, 0]
    sum[0] += weight
    sum[1] += r * weight
    sum[2] += g * weight
    sum[3] += b * weight
    into.set(key, sum)
  }
  if (seen === 0) return null

  // Four in a hundred pixels. Under that the colour is a speck - a logo's dot,
  // a stray pixel of noise - and filling a band with it would be a lie about
  // the picture.
  const from = lively >= seen * 0.04 ? vivid : plain
  let best: number[] | null = null
  for (const sum of from.values()) if (best === null || sum[0] > best[0]) best = sum
  if (best === null || best[0] === 0) return null
  const hex = (value: number): string =>
    Math.round(value / best![0])
      .toString(16)
      .padStart(2, '0')
  return '#' + hex(best[1]) + hex(best[2]) + hex(best[3])
}
