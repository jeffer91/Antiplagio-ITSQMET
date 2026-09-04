import { useCallback, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { useAuth } from '../auth/AuthContext';
import { loadNotifications, resolveNotification } from '../lib/plagGuard';
import { ITSQMET_LOGO } from '../assets/itsqmetLogo';
import type { AppRole } from '../types/auth';
import type { AppNotification } from '../types/plagGuard';

interface AppShellProps extends PropsWithChildren {
  role: AppRole;
  suppressNotificationKinds?: string[];
}

const roleLabels: Record<AppRole, string> = {
  student: 'Estudiante',
  coordinator: 'Coordinador',
  admin: 'Administrador',
};

function canAcknowledge(notification: AppNotification): boolean {
  return notification.kind !== 'supplementary_required';
}

export function AppShell({ role, children, suppressNotificationKinds = [] }: AppShellProps): React.JSX.Element {
  const { profile, signOut } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationBusy, setNotificationBusy] = useState<string | null>(null);

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
      if (active) await refreshNotifications();
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

  const acknowledge = async (notification: AppNotification): Promise<void> => {
    if (!canAcknowledge(notification)) return;
    setNotificationBusy(notification.id);
    try {
      await resolveNotification(notification.id);
      await refreshNotifications();
    } finally {
      setNotificationBusy(null);
    }
  };

  const suppressedKinds = useMemo(() => new Set(suppressNotificationKinds), [suppressNotificationKinds]);
  const visibleNotifications = useMemo(
    () => notifications.filter((notification) => !suppressedKinds.has(notification.kind)),
    [notifications, suppressedKinds],
  );

  const important = visibleNotifications[0] ?? null;
  const secondaryUserText = role === 'student' ? (profile?.cedula || 'Estudiante') : profile?.email;

  return (
    <div className={`plagguard-layout role-${role}`}>
      <header className="plagguard-topbar">
        <div className="institutional-topbar-brand">
          <img src={ITSQMET_LOGO} alt="ITSQMET" />
          <div><strong>PlagGuard</strong><span>Integridad académica</span></div>
        </div>

        <div className="topbar-actions">
          <div className="notification-wrap">
            <button
              className={`notification-bell ${visibleNotifications.length > 0 ? 'has-alerts' : ''}`}
              type="button"
              title={`${visibleNotifications.length} alertas pendientes`}
              aria-label={`${visibleNotifications.length} alertas pendientes`}
              aria-expanded={notificationsOpen}
              onClick={() => setNotificationsOpen((current) => !current)}
            >
              <span aria-hidden="true">●</span>
              {visibleNotifications.length > 0 && <strong>{visibleNotifications.length}</strong>}
            </button>

            {notificationsOpen && (
              <div className="notification-popover" role="status">
                <div className="notification-popover-heading">
                  <strong>Alertas de PlagGuard</strong>
                  <span>{visibleNotifications.length} pendientes</span>
                </div>

                {visibleNotifications.length === 0 ? (
                  <p className="notification-empty">No tienes alertas pendientes.</p>
                ) : (
                  <div className="notification-list">
                    {visibleNotifications.map((notification) => (
                      <article key={notification.id} className="notification-item">
                        <strong>{notification.title}</strong>
                        <span>{notification.message}</span>
                        <small>{new Date(notification.created_at).toLocaleString('es-EC')}</small>
                        {canAcknowledge(notification) ? (
                          <button
                            className="notification-action"
                            type="button"
                            disabled={notificationBusy === notification.id}
                            onClick={() => void acknowledge(notification)}
                          >
                            {notificationBusy === notification.id ? 'Guardando…' : 'Marcar como visto'}
                          </button>
                        ) : (
                          <small>Esta alerta desaparecerá cuando el Administrador habilite el Supletorio.</small>
                        )}
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
            <div><strong>{profile?.full_name || 'Usuario PlagGuard'}</strong><span>{secondaryUserText}</span></div>
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
