import { ApiError, type ThreadMineClient } from '../client.js'
import { formatAnalysis, reportLink } from '../format.js'
import { mapError, type ToolOutcome } from './analyze.js'

export interface GetAnalysisDeps {
  client: ThreadMineClient
  appBaseUrl: string
}

export async function getAnalysisTool(
  input: { analysis_id: string },
  deps: GetAnalysisDeps,
): Promise<ToolOutcome> {
  try {
    const analysis = await deps.client.getAnalysis(input.analysis_id)
    if (analysis.status === 'CONCLUIDA') {
      return { text: formatAnalysis(analysis, deps.appBaseUrl) }
    }
    if (analysis.status === 'FALHA') {
      return {
        isError: true,
        text: `Analysis ${input.analysis_id} failed: ${analysis.erroProcessamento ?? 'unknown processing error'}.`,
      }
    }
    return {
      text: `Analysis ${input.analysis_id} is ${analysis.status}. ` +
        `Check ${reportLink(input.analysis_id, deps.appBaseUrl)} or try again shortly.`,
    }
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      return { isError: true, text: `Analysis "${input.analysis_id}" was not found in your workspace.` }
    }
    return mapError(e)
  }
}
