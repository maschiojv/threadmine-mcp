import { describe, it, expect, vi } from 'vitest'
import { analyzeThreadDump, MAX_POLL_ATTEMPTS } from '../src/tools/analyze.js'
import { AuthError, QuotaError } from '../src/client.js'
import type { AnalysisDetail, ThreadMineClient } from '../src/client.js'

const APP = 'https://app.threadmine.dev'

const done: AnalysisDetail = {
  id: 'an-1', status: 'CONCLUIDA', healthScore: 88,
  problemasDetectados: { problemas: [], totalProblemas: 0, totalCriticos: 0, totalWarnings: 0, totalInfo: 0 },
}

function deps(overrides: Partial<{
  createAnalysis: ReturnType<typeof vi.fn>
  getAnalysis: ReturnType<typeof vi.fn>
  readFile: ReturnType<typeof vi.fn>
}> = {}) {
  const createAnalysis = overrides.createAnalysis ?? vi.fn().mockResolvedValue({ id: 'an-1' })
  const getAnalysis = overrides.getAnalysis ?? vi.fn().mockResolvedValue(done)
  return {
    client: { createAnalysis, getAnalysis } as unknown as ThreadMineClient,
    appBaseUrl: APP,
    readFile: overrides.readFile ?? vi.fn().mockResolvedValue('Full thread dump from file'),
    hostname: () => 'test-host',
    sleep: vi.fn().mockResolvedValue(undefined),
    createAnalysis,
    getAnalysis,
  }
}

describe('analyzeThreadDump', () => {
  it('sends inline content as base64 and returns the formatted result', async () => {
    const d = deps()
    const result = await analyzeThreadDump({ content: 'Full thread dump', title: 'my dump' }, d)
    expect(result.isError).toBeUndefined()
    expect(result.text).toContain('88/100')
    expect(result.text).toContain(`${APP}/app/analises/an-1`)
    const params = d.createAnalysis.mock.calls[0][0]
    expect(params.title).toBe('my dump')
    expect(Buffer.from(params.contentBase64, 'base64').toString('utf8')).toBe('Full thread dump')
    expect(params.hostname).toBe('test-host')
  })

  it('reads from file_path when given', async () => {
    const d = deps()
    await analyzeThreadDump({ file_path: '/tmp/dump.txt' }, d)
    expect(d.readFile).toHaveBeenCalledWith('/tmp/dump.txt')
    const params = d.createAnalysis.mock.calls[0][0]
    expect(Buffer.from(params.contentBase64, 'base64').toString('utf8')).toBe('Full thread dump from file')
  })

  it('generates a default title when none is given', async () => {
    const d = deps()
    await analyzeThreadDump({ content: 'dump' }, d)
    const params = d.createAnalysis.mock.calls[0][0]
    expect(params.title).toContain('test-host')
  })

  it('rejects when neither or both of content/file_path are given', async () => {
    const d = deps()
    const neither = await analyzeThreadDump({}, d)
    expect(neither.isError).toBe(true)
    expect(neither.text).toContain('either')
    const both = await analyzeThreadDump({ content: 'x', file_path: '/y' }, d)
    expect(both.isError).toBe(true)
    expect(d.createAnalysis).not.toHaveBeenCalled()
  })

  it('polls until CONCLUIDA', async () => {
    const processing: AnalysisDetail = { id: 'an-1', status: 'PROCESSANDO' }
    const getAnalysis = vi.fn()
      .mockResolvedValueOnce(processing)
      .mockResolvedValueOnce(processing)
      .mockResolvedValueOnce(done)
    const d = deps({ getAnalysis })
    const result = await analyzeThreadDump({ content: 'dump' }, d)
    expect(result.text).toContain('88/100')
    expect(getAnalysis).toHaveBeenCalledTimes(3)
  })

  it('reports processing failure with erroProcessamento on FALHA', async () => {
    const failed: AnalysisDetail = { id: 'an-1', status: 'FALHA', erroProcessamento: 'Formato de dump nao reconhecido' }
    const d = deps({ getAnalysis: vi.fn().mockResolvedValue(failed) })
    const result = await analyzeThreadDump({ content: 'not a dump' }, d)
    expect(result.isError).toBe(true)
    expect(result.text).toContain('Formato de dump nao reconhecido')
  })

  it('returns id + link when polling times out', async () => {
    const processing: AnalysisDetail = { id: 'an-1', status: 'PROCESSANDO' }
    const d = deps({ getAnalysis: vi.fn().mockResolvedValue(processing) })
    const result = await analyzeThreadDump({ content: 'dump' }, d)
    expect(result.text).toContain('still processing')
    expect(result.text).toContain('an-1')
    expect(result.text).toContain(`${APP}/app/analises/an-1`)
    expect(d.getAnalysis).toHaveBeenCalledTimes(MAX_POLL_ATTEMPTS)
  })

  it('maps QuotaError to an upgrade message', async () => {
    const createAnalysis = vi.fn().mockRejectedValue(
      new QuotaError('Quota diaria excedida', 'FREE', 'PRO', '/pricing'))
    const d = deps({ createAnalysis })
    const result = await analyzeThreadDump({ content: 'dump' }, d)
    expect(result.isError).toBe(true)
    expect(result.text).toContain('FREE')
    expect(result.text).toContain('PRO')
    expect(result.text).toContain('https://threadmine.dev/pricing')
  })

  it('maps AuthError to API key guidance', async () => {
    const createAnalysis = vi.fn().mockRejectedValue(new AuthError())
    const d = deps({ createAnalysis })
    const result = await analyzeThreadDump({ content: 'dump' }, d)
    expect(result.isError).toBe(true)
    expect(result.text).toContain('THREADMINE_API_KEY')
  })

  it('reports unreadable file_path clearly', async () => {
    const readFile = vi.fn().mockRejectedValue(new Error('ENOENT: no such file'))
    const d = deps({ readFile })
    const result = await analyzeThreadDump({ file_path: '/nope.txt' }, d)
    expect(result.isError).toBe(true)
    expect(result.text).toContain('/nope.txt')
    expect(d.createAnalysis).not.toHaveBeenCalled()
  })
})
