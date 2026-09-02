import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import type { Profile } from '../types/auth';

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  profileError: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signInStudent: (cedula: string) => Promise<void>;
  signInAdminPin: (cedula: string, pin: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: PropsWithChildren): React.JSX.Element {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);

  // La suscripción de Auth SOLO sincroniza la sesión.
  // No se hacen consultas a Supabase dentro de onAuthStateChange porque el
  // cliente mantiene un lock interno durante ese callback y una consulta
  // adicional puede bloquear el login varios segundos.
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setLoading(false);
      return;
    }

    const client = supabase;
    let active = true;

    const initialize = async (): Promise<void> => {
      const { data, error } = await client.auth.getSession();
      if (!active) return;

      if (error) {
        setSession(null);
        setProfile(null);
        setProfileError(error.message);
        setLoading(false);
        return;
      }

      setSession(data.session);
      if (!data.session) {
        setProfile(null);
        setProfileError(null);
        setLoading(false);
      }
    };

    void initialize();

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;

      // Mantén el perfil actual durante TOKEN_REFRESHED y otros eventos de la
      // misma sesión. Antes se borraba el perfil y se activaba el loading en
      // cada evento de Auth; como el efecto del perfil depende del user.id,
      // un refresh del token del mismo usuario podía dejar la app cargando
      // indefinidamente y cerrar visualmente cualquier modal abierto.
      setSession(nextSession);

      if (!nextSession) {
        setProfile(null);
        setProfileError(null);
        setLoading(false);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  // El perfil se carga fuera de onAuthStateChange para evitar el lock de Auth.
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;

    if (!session) {
      setProfile(null);
      setProfileError(null);
      setLoading(false);
      return;
    }

    const client = supabase;
    let active = true;
    setLoading(true);

    const loadProfile = async (): Promise<void> => {
      const { data, error } = await client
        .from('profiles')
        .select('id,email,full_name,role,cedula,created_at')
        .eq('id', session.user.id)
        .maybeSingle();

      if (!active) return;

      if (error) {
        setProfile(null);
        setProfileError(`No fue posible cargar el perfil: ${error.message}`);
        return;
      }

      if (!data) {
        setProfile(null);
        setProfileError('La cuenta existe, pero todavía no tiene un perfil PlagGuard asociado.');
        return;
      }

      setProfile(data as Profile);
      setProfileError(null);
    };

    const safetyTimer = window.setTimeout(() => {
      if (!active) return;
      setProfileError('La sesión está activa, pero la carga del perfil tardó demasiado. Recarga la página e inténtalo nuevamente.');
      setLoading(false);
    }, 12000);

    const timer = window.setTimeout(() => {
      void loadProfile().finally(() => {
        window.clearTimeout(safetyTimer);
        if (active) setLoading(false);
      });
    }, 0);

    return () => {
      active = false;
      window.clearTimeout(timer);
      window.clearTimeout(safetyTimer);
    };
  }, [session?.user.id]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      loading,
      profileError,
      signIn: async (email, password) => {
        if (!supabase) throw new Error('Supabase no está configurado.');
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      },
      signInStudent: async (cedula) => {
        if (!supabase) throw new Error('Supabase no está configurado.');

        const cleanCedula = cedula.replace(/\D/g, '');
        if (!/^\d{10}$/.test(cleanCedula)) {
          throw new Error('Ingresa una cédula válida de 10 dígitos.');
        }

        const { data, error } = await supabase.functions.invoke('student-cedula-login', {
          body: { cedula: cleanCedula },
        });

        if (error) {
          throw new Error((data as { error?: string } | null)?.error || 'La cédula no está habilitada para ingresar.');
        }

        const tokenHash = String((data as { token_hash?: string } | null)?.token_hash ?? '');
        if (!tokenHash) throw new Error('No fue posible iniciar la sesión.');

        const { data: verified, error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: 'magiclink',
        });
        if (verifyError) throw verifyError;

        // Refuerzo explícito: no dependemos únicamente del evento de Auth.
        if (verified.session) {
          setSession(verified.session);
          setLoading(true);
        }
      },
      signInAdminPin: async (cedula, pin) => {
        if (!supabase) throw new Error('Supabase no está configurado.');

        const cleanCedula = cedula.replace(/\D/g, '');
        const cleanPin = pin.replace(/\D/g, '');

        if (!/^\d{10}$/.test(cleanCedula)) {
          throw new Error('Ingresa una cédula válida de 10 dígitos.');
        }
        if (!/^\d{4,6}$/.test(cleanPin)) {
          throw new Error('Ingresa un PIN válido.');
        }

        const { data, error } = await supabase.functions.invoke('admin-pin-login', {
          body: { cedula: cleanCedula, pin: cleanPin },
        });

        if (error) {
          throw new Error((data as { error?: string } | null)?.error || 'Cédula o PIN incorrectos.');
        }

        const tokenHash = String((data as { token_hash?: string } | null)?.token_hash ?? '');
        if (!tokenHash) throw new Error('No fue posible iniciar la sesión administrativa.');

        const { data: verified, error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: 'magiclink',
        });
        if (verifyError) throw verifyError;

        if (verified.session) {
          setSession(verified.session);
          setLoading(true);
        }
      },
      signOut: async () => {
        if (!supabase) return;
        const { error } = await supabase.auth.signOut({ scope: 'local' });
        if (error) throw error;
        setSession(null);
        setProfile(null);
        setProfileError(null);
        setLoading(false);
      },
    }),
    [loading, profile, profileError, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe utilizarse dentro de AuthProvider.');
  }
  return context;
}
