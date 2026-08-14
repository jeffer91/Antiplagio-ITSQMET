import { AuthProvider, useAuth } from './auth/AuthContext';
import { isSupabaseConfigured } from './lib/supabase';
import { CoordinatorDashboard } from './pages/CoordinatorDashboard';
import { LoginPage } from './pages/LoginPage';
import { SetupPage } from './pages/SetupPage';
import { StudentDashboard } from './pages/StudentDashboard';

function LoadingScreen(): React.JSX.Element {
  return (
    <main className="center-page">
      <div className="loader" aria-label="Cargando" />
      <p>Cargando SIAI…</p>
    </main>
  );
}

function ProfileProblem(): React.JSX.Element {
  const { profileError, signOut } = useAuth();
  return (
    <main className="center-page">
      <section className="setup-card">
        <span className="status-badge warning">Revisión requerida</span>
        <h1>No pudimos validar tu perfil</h1>
        <p>{profileError || 'El perfil de esta cuenta no está disponible.'}</p>
        <p>Verifica que hayas ejecutado <code>supabase/schema.sql</code> y que el usuario tenga un registro en <code>profiles</code>.</p>
        <button className="primary-button compact" type="button" onClick={() => void signOut()}>Cerrar sesión</button>
      </section>
    </main>
  );
}

function AppContent(): React.JSX.Element {
  const { loading, session, profile } = useAuth();

  if (!isSupabaseConfigured) return <SetupPage />;
  if (loading) return <LoadingScreen />;
  if (!session) return <LoginPage />;
  if (!profile) return <ProfileProblem />;

  return profile.role === 'coordinator' ? <CoordinatorDashboard /> : <StudentDashboard />;
}

export default function App(): React.JSX.Element {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
