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

interface SignUpResult {
  requiresEmailConfirmation: boolean;
}

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  profileError: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (fullName: string, email: string, password: string) => Promise<SignUpResult>;
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
        .select('id,email,full_name,role,created_at')
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
        setProfileError('La cuenta existe, pero todavía no tiene un perfil SIAI asociado.');
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
      setSession(nextSession);
      void loadProfile(nextSession);
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
      signUp: async (fullName, email, password) => {
        if (!supabase) throw new Error('Supabase no está configurado.');
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName.trim() },
          },
        });
        if (error) throw error;
        return { requiresEmailConfirmation: !data.session };
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
