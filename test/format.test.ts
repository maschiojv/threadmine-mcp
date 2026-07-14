import { describe, it, expect } from 'vitest'
import { formatAnalysis, reportLink } from '../src/format.js'
import type { AnalysisDetail } from '../src/client.js'

const APP = 'https://app.threadmine.dev'

/** AnalysisDetail with EVERY consumed field populated (contract test, Golden Rule #14 spirit). */
const fullAnalysis: AnalysisDetail = {
  id: 'a1b2c3',
  titulo: 'prod dump',
  status: 'CONCLUIDA',
  formatoDetectado: 'HOTSPOT',
  totalThreads: 312,
  threadsBloqueadas: 8,
  healthScore: 42,
  problemasDetectados: {
    problemas: [
      {
        tipo: 'DEADLOCK',
        severidade: 'CRITICAL',
        descricao: 'Deadlock entre 2 threads em locks JPA',
        evidencia: { quantidadeThreadsAfetadas: 2, nomesThreads: ['worker-1', 'worker-2'] },
        recomendacao: { titulo: 'Rever ordem de aquisicao de locks', descricao: 'Padronizar a ordem.' },
      },
      {
        tipo: 'POOL_EXHAUSTION',
        severidade: 'WARNING',
        descricao: 'Pool HTTP com 95% de uso',
        evidencia: { quantidadeThreadsAfetadas: 190, nomesThreads: ['http-nio-1'] },
        recomendacao: { titulo: 'Aumentar o pool', descricao: 'Subir maxThreads.' },
      },
    ],
    totalProblemas: 2,
    totalCriticos: 1,
    totalWarnings: 1,
    totalInfo: 0,
  },
  sumarioExecutivo: {
    grauSaude: 'D',
    healthScore: 42,
    causaRaizProvavel: { tipo: 'DEADLOCK', severidade: 'CRITICAL', descricao: 'Deadlock entre 2 threads em locks JPA' },
  },
  erroProcessamento: null,
}

describe('formatAnalysis', () => {
  it('includes every consumed field for a fully populated analysis', () => {
    const text = formatAnalysis(fullAnalysis, APP)
    // health + grade
    expect(text).toContain('42/100')
    expect(text).toContain('(grade D)')
    // problems with type, severity, description, affected threads, recommendation
    expect(text).toContain('DEADLOCK')
    expect(text).toContain('CRITICAL')
    expect(text).toContain('Deadlock entre 2 threads em locks JPA')
    expect(text).toContain('worker-1')
    expect(text).toContain('Rever ordem de aquisicao de locks')
    expect(text).toContain('POOL_EXHAUSTION')
    expect(text).toContain('WARNING')
    // totals
    expect(text).toContain('312')
    expect(text).toContain('8 blocked')
    expect(text).toContain('2 problem(s): 1 critical, 1 warning, 0 info')
    // root cause + link + format
    expect(text).toContain('Probable root cause')
    expect(text).toContain('HOTSPOT')
    expect(text).toContain(`${APP}/app/analises/a1b2c3`)
  })

  it('says no problems were detected when the list is empty', () => {
    const clean: AnalysisDetail = {
      ...fullAnalysis,
      healthScore: 98,
      problemasDetectados: { problemas: [], totalProblemas: 0, totalCriticos: 0, totalWarnings: 0, totalInfo: 0 },
      sumarioExecutivo: { grauSaude: 'A', healthScore: 98, causaRaizProvavel: null },
    }
    const text = formatAnalysis(clean, APP)
    expect(text).toContain('No problems detected')
    expect(text).toContain('98/100')
    expect(text).not.toContain('Probable root cause')
  })

  it('tolerates missing optional fields without printing undefined', () => {
    const sparse: AnalysisDetail = { id: 'x1', status: 'CONCLUIDA' }
    const text = formatAnalysis(sparse, APP)
    expect(text).not.toContain('undefined')
    expect(text).not.toContain('null')
    expect(text).toContain(`${APP}/app/analises/x1`)
  })
})

describe('reportLink', () => {
  it('builds the app deep link', () => {
    expect(reportLink('abc', APP)).toBe('https://app.threadmine.dev/app/analises/abc')
  })

  it('strips trailing slash from base url', () => {
    expect(reportLink('abc', 'https://app.threadmine.dev/')).toBe('https://app.threadmine.dev/app/analises/abc')
  })
})
