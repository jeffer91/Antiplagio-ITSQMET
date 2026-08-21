import { useEffect, useMemo, useState } from 'react';
import {
  exportIntegrityReportExcel,
  exportIntegrityReportPdf,
  loadLatestIntegrityReport,
  saveIntegrityReport,
  setIntegrityReportRelease,
  verifyIntegrityReport,
} from '../lib/integrityReport';
import { loadDocumentAttempts } from '../lib/staffWorkflow';
import type { DocumentListItem, DocumentVersion } from '../types/documents';
import type { IntegrityReportFinalStatus, IntegrityReportRecord } from '../types/integrityReport';
import type { AnalysisAttempt } from '../types/plagGuard';

interface Props {
  document: DocumentListItem;
  version: DocumentVersion;
  canRun: boolean;
}

const statusLabels: Record<IntegrityReportFinalStatus, string> = {
  pending: 'Pendiente de decisión',
  approved: 'Aprobado',
  observed: 'Con observaciones',
  correction_required: 'Requiere corrección',
  rejected: 'No aprobado',
};

function pct(value: number | null): string {
  return value === null ? 'N/D' : `${value.toFixed(1)}%`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('es-EC', { dateStyle: 'medium', timeStyle: 'short' });
}

export function IntegrityReportPanel({ document, version, canRun }: Props): React.JSX.Element | null {
  const [report, setReport] = useState<IntegrityReportRecord | null>(null);
  const [attempt, setAttempt] = useState<AnalysisAttempt | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState<'pdf' | 'excel' | null>(null);
  const [observation, setObservation] = useState('');
  const [verified, setVerified] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setVerified(null);
    void Promise.all([
      loadLatestIntegrityReport(version.id),
      canRun ? loadDocumentAttempts(document.id) : Promise.resolve([] as AnalysisAttempt[]),
    ])
      .then(async ([result, attempts]) => {
        if (!active) return;
        setReport(result);
        setAttempt(attempts.find((item) => item.target_version_id === version.id) ?? null);
        if (result) {
          setObservation(result.final_observation ?? '');
          setVerified(await verifyIntegrityReport(result));
        }
      })
      .catch((caught) => active && setError(caught instanceof Error ? caught.message : 'No fue posible cargar el informe oficial.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [canRun, document.id, version.id]);

  const availableModules = useMemo(() => {
    if (!report) return 0;
    const snapshot = report.snapshot;
    return [snapshot.internal_similarity, snapshot.external_similarity, snapshot.citation_integrity, snapshot.ai_writing].filter(Boolean).length;
  }, [report]);

  const canCreateOfficial = canRun && attempt?.status === 'complies' && version.extraction_status === 'ready';
  const safeToRelease = verified === true && availableModules === 4;

  const create = async (): Promise<void> => {
    if (!canCreateOfficial) return;
    setCreating(true);
    setError(null);
    setMessage(null);
    try {
      const next = await saveIntegrityReport(document, version, 'approved', observation);
      setReport(next);
      setVerified(await verifyIntegrityReport(next));
      setMessage(`Informe oficial #${next.report_number} creado y sellado con SHA-256.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible crear el informe oficial.');
    } finally {
      setCreating(false);
    }
  };

  const toggleRelease = async (): Promise<void> => {
    if (!report || !safeToRelease) return;
    setReleaseBusy(true);
    setError(null);
    setMessage(null);
    try {
      const next = !report.released_to_student;
      await setIntegrityReportRelease(report.id, next);
      setReport({ ...report, released_to_student: next });
      setMessage(next ? 'Informe oficial liberado al estudiante.' : 'Informe oficial ocultado al estudiante.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible cambiar la visibilidad del informe.');
    } finally {
      setReleaseBusy(false);
    }
  };

  const exportPdf = async (): Promise<void> => {
    if (!report || !safeToRelease) return;
    setExportBusy('pdf');
    setError(null);
    setMessage(null);
    try {
      const result = await exportIntegrityReportPdf(report);
      if (!result.canceled) setMessage(`PDF guardado${result.filePath ? ` en ${result.filePath}` : ''}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible generar el PDF.');
    } finally {
      setExportBusy(null);
    }
  };

  const exportExcel = async (): Promise<void> => {
    if (!report || !safeToRelease) return;
    setExportBusy('excel');
    setError(null);
    setMessage(null);
    try {
      const result = await exportIntegrityReportExcel(report);
      if (!result.canceled) setMessage(`Archivo Excel guardado${result.filePath ? ` en ${result.filePath}` : ''}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible generar el archivo para Excel.');
    } finally {
      setExportBusy(null);
    }
  };

  if (!canRun && !report && !loading) return null;

  return (
    <section className="report-panel">
      <div className="report-heading">
        <div>
          <span className="eyebrow dark">Informe oficial</span>
          <h3>PlagGuard · Integridad académica</h3>
          <p>Solo la primera versión que obtiene Cumple puede generar el informe oficial. Cada informe conserva una instantánea inmutable de los cuatro módulos y su huella SHA-256.</p>
        </div>
        {report && <div className="report-number"><strong>#{report.report_number}</strong><span>{statusLabels[report.final_status]}</span></div>}
      </div>

      {loading && <div className="inline-loading"><span className="mini-spinner" />Cargando informe oficial…</div>}
      {error && <div className="alert error-alert">{error}</div>}
      {message && <div className="alert report-success">{message}</div>}

      {!loading && !report && canRun && !canCreateOfficial && (
        <div className="report-empty">
          <strong>Esta versión todavía no puede generar un informe oficial.</strong>
          <p>{attempt ? 'El intento quedó como No cumple. El estudiante debe corregir y subir una nueva versión.' : 'Primero ejecuta el intento completo de PlagGuard para registrar Cumple o No cumple.'}</p>
        </div>
      )}

      {!loading && !report && canCreateOfficial && (
        <div className="report-empty success-ready">
          <strong>Versión habilitada para informe oficial.</strong>
          <p>{attempt?.consolidated_similarity.toFixed(1)}% · Cumple · {attempt?.process === 'supplementary' ? 'Supletorio' : 'Ordinario'} intento {attempt?.attempt_number}.</p>
        </div>
      )}

      {canCreateOfficial && (
        <div className="report-controls">
          <label className="report-observation">
            Observación final
            <textarea value={observation} maxLength={5000} rows={3} placeholder="Opcional. Registra una observación institucional para el informe." onChange={(event) => setObservation(event.target.value)} />
          </label>
          <button className="primary-button compact" type="button" disabled={creating} onClick={() => void create()}>
            {creating ? 'Creando instantánea…' : report ? 'Crear nueva versión del informe' : 'Crear informe oficial'}
          </button>
        </div>
      )}

      {report && (
        <>
          <div className="report-summary-grid">
            <article><span>Similitud consolidada</span><strong>{pct(report.snapshot.summary.consolidated_similarity_adjusted)}</strong></article>
            <article><span>Resultado</span><strong>Cumple</strong></article>
            <article><span>Módulos</span><strong>{availableModules}/4</strong></article>
            <article><span>Señales de escritura asistida</span><strong>{report.snapshot.summary.ai_evidence_score === null ? 'N/D' : `${report.snapshot.summary.ai_evidence_score.toFixed(0)}/100`}</strong></article>
          </div>

          <div className="report-integrity-row">
            <span className={verified ? 'report-seal ok' : 'report-seal bad'}>{verified === null ? 'Verificando huella…' : verified ? '✓ Instantánea íntegra' : '⚠ Huella no coincide'}</span>
            <span>{availableModules}/4 módulos incluidos</span>
            <span>Creado {formatDate(report.created_at)}</span>
            <code title={report.snapshot_sha256}>SHA-256 {report.snapshot_sha256.slice(0, 16)}…</code>
          </div>

          <div className="report-detail-grid">
            <div><b>Citas sin referencia</b><span>{report.snapshot.summary.unlinked_citation_count ?? 'N/D'}</span></div>
            <div><b>Referencias verificadas</b><span>{report.snapshot.summary.verified_reference_count ?? 'N/D'}</span></div>
            <div><b>Referencias no localizadas</b><span>{report.snapshot.summary.reference_not_found_count ?? 'N/D'}</span></div>
            <div><b>Hallazgos APA</b><span>{report.snapshot.summary.apa_issue_count ?? 'N/D'}</span></div>
          </div>

          <div className="report-note">La similitud consolidada utiliza cobertura única de palabras: una coincidencia detectada en más de una fuente se contabiliza una sola vez. Las señales de escritura asistida se muestran por separado y no constituyen por sí solas una acusación de plagio.</div>

          {!safeToRelease && <div className="alert error-alert">El informe no puede exportarse ni liberarse hasta que la huella sea válida y estén presentes los 4 módulos.</div>}

          <div className="report-actions">
            <button className="secondary-button compact-button" type="button" disabled={exportBusy !== null || !safeToRelease} onClick={() => void exportPdf()}>{exportBusy === 'pdf' ? 'Generando PDF…' : 'Descargar PDF'}</button>
            <button className="secondary-button compact-button" type="button" disabled={exportBusy !== null || !safeToRelease} onClick={() => void exportExcel()}>{exportBusy === 'excel' ? 'Generando Excel…' : 'Descargar Excel'}</button>
            {canRun && <button className="secondary-button compact-button" type="button" disabled={releaseBusy || !safeToRelease} onClick={() => void toggleRelease()}>{report.released_to_student ? 'Ocultar al estudiante' : 'Liberar al estudiante'}</button>}
            <span className={report.released_to_student ? 'release-state released' : 'release-state'}>{report.released_to_student ? 'Visible para el estudiante' : 'Solo coordinador'}</span>
          </div>
        </>
      )}
    </section>
  );
}
