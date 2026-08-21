import { useCallback, useEffect, useState, type PropsWithChildren } from 'react';
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
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  const refreshNotifications = useCallback(async (): Promise<void> => {
    try {
      setNotifications(await loadNotifications());
    } catch {
      setNotifications([]);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = async (): Promise<void> => {
      if (!active) return;
      await refreshNotifications();
    };

    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    const onFocus = (): void => { void refresh(); };
    const onChanged = (): void => { void refresh(); };
    window.addEventListener('focus', onFocus);
    window.addEventListener('plagguard:notifications-changed', onChanged);

    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('plagguard:notifications-changed', onChanged);
    };
  }, [refreshNotifications, role]);

  const important = notifications[0] ?? null;

  return (
    <div className={`plagguard-layout role-${role}`}>
      <header className="plagguard-topbar">
        <div className="brand plagguard-brand">
          <div className="brand-mark">PG</div>
          <div><strong>PlagGuard</strong><span>ITSQMET</span></div>
        </div>

        <div className="topbar-actions">
          <div className="notification-wrap">
            <button
              className={`notification-bell ${notifications.length > 0 ? 'has-alerts' : ''}`}
              type="button"
              title={`${notifications.length} alertas pendientes`}
              aria-label={`${notifications.length} alertas pendientes`}
              aria-expanded={notificationsOpen}
              onClick={() => setNotificationsOpen((current) => !current)}
            >
              <span aria-hidden="true">●</span>
              {notifications.length > 0 && <strong>{notifications.length}</strong>}
            </button>
            {notificationsOpen && (
              <div className="notification-popover" role="status">
                <div className="notification-popover-heading">
                  <strong>Alertas de PlagGuard</strong>
                  <span>{notifications.length} pendientes</span>
                </div>
                {notifications.length === 0 ? (
                  <p className="notification-empty">No tienes alertas pendientes.</p>
                ) : (
                  <div className="notification-list">
                    {notifications.map((notification) => (
                      <article key={notification.id} className="notification-item">
                        <strong>{notification.title}</strong>
                        <span>{notification.message}</span>
                        <small>{new Date(notification.created_at).toLocaleString('es-EC')}</small>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            )}
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
