import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// A pause between a tool reading a file and writing it, for measuring
// and nothing else. v0.4 step 6: every write is held to what was read, and the
// only way to measure that is for something to write the file in between. The
// server is its own process, so the test cannot reach in and do it; it can only
// be told when the gap is open.
//
// With BOTHY_TEST_HOLD naming a folder, the server leaves a file called `held`
// there saying what it is about to write, and waits until the test deletes it.
// Without it this returns at once. Bounded, so a test that forgot to let go
// fails on its own timeout rather than leaving a server that never answers.
const WAIT_MS = 10_000

export async function hold(what: string): Promise<void> {
  const dir = process.env.BOTHY_TEST_HOLD
  if (!dir) return
  const flag = join(dir, 'held')
  writeFileSync(flag, what, 'utf8')
  const from = Date.now()
  while (existsSync(flag) && Date.now() - from < WAIT_MS) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
