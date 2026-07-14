import { describe, it, expect, vi } from 'vitest'
import { getAnalysisTool } from '../src/tools/get.js'
import { ApiError } from '../src/client.js'
import type { AnalysisDetail, ThreadMineClient } from '../src/client.js'

const APP = 'https://app.threadmine.dev'

function withClient(getAnalysis: ReturnType<typeof vi.fn>) {
  return { client: { getAnalysis } as unknown as ThreadMineClient, appBaseUrl: APP }
}

describe('getAnalysisTool', () => {
  it('returns the formatted analysis when CONCLUIDA', async () => {
    const done: AnalysisDetail = {
      id: 'an-9', status: 'CONCLUIDA', healthScore: 65,
      problemasDetectados: { problemas: [], totalProblemas: 0, totalCriticos: 0, totalWarnings: 0, totalInfo: 0 },
    }
    const result = await getAnalysisTool({ analysis_id: 'an-9' }, withClient(vi.fn().mockResolvedValue(done)))
    expect(result.isError).toBeUndefined()
    expect(result.text).toContain('65/100')
    expect(result.text).toContain(`${APP}/app/analises/an-9`)
  })

  it('reports non-terminal status without formatting', async () => {
    const processing: AnalysisDetail = { id: 'an-9', status: 'PROCESSANDO' }
    const result = await getAnalysisTool({ analysis_id: 'an-9' }, withClient(vi.fn().mockResolvedValue(processing)))
    expect(result.text).toContain('PROCESSANDO')
    expect(result.text).toContain('an-9')
  })

  it('reports FALHA with the processing error', async () => {
    const failed: AnalysisDetail = { id: 'an-9', status: 'FALHA', erroProcessamento: 'Dump corrompido' }
    const result = await getAnalysisTool({ analysis_id: 'an-9' }, withClient(vi.fn().mockResolvedValue(failed)))
    expect(result.isError).toBe(true)
    expect(result.text).toContain('Dump corrompido')
  })

  it('maps 404 to a clear not-found message', async () => {
    const result = await getAnalysisTool(
      { analysis_id: 'zzz' },
      withClient(vi.fn().mockRejectedValue(new ApiError('not found', 404))),
    )
    expect(result.isError).toBe(true)
    expect(result.text.toLowerCase()).toContain('not found')
  })
})
