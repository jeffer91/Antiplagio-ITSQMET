import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ITSQMET_LOGO } from '../assets/itsqmetLogo';
import { switchAccessSurface } from '../lib/supabase';
import type { AppRole } from '../types/auth';

interface LoginPageProps {
  adminAccess?: boolean;
  coordinatorAccess?: boolean;
  activeRole?: AppRole | null;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function LoginPage({
  adminAccess = false,
  coordinatorAccess = false,
  activeRole = null,
}: LoginPageProps): React.JSX.Element {
  const { signIn, signInStudent, signInAdminPin } = useAuth();
  const [cedula, setCedula] = useState('');
  const [pin, setPin] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const accessKind = adminAccess ? 'admin' : coordinatorAccess ? 'coordinator' : 'student';
  const phases = useMemo(() => {
    if (accessKind === 'admin') return ['Validando credenciales administrativas', 'Comprobando permisos', 'Preparando Administración'];
    if (accessKind === 'coordinator') return ['Validando cuenta institucional', 'Comprobando rol de Coordinación', 'Preparando revisión e informes'];
    return ['Validando cédula y PIN', 'Consultando matrícula y período', 'Preparando tu sesión en PlagGuard'];
  }, [accessKind]);

  useEffect(() => {
    if (!busy) {
      setPhaseIndex(0);
      return;
    }
    const timer = window.setInterval(() => {
      setPhaseIndex((current) => Math.min(current + 1, phases.length - 1));
    }, 520);
    return () => window.clearInterval(timer);
  }, [busy, phases]);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setPhaseIndex(0);
    setError(null);

    try {
      const minimumTransition = wait(1200);

      if (accessKind === 'coordinator') {
        const cleanEmail = email.trim().toLowerCase();
        if (!cleanEmail || !password) throw new Error('Ingresa tu correo institucional y contraseña.');
        await Promise.all([signIn(cleanEmail, password), minimumTransition]);
        return;
      }

      const cleanCedula = cedula.replace(/\D/g, '');
      const cleanPin = pin.replace(/\D/g, '');
      if (!/^\d{10}$/.test(cleanCedula)) throw new Error('Ingresa una cédula válida de 10 dígitos.');

      if (accessKind === 'student') {
        if (!/^\d{6}$/.test(cleanPin)) throw new Error('Ingresa tu PIN de 6 dígitos.');
        await Promise.all([signInStudent(cleanCedula, cleanPin), minimumTransition]);
        return;
      }

      if (!/^\d{4,6}$/.test(cleanPin)) throw new Error('Ingresa un PIN de 4 a 6 dígitos.');
      await Promise.all([signInAdminPin(cleanCedula, cleanPin), minimumTransition]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible ingresar.');
    } finally {
      setBusy(false);
    }
  };

  const badge = accessKind === 'admin' ? 'Administración' : accessKind === 'coordinator' ? 'Coordinación' : 'Estudiantes';
  const title = accessKind === 'admin'
    ? 'Acceso administrativo'
    : accessKind === 'coordinator'
      ? 'Acceso de coordinador'
      : 'Ingresa con tu cédula y PIN';
  const subtitle = accessKind === 'admin'
    ? 'Ingresa con tu cédula y PIN administrativo.'
    : accessKind === 'coordinator'
      ? 'Usa tu correo institucional y contraseña.'
      : 'Tu PIN de 6 dígitos es emitido por Administración.';

  return (
    <main className="student-login-page">
      <form className="student-login-card admin-login-card" onSubmit={(event) => void submit(event)}>
        <img
          className="institutional-login-logo"
          src={ITSQMET_LOGO}
          alt="ITSQMET - Instituto Superior Tecnológico Quito Metropolitano"
        />

        <div className="student-login-heading">
          <span className="status-badge">{badge}</span>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>

        {activeRole && (
          <div className="admin-session-note">
            Esta ruta utiliza una sesión independiente. Ingresa con las credenciales correspondientes.
          </div>
        )}

        {accessKind === 'coordinator' ? (
          <>
            <label className="student-login-field">
              Correo institucional
              <input
                autoFocus
                autoComplete="username"
                type="email"
                value={email}
                disabled={busy}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="usuario@institucion.edu.ec"
                required
              />
            </label>
            <label className="student-login-field">
              Contraseña
              <input
                autoComplete="current-password"
                type="password"
                value={password}
                disabled={busy}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                required
              />
            </label>
          </>
        ) : (
          <>
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
            <label className="student-login-field">
              PIN
              <input
                autoComplete="current-password"
                inputMode="numeric"
                pattern="[0-9]*"
                type="password"
                maxLength={accessKind === 'student' ? 6 : 6}
                value={pin}
                disabled={busy}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder={accessKind === 'student' ? '••••••' : '••••'}
                required
              />
            </label>
          </>
        )}

        {error && <div className="alert error-alert">{error}</div>}

        <button className="primary-button" disabled={busy} type="submit">
          {busy ? 'Validando…' : 'Ingresar'}
        </button>

        <div className="student-access-links">
          {accessKind !== 'student' && (
            <button className="text-button student-access-switch secondary-link" type="button" disabled={busy} onClick={() => switchAccessSurface('student')}>
              Ir al acceso de estudiantes
            </button>
          )}
          {accessKind !== 'coordinator' && (
            <button className="text-button student-access-switch secondary-link" type="button" disabled={busy} onClick={() => switchAccessSurface('coordinator')}>
              Acceso de coordinador
            </button>
          )}
          {accessKind !== 'admin' && (
            <button className="text-button student-access-switch" type="button" disabled={busy} onClick={() => switchAccessSurface('admin')}>
              Acceso administrativo
            </button>
          )}
        </div>
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
