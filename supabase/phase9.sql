-- PlagGuard · ITSQMET - Fase 9
-- Ejecutar DESPUÉS de supabase/phase8.sql.
-- Institucionaliza roles, periodos, intentos Ordinario/Supletorio, repositorio final,
-- alertas, ownership correcto y reglas del 20 %.

-- 1) Roles -------------------------------------------------------------------
alter type public.app_role add value if not exists 'admin';

-- Se conserva el nombre por compatibilidad con fases anteriores.
-- Desde Fase 9, "is_coordinator" significa personal autorizado (coordinador o administrador).
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
      and p.role in ('coordinator'::public.app_role, 'admin'::public.app_role)
  );
$$;

create or replace function public.is_admin()
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
      and p.role = 'admin'::public.app_role
  );
$$;

create or replace function public.is_student_uuid(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_user and p.role = 'student'::public.app_role
  );
$$;

revoke all on function public.is_admin() from public;
revoke all on function public.is_student_uuid(uuid) from public;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_student_uuid(uuid) to authenticated;

-- 2) Periodos y organización académica --------------------------------------
create table if not exists public.academic_periods (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(trim(name)) between 3 and 120),
  similarity_limit numeric(5,2) not null default 20.00 check (similarity_limit >= 0 and similarity_limit <= 100),
  ordinary_attempts integer not null default 3 check (ordinary_attempts between 1 and 20),
  supplementary_attempts integer not null default 3 check (supplementary_attempts between 1 and 20),
  ordinary_open boolean not null default true,
  supplementary_open boolean not null default false,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.student_enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  period_id uuid not null references public.academic_periods(id) on delete cascade,
  career text not null check (char_length(trim(career)) between 2 and 180),
  modality text not null check (char_length(trim(modality)) between 2 and 60),
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, period_id, career, modality)
);

create unique index if not exists student_enrollments_one_active_idx
  on public.student_enrollments(student_id)
  where active;

alter table public.documents
  add column if not exists academic_period_id uuid references public.academic_periods(id) on delete restrict,
  add column if not exists career text,
  add column if not exists modality text;

create index if not exists documents_academic_context_idx
  on public.documents(academic_period_id, career, modality, updated_at desc);

alter table public.academic_periods enable row level security;
alter table public.student_enrollments enable row level security;

grant select on public.academic_periods to authenticated;
grant select on public.student_enrollments to authenticated;

create policy "academic_periods_select_authenticated"
on public.academic_periods for select to authenticated
using (true);

create policy "student_enrollments_select_own_or_staff"
on public.student_enrollments for select to authenticated
using (student_id = auth.uid() or public.is_coordinator());

-- 3) Intentos ----------------------------------------------------------------
do $$ begin
  create type public.attempt_process as enum ('ordinary', 'supplementary');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.attempt_status as enum ('complies', 'does_not_comply');
exception when duplicate_object then null; end $$;

create table if not exists public.analysis_attempts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete restrict,
  period_id uuid not null references public.academic_periods(id) on delete restrict,
  target_document_id uuid not null references public.documents(id) on delete restrict,
  target_version_id uuid not null references public.document_versions(id) on delete restrict,
  process public.attempt_process not null,
  attempt_number integer not null check (attempt_number > 0),
  consolidated_similarity numeric(5,2) not null check (consolidated_similarity >= 0 and consolidated_similarity <= 100),
  status public.attempt_status not null,
  executed_by uuid not null references public.profiles(id) on delete restrict,
  observation text check (observation is null or char_length(observation) <= 5000),
  provenance jsonb not null default '{}'::jsonb check (jsonb_typeof(provenance) = 'object'),
  created_at timestamptz not null default now(),
  unique (target_version_id),
  unique (student_id, period_id, process, attempt_number)
);

create index if not exists analysis_attempts_student_idx
  on public.analysis_attempts(student_id, period_id, process, attempt_number);

alter table public.analysis_attempts enable row level security;
grant select on public.analysis_attempts to authenticated;

create policy "analysis_attempts_select_staff_or_current_student_result"
on public.analysis_attempts for select to authenticated
using (public.is_coordinator() or student_id = auth.uid());

