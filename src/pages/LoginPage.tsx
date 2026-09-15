import { type FormEvent, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ITSQMET_LOGO } from '../assets/itsqmetLogo';
import { switchAccessSurface } from '../lib/supabase';
import type { AppRole } from '../types/auth';

interface LoginPageProps {
  adminAccess?: boolean;
  activeRole?: AppRole | null;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function LoginPage({ adminAccess = false, activeRole = null }: LoginPageProps): React.JSX.Element {
  const { signInStudent, signInAdminPin } = useAuth();
  const [cedula, setCedula] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const phases = adminAccess
    ? ['Validando credenciales administrativas', 'Comprobando permisos', 'Preparando el panel de Administración']
    : ['Validando cédula institucional', 'Consultando matrícula y período', 'Preparando tu sesión en PlagGuard'];

  useEffect(() => {
    if (!busy) {
      setPhaseIndex(0);
      return;
    }
    const timer = window.setInterval(() => {
      setPhaseIndex((current) => Math.min(current + 1, phases.length - 1));
    }, 520);
    return () => window.clearInterval(timer);
  }, [busy, phases.length]);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setPhaseIndex(0);
    setError(null);

    try {
      const cleanCedula = cedula.replace(/\D/g, '');
      const minimumTransition = wait(1450);

      if (!adminAccess) {
        if (!/^\d{10}$/.test(cleanCedula)) throw new Error('Ingresa una cédula válida de 10 dígitos.');
        await Promise.all([signInStudent(cleanCedula), minimumTransition]);
        return;
      }

      const cleanPin = pin.replace(/\D/g, '');
      if (!/^\d{10}$/.test(cleanCedula)) throw new Error('Ingresa una cédula válida de 10 dígitos.');
      if (!/^\d{4,6}$/.test(cleanPin)) throw new Error('Ingresa un PIN de 4 a 6 dígitos.');
      await Promise.all([signInAdminPin(cleanCedula, cleanPin), minimumTransition]);
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

        {activeRole && (
          <div className="admin-session-note">
            Esta ruta utiliza una sesión independiente. Ingresa con las credenciales correspondientes.
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
            disabled={busy}
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
              disabled={busy}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="••••"
              required
            />
          </label>
        )}

        {error && <div className="alert error-alert">{error}</div>}

        <button className="primary-button" disabled={busy} type="submit">
          {busy ? 'Validando…' : 'Ingresar'}
        </button>

        {adminAccess ? (
          <button className="text-button student-access-switch secondary-link" type="button" disabled={busy} onClick={() => switchAccessSurface('student')}>
            Ir al acceso de estudiantes
          </button>
        ) : (
          <button className="text-button student-access-switch" type="button" disabled={busy} onClick={() => switchAccessSurface('admin')}>
            Acceso administrativo
          </button>
        )}
      </form>

      {busy && (
        <div className="login-validation-backdrop" role="status" aria-live="polite">
          <div className="login-validation-card">
            <div className="login-validation-spinner" aria-hidden="true" />
            <strong>{phases[phaseIndex]}</strong>
            <span>No cierres esta ventana.</span>
            <div className="login-validation-steps" aria-hidden="true">
              {phases.map((phase, index) => (
                <i key={phase} className={index < phaseIndex ? 'done' : index === phaseIndex ? 'active' : ''} />
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
