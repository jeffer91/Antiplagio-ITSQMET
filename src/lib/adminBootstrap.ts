import { supabase } from './supabase';

export async function bootstrapFirstAdmin(input: {
  fullName: string;
  email: string;
  password: string;
  code: string;
}): Promise<void> {
  if (!supabase) throw new Error('Supabase no está configurado.');

  const { data, error } = await supabase.functions.invoke('bootstrap-admin', {
    body: {
      full_name: input.fullName.trim(),
      email: input.email.trim(),
      password: input.password,
      code: input.code.trim(),
    },
  });

  if (error) {
    const message = (data as { error?: string } | null)?.error;
    throw new Error(message || 'No fue posible crear el administrador inicial.');
  }

  if (!(data as { ok?: boolean } | null)?.ok) {
    throw new Error((data as { error?: string } | null)?.error || 'No fue posible crear el administrador inicial.');
  }
}
