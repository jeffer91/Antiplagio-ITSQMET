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

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setLoading(false);
      return;
    }

    const client = supabase;
    let active = true;

    const loadProfile = async (currentSession: Session | null): Promise<void> => {
      if (!currentSession) {
        if (active) {
          setProfile(null);
          setProfileError(null);
        }
        return;
      }

      const { data, error } = await client
        .from('profiles')
        .select('id,email,full_name,role,cedula,created_at')
        .eq('id', currentSession.user.id)
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

    const initialize = async (): Promise<void> => {
      const { data, error } = await client.auth.getSession();
      if (!active) return;

      if (error) {
        setProfileError(error.message);
        setLoading(false);
        return;
      }

      setSession(data.session);
      await loadProfile(data.session);
      if (active) setLoading(false);
    };

    void initialize();

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;

      // Evita mezclar el perfil de la sesión anterior con la nueva sesión.
      // Esto es crítico al cambiar entre /admin y /student en el mismo navegador.
      setLoading(true);
      setProfile(null);
      setProfileError(null);
      setSession(nextSession);

      void loadProfile(nextSession)
        .finally(() => {
          if (active) setLoading(false);
        });
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

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

        const { error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: 'magiclink',
        });
        if (verifyError) throw verifyError;
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

        const { error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: 'magiclink',
        });
        if (verifyError) throw verifyError;
      },
      signOut: async () => {
        if (!supabase) return;
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
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
