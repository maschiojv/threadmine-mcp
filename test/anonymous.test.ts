import { describe, it, expect, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { buildServer, usableApiKey } from '../src/server.js'
import { ApiError, MAX_RATE_LIMIT_WAIT_S, RateLimitError, ThreadMineClient } from '../src/client.js'
import { AnonymousGateway, MCP_UTM_MEDIUM, MCP_UTM_SOURCE } from '../src/gateway.js'
import { analyzeThreadDump } from '../src/tools/analyze.js'
import { getAnalysisTool } from '../src/tools/get.js'

const API = 'https://api.example.test'
const APP = 'https://app.example.test'
const SITE = 'https://threadmine.example.test'
const TOKEN = '6f1c0d52-8a7e-4b8e-9c55-2b8f0f1a9d10'
const EXPIRES = '2026-11-05T12:00:00Z'

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

const detail = {
  id: 'an-internal-1', status: 'CONCLUIDA', healthScore: 30,
  problemasDetectados: {
    problemas: [{ tipo: 'DEADLOCK', severidade: 'CRITICAL', descricao: 'Two threads wait on each other' }],
    totalProblemas: 1, totalCriticos: 1, totalWarnings: 0, totalInfo: 0,
  },
}

/** Routes the fake fetch by URL, the way the public API answers. */
function publicApi(resultSequence: Array<Record<string, unknown>>) {
  let poll = 0
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url === `${API}/api/v1/public/analises` && init?.method === 'POST') {
      return jsonResponse(201, { analiseId: 'an-internal-1', tokenPublico: TOKEN })
    }
    if (url === `${API}/api/v1/public/analises/${TOKEN}`) {
      const r = resultSequence[Math.min(poll++, resultSequence.length - 1)]
      return jsonResponse(200, { analiseId: 'an-internal-1', tokenPublico: TOKEN, expiraEm: EXPIRES, ...r })
    }
    if (url === `${API}/api/v1/public/analises/${TOKEN}/detalhe`) {
      return jsonResponse(200, detail)
    }
    return jsonResponse(404, { detail: 'not found' })
  })
}

function anonymousDeps(fetchFn: ReturnType<typeof vi.fn>, clientName?: string) {
  const client = new ThreadMineClient({ baseUrl: API, fetchFn: fetchFn as unknown as typeof fetch, sleepFn: vi.fn() })
  return {
    gateway: new AnonymousGateway(client, SITE, () => clientName),
    readFile: vi.fn(),
    hostname: () => 'dev-box',
    sleep: vi.fn().mockResolvedValue(undefined),
  }
}

async function originPart(fetchFn: ReturnType<typeof vi.fn>) {
  const form = (fetchFn.mock.calls[0][1] as RequestInit).body as FormData
  return JSON.parse(await (form.get('origemTrafego') as Blob).text())
}

describe('usableApiKey', () => {
  it('keeps a real key, trimmed', () => {
    expect(usableApiKey('  tf_live_abc ')).toBe('tf_live_abc')
  })

  it('treats missing, blank and unexpanded ${VAR} placeholders as no key', () => {
    expect(usableApiKey(undefined)).toBeUndefined()
    expect(usableApiKey('   ')).toBeUndefined()
    expect(usableApiKey('${THREADMINE_API_KEY}')).toBeUndefined()
    expect(usableApiKey('${user_config.api_key}')).toBeUndefined()
  })
})

