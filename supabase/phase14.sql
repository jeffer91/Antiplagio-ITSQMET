-- PlagGuard · ITSQMET - Fase 14
-- Ejecutar DESPUÉS de supabase/phase13.sql.
-- Cierre de producción:
--   * el informe oficial es exclusivo de Coordinador/Administrador;
--   * el informe queda ligado exactamente al intento Cumple que lo originó;
--   * se exige trazabilidad válida de los cuatro módulos;
--   * la huella del informe se calcula en el servidor.

create extension if not exists pgcrypto with schema extensions;

-- 1) El informe oficial nunca se publica al estudiante ------------------------
update public.integrity_report_snapshots
set released_to_student = false
where released_to_student;

drop policy if exists "integrity_reports_select_coordinator_or_released_owner"
  on public.integrity_report_snapshots;
drop policy if exists "integrity_reports_select_staff"
  on public.integrity_report_snapshots;

create policy "integrity_reports_select_staff"
on public.integrity_report_snapshots
for select to authenticated
using (public.is_coordinator());

create or replace function public.set_integrity_report_release(
  p_report_id uuid,
  p_released boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_coordinator() then
    raise exception 'Solo Coordinador o Administrador pueden administrar informes oficiales';
  end if;
  if coalesce(p_released, false) then
    raise exception 'El informe oficial de PlagGuard es de uso interno y no puede liberarse al estudiante';
  end if;

  update public.integrity_report_snapshots
  set released_to_student = false
  where id = p_report_id;
  if not found then raise exception 'El informe oficial no existe'; end if;
end;
$$;

revoke all on function public.set_integrity_report_release(uuid,boolean) from public;
grant execute on function public.set_integrity_report_release(uuid,boolean) to authenticated;

-- 2) Intentos: los cuatro análisis deben pertenecer a la misma versión --------
create or replace function public.record_analysis_attempt(
  p_target_version_id uuid,
  p_consolidated_similarity numeric,
  p_observation text default null,
  p_provenance jsonb default '{}'::jsonb
)
returns setof public.analysis_attempts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_version public.document_versions%rowtype;
  v_document public.documents%rowtype;
  v_period public.academic_periods%rowtype;
  v_process public.attempt_process;
  v_status public.attempt_status;
  v_attempt_number integer;
  v_ordinary_used integer := 0;
  v_supp_used integer := 0;
  v_row public.analysis_attempts%rowtype;
  v_staff record;
  v_internal_id text;
  v_external_id text;
  v_citation_id text;
  v_ai_id text;
