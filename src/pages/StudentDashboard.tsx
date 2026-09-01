import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { AppShell } from '../components/AppShell';
import { UploadDocumentModal } from '../components/UploadDocumentModal';
import { runPlagGuardAttempt } from '../lib/completeAnalysis';
import { loadDocuments, loadDocumentVersions } from '../lib/documents';
import { buildIntegrityReportSnapshot } from '../lib/integrityReport';
import {
  attachPendingDocumentToCurrentProcess,
  buildStudentCorrections,
  loadInstitutionalStudent,
  loadProcessState,
  loadStudentCurrentResult,
  type InstitutionalStudent,
  type StudentCorrection,
} from '../lib/plagGuard';
import type { DocumentListItem } from '../types/documents';
import type { StudentCurrentResult, StudentProcessState } from '../types/plagGuard';

function processLabel(state: StudentProcessState | null): string {
  if (!state?.configured) return 'Pendiente de proceso';
  if (state.stage === 'completed') return 'Proceso completado';
  if (state.stage === 'awaiting_supplementary') return 'Pasa a Supletorio';
  if (state.stage === 'supplementary') return 'Supletorio';
  if (state.stage === 'exhausted') return 'Intentos agotados';
  if (state.stage === 'ordinary_closed') return 'Ordinario cerrado';
  return 'Ordinario';
}

function remainingLabel(state: StudentProcessState | null): string {
  if (!state?.configured) return 'Pendiente';
  if (state.stage === 'supplementary') return `${state.supplementary_remaining ?? 0} de ${state.supplementary_limit ?? 3}`;
  if (state.stage === 'completed' || state.stage === 'exhausted') return '0';
  if (state.stage === 'awaiting_supplementary') return 'Esperando apertura';
  return `${state.ordinary_remaining ?? 0} de ${state.ordinary_limit ?? 3}`;
}

function correctionLabel(category: StudentCorrection['category']): string {
  if (category === 'similarity') return 'Similitud';
  if (category === 'citation') return 'Cita';
  if (category === 'apa') return 'APA 7';
  return 'Escritura asistida';
}

