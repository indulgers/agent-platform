# Agent tools — plugin convention

The agent can call two kinds of tools, both surfaced through the same
`ToolRegistry` and the same `ToolDefinition` shape, so a strategy never has to
know where a tool came from.

## First-party (in-repo) tools

A tool is any object implementing `ToolDefinition` (`tool.interface.ts`):

```ts
export const myTool: ToolDefinition<MyInput, MyOutput> = {
  name: 'my_tool',                       // what the model calls
  description: 'One line the model reads to decide when to use it',
  schema: z.object({ q: z.string() }),   // zod — validates args before execute
  parameters: zodObjectToJsonSchema(...),// JSON Schema shown to the model
  async execute(input, ctx) { /* ... */ },
}
```

Register it in `ToolRegistry`'s constructor (`index.ts`) with `this.register(myTool)`.
That is the whole change — the tool is immediately offered to the model on the
next turn. Keep tools side-effect-light or gate risky ones behind a checkpoint.

## MCP (Model Context Protocol) tools

Configure external MCP servers via the `MCP_SERVERS` env var — a JSON array:

```json
[{ "name": "web", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-fetch"] }]
```

On boot, `McpService` connects each server and registers its tools into the same
`ToolRegistry`, namespaced as `mcp__<server>__<tool>` to avoid collisions. See
`mcp/register-mcp-tools.ts`. MCP tools are validated by the server, so their
`schema` is permissive and the server's advertised JSON Schema is passed to the
model verbatim. From the agent's perspective they are indistinguishable from
first-party tools.