-- 4) Alertas internas ---------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (char_length(kind) between 2 and 80),
  title text not null check (char_length(title) between 2 and 180),
  message text not null check (char_length(message) between 2 and 2000),
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists notifications_user_idx
  on public.notifications(user_id, resolved, created_at desc);

alter table public.notifications enable row level security;
grant select on public.notifications to authenticated;

create policy "notifications_select_own"
on public.notifications for select to authenticated
using (user_id = auth.uid());

-- 5) Repositorio institucional: solo versión final que obtuvo Cumple ---------
create table if not exists public.institutional_repository (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null unique references public.documents(id) on delete restrict,
  version_id uuid not null unique references public.document_versions(id) on delete restrict,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  period_id uuid not null references public.academic_periods(id) on delete restrict,
  active boolean not null default true,
  included_at timestamptz not null default now(),
  excluded_at timestamptz,
  excluded_by uuid references public.profiles(id) on delete restrict,
  exclusion_reason text check (exclusion_reason is null or char_length(exclusion_reason) <= 2000)
);

create index if not exists institutional_repository_active_idx
  on public.institutional_repository(active, included_at desc);

alter table public.institutional_repository enable row level security;
grant select on public.institutional_repository to authenticated;

create policy "institutional_repository_select_authenticated"
on public.institutional_repository for select to authenticated
using (true);

