import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { createOriginalSignedUrl, loadDocumentVersions } from '../lib/documents';
import type { DocumentListItem, DocumentVersion, ExtractionStatus } from '../types/documents';
import { CitationIntegrityPanel } from './CitationIntegrityPanel';
import { ExternalSimilarityPanel } from './ExternalSimilarityPanel';
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

export function DocumentDetailsModal({ document, onClose }: Props): React.JSX.Element | null {
  const { profile } = useAuth();
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!document) return;
    let active = true;
    setLoading(true);
    setError(null);
    void loadDocumentVersions(document.id)
      .then((data) => active && setVersions(data))
      .catch((caught) => active && setError(caught instanceof Error ? caught.message : 'No fue posible cargar las versiones.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [document]);

  if (!document) return null;

  const openOriginal = async (version: DocumentVersion): Promise<void> => {
    try {
      const url = await createOriginalSignedUrl(version.storage_path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible abrir el archivo.');
    }
  };

  const canRunAnalysis = profile?.role === 'coordinator';

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal-card details-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-heading">
          <div><span className="eyebrow dark">Historial de versiones</span><h2>{document.title}</h2><p>{document.owner_name} · {document.owner_email}</p></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar">×</button>
        </div>

        {loading && <div className="inline-loading"><span className="mini-spinner" />Cargando versiones…</div>}
        {error && <div className="alert error-alert">{error}</div>}

        <div className="version-stack">
          {versions.map((version) => (
            <article className="version-card" key={version.id}>
              <div className="version-card-top">
                <div><strong>Versión {version.version_number}</strong><span>{new Date(version.created_at).toLocaleString('es-EC')}</span></div>
                <span className={`document-status ${version.extraction_status}`}>{labels[version.extraction_status]}</span>
              </div>
              <div className="version-meta">
                <span>{version.original_file_name}</span><span>{formatBytes(version.size_bytes)}</span><span>{version.word_count.toLocaleString('es-EC')} palabras</span><span>{version.page_count ? `${version.page_count} páginas` : 'Paginación no disponible'}</span>
              </div>
              {version.extraction_error && <div className="extraction-warning">{version.extraction_error}</div>}
              {version.extracted_text ? <pre className="text-preview">{version.extracted_text.slice(0, 1800)}{version.extracted_text.length > 1800 ? '\n…' : ''}</pre> : <div className="text-preview empty">No hay texto extraído para mostrar.</div>}
              <div className="version-actions">
                <code title={version.sha256}>SHA-256 {version.sha256.slice(0, 12)}…</code>
                <button className="secondary-button compact-button" type="button" onClick={() => void openOriginal(version)}>Abrir original</button>
              </div>
              <SimilarityPanel version={version} canRun={canRunAnalysis} />
              <ExternalSimilarityPanel version={version} canRun={canRunAnalysis} />
              <CitationIntegrityPanel version={version} canRun={canRunAnalysis} />
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
