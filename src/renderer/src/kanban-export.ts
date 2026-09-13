import stylesheet from './styles.css?inline'
import { toPng } from './canvas-export'

// The kanban as a picture. It lives in the ⋯ by the board's name,
// and for the one choice that goes with it: whether the ground comes along or
// the picture is only the columns and their cards.
//
// Drawn from the board itself rather than redrawn from the cards. A second
// drawing of a card would be a second set of rules about what a card looks
// like, and they would drift the first time either one changed. So the board is
// copied, the copy is laid out off screen at its whole size - every column and
// every card, however much of it the window happens to be showing - and that
// copy goes into an SVG with the stylesheet beside it, which is drawn onto a
// canvas the way the canvas's own export is.
//
// Not a screenshot of the window, for two reasons that are both about what a
// screenshot cannot give: it has what the window shows and nothing past its
// edge, and it has no transparency to hand over.

// What is in the board for a hand and not for a picture: the buttons in its
// head and at the end of each column, the filter's bar, and whatever the board
// happened to be saying when the export was asked for.
const LEFT_OUT = [
  '.kanban-tools',
  '.kanban-refused',
  '.kanban-notice',
  '.filter',
  '.add-column',
  '.add-card-row',
  '.add-card',
  '.add-card-input',
  '.column-menu-anchor'
].join(', ')

// One pixel of the picture for each pixel the board is drawn at on this screen,
// so the PNG looks the way the board does. At 1.25 that is 1.25 per CSS pixel,
// and at 1 it is 1: the density the person asking is looking at, not a number
// chosen for them.
const density = (): number => (window.devicePixelRatio > 0 ? window.devicePixelRatio : 1)

export async function kanbanPng(
  board: HTMLElement,
  ground: boolean,
  workspacePath: string
): Promise<Uint8Array> {
  const copy = board.cloneNode(true) as HTMLElement
  for (const node of copy.querySelectorAll(LEFT_OUT)) node.remove()
  await embedCovers(copy, workspacePath)
  // The board's own ground is an inline style on its columns' box. Without the
  // ground it goes, and with it it stays exactly as the board wears it.
  const columns = copy.querySelector<HTMLElement>('.columns')
  if (columns && !ground) columns.style.removeProperty('background')

  // Laid out in this window first, where the stylesheet already is, because
  // that is the only way to know how big the whole board is: the window may be
  // showing half of it. `.bothy-export` in the stylesheet is what lets the
  // copy be as wide and as tall as it needs.
  const host = document.createElement('div')
  host.className = 'bothy-export'
  host.style.position = 'fixed'
  host.style.left = '0'
  host.style.top = '0'
  host.style.transform = 'translateX(-300vw)'
  host.style.pointerEvents = 'none'
  host.append(copy)
  document.body.append(host)
  let width: number
  let height: number
  try {
    const box = copy.getBoundingClientRect()
    width = Math.ceil(box.width)
    height = Math.ceil(box.height)
  } finally {
    host.remove()
  }
  if (width === 0 || height === 0) throw new Error('the board has no size to draw')

  const scale = density()
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width * scale)}" ` +
    `height="${Math.round(height * scale)}" viewBox="0 0 ${width} ${height}">` +
    `<foreignObject x="0" y="0" width="${width}" height="${height}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" class="bothy-export" style="${frameStyle(width, height, ground)}">` +
    `<style>${cdata(stylesheet)}</style>` +
    new XMLSerializer().serializeToString(copy) +
    `</div></foreignObject></svg>`
  return toPng(svg)
}

// A card's picture cover is drawn down the bothy-file scheme, and an SVG drawn
// as an image reaches nothing outside itself: left as it is, every cover would
// be a hole in the PNG. So each one is given its bytes, asked of main the way
// the canvas's export asks for its pictures. One that could not be read is
// taken out, which is what the card on screen does with a picture whose file
// is gone.
async function embedCovers(copy: HTMLElement, workspacePath: string): Promise<void> {
  const pictures = [...copy.querySelectorAll<HTMLImageElement>('img[data-file]')]
  if (pictures.length === 0) return
  const names = [...new Set(pictures.map((picture) => picture.dataset.file ?? ''))].filter(
    (name) => name !== ''
  )
  const found = await window.api.embedFiles(workspacePath, names)
  for (const picture of pictures) {
    const url = found[picture.dataset.file ?? '']
    if (url) picture.setAttribute('src', url)
    else picture.remove()
  }
}

// Everything the copy inherits from outside the board, written onto the box
// that holds it. An image is loaded in a context of its own and sees nothing of
// this page: not the colours the user chose, which sit on this document's root,
// not the theme the window is in, and not the body the board was sitting on. So
// each colour token is read off the window as it is now and given to the box
// as a value, and so is the body's type.
function frameStyle(width: number, height: number, ground: boolean): string {
  const root = getComputedStyle(document.documentElement)
  const body = getComputedStyle(document.body)
  const parts: string[] = [`width:${width}px`, `height:${height}px`]
  for (const name of tokens()) {
    const value = root.getPropertyValue(name).trim()
    if (value) parts.push(`${name}:${value}`)
  }
  parts.push(
    `font-family:${body.fontFamily}`,
    `font-size:${body.fontSize}`,
    `line-height:${body.lineHeight}`,
    `color:${body.color}`
  )
  // The window's ground under everything, the way it is under the board on
  // screen. The board's own ground, if it has one, is on its columns' box and
  // covers this everywhere but the head.
  if (ground) parts.push(`background:${root.getPropertyValue('--bg-app').trim()}`)
  return escapeAttribute(parts.join(';'))
}

// Every custom property the stylesheet declares, read off the stylesheet so a
// token added to it next month is carried without anyone remembering this file.
let names: string[] | null = null
function tokens(): string[] {
  if (names === null) names = [...new Set(stylesheet.match(/--[\w-]+(?=\s*:)/g) ?? [])]
  return names
}

// The stylesheet goes in as text in an XML document, where a stray < or & in a
// comment would end it early. A CDATA section holds anything but its own end.
const cdata = (text: string): string =>
  `<![CDATA[${text.split(']]>').join(']]]]><![CDATA[>')}]]>`

const escapeAttribute = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
