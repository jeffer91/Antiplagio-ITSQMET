import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadLatestArticleReview } from '../lib/articleReview';
import type { ArticleReviewBundle, ConsolidatedArticleFinding } from '../types/articleReview';

function severityLabel(value: ConsolidatedArticleFinding['severity']): string {
  if (value === 'critical') return 'Crítico';
  if (value === 'high') return 'Alto';
  if (value === 'medium') return 'Medio';
  return 'Bajo';
}

export function StudentArticleReviewDock(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [bundle, setBundle] = useState<ArticleReviewBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      setBundle(await loadLatestArticleReview());
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
  const activeLabel = bundle
    ? `${bundle.run.successful_evaluators}/${bundle.run.evaluator_count} IA`
    : 'Sin revisión';

  const topFindings = useMemo(() => findings.slice(0, 40), [findings]);

  return (
    <aside className={`article-review-dock ${open ? 'open' : ''}`} aria-label="Revisión global del artículo">
      <button className="article-review-trigger" type="button" onClick={() => setOpen((value) => !value)}>
        <span>Revisión global</span>
        <strong>{typeof score === 'number' ? `${score.toFixed(1)}/10` : '—'}</strong>
        <small>{activeLabel}</small>
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
              <strong>Aún no existe una revisión global</strong>
              <p>Al ejecutar el análisis del artículo, el antiplagio continuará funcionando y después se ejecutarán las IA activas.</p>
            </div>
          )}

          {bundle && (
            <>
              <section className="article-review-score-card">
                <div>
                  <span>Nota final</span>
                  <strong>{bundle.run.final_score === null ? '—' : bundle.run.final_score.toFixed(1)}</strong>
                  <small>/ 10</small>
                </div>
                <div>
                  <span>Nivel</span>
                  <strong className="level">{bundle.run.performance_level || 'Pendiente'}</strong>
                  <small>{bundle.run.successful_evaluators} de {bundle.run.evaluator_count} IA completaron</small>
                </div>
                <div>
                  <span>Antiplagio</span>
                  <strong className="level">{bundle.run.similarity_percent === null ? '—' : `${bundle.run.similarity_percent.toFixed(1)}%`}</strong>
                  <small>Se mantiene como cálculo independiente</small>
                </div>
              </section>

              {bundle.run.status === 'partial' && (
                <div className="alert warning-alert">La revisión terminó con algunas IA fallidas. La nota usa únicamente los evaluadores completados.</div>
              )}
              {bundle.run.status === 'failed' && (
                <div className="alert error-alert">{bundle.run.error_message || 'La revisión global no pudo completarse. El antiplagio no fue afectado.'}</div>
              )}

              <section className="article-review-findings">
                <div className="article-review-heading">
                  <div>
                    <span className="eyebrow dark">Novedades consolidadas</span>
                    <h3>{findings.length} errores o aspectos a corregir</h3>
                  </div>
                  <span className="deduction-total">−{Math.max(0, 10 - (bundle.run.final_score ?? 10)).toFixed(1)}</span>
                </div>

                {topFindings.length === 0 ? (
                  <div className="article-review-empty compact"><strong>Sin novedades penalizadas</strong></div>
                ) : (
                  <div className="article-review-finding-list">
                    {topFindings.map((finding) => (
                      <article className={`article-review-finding severity-${finding.severity}`} key={finding.id}>
                        <div className="article-review-finding-top">
                          <div>
                            <span>{finding.criterion.replace(/_/g, ' ')}</span>
                            <strong>{finding.title}</strong>
                          </div>
                          <div className="article-review-deduction">−{finding.deduction.toFixed(2)}</div>
                        </div>
                        <div className="article-review-meta">
                          <span>{severityLabel(finding.severity)}</span>
                          {finding.page && <span>Pág. {finding.page}</span>}
                          <span>{finding.detected_by_count}/{bundle.run.successful_evaluators} IA</span>
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
