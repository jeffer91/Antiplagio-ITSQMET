import { useEffect, useMemo, useState } from 'react';
import {
  exportIntegrityReportExcel,
  exportIntegrityReportPdf,
  loadLatestIntegrityReport,
  saveIntegrityReport,
  setIntegrityReportRelease,
  verifyIntegrityReport,
} from '../lib/integrityReport';
import type { DocumentListItem, DocumentVersion } from '../types/documents';
import type { IntegrityReportFinalStatus, IntegrityReportRecord } from '../types/integrityReport';

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
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState<'pdf' | 'excel' | null>(null);
  const [status, setStatus] = useState<IntegrityReportFinalStatus>('pending');
  const [observation, setObservation] = useState('');
  const [verified, setVerified] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setVerified(null);
    void loadLatestIntegrityReport(version.id)
      .then(async (result) => {
        if (!active) return;
        setReport(result);
        if (result) {
          setStatus(result.final_status);
          setObservation(result.final_observation ?? '');
          setVerified(await verifyIntegrityReport(result));
        }
      })
      .catch((caught) => active && setError(caught instanceof Error ? caught.message : 'No fue posible cargar el informe final.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [version.id]);

  const availableModules = useMemo(() => {
    if (!report) return 0;
    const snapshot = report.snapshot;
    return [snapshot.internal_similarity, snapshot.external_similarity, snapshot.citation_integrity, snapshot.ai_writing].filter(Boolean).length;
  }, [report]);

  const create = async (): Promise<void> => {
    setCreating(true);
    setError(null);
    setMessage(null);
    try {
      const next = await saveIntegrityReport(document, version, status, observation);
      setReport(next);
      setVerified(await verifyIntegrityReport(next));
      setMessage(`Informe #${next.report_number} creado. La instantánea quedó sellada con SHA-256.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible crear el informe consolidado.');
    } finally {
      setCreating(false);
    }
  };

  const toggleRelease = async (): Promise<void> => {
    if (!report) return;
    setReleaseBusy(true);
    setError(null);
    setMessage(null);
    try {
      const next = !report.released_to_student;
      await setIntegrityReportRelease(report.id, next);
      setReport({ ...report, released_to_student: next });
      setMessage(next ? 'Informe final liberado al estudiante.' : 'Informe final ocultado al estudiante.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible cambiar la visibilidad del informe.');
    } finally {
      setReleaseBusy(false);
    }
  };

  const exportPdf = async (): Promise<void> => {
    if (!report) return;
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
    if (!report) return;
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
          <span className="eyebrow dark">Informe final</span>
          <h3>Integridad académica · PDF y Excel</h3>
          <p>El informe es una instantánea inmutable de los análisis disponibles. Si luego cambia una exclusión o se ejecuta un análisis nuevo, se crea un informe nuevo en lugar de sobrescribir el anterior.</p>
        </div>
        {report && <div className="report-number"><strong>#{report.report_number}</strong><span>{statusLabels[report.final_status]}</span></div>}
      </div>

      {loading && <div className="inline-loading"><span className="mini-spinner" />Cargando informe final…</div>}
      {error && <div className="alert error-alert">{error}</div>}
      {message && <div className="alert report-success">{message}</div>}

      {!loading && !report && canRun && (
        <div className="report-empty">
          <strong>Aún no existe un informe consolidado para esta versión.</strong>
          <p>SIAI tomará la última similitud institucional, búsqueda externa, revisión bibliográfica e indicadores de IA que estén disponibles.</p>
        </div>
      )}

      {canRun && (
        <div className="report-controls">
          <label>
            Resultado de la revisión
            <select value={status} onChange={(event) => setStatus(event.target.value as IntegrityReportFinalStatus)}>
              {(Object.keys(statusLabels) as IntegrityReportFinalStatus[]).map((value) => <option value={value} key={value}>{statusLabels[value]}</option>)}
            </select>
          </label>
          <label className="report-observation">
            Observación final para el informe
            <textarea value={observation} maxLength={5000} rows={3} placeholder="Opcional. Esta observación será visible si el informe se libera al estudiante." onChange={(event) => setObservation(event.target.value)} />
          </label>
          <button className="primary-button compact" type="button" disabled={creating || version.extraction_status !== 'ready'} onClick={() => void create()}>
            {creating ? 'Creando instantánea…' : report ? 'Crear nueva versión del informe' : 'Crear informe final'}
          </button>
        </div>
      )}

      {report && (
        <>
          <div className="report-summary-grid">
            <article><span>Consolidada ajustada</span><strong>{pct(report.snapshot.summary.consolidated_similarity_adjusted)}</strong></article>
            <article><span>Institucional ajustada</span><strong>{pct(report.snapshot.summary.internal_similarity_adjusted)}</strong></article>
            <article><span>Externa verificada</span><strong>{pct(report.snapshot.summary.external_similarity_verified)}</strong></article>
            <article><span>Indicador IA</span><strong>{report.snapshot.summary.ai_evidence_score === null ? 'N/D' : `${report.snapshot.summary.ai_evidence_score.toFixed(0)}/100`}</strong></article>
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

          <div className="report-note">La similitud consolidada utiliza cobertura única de palabras; una coincidencia encontrada a la vez en ITSQMET y en una fuente pública se contabiliza una sola vez. Los indicadores de IA permanecen separados de la similitud.</div>

          <div className="report-actions">
            <button className="secondary-button compact-button" type="button" disabled={exportBusy !== null || verified === false} onClick={() => void exportPdf()}>{exportBusy === 'pdf' ? 'Generando PDF…' : 'Descargar PDF'}</button>
            <button className="secondary-button compact-button" type="button" disabled={exportBusy !== null || verified === false} onClick={() => void exportExcel()}>{exportBusy === 'excel' ? 'Generando Excel…' : 'Descargar Excel'}</button>
            {canRun && <button className="secondary-button compact-button" type="button" disabled={releaseBusy} onClick={() => void toggleRelease()}>{report.released_to_student ? 'Ocultar al estudiante' : 'Liberar al estudiante'}</button>}
            <span className={report.released_to_student ? 'release-state released' : 'release-state'}>{report.released_to_student ? 'Visible para el estudiante' : 'Solo coordinador'}</span>
          </div>
        </>
      )}
    </section>
  );
}
