-- PlagGuard · ITSQMET · Fase 29
-- Revalidación segura de resultados históricos.
-- Motor vigente: plagguard-antiplagio-v2

alter table public.analysis_attempts
  add column if not exists engine_version text,
  add column if not exists counts_toward_limit boolean;

update public.analysis_attempts
set engine_version = coalesce(nullif(engine_version, ''), coalesce(nullif(provenance->>'engine_version',''), 'legacy-pre-antiplagio-v2')),
    counts_toward_limit = coalesce(counts_toward_limit, false);

alter table public.analysis_attempts
  alter column engine_version set default 'legacy-pre-antiplagio-v2',
  alter column engine_version set not null,
  alter column counts_toward_limit set default false,
  alter column counts_toward_limit set not null;

alter table public.analysis_attempts
  drop constraint if exists analysis_attempts_target_version_id_key;
alter table public.analysis_attempts
  drop constraint if exists analysis_attempts_student_id_period_id_process_attempt_numb_key;

drop index if exists public.analysis_attempts_counted_attempt_no_uidx;
create unique index analysis_attempts_counted_attempt_no_uidx
  on public.analysis_attempts(student_id, period_id, process, attempt_number)
  where counts_toward_limit;

create index if not exists analysis_attempts_current_engine_idx
  on public.analysis_attempts(student_id, period_id, created_at desc)
  where counts_toward_limit and engine_version = 'plagguard-antiplagio-v2';

-- Los intentos existentes se conservan, pero no consumen cupos del motor nuevo.
update public.analysis_attempts
set counts_toward_limit = false,
    engine_version = case
      when engine_version = 'plagguard-antiplagio-v2' then 'legacy-pre-antiplagio-v2'
      else engine_version
    end
where not (counts_toward_limit and engine_version = 'plagguard-antiplagio-v2');

-- Un Cumple histórico no debe contaminar el corpus usado para su propia revalidación.
update public.institutional_repository ir
set active = false,
    excluded_at = coalesce(ir.excluded_at, now()),
    exclusion_reason = coalesce(ir.exclusion_reason, 'Pendiente de revalidación con plagguard-antiplagio-v2')
where ir.active
  and exists (
    select 1 from public.analysis_attempts a
    where a.target_version_id = ir.version_id
      and not a.counts_toward_limit
  )
  and not exists (
    select 1 from public.analysis_attempts a
    where a.target_version_id = ir.version_id
      and a.counts_toward_limit
      and a.engine_version = 'plagguard-antiplagio-v2'
      and a.status = 'complies'::public.attempt_status
  );

-- Las alertas antiguas dejan de representar el proceso vigente.
update public.notifications n
set resolved = true,
    resolved_at = coalesce(n.resolved_at, now())
where not n.resolved
  and n.kind in ('process_completed','supplementary_required','attempts_exhausted')
  and exists (
    select 1 from public.analysis_attempts a
    where a.student_id = coalesce(n.subject_student_id, n.user_id)
      and (n.period_id is null or a.period_id = n.period_id)
      and not a.counts_toward_limit
  )
  and not exists (
    select 1 from public.analysis_attempts a
    where a.student_id = coalesce(n.subject_student_id, n.user_id)
      and (n.period_id is null or a.period_id = n.period_id)
      and a.counts_toward_limit
      and a.engine_version = 'plagguard-antiplagio-v2'
  );

