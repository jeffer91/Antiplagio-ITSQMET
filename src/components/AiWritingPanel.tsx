import { useEffect, useMemo, useState } from 'react';
import {
  loadLatestAiWritingAnalysis,
  runAiWritingAnalysis,
  saveAiSegmentReview,
  setAiWritingRelease,
} from '../lib/aiWriting';
import type { DocumentVersion } from '../types/documents';
import type {
  AiReviewDecision,
  AiWritingAnalysisResult,
  AiWritingSegment,
} from '../types/aiWriting';

interface Props {
  version: DocumentVersion;
  canRun: boolean;
}

const reviewLabels: Record<AiReviewDecision, string> = {
  unreviewed: 'Sin revisar',
  review: 'Revisar',
  request_explanation: 'Solicitar explicación',
  dismissed: 'Descartar alerta',
};

function formatDate(value: string): string {
  return new Date(value).toLocaleString('es-EC', { dateStyle: 'medium', timeStyle: 'short' });
}

function baselineLabel(status: AiWritingAnalysisResult['baseline_status'], count: number): string {
  if (status === 'student_history') return `Historial del estudiante · ${count} versiones`;
  if (status === 'document_internal') return 'Patrón interno del documento';
  return 'Línea base limitada';
}

function riskLabel(segment: AiWritingSegment): string {
  if (segment.risk_level === 'high') return 'Evidencia alta';
  if (segment.risk_level === 'medium') return 'Evidencia media';
  return 'Evidencia baja';
}

function SegmentReview({
  segment,
  onSaved,
}: {
  segment: AiWritingSegment;
  onSaved: (segment: AiWritingSegment) => void;
}): React.JSX.Element {
  const [decision, setDecision] = useState<AiReviewDecision>(segment.review?.decision ?? 'unreviewed');
  const [note, setNote] = useState(segment.review?.note ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDecision(segment.review?.decision ?? 'unreviewed');
    setNote(segment.review?.note ?? '');
  }, [segment.id, segment.review]);

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const review = await saveAiSegmentReview(segment.id, decision, note);
      onSaved({ ...segment, review });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible guardar la revisión.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ai-review-box">
      <div className="ai-review-row">
        <label>
          Decisión del coordinador
          <select value={decision} onChange={(event) => setDecision(event.target.value as AiReviewDecision)}>
            {(Object.keys(reviewLabels) as AiReviewDecision[]).map((value) => (
              <option value={value} key={value}>{reviewLabels[value]}</option>
            ))}
          </select>
        </label>
        <label className="ai-review-note">
          Observación
          <input
            value={note}
            maxLength={2000}
            placeholder="Opcional"
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <button className="secondary-button compact-button" type="button" disabled={saving} onClick={() => void save()}>
          {saving ? 'Guardando…' : 'Guardar revisión'}
        </button>
      </div>
      {error && <div className="alert error-alert">{error}</div>}
    </div>
  );
}

