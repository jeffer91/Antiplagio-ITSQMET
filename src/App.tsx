import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { isSupabaseConfigured } from './lib/supabase';
import { AdminDashboard } from './pages/AdminDashboard';
import { LoginPage } from './pages/LoginPage';
import { SetupPage } from './pages/SetupPage';
import { StudentDashboard } from './pages/StudentDashboard';

function LoadingScreen({ message = 'Cargando PlagGuard…' }: { message?: string }): React.JSX.Element {
  return (
    <main className="center-page">
      <div className="loader" aria-label="Cargando" />
      <p>{message}</p>
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
        <button className="primary-button compact" type="button" onClick={() => void signOut()}>
          Cerrar sesión
        </button>
      </section>
    </main>
  );
}

function useHashPath(): string {
  const [hash, setHash] = useState(() => window.location.hash);

  useEffect(() => {
    const onHashChange = (): void => setHash(window.location.hash || '#/student');
    window.addEventListener('hashchange', onHashChange);

    if (!window.location.hash) {
      window.location.hash = '/student';
    }

    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return hash || '#/student';
}

function AppContent(): React.JSX.Element {
  const { loading, session, profile, signOut } = useAuth();
  const hash = useHashPath();
  const [switchingAccess, setSwitchingAccess] = useState(false);

  const adminRoute = hash === '#/admin';
  const studentRoute = hash === '#/student';

  useEffect(() => {
    if (loading || !session || !profile) {
      setSwitchingAccess(false);
      return;
    }

    const incompatibleSession =
      (adminRoute && profile.role !== 'admin')
      || (studentRoute && profile.role !== 'student');

    if (!incompatibleSession) {
      setSwitchingAccess(false);
      return;
    }

    let active = true;
    setSwitchingAccess(true);

    void signOut()
      .catch(() => undefined)
      .finally(() => {
        if (active) setSwitchingAccess(false);
      });

    return () => {
      active = false;
    };
  }, [adminRoute, loading, profile, session, signOut, studentRoute]);

  if (!isSupabaseConfigured) return <SetupPage />;
  if (loading || switchingAccess) {
    return <LoadingScreen message="Preparando el acceso correcto…" />;
  }

  if (adminRoute) {
    if (!session) return <LoginPage adminAccess />;
    if (!profile) return <ProfileProblem />;
    if (profile.role === 'admin') return <AdminDashboard />;
    return <LoadingScreen message="Cambiando al acceso administrativo…" />;
  }
  // La ruta estudiantil es totalmente independiente de Administración.
  // Si existía una sesión administrativa, se cierra antes de mostrar este acceso.
  if (studentRoute) {
    if (!session) return <LoginPage />;
    if (!profile) return <ProfileProblem />;
    if (profile.role === 'student') return <StudentDashboard />;
    return <LoadingScreen message="Cambiando al acceso de estudiantes…" />;
  }

  // Cualquier ruta desconocida vuelve al acceso de estudiantes.
  window.location.hash = '/student';
  return <LoadingScreen />;
}

export default function App(): React.JSX.Element {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
