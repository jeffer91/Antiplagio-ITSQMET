-- PlagGuard · ITSQMET - Fase 18
-- Lectura segura del registro institucional sincronizado del propio estudiante.

create or replace function public.current_user_cedula()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.cedula
  from public.profiles p
  where p.id = auth.uid()
  limit 1;
$$;

grant execute on function public.current_user_cedula() to authenticated;

alter table public.students enable row level security;

drop policy if exists students_select_self_or_staff on public.students;

create policy students_select_self_or_staff
on public.students
for select
to authenticated
using (
  identification = public.current_user_cedula()
  or public.is_coordinator()
);
