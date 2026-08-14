import type { PropsWithChildren } from 'react';
import { useAuth } from '../auth/AuthContext';
import type { AppRole } from '../types/auth';

interface AppShellProps extends PropsWithChildren {
  role: AppRole;
}

const coordinatorItems = ['Resumen', 'Entregas', 'Estudiantes', 'Periodos', 'Repositorio', 'Configuración'];
const studentItems = ['Inicio', 'Mis entregas', 'Mis informes', 'Perfil'];

export function AppShell({ role, children }: AppShellProps): React.JSX.Element {
  const { profile, signOut } = useAuth();
  const items = role === 'coordinator' ? coordinatorItems : studentItems;

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="brand brand-sidebar">
          <div className="brand-mark">SI</div>
          <div>
            <strong>SIAI</strong>
            <span>ITSQMET</span>
          </div>
        </div>

        <div className="role-pill">
          {role === 'coordinator' ? 'Coordinador' : 'Estudiante'}
        </div>

        <nav className="nav-list" aria-label="Navegación principal">
          {items.map((item, index) => (
            <button className={index === 0 ? 'nav-item active' : 'nav-item'} key={item} type="button">
              <span className="nav-dot" />
              {item}
              {index > 0 && <span className="soon">Próx.</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-user">
          <div className="avatar">{profile?.full_name?.charAt(0).toUpperCase() || 'U'}</div>
          <div className="sidebar-user-copy">
            <strong>{profile?.full_name || 'Usuario SIAI'}</strong>
            <span>{profile?.email}</span>
          </div>
        </div>
        <button className="logout-button" type="button" onClick={() => void signOut()}>
          Cerrar sesión
        </button>
      </aside>

      <main className="main-content">{children}</main>
    </div>
  );
}
