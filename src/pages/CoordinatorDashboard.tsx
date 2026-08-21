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
  const [periodFilter, setPeriodFilter] = useState('');
  const [careerFilter, setCareerFilter] = useState('');
  const [modalityFilter, setModalityFilter] = useState('');

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

  const periods = useMemo(() => [...new Set(documents.map((document) => document.period_name).filter(Boolean))].sort(), [documents]);
  const careers = useMemo(() => [...new Set(documents.map((document) => document.career).filter((value): value is string => Boolean(value)))].sort(), [documents]);
  const modalities = useMemo(() => [...new Set(documents.map((document) => document.modality).filter((value): value is string => Boolean(value)))].sort(), [documents]);

  const filteredDocuments = useMemo(() => documents.filter((document) => (
    (!periodFilter || document.period_name === periodFilter)
    && (!careerFilter || document.career === careerFilter)
    && (!modalityFilter || document.modality === modalityFilter)
  )), [careerFilter, documents, modalityFilter, periodFilter]);

  return (
    <AppShell role="coordinator">
      <header className="page-header">
        <div>
          <span className="eyebrow dark">PlagGuard · Coordinador</span>
          <h1>Revisión e informes oficiales</h1>
          <p>Consulta el detalle completo de similitud, fuentes, exclusiones, citas, APA y señales de escritura asistida. El informe oficial se genera únicamente sobre la versión que obtiene Cumple.</p>
        </div>
        <button className="primary-button compact" type="button" onClick={() => setUploadOpen(true)}>+ Cargar trabajo</button>
      </header>

      {error && <div className="alert error-alert page-alert">{error}</div>}

      <section className="metric-grid">
        <article className="metric-card"><span>Trabajos</span><strong>{documents.length}</strong><small>Documentos registrados</small></article>
        <article className="metric-card"><span>Estudiantes</span><strong>{metrics.owners}</strong><small>Con entregas en PlagGuard</small></article>
        <article className="metric-card"><span>Versiones</span><strong>{metrics.versions}</strong><small>Trazabilidad conservada</small></article>
        <article className="metric-card"><span>Listos</span><strong>{metrics.ready}</strong><small>{metrics.ocr} requieren OCR</small></article>
      </section>

      <section className="panel-card coordinator-filter-card">
        <div className="coordinator-filters">
          <label>Periodo
            <select value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value)}>
              <option value="">Todos</option>{periods.map((value) => <option key={value}>{value}</option>)}
            </select>
          </label>
          <label>Carrera
            <select value={careerFilter} onChange={(event) => setCareerFilter(event.target.value)}>
              <option value="">Todas</option>{careers.map((value) => <option key={value}>{value}</option>)}
            </select>
          </label>
          <label>Modalidad
            <select value={modalityFilter} onChange={(event) => setModalityFilter(event.target.value)}>
              <option value="">Todas</option>{modalities.map((value) => <option key={value}>{value}</option>)}
            </select>
          </label>
        </div>
        <span className="filter-count">{filteredDocuments.length} resultados</span>
      </section>

      {loading ? <div className="panel-card inline-loading"><span className="mini-spinner" />Cargando documentos…</div> : filteredDocuments.length === 0 ? (
        <section className="student-empty-state compact-empty"><div className="document-icon">PG</div><h2>Sin resultados</h2><p>No existen trabajos que coincidan con los filtros seleccionados.</p></section>
      ) : <DocumentList documents={filteredDocuments} showOwner onView={setDetailsTarget} />}

      <UploadDocumentModal open={uploadOpen} onClose={() => setUploadOpen(false)} onUploaded={refresh} />
      <DocumentDetailsModal document={detailsTarget} onClose={() => setDetailsTarget(null)} />
    </AppShell>
  );
}
