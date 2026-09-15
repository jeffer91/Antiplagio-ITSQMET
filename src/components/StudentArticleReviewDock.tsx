import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadLatestArticleReview } from '../lib/articleReview';
import { loadStudentCurrentResult } from '../lib/plagGuard';
import type { ArticleReviewBundle, ArticleReviewerResult, ConsolidatedArticleFinding } from '../types/articleReview';

const CRITERION_LABELS: Record<string, string> = {
  title_summary: 'Título y resumen',
  problem_justification: 'Problema y justificación',
  objectives_questions: 'Objetivos o preguntas',
  introduction_background: 'Introducción y antecedentes',
  theoretical_framework: 'Marco teórico',
  methodology: 'Metodología',
  results: 'Resultados',
  discussion: 'Discusión',
  conclusions: 'Conclusiones',
  references_citations: 'Referencias y citas',
  integrity_originality: 'Originalidad e integridad',
  academic_writing: 'Redacción académica',
  tables_figures: 'Tablas y figuras',
  global_coherence: 'Coherencia global',
  editorial_format: 'Formato editorial',
};

function severityLabel(value: ConsolidatedArticleFinding['severity']): string {
  if (value === 'critical') return 'Crítico';
  if (value === 'high') return 'Alto';
  if (value === 'medium') return 'Medio';
  return 'Bajo';
}

function consensusLabel(value: number): string {
  if (value >= 0.8) return 'Consenso muy alto';
  if (value >= 0.6) return 'Consenso alto';
  if (value >= 0.4) return 'Consenso medio';
  if (value >= 0.2) return 'Consenso bajo';
  return 'Observación minoritaria';
}

function reviewerTitle(reviewer: ArticleReviewerResult): string {
  const model = reviewer.evaluator_name || reviewer.provider_model_id || `IA ${reviewer.evaluator_slot}`;
  const provider = reviewer.provider ? ` · ${reviewer.provider}` : '';
  const latency = reviewer.duration_ms === null ? '' : ` · ${(reviewer.duration_ms / 1000).toFixed(1)} s`;
  const status = reviewer.status === 'completed' ? 'Completada' : `Falló${reviewer.error_message ? `: ${reviewer.error_message}` : ''}`;
  return `${model}${provider} · ${status}${latency}`;
}

