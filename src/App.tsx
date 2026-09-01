import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { isSupabaseConfigured } from './lib/supabase';
import { AdminDashboard } from './pages/AdminDashboard';
import { CoordinatorDashboard } from './pages/CoordinatorDashboard';
import { LoginPage } from './pages/LoginPage';
import { SetupPage } from './pages/SetupPage';
import { StudentDashboard } from './pages/StudentDashboard';

function LoadingScreen(): React.JSX.Element {
  return (
    <main className="center-page">
      <div className="loader" aria-label="Cargando" />
      <p>Cargando PlagGuard…</p>
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
        <button className="primary-button compact" type="button" onClick={() => void signOut()}>Cerrar sesión</button>
      </section>
    </main>
  );
}

function useHashPath(): string {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onHashChange = (): void => setHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  return hash;
}

function AppContent(): React.JSX.Element {
  const { loading, session, profile } = useAuth();
  const hash = useHashPath();
  const adminRoute = hash === '#/admin';

  if (!isSupabaseConfigured) return <SetupPage />;
  if (loading) return <LoadingScreen />;

  // El acceso administrativo es independiente del acceso estudiantil.
  // Si hay una sesión de estudiante abierta, se sigue mostrando el login admin
  // para permitir reemplazarla por una cuenta Administrador.
  if (adminRoute) {
    if (session && profile?.role === 'admin') return <AdminDashboard />;
    return <LoginPage adminAccess activeRole={profile?.role ?? null} />;
  }

  if (!session) return <LoginPage />;
  if (!profile) return <ProfileProblem />;
  if (profile.role === 'admin') return <AdminDashboard />;
  if (profile.role === 'coordinator') return <CoordinatorDashboard />;
  return <StudentDashboard />;
}

export default function App(): React.JSX.Element {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
