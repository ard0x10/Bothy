import type { ReactNode } from 'react'

// Every icon in the app, drawn here as 16 by 16 strokes in the colour of the
// text around them. Not typed characters: a glyph is whatever this machine's
// font makes of it. Drawn for this app, from plain lines and circles; nothing
// here is traced from a set.
export type IconName =
  | 'plus'
  | 'minus'
  | 'close'
  | 'check'
  | 'more'
  | 'tag'
  | 'clock'
  | 'checklist'
  | 'lines'
  | 'flag'
  | 'file'
  | 'fields'
  | 'archive'
  | 'restore'
  | 'template'
  | 'trash'
  | 'filter'
  | 'pencil'
  | 'arrow-left'
  | 'arrow-right'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'collapse'
  | 'expand'
  | 'gear'
  | 'help'
  | 'fit'
  | 'transfer'
  | 'folder'
  | 'search'
  | 'kanban'
  | 'canvas'
  | 'calendar'
  | 'pointer'
  | 'box'
  | 'text'
  | 'arrow'
  | 'image'
  | 'line'
  | 'arrows'
  | 'dashed'
  | 'align-left'
  | 'align-center'
  | 'align-right'
  | 'ellipse'
  | 'triangle'
  | 'diamond'
  | 'highlighter'
  | 'eraser'
  | 'undo'
  | 'redo'
  | 'bookmark'
  | 'bookmark-on'
  | 'workspaces'
  | 'paperclip'
  | 'external'
  | 'chevron-up'
  | 'text-style'
  | 'text-colour'
  | 'border'
  | 'valign-top'
  | 'valign-middle'
  | 'valign-bottom'
  | 'front'
  | 'back'
  | 'copy'
  // More things held than the bar's head lists one by one. Three boxes
  // stepped back, so it reads as a pile rather than as one more shape.
  | 'stack'