export function StudentArticleReviewDock(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [bundle, setBundle] = useState<ArticleReviewBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const current = await loadStudentCurrentResult();
      if (!current.available || !current.target_version_id) {
        setBundle(null);
        return;
      }
      setBundle(await loadLatestArticleReview(current.target_version_id, current.id ?? null));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible cargar la revisión global.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const handler = (): void => { void refresh(); };
    window.addEventListener('plagguard:article-review-changed', handler);
    return () => window.removeEventListener('plagguard:article-review-changed', handler);
  }, [refresh]);

  const score = bundle?.run.final_score;
  const findings = bundle?.findings ?? [];
  const reviewers = bundle?.reviewers ?? [];
  const activeLabel = bundle
    ? `${bundle.run.successful_evaluators}/${bundle.run.evaluator_count} IA`
    : 'Sin revisión IA';

  const topFindings = useMemo(() => findings.slice(0, 60), [findings]);
  const dots = useMemo(() => reviewers.map((reviewer) => ({
    key: `${reviewer.evaluator_slot}-${reviewer.model_ref ?? reviewer.evaluator_name}`,
    state: reviewer.status === 'completed' ? 'ok' : 'bad',
    title: reviewerTitle(reviewer),
  })), [reviewers]);

  const triggerDots = dots.slice(0, 10);
  const hiddenDots = Math.max(0, dots.length - triggerDots.length);

  return (
    <aside className={`article-review-dock ${open ? 'open' : ''}`} aria-label="Revisión global del artículo">
      <button className="article-review-trigger" type="button" onClick={() => setOpen((value) => !value)}>
        <span>Revisión académica IA</span>
        <strong>{typeof score === 'number' ? `${score.toFixed(1)}/10` : '—'}</strong>
        <small>{activeLabel}</small>
        {triggerDots.length > 0 && (
          <span className="ai-dot-row compact" aria-label={activeLabel}>
            {triggerDots.map((dot) => <i key={dot.key} className={`ai-dot ${dot.state}`} title={dot.title} />)}
            {hiddenDots > 0 && <b className="ai-dot-more">+{hiddenDots}</b>}
          </span>
        )}
      </button>

      {open && (
        <div className="article-review-panel">
          <header>
            <div>
              <span className="eyebrow dark">Artículo académico</span>
              <h2>Evaluación integral</h2>
            </div>
            <button className="ghost-button compact" type="button" onClick={() => setOpen(false)}>Cerrar</button>
          </header>

          {loading && <div className="inline-loading"><span className="mini-spinner" />Cargando revisión…</div>}
          {error && <div className="alert error-alert">{error}</div>}

          {!loading && !bundle && !error && (
            <div className="article-review-empty">
              <strong>Sin revisión IA para el intento actual</strong>
              <p>Cuando el estudiante ejecute el análisis, todas las IA habilitadas por Administración revisarán el artículo con los mismos 15 criterios.</p>
            </div>
          )}

          {bundle && (
            <>
              <section className="article-review-score-card">
                <div>
                  <span>Puntuación consolidada</span>
                  <strong>{bundle.run.final_score === null ? '—' : bundle.run.final_score.toFixed(1)}</strong>
                  <small>/ 10 · normalizada por 15 criterios</small>
                </div>
                <div>
                  <span>Nivel</span>
                  <strong className="level">{bundle.run.performance_level || 'Pendiente'}</strong>
                  <small>{bundle.run.successful_evaluators} de {bundle.run.evaluator_count} IA completaron</small>
                </div>
                <div>
                  <span>Antiplagio</span>
                  <strong className="level">{bundle.run.similarity_percent === null ? '—' : `${bundle.run.similarity_percent.toFixed(1)}%`}</strong>
                  <small>Cálculo institucional independiente</small>
                </div>
              </section>

              <section className="ai-review-models">
                <div className="ai-review-models-head">
                  <div>
                    <strong>IA utilizadas</strong>
                    <span>Todas las habilitadas se ejecutaron automáticamente · {bundle.run.successful_evaluators}/{bundle.run.evaluator_count} completaron</span>
                  </div>
                  {dots.length > 0 && (
                    <div className="ai-dot-row">
                      {dots.map((dot) => <i key={dot.key} className={`ai-dot ${dot.state}`} title={dot.title} />)}
                    </div>
                  )}
                </div>
                <div className="ai-review-model-list">
                  {reviewers.map((reviewer) => (
                    <span key={`${reviewer.evaluator_slot}-${reviewer.model_ref ?? reviewer.evaluator_name}`} className={reviewer.status === 'completed' ? 'ok' : 'bad'} title={reviewer.error_message || undefined}>
                      <i />
                      {reviewer.evaluator_name}
                      {reviewer.provider ? ` · ${reviewer.provider}` : ''}
                      {reviewer.status === 'completed' && reviewer.score !== null ? ` · ${reviewer.score.toFixed(1)}/10` : ''}
                    </span>
                  ))}
                </div>
              </section>

              {bundle.run.status === 'partial' && (
                <div className="alert warning-alert">La revisión terminó con algunas IA fallidas. Las demás continuaron normalmente y la puntuación usa únicamente evaluaciones válidas.</div>
              )}
              {bundle.run.status === 'failed' && (
                <div className="alert error-alert">{bundle.run.error_message || 'La revisión global no pudo completarse. El antiplagio no fue afectado.'}</div>
              )}

              <section className="article-review-findings">
                <div className="article-review-heading">
                  <div>
                    <span className="eyebrow dark">Hallazgos consolidados</span>
                    <h3>{findings.length} aspectos detectados por las IA</h3>
                  </div>
                  <span className="deduction-total">15 criterios</span>
                </div>

                {topFindings.length === 0 ? (
                  <div className="article-review-empty compact"><strong>Sin hallazgos académicos reportados</strong></div>
                ) : (
                  <div className="article-review-finding-list">
                    {topFindings.map((finding) => (
                      <article className={`article-review-finding severity-${finding.severity}`} key={finding.id}>
                        <div className="article-review-finding-top">
                          <div>
                            <span>{CRITERION_LABELS[finding.criterion] || finding.criterion.replace(/_/g, ' ')}</span>
                            <strong>{finding.title}</strong>
                          </div>
                          <div className="article-review-consensus">{(finding.confidence * 100).toFixed(0)}%</div>
                        </div>
                        <div className="article-review-meta">
                          <span>{severityLabel(finding.severity)}</span>
                          {finding.page && <span>Pág. {finding.page}</span>}
                          <span>{finding.detected_by_count}/{bundle.run.successful_evaluators} IA</span>
                          <span>{consensusLabel(finding.confidence)}</span>
                        </div>
                        {finding.fragment && <blockquote>{finding.fragment}</blockquote>}
                        <p>{finding.explanation}</p>
                        <div className="article-review-action"><strong>Cómo corregir:</strong> {finding.recommendation}</div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
