import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { runPlagGuardAttempt } from '../lib/completeAnalysis';
import { createOriginalSignedUrl, loadDocumentVersions } from '../lib/documents';
import { loadDocumentAttempts } from '../lib/staffWorkflow';
import type { DocumentListItem, DocumentVersion, ExtractionStatus } from '../types/documents';
import type { AnalysisAttempt } from '../types/plagGuard';
import { AiWritingPanel } from './AiWritingPanel';
import { CitationIntegrityPanel } from './CitationIntegrityPanel';
import { ExternalSimilarityPanel } from './ExternalSimilarityPanel';
import { IntegrityReportPanel } from './IntegrityReportPanel';
import { SimilarityPanel } from './SimilarityPanel';

interface Props {
  document: DocumentListItem | null;
  onClose: () => void;
}

const labels: Record<ExtractionStatus, string> = {
  ready: 'Texto extraído',
  needs_ocr: 'Requiere OCR',
  failed: 'Extracción fallida',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function attemptLabel(attempt: AnalysisAttempt): string {
  return `${attempt.process === 'supplementary' ? 'Supletorio' : 'Ordinario'} · intento ${attempt.attempt_number}`;
}

export function DocumentDetailsModal({ document, onClose }: Props): React.JSX.Element | null {
  const { profile } = useAuth();
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [attempts, setAttempts] = useState<AnalysisAttempt[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [runningVersion, setRunningVersion] = useState<string | null>(null);
  const [progress, setProgress] = useState('');

  const refresh = async (documentId: string): Promise<void> => {
    const [versionRows, attemptRows] = await Promise.all([
      loadDocumentVersions(documentId),
      loadDocumentAttempts(documentId),
    ]);
    setVersions(versionRows);
    setAttempts(attemptRows);
  };

  useEffect(() => {
    if (!document) return;
    let active = true;
    setLoading(true);
    setError(null);
    setMessage(null);
    void Promise.all([loadDocumentVersions(document.id), loadDocumentAttempts(document.id)])
      .then(([versionRows, attemptRows]) => {
        if (!active) return;
        setVersions(versionRows);
        setAttempts(attemptRows);
      })
      .catch((caught) => active && setError(caught instanceof Error ? caught.message : 'No fue posible cargar el historial.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [document]);

  const attemptsByVersion = useMemo(() => new Map(attempts.map((attempt) => [attempt.target_version_id, attempt])), [attempts]);

  if (!document) return null;

  const openOriginal = async (version: DocumentVersion): Promise<void> => {
    try {
      const url = await createOriginalSignedUrl(version.storage_path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible abrir el archivo.');
    }
  };

  const runComplete = async (version: DocumentVersion): Promise<void> => {
    setRunningVersion(version.id);
    setError(null);
    setMessage(null);
    setProgress('Preparando análisis completo…');
    try {
      const result = await runPlagGuardAttempt(document, version, setProgress);
      await refresh(document.id);
      window.dispatchEvent(new Event('plagguard:notifications-changed'));
      setMessage(`${attemptLabel(result.attempt)} registrado: ${result.attempt.consolidated_similarity.toFixed(1)}% · ${result.attempt.status === 'complies' ? 'Cumple' : 'No cumple'}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible ejecutar el intento completo.');
    } finally {
      setRunningVersion(null);
      setProgress('');
    }
  };

  const canRunAnalysis = profile?.role === 'coordinator' || profile?.role === 'admin';

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal-card details-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-heading">
          <div>
            <span className="eyebrow dark">PlagGuard · Historial completo</span>
            <h2>{document.title}</h2>
            <p>{document.owner_name} · {document.owner_email}</p>
            <p>{document.period_name} · {document.career || 'Carrera sin registrar'} · {document.modality || 'Modalidad sin registrar'}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar">×</button>
        </div>

        {loading && <div className="inline-loading"><span className="mini-spinner" />Cargando historial…</div>}
        {error && <div className="alert error-alert">{error}</div>}
        {message && <div className="alert report-success">{message}</div>}
        {runningVersion && <div className="attempt-progress"><span className="mini-spinner" />{progress}</div>}

        <div className="version-stack">
          {versions.map((version) => {
            const attempt = attemptsByVersion.get(version.id);
            const refreshKey = attempt?.id ?? 'sin-intento';
            return (
              <article className="version-card" key={version.id}>
                <div className="version-card-top">
                  <div><strong>Versión {version.version_number}</strong><span>{new Date(version.created_at).toLocaleString('es-EC')}</span></div>
                  <div className="version-status-stack">
                    {attempt && <span className={`attempt-badge ${attempt.status}`}>{attempt.consolidated_similarity.toFixed(1)}% · {attempt.status === 'complies' ? 'Cumple' : 'No cumple'}</span>}
                    <span className={`document-status ${version.extraction_status}`}>{labels[version.extraction_status]}</span>
                  </div>
                </div>
                <div className="version-meta">
                  <span>{version.original_file_name}</span><span>{formatBytes(version.size_bytes)}</span><span>{version.word_count.toLocaleString('es-EC')} palabras</span><span>{version.page_count ? `${version.page_count} páginas` : 'Paginación no disponible'}</span>
                  {attempt && <span>{attemptLabel(attempt)}</span>}
                </div>
                {version.extraction_error && <div className="extraction-warning">{version.extraction_error}</div>}
                {version.extracted_text ? <pre className="text-preview">{version.extracted_text.slice(0, 1800)}{version.extracted_text.length > 1800 ? '\n…' : ''}</pre> : <div className="text-preview empty">No hay texto extraído para mostrar.</div>}
                <div className="version-actions">
                  <code title={version.sha256}>SHA-256 {version.sha256.slice(0, 12)}…</code>
                  <div className="version-action-buttons">
                    <button className="secondary-button compact-button" type="button" onClick={() => void openOriginal(version)}>Abrir original</button>
                    {canRunAnalysis && !attempt && (
                      <button className="primary-button compact" type="button" disabled={runningVersion !== null || version.extraction_status !== 'ready'} onClick={() => void runComplete(version)}>
                        {runningVersion === version.id ? 'Analizando…' : 'Ejecutar intento completo'}
                      </button>
                    )}
                  </div>
                </div>
                {canRunAnalysis && !attempt && <div className="report-note">Los cuatro módulos se ejecutan juntos para que el porcentaje y el intento pertenezcan a una sola ejecución.</div>}
                <SimilarityPanel key={`internal-${version.id}-${refreshKey}`} version={version} canRun={false} />
                <ExternalSimilarityPanel key={`external-${version.id}-${refreshKey}`} version={version} canRun={false} />
                <CitationIntegrityPanel key={`citation-${version.id}-${refreshKey}`} version={version} canRun={false} />
                <AiWritingPanel key={`ai-${version.id}-${refreshKey}`} version={version} canRun={false} />
                <IntegrityReportPanel key={`report-${version.id}-${refreshKey}`} document={document} version={version} canRun={canRunAnalysis} />
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
