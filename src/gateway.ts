import type { AnalysisDetail, ThreadMineClient } from './client.js'

export type AnalysisStatus = AnalysisDetail['status']

/** One poll of an analysis, already normalized across the two ways of reaching the API. */
export interface GatewayResult {
  status: AnalysisStatus
  /** Present when status is CONCLUIDA. */
  detail?: AnalysisDetail
  /** Present when status is FALHA. */
  failure?: string
  /** Anonymous reports expire; account reports don't. */
  expiresAt?: string | null
}

/**
 * Where an analysis runs. With an API key it lands in the key's workspace (account quota);
 * without one it goes through the public endpoints, exactly like a visitor on threadmine.dev.
 * The `ref` is what get_analysis takes back: the analysis id, or the public token.
 */
export interface AnalysisGateway {
  readonly anonymous: boolean
  submit(p: { dump: string; title: string; hostname: string }): Promise<string>
  fetch(ref: string): Promise<GatewayResult>
  link(ref: string): string
}

export class AccountGateway implements AnalysisGateway {
  readonly anonymous = false

  constructor(private readonly client: ThreadMineClient, private readonly appBaseUrl: string) {}

  async submit(p: { dump: string; title: string; hostname: string }): Promise<string> {
    const { id } = await this.client.createAnalysis({
      title: p.title,
      contentBase64: Buffer.from(p.dump, 'utf8').toString('base64'),
      hostname: p.hostname,
    })
    return id
  }

  async fetch(ref: string): Promise<GatewayResult> {
    const detail = await this.client.getAnalysis(ref)
    return {
      status: detail.status,
      detail: detail.status === 'CONCLUIDA' ? detail : undefined,
      failure: detail.status === 'FALHA' ? (detail.erroProcessamento ?? 'unknown processing error') : undefined,
    }
  }

  link(ref: string): string {
    return `${this.appBaseUrl.replace(/\/+$/, '')}/app/analises/${ref}`
  }
}

/** utm_source/utm_medium the backend records for MCP uploads, so the weekly metric can count them. */
export const MCP_UTM_SOURCE = 'mcp'
export const MCP_UTM_MEDIUM = 'mcp'

export class AnonymousGateway implements AnalysisGateway {
  readonly anonymous = true

  /**
   * @param clientName name the MCP client reported on initialize (claude-code, cursor...);
   *   sent as utm_campaign so we can tell which assistant brought the analysis.
   */
  constructor(
    private readonly client: ThreadMineClient,
    private readonly siteUrl: string,
    private readonly clientName: () => string | undefined = () => undefined,
  ) {}

  async submit(p: { dump: string; title: string; hostname: string }): Promise<string> {
    const campaign = this.clientName()
    const { publicToken } = await this.client.createPublicAnalysis({
      dump: p.dump,
      fileName: 'thread-dump.txt',
      origin: {
        utmSource: MCP_UTM_SOURCE,
        utmMedium: MCP_UTM_MEDIUM,
        ...(campaign ? { utmCampaign: campaign.slice(0, 200) } : {}),
      },
    })
    return publicToken
  }

  async fetch(ref: string): Promise<GatewayResult> {
    const result = await this.client.getPublicResult(ref)
    if (result.status === 'CONCLUIDA') {
      const detail = await this.client.getPublicDetail(ref)
      return { status: result.status, detail, expiresAt: result.expiraEm }
    }
    if (result.status === 'FALHA') {
      return { status: result.status, failure: describeFailure(result.falha), expiresAt: result.expiraEm }
    }
    return { status: result.status, expiresAt: result.expiraEm }
  }

  link(ref: string): string {
    return `${this.siteUrl.replace(/\/+$/, '')}/resultado/${ref}`
  }
}

function describeFailure(falha?: { motivo?: string | null; arquivoSuspeito?: string | null } | null): string {
  if (!falha?.motivo) return 'unknown processing error'
  return falha.arquivoSuspeito ? `${falha.motivo} (looks like: ${falha.arquivoSuspeito})` : falha.motivo
}