const DRAWN: Record<IconName, ReactNode> = {
  paperclip: (
    <path d="M10.5 5.25L6.25 9.5a1.25 1.25 0 0 0 1.75 1.75l4.5-4.5a2.5 2.5 0 0 0-3.5-3.5L4.25 8a3.75 3.75 0 0 0 5.25 5.25l3.75-3.75" />
  ),
  external: (
    <path d="M9.5 2.5h4v4M13.5 2.5L8 8M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3" />
  ),
  plus: <path d="M8 3v10M3 8h10" />,
  bookmark: <path d="M4.5 2.5h7v11L8 11l-3.5 2.5z" />,
  'bookmark-on': <path d="M4.5 2.5h7v11L8 11l-3.5 2.5z" fill="currentColor" />,
  workspaces: (
    <>
      <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
      <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
      <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
      <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
    </>
  ),
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  more: (
    <g fill="currentColor" stroke="none">
      <circle cx="3" cy="8" r="1.5" />
      <circle cx="8" cy="8" r="1.5" />
      <circle cx="13" cy="8" r="1.5" />
    </g>
  ),
  tag: (
    <>
      <path d="M2.5 7.5v-5h5l6 6-5 5z" />
      <circle cx="5.25" cy="5.25" r="0.75" />
    </>
  ),
  clock: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3l2 1.5" />
    </>
  ),
  checklist: (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
      <path d="M5.5 8l1.75 1.75L10.5 6.5" />
    </>
  ),
  lines: <path d="M2.5 4h11M2.5 8h11M2.5 12h7" />,
  flag: <path d="M3.5 14V2.5M3.5 3h8l-1.5 3 1.5 3h-8" />,
  file: <path d="M4 1.5h5l3 3v10H4zM9 1.5v3h3" />,
  fields: (
    <path d="M5.5 2.5h-1a1 1 0 0 0-1 1v3L2.5 8l1 1.5v3a1 1 0 0 0 1 1h1M10.5 2.5h1a1 1 0 0 1 1 1v3l1 1.5-1 1.5v3a1 1 0 0 1-1 1h-1" />
  ),
  archive: (
    <>
      <rect x="2" y="3" width="12" height="3" rx="1" />
      <path d="M3 6v7h10V6M6.5 9h3" />
    </>
  ),
  restore: <path d="M6 3.5L3 6.5l3 3M3 6.5h6.5a3.5 3.5 0 0 1 0 7H7" />,
  template: (
    <>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M3 10.5v-7a1 1 0 0 1 1-1h7" />
    </>
  ),
  trash: <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.75 9.5h6.5L12 4" />,
  filter: <path d="M2.5 3h11L9.25 8.25v4.25l-2.5 1.25v-5.5z" />,
  minus: <path d="M3 8h10" />,
  check: <path d="M3 8.5l3.25 3.25L13 5" />,
  pencil: <path d="M10.25 2.75l3 3-7.75 7.75H2.5v-3zM8.75 4.25l3 3" />,
  'arrow-left': <path d="M13 8H3M7 4L3 8l4 4" />,
  'arrow-right': <path d="M3 8h10M9 4l4 4-4 4" />,
  'chevron-down': <path d="M4 6l4 4 4-4" />,
  'chevron-left': <path d="M10 3.5L5.5 8l4.5 4.5" />,
  'chevron-right': <path d="M6 3.5L10.5 8 6 12.5" />,
  collapse: <path d="M7.5 3.5L3 8l4.5 4.5M13 3.5L8.5 8l4.5 4.5" />,
  expand: <path d="M3 3.5L7.5 8 3 12.5M8.5 3.5L13 8l-4.5 4.5" />,
  gear: (
    <>
      <circle cx="8" cy="8" r="2" />
      <circle cx="8" cy="8" r="4.25" />
      <path d="M8 1.75v2M8 12.25v2M1.75 8h2M12.25 8h2M3.6 3.6L5 5M11 11l1.4 1.4M3.6 12.4L5 11M11 5l1.4-1.4" />
    </>
  ),
  help: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M6.25 6.5a1.75 1.75 0 1 1 2.6 1.5c-.55.3-.85.7-.85 1.25v.25" />
      <circle cx="8" cy="11.25" r="0.75" fill="currentColor" stroke="none" />
    </>
  ),
  fit: <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />,
  transfer: <path d="M5 13V3M2.5 5.5L5 3l2.5 2.5M11 3v10M8.5 10.5L11 13l2.5-2.5" />,
  folder: (
    <path d="M2 4.25a1 1 0 0 1 1-1h3.25l1.5 1.5H13a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />
  ),
  search: (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5l3 3" />
    </>
  ),
  kanban: (
    <>
      <rect x="2" y="2.5" width="3.5" height="11" rx="1" />
      <rect x="6.25" y="2.5" width="3.5" height="7" rx="1" />
      <rect x="10.5" y="2.5" width="3.5" height="9" rx="1" />
    </>
  ),
  canvas: (
    <>
      <rect x="2" y="2.5" width="6" height="5" rx="1" />
      <circle cx="11" cy="11" r="2.75" />
      <path d="M8 7.5l1.25 1.25" />
    </>
  ),
  calendar: (
    <>
      <rect x="2" y="3" width="12" height="11" rx="1.5" />
      <path d="M2 6.5h12M5.5 1.75v2.5M10.5 1.75v2.5" />
    </>
  ),
  pointer: <path d="M3.5 2.5l3.25 10 1.75-4.25 4.25-1.75z" />,
  box: <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />,
  text: <path d="M3 3.5h10M8 3.5v9.5M6 13h4" />,
  arrow: <path d="M3.5 12.5l9-9M6.5 3.5h6v6" />,
  image: (
    <>
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
      <circle cx="10.5" cy="6" r="1" />
      <path d="M2.5 12l3.5-3.5 3 3 1.5-1.5 3 3" />
    </>
  ),
  line: <path d="M2.5 8h11" />,
  arrows: <path d="M2.5 8h11M5.5 5L2.5 8l3 3M10.5 5l3 3-3 3" />,
  dashed: <path d="M2.5 8h2.5M6.75 8h2.5M11 8h2.5" />,
  'align-left': <path d="M2.5 4h11M2.5 8h7M2.5 12h9" />,
  'align-center': <path d="M2.5 4h11M4.5 8h7M3.5 12h9" />,
  'align-right': <path d="M2.5 4h11M6.5 8h7M4.5 12h9" />,
  ellipse: <ellipse cx="8" cy="8" rx="5.75" ry="4.75" />,
  triangle: <path d="M8 2.5l5.75 10.5H2.25z" />,
  diamond: <path d="M8 2l6 6-6 6-6-6z" />,
  highlighter: <path d="M10 2.5l3.5 3.5-5.5 5.5L4.5 8zM4.5 8L3 11.5l1.5 1.5 3.5-1.5M2.5 14.5h11" />,
  eraser: <path d="M9 2.5l4.5 4.5-6.5 6.5H4.5l-2-2zM5.75 5.75l4.5 4.5M7 13.5h6.5" />,
  undo: <path d="M5.5 3.5L2.5 6.5l3 3M2.5 6.5h7a3.5 3.5 0 0 1 0 7H7" />,
  redo: <path d="M10.5 3.5l3 3-3 3M13.5 6.5h-7a3.5 3.5 0 0 0 0 7H9" />,
  // The canvas's settings.
  'chevron-up': <path d="M4 10l4-4 4 4" />,
  'text-style': (
    <path d="M4.5 2h3.75a2.125 2.125 0 0 1 0 4.25H4.5zM4.5 6.25h4.25a2.375 2.375 0 0 1 0 4.75H4.5zM3.5 14h9" />
  ),
  // The letter's legs and its bar. The colour under it is drawn by the button,
  // since it is the colour being set rather than part of the icon.
  'text-colour': <path d="M4.5 11L8 2.5l3.5 8.5M5.75 8h4.5" />,
  border: <circle cx="8" cy="8" r="5.25" strokeWidth="2.5" />,
  'valign-top': <path d="M2.5 2.5h11M2.5 13.5h11M5 5.5h6" />,
  'valign-middle': <path d="M2.5 2.5h11M2.5 13.5h11M5 8h6" />,
  'valign-bottom': <path d="M2.5 2.5h11M2.5 13.5h11M5 10.5h6" />,
  front: <path d="M2.5 2.5h11M8 14V5.5M5 8.5l3-3 3 3" />,
  back: <path d="M2.5 13.5h11M8 2v8.5M5 7.5l3 3 3-3" />,
  copy: (
    <>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M3 10.5v-7a1 1 0 0 1 1-1h7" />
    </>
  ),
  stack: (
    <>
      <rect x="2.5" y="7" width="7" height="6.5" rx="1.25" />
      <path d="M5 4.75h5.75a1 1 0 0 1 1 1V11M7.5 2.5h5.25a1 1 0 0 1 1 1v5.25" />
    </>
  )
}

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {DRAWN[name]}
    </svg>
  )
}
