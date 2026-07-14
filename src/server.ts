import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { readFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { ThreadMineClient } from './client.js'
import { analyzeThreadDump, POLL_INTERVAL_MS } from './tools/analyze.js'
import { getAnalysisTool } from './tools/get.js'
import type { ToolOutcome } from './tools/analyze.js'

export interface ServerOptions {
  apiKey?: string
  apiBaseUrl: string
  appBaseUrl: string
  fetchFn?: typeof fetch
}

const MISSING_KEY_MESSAGE =
  'THREADMINE_API_KEY is not set. Create an API key at https://app.threadmine.dev ' +
  '(Settings → API Keys) and add it to this MCP server\'s environment configuration.'

function toContent(outcome: ToolOutcome) {
  return {
    content: [{ type: 'text' as const, text: outcome.text }],
    ...(outcome.isError ? { isError: true } : {}),
  }
}

export function buildServer(opts: ServerOptions): McpServer {
  const server = new McpServer({ name: 'threadmine', version: '0.1.0' })

  const client = opts.apiKey
    ? new ThreadMineClient({ apiKey: opts.apiKey, baseUrl: opts.apiBaseUrl, fetchFn: opts.fetchFn })
    : null

  server.registerTool(
    'analyze_thread_dump',
    {
      description:
        'Analyze a JVM thread dump with ThreadMine. Detects deadlocks, CPU spikes, thread pool exhaustion, ' +
        'thread leaks and virtual thread pinning. Returns detected problems, a health score (0-100) and a ' +
        'link to the full interactive report. Pass the dump text in "content", or "file_path" for large dumps. ' +
        'Consumes one analysis from the ThreadMine account\'s daily quota.',
      inputSchema: {
        content: z.string().optional().describe('Raw thread dump text (jstack / jcmd Thread.print / kill -3 output)'),
        file_path: z.string().optional().describe('Absolute path to a thread dump file — preferred for large dumps'),
        title: z.string().optional().describe('Optional title for the analysis'),
      },
    },
    async (args) => {
      if (!client) return toContent({ isError: true, text: MISSING_KEY_MESSAGE })
      const outcome = await analyzeThreadDump(args, {
        client,
        appBaseUrl: opts.appBaseUrl,
        readFile: (p) => readFile(p, 'utf8'),
        hostname,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      })
      return toContent(outcome)
    },
  )

  server.registerTool(
    'get_analysis',
    {
      description:
        'Fetch an existing ThreadMine analysis by id (returned by analyze_thread_dump). ' +
        'Read-only: does NOT consume the daily analysis quota.',
      inputSchema: {
        analysis_id: z.string().describe('The analysis id (UUID)'),
      },
    },
    async (args) => {
      if (!client) return toContent({ isError: true, text: MISSING_KEY_MESSAGE })
      const outcome = await getAnalysisTool(args, { client, appBaseUrl: opts.appBaseUrl })
      return toContent(outcome)
    },
  )

  return server
}

export { POLL_INTERVAL_MS }
