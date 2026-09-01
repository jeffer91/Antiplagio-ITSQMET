import { type FormEvent, useState } from 'react';
import { useAuth } from '../auth/AuthContext';

export function LoginPage(): React.JSX.Element {
  const { signIn, signInStudent } = useAuth();
  const [mode, setMode] = useState<'student' | 'staff'>('student');
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
      if (mode === 'student') {
        const cleanCedula = cedula.replace(/\D/g, '');
        if (!/^\d{10}$/.test(cleanCedula)) {
          throw new Error('Ingresa una cédula válida de 10 dígitos.');
        }
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
        <div className="brand student-login-brand">
          <div className="brand-mark">PG</div>
          <div>
            <strong>PlagGuard</strong>
            <span>ITSQMET</span>
          </div>
        </div>

        <div className="student-login-heading">
          <span className="status-badge">{mode === 'student' ? 'Estudiantes' : 'Acceso institucional'}</span>
          <h1>{mode === 'student' ? 'Ingresa con tu cédula' : 'Acceso institucional'}</h1>
          <p>{mode === 'student' ? 'Escribe únicamente tu número de cédula.' : 'Coordinadores y administradores.'}</p>
        </div>

        {mode === 'student' ? (
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
              placeholder="Ej. 1712345678"
              required
            />
          </label>
        ) : (
          <>
            <label className="student-login-field">
              Correo electrónico
              <input
                autoComplete="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="correo@institucion.edu.ec"
                required
              />
            </label>
            <label className="student-login-field">
              Contraseña
              <input
                autoComplete="current-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Contraseña"
                required
              />
            </label>
          </>
        )}

        {error && <div className="alert error-alert">{error}</div>}

        <button className="primary-button" disabled={busy} type="submit">
          {busy ? 'Ingresando…' : 'Ingresar'}
        </button>

        <button
          className="text-button student-access-switch"
          type="button"
          onClick={() => {
            setMode((current) => (current === 'student' ? 'staff' : 'student'));
            setError(null);
          }}
        >
          {mode === 'student' ? 'Acceso institucional' : 'Volver a ingreso de estudiantes'}
        </button>
      </form>
    </main>
  );
}
