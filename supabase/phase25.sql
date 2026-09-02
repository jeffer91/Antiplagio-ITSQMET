-- PlagGuard · ITSQMET · Fase 25
-- Permite al estudiante leer únicamente su propio registro institucional.

grant select on table public.students to authenticated;

drop policy if exists students_select_self_or_staff on public.students;

create policy students_select_self_or_staff
on public.students
for select
to authenticated
using (
  identification = public.current_user_cedula()
  or public.is_coordinator()
);
