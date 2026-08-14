import { AppShell } from '../components/AppShell';

export function CoordinatorDashboard(): React.JSX.Element {
  return (
    <AppShell role="coordinator">
      <header className="page-header">
        <div>
          <span className="eyebrow dark">Panel del coordinador</span>
          <h1>Centro de integridad académica</h1>
          <p>La estructura administrativa está lista. Los análisis documentales se incorporan desde la Fase 2.</p>
        </div>
        <button className="primary-button compact" type="button" disabled title="Disponible en Fase 2">
          + Nuevo análisis
        </button>
      </header>

      <section className="metric-grid">
        <article className="metric-card"><span>Entregas</span><strong>0</strong><small>Sin documentos todavía</small></article>
        <article className="metric-card"><span>En análisis</span><strong>0</strong><small>Motor disponible en Fase 2</small></article>
        <article className="metric-card"><span>Repositorio</span><strong>0</strong><small>Corpus institucional</small></article>
        <article className="metric-card"><span>Estudiantes</span><strong>—</strong><small>Gestionados por autenticación</small></article>
      </section>

      <section className="content-grid">
        <article className="panel-card large-panel">
          <div className="panel-heading">
            <div><span className="eyebrow dark">Estado del sistema</span><h2>Fase 1 completada</h2></div>
            <span className="healthy-dot">Operativa</span>
          </div>
          <div className="check-list">
            <div className="check-row"><b>✓</b><span><strong>Aplicación Electron</strong><small>Ventana de escritorio aislada y segura.</small></span></div>
            <div className="check-row"><b>✓</b><span><strong>Autenticación Supabase</strong><small>Sesiones persistentes con correo y contraseña.</small></span></div>
            <div className="check-row"><b>✓</b><span><strong>Roles separados</strong><small>Estudiante y Coordinador con autorización desde la base.</small></span></div>
            <div className="check-row"><b>✓</b><span><strong>Row Level Security</strong><small>El rol no depende de ocultar botones en la interfaz.</small></span></div>
          </div>
        </article>

        <article className="panel-card">
          <span className="eyebrow dark">Siguiente</span>
          <h2>Fase 2</h2>
          <p>Carga de PDF/DOCX, almacenamiento seguro, versiones y extracción inicial de texto.</p>
          <div className="mini-roadmap"><span>01 Subir</span><span>02 Guardar</span><span>03 Extraer</span><span>04 Versionar</span></div>
        </article>
      </section>
    </AppShell>
  );
}
