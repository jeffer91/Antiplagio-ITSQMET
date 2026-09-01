-- PlagGuard · ITSQMET - Fase 16
-- Acceso simplificado de estudiantes mediante cédula institucional.

alter table public.profiles
  add column if not exists cedula text;

create unique index if not exists profiles_cedula_unique_idx
  on public.profiles(cedula)
  where cedula is not null;

alter table public.profiles
  drop constraint if exists profiles_cedula_format_check;

alter table public.profiles
  add constraint profiles_cedula_format_check
  check (cedula is null or cedula ~ '^[0-9]{10}$');

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role, cedula)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    'student',
    nullif(regexp_replace(coalesce(new.raw_user_meta_data ->> 'cedula',''), '[^0-9]', '', 'g'), '')
  );
  return new;
end;
$$;
