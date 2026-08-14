import { AppShell } from '../components/AppShell';

export function StudentDashboard(): React.JSX.Element {
  return (
    <AppShell role="student">
      <header className="page-header">
        <div>
          <span className="eyebrow dark">Portal del estudiante</span>
          <h1>Mis entregas académicas</h1>
          <p>Tu cuenta está activa. La carga de documentos estará disponible en la siguiente fase.</p>
        </div>
      </header>

      <section className="student-empty-state">
        <div className="document-icon">A</div>
        <span className="status-badge">Fase 2</span>
        <h2>Aún no tienes entregas</h2>
        <p>
          Próximamente podrás cargar tu artículo en PDF o DOCX, conservar cada versión y consultar únicamente los informes que el coordinador libere.
        </p>
        <button className="primary-button compact" type="button" disabled>Subir documento</button>
      </section>

      <section className="privacy-card">
        <strong>Separación de permisos activa</strong>
        <p>Un estudiante no puede convertirse en coordinador ni acceder a perfiles ajenos desde el cliente.</p>
      </section>
    </AppShell>
  );
}
