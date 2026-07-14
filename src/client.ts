/**
 * Thin typed HTTP client for the ThreadMine API.
 * All intelligence lives in the backend; this only transports and maps errors.
 */

export interface ClientConfig {
  apiKey: string
  baseUrl: string
  /** Injectable for tests; defaults to global fetch. */
  fetchFn?: typeof fetch
  /** Injectable for tests; defaults to setTimeout-based sleep. */
  sleepFn?: (ms: number) => Promise<void>
}

export interface CreateAnalysisParams {
  title: string
  contentBase64: string
  hostname?: string
}

export interface CreatedAnalysis {
  id: string
}

/** Mirror of the backend's AnaliseDetalheResponse — only the fields the MCP consumes. */
export interface AnalysisDetail {
  id: string
  titulo?: string
  status: 'AGUARDANDO' | 'PROCESSANDO' | 'CONCLUIDA' | 'FALHA' | 'CANCELADA'
  formatoDetectado?: string | null
  totalThreads?: number | null
  threadsBloqueadas?: number | null
  healthScore?: number | null
  problemasDetectados?: {
    problemas?: Array<{
      tipo?: string
      severidade?: string
      descricao?: string
      evidencia?: { quantidadeThreadsAfetadas?: number; nomesThreads?: string[] }
      recomendacao?: { titulo?: string; descricao?: string }
    }>
    totalProblemas?: number
    totalCriticos?: number
    totalWarnings?: number
    totalInfo?: number
  } | null
  metricasVirtualThread?: unknown
  sumarioExecutivo?: {
    grauSaude?: string
    healthScore?: number
    causaRaizProvavel?: { tipo?: string; severidade?: string; descricao?: string } | null
  } | null
  erroProcessamento?: string | null
}

export class AuthError extends Error {
  constructor() {
    super('Authentication failed (HTTP 401)')
    this.name = 'AuthError'
  }
}

export class QuotaError extends Error {
  constructor(
    message: string,
    public readonly planoAtual: string,
    public readonly planoSugerido: string,
    public readonly upgradeUrl: string,
  ) {
    super(message)
    this.name = 'QuotaError'
  }
}

export class RateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super(`Rate limited — retry after ${retryAfterSeconds}s`)
    this.name = 'RateLimitError'
  }
}

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message)
    this.name = 'ApiError'
  }
}

const NETWORK_RETRIES = 2
const NETWORK_BACKOFF_MS = [1000, 2000]
const DEFAULT_RETRY_AFTER_S = 2

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export class ThreadMineClient {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly fetchFn: typeof fetch
  private readonly sleepFn: (ms: number) => Promise<void>

  constructor(cfg: ClientConfig) {
    this.apiKey = cfg.apiKey
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, '')
    this.fetchFn = cfg.fetchFn ?? fetch
    this.sleepFn = cfg.sleepFn ?? defaultSleep
  }

  async createAnalysis(p: CreateAnalysisParams): Promise<CreatedAnalysis> {
    const body = JSON.stringify({
      titulo: p.title,
      conteudoBase64: p.contentBase64,
      origem: 'MCP',
      ...(p.hostname ? { hostname: p.hostname } : {}),
    })
    const data = await this.request('/api/v1/analises/captura', { method: 'POST', body })
    return { id: (data as { id: string }).id }
  }

  async getAnalysis(id: string): Promise<AnalysisDetail> {
    const data = await this.request(`/api/v1/analises/${encodeURIComponent(id)}`, { method: 'GET' })
    return data as AnalysisDetail
  }

  private async request(path: string, init: { method: string; body?: string }): Promise<unknown> {
    const response = await this.fetchWithNetworkRetry(path, init, /* rateLimitRetryLeft */ 1)
    return response
  }

  private async fetchWithNetworkRetry(
    path: string,
    init: { method: string; body?: string },
    rateLimitRetryLeft: number,
    attempt = 0,
  ): Promise<unknown> {
    let response: Response
    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        ...(init.body ? { body: init.body } : {}),
      })
    } catch (cause) {
      if (attempt < NETWORK_RETRIES) {
        await this.sleepFn(NETWORK_BACKOFF_MS[attempt])
        return this.fetchWithNetworkRetry(path, init, rateLimitRetryLeft, attempt + 1)
      }
      throw new ApiError(`Network error calling ThreadMine API: ${String(cause)}`, 0)
    }
    return this.handleResponse(response, path, init, rateLimitRetryLeft)
  }

  private async handleResponse(
    response: Response,
    path: string,
    init: { method: string; body?: string },
    rateLimitRetryLeft: number,
  ): Promise<unknown> {
    if (response.ok) {
      return response.json()
    }
    const problem = await response.json().catch(() => ({})) as Record<string, unknown>

    if (response.status === 401) throw new AuthError()

    if (response.status === 429) {
      const codigo = typeof problem.codigo === 'string' ? problem.codigo : ''
      if (codigo.startsWith('QUOTA_EXCEDIDA_')) {
        throw new QuotaError(
          String(problem.detail ?? 'Daily analysis quota exceeded'),
          String(problem.planoAtual ?? 'FREE'),
          String(problem.planoSugerido ?? 'PRO'),
          String(problem.upgradeUrl ?? '/pricing'),
        )
      }
      const retryAfter = Number(response.headers.get('retry-after') ?? DEFAULT_RETRY_AFTER_S)
      if (rateLimitRetryLeft > 0) {
        await this.sleepFn(retryAfter * 1000)
        return this.fetchWithNetworkRetry(path, init, rateLimitRetryLeft - 1)
      }
      throw new RateLimitError(retryAfter)
    }

    throw new ApiError(
      String(problem.detail ?? `ThreadMine API error (HTTP ${response.status})`),
      response.status,
    )
  }
}
