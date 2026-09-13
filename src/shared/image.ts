// What an image on the canvas is, and how the window gets at its pixels. Step 8
// of v0.3.
//
// The file itself lives where every other attachment does - <workspace>/files/,
// under a bare name - and that was settled with the format in step 2. What was
// not settled is how a renderer with no file system reaches it, and this is
// that: a scheme of our own, registered by main, resolved back to one file
// inside one workspace's files/ folder and nothing else.

// Every extension the window can actually draw. Chromium decodes all of these
// in an <img>, so the list is what it can show rather than what exists: an
// image the app would take in and then not be able to draw is worse than one it
// refuses at the door.
export const IMAGE_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'ico',
  'avif',
  'svg'
]

// What a pasted image is written as. The clipboard hands over bytes and a type
// and no name at all, so the extension has to come from the type - it is what
// decides which program opens the file afterwards, and a screenshot written
// without one is a file nobody but us can open.
const EXTENSION_FOR: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/avif': 'avif',
  'image/svg+xml': 'svg'
}

export function extensionForType(type: string): string | null {
  return EXTENSION_FOR[type.toLowerCase().split(';')[0].trim()] ?? null
}

export function isImageName(name: string): boolean {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return false
  return IMAGE_EXTENSIONS.includes(name.slice(dot + 1).toLowerCase())
}

// What a pasted image is called. Derived rather than invented: the clipboard
// gives nothing to name it after, and the one true thing about it is when it
// arrived. Local time, because the person who pasted it is the person who will
// go looking for it in the folder.
//
// The same screenshot pasted twice keeps the first name, because the copy is
// settled by content before a name is asked for - see attachBytes.
export function pastedName(at: Date, extension: string): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const stamp =
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`
  return `pasted-${stamp}.${extension}`
}

// The scheme main answers on. Not file:, because the window would then be able
// to ask for anything on the machine and the whole point of copying an
// attachment in is that a workspace is a folder you can move; and not a data:
// url, because that is the image in the page's memory as text.
export const FILE_SCHEME = 'bothy-file'

// The workspace is IN the url rather than being whichever one is open, and that
// is not tidiness. The window caches a decoded image by its url: two workspaces
// each holding a shot.png would be one entry, and the second canvas opened
// would show the first one's picture.
export function fileUrl(workspacePath: string, name: string): string {
  return `${FILE_SCHEME}://ws/${encode(workspacePath)}/${encodeURIComponent(name)}`
}

// The other direction, for main. Answers null for anything that is not one of
// ours - a url that does not parse, a path with the wrong number of parts, a
// workspace that is not valid base64url. What comes back is still only a claim:
// the name is checked against isAttachmentName and joined to files/ by the
// caller, which is what keeps it inside the workspace.
export function fileUrlParts(url: string): { workspacePath: string; name: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${FILE_SCHEME}:`) return null
  const parts = parsed.pathname.split('/').filter((part) => part !== '')
  if (parts.length !== 2) return null
  const workspacePath = decode(parts[0])
  if (workspacePath === null) return null
  let name: string
  try {
    name = decodeURIComponent(parts[1])
  } catch {
    return null
  }
  return { workspacePath, name }
}

// base64url, written out here rather than reached for, because this runs in
// both processes and they do not have the same tools: main has Buffer and the
// window does not, and btoa cannot take a path with a Turkish letter in it.
//
// The alphabet matters as much as the encoding. A Windows path is full of
// backslashes and colons and may hold any letter at all; percent-encoding it
// into a url path leaves the parser free to normalise a %5C into a separator
// and split one workspace into two. base64url has no character a url parser
// touches.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

function encode(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0
    const packed = (a << 16) | (b << 8) | c
    out += ALPHABET[(packed >> 18) & 63] + ALPHABET[(packed >> 12) & 63]
    if (i + 1 < bytes.length) out += ALPHABET[(packed >> 6) & 63]
    if (i + 2 < bytes.length) out += ALPHABET[packed & 63]
  }
  return out
}

// Null rather than a best effort. A character that is not in the alphabet means
// this is not a url we wrote, and skipping it would turn a url for one folder
// into a valid url for a different one.
function decode(text: string): string | null {
  const bytes: number[] = []
  let bits = 0
  let held = 0
  for (const character of text) {
    const index = ALPHABET.indexOf(character)
    if (index < 0) return null
    held = (held << 6) | index
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((held >> bits) & 0xff)
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes))
  } catch {
    return null
  }
}
