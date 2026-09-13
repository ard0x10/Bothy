import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { name, version } from '../../package.json'
import { readAccess } from './state'
import { ACCESS_OFF, TOOLS, refusal } from './tools'

// The MCP server, v0.4 step 2. The protocol's own low level server rather than
// the helper that describes tools in zod: the fields an agent is given are
// described once, in src/shared/schema, and a second description of them in
// another library's words is the drift that schema exists to stop.
export function createServer(): Server {
  const server = new Server({ name, version }, { capabilities: { tools: {} } })

  // Listed whatever the switch says, the choice: an agent that can see what
  // Bothy does can tell a person how to let it.
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map(({ name: tool, description, inputSchema }) => ({ name: tool, description, inputSchema }))
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = TOOLS.find((one) => one.name === request.params.name)
    if (!tool) return refusal(`Bothy has no tool called ${request.params.name}. The tool list gives the ones it has.`)
    const access = await readAccess()
    if (!access.on) return refusal(ACCESS_OFF)
    // An input the tool does not take is refused rather than passed over. A
    // misspelt `colour` for `cover` that was quietly ignored would be a change
    // the agent believes it made.
    const args = request.params.arguments ?? {}
    const takes = Object.keys(tool.inputSchema.properties)
    const stray = Object.keys(args).filter((key) => !takes.includes(key))
    if (tool.inputSchema.additionalProperties === false && stray.length > 0) {
      return refusal(`${tool.name} has no input called ${stray.join(' or ')}. It takes ${takes.join(', ') || 'nothing'}.`)
    }
    return tool.run(args, access)
  })

  return server
}