-- 6) Administración -----------------------------------------------------------
create or replace function public.admin_create_period(
  p_name text,
  p_similarity_limit numeric default 20,
  p_ordinary_attempts integer default 3,
  p_supplementary_attempts integer default 3,
  p_ordinary_open boolean default true,
  p_supplementary_open boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Solo el Administrador puede crear periodos';
  end if;
  if char_length(trim(coalesce(p_name, ''))) < 3 then raise exception 'Nombre de periodo inválido'; end if;
  if p_similarity_limit < 0 or p_similarity_limit > 100 then raise exception 'Límite de similitud inválido'; end if;
  if p_ordinary_attempts < 1 or p_supplementary_attempts < 1 then raise exception 'Número de intentos inválido'; end if;

  insert into public.academic_periods(name, similarity_limit, ordinary_attempts, supplementary_attempts, ordinary_open, supplementary_open, created_by)
  values (trim(p_name), p_similarity_limit, p_ordinary_attempts, p_supplementary_attempts, coalesce(p_ordinary_open, true), coalesce(p_supplementary_open, false), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.admin_set_period_state(
  p_period_id uuid,
  p_ordinary_open boolean,
  p_supplementary_open boolean,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo el Administrador puede modificar periodos'; end if;
  update public.academic_periods
  set ordinary_open = coalesce(p_ordinary_open, ordinary_open),
      supplementary_open = coalesce(p_supplementary_open, supplementary_open),
      active = coalesce(p_active, active),
      updated_at = now()
  where id = p_period_id;
  if not found then raise exception 'Periodo no encontrado'; end if;
end;
$$;

create or replace function public.admin_set_profile_role(p_user_id uuid, p_role public.app_role)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo el Administrador puede cambiar roles'; end if;
  if p_user_id = auth.uid() and p_role <> 'admin'::public.app_role then
    raise exception 'El Administrador no puede quitarse su propio acceso administrativo';
  end if;
  update public.profiles set role = p_role where id = p_user_id;
  if not found then raise exception 'Usuario no encontrado'; end if;
end;
$$;

create or replace function public.admin_assign_student(
  p_student_id uuid,
  p_period_id uuid,
  p_career text,
  p_modality text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo el Administrador puede asignar estudiantes'; end if;
  if not public.is_student_uuid(p_student_id) then raise exception 'El usuario seleccionado no es estudiante'; end if;
  if not exists(select 1 from public.academic_periods where id = p_period_id and active) then raise exception 'Periodo no disponible'; end if;
  if char_length(trim(coalesce(p_career, ''))) < 2 or char_length(trim(coalesce(p_modality, ''))) < 2 then
    raise exception 'Carrera y modalidad son obligatorias';
  end if;

  update public.student_enrollments set active = false, updated_at = now()
  where student_id = p_student_id and active;

  insert into public.student_enrollments(student_id, period_id, career, modality, active, created_by)
  values (p_student_id, p_period_id, trim(p_career), trim(p_modality), true, auth.uid())
  on conflict (student_id, period_id, career, modality)
  do update set active = true, updated_at = now(), created_by = excluded.created_by
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.admin_create_period(text,numeric,integer,integer,boolean,boolean) from public;
revoke all on function public.admin_set_period_state(uuid,boolean,boolean,boolean) from public;
revoke all on function public.admin_set_profile_role(uuid,public.app_role) from public;
revoke all on function public.admin_assign_student(uuid,uuid,text,text) from public;
grant execute on function public.admin_create_period(text,numeric,integer,integer,boolean,boolean) to authenticated;
grant execute on function public.admin_set_period_state(uuid,boolean,boolean,boolean) to authenticated;
grant execute on function public.admin_set_profile_role(uuid,public.app_role) to authenticated;
grant execute on function public.admin_assign_student(uuid,uuid,text,text) to authenticated;

-- 7) Ownership correcto: coordinador puede cargar para estudiante -------------
create policy "academic_documents_insert_staff"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'academic-documents'
  and public.is_coordinator()
  and public.is_student_uuid(((storage.foldername(name))[1])::uuid)
);

create policy "academic_documents_delete_staff"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'academic-documents'
  and public.is_coordinator()
  and public.is_student_uuid(((storage.foldername(name))[1])::uuid)
);

create or replace function public.register_document_version_v2(
  p_document_id uuid,
  p_owner_id uuid,
  p_period_id uuid,
  p_career text,
  p_modality text,
  p_title text,
  p_original_file_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_sha256 text,
  p_storage_path text,
  p_extracted_text text,
  p_extracted_pages jsonb,
  p_word_count integer,
  p_character_count integer,
  p_page_count integer,
  p_extraction_status public.extraction_status,
  p_extraction_error text
)
returns setof public.document_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_document public.documents%rowtype;
  v_version integer;
  v_row public.document_versions%rowtype;
  v_enrollment public.student_enrollments%rowtype;
  v_period public.academic_periods%rowtype;
  v_ordinary_used integer := 0;
  v_supp_used integer := 0;
begin
  if v_user is null then raise exception 'Sesión no válida'; end if;
  if not public.is_student_uuid(p_owner_id) then raise exception 'El propietario debe ser un estudiante'; end if;
  if v_user <> p_owner_id and not public.is_coordinator() then raise exception 'No puedes cargar documentos para este estudiante'; end if;

  select * into v_enrollment
  from public.student_enrollments
  where student_id = p_owner_id and active and period_id = p_period_id
    and lower(trim(career)) = lower(trim(p_career))
    and lower(trim(modality)) = lower(trim(p_modality))
  limit 1;
  if not found then raise exception 'El estudiante no tiene una asignación activa para ese periodo, carrera y modalidad'; end if;

  select * into v_period from public.academic_periods where id = p_period_id and active;
  if not found then raise exception 'El periodo académico no está disponible'; end if;

  if exists (
    select 1 from public.analysis_attempts a
    where a.student_id = p_owner_id and a.period_id = p_period_id and a.status = 'complies'::public.attempt_status
  ) then raise exception 'El proceso ya está cerrado porque el estudiante obtuvo Cumple'; end if;

  select count(*) into v_ordinary_used from public.analysis_attempts a
    where a.student_id = p_owner_id and a.period_id = p_period_id and a.process = 'ordinary'::public.attempt_process;
  select count(*) into v_supp_used from public.analysis_attempts a
    where a.student_id = p_owner_id and a.period_id = p_period_id and a.process = 'supplementary'::public.attempt_process;

  if v_ordinary_used >= v_period.ordinary_attempts and not v_period.supplementary_open then
    raise exception 'Pasa a Supletorio. El Administrador debe abrir el Supletorio antes de una nueva entrega';
  end if;
  if v_ordinary_used >= v_period.ordinary_attempts and v_supp_used >= v_period.supplementary_attempts then
    raise exception 'No quedan intentos de Supletorio disponibles';
  end if;
  if v_ordinary_used < v_period.ordinary_attempts and not v_period.ordinary_open then
    raise exception 'El proceso Ordinario está cerrado';
  end if;

  if char_length(trim(p_title)) < 1 or char_length(trim(p_title)) > 240 then raise exception 'Título inválido'; end if;
  if p_mime_type not in ('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') then raise exception 'Formato no permitido'; end if;
  if p_size_bytes <= 0 or p_size_bytes > 26214400 then raise exception 'Tamaño de archivo no permitido'; end if;
  if p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'SHA-256 inválido'; end if;
  if split_part(p_storage_path, '/', 1) <> p_owner_id::text then raise exception 'Ruta de almacenamiento inválida'; end if;

  select * into v_document from public.documents where id = p_document_id for update;
  if found then
    if v_document.owner_id <> p_owner_id then raise exception 'El propietario del documento no puede cambiar'; end if;
    if v_document.academic_period_id is distinct from p_period_id
       or lower(coalesce(v_document.career,'')) <> lower(trim(p_career))
       or lower(coalesce(v_document.modality,'')) <> lower(trim(p_modality)) then
      raise exception 'El contexto académico del documento no puede cambiar entre versiones';
    end if;
    if exists(select 1 from public.document_versions where document_id = p_document_id and sha256 = p_sha256) then
      raise exception 'Este archivo ya existe en el historial del documento';
    end if;
  else
    insert into public.documents(id, owner_id, academic_period_id, career, modality, title, current_version, status)
    values (p_document_id, p_owner_id, p_period_id, trim(p_career), trim(p_modality), trim(p_title), 0, p_extraction_status)
    returning * into v_document;
  end if;

  select coalesce(max(version_number), 0) + 1 into v_version
  from public.document_versions where document_id = p_document_id;

  insert into public.document_versions(
    document_id, version_number, uploaded_by, original_file_name, mime_type,
    size_bytes, sha256, storage_path, extracted_text, extracted_pages,
    word_count, character_count, page_count, extraction_status, extraction_error
  ) values (
    p_document_id, v_version, v_user, p_original_file_name, p_mime_type,
    p_size_bytes, p_sha256, p_storage_path, coalesce(p_extracted_text,''), p_extracted_pages,
    greatest(coalesce(p_word_count,0),0), greatest(coalesce(p_character_count,0),0),
    p_page_count, p_extraction_status, p_extraction_error
  ) returning * into v_row;

  update public.documents
  set current_version = v_version, status = p_extraction_status, updated_at = now()
  where id = p_document_id;

  return next v_row;
end;
$$;

revoke all on function public.register_document_version_v2(uuid,uuid,uuid,text,text,text,text,text,bigint,text,text,text,jsonb,integer,integer,integer,public.extraction_status,text) from public;
grant execute on function public.register_document_version_v2(uuid,uuid,uuid,text,text,text,text,text,bigint,text,text,text,jsonb,integer,integer,integer,public.extraction_status,text) to authenticated;

-- 8) Estado del proceso --------------------------------------------------------
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

  select count(*) into v_ordinary_used from public.analysis_attempts
    where student_id = v_student and period_id = v_period.id and process = 'ordinary'::public.attempt_process;
  select count(*) into v_supp_used from public.analysis_attempts
    where student_id = v_student and period_id = v_period.id and process = 'supplementary'::public.attempt_process;
  select * into v_complied from public.analysis_attempts
    where student_id = v_student and period_id = v_period.id and status = 'complies'::public.attempt_status
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

