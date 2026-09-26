/**
 * Stdio MCP server for the headless space-shooter harness (dev tooling;
 * verification layer 2). Lets an LLM agent play the game and run the bots,
 * replays and generator conformance suite as MCP tools. Offline, unrecorded.
 *
 *   bun run harness:mcp            (registered in .mcp.json as "edugames-harness")
 *
 * Minimal MCP over newline-delimited JSON-RPC 2.0: initialize, ping,
 * tools/list, tools/call. Logs go to stderr; stdout carries only protocol.
 */
import { createHarnessTools } from '../src/games/space-shooter/harness/tools'
import { generatorIds, loadPlugin } from './lib/plugins'

const PROTOCOL_VERSION = '2025-06-18'
const SERVER_INFO = { name: 'edugames-harness', version: '1.0.0' }

type Id = string | number
interface Message {
  jsonrpc?: string
  id?: Id | null
  method?: string
  params?: Record<string, unknown>
}

const tools = createHarnessTools({ loadPlugin, generatorIds })

function send(message: object): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
}

const reply = (id: Id, result: unknown) => send({ id, result })
const replyError = (id: Id | null, code: number, message: string) => send({ id, error: { code, message } })

async function handle(msg: Message): Promise<void> {
  const { id, method } = msg
  // Notifications (no id) never get a response.
  if (id === undefined || id === null) return
  switch (method) {
    case 'initialize': {
      const requested = typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : PROTOCOL_VERSION
      return reply(id, {
        protocolVersion: requested,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          'Headless EduGames space shooter. open_session first (read its `describe` once), then loop act → read state. Sessions are offline and never record scores.',
      })
    }
    case 'ping':
      return reply(id, {})
    case 'tools/list':
      return reply(id, { tools: tools.tools })
    case 'tools/call': {
      const name = typeof msg.params?.name === 'string' ? msg.params.name : ''
      const result = await tools.call(name, msg.params?.arguments ?? {})
      return reply(id, { content: [{ type: 'text', text: JSON.stringify(result.value) }], isError: result.isError ?? false })
    }
    default:
      return replyError(id, -32601, `method not found: ${method}`)
  }
}

// Requests run one at a time, in order (the harness session is stateful).
let queue = Promise.resolve()
let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk: string) => {
  buffer += chunk
  let newline: number
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline).trim()
    buffer = buffer.slice(newline + 1)
    if (!line) continue
    let msg: Message
    try {
      msg = JSON.parse(line) as Message
    } catch {
      replyError(null, -32700, 'parse error')
      continue
    }
    queue = queue.then(() =>
      handle(msg).catch((err: unknown) => {
        if (msg.id !== undefined && msg.id !== null) replyError(msg.id, -32603, err instanceof Error ? err.message : String(err))
      }),
    )
  }
})
process.stdin.on('end', () => {
  void queue.then(() => {
    tools.dispose()
    process.exit(0)
  })
})
console.error('edugames-harness MCP server ready (stdio)')