describe('ThreadMineClient public endpoints', () => {
  it('uploads the dump as multipart, with the MCP origin part and no Authorization header', async () => {
    const fetchFn = publicApi([{ status: 'CONCLUIDA' }])
    const client = new ThreadMineClient({ baseUrl: API, fetchFn: fetchFn as unknown as typeof fetch })

    const created = await client.createPublicAnalysis({
      dump: 'Full thread dump', fileName: 'thread-dump.txt', origin: { utmSource: 'mcp', utmMedium: 'mcp' },
    })

    expect(created).toEqual({ analysisId: 'an-internal-1', publicToken: TOKEN })
    const init = fetchFn.mock.calls[0][1] as RequestInit
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
    expect(headers['Content-Type']).toBeUndefined()
    const form = init.body as FormData
    const file = form.get('arquivo') as File
    expect(file.name).toBe('thread-dump.txt')
    expect(await file.text()).toBe('Full thread dump')
    expect((form.get('origemTrafego') as Blob).type).toBe('application/json')
    expect(await originPart(fetchFn)).toEqual({ utmSource: 'mcp', utmMedium: 'mcp' })
  })

  it('does not wait out a long Retry-After: the anonymous limit is hourly', async () => {
    const sleepFn = vi.fn().mockResolvedValue(undefined)
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(429, { detail: 'limit' }, { 'retry-after': '1800' }))
    const client = new ThreadMineClient({ baseUrl: API, fetchFn: fetchFn as unknown as typeof fetch, sleepFn })

    const err = await client.createPublicAnalysis({ dump: 'd', fileName: 'f.txt' }).catch((e) => e)

    expect(err).toBeInstanceOf(RateLimitError)
    expect(err.retryAfterSeconds).toBe(1800)
    expect(sleepFn).not.toHaveBeenCalled()
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('still retries once when Retry-After is short', async () => {
    const sleepFn = vi.fn().mockResolvedValue(undefined)
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(jsonResponse(429, {}, { 'retry-after': String(MAX_RATE_LIMIT_WAIT_S) }))
      .mockResolvedValueOnce(jsonResponse(201, { analiseId: 'a', tokenPublico: TOKEN }))
    const client = new ThreadMineClient({ baseUrl: API, fetchFn: fetchFn as unknown as typeof fetch, sleepFn })

    await client.createPublicAnalysis({ dump: 'd', fileName: 'f.txt' })

    expect(sleepFn).toHaveBeenCalledWith(MAX_RATE_LIMIT_WAIT_S * 1000)
  })
})

describe('analyzeThreadDump without an API key', () => {
  it('runs through the public endpoints and links the public report', async () => {
    const fetchFn = publicApi([{ status: 'PROCESSANDO' }, { status: 'CONCLUIDA' }])
    const d = anonymousDeps(fetchFn, 'claude-code')

    const result = await analyzeThreadDump({ content: 'Full thread dump' }, d)

    expect(result.isError).toBeUndefined()
    expect(result.text).toContain('30/100')
    expect(result.text).toContain('DEADLOCK')
    expect(result.text).toContain(`${SITE}/resultado/${TOKEN}`)
    expect(result.text).toContain(`**Analysis id:** ${TOKEN}`)
    expect(result.text).toContain('until 2026-11-05')
    expect(result.text).toContain('without an account')
    expect(d.sleep).toHaveBeenCalledTimes(1)
  })

  it('tags the upload with utm source/medium mcp and the client name as campaign', async () => {
    const fetchFn = publicApi([{ status: 'CONCLUIDA' }])

    await analyzeThreadDump({ content: 'dump' }, anonymousDeps(fetchFn, 'claude-code'))

    expect(await originPart(fetchFn)).toEqual({
      utmSource: MCP_UTM_SOURCE, utmMedium: MCP_UTM_MEDIUM, utmCampaign: 'claude-code',
    })
  })

  it('omits the campaign when the client did not report a name', async () => {
    const fetchFn = publicApi([{ status: 'CONCLUIDA' }])

    await analyzeThreadDump({ content: 'dump' }, anonymousDeps(fetchFn))

    expect((await originPart(fetchFn)).utmCampaign).toBeUndefined()
  })

  it('explains a rejected file using the backend failure reason', async () => {
    const fetchFn = publicApi([
      { status: 'FALHA', falha: { motivo: 'FORMATO_NAO_RECONHECIDO', arquivoSuspeito: 'HEAP_DUMP' } },
    ])

    const result = await analyzeThreadDump({ content: 'not a dump' }, anonymousDeps(fetchFn))

    expect(result.isError).toBe(true)
    expect(result.text).toContain('FORMATO_NAO_RECONHECIDO')
    expect(result.text).toContain('HEAP_DUMP')
  })

  it('turns the hourly limit into a clear message with the wait in minutes', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(429, { detail: 'limit' }, { 'retry-after': '1500' }))

    const result = await analyzeThreadDump({ content: 'dump' }, anonymousDeps(fetchFn))

    expect(result.isError).toBe(true)
    expect(result.text).toContain('anonymous limit')
    expect(result.text).toContain('25 min')
    expect(result.text).toContain('/en/pricing')
  })
})

describe('getAnalysisTool without an API key', () => {
  it('fetches by public token', async () => {
    const { gateway } = anonymousDeps(publicApi([{ status: 'CONCLUIDA' }]))

    const result = await getAnalysisTool({ analysis_id: TOKEN }, { gateway })

    expect(result.text).toContain('30/100')
    expect(result.text).toContain(`${SITE}/resultado/${TOKEN}`)
  })

  it('says anonymous reports expire when the token is not found', async () => {
    const { gateway } = anonymousDeps(publicApi([]))

    const result = await getAnalysisTool({ analysis_id: 'gone' }, { gateway })

    expect(result.isError).toBe(true)
    expect(result.text).toContain('expire after 7 days')
  })
})

describe('MCP server without an API key (end to end)', () => {
  async function connect(server: ReturnType<typeof buildServer>, name: string) {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name, version: '1.0.0' })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    return client
  }

  it('advertises the anonymous limits in the tool description', async () => {
    const client = await connect(buildServer({ apiBaseUrl: API, appBaseUrl: APP, siteBaseUrl: SITE }), 'x')
    const { tools } = await client.listTools()
    const analyze = tools.find((t) => t.name === 'analyze_thread_dump')!
    expect(analyze.description).toContain('No account needed')
  })

  it('an unexpanded ${VAR} key falls back to anonymous and reports the MCP client as campaign', async () => {
    const fetchFn = publicApi([{ status: 'CONCLUIDA' }])
    const client = await connect(buildServer({
      apiKey: '${THREADMINE_API_KEY}', apiBaseUrl: API, appBaseUrl: APP, siteBaseUrl: SITE,
      fetchFn: fetchFn as unknown as typeof fetch,
    }), 'claude-code')

    const result = await client.callTool({ name: 'analyze_thread_dump', arguments: { content: 'Full thread dump' } })

    const text = (result.content as Array<{ type: string; text: string }>)[0].text
    expect(result.isError ?? false).toBe(false)
    expect(text).toContain(`${SITE}/resultado/${TOKEN}`)
    expect((await originPart(fetchFn)).utmCampaign).toBe('claude-code')
  })
})
