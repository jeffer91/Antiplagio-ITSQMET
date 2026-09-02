-- PlagGuard · ITSQMET · Fase 23
-- Firebase es la única fuente de asignación académica estudiante-periodo.

revoke execute on function public.admin_assign_student(uuid,uuid,text,text)
  from anon, authenticated;

grant execute on function public.admin_assign_student(uuid,uuid,text,text)
  to service_role;
