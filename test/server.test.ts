import { describe, it, expect, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { buildServer } from '../src/server.js'

const APP = 'https://app.threadmine.dev'
const API = 'https://api.example.test'

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

async function connect(server: ReturnType<typeof buildServer>) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return client
}

describe('MCP server (end to end over InMemoryTransport)', () => {
  it('lists both tools', async () => {
    const client = await connect(buildServer({ apiKey: 'tf_x', apiBaseUrl: API, appBaseUrl: APP }))
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name).sort()
    expect(names).toEqual(['analyze_thread_dump', 'get_analysis'])
  })

  it('analyze_thread_dump runs end to end: captura + polling + formatted text', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(jsonResponse(202, { id: 'an-77' }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'an-77', status: 'PROCESSANDO' }))
      .mockResolvedValueOnce(jsonResponse(200, {
        id: 'an-77', status: 'CONCLUIDA', healthScore: 55,
        problemasDetectados: { problemas: [], totalProblemas: 0, totalCriticos: 0, totalWarnings: 0, totalInfo: 0 },
      }))
    const client = await connect(buildServer({
      apiKey: 'tf_x', apiBaseUrl: API, appBaseUrl: APP, fetchFn: fetchFn as unknown as typeof fetch,
    }))

    const result = await client.callTool({
      name: 'analyze_thread_dump',
      arguments: { content: 'Full thread dump' },
    })

    const text = (result.content as Array<{ type: string; text: string }>)[0].text
    expect(result.isError ?? false).toBe(false)
    expect(text).toContain('55/100')
    expect(text).toContain(`${APP}/app/analises/an-77`)
  }, 15000)

  it('get_analysis returns formatted result', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, {
      id: 'an-5', status: 'CONCLUIDA', healthScore: 91,
      problemasDetectados: { problemas: [], totalProblemas: 0, totalCriticos: 0, totalWarnings: 0, totalInfo: 0 },
    }))
    const client = await connect(buildServer({
      apiKey: 'tf_x', apiBaseUrl: API, appBaseUrl: APP, fetchFn: fetchFn as unknown as typeof fetch,
    }))
    const result = await client.callTool({ name: 'get_analysis', arguments: { analysis_id: 'an-5' } })
    const text = (result.content as Array<{ type: string; text: string }>)[0].text
    expect(text).toContain('91/100')
  })

  it('tool calls fail with clear guidance when THREADMINE_API_KEY is missing', async () => {
    const client = await connect(buildServer({ apiKey: undefined, apiBaseUrl: API, appBaseUrl: APP }))
    const result = await client.callTool({ name: 'analyze_thread_dump', arguments: { content: 'dump' } })
    expect(result.isError).toBe(true)
    const text = (result.content as Array<{ type: string; text: string }>)[0].text
    expect(text).toContain('THREADMINE_API_KEY')
  })
})