create or replace function public.get_student_process_state(
  p_student_id uuid default null,
  p_period_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student uuid := coalesce(p_student_id, auth.uid());
  v_enrollment public.student_enrollments%rowtype;
  v_period public.academic_periods%rowtype;
  v_ordinary_used integer := 0;
  v_supp_used integer := 0;
  v_complied public.analysis_attempts%rowtype;
  v_stage text;
begin
  if auth.uid() is null then raise exception 'Sesión no válida'; end if;
  if v_student <> auth.uid() and not public.is_coordinator() then raise exception 'Acceso denegado'; end if;

  select * into v_enrollment
  from public.student_enrollments
  where student_id = v_student and active
    and (p_period_id is null or period_id = p_period_id)
  order by created_at desc limit 1;
  if not found then return jsonb_build_object('configured', false, 'student_id', v_student); end if;

  select * into v_period from public.academic_periods where id = v_enrollment.period_id;
  if not found then return jsonb_build_object('configured', false, 'student_id', v_student); end if;

  select count(*) into v_ordinary_used
  from public.analysis_attempts
  where student_id = v_student and period_id = v_period.id
    and process = 'ordinary'::public.attempt_process
    and counts_toward_limit
    and engine_version = 'plagguard-antiplagio-v2';

  select count(*) into v_supp_used
  from public.analysis_attempts
  where student_id = v_student and period_id = v_period.id
    and process = 'supplementary'::public.attempt_process
    and counts_toward_limit
    and engine_version = 'plagguard-antiplagio-v2';

  select * into v_complied
  from public.analysis_attempts
  where student_id = v_student and period_id = v_period.id
    and status = 'complies'::public.attempt_status
    and counts_toward_limit
    and engine_version = 'plagguard-antiplagio-v2'
  order by created_at asc limit 1;

  if found then v_stage := 'completed';
  elsif v_ordinary_used < v_period.ordinary_attempts then
    v_stage := case when v_period.ordinary_open then 'ordinary' else 'ordinary_closed' end;
  elsif not v_period.supplementary_open then v_stage := 'awaiting_supplementary';
  elsif v_supp_used < v_period.supplementary_attempts then v_stage := 'supplementary';
  else v_stage := 'exhausted';
  end if;

  return jsonb_build_object(
    'configured', true,
    'student_id', v_student,
    'period_id', v_period.id,
    'period_name', v_period.name,
    'career', v_enrollment.career,
    'modality', v_enrollment.modality,
    'similarity_limit', v_period.similarity_limit,
    'ordinary_limit', v_period.ordinary_attempts,
    'ordinary_used', v_ordinary_used,
    'ordinary_remaining', greatest(v_period.ordinary_attempts - v_ordinary_used, 0),
    'supplementary_limit', v_period.supplementary_attempts,
    'supplementary_used', v_supp_used,
    'supplementary_remaining', greatest(v_period.supplementary_attempts - v_supp_used, 0),
    'ordinary_open', v_period.ordinary_open,
    'supplementary_open', v_period.supplementary_open,
    'stage', v_stage,
    'complied_attempt_id', case when v_complied.id is null then null else v_complied.id end,
    'complied_similarity', case when v_complied.id is null then null else v_complied.consolidated_similarity end,
    'complied_at', case when v_complied.id is null then null else v_complied.created_at end
  );
end;
$$;

revoke all on function public.get_student_process_state(uuid,uuid) from public;
grant execute on function public.get_student_process_state(uuid,uuid) to authenticated;

create or replace function public.get_student_current_result(
  p_student_id uuid default null,
  p_period_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student uuid := coalesce(p_student_id, auth.uid());
  v_period uuid := p_period_id;
  v_row public.analysis_attempts%rowtype;
  v_historical public.analysis_attempts%rowtype;
begin
  if auth.uid() is null then raise exception 'Sesión no válida'; end if;
  if v_student <> auth.uid() and not public.is_coordinator() then raise exception 'Acceso denegado'; end if;

  if v_period is null then
    select period_id into v_period
    from public.student_enrollments
    where student_id = v_student and active
    order by updated_at desc limit 1;
  end if;

  select * into v_row
  from public.analysis_attempts
  where student_id = v_student
    and (v_period is null or period_id = v_period)
    and counts_toward_limit
    and engine_version = 'plagguard-antiplagio-v2'
  order by created_at desc limit 1;

  if found then
    return jsonb_build_object(
      'available', true,
      'id', v_row.id,
      'target_document_id', v_row.target_document_id,
      'target_version_id', v_row.target_version_id,
      'process', v_row.process,
      'attempt_number', v_row.attempt_number,
      'consolidated_similarity', v_row.consolidated_similarity,
      'status', v_row.status,
      'engine_version', v_row.engine_version,
      'counts_toward_limit', v_row.counts_toward_limit,
      'created_at', v_row.created_at
    );
  end if;

  select * into v_historical
  from public.analysis_attempts
  where student_id = v_student
    and (v_period is null or period_id = v_period)
    and not counts_toward_limit
  order by created_at desc limit 1;

  if not found then
    return jsonb_build_object('available', false, 'historical_available', false);
  end if;

  return jsonb_build_object(
    'available', false,
    'historical_available', true,
    'historical_id', v_historical.id,
    'historical_target_document_id', v_historical.target_document_id,
    'historical_target_version_id', v_historical.target_version_id,
    'historical_process', v_historical.process,
    'historical_attempt_number', v_historical.attempt_number,
    'historical_similarity', v_historical.consolidated_similarity,
    'historical_status', v_historical.status,
    'historical_engine_version', v_historical.engine_version,
    'historical_created_at', v_historical.created_at
  );
end;
$$;

revoke all on function public.get_student_current_result(uuid,uuid) from public;
grant execute on function public.get_student_current_result(uuid,uuid) to authenticated;

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
  if coalesce(p_provenance->>'engine_version','') <> 'plagguard-antiplagio-v2' then
    raise exception 'Versión de motor antiplagio inválida';
  end if;

  v_internal_id := nullif(p_provenance->>'internal_analysis_id', '');
  v_external_id := nullif(p_provenance->>'external_analysis_id', '');
  v_citation_id := nullif(p_provenance->>'citation_analysis_id', '');
  v_ai_id := nullif(p_provenance->>'ai_analysis_id', '');
  if v_internal_id is null or v_external_id is null or v_citation_id is null or v_ai_id is null then
    raise exception 'El intento requiere trazabilidad de los cuatro módulos';
  end if;

  select * into v_version from public.document_versions where id = p_target_version_id;
  if not found then raise exception 'Versión no encontrada'; end if;
  if v_version.extraction_status <> 'ready'::public.extraction_status then
    raise exception 'La versión no tiene texto listo';
  end if;

  select * into v_document from public.documents where id = v_version.document_id for update;
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

  if exists(
    select 1 from public.analysis_attempts
    where target_version_id = p_target_version_id
      and counts_toward_limit
      and engine_version = 'plagguard-antiplagio-v2'
  ) then raise exception 'Esta versión ya fue utilizada en un intento vigente'; end if;

  if exists(
    select 1 from public.analysis_attempts
    where student_id = v_document.owner_id
      and period_id = v_period.id
      and status = 'complies'::public.attempt_status
      and counts_toward_limit
      and engine_version = 'plagguard-antiplagio-v2'
  ) then raise exception 'El proceso ya está cerrado por Cumple'; end if;

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
  ) then raise exception 'La trazabilidad de citas y referencias no corresponde a esta versión'; end if;
  if not exists(
    select 1 from public.ai_writing_analyses
    where id::text = v_ai_id
      and target_version_id = p_target_version_id
      and algorithm_version = 'siai-semantic-plagiarism-trace-v1'
      and coalesce(summary->>'methodology','') = 'source_grounded_semantic_similarity'
  ) then raise exception 'La trazabilidad de IA semántica no corresponde al motor antiplagio vigente'; end if;

  if v_internal_id <> coalesce((
    select id::text from public.similarity_analyses
    where target_version_id = p_target_version_id order by created_at desc limit 1
  ), '') then raise exception 'El análisis institucional no es el más reciente'; end if;
  if v_external_id <> coalesce((
    select id::text from public.external_similarity_analyses
    where target_version_id = p_target_version_id order by created_at desc limit 1
  ), '') then raise exception 'El análisis externo no es el más reciente'; end if;
  if v_citation_id <> coalesce((
    select id::text from public.citation_integrity_analyses
    where target_version_id = p_target_version_id order by created_at desc limit 1
  ), '') then raise exception 'El análisis de citas no es el más reciente'; end if;
  if v_ai_id <> coalesce((
    select id::text from public.ai_writing_analyses
    where target_version_id = p_target_version_id order by created_at desc limit 1
  ), '') then raise exception 'La validación semántica con IA no es la más reciente'; end if;

  select count(*) into v_ordinary_used
  from public.analysis_attempts
  where student_id = v_document.owner_id and period_id = v_period.id
    and process = 'ordinary'::public.attempt_process
    and counts_toward_limit and engine_version = 'plagguard-antiplagio-v2';

  select count(*) into v_supp_used
  from public.analysis_attempts
  where student_id = v_document.owner_id and period_id = v_period.id
    and process = 'supplementary'::public.attempt_process
    and counts_toward_limit and engine_version = 'plagguard-antiplagio-v2';

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
    consolidated_similarity, status, executed_by, observation, provenance,
    engine_version, counts_toward_limit
  ) values (
    v_document.owner_id, v_period.id, v_document.id, v_version.id, v_process, v_attempt_number,
    round(p_consolidated_similarity, 2), v_status, v_user,
    nullif(trim(coalesce(p_observation,'')),''), p_provenance,
    'plagguard-antiplagio-v2', true
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

    update public.notifications
    set resolved = true, resolved_at = coalesce(resolved_at, now())
    where subject_student_id = v_document.owner_id
      and period_id = v_period.id
      and not resolved
      and kind in ('supplementary_required','attempts_exhausted');

    insert into public.notifications(user_id, kind, title, message, period_id, subject_student_id)
    values (
      v_document.owner_id, 'process_completed', 'Cumple',
      'Tu trabajo cumple el límite institucional de similitud y el proceso quedó cerrado.',
      v_period.id, v_document.owner_id
    );
  elsif v_process = 'ordinary'::public.attempt_process and v_attempt_number >= v_period.ordinary_attempts then
    insert into public.notifications(user_id, kind, title, message, period_id, subject_student_id)
    values (
      v_document.owner_id, 'supplementary_required', 'Pasa a Supletorio',
      'Agotaste los intentos Ordinarios. El Administrador debe abrir el Supletorio para habilitar tres intentos adicionales.',
      v_period.id, v_document.owner_id
    );

    for v_staff in
      select id from public.profiles
      where role in ('coordinator'::public.app_role, 'admin'::public.app_role)
    loop
      insert into public.notifications(user_id, kind, title, message, period_id, subject_student_id)
      values (
        v_staff.id, 'supplementary_required', 'Estudiante pasa a Supletorio',
        'Un estudiante agotó los intentos Ordinarios sin cumplir el límite de similitud.',
        v_period.id, v_document.owner_id
      );
    end loop;
  elsif v_process = 'supplementary'::public.attempt_process and v_attempt_number >= v_period.supplementary_attempts then
    insert into public.notifications(user_id, kind, title, message, period_id, subject_student_id)
    values (
      v_document.owner_id, 'attempts_exhausted', 'Intentos agotados',
      'Agotaste los intentos de Supletorio sin cumplir el límite institucional.',
      v_period.id, v_document.owner_id
    );
  end if;

  return next v_row;
end;
$$;

revoke all on function public.record_analysis_attempt(uuid,numeric,text,jsonb) from public;
grant execute on function public.record_analysis_attempt(uuid,numeric,text,jsonb) to authenticated;

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
    and a.counts_toward_limit
    and a.engine_version = 'plagguard-antiplagio-v2'
  order by a.created_at asc limit 1;
  if not found then raise exception 'El informe oficial solo puede generarse para un Cumple del motor antiplagio vigente'; end if;

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
  if coalesce(p_snapshot#>>'{provenance,engine_version}', '') <> 'plagguard-antiplagio-v2' then
    raise exception 'La instantánea no corresponde al motor antiplagio vigente';
  end if;
  if coalesce(jsonb_typeof(p_snapshot->'internal_similarity'), 'null') <> 'object'
     or coalesce(jsonb_typeof(p_snapshot->'external_similarity'), 'null') <> 'object'
     or coalesce(jsonb_typeof(p_snapshot->'citation_integrity'), 'null') <> 'object'
     or coalesce(jsonb_typeof(p_snapshot->'ai_writing'), 'null') <> 'object' then
    raise exception 'El informe oficial requiere los cuatro módulos completos';
  end if;

  if coalesce(p_snapshot#>>'{provenance,internal_analysis_id}', '') <> coalesce(v_attempt.provenance->>'internal_analysis_id','')
     or coalesce(p_snapshot#>>'{provenance,external_analysis_id}', '') <> coalesce(v_attempt.provenance->>'external_analysis_id','')
     or coalesce(p_snapshot#>>'{provenance,citation_analysis_id}', '') <> coalesce(v_attempt.provenance->>'citation_analysis_id','')
     or coalesce(p_snapshot#>>'{provenance,ai_analysis_id}', '') <> coalesce(v_attempt.provenance->>'ai_analysis_id','')
     or coalesce(p_snapshot#>>'{provenance,engine_version}', '') <> coalesce(v_attempt.provenance->>'engine_version','') then
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

  v_server_hash := public.plagguard_sha256_jsonb(p_snapshot);
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

create or replace function public.verify_integrity_report(p_report_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.integrity_report_snapshots r
    join public.analysis_attempts a
      on a.target_version_id = r.target_version_id
     and a.status = 'complies'::public.attempt_status
     and a.counts_toward_limit
     and a.engine_version = 'plagguard-antiplagio-v2'
    where r.id = p_report_id
      and public.is_coordinator()
      and r.final_status = 'approved'
      and coalesce(r.snapshot#>>'{provenance,engine_version}', '') = 'plagguard-antiplagio-v2'
      and coalesce(jsonb_typeof(r.snapshot->'internal_similarity'), 'null') = 'object'
      and coalesce(jsonb_typeof(r.snapshot->'external_similarity'), 'null') = 'object'
      and coalesce(jsonb_typeof(r.snapshot->'citation_integrity'), 'null') = 'object'
      and coalesce(jsonb_typeof(r.snapshot->'ai_writing'), 'null') = 'object'
      and coalesce(r.snapshot#>>'{document,version_id}', '') = r.target_version_id::text
      and coalesce(r.snapshot#>>'{provenance,internal_analysis_id}', '') = coalesce(a.provenance->>'internal_analysis_id','')
      and coalesce(r.snapshot#>>'{provenance,external_analysis_id}', '') = coalesce(a.provenance->>'external_analysis_id','')
      and coalesce(r.snapshot#>>'{provenance,citation_analysis_id}', '') = coalesce(a.provenance->>'citation_analysis_id','')
      and coalesce(r.snapshot#>>'{provenance,ai_analysis_id}', '') = coalesce(a.provenance->>'ai_analysis_id','')
      and coalesce(r.snapshot#>>'{provenance,engine_version}', '') = coalesce(a.provenance->>'engine_version','')
      and case
        when coalesce(r.snapshot#>>'{summary,consolidated_similarity_adjusted}', '') ~ '^\d+(\.\d+)?$'
        then abs((r.snapshot#>>'{summary,consolidated_similarity_adjusted}')::numeric - a.consolidated_similarity) <= 0.01
        else false
      end
      and r.snapshot_sha256 = public.plagguard_sha256_jsonb(r.snapshot)
  );
$$;

revoke all on function public.verify_integrity_report(uuid) from public;
grant execute on function public.verify_integrity_report(uuid) to authenticated;

comment on column public.analysis_attempts.engine_version is
  'Versión del motor que produjo el intento. plagguard-antiplagio-v2 identifica el flujo actual.';
comment on column public.analysis_attempts.counts_toward_limit is
  'Solo true consume uno de los 3+3 intentos y puede cerrar el proceso vigente.';