export function StudentDashboard(): React.JSX.Element {
  const { profile } = useAuth();
  const [documents, setDocuments] = useState<DocumentListItem[]>([]);
  const [process, setProcess] = useState<StudentProcessState | null>(null);
  const [institutionalStudent, setInstitutionalStudent] = useState<InstitutionalStudent | null>(null);
  const [currentResult, setCurrentResult] = useState<StudentCurrentResult>({ available: false });
  const [corrections, setCorrections] = useState<StudentCorrection[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [versionTarget, setVersionTarget] = useState<DocumentListItem | null>(null);

  const restoreResultDetail = useCallback(async (docs: DocumentListItem[], result: StudentCurrentResult): Promise<void> => {
    if (!result.available || !result.target_document_id || !result.target_version_id) {
      setCorrections([]);
      return;
    }
    const document = docs.find((item) => item.id === result.target_document_id);
    if (!document) {
      setCorrections([]);
      return;
    }
    const versions = await loadDocumentVersions(document.id);
    const version = versions.find((item) => item.id === result.target_version_id);
    if (!version) {
      setCorrections([]);
      return;
    }
    const snapshot = await buildIntegrityReportSnapshot(document, version);
    setCorrections(buildStudentCorrections(snapshot));
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    setError(null);
    const [docs, state, result] = await Promise.all([
      loadDocuments(),
      loadProcessState(),
      loadStudentCurrentResult(),
    ]);
    setDocuments(docs);
    setProcess(state);
    setCurrentResult(result);
    try {
      await restoreResultDetail(docs, result);
    } catch {
      setCorrections([]);
    }
  }, [restoreResultDetail]);

  useEffect(() => {
    if (!profile?.cedula) return;
    void loadInstitutionalStudent(profile.cedula)
      .then(setInstitutionalStudent)
      .catch(() => setInstitutionalStudent(null));
  }, [profile?.cedula]);

  useEffect(() => {
    void refresh()
      .catch((caught) => setError(caught instanceof Error ? caught.message : 'No fue posible cargar tu proceso.'))
      .finally(() => setLoading(false));
  }, [refresh]);

  const activeDocument = useMemo(() => {
    if (currentResult.target_document_id) {
      const matching = documents.find((document) => document.id === currentResult.target_document_id);
      if (matching) return matching;
    }
    return documents[0] ?? null;
  }, [currentResult.target_document_id, documents]);

  const latestVersion = activeDocument?.latest_version ?? null;
  const resultIsCompliant = currentResult.available && currentResult.status === 'complies';
  const resultIsNotCompliant = currentResult.available && currentResult.status === 'does_not_comply';
  const latestAlreadyAnalyzed = Boolean(latestVersion && currentResult.target_version_id === latestVersion.id);
  const processBlocked = Boolean(process?.configured && (
    process.stage === 'completed'
    || process.stage === 'awaiting_supplementary'
    || process.stage === 'exhausted'
    || process.stage === 'ordinary_closed'
  ));
  const canAnalyze = Boolean(process?.configured && latestVersion && latestVersion.extraction_status === 'ready' && !latestAlreadyAnalyzed && !processBlocked);
  const canUpload = Boolean(!resultIsCompliant && !processBlocked);

  const openUpload = (): void => {
    setVersionTarget(activeDocument ?? null);
    setUploadOpen(true);
  };

  const runAnalysis = async (): Promise<void> => {
    if (!activeDocument || !latestVersion || !canAnalyze) return;
    setAnalyzing(true);
    setError(null);
    setAnalysisProgress('Preparando análisis…');
    try {
      let analysisDocument = activeDocument;
      if (!activeDocument.academic_period_id) {
        await attachPendingDocumentToCurrentProcess(activeDocument.id);
        const refreshedDocuments = await loadDocuments();
        analysisDocument = refreshedDocuments.find((document) => document.id === activeDocument.id) ?? activeDocument;
      }
      const result = await runPlagGuardAttempt(analysisDocument, latestVersion, setAnalysisProgress);
      setCorrections(result.corrections);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible completar el análisis.');
    } finally {
      setAnalyzing(false);
      setAnalysisProgress('');
    }
  };

  if (loading) {
    return (
      <AppShell role="student">
        <div className="student-simple-shell"><div className="panel-card inline-loading"><span className="mini-spinner" />Cargando PlagGuard…</div></div>
      </AppShell>
    );
  }

  const institutionalLine = [
    institutionalStudent?.career_name,
    institutionalStudent?.campus ? `Sede ${institutionalStudent.campus}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <AppShell role="student">
      <div className="student-simple-shell">
        <header className="student-welcome">
          <div>
            <span className="eyebrow dark">PlagGuard · ITSQMET</span>
            <h1>{profile?.full_name || institutionalStudent?.full_name || 'Estudiante'}</h1>
            <p>{process?.configured
              ? `${process.period_name} · ${process.career} · ${process.modality}`
              : institutionalLine || 'Datos institucionales verificados.'}</p>
          </div>
          <span className="simple-process-pill">{processLabel(process)}</span>
        </header>

        {error && <div className="alert error-alert page-alert">{error}</div>}

        {process?.stage === 'awaiting_supplementary' && (
          <section className="student-process-alert">
            <strong>Pasa a Supletorio</strong>
            <p>Ya utilizaste tus 3 oportunidades de Ordinario. Tus 3 intentos adicionales se habilitarán cuando el Administrador abra el Supletorio.</p>
          </section>
        )}

        {!process?.configured && (
          <section className="student-process-alert neutral">
            <strong>Artículo habilitado para carga</strong>
            <p>Puedes subir tu artículo desde ahora. El análisis y los intentos se habilitarán cuando tu periodo académico quede asignado.</p>
          </section>
        )}

        <section className={`student-result-card ${resultIsCompliant ? 'complies' : resultIsNotCompliant ? 'does-not-comply' : 'pending'}`}>
          <div className="student-result-top">
            <div>
              <span className="result-kicker">Resultado actual</span>
              {currentResult.available && currentResult.consolidated_similarity !== undefined ? (
                <>
                  <strong className="result-percent">{currentResult.consolidated_similarity.toFixed(1)}%</strong>
                  <span className={`result-state ${resultIsCompliant ? 'ok' : 'bad'}`}>{resultIsCompliant ? 'Cumple' : 'No cumple'}</span>
                </>
              ) : (
                <>
                  <strong className="result-percent">—</strong>
                  <span className="result-state">Aún sin análisis</span>
                </>
              )}
            </div>
            <div className="student-attempt-summary">
              <span>Intentos disponibles</span>
              <strong>{remainingLabel(process)}</strong>
              <small>Límite institucional: {process?.similarity_limit ?? 20}%</small>
            </div>
          </div>

          {resultIsCompliant && (
            <div className="student-certificate">
              <div className="certificate-check">✓</div>
              <div>
                <strong>Proceso completado</strong>
                <span>Intento {currentResult.attempt_number} · {currentResult.process === 'supplementary' ? 'Supletorio' : 'Ordinario'}</span>
                {currentResult.created_at && <small>{new Date(currentResult.created_at).toLocaleString('es-EC')}</small>}
              </div>
            </div>
          )}

          {!resultIsCompliant && (
            <div className="student-next-action">
              {!activeDocument ? (
                <>
                  <div><strong>1. Sube tu artículo</strong><span>PDF o DOCX, máximo 25 MB.</span></div>
                  <button className="primary-button compact" type="button" onClick={openUpload} disabled={!canUpload}>Subir artículo</button>
                </>
              ) : !process?.configured ? (
                <>
                  <div><strong>Artículo cargado</strong><span>{latestVersion?.original_file_name ?? activeDocument.title} · pendiente de habilitación para análisis.</span></div>
                  <button className="primary-button compact" type="button" onClick={openUpload} disabled={!canUpload}>Subir nueva versión</button>
                </>
              ) : latestAlreadyAnalyzed && resultIsNotCompliant ? (
                <>
                  <div><strong>Corrige y vuelve a intentar</strong><span>Realiza los cambios indicados abajo y sube una nueva versión.</span></div>
                  <button className="primary-button compact" type="button" onClick={openUpload} disabled={!canUpload}>Subir nueva versión</button>
                </>
              ) : (
                <>
                  <div><strong>{latestVersion ? `Versión ${latestVersion.version_number} lista` : 'Artículo cargado'}</strong><span>{latestVersion?.original_file_name ?? activeDocument.title}</span></div>
                  <button className="primary-button compact" type="button" onClick={() => void runAnalysis()} disabled={!canAnalyze || analyzing}>
                    {analyzing ? 'Analizando…' : 'Analizar ahora'}
                  </button>
                </>
              )}
            </div>
          )}

          {analyzing && <div className="student-analysis-progress"><span className="mini-spinner" /><span>{analysisProgress}</span></div>}
        </section>

        {resultIsNotCompliant && corrections.length > 0 && (
          <section className="student-corrections">
            <div className="student-section-heading">
              <div><span className="eyebrow dark">Qué debes corregir</span><h2>Revisa estos puntos antes del siguiente intento</h2></div>
              <span>{corrections.length} observaciones</span>
            </div>
            <div className="correction-list">
              {corrections.map((correction) => (
                <article className="correction-card" key={correction.id}>
                  <div className="correction-card-top">
                    <span className="correction-kind">{correctionLabel(correction.category)}</span>
                    <span className={correction.affectsSimilarity ? 'counts-badge' : 'review-badge'}>{correction.affectsSimilarity ? 'Cuenta en similitud' : 'Revisión'}</span>
                  </div>
                  <blockquote>{correction.fragment || 'Fragmento no disponible'}</blockquote>
                  <dl>
                    <div><dt>Fuente</dt><dd>{correction.source}</dd></div>
                    <div><dt>Por qué aparece</dt><dd>{correction.reason}</dd></div>
                    <div><dt>Qué hacer</dt><dd>{correction.action}</dd></div>
                  </dl>
                  {correction.url && <button className="text-link-button" type="button" onClick={() => window.open(correction.url || '', '_blank', 'noopener,noreferrer')}>Consultar fuente</button>}
                </article>
              ))}
            </div>
          </section>
        )}

        {resultIsNotCompliant && corrections.length === 0 && (
          <section className="panel-card student-no-corrections">
            <strong>Tu resultado está registrado.</strong>
            <p>No fue posible reconstruir el detalle de correcciones en esta sesión. Puedes volver a abrir PlagGuard o pedir al coordinador que revise el análisis completo.</p>
          </section>
        )}
      </div>

      <UploadDocumentModal
        open={uploadOpen}
        document={versionTarget}
        onClose={() => setUploadOpen(false)}
        onUploaded={async () => { await refresh(); }}
      />
    </AppShell>
  );
}
