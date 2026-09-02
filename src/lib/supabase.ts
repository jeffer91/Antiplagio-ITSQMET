import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

export type AccessSurface = 'student' | 'admin';

function detectAccessSurface(): AccessSurface {
  if (typeof window !== 'undefined' && window.location.hash === '#/admin') return 'admin';
  return 'student';
}

export const authSurface: AccessSurface = detectAccessSurface();
export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabasePublishableKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: 'plagguard-' + authSurface + '-auth',
      },
    })
  : null;

export function switchAccessSurface(surface: AccessSurface): void {
  if (typeof window === 'undefined') return;
  const target = surface === 'admin' ? '#/admin' : '#/student';
  if (window.location.hash !== target) window.location.hash = target;
  window.location.reload();
}
