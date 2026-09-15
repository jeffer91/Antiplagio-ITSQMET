import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { StudentArticleReviewDock } from './components/StudentArticleReviewDock';
import { authSurface, isSupabaseConfigured, type AccessSurface } from './lib/supabase';
import { AdminDashboard } from './pages/AdminDashboard';
import { CoordinatorDashboard } from './pages/CoordinatorDashboard';
import { LoginPage } from './pages/LoginPage';
import { SetupPage } from './pages/SetupPage';
import { StudentDashboardV2 } from './pages/StudentDashboardV2';

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
  const [hash, setHash] = useState(() => window.location.hash || '#/student');

  useEffect(() => {
    const onHashChange = (): void => setHash(window.location.hash || '#/student');
    window.addEventListener('hashchange', onHashChange);
    if (!window.location.hash) window.location.hash = '/student';
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return hash;
}

function routeSurface(hash: string): AccessSurface | null {
  if (hash === '#/admin') return 'admin';
  if (hash === '#/coordinator') return 'coordinator';
  if (hash === '#/student') return 'student';
  return null;
}

function AppContent(): React.JSX.Element {
  const { loading, session, profile } = useAuth();
  const hash = useHashPath();
  const surface = routeSurface(hash);

  useEffect(() => {
    if (surface && surface !== authSurface) window.location.reload();
  }, [surface]);

  if (!isSupabaseConfigured) return <SetupPage />;
  if (loading) return <LoadingScreen />;

  if (surface === 'admin') {
    if (!session) return <LoginPage adminAccess />;
    if (!profile) return <ProfileProblem />;
    if (profile.role === 'admin') return <AdminDashboard />;
    return <LoginPage adminAccess activeRole={profile.role} />;
  }

  if (surface === 'coordinator') {
    if (!session) return <LoginPage coordinatorAccess />;
    if (!profile) return <ProfileProblem />;
    if (profile.role === 'coordinator') return <CoordinatorDashboard />;
    return <LoginPage coordinatorAccess activeRole={profile.role} />;
  }

  if (surface === 'student') {
    if (!session) return <LoginPage />;
    if (!profile) return <ProfileProblem />;
    if (profile.role === 'student') {
      return (
        <>
          <StudentDashboardV2 />
          <StudentArticleReviewDock />
        </>
      );
    }
    return <LoginPage activeRole={profile.role} />;
  }

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
