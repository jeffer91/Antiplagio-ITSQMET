import { type FormEvent, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ITSQMET_LOGO } from '../assets/itsqmetLogo';

interface LoginPageProps {
  adminAccess?: boolean;
}

export function LoginPage({ adminAccess = false }: LoginPageProps): React.JSX.Element {
  const { signIn, signInStudent } = useAuth();
  const [cedula, setCedula] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      if (!adminAccess) {
        const cleanCedula = cedula.replace(/\D/g, '');
        if (!/^\d{10}$/.test(cleanCedula)) throw new Error('Ingresa una cédula válida de 10 dígitos.');
        await signInStudent(cleanCedula);
      } else {
        if (!email.trim() || !password) throw new Error('Completa correo y contraseña.');
        await signIn(email.trim(), password);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible ingresar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="student-login-page">
      <form className="student-login-card" onSubmit={(event) => void submit(event)}>
        <img className="institutional-login-logo" src={ITSQMET_LOGO} alt="ITSQMET - Instituto Superior Tecnológico Quito Metropolitano" />

        <div className="student-login-heading">
          <span className="status-badge">{adminAccess ? 'Administración' : 'Estudiantes'}</span>
          <h1>{adminAccess ? 'Acceso administrativo' : 'Ingresa con tu cédula'}</h1>
          <p>{adminAccess ? 'Utiliza tu cuenta institucional de Administrador.' : 'Escribe los 10 dígitos de tu cédula.'}</p>
        </div>

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
            <label className="student-login-field">
              Correo electrónico
              <input autoFocus autoComplete="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="correo@itsqmet.edu.ec" required />
            </label>
            <label className="student-login-field">
              Contraseña
              <input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Contraseña" required />
            </label>
          </>
        )}

        {error && <div className="alert error-alert">{error}</div>}

        <button className="primary-button" disabled={busy} type="submit">{busy ? 'Ingresando…' : 'Ingresar'}</button>

        {adminAccess ? (
          <button className="text-button student-access-switch" type="button" onClick={() => { window.location.hash = ''; setError(null); }}>
            Volver al acceso de estudiantes
          </button>
        ) : (
          <button className="text-button student-access-switch" type="button" onClick={() => { window.location.hash = '/admin'; setError(null); }}>
            Acceso administrativo
          </button>
        )}
      </form>
    </main>
  );
}
