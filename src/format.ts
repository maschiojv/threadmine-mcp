import type { AnalysisDetail } from './client.js'

export function reportLink(analysisId: string, appBaseUrl: string): string {
  return `${appBaseUrl.replace(/\/+$/, '')}/app/analises/${analysisId}`
}

/**
 * Renders a completed analysis as markdown for the LLM.
 * Defensive on optionals: the backend may omit fields for older/partial analyses.
 */
export function formatAnalysis(analysis: AnalysisDetail, appBaseUrl: string): string {
  const lines: string[] = []
  const score = analysis.healthScore ?? analysis.sumarioExecutivo?.healthScore
  const grade = analysis.sumarioExecutivo?.grauSaude

  lines.push(`# ThreadMine analysis${analysis.titulo ? `: ${analysis.titulo}` : ''}`)
  lines.push('')
  if (score != null) {
    lines.push(`**Health score:** ${score}/100${grade ? ` (grade ${grade})` : ''}`)
  }
  if (analysis.totalThreads != null) {
    const blocked = analysis.threadsBloqueadas != null ? `, ${analysis.threadsBloqueadas} blocked` : ''
    lines.push(`**Threads:** ${analysis.totalThreads}${blocked}`)
  }
  if (analysis.formatoDetectado) {
    lines.push(`**Dump format:** ${analysis.formatoDetectado}`)
  }
  lines.push('')

  const det = analysis.problemasDetectados
  const problems = det?.problemas ?? []
  if (problems.length === 0) {
    lines.push('No problems detected.')
  } else {
    lines.push(
      `## Detected ${det?.totalProblemas ?? problems.length} problem(s): ` +
      `${det?.totalCriticos ?? 0} critical, ${det?.totalWarnings ?? 0} warning, ${det?.totalInfo ?? 0} info`,
    )
    lines.push('')
    for (const p of problems) {
      lines.push(`### [${p.severidade ?? 'INFO'}] ${p.tipo ?? 'PROBLEM'}`)
      if (p.descricao) lines.push(p.descricao)
      const affected = p.evidencia?.quantidadeThreadsAfetadas
      const names = p.evidencia?.nomesThreads ?? []
      if (affected != null || names.length > 0) {
        const sample = names.length > 0 ? ` (e.g. ${names.slice(0, 5).join(', ')})` : ''
        lines.push(`Affected threads: ${affected ?? names.length}${sample}`)
      }
      if (p.recomendacao?.titulo) {
        lines.push(`Recommendation: ${p.recomendacao.titulo}${p.recomendacao.descricao ? ` — ${p.recomendacao.descricao}` : ''}`)
      }
      lines.push('')
    }
  }

  const rootCause = analysis.sumarioExecutivo?.causaRaizProvavel
  if (rootCause?.tipo) {
    lines.push(`**Probable root cause:** [${rootCause.severidade ?? ''}] ${rootCause.tipo}${rootCause.descricao ? ` — ${rootCause.descricao}` : ''}`)
    lines.push('')
  }

  lines.push(`**Full interactive report:** ${reportLink(analysis.id, appBaseUrl)}`)
  return lines.join('\n')
}
