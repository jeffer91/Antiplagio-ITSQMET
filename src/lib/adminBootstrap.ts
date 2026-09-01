import { supabase } from './supabase';

export async function bootstrapFirstAdmin(input: {
  fullName: string;
  cedula: string;
  pin: string;
  code: string;
}): Promise<void> {
  if (!supabase) throw new Error('Supabase no está configurado.');

  const cleanCedula = input.cedula.replace(/\D/g, '');
  const cleanPin = input.pin.replace(/\D/g, '');

  const { data, error } = await supabase.functions.invoke('bootstrap-admin-pin', {
    body: {
      full_name: input.fullName.trim(),
      cedula: cleanCedula,
      pin: cleanPin,
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