-- 9) Registro del intento: 3 Ordinario + 3 Supletorio, 20 % por defecto ------
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
begin
  if v_user is null then raise exception 'Sesión no válida'; end if;
  if p_consolidated_similarity is null or p_consolidated_similarity < 0 or p_consolidated_similarity > 100 then
    raise exception 'Porcentaje consolidado inválido';
  end if;

  select * into v_version from public.document_versions where id = p_target_version_id;
  if not found then raise exception 'Versión no encontrada'; end if;
  if v_version.extraction_status <> 'ready'::public.extraction_status then raise exception 'La versión no tiene texto listo'; end if;

  select * into v_document from public.documents where id = v_version.document_id for update;
  if not found or v_document.academic_period_id is null then raise exception 'El documento no tiene contexto académico'; end if;
  if v_user <> v_document.owner_id and not public.is_coordinator() then raise exception 'No puedes registrar este intento'; end if;

  select * into v_period from public.academic_periods where id = v_document.academic_period_id and active;
  if not found then raise exception 'Periodo académico no disponible'; end if;

  if exists(select 1 from public.analysis_attempts where target_version_id = p_target_version_id) then
    raise exception 'Esta versión ya fue utilizada en un intento';
  end if;
  if exists(select 1 from public.analysis_attempts where student_id = v_document.owner_id and period_id = v_period.id and status = 'complies'::public.attempt_status) then
    raise exception 'El proceso ya está cerrado por Cumple';
  end if;

  -- El intento solo es válido si existen los cuatro módulos para esta versión.
  if not exists(select 1 from public.similarity_analyses where target_version_id = p_target_version_id) then raise exception 'Falta el análisis institucional'; end if;
  if not exists(select 1 from public.external_similarity_analyses where target_version_id = p_target_version_id) then raise exception 'Falta el análisis externo'; end if;
  if not exists(select 1 from public.citation_integrity_analyses where target_version_id = p_target_version_id) then raise exception 'Falta la revisión de citas y APA'; end if;
  if not exists(select 1 from public.ai_writing_analyses where target_version_id = p_target_version_id) then raise exception 'Faltan las señales de escritura asistida'; end if;

  select count(*) into v_ordinary_used from public.analysis_attempts
    where student_id = v_document.owner_id and period_id = v_period.id and process = 'ordinary'::public.attempt_process;
  select count(*) into v_supp_used from public.analysis_attempts
    where student_id = v_document.owner_id and period_id = v_period.id and process = 'supplementary'::public.attempt_process;

  if v_ordinary_used < v_period.ordinary_attempts then
    if not v_period.ordinary_open then raise exception 'El proceso Ordinario está cerrado'; end if;
    v_process := 'ordinary'::public.attempt_process;
    v_attempt_number := v_ordinary_used + 1;
  else
    if not v_period.supplementary_open then raise exception 'Pasa a Supletorio. El Administrador debe abrir el Supletorio'; end if;
    if v_supp_used >= v_period.supplementary_attempts then raise exception 'No quedan intentos de Supletorio'; end if;
    v_process := 'supplementary'::public.attempt_process;
    v_attempt_number := v_supp_used + 1;
  end if;

  v_status := case when p_consolidated_similarity <= v_period.similarity_limit
    then 'complies'::public.attempt_status else 'does_not_comply'::public.attempt_status end;

  insert into public.analysis_attempts(
    student_id, period_id, target_document_id, target_version_id, process, attempt_number,
    consolidated_similarity, status, executed_by, observation, provenance
  ) values (
    v_document.owner_id, v_period.id, v_document.id, v_version.id, v_process, v_attempt_number,
    round(p_consolidated_similarity, 2), v_status, v_user, nullif(trim(coalesce(p_observation,'')),''), coalesce(p_provenance,'{}'::jsonb)
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

    for v_staff in select id from public.profiles where role in ('coordinator'::public.app_role, 'admin'::public.app_role)
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

-- 10) Solo el Administrador puede excluir del repositorio --------------------
create or replace function public.admin_set_repository_active(
  p_version_id uuid,
  p_active boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo el Administrador puede modificar el repositorio institucional'; end if;
  if not coalesce(p_active,false) and char_length(trim(coalesce(p_reason,''))) < 5 then
    raise exception 'Debes registrar el motivo de la exclusión';
  end if;

  update public.institutional_repository
  set active = coalesce(p_active,false),
      excluded_at = case when coalesce(p_active,false) then null else now() end,
      excluded_by = case when coalesce(p_active,false) then null else auth.uid() end,
      exclusion_reason = case when coalesce(p_active,false) then null else trim(p_reason) end
  where version_id = p_version_id;
  if not found then raise exception 'La versión no pertenece al repositorio institucional'; end if;
end;
$$;

revoke all on function public.admin_set_repository_active(uuid,boolean,text) from public;
grant execute on function public.admin_set_repository_active(uuid,boolean,text) to authenticated;

-- Corpus: únicamente versiones finales Cumple activas en el repositorio.
create or replace function public.get_repository_corpus(p_target_version_id uuid)
returns table(
  id uuid,
  document_id uuid,
  version_number integer,
  extracted_text text,
  word_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  select dv.id, dv.document_id, dv.version_number, dv.extracted_text, dv.word_count
  from public.institutional_repository r
  join public.document_versions dv on dv.id = r.version_id
  join public.document_versions target on target.id = p_target_version_id
  where r.active
    and dv.extraction_status = 'ready'::public.extraction_status
    and dv.document_id <> target.document_id
    and length(trim(dv.extracted_text)) > 0;
$$;

revoke all on function public.get_repository_corpus(uuid) from public;
grant execute on function public.get_repository_corpus(uuid) to authenticated;

-- 11) Notificaciones ----------------------------------------------------------
create or replace function public.resolve_notification(p_notification_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Sesión no válida'; end if;
  update public.notifications
  set resolved = true, resolved_at = now()
  where id = p_notification_id and user_id = auth.uid();
  if not found then raise exception 'Notificación no encontrada'; end if;
end;
$$;

revoke all on function public.resolve_notification(uuid) from public;
grant execute on function public.resolve_notification(uuid) to authenticated;

-- 12) Informe oficial: solo sobre el primer intento Cumple -------------------
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
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_document_id uuid;
  v_status public.extraction_status;
  v_report_number integer;
  v_report_id uuid;
begin
  if v_user is null or not public.is_coordinator() then raise exception 'Solo Coordinador o Administrador pueden crear informes oficiales'; end if;
  select dv.document_id, dv.extraction_status into v_document_id, v_status
  from public.document_versions dv where dv.id = p_target_version_id;
  if not found then raise exception 'La versión objetivo no existe'; end if;
  if v_status <> 'ready'::public.extraction_status then raise exception 'La versión objetivo no tiene texto listo'; end if;

  if not exists(
    select 1 from public.analysis_attempts a
    where a.target_version_id = p_target_version_id and a.status = 'complies'::public.attempt_status
  ) then raise exception 'El informe oficial solo puede generarse para la versión que obtuvo Cumple'; end if;

  if p_final_status <> 'approved' then raise exception 'El informe oficial de una versión Cumple debe registrarse como Aprobado'; end if;
  if char_length(trim(coalesce(p_report_schema_version,''))) < 1 or char_length(trim(p_report_schema_version)) > 50 then raise exception 'Versión de esquema inválida'; end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then raise exception 'La instantánea debe ser un objeto JSON'; end if;
  if p_snapshot_sha256 is null or p_snapshot_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'Huella SHA-256 inválida'; end if;
  if char_length(coalesce(p_final_observation,'')) > 5000 then raise exception 'Observación demasiado extensa'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_target_version_id::text, 0));
  select coalesce(max(r.report_number),0) + 1 into v_report_number
  from public.integrity_report_snapshots r where r.target_version_id = p_target_version_id;

  insert into public.integrity_report_snapshots(
    target_version_id, target_document_id, created_by, report_number,
    report_schema_version, final_status, final_observation, snapshot, snapshot_sha256
  ) values (
    p_target_version_id, v_document_id, v_user, v_report_number,
    trim(p_report_schema_version), 'approved', nullif(trim(coalesce(p_final_observation,'')),''), p_snapshot, p_snapshot_sha256
  ) returning id into v_report_id;
  return v_report_id;
end;
$$;

comment on table public.analysis_attempts is 'Intentos PlagGuard: 3 Ordinario + 3 Supletorio por estudiante y periodo; estado binario Cumple/No cumple.';
comment on table public.institutional_repository is 'Solo versiones finales que obtuvieron Cumple; exclusión reservada al Administrador.';
comment on table public.notifications is 'Alertas internas persistentes de PlagGuard.';
