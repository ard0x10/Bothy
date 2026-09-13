import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { GUIDE_FILE, guide } from './guide'

// npm run docs. Written beside and renamed into place, like every other file
// this app writes.
const target = join(process.cwd(), GUIDE_FILE)
const text = guide()
mkdirSync(dirname(target), { recursive: true })
writeFileSync(`${target}.tmp1`, text, 'utf8')
renameSync(`${target}.tmp1`, target)
console.log(`${GUIDE_FILE}: ${Buffer.byteLength(text, 'utf8')} bytes`)
