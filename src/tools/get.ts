import { ApiError } from '../client.js'
import { formatAnalysis } from '../format.js'
import type { AnalysisGateway } from '../gateway.js'
import { mapError, type ToolOutcome } from './analyze.js'

export interface GetAnalysisDeps {
  gateway: AnalysisGateway
}

export async function getAnalysisTool(
  input: { analysis_id: string },
  deps: GetAnalysisDeps,
): Promise<ToolOutcome> {
  const { gateway } = deps
  const ref = input.analysis_id
  try {
    const result = await gateway.fetch(ref)
    if (result.status === 'CONCLUIDA' && result.detail) {
      return {
        text: formatAnalysis(result.detail, {
          link: gateway.link(ref), ref, anonymous: gateway.anonymous, expiresAt: result.expiresAt,
        }),
      }
    }
    if (result.status === 'FALHA') {
      return { isError: true, text: `Analysis ${ref} failed: ${result.failure ?? 'unknown processing error'}.` }
    }
    return { text: `Analysis ${ref} is ${result.status}. Check ${gateway.link(ref)} or try again shortly.` }
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      return {
        isError: true,
        text: gateway.anonymous
          ? `Analysis "${ref}" was not found. Reports made without an account expire after 7 days.`
          : `Analysis "${ref}" was not found in your workspace.`,
      }
    }
    return mapError(e, gateway.anonymous)
  }
}
