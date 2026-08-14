import { useEffect, useState } from 'react';
import {
  loadLatestSimilarityAnalysis,
  runInternalSimilarityAnalysis,
  setSimilarityRelease,
} from '../lib/similarity';
import type { DocumentVersion } from '../types/documents';
import type {
  AnalysisProgress,
  SimilarityAdjustment,
  SimilarityAnalysisResult,
} from '../types/similarity';
import { SimilarityReportModal } from './SimilarityReportModal';

interface Props {
  version: DocumentVersion;
  canRun: boolean;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('es-EC', { dateStyle: 'medium', timeStyle: 'short' });
}

export function SimilarityPanel({ version, canRun }: Props): React.JSX.Element | null {
  const [analysis, setAnalysis] = useState<SimilarityAnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void loadLatestSimilarityAnalysis(version.id)
      .then((result) => active && setAnalysis(result))
      .catch((caught) => active && setError(caught instanceof Error ? caught.message : 'No fue posible cargar el análisis.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [version.id]);

  const run = async (): Promise<void> => {
    setRunning(true);
    setError(null);
    setProgress({ stage: 'loading', current: 0, total: 0, message: 'Preparando análisis…' });
    try {
      const result = await runInternalSimilarityAnalysis(version, setProgress);
      setAnalysis(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible analizar la similitud.');
    } finally {
      setRunning(false);
    }
  };

  const toggleRelease = async (): Promise<void> => {
    if (!analysis) return;
    setReleaseBusy(true);
    setError(null);
    try {
      const nextValue = !analysis.released_to_student;
      await setSimilarityRelease(analysis.id, nextValue);
      setAnalysis({ ...analysis, released_to_student: nextValue });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible cambiar la visibilidad.');
    } finally {
      setReleaseBusy(false);
    }
  };

  const applySavedAdjustment = (adjustment: SimilarityAdjustment): void => {
    if (!analysis) return;
    setAnalysis({ ...analysis, adjustment });
  };

  if (!canRun && !analysis && !loading) return null;

  const progressPercent = progress?.total ? Math.round((progress.current / progress.total) * 100) : 0;
  const displayedPercent = analysis?.adjustment?.adjusted_similarity_percent ?? analysis?.similarity_percent ?? 0;
  const adjusted = Boolean(analysis?.adjustment && Math.abs(analysis.adjustment.adjusted_similarity_percent - analysis.similarity_percent) >= 0.005);

  return (
    <section className="similarity-panel">
      <div className="similarity-heading">
        <div>
          <span className="eyebrow dark">Similitud institucional</span>
          <h3>Comparación contra el corpus ITSQMET</h3>
        </div>
        {analysis && (
          <div className={`similarity-score ${displayedPercent >= 30 ? 'high' : displayedPercent >= 15 ? 'medium' : 'low'}`}>
            <strong>{displayedPercent.toFixed(1)}%</strong>
            <span>{adjusted ? 'ajustada' : 'similitud'}</span>
          </div>
        )}
      </div>

      {loading && <div className="inline-loading"><span className="mini-spinner" />Cargando resultado…</div>}
      {error && <div className="alert error-alert">{error}</div>}

      {!loading && !analysis && canRun && (
        <div className="similarity-empty">
          <p>Esta versión todavía no ha sido comparada contra los trabajos almacenados en SIAI.</p>
          <button className="secondary-button" type="button" disabled={version.extraction_status !== 'ready' || running} onClick={() => void run()}>
            Analizar similitud interna
          </button>
        </div>
      )}

      {running && progress && (
        <div className="analysis-progress">
          <div><strong>{progress.message}</strong><span>{progress.total ? `${progress.current}/${progress.total}` : ''}</span></div>
          <div className="progress-track"><span style={{ width: `${progress.total ? progressPercent : 12}%` }} /></div>
        </div>
      )}

      {analysis && (
        <>
          <div className="similarity-stats">
            <span><strong>{(analysis.adjustment?.adjusted_matched_words ?? analysis.matched_words).toLocaleString('es-EC')}</strong> palabras contabilizadas</span>
            <span><strong>{analysis.source_count}</strong> fuentes institucionales</span>
            <span><strong>{analysis.total_words.toLocaleString('es-EC')}</strong> palabras analizadas</span>
          </div>
          <div className="analysis-meta">
            Último análisis: {formatDate(analysis.created_at)} · {analysis.algorithm_version}
            {adjusted && <> · Original {analysis.similarity_percent.toFixed(1)}%</>}
          </div>

          {analysis.sources.length === 0 ? (
            <div className="no-sources">No se encontraron pasajes institucionales de al menos 10 palabras con evidencia suficiente.</div>
          ) : (
            <div className="source-list">
              {analysis.sources.slice(0, 5).map((source, index) => (
                <article className="source-card" key={source.id ?? `${source.source_version_id}-${index}`}>
                  <div className="source-card-heading">
                    <span className="source-number">{index + 1}</span>
                    <div><strong>{source.source_title}</strong><small>{source.owner_name ?? 'Repositorio institucional'} · V{source.source_version_number}</small></div>
                    <b>{source.similarity_percent.toFixed(1)}%</b>
                  </div>
                  <div className="match-stack">
                    {source.matches.slice(0, 2).map((match, matchIndex) => (
                      <div className="match-pair" key={match.id ?? `${source.source_version_id}-${matchIndex}`}>
                        <span className={`match-kind ${match.match_type}`}>{match.match_type === 'exact' ? 'Coincidencia textual' : 'Coincidencia cercana'}</span>
                        <p><b>Trabajo revisado:</b> {match.target_excerpt}</p>
                        <p><b>Fuente institucional:</b> {match.source_excerpt}</p>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}

          <div className="similarity-actions">
            <button className="primary-button compact" type="button" onClick={() => setReportOpen(true)}>Abrir informe interactivo</button>
            {canRun && <button className="secondary-button compact-button" type="button" disabled={running} onClick={() => void run()}>Analizar de nuevo</button>}
            {canRun && (
              <button className="secondary-button compact-button" type="button" disabled={releaseBusy} onClick={() => void toggleRelease()}>
                {analysis.released_to_student ? 'Ocultar al estudiante' : 'Liberar resultado al estudiante'}
              </button>
            )}
            {canRun && <span className={analysis.released_to_student ? 'release-state released' : 'release-state'}>{analysis.released_to_student ? 'Visible para el estudiante' : 'Solo coordinador'}</span>}
          </div>

          {reportOpen && (
            <SimilarityReportModal
              version={version}
              analysis={analysis}
              canEdit={canRun}
              onClose={() => setReportOpen(false)}
              onAdjustmentSaved={applySavedAdjustment}
            />
          )}
        </>
      )}
    </section>
  );
}
