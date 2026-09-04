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

const EMPTY_RESULT: StudentCurrentResult = { available: false };

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

function normalizeProcessForVisibleDocument(
  state: StudentProcessState | null,
  staleCurrentResult: boolean,
): StudentProcessState | null {
  if (!state || !staleCurrentResult) return state;

  const stage: StudentProcessState['stage'] = state.ordinary_open === false ? 'ordinary_closed' : 'ordinary';
  return {
    ...state,
    stage,
    ordinary_used: 0,
    ordinary_remaining: state.ordinary_limit ?? 3,
    supplementary_used: 0,
    supplementary_remaining: state.supplementary_limit ?? 3,
    complied_attempt_id: null,
    complied_similarity: null,
    complied_at: null,
  };
}

export function StudentDashboardV2(): React.JSX.Element {
  const { profile } = useAuth();
  const [documents, setDocuments] = useState<DocumentListItem[]>([]);
  const [process, setProcess] = useState<StudentProcessState | null>(null);
  const [institutionalStudent, setInstitutionalStudent] = useState<InstitutionalStudent | null>(null);
  const [currentResult, setCurrentResult] = useState<StudentCurrentResult>(EMPTY_RESULT);
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

  const resultDocument = useMemo(() => {
    if (!currentResult.available || !currentResult.target_document_id) return null;
    return documents.find((document) => document.id === currentResult.target_document_id) ?? null;
  }, [currentResult.available, currentResult.target_document_id, documents]);

  const staleCurrentResult = Boolean(currentResult.available && !resultDocument);
  const visibleResult = resultDocument ? currentResult : EMPTY_RESULT;
  const visibleProcess = useMemo(
    () => normalizeProcessForVisibleDocument(process, staleCurrentResult),
    [process, staleCurrentResult],
  );

  const activeDocument = useMemo(() => resultDocument ?? documents[0] ?? null, [documents, resultDocument]);
  const latestVersion = activeDocument?.latest_version ?? null;
  const resultIsCompliant = visibleResult.available && visibleResult.status === 'complies';
  const resultIsNotCompliant = visibleResult.available && visibleResult.status === 'does_not_comply';
  const latestAlreadyAnalyzed = Boolean(
    visibleResult.available && latestVersion && visibleResult.target_version_id === latestVersion.id,
  );

  const processBlocked = Boolean(visibleProcess?.configured && (
    visibleProcess.stage === 'completed'
    || visibleProcess.stage === 'awaiting_supplementary'
    || visibleProcess.stage === 'exhausted'
    || visibleProcess.stage === 'ordinary_closed'
  ));

  const canAnalyze = Boolean(
    visibleProcess?.configured
    && latestVersion
    && latestVersion.extraction_status === 'ready'
    && !latestAlreadyAnalyzed
    && !processBlocked,
  );

  // Una pantalla sin documento nunca debe quedar bloqueada por un resultado histórico
  // que ya no tiene un documento visible asociado. La carga inicial debe estar disponible.
  const canUpload = Boolean(!activeDocument || (!resultIsCompliant && !processBlocked));

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
      const detail =
        caught instanceof Error
          ? caught.message
          : typeof caught === 'object' && caught !== null && 'message' in caught
            ? String((caught as { message?: unknown }).message || 'No fue posible completar el análisis.')
            : 'No fue posible completar el análisis.';
      setError(detail);
    } finally {
      setAnalyzing(false);
      setAnalysisProgress('');
    }
  };

  if (loading) {
    return (
      <AppShell role="student">
        <div className="student-simple-shell">
          <div className="panel-card inline-loading"><span className="mini-spinner" />Cargando PlagGuard…</div>
        </div>
      </AppShell>
    );
  }

  const institutionalLine = [
    institutionalStudent?.career_name,
    institutionalStudent?.campus ? `Sede ${institutionalStudent.campus}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <AppShell
      role="student"
      suppressNotificationKinds={staleCurrentResult ? ['process_completed', 'attempts_exhausted', 'supplementary_required'] : []}
    >
      <div className="student-simple-shell">
        <header className="student-welcome">
          <div>
            <span className="eyebrow dark">PlagGuard · ITSQMET</span>
            <h1>{profile?.full_name || institutionalStudent?.full_name || 'Estudiante'}</h1>
            <p>{visibleProcess?.configured
              ? `${visibleProcess.period_name} · ${visibleProcess.career} · ${visibleProcess.modality}`
              : institutionalLine || 'Datos institucionales verificados.'}</p>
          </div>
          <span className="simple-process-pill">{processLabel(visibleProcess)}</span>
        </header>

        {error && <div className="alert error-alert page-alert">{error}</div>}

        {staleCurrentResult && (
          <section className="student-process-alert neutral">
            <strong>Artículo habilitado para carga</strong>
            <p>Se encontró un resultado histórico sin un documento disponible en tu proceso actual. Ese registro no bloqueará la carga de tu artículo.</p>
          </section>
        )}

        {visibleProcess?.stage === 'awaiting_supplementary' && (
          <section className="student-process-alert">
            <strong>Pasa a Supletorio</strong>
            <p>Ya utilizaste tus 3 oportunidades de Ordinario. Tus 3 intentos adicionales se habilitarán cuando el Administrador abra el Supletorio.</p>
          </section>
        )}

        {!visibleProcess?.configured && (
          <section className="student-process-alert neutral">
            <strong>Artículo habilitado para carga</strong>
            <p>Puedes subir tu artículo desde ahora. El análisis y los intentos se habilitarán cuando tu periodo académico quede asignado.</p>
          </section>
        )}

        {!activeDocument && visibleProcess?.configured && !staleCurrentResult && (
          <section className="student-process-alert neutral">
            <strong>Artículo habilitado para carga</strong>
            <p>Tu proceso académico está habilitado. Sube el PDF con texto seleccionable o el archivo DOCX para iniciar el análisis.</p>
          </section>
        )}

        <section className={`student-result-card ${resultIsCompliant ? 'complies' : resultIsNotCompliant ? 'does-not-comply' : 'pending'}`}>
          <div className="student-result-top">
            <div>
              <span className="result-kicker">Resultado actual</span>
              {visibleResult.available && visibleResult.consolidated_similarity !== undefined ? (
                <>
                  <strong className="result-percent">{visibleResult.consolidated_similarity.toFixed(1)}%</strong>
                  <span className={`result-state ${resultIsCompliant ? 'ok' : 'bad'}`}>
                    {resultIsCompliant ? 'Cumple' : 'No cumple'}
                  </span>
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
              <strong>{remainingLabel(visibleProcess)}</strong>
              <small>Límite institucional: {visibleProcess?.similarity_limit ?? 20}%</small>
            </div>
          </div>

          {resultIsCompliant && (
            <div className="student-certificate">
              <div className="certificate-check">✓</div>
              <div>
                <strong>Proceso completado</strong>
                <span>Intento {visibleResult.attempt_number} · {visibleResult.process === 'supplementary' ? 'Supletorio' : 'Ordinario'}</span>
                {latestVersion?.original_file_name && <small>Archivo: {latestVersion.original_file_name}</small>}
                {visibleResult.created_at && <small>{new Date(visibleResult.created_at).toLocaleString('es-EC')}</small>}
              </div>
            </div>
          )}

          {!resultIsCompliant && (
            <div className="student-next-action">
              {!activeDocument ? (
                <>
                  <div>
                    <strong>1. Sube tu artículo</strong>
                    <span>PDF con texto seleccionable o DOCX, máximo 25 MB.</span>
                  </div>
                  <button className="primary-button compact" type="button" onClick={openUpload} disabled={!canUpload}>
                    Subir artículo
                  </button>
                </>
              ) : !visibleProcess?.configured ? (
                <>
                  <div>
                    <strong>Artículo cargado</strong>
                    <span>{latestVersion?.original_file_name ?? activeDocument.title} · pendiente de habilitación para análisis.</span>
                  </div>
                  <button className="primary-button compact" type="button" onClick={openUpload} disabled={!canUpload}>
                    Subir nueva versión
                  </button>
                </>
              ) : latestAlreadyAnalyzed && resultIsNotCompliant ? (
                <>
                  <div>
                    <strong>Corrige y vuelve a intentar</strong>
                    <span>Realiza los cambios indicados abajo y sube una nueva versión.</span>
                  </div>
                  <button className="primary-button compact" type="button" onClick={openUpload} disabled={!canUpload}>
                    Subir nueva versión
                  </button>
                </>
              ) : (
                <>
                  <div>
                    <strong>{latestVersion ? `Versión ${latestVersion.version_number} lista` : 'Artículo cargado'}</strong>
                    <span>{latestVersion?.original_file_name ?? activeDocument.title}</span>
                  </div>
                  <button
                    className="primary-button compact"
                    type="button"
                    onClick={() => void runAnalysis()}
                    disabled={!canAnalyze || analyzing}
                  >
                    {analyzing ? 'Analizando…' : 'Analizar ahora'}
                  </button>
                </>
              )}
            </div>
          )}

          {analyzing && (
            <div className="student-analysis-progress">
              <span className="mini-spinner" />
              <span>{analysisProgress}</span>
            </div>
          )}
        </section>

        {resultIsNotCompliant && corrections.length > 0 && (
          <section className="student-corrections">
            <div className="student-section-heading">
              <div>
                <span className="eyebrow dark">Qué debes corregir</span>
                <h2>Revisa estos puntos antes del siguiente intento</h2>
              </div>
              <span>{corrections.length} observaciones</span>
            </div>

            <div className="correction-list">
              {corrections.map((correction) => (
                <article className="correction-card" key={correction.id}>
                  <div className="correction-card-top">
                    <span className="correction-kind">{correctionLabel(correction.category)}</span>
                    <span className={correction.affectsSimilarity ? 'counts-badge' : 'review-badge'}>
                      {correction.affectsSimilarity ? 'Cuenta en similitud' : 'Revisión'}
                    </span>
                  </div>
                  <blockquote>{correction.fragment || 'Fragmento no disponible'}</blockquote>
                  <dl>
                    <div><dt>Fuente</dt><dd>{correction.source}</dd></div>
                    <div><dt>Por qué aparece</dt><dd>{correction.reason}</dd></div>
                    <div><dt>Qué hacer</dt><dd>{correction.action}</dd></div>
                  </dl>
                  {correction.url && (
                    <button
                      className="text-link-button"
                      type="button"
                      onClick={() => window.open(correction.url || '', '_blank', 'noopener,noreferrer')}
                    >
                      Consultar fuente
                    </button>
                  )}
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
