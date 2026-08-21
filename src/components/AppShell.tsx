import { useEffect, useState, type PropsWithChildren } from 'react';
import { useAuth } from '../auth/AuthContext';
import { loadNotifications } from '../lib/plagGuard';
import type { AppRole } from '../types/auth';
import type { AppNotification } from '../types/plagGuard';

interface AppShellProps extends PropsWithChildren {
  role: AppRole;
}

const roleLabels: Record<AppRole, string> = {
  student: 'Estudiante',
  coordinator: 'Coordinador',
  admin: 'Administrador',
};

export function AppShell({ role, children }: AppShellProps): React.JSX.Element {
  const { profile, signOut } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  useEffect(() => {
    let active = true;
    void loadNotifications()
      .then((items) => active && setNotifications(items))
      .catch(() => active && setNotifications([]));
    return () => { active = false; };
  }, [role]);

  const important = notifications[0] ?? null;

  return (
    <div className={`plagguard-layout role-${role}`}>
      <header className="plagguard-topbar">
        <div className="brand plagguard-brand">
          <div className="brand-mark">PG</div>
          <div><strong>PlagGuard</strong><span>ITSQMET</span></div>
        </div>

        <div className="topbar-actions">
          <div className="notification-bell" title={`${notifications.length} alertas pendientes`} aria-label={`${notifications.length} alertas pendientes`}>
            <span aria-hidden="true">●</span>
            {notifications.length > 0 && <strong>{notifications.length}</strong>}
          </div>
          <div className="role-pill">{roleLabels[role]}</div>
          <div className="topbar-user">
            <div className="avatar">{profile?.full_name?.charAt(0).toUpperCase() || 'U'}</div>
            <div><strong>{profile?.full_name || 'Usuario PlagGuard'}</strong><span>{profile?.email}</span></div>
          </div>
          <button className="logout-button" type="button" onClick={() => void signOut()}>Cerrar sesión</button>
        </div>
      </header>

      <main className="plagguard-main">
        {important && (
          <div className={`persistent-alert ${important.kind}`}>
            <strong>{important.title}</strong>
            <span>{important.message}</span>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
