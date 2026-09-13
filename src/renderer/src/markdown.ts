import DOMPurify from 'dompurify'
import { marked } from 'marked'

marked.setOptions({ gfm: true, breaks: true })

// The description is markdown on disk, so it is markdown on screen. It comes
// from a file the user may not have written themselves, and this renderer runs
// inside the app window, so the html goes through a sanitiser before it lands.
// Where a link goes is the main process's problem: see the navigation guards in
// main/index.ts, which keep a click from steering the window off the app.
export function renderMarkdown(source: string): string {
  const html = marked.parse(source, { async: false })
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })
}
