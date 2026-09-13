import type { AiAccess } from '../shared/ai'

// The shape of a tool and of what it answers, shared by every file of tools so
// none of them has to import another to say what a tool is.

export type ToolResult = {
  content: { type: 'text'; text: string }[]
  isError?: true
}

export type Tool = {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
    additionalProperties?: boolean
  }
  run: (args: Record<string, unknown>, access: AiAccess) => Promise<ToolResult>
}

// JSON with no indentation. Every answer lands in an agent's context, where
// the spaces of a pretty print are paid for on every line of every kanban and
// read by nobody; a model reads the flat form as easily as the indented one.
export const answer = (value: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value) }]
})

export const refusal = (message: string): ToolResult => ({
  content: [{ type: 'text', text: message }],
  isError: true
})
