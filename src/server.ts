import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { readFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { ThreadMineClient } from './client.js'
import { AccountGateway, AnonymousGateway, type AnalysisGateway } from './gateway.js'
import { analyzeThreadDump, POLL_INTERVAL_MS } from './tools/analyze.js'
import { getAnalysisTool } from './tools/get.js'
import type { ToolOutcome } from './tools/analyze.js'

export const SERVER_VERSION = '0.2.0'

export interface ServerOptions {
  /** Absent, blank or an unexpanded `${...}` placeholder = anonymous mode. */
  apiKey?: string
  apiBaseUrl: string
  appBaseUrl: string
  /** Public site that serves /resultado/{token} for anonymous reports. */
  siteBaseUrl: string
  fetchFn?: typeof fetch
}

/**
 * The key as configured, or undefined when it carries nothing usable. MCP hosts pass the raw
 * text `${THREADMINE_API_KEY}` when a config references a variable the user never set; sending
 * that as a bearer token would turn every call into a 401 instead of falling back to anonymous.
 */
export function usableApiKey(raw: string | undefined): string | undefined {
  const key = raw?.trim()
  if (!key) return undefined
  if (/^\$\{[^}]*\}$/.test(key)) return undefined
  return key
}

function toContent(outcome: ToolOutcome) {
  return {
    content: [{ type: 'text' as const, text: outcome.text }],
    ...(outcome.isError ? { isError: true } : {}),
  }
}

export function buildServer(opts: ServerOptions): McpServer {
  const server = new McpServer({ name: 'threadmine', version: SERVER_VERSION })

  const apiKey = usableApiKey(opts.apiKey)
  const client = new ThreadMineClient({ apiKey, baseUrl: opts.apiBaseUrl, fetchFn: opts.fetchFn })
  const gateway: AnalysisGateway = apiKey
    ? new AccountGateway(client, opts.appBaseUrl)
    : new AnonymousGateway(client, opts.siteBaseUrl, () => server.server.getClientVersion()?.name)

  const quotaNote = apiKey
    ? 'Consumes one analysis from the ThreadMine account\'s daily quota.'
    : 'No account needed: runs anonymously (5 analyses per hour, 20 per day per IP) and the report link ' +
      'expires after 7 days.'

  server.registerTool(
    'analyze_thread_dump',
    {
      description:
        'Analyze a JVM thread dump with ThreadMine. Detects deadlocks, CPU spikes, thread pool exhaustion, ' +
        'thread leaks and virtual thread pinning. Returns detected problems, a health score (0-100) and a ' +
        'link to the full interactive report. Pass the dump text in "content", or "file_path" for large dumps. ' +
        quotaNote,
      inputSchema: {
        content: z.string().optional().describe('Raw thread dump text (jstack / jcmd Thread.print / kill -3 output)'),
        file_path: z.string().optional().describe('Absolute path to a thread dump file — preferred for large dumps'),
        title: z.string().optional().describe('Optional title for the analysis'),
      },
    },
    async (args) => {
      const outcome = await analyzeThreadDump(args, {
        gateway,
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
        'Fetch an existing ThreadMine analysis by the id returned by analyze_thread_dump. ' +
        'Read-only: does NOT consume any analysis quota.',
      inputSchema: {
        analysis_id: z.string().describe('The analysis id returned by analyze_thread_dump (UUID)'),
      },
    },
    async (args) => toContent(await getAnalysisTool(args, { gateway })),
  )

  return server
}

export { POLL_INTERVAL_MS }
