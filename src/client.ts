/**
 * Thin typed HTTP client for the ThreadMine API.
 * All intelligence lives in the backend; this only transports and maps errors.
 */

export interface ClientConfig {
  /** Absent = anonymous mode: only the public endpoints (the same ones the threadmine.dev landing uses). */
  apiKey?: string
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

/** What the public endpoint stores as the visitor's origin; feeds the channel attribution in the backend. */
export interface TrafficOrigin {
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
}

export interface CreatePublicAnalysisParams {
  dump: string
  fileName: string
  origin?: TrafficOrigin
}

export interface CreatedPublicAnalysis {
  analysisId: string
  publicToken: string
}

/** Mirror of the backend's ResultadoPublicoResponse — only the fields the MCP consumes. */
export interface PublicResult {
  analiseId: string
  tokenPublico: string
  status: AnalysisDetail['status']
  expiraEm?: string | null
  healthScore?: number | null
  falha?: { motivo?: string | null; arquivoSuspeito?: string | null; detalheTecnico?: string | null } | null
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
/**
 * Longest Retry-After we wait out inside a tool call. The anonymous limit is hourly, so its
 * Retry-After can be close to an hour: past this cap we report the limit instead of hanging.
 */
export const MAX_RATE_LIMIT_WAIT_S = 10

type RequestBody = string | FormData

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export class ThreadMineClient {
  private readonly apiKey?: string
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

  /** Anonymous upload through the public endpoint (multipart, rate-limited per IP). */
  async createPublicAnalysis(p: CreatePublicAnalysisParams): Promise<CreatedPublicAnalysis> {
    const form = new FormData()
    form.append('arquivo', new Blob([p.dump], { type: 'text/plain' }), p.fileName)
    if (p.origin) {
      form.append('origemTrafego', new Blob([JSON.stringify(p.origin)], { type: 'application/json' }))
    }
    const data = await this.request('/api/v1/public/analises', { method: 'POST', body: form }) as {
      analiseId: string
      tokenPublico: string
    }
    return { analysisId: data.analiseId, publicToken: data.tokenPublico }
  }

  async getPublicResult(publicToken: string): Promise<PublicResult> {
    const data = await this.request(`/api/v1/public/analises/${encodeURIComponent(publicToken)}`, { method: 'GET' })
    return data as PublicResult
  }

  /** Same contract as {@link getAnalysis}, reached through the public token. */
  async getPublicDetail(publicToken: string): Promise<AnalysisDetail> {
    const data = await this.request(
      `/api/v1/public/analises/${encodeURIComponent(publicToken)}/detalhe`, { method: 'GET' })
    return data as AnalysisDetail
  }

  private async request(path: string, init: { method: string; body?: RequestBody }): Promise<unknown> {
    const response = await this.fetchWithNetworkRetry(path, init, /* rateLimitRetryLeft */ 1)
    return response
  }

  private async fetchWithNetworkRetry(
    path: string,
    init: { method: string; body?: RequestBody },
    rateLimitRetryLeft: number,
    attempt = 0,
  ): Promise<unknown> {
    let response: Response
    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, {
        method: init.method,
        headers: this.headers(init.body),
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

  /** FormData sets its own multipart boundary, so Content-Type is only forced for JSON bodies. */
  private headers(body?: RequestBody): Record<string, string> {
    const headers: Record<string, string> = {}
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`
    if (typeof body === 'string') headers['Content-Type'] = 'application/json'
    return headers
  }

  private async handleResponse(
    response: Response,
    path: string,
    init: { method: string; body?: RequestBody },
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
      if (rateLimitRetryLeft > 0 && retryAfter <= MAX_RATE_LIMIT_WAIT_S) {
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
