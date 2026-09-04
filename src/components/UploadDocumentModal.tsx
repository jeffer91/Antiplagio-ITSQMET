import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { MAX_DOCUMENT_SIZE, uploadDocumentVersion } from '../lib/documents';
import { loadProcessState, loadStudentUploadTargets, type StudentUploadTarget } from '../lib/plagGuard';
import type { AcademicDocument, UploadProgressStep } from '../types/documents';

interface UploadDocumentModalProps {
  open: boolean;
  document?: AcademicDocument | null;
  onClose: () => void;
  onUploaded: () => Promise<void> | void;
}

const progressText: Record<UploadProgressStep, string> = {
  validating: 'Validando archivo…',
  extracting: 'Extrayendo texto…',
  hashing: 'Calculando huella SHA-256…',
  uploading: 'Guardando archivo de forma segura…',
  registering: 'Registrando la versión…',
  done: 'Carga completada.',
};

export function UploadDocumentModal({ open, document, onClose, onUploaded }: UploadDocumentModalProps): React.JSX.Element | null {
  const { profile } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<UploadProgressStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [targets, setTargets] = useState<StudentUploadTarget[]>([]);
  const [selectedTarget, setSelectedTarget] = useState('');
  const [studentContext, setStudentContext] = useState<StudentUploadTarget | null>(null);
  const [pendingProcess, setPendingProcess] = useState(false);

  const isStaff = profile?.role === 'coordinator' || profile?.role === 'admin';

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setError(null);
    setStep(null);
    setSelectedTarget('');
    setStudentContext(null);
    setPendingProcess(false);

    if (document) return;

    if (isStaff) {
      void loadStudentUploadTargets()
        .then(setTargets)
        .catch((caught) => setError(caught instanceof Error ? caught.message : 'No fue posible cargar los estudiantes.'));
      return;
    }

    if (profile?.role === 'student') {
      void loadProcessState()
        .then((state) => {
          if (!state.configured || !state.period_id || !state.period_name || !state.career || !state.modality) {
            setPendingProcess(true);
            return;
          }
          setStudentContext({
            studentId: profile.id,
            fullName: profile.full_name,
            email: profile.email,
            periodId: state.period_id,
            periodName: state.period_name,
            career: state.career,
            modality: state.modality,
          });
        })
        .catch(() => setPendingProcess(true));
    }
  }, [document, isStaff, open, profile]);

  const fileHint = useMemo(() => {
    if (!file) return 'PDF con texto seleccionable o DOCX · máximo 25 MB';
    const megabytes = file.size / (1024 * 1024);
    return `${file.name} · ${megabytes.toFixed(megabytes >= 10 ? 0 : 1)} MB`;
  }, [file]);

  const activeTarget = useMemo(() => {
    if (document) return null;
    if (isStaff) return targets.find((target) => `${target.studentId}|${target.periodId}` === selectedTarget) ?? null;
    return studentContext;
  }, [document, isStaff, selectedTarget, studentContext, targets]);

  if (!open) return null;

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!file) {
      setError('Selecciona un archivo PDF o DOCX.');
      return;
    }
    if (file.size > MAX_DOCUMENT_SIZE) {
      setError('El archivo supera el límite de 25 MB.');
      return;
    }
    if (!document && isStaff && !activeTarget) {
      setError('Selecciona el estudiante propietario del artículo.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await uploadDocumentVersion({
        file,
        documentId: document?.id,
        ownerId: activeTarget?.studentId ?? (!isStaff ? profile?.id : undefined),
        periodId: activeTarget?.periodId,
        career: activeTarget?.career,
        modality: activeTarget?.modality,
        onProgress: setStep,
      });
      await onUploaded();
      onClose();
    } catch (caught) {
      setStep(null);
      const message =
        caught instanceof Error
          ? caught.message
          : typeof caught === 'object' && caught !== null && 'message' in caught
            ? String((caught as { message?: unknown }).message || 'No fue posible cargar el artículo.')
            : 'No fue posible cargar el artículo.';
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={() => !busy && onClose()}>
      <section className="modal-card upload-modal" role="dialog" aria-modal="true" aria-labelledby="upload-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-heading">
          <div>
            <span className="eyebrow dark">{document ? 'Nueva versión' : 'Nueva entrega'}</span>
            <h2 id="upload-title">{document ? `Subir versión ${document.current_version + 1}` : 'Cargar artículo académico'}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label="Cerrar">×</button>
        </div>

        <form onSubmit={(event) => void submit(event)}>
          {!document && isStaff && (
            <label className="field-label">
              Estudiante propietario
              <select value={selectedTarget} onChange={(event) => setSelectedTarget(event.target.value)} disabled={busy}>
                <option value="">Seleccionar estudiante…</option>
                {targets.map((target) => (
                  <option key={`${target.studentId}-${target.periodId}`} value={`${target.studentId}|${target.periodId}`}>
                    {target.fullName} · {target.periodName} · {target.career} · {target.modality}
                  </option>
                ))}
              </select>
            </label>
          )}

          {!document && activeTarget && (
            <div className="upload-note">
              <strong>{activeTarget.fullName}</strong>
              <span>{activeTarget.periodName} · {activeTarget.career} · {activeTarget.modality}</span>
            </div>
          )}

          {!document && !isStaff && pendingProcess && (
            <div className="upload-note pending-upload-note">
              <strong>Puedes cargar el artículo ahora</strong>
              <span>Quedará guardado con trazabilidad. El análisis se habilitará cuando tu periodo académico esté asignado.</span>
            </div>
          )}

          <label className="file-picker">
            <input
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              disabled={busy}
            />
            <span className="file-picker-icon">↑</span>
            <strong>{file ? 'Archivo seleccionado' : 'Seleccionar artículo'}</strong>
            <small>{fileHint}</small>
          </label>

          <div className="upload-note compact-trace-note">
            <strong>PlagGuard conserva la trazabilidad</strong>
            <span>Archivo privado · SHA-256 · historial de versiones. Los PDF escaneados sin texto seleccionable no son compatibles.</span>
          </div>

          {step && <div className="processing-line"><span className={step === 'done' ? 'tiny-check' : 'mini-spinner'} />{progressText[step]}</div>}
          {error && <div className="alert error-alert">{error}</div>}

          <div className="modal-actions">
            <button className="secondary-button" type="button" onClick={onClose} disabled={busy}>Cancelar</button>
            <button className="primary-button compact" type="submit" disabled={busy}>{busy ? 'Procesando…' : document ? 'Subir nueva versión' : 'Cargar artículo'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