begin
  if v_user is null then raise exception 'Sesión no válida'; end if;
  if p_consolidated_similarity is null or p_consolidated_similarity < 0 or p_consolidated_similarity > 100 then
    raise exception 'Porcentaje consolidado inválido';
  end if;
  if p_provenance is null or jsonb_typeof(p_provenance) <> 'object' then
    raise exception 'Trazabilidad del intento inválida';
  end if;

  v_internal_id := nullif(p_provenance->>'internal_analysis_id', '');
  v_external_id := nullif(p_provenance->>'external_analysis_id', '');
  v_citation_id := nullif(p_provenance->>'citation_analysis_id', '');
  v_ai_id := nullif(p_provenance->>'ai_analysis_id', '');
  if v_internal_id is null or v_external_id is null or v_citation_id is null or v_ai_id is null then
    raise exception 'El intento requiere trazabilidad de los cuatro módulos';
  end if;

  select * into v_version
  from public.document_versions
  where id = p_target_version_id;
  if not found then raise exception 'Versión no encontrada'; end if;
  if v_version.extraction_status <> 'ready'::public.extraction_status then
    raise exception 'La versión no tiene texto listo';
  end if;

  select * into v_document
  from public.documents
  where id = v_version.document_id
  for update;
  if not found or v_document.academic_period_id is null then
    raise exception 'El documento no tiene contexto académico';
  end if;
  if v_user <> v_document.owner_id and not public.is_coordinator() then
    raise exception 'No puedes registrar este intento';
  end if;

  select * into v_period
  from public.academic_periods
  where id = v_document.academic_period_id and active;
  if not found then raise exception 'Periodo académico no disponible'; end if;

  if exists(select 1 from public.analysis_attempts where target_version_id = p_target_version_id) then
    raise exception 'Esta versión ya fue utilizada en un intento';
  end if;
  if exists(
    select 1 from public.analysis_attempts
    where student_id = v_document.owner_id
      and period_id = v_period.id
      and status = 'complies'::public.attempt_status
  ) then
    raise exception 'El proceso ya está cerrado por Cumple';
  end if;

  if not exists(
    select 1 from public.similarity_analyses
    where id::text = v_internal_id and target_version_id = p_target_version_id
  ) then raise exception 'La trazabilidad del análisis institucional no corresponde a esta versión'; end if;
  if not exists(
    select 1 from public.similarity_adjustments
    where analysis_id::text = v_internal_id
  ) then raise exception 'Falta el ajuste institucional utilizado para el resultado'; end if;
  if not exists(
    select 1 from public.external_similarity_analyses
    where id::text = v_external_id and target_version_id = p_target_version_id
  ) then raise exception 'La trazabilidad del análisis externo no corresponde a esta versión'; end if;
  if not exists(
    select 1 from public.citation_integrity_analyses
    where id::text = v_citation_id and target_version_id = p_target_version_id
  ) then raise exception 'La trazabilidad de citas y APA no corresponde a esta versión'; end if;
  if not exists(
    select 1 from public.ai_writing_analyses
    where id::text = v_ai_id and target_version_id = p_target_version_id
  ) then raise exception 'La trazabilidad de escritura asistida no corresponde a esta versión'; end if;

  select count(*) into v_ordinary_used
  from public.analysis_attempts
  where student_id = v_document.owner_id
    and period_id = v_period.id
    and process = 'ordinary'::public.attempt_process;

  select count(*) into v_supp_used
  from public.analysis_attempts
  where student_id = v_document.owner_id
    and period_id = v_period.id
    and process = 'supplementary'::public.attempt_process;

  if v_ordinary_used < v_period.ordinary_attempts then
    if not v_period.ordinary_open then raise exception 'El proceso Ordinario está cerrado'; end if;
    v_process := 'ordinary'::public.attempt_process;
    v_attempt_number := v_ordinary_used + 1;
  else
    if not v_period.supplementary_open then
      raise exception 'Pasa a Supletorio. El Administrador debe abrir el Supletorio';
    end if;
    if v_supp_used >= v_period.supplementary_attempts then
      raise exception 'No quedan intentos de Supletorio';
    end if;
    v_process := 'supplementary'::public.attempt_process;
    v_attempt_number := v_supp_used + 1;
  end if;

  v_status := case
    when p_consolidated_similarity <= v_period.similarity_limit then 'complies'::public.attempt_status
    else 'does_not_comply'::public.attempt_status
  end;

  insert into public.analysis_attempts(
    student_id, period_id, target_document_id, target_version_id, process, attempt_number,
    consolidated_similarity, status, executed_by, observation, provenance
  ) values (
    v_document.owner_id, v_period.id, v_document.id, v_version.id, v_process, v_attempt_number,
    round(p_consolidated_similarity, 2), v_status, v_user,
    nullif(trim(coalesce(p_observation,'')),''), p_provenance
  ) returning * into v_row;

  if v_status = 'complies'::public.attempt_status then
    insert into public.institutional_repository(document_id, version_id, owner_id, period_id, active)
    values (v_document.id, v_version.id, v_document.owner_id, v_period.id, true)
    on conflict (document_id) do update
      set version_id = excluded.version_id,
          owner_id = excluded.owner_id,
          period_id = excluded.period_id,
          active = true,
          included_at = now(),
          excluded_at = null,
          excluded_by = null,
          exclusion_reason = null;

    insert into public.notifications(user_id, kind, title, message)
    values (v_document.owner_id, 'process_completed', 'Cumple', 'Tu trabajo cumple el límite institucional de similitud y el proceso quedó cerrado.');
  elsif v_process = 'ordinary'::public.attempt_process and v_attempt_number >= v_period.ordinary_attempts then
    insert into public.notifications(user_id, kind, title, message)
    values (v_document.owner_id, 'supplementary_required', 'Pasa a Supletorio', 'Agotaste los intentos Ordinarios. El Administrador debe abrir el Supletorio para habilitar tres intentos adicionales.');

    for v_staff in
      select id from public.profiles
      where role in ('coordinator'::public.app_role, 'admin'::public.app_role)
    loop
      insert into public.notifications(user_id, kind, title, message)
      values (v_staff.id, 'supplementary_required', 'Estudiante pasa a Supletorio', 'Un estudiante agotó los intentos Ordinarios sin cumplir el límite de similitud.');
    end loop;
  elsif v_process = 'supplementary'::public.attempt_process and v_attempt_number >= v_period.supplementary_attempts then
    insert into public.notifications(user_id, kind, title, message)
    values (v_document.owner_id, 'attempts_exhausted', 'Intentos agotados', 'Agotaste los intentos de Supletorio sin cumplir el límite institucional.');
  end if;

  return next v_row;
end;
$$;

revoke all on function public.record_analysis_attempt(uuid,numeric,text,jsonb) from public;
grant execute on function public.record_analysis_attempt(uuid,numeric,text,jsonb) to authenticated;

