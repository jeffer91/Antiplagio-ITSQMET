import { type FormEvent, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ITSQMET_LOGO } from '../assets/itsqmetLogo';
import { bootstrapFirstAdmin } from '../lib/adminBootstrap';
import type { AppRole } from '../types/auth';

interface LoginPageProps {
  adminAccess?: boolean;
  activeRole?: AppRole | null;
}

export function LoginPage({ adminAccess = false, activeRole = null }: LoginPageProps): React.JSX.Element {
  const { signIn, signInStudent } = useAuth();
  const [cedula, setCedula] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [activationCode, setActivationCode] = useState('');
  const [bootstrapMode, setBootstrapMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      if (!adminAccess) {
        const cleanCedula = cedula.replace(/\D/g, '');
        if (!/^\d{10}$/.test(cleanCedula)) throw new Error('Ingresa una cédula válida de 10 dígitos.');
        await signInStudent(cleanCedula);
        return;
      }

      if (!email.trim() || !password) throw new Error('Completa correo y contraseña.');

      if (bootstrapMode) {
        if (!fullName.trim()) throw new Error('Escribe el nombre del administrador.');
        if (!activationCode.trim()) throw new Error('Escribe el código de activación inicial.');

        await bootstrapFirstAdmin({
          fullName,
          email,
          password,
          code: activationCode,
        });
        setMessage('Administrador inicial creado. Ingresando al panel…');
      }

      await signIn(email.trim(), password);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible ingresar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="student-login-page">
      <form className="student-login-card admin-login-card" onSubmit={(event) => void submit(event)}>
        <img className="institutional-login-logo" src={ITSQMET_LOGO} alt="ITSQMET - Instituto Superior Tecnológico Quito Metropolitano" />

        <div className="student-login-heading">
          <span className="status-badge">{adminAccess ? 'Administración' : 'Estudiantes'}</span>
          <h1>{adminAccess ? (bootstrapMode ? 'Crear administrador inicial' : 'Acceso administrativo') : 'Ingresa con tu cédula'}</h1>
          <p>
            {adminAccess
              ? bootstrapMode
                ? 'Configuración disponible únicamente mientras no exista ningún Administrador.'
                : 'Ingresa con la cuenta institucional de Administración.'
              : 'Escribe los 10 dígitos de tu cédula.'}
          </p>
        </div>

        {adminAccess && activeRole && activeRole !== 'admin' && !bootstrapMode && (
          <div className="admin-session-note">
            Hay una sesión de {activeRole === 'student' ? 'estudiante' : 'coordinador'} abierta. Al ingresar aquí se cambiará a la sesión administrativa.
          </div>
        )}

        {!adminAccess ? (
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
              placeholder="0102596566"
              required
            />
          </label>
        ) : (
          <>
            {bootstrapMode && (
              <label className="student-login-field">
                Nombre del administrador
                <input autoFocus value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Nombre completo" required />
              </label>
            )}

            <label className="student-login-field">
              Correo electrónico
              <input
                autoFocus={!bootstrapMode}
                autoComplete="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="correo@itsqmet.edu.ec"
                required
              />
            </label>

            <label className="student-login-field">
              Contraseña
              <input
                autoComplete={bootstrapMode ? 'new-password' : 'current-password'}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={bootstrapMode ? 'Mínimo 8 caracteres' : 'Contraseña'}
                required
              />
            </label>

            {bootstrapMode && (
              <label className="student-login-field">
                Código de activación inicial
                <input value={activationCode} onChange={(event) => setActivationCode(event.target.value)} placeholder="Código de activación" required />
              </label>
            )}
          </>
        )}

        {error && <div className="alert error-alert">{error}</div>}
        {message && <div className="alert success-alert">{message}</div>}

        <button className="primary-button" disabled={busy} type="submit">
          {busy ? (bootstrapMode ? 'Configurando…' : 'Ingresando…') : bootstrapMode ? 'Crear administrador e ingresar' : 'Ingresar'}
        </button>

        {adminAccess ? (
          <>
            <button
              className="text-button student-access-switch"
              type="button"
              onClick={() => {
                setBootstrapMode((current) => !current);
                setError(null);
                setMessage(null);
              }}
            >
              {bootstrapMode ? 'Ya tengo una cuenta Administrador' : 'Primera configuración: crear Administrador'}
            </button>
            <button className="text-button student-access-switch secondary-link" type="button" onClick={() => { window.location.hash = ''; setError(null); }}>
              Volver al acceso de estudiantes
            </button>
          </>
        ) : (
          <button className="text-button student-access-switch" type="button" onClick={() => { window.location.hash = '/admin'; setError(null); }}>
            Acceso administrativo
          </button>
        )}
      </form>
    </main>
  );
}
