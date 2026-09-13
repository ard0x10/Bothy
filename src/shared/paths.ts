const SEPARATORS = ['/', '\\']

// Paths arrive from the main process in whatever shape the platform uses, and
// the renderer has no node path module to lean on.
export function fileName(path: string): string {
  let cut = -1
  for (const separator of SEPARATORS) {
    cut = Math.max(cut, path.lastIndexOf(separator))
  }
  return cut === -1 ? path : path.slice(cut + 1)
}
