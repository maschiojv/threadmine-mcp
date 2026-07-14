import { AuthError, QuotaError, RateLimitError, type ThreadMineClient } from '../client.js'
import { formatAnalysis, reportLink } from '../format.js'

export const POLL_INTERVAL_MS = 2000
export const MAX_POLL_ATTEMPTS = 60 // 60 x 2s = 120s total

export interface AnalyzeInput {
  content?: string
  file_path?: string
  title?: string
}

export interface AnalyzeDeps {
  client: ThreadMineClient
  appBaseUrl: string
  readFile: (path: string) => Promise<string>
  hostname: () => string
  sleep: (ms: number) => Promise<void>
}

export interface ToolOutcome {
  text: string
  isError?: boolean
}

const TERMINAL_STATUSES = new Set(['CONCLUIDA', 'FALHA', 'CANCELADA'])

export async function analyzeThreadDump(input: AnalyzeInput, deps: AnalyzeDeps): Promise<ToolOutcome> {
  const hasContent = typeof input.content === 'string' && input.content.length > 0
  const hasPath = typeof input.file_path === 'string' && input.file_path.length > 0
  if (hasContent === hasPath) {
    return {
      isError: true,
      text: 'Provide either "content" (the thread dump text) or "file_path" (path to a dump file) — exactly one of the two.',
    }
  }

  let dump: string
  if (hasPath) {
    try {
      dump = await deps.readFile(input.file_path!)
    } catch (e) {
      return { isError: true, text: `Could not read dump file "${input.file_path}": ${(e as Error).message}` }
    }
  } else {
    dump = input.content!
  }

  const title = input.title ?? `Thread dump via MCP (${deps.hostname()})`

  try {
    const { id } = await deps.client.createAnalysis({
      title,
      contentBase64: Buffer.from(dump, 'utf8').toString('base64'),
      hostname: deps.hostname(),
    })

    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      const analysis = await deps.client.getAnalysis(id)
      if (TERMINAL_STATUSES.has(analysis.status)) {
        if (analysis.status === 'CONCLUIDA') {
          return { text: formatAnalysis(analysis, deps.appBaseUrl) }
        }
        if (analysis.status === 'FALHA') {
          return {
            isError: true,
            text: `Analysis failed: ${analysis.erroProcessamento ?? 'unknown processing error'}. ` +
              `Make sure the input is a JVM thread dump (jstack, jcmd Thread.print, kill -3).`,
          }
        }
        return { isError: true, text: `Analysis ${id} was cancelled.` }
      }
      await deps.sleep(POLL_INTERVAL_MS)
    }

    return {
      text: `The analysis is still processing (id: ${id}). ` +
        `Check the report at ${reportLink(id, deps.appBaseUrl)} or call get_analysis with this id in a moment.`,
    }
  } catch (e) {
    return mapError(e)
  }
}

export function mapError(e: unknown): ToolOutcome {
  if (e instanceof AuthError) {
    return {
      isError: true,
      text: 'Invalid or missing API key. Create one at https://app.threadmine.dev (Settings → API Keys) ' +
        'and set it as the THREADMINE_API_KEY environment variable in your MCP configuration.',
    }
  }
  if (e instanceof QuotaError) {
    const upgrade = e.upgradeUrl.startsWith('http') ? e.upgradeUrl : `https://threadmine.dev${e.upgradeUrl}`
    return {
      isError: true,
      text: `Daily analysis quota exceeded for your ${e.planoAtual} plan. ` +
        `Upgrade to ${e.planoSugerido} for a higher limit: ${upgrade}. ` +
        `Tip: get_analysis on existing analyses does not consume quota.`,
    }
  }
  if (e instanceof RateLimitError) {
    return { isError: true, text: `Rate limited by the ThreadMine API — try again in ${e.retryAfterSeconds}s.` }
  }
  return { isError: true, text: `ThreadMine API error: ${(e as Error).message}` }
}