export function AiWritingPanel({ version, canRun }: Props): React.JSX.Element | null {
  const [analysis, setAnalysis] = useState<AiWritingAnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLow, setShowLow] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void loadLatestAiWritingAnalysis(version.id)
      .then((result) => active && setAnalysis(result))
      .catch((caught) => active && setError(caught instanceof Error ? caught.message : 'No fue posible cargar el análisis de escritura asistida.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [version.id]);

  const visibleSegments = useMemo(() => {
    if (!analysis) return [];
    return showLow ? analysis.segments : analysis.segments.filter((segment) => segment.risk_level !== 'low');
  }, [analysis, showLow]);

  const discardedCount = useMemo(
    () => analysis?.segments.filter((segment) => segment.review?.decision === 'dismissed').length ?? 0,
    [analysis],
  );

  const run = async (): Promise<void> => {
    setRunning(true);
    setError(null);
    try {
      const result = await runAiWritingAnalysis(version);
      setAnalysis(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible ejecutar el análisis.');
    } finally {
      setRunning(false);
    }
  };

  const toggleRelease = async (): Promise<void> => {
    if (!analysis) return;
    setReleaseBusy(true);
    setError(null);
    try {
      const next = !analysis.released_to_student;
      await setAiWritingRelease(analysis.id, next);
      setAnalysis({ ...analysis, released_to_student: next });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible cambiar la visibilidad del informe.');
    } finally {
      setReleaseBusy(false);
    }
  };

  const replaceSegment = (updated: AiWritingSegment): void => {
    if (!analysis) return;
    setAnalysis({
      ...analysis,
      segments: analysis.segments.map((segment) => segment.id === updated.id ? updated : segment),
    });
  };

  if (!canRun && !analysis && !loading) return null;

  return (
    <section className="ai-panel">
      <div className="ai-heading">
        <div>
          <span className="eyebrow dark">Escritura asistida por IA</span>
          <h3>Indicadores estilométricos y cambios de autoría aparente</h3>
          <p>El índice combina varias señales. No representa una probabilidad de que “ChatGPT escribió el texto” y no debe utilizarse como única evidencia.</p>
        </div>
        {analysis && (
          <div className={`ai-score ${analysis.evidence_score >= 72 ? 'high' : analysis.evidence_score >= 48 ? 'medium' : 'low'}`}>
            <strong>{analysis.evidence_score.toFixed(0)}</strong>
            <span>índice / 100</span>
          </div>
        )}
      </div>

      {loading && <div className="inline-loading"><span className="mini-spinner" />Cargando indicadores…</div>}
      {error && <div className="alert error-alert">{error}</div>}

      {!loading && !analysis && canRun && (
        <div className="ai-empty">
          <p>Esta versión todavía no tiene un análisis de señales estilométricas.</p>
          <button className="secondary-button" type="button" disabled={running || version.extraction_status !== 'ready'} onClick={() => void run()}>
            {running ? 'Analizando…' : 'Analizar indicios de IA'}
          </button>
        </div>
      )}

      {running && (
        <div className="ai-running">
          <span className="mini-spinner" />
          <div><strong>Analizando fragmentos…</strong><small>Se comparan patrones internos, versiones anteriores y señales de regularidad lingüística.</small></div>
        </div>
      )}

      {analysis && (
        <>
          <div className="ai-warning">
            <strong>Interpretación correcta</strong>
            <span>{analysis.flagged_word_percent.toFixed(1)}% del texto analizable aparece en fragmentos con evidencia media o alta. Esto es una señal para revisión humana, no una conclusión de autoría.</span>
          </div>

          <div className="ai-stats">
            <span><strong>{analysis.flagged_words.toLocaleString('es-EC')}</strong> palabras señaladas</span>
            <span><strong>{analysis.high_segment_count}</strong> fragmentos altos</span>
            <span><strong>{analysis.medium_segment_count}</strong> fragmentos medios</span>
            <span><strong>{baselineLabel(analysis.baseline_status, analysis.baseline_source_count)}</strong> línea base</span>
          </div>

          <div className="ai-map" aria-label="Mapa de evidencia por fragmento">
            {analysis.segments.map((segment) => (
              <span
                key={segment.id}
                className={`ai-map-segment ${segment.risk_level} ${segment.review?.decision === 'dismissed' ? 'dismissed' : ''}`}
                title={`Fragmento ${segment.segment_index + 1}: ${segment.evidence_score.toFixed(0)}/100`}
              />
            ))}
          </div>

          <div className="ai-toolbar">
            <div>
              <strong>Fragmentos y evidencias</strong>
              <small>{discardedCount > 0 ? `${discardedCount} alertas descartadas por revisión humana.` : 'Prioriza los fragmentos de evidencia alta.'}</small>
            </div>
            <label className="ai-low-toggle">
              <input type="checkbox" checked={showLow} onChange={(event) => setShowLow(event.target.checked)} />
              Mostrar evidencia baja
            </label>
          </div>

          <div className="ai-segment-list">
            {visibleSegments.length === 0 ? (
              <div className="no-sources">No hay fragmentos con evidencia media o alta en esta ejecución.</div>
            ) : visibleSegments.map((segment) => (
              <article className={`ai-segment-card ${segment.risk_level} ${segment.review?.decision === 'dismissed' ? 'dismissed' : ''}`} key={segment.id}>
                <div className="ai-segment-head">
                  <div>
                    <span className={`ai-risk-badge ${segment.risk_level}`}>{riskLabel(segment)}</span>
                    <strong>Fragmento {segment.segment_index + 1}</strong>
                    <small>{segment.word_count} palabras · índice {segment.evidence_score.toFixed(0)}/100</small>
                  </div>
                  {segment.review && segment.review.decision !== 'unreviewed' && (
                    <span className={`ai-review-state ${segment.review.decision}`}>{reviewLabels[segment.review.decision]}</span>
                  )}
                </div>

                <blockquote className="ai-excerpt">{segment.excerpt}</blockquote>

                <div className="ai-signal-grid">
                  {segment.signals.slice(0, 5).map((signal) => (
                    <div className="ai-signal" key={`${segment.id}-${signal.key}`}>
                      <div><strong>{signal.label}</strong><span>{signal.score.toFixed(0)}/100</span></div>
                      <p>{signal.detail}</p>
                    </div>
                  ))}
                </div>

                {canRun && <SegmentReview segment={segment} onSaved={replaceSegment} />}
              </article>
            ))}
          </div>

          <div className="ai-meta">Último análisis: {formatDate(analysis.created_at)} · {analysis.algorithm_version}</div>

          {canRun && (
            <div className="ai-actions">
              <button className="secondary-button compact-button" type="button" disabled={running} onClick={() => void run()}>
                {running ? 'Analizando…' : 'Analizar de nuevo'}
              </button>
              <button className="secondary-button compact-button" type="button" disabled={releaseBusy} onClick={() => void toggleRelease()}>
                {analysis.released_to_student ? 'Ocultar al estudiante' : 'Liberar al estudiante'}
              </button>
              <span className={analysis.released_to_student ? 'release-state released' : 'release-state'}>
                {analysis.released_to_student ? 'Visible para el estudiante' : 'Solo coordinador'}
              </span>
            </div>
          )}
        </>
      )}
    </section>
  );
}
