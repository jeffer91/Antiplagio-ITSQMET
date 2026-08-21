import { type FormEvent, useState } from 'react';
import { useAuth } from '../auth/AuthContext';

export function LoginPage(): React.JSX.Element {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);

    try {
      if (mode === 'login') {
        await signIn(email.trim(), password);
      } else {
        if (fullName.trim().length < 3) throw new Error('Ingresa tu nombre completo.');
        if (password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
        const result = await signUp(fullName, email.trim(), password);
        if (result.requiresEmailConfirmation) {
          setMessage('Cuenta creada. Revisa tu correo para confirmar el registro antes de ingresar.');
        } else {
          setMessage('Cuenta creada correctamente. El Administrador deberá asignarte periodo, carrera y modalidad.');
        }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Ocurrió un error inesperado.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-intro">
        <div className="brand brand-light">
          <div className="brand-mark">PG</div>
          <div>
            <strong>PlagGuard</strong>
            <span>ITSQMET</span>
          </div>
        </div>
        <div className="auth-copy">
          <span className="eyebrow">Integridad académica institucional</span>
          <h1>Revisa similitud, fuentes y correcciones en un solo lugar.</h1>
          <p>PlagGuard acompaña cada versión del trabajo, conserva la trazabilidad y aplica el límite institucional del 20%.</p>
        </div>
        <div className="phase-box">
          <strong>PlagGuard · ITSQMET</strong>
          <span>Repositorio institucional · Fuentes académicas · Web · Citas · APA 7</span>
        </div>
      </section>

      <section className="auth-panel">
        <form className="auth-card" onSubmit={(event) => void submit(event)}>
          <div className="auth-card-heading">
            <span className="status-badge">Acceso seguro</span>
            <h2>{mode === 'login' ? 'Ingresar a PlagGuard' : 'Crear cuenta de estudiante'}</h2>
            <p>{mode === 'login' ? 'Utiliza tus credenciales para continuar.' : 'Toda cuenta creada desde esta pantalla recibe únicamente el rol Estudiante.'}</p>
          </div>

          {mode === 'register' && (
            <label>
              Nombre completo
              <input autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Nombres y apellidos" required />
            </label>
          )}

          <label>
            Correo electrónico
            <input autoComplete="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="correo@ejemplo.com" required />
          </label>

          <label>
            Contraseña
            <input autoComplete={mode === 'login' ? 'current-password' : 'new-password'} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mínimo 8 caracteres" required />
          </label>

          {error && <div className="alert error-alert">{error}</div>}
          {message && <div className="alert success-alert">{message}</div>}

          <button className="primary-button" disabled={busy} type="submit">{busy ? 'Procesando…' : mode === 'login' ? 'Ingresar' : 'Crear cuenta'}</button>

          <button className="text-button" type="button" onClick={() => {
            setMode((current) => (current === 'login' ? 'register' : 'login'));
            setError(null);
            setMessage(null);
          }}>
            {mode === 'login' ? '¿Eres estudiante nuevo? Crear cuenta' : 'Ya tengo una cuenta'}
          </button>
        </form>
      </section>
    </main>
  );
}
