-- SIAI / ITSQMET - Fase 1
-- Ejecutar una sola vez en Supabase SQL Editor.

create type public.app_role as enum ('student', 'coordinator');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role public.app_role not null default 'student',
  created_at timestamptz not null default now()
);

create index profiles_role_idx on public.profiles(role);
create unique index profiles_email_lower_idx on public.profiles(lower(email));

alter table public.profiles enable row level security;

-- SECURITY DEFINER evita recursión RLS al comprobar el rol.
create or replace function public.is_coordinator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'coordinator'
  );
$$;

revoke all on function public.is_coordinator() from public;
grant execute on function public.is_coordinator() to authenticated;

grant select on table public.profiles to authenticated;

create policy "profiles_select_own_or_coordinator"
on public.profiles
for select
to authenticated
using (id = auth.uid() or public.is_coordinator());

-- No se crean políticas INSERT/UPDATE/DELETE para el cliente.
-- Esto evita que un estudiante pueda modificar su rol desde Electron.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    'student'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

comment on table public.profiles is 'Perfiles SIAI. El rol se controla en base de datos, no en el cliente.';
comment on function public.is_coordinator() is 'Comprueba de forma segura si auth.uid() pertenece al coordinador.';

-- Para asignar al único coordinador, ejecutar manualmente en SQL Editor:
-- update public.profiles set role = 'coordinator' where email = 'TU_CORREO';
