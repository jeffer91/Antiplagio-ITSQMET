import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '../components/AppShell';
import { DocumentDetailsModal } from '../components/DocumentDetailsModal';
import { DocumentList } from '../components/DocumentList';
import { UploadDocumentModal } from '../components/UploadDocumentModal';
import { loadDocuments } from '../lib/documents';
import type { DocumentListItem } from '../types/documents';

export function StudentDashboard(): React.JSX.Element {
  const [documents, setDocuments] = useState<DocumentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [versionTarget, setVersionTarget] = useState<DocumentListItem | null>(null);
  const [detailsTarget, setDetailsTarget] = useState<DocumentListItem | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setError(null);
    const data = await loadDocuments();
    setDocuments(data);
  }, []);

  useEffect(() => {
    void refresh().catch((caught) => setError(caught instanceof Error ? caught.message : 'No fue posible cargar tus entregas.')).finally(() => setLoading(false));
  }, [refresh]);

  const openNew = (): void => { setVersionTarget(null); setUploadOpen(true); };
  const openVersion = (document: DocumentListItem): void => { setVersionTarget(document); setUploadOpen(true); };

  return (
    <AppShell role="student">
      <header className="page-header">
        <div>
          <span className="eyebrow dark">Portal del estudiante</span>
          <h1>Mis entregas académicas</h1>
          <p>Sube tu artículo en PDF o DOCX. Cada corrección queda registrada como una nueva versión y los informes de similitud o revisión bibliográfica aparecen únicamente cuando el coordinador los libera.</p>
        </div>
        <button className="primary-button compact" type="button" onClick={openNew}>+ Nueva entrega</button>
      </header>

      {error && <div className="alert error-alert page-alert">{error}</div>}
      {loading ? <div className="panel-card inline-loading"><span className="mini-spinner" />Cargando tus documentos…</div> : documents.length === 0 ? (
        <section className="student-empty-state">
          <div className="document-icon">A</div>
          <span className="status-badge">SIAI activo</span>
          <h2>Aún no tienes entregas</h2>
          <p>Tu primer archivo quedará almacenado de forma privada, con huella SHA-256, historial de versiones y texto preparado para los análisis académicos.</p>
          <button className="primary-button compact" type="button" onClick={openNew}>Subir primer documento</button>
        </section>
      ) : <DocumentList documents={documents} onView={setDetailsTarget} onNewVersion={openVersion} />}

      <section className="privacy-card">
        <strong>Informes controlados</strong>
        <p>Puedes consultar únicamente tus documentos y los informes que el coordinador haya liberado. No puedes ejecutar búsquedas, modificar exclusiones ni alterar los resultados de citas y bibliografía.</p>
      </section>

      <UploadDocumentModal open={uploadOpen} document={versionTarget} onClose={() => setUploadOpen(false)} onUploaded={refresh} />
      <DocumentDetailsModal document={detailsTarget} onClose={() => setDetailsTarget(null)} />
    </AppShell>
  );
}
