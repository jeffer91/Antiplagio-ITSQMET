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
          <p>La Fase 6 añade revisión bibliográfica: SIAI vincula citas autor-fecha con la bibliografía, verifica referencias públicas y separa los problemas APA de las referencias que requieren una comprobación de existencia.</p>
        </div>
        <button className="primary-button compact" type="button" onClick={() => setUploadOpen(true)}>+ Nuevo análisis</button>
      </header>

      {error && <div className="alert error-alert page-alert">{error}</div>}

      <section className="metric-grid">
        <article className="metric-card"><span>Trabajos</span><strong>{documents.length}</strong><small>Documentos registrados</small></article>
        <article className="metric-card"><span>Versiones</span><strong>{metrics.versions}</strong><small>Historial institucional</small></article>
        <article className="metric-card"><span>Listos</span><strong>{metrics.ready}</strong><small>Disponibles para similitud y bibliografía</small></article>
        <article className="metric-card"><span>Requieren OCR</span><strong>{metrics.ocr}</strong><small>{metrics.owners} usuarios con entregas</small></article>
      </section>

      <section className="phase-banner">
        <div><span className="eyebrow dark">Fase 6</span><h2>Citas, referencias y APA 7</h2><p>Abre una versión y usa “Revisar citas y bibliografía”. SIAI detecta el listado de referencias, enlaza las citas del cuerpo, consulta Crossref/OpenAlex y señala DOI, duplicados, orden alfabético y campos ausentes. Una referencia no localizada queda marcada para revisión manual, no como una acusación automática.</p></div>
        <div className="phase-steps"><span>✓ Citas ↔ referencias</span><span>✓ Crossref</span><span>✓ OpenAlex</span><span>✓ APA 7</span></div>
      </section>

      {loading ? <div className="panel-card inline-loading"><span className="mini-spinner" />Cargando documentos…</div> : documents.length === 0 ? (
        <section className="student-empty-state compact-empty"><div className="document-icon">A</div><h2>Sin documentos todavía</h2><p>Sube un trabajo con texto extraíble para revisar su similitud, citas y bibliografía.</p></section>
      ) : <DocumentList documents={documents} showOwner onView={setDetailsTarget} />}

      <UploadDocumentModal open={uploadOpen} onClose={() => setUploadOpen(false)} onUploaded={refresh} />
      <DocumentDetailsModal document={detailsTarget} onClose={() => setDetailsTarget(null)} />
    </AppShell>
  );
}