-- 3) Informe oficial: debe reproducir exactamente el intento Cumple ------------
create or replace function public.save_integrity_report_snapshot(
  p_target_version_id uuid,
  p_report_schema_version text,
  p_final_status text,
  p_final_observation text,
  p_snapshot jsonb,
  p_snapshot_sha256 text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := auth.uid();
  v_document_id uuid;
  v_status public.extraction_status;
  v_attempt public.analysis_attempts%rowtype;
  v_report_number integer;
  v_report_id uuid;
  v_server_hash text;
  v_snapshot_similarity numeric;
begin
  if v_user is null or not public.is_coordinator() then
    raise exception 'Solo Coordinador o Administrador pueden crear informes oficiales';
  end if;

  select dv.document_id, dv.extraction_status
  into v_document_id, v_status
  from public.document_versions dv
  where dv.id = p_target_version_id;
  if not found then raise exception 'La versión objetivo no existe'; end if;
  if v_status <> 'ready'::public.extraction_status then raise exception 'La versión objetivo no tiene texto listo'; end if;

  select * into v_attempt
  from public.analysis_attempts a
  where a.target_version_id = p_target_version_id
    and a.status = 'complies'::public.attempt_status
  order by a.created_at asc
  limit 1;
  if not found then raise exception 'El informe oficial solo puede generarse para la versión que obtuvo Cumple'; end if;

  if p_final_status <> 'approved' then
    raise exception 'El informe oficial de una versión Cumple debe registrarse como Aprobado';
  end if;
  if char_length(trim(coalesce(p_report_schema_version,''))) < 1
     or char_length(trim(p_report_schema_version)) > 50 then raise exception 'Versión de esquema inválida'; end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then raise exception 'La instantánea debe ser un objeto JSON'; end if;
  if char_length(coalesce(p_final_observation,'')) > 5000 then raise exception 'Observación demasiado extensa'; end if;

  if coalesce(p_snapshot#>>'{document,version_id}', '') <> p_target_version_id::text then
    raise exception 'La instantánea no corresponde a la versión aprobada';
  end if;
  if p_snapshot->'internal_similarity' is null
     or p_snapshot->'external_similarity' is null
     or p_snapshot->'citation_integrity' is null
     or p_snapshot->'ai_writing' is null then
    raise exception 'El informe oficial requiere los cuatro módulos completos';
  end if;

  if coalesce(p_snapshot#>>'{provenance,internal_analysis_id}', '') <> coalesce(v_attempt.provenance->>'internal_analysis_id','')
     or coalesce(p_snapshot#>>'{provenance,external_analysis_id}', '') <> coalesce(v_attempt.provenance->>'external_analysis_id','')
     or coalesce(p_snapshot#>>'{provenance,citation_analysis_id}', '') <> coalesce(v_attempt.provenance->>'citation_analysis_id','')
     or coalesce(p_snapshot#>>'{provenance,ai_analysis_id}', '') <> coalesce(v_attempt.provenance->>'ai_analysis_id','') then
    raise exception 'La evidencia del informe no coincide con la evidencia del intento Cumple';
  end if;

  begin
    v_snapshot_similarity := (p_snapshot#>>'{summary,consolidated_similarity_adjusted}')::numeric;
  exception when others then
    raise exception 'La similitud consolidada de la instantánea es inválida';
  end;
  if v_snapshot_similarity is null or abs(v_snapshot_similarity - v_attempt.consolidated_similarity) > 0.01 then
    raise exception 'La similitud del informe no coincide con el intento Cumple';
  end if;

  -- La huella oficial se calcula en PostgreSQL; no se confía en una huella enviada por el cliente.
  v_server_hash := encode(extensions.digest(convert_to(p_snapshot::text, 'UTF8'), 'sha256'), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(p_target_version_id::text, 0));
  select coalesce(max(r.report_number),0) + 1
  into v_report_number
  from public.integrity_report_snapshots r
  where r.target_version_id = p_target_version_id;

  insert into public.integrity_report_snapshots(
    target_version_id, target_document_id, created_by, report_number,
    report_schema_version, final_status, final_observation, snapshot,
    snapshot_sha256, released_to_student
  ) values (
    p_target_version_id, v_document_id, v_user, v_report_number,
    trim(p_report_schema_version), 'approved', nullif(trim(coalesce(p_final_observation,'')),''),
    p_snapshot, v_server_hash, false
  ) returning id into v_report_id;

  return v_report_id;
end;
$$;

revoke all on function public.save_integrity_report_snapshot(uuid,text,text,text,jsonb,text) from public;
grant execute on function public.save_integrity_report_snapshot(uuid,text,text,text,jsonb,text) to authenticated;

-- 4) Verificación de huella en servidor ---------------------------------------
create or replace function public.verify_integrity_report(p_report_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists(
    select 1
    from public.integrity_report_snapshots r
    where r.id = p_report_id
      and public.is_coordinator()
      and r.snapshot_sha256 = encode(extensions.digest(convert_to(r.snapshot::text, 'UTF8'), 'sha256'), 'hex')
  );
$$;

revoke all on function public.verify_integrity_report(uuid) from public;
grant execute on function public.verify_integrity_report(uuid) to authenticated;

comment on function public.record_analysis_attempt is 'Registra un intento PlagGuard únicamente con trazabilidad válida de los cuatro módulos de la misma versión.';
comment on function public.save_integrity_report_snapshot is 'Crea el informe oficial del intento Cumple, valida su evidencia y calcula la huella SHA-256 en el servidor.';
comment on function public.verify_integrity_report is 'Verifica en servidor la huella SHA-256 de un informe oficial; disponible solo para personal autorizado.';
