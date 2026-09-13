import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'

// One definition, used by the writer to spot its own writes and by the reader
// to hand each card the fingerprint of the file it came from.
export function hashText(text: string): string {
  return createHash('sha1').update(text).digest('hex')
}

// The same fingerprint over bytes rather than text. What a pasted image is
// settled by: the clipboard hands over pixels, and whether they are already in
// the workspace is a question about the bytes, not about a name nobody gave.
export function hashBytes(bytes: Uint8Array): string {
  return createHash('sha1').update(bytes).digest('hex')
}

// And over a file, without reading it into memory first. An image is megabytes
// where a card is a page, and the whole reason for asking is to avoid keeping a
// second copy of those megabytes - doing it by loading both would be an odd way
// to save the space.
export function hashFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const digest = createHash('sha1')
    const stream = createReadStream(path)
    stream.on('error', reject)
    stream.on('data', (chunk) => digest.update(chunk))
    stream.on('end', () => resolve(digest.digest('hex')))
  })
}
