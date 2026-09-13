import { nativeImage } from 'electron'
import { pickColor } from '../shared/cover'
import { resolveAttachment } from './vault/attach'

// The colour a card's picture band is filled with. Worked out here rather than
// in the window, and not by choice: the window draws an attachment down the
// bothy-file scheme, which is another origin as far as a page served from
// file: is concerned, so a canvas the picture is drawn onto is tainted and will
// not give its pixels back. Main decodes the file itself.
//
// Shrunk to 160 on its longer side first, and the number was measured rather
// than picked. On a poster whose colour is a title in thin letters, the
// band came out #b48850 at 48, #ca9959 at 96, #d7a25e at 160 and #d8a35e from
// every pixel: a small copy blends a thin stroke into the black round it and
// the colour goes muddy. 160 is one step from the whole picture, at 2 ms
// against 15.
//
// Null for a name the rule refuses, a file that is not there, and a format the
// decoder here does not read (it takes PNG and JPEG, and more on some
// systems). The band is then the theme's own ground, which is what a card
// whose picture is missing looks like everywhere else.
const SIDE = 160

export function coverColor(workspacePath: string, name: string): string | null {
  const path = resolveAttachment(workspacePath, name)
  if (path === null) return null
  let image = nativeImage.createFromPath(path)
  if (image.isEmpty()) return null
  const size = image.getSize()
  const scale = Math.min(1, SIDE / Math.max(size.width, size.height))
  if (scale < 1) {
    image = image.resize({
      width: Math.max(1, Math.round(size.width * scale)),
      height: Math.max(1, Math.round(size.height * scale)),
      quality: 'good'
    })
  }
  // Blue first: what the decoder keeps on a little-endian machine, which is
  // every machine this app runs on. The run checks it with an orange poster,
  // which read the other way round comes out blue (measured).
  return pickColor(new Uint8Array(image.toBitmap()), 'bgra')
}
