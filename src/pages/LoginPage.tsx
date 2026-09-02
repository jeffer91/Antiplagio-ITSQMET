import { type FormEvent, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ITSQMET_LOGO } from '../assets/itsqmetLogo';
import type { AppRole } from '../types/auth';

interface LoginPageProps {
  adminAccess?: boolean;
  activeRole?: AppRole | null;
}

export function LoginPage({ adminAccess = false, activeRole = null }: LoginPageProps): React.JSX.Element {
  const { signInStudent, signInAdminPin } = useAuth();
  const [cedula, setCedula] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const cleanCedula = cedula.replace(/\D/g, '');

      if (!adminAccess) {
        if (!/^\d{10}$/.test(cleanCedula)) throw new Error('Ingresa una cédula válida de 10 dígitos.');
        await signInStudent(cleanCedula);
        return;
      }

      const cleanPin = pin.replace(/\D/g, '');
      if (!/^\d{10}$/.test(cleanCedula)) throw new Error('Ingresa una cédula válida de 10 dígitos.');
      if (!/^\d{4,6}$/.test(cleanPin)) throw new Error('Ingresa un PIN de 4 a 6 dígitos.');

      await signInAdminPin(cleanCedula, cleanPin);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible ingresar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="student-login-page">
      <form className="student-login-card admin-login-card" onSubmit={(event) => void submit(event)}>
        <img
          className="institutional-login-logo"
          src={ITSQMET_LOGO}
          alt="ITSQMET - Instituto Superior Tecnológico Quito Metropolitano"
        />

        <div className="student-login-heading">
          <span className="status-badge">{adminAccess ? 'Administración' : 'Estudiantes'}</span>
          <h1>{adminAccess ? 'Acceso administrativo' : 'Ingresa con tu cédula'}</h1>
          <p>{adminAccess ? 'Ingresa con tu cédula y PIN.' : 'Escribe los 10 dígitos de tu cédula.'}</p>
        </div>

        {adminAccess && activeRole && activeRole !== 'admin' && (
          <div className="admin-session-note">
            Hay una sesión de {activeRole === 'student' ? 'estudiante' : 'coordinador'} abierta. Al ingresar aquí se cambiará a la sesión administrativa.
          </div>
        )}

        <label className="student-login-field">
          Cédula
          <input
            autoFocus
            autoComplete="username"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={10}
            value={cedula}
            onChange={(event) => setCedula(event.target.value.replace(/\D/g, '').slice(0, 10))}
            placeholder="0000000000"
            required
          />
        </label>

        {adminAccess && (
          <label className="student-login-field">
            PIN
            <input
              autoComplete="current-password"
              inputMode="numeric"
              pattern="[0-9]*"
              type="password"
              maxLength={6}
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="••••"
              required
            />
          </label>
        )}

        {error && <div className="alert error-alert">{error}</div>}

        <button className="primary-button" disabled={busy} type="submit">
          {busy ? 'Ingresando…' : 'Ingresar'}
        </button>

        {adminAccess ? (
          <button
            className="text-button student-access-switch secondary-link"
            type="button"
            onClick={() => {
              window.location.hash = '/student';
              setError(null);
            }}
          >
            Volver al acceso de estudiantes
          </button>
        ) : (
          <button
            className="text-button student-access-switch"
            type="button"
            onClick={() => {
              window.location.hash = '/admin';
              setError(null);
            }}
          >
            Acceso administrativo
          </button>
        )}
      </form>
    </main>
  );
}
