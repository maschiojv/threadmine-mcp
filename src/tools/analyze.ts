import { AuthError, QuotaError, RateLimitError } from '../client.js'
import { formatAnalysis, PRICING_URL } from '../format.js'
import type { AnalysisGateway } from '../gateway.js'

export const POLL_INTERVAL_MS = 2000
export const MAX_POLL_ATTEMPTS = 60 // 60 x 2s = 120s total

export interface AnalyzeInput {
  content?: string
  file_path?: string
  title?: string
}

export interface AnalyzeDeps {
  gateway: AnalysisGateway
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

  const { gateway } = deps
  const title = input.title ?? `Thread dump via MCP (${deps.hostname()})`

  try {
    const ref = await gateway.submit({ dump, title, hostname: deps.hostname() })

    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      const result = await gateway.fetch(ref)
      if (TERMINAL_STATUSES.has(result.status)) {
        if (result.status === 'CONCLUIDA' && result.detail) {
          return {
            text: formatAnalysis(result.detail, {
              link: gateway.link(ref), ref, anonymous: gateway.anonymous, expiresAt: result.expiresAt,
            }),
          }
        }
        if (result.status === 'FALHA') {
          return {
            isError: true,
            text: `Analysis failed: ${result.failure ?? 'unknown processing error'}. ` +
              `Make sure the input is a JVM thread dump (jstack, jcmd Thread.print, kill -3).`,
          }
        }
        return { isError: true, text: `Analysis ${ref} was cancelled.` }
      }
      await deps.sleep(POLL_INTERVAL_MS)
    }

    return {
      text: `The analysis is still processing (id: ${ref}). ` +
        `Check the report at ${gateway.link(ref)} or call get_analysis with this id in a moment.`,
    }
  } catch (e) {
    return mapError(e, gateway.anonymous)
  }
}

export function mapError(e: unknown, anonymous = false): ToolOutcome {
  if (e instanceof AuthError) {
    return {
      isError: true,
      text: 'Invalid API key. Create one at https://app.threadmine.dev (Settings → API Keys) and set it as the ' +
        'THREADMINE_API_KEY environment variable, or remove the variable to analyze without an account.',
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
    if (anonymous) {
      const minutes = Math.max(1, Math.ceil(e.retryAfterSeconds / 60))
      return {
        isError: true,
        text: `The anonymous limit was reached (5 analyses per hour and 20 per day per IP). ` +
          `Try again in about ${minutes} min. Paid plans have no daily limit: ${PRICING_URL}`,
      }
    }
    return { isError: true, text: `Rate limited by the ThreadMine API — try again in ${e.retryAfterSeconds}s.` }
  }
  return { isError: true, text: `ThreadMine API error: ${(e as Error).message}` }
}
