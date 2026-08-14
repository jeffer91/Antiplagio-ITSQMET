import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '../components/AppShell';
import { DocumentDetailsModal } from '../components/DocumentDetailsModal';
import { DocumentList } from '../components/DocumentList';
import { UploadDocumentModal } from '../components/UploadDocumentModal';
import { loadDocuments } from '../lib/documents';
import type { DocumentListItem } from '../types/documents';

export function CoordinatorDashboard(): React.JSX.Element {
  const [documents, setDocuments] = useState<DocumentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [detailsTarget, setDetailsTarget] = useState<DocumentListItem | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setError(null);
    const data = await loadDocuments();
    setDocuments(data);
  }, []);

  useEffect(() => {
    void refresh().catch((caught) => setError(caught instanceof Error ? caught.message : 'No fue posible cargar las entregas.')).finally(() => setLoading(false));
  }, [refresh]);

  const metrics = useMemo(() => {
    const ready = documents.filter((document) => document.status === 'ready').length;
    const ocr = documents.filter((document) => document.status === 'needs_ocr').length;
    const owners = new Set(documents.map((document) => document.owner_id)).size;
    const versions = documents.reduce((sum, document) => sum + document.current_version, 0);
    return { ready, ocr, owners, versions };
  }, [documents]);

  return (
    <AppShell role="coordinator">
      <header className="page-header">
        <div>
          <span className="eyebrow dark">Panel del coordinador</span>
          <h1>Centro de integridad académica</h1>
          <p>La Fase 2 ya recibe PDF y DOCX, conserva versiones, calcula huellas SHA-256 y extrae el texto que alimentará el motor de similitud institucional.</p>
        </div>
        <button className="primary-button compact" type="button" onClick={() => setUploadOpen(true)}>+ Nuevo análisis</button>
      </header>

      {error && <div className="alert error-alert page-alert">{error}</div>}

      <section className="metric-grid">
        <article className="metric-card"><span>Trabajos</span><strong>{documents.length}</strong><small>Documentos registrados</small></article>
        <article className="metric-card"><span>Versiones</span><strong>{metrics.versions}</strong><small>Historial conservado</small></article>
        <article className="metric-card"><span>Listos</span><strong>{metrics.ready}</strong><small>Texto extraído</small></article>
        <article className="metric-card"><span>Requieren OCR</span><strong>{metrics.ocr}</strong><small>{metrics.owners} usuarios con entregas</small></article>
      </section>

      <section className="phase-banner">
        <div><span className="eyebrow dark">Fase 2</span><h2>Ingesta documental operativa</h2><p>El porcentaje de similitud todavía no se calcula: esa lógica corresponde a la Fase 3. Aquí estamos garantizando que el corpus de entrada sea trazable y reproducible.</p></div>
        <div className="phase-steps"><span>✓ PDF/DOCX</span><span>✓ Storage privado</span><span>✓ Versiones</span><span>✓ Extracción</span></div>
      </section>

      {loading ? <div className="panel-card inline-loading"><span className="mini-spinner" />Cargando documentos…</div> : documents.length === 0 ? (
        <section className="student-empty-state compact-empty"><div className="document-icon">A</div><h2>Sin documentos todavía</h2><p>Cuando un estudiante cargue su trabajo aparecerá aquí. También puedes cargar un documento propio para probar la ingesta.</p></section>
      ) : <DocumentList documents={documents} showOwner onView={setDetailsTarget} />}

      <UploadDocumentModal open={uploadOpen} onClose={() => setUploadOpen(false)} onUploaded={refresh} />
      <DocumentDetailsModal document={detailsTarget} onClose={() => setDetailsTarget(null)} />
    </AppShell>
  );
}
