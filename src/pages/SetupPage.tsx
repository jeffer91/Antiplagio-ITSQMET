export function SetupPage(): React.JSX.Element {
  return (
    <main className="center-page">
      <section className="setup-card">
        <div className="brand centered-brand">
          <div className="brand-mark">SI</div>
          <div>
            <strong>SIAI</strong>
            <span>ITSQMET</span>
          </div>
        </div>
        <span className="status-badge">Fase 1 instalada</span>
        <h1>Falta conectar Supabase</h1>
        <p>
          La aplicación ya está preparada. Copia <code>.env.example</code> como <code>.env</code> y coloca
          la URL y la clave publicable de tu proyecto Supabase.
        </p>
        <div className="setup-steps">
          <div><b>1</b><span>Ejecuta <code>supabase/schema.sql</code> en el SQL Editor.</span></div>
          <div><b>2</b><span>Configura las dos variables <code>VITE_SUPABASE_*</code>.</span></div>
          <div><b>3</b><span>Reinicia <code>npm run dev</code>.</span></div>
        </div>
        <p className="security-note">Nunca coloques una clave <code>service_role</code> en Electron.</p>
      </section>
    </main>
  );
}
