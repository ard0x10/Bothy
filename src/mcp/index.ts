import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServer } from './server'

// What an agent's client starts: `node out/mcp/bothy-mcp.cjs`, or the app's own
// electron.exe with ELECTRON_RUN_AS_NODE=1, so nobody has to install Node for
// it. It lives exactly as long as the client's session and no longer - there is
// no Bothy process left behind, the rule the app itself has kept.
//
// The client closing its end of stdin is the end of the session, and nothing
// here has to say so: once stdin ends there is nothing left holding the process
// open. Measured under node and under electron as node, 15 and 16 ms
// after stdin ended, exit code 0 - with and without a listener for the end of
// the stream, so there is no listener.
//
// stdout belongs to the protocol. Anything meant for a person goes to stderr,
// because one stray line on stdout is a message the client cannot parse.
async function main(): Promise<void> {
  await createServer().connect(new StdioServerTransport())
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error)
  process.exit(1)
})
