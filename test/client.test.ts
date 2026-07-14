import { describe, it, expect, vi } from 'vitest'
import {
  ThreadMineClient, AuthError, QuotaError, RateLimitError, ApiError,
} from '../src/client.js'

const BASE = 'https://api.example.test'

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function clientWith(fetchFn: typeof fetch, sleepFn = vi.fn().mockResolvedValue(undefined)) {
  return new ThreadMineClient({ apiKey: 'tf_test_key', baseUrl: BASE, fetchFn, sleepFn })
}

describe('createAnalysis', () => {
  it('POSTs base64 content with origem MCP and bearer auth, returns id', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(202, { id: 'abc-123', titulo: 't' }))
    const client = clientWith(fetchFn as unknown as typeof fetch)

    const created = await client.createAnalysis({ title: 'my dump', contentBase64: 'ZHVtcA==', hostname: 'dev-box' })

    expect(created).toEqual({ id: 'abc-123' })
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe(`${BASE}/api/v1/analises/captura`)
    expect(init.method).toBe('POST')
    expect(init.headers['Authorization']).toBe('Bearer tf_test_key')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({
      titulo: 'my dump', conteudoBase64: 'ZHVtcA==', origem: 'MCP', hostname: 'dev-box',
    })
  })

  it('throws AuthError on 401', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(401, { detail: 'nope' }))
    await expect(clientWith(fetchFn as unknown as typeof fetch).createAnalysis({
      title: 't', contentBase64: 'x',
    })).rejects.toBeInstanceOf(AuthError)
  })

  it('throws QuotaError with plan info when 429 body has codigo QUOTA_EXCEDIDA_*', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(429, {
      detail: 'Quota diaria excedida',
      codigo: 'QUOTA_EXCEDIDA_ANALISES',
      planoAtual: 'FREE', planoSugerido: 'PRO', upgradeUrl: '/pricing',
    }))
    const err = await clientWith(fetchFn as unknown as typeof fetch)
      .createAnalysis({ title: 't', contentBase64: 'x' }).catch((e) => e)
    expect(err).toBeInstanceOf(QuotaError)
    expect(err.planoAtual).toBe('FREE')
    expect(err.planoSugerido).toBe('PRO')
    expect(err.upgradeUrl).toBe('/pricing')
  })

  it('retries once on plain 429 respecting Retry-After, then succeeds', async () => {
    const sleepFn = vi.fn().mockResolvedValue(undefined)
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(jsonResponse(429, { detail: 'rate limited' }, { 'retry-after': '3' }))
      .mockResolvedValueOnce(jsonResponse(202, { id: 'ok-1' }))
    const created = await clientWith(fetchFn as unknown as typeof fetch, sleepFn)
      .createAnalysis({ title: 't', contentBase64: 'x' })
    expect(created.id).toBe('ok-1')
    expect(sleepFn).toHaveBeenCalledWith(3000)
  })

  it('throws RateLimitError when the retry is also rate-limited', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(429, { detail: 'rate limited' }, { 'retry-after': '5' }))
    const err = await clientWith(fetchFn as unknown as typeof fetch)
      .createAnalysis({ title: 't', contentBase64: 'x' }).catch((e) => e)
    expect(err).toBeInstanceOf(RateLimitError)
    expect(err.retryAfterSeconds).toBe(5)
  })

  it('retries network errors with backoff (2 retries) then throws ApiError', async () => {
    const sleepFn = vi.fn().mockResolvedValue(undefined)
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    const err = await clientWith(fetchFn as unknown as typeof fetch, sleepFn)
      .createAnalysis({ title: 't', contentBase64: 'x' }).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(fetchFn).toHaveBeenCalledTimes(3)
    expect(sleepFn).toHaveBeenNthCalledWith(1, 1000)
    expect(sleepFn).toHaveBeenNthCalledWith(2, 2000)
  })
})

describe('getAnalysis', () => {
  it('GETs the analysis by id with bearer auth', async () => {
    const detail = { id: 'abc', status: 'CONCLUIDA', healthScore: 72 }
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, detail))
    const result = await clientWith(fetchFn as unknown as typeof fetch).getAnalysis('abc')
    expect(result.status).toBe('CONCLUIDA')
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe(`${BASE}/api/v1/analises/abc`)
    expect(init.method).toBe('GET')
    expect(init.headers['Authorization']).toBe('Bearer tf_test_key')
  })

  it('throws ApiError with status on 404', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(404, { detail: 'not found' }))
    const err = await clientWith(fetchFn as unknown as typeof fetch).getAnalysis('zzz').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(404)
  })
})
