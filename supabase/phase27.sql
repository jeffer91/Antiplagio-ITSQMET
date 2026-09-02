-- PlagGuard · ITSQMET · Fase 27
-- Evita cast de cadena vacía a UUID en is_coordinator().
-- PostgreSQL no garantiza el orden de evaluación de expresiones AND,
-- por lo que el cast anterior podía ejecutarse aun con validación previa.

create or replace function public.is_coordinator()
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_target_text text;
  v_target uuid;
begin
  if exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('coordinator'::public.app_role, 'admin'::public.app_role)
  ) then
    return true;
  end if;

  if coalesce(current_setting('plagguard.allow_analysis', true), '') <> 'on' then
    return false;
  end if;

  v_target_text := nullif(current_setting('plagguard.target_version', true), '');

  if v_target_text is null
     or v_target_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return false;
  end if;

  v_target := v_target_text::uuid;

  return exists (
    select 1
    from public.document_versions dv
    join public.documents d on d.id = dv.document_id
    where dv.id = v_target
      and d.owner_id = auth.uid()
  );
end;
$function$;

revoke all on function public.is_coordinator() from public;
grant execute on function public.is_coordinator() to authenticated, service_role;
