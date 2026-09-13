import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'
import { FILE_SCHEME, fileUrlParts } from '../shared/image'
import { resolveAttachment } from './vault/attach'

// How the window gets at an image without being given the file system. Step 8
// of v0.3.
//
// The window asks for bothy-file://ws/<workspace>/<name> and main answers with
// one file out of that workspace's files/ folder. Three things were on the
// table and this is why it is this one:
//
//   file: urls, with webSecurity off. The window could then read anything on
//     the machine, and the one thing this app promises about a vault is that it
//     is a folder - not a program with a way into the rest of the disk.
//   the bytes over IPC, as a data url or a blob. Every image would cross the
//     process boundary as a copy, be held in the page's memory as well as in
//     the decoder, and be copied again on every canvas that was opened. The
//     window's own cache - which is what makes the second look at a picture
//     free - would have nothing to key on.
//   this. The window asks for a url, Chromium caches and decodes it the way it
//     does any image, and main hands back one path it worked out itself.
//
// The scheme is privileged rather than plain because an unprivileged one is an
// opaque origin: no caching, and fetch cannot see it.
//
// One thing about that is written down here because it cost step 9 an hour and
// will cost the next person the same: supportFetchAPI is set, and a fetch from
// the window to this scheme is STILL refused - "Failed to fetch", with nothing
// said about why. The page is served from file:, so it is a cross origin
// request from an opaque origin, and neither naming the scheme in the page's
// connect-src nor answering with Access-Control-Allow-Origin got it through.
// Both were tried and both were backed out again.
//
// So <img> is the only way the window reads this scheme, and anything that
// needs the BYTES of an attachment asks main for them. Step 9's export does
// exactly that.

export function privilegeImageScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: FILE_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

export function registerImageProtocol(): void {
  protocol.handle(FILE_SCHEME, async (request) => {
    const parts = fileUrlParts(request.url)
    // Not one of ours. Nothing is looked up, because working out what a
    // half-valid url might have meant is how a path check gets talked round.
    if (parts === null) return new Response('', { status: 400 })

    // The same road a card's attachment takes to the shell: the name is checked
    // against the rule and joined to files/, so a canvas edited by hand into a
    // name with a separator in it resolves to nothing at all.
    const path = resolveAttachment(parts.workspacePath, parts.name)
    if (path === null) return new Response('', { status: 403 })

    try {
      return await net.fetch(pathToFileURL(path).toString())
    } catch {
      // The file named in the canvas is not there. Answered as a miss rather
      // than as a failure, because that is what it is: the object stays in the
      // file, the canvas draws it as missing, and the day the file comes back
      // the picture is there again. The same rule a card's missing attachment
      // has had since v0.2.
      return new Response('', { status: 404 })
    }
  })
}
