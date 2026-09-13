import { watch, type FSWatcher } from 'chokidar'
import type { VaultChange } from '../../shared/types'
import { forgetWrite, isOwnWrite } from './writer'

// What the watcher never reports: the app's own plumbing, and the temp file a
// write is staged under. The predicate is exported so the second half of that
// claim can be checked against the name the writer actually uses.
export function isIgnored(path: string): boolean {
  // Both separators: on Windows these arrive as backslash paths, and a class
  // of just [/] matched none of them, so .app and .trash were being watched
  // on the one platform the app is built for first.
  return (
    /(^|[\\/])(\.app|\.trash|node_modules|\.git)([\\/]|$)/.test(path) ||
    /\.tmp\d+$/.test(path)
  )
}

export type WatchHandle = { close: () => Promise<void> }

export function watchVault(
  vaultPath: string,
  onChange: (change: VaultChange) => void
): WatchHandle {
  const watcher: FSWatcher = watch(vaultPath, {
    ignoreInitial: true,
    ignored: isIgnored,
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 30 }
  })

  const report = async (kind: VaultChange['kind'], file: string): Promise<void> => {
    if (kind !== 'unlink') {
      if (await isOwnWrite(file)) return
      // Somebody else wrote it, so what the app last wrote there is no longer a
      // claim on the file. Kept, it would hide the file being put back exactly as
      // the app left it - an editor's undo of a broken save - which is a change
      // from outside like any other. v0.4 step 6, measured in the conflict section.
      forgetWrite(file)
    }
    onChange({ kind, file, at: Date.now() })
  }

  watcher.on('add', (file) => void report('add', file))
  watcher.on('change', (file) => void report('change', file))
  watcher.on('unlink', (file) => void report('unlink', file))

  return { close: () => watcher.close() }
}
