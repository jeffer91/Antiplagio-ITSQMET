export function SetupPage(): React.JSX.Element {
  return (
    <main className="center-page">
      <section className="setup-card">
        <div className="brand centered-brand">
          <div className="brand-mark">PG</div>
          <div><strong>PlagGuard</strong><span>ITSQMET</span></div>
        </div>
        <span className="status-badge">Configuración institucional</span>
        <h1>Falta conectar Supabase</h1>
        <p>PlagGuard ya está preparado. Copia <code>.env.example</code> como <code>.env</code> y coloca la URL y la clave publicable de tu proyecto Supabase.</p>
        <div className="setup-steps">
          <div><b>1</b><span>Ejecuta <code>supabase/schema.sql</code> y después <code>phase2.sql</code> hasta <code>phase10.sql</code>, en orden.</span></div>
          <div><b>2</b><span>Configura las variables <code>VITE_SUPABASE_*</code> y los proveedores académicos de las Edge Functions.</span></div>
          <div><b>3</b><span>Despliega las Edge Functions y reinicia <code>npm run dev</code>.</span></div>
        </div>
        <p className="security-note">Nunca coloques una clave <code>service_role</code> en Electron.</p>
      </section>
    </main>
  );
}
