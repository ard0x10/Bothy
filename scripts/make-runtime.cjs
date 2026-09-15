// Builds runtime\Bothy.exe: the electron npm downloaded, under the app's own
// name. Prints the path to it.
//
//   node scripts/make-runtime.cjs
//
// Windows names a running program after the description written inside its
// .exe, so an app run on electron.exe shows as "Electron" in Task Manager
// whatever it calls itself. This copies that one file under the app's name and
// writes the app's name, version and icon into the copy. Everything else
// electron needs sits beside it as a hard link to the file npm downloaded, so
// the folder costs one file of disk rather than the whole of electron.
//
// Outside node_modules on purpose: npm owns that folder and puts it back on
// every install, and the tests run the electron that is there.
//
// Built again only when what it is built from changes: the electron version,
// the app's version or the icon. A new electron after an npm install is picked
// up the next time the shortcut is installed.
const { createHash } = require('node:crypto')
const {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..')
const dist = join(root, 'node_modules', 'electron', 'dist')
const runtime = join(root, 'runtime')
const icon = join(root, 'resources', 'icon.ico')
const app = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const electron = JSON.parse(readFileSync(join(root, 'node_modules', 'electron', 'package.json'), 'utf8'))

const NAME = 'Bothy'
const exe = join(runtime, `${NAME}.exe`)
const stampFile = join(runtime, 'built-from.json')

async function main() {
  if (!existsSync(join(dist, 'electron.exe'))) throw new Error('electron.exe is missing. Run: npm install')

  const stamp = JSON.stringify({
    electron: electron.version,
    app: app.version,
    icon: createHash('sha256').update(readFileSync(icon)).digest('hex')
  })
  if (existsSync(exe) && existsSync(stampFile) && readFileSync(stampFile, 'utf8') === stamp) {
    process.stdout.write(exe)
    return
  }

  try {
    rmSync(runtime, { recursive: true, force: true })
  } catch (error) {
    throw new Error(`${runtime} could not be replaced. Close Bothy and run this again. (${error.code})`)
  }

  // Linked rather than copied, and copied only where a link cannot be made,
  // which is a repo on a different drive from its node_modules.
  const place = (from, to) => {
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      const source = join(from, entry.name)
      const target = join(to, entry.name)
      if (entry.isDirectory()) {
        mkdirSync(target, { recursive: true })
        place(source, target)
      } else if (!(from === dist && entry.name === 'electron.exe')) {
        try {
          linkSync(source, target)
        } catch {
          copyFileSync(source, target)
        }
      }
    }
  }
  mkdirSync(runtime, { recursive: true })
  place(dist, runtime)
  // The one real copy. Writing into a hard link would write into the file npm
  // downloaded as well.
  copyFileSync(join(dist, 'electron.exe'), exe)

  const { rcedit } = require('rcedit')
  await rcedit(exe, {
    'version-string': {
      FileDescription: NAME,
      ProductName: NAME,
      InternalName: NAME,
      OriginalFilename: `${NAME}.exe`,
      CompanyName: app.author
    },
    'file-version': app.version,
    'product-version': app.version,
    icon
  })

  writeFileSync(stampFile, stamp)
  process.stdout.write(exe)
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
})
