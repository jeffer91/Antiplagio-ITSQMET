import { useEffect, useMemo, useState } from 'react';
import { MAX_DOCUMENT_SIZE, uploadDocumentVersion } from '../lib/documents';
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
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<UploadProgressStep | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(document?.title ?? '');
    setFile(null);
    setError(null);
    setStep(null);
  }, [document, open]);

  const fileHint = useMemo(() => {
    if (!file) return 'PDF o DOCX · máximo 25 MB';
    const megabytes = file.size / (1024 * 1024);
    return `${file.name} · ${megabytes.toFixed(megabytes >= 10 ? 0 : 1)} MB`;
  }, [file]);

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

    setBusy(true);
    setError(null);
    try {
      await uploadDocumentVersion({
        title,
        file,
        documentId: document?.id,
        onProgress: setStep,
      });
      await onUploaded();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible cargar el documento.');
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
            <h2 id="upload-title">{document ? `Subir versión ${document.current_version + 1}` : 'Cargar trabajo académico'}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label="Cerrar">×</button>
        </div>

        <form onSubmit={(event) => void submit(event)}>
          <label className="field-label">
            Título del trabajo
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={240} disabled={busy || Boolean(document)} placeholder="Título del artículo académico" />
          </label>

          <label className="file-picker">
            <input
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              disabled={busy}
            />
            <span className="file-picker-icon">↑</span>
            <strong>{file ? 'Archivo seleccionado' : 'Seleccionar documento'}</strong>
            <small>{fileHint}</small>
          </label>

          <div className="upload-note">
            <strong>Qué hará SIAI en esta fase</strong>
            <span>Guardará el original en un bucket privado, calculará SHA-256, extraerá el texto y conservará esta entrega como una versión independiente.</span>
          </div>

          {step && <div className="processing-line"><span className={step === 'done' ? 'tiny-check' : 'mini-spinner'} />{progressText[step]}</div>}
          {error && <div className="alert error-alert">{error}</div>}

          <div className="modal-actions">
            <button className="secondary-button" type="button" onClick={onClose} disabled={busy}>Cancelar</button>
            <button className="primary-button compact" type="submit" disabled={busy}>{busy ? 'Procesando…' : document ? 'Subir nueva versión' : 'Cargar documento'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
