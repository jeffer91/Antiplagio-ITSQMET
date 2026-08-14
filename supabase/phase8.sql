-- SIAI / ITSQMET - Fase 8
-- Ejecutar DESPUÉS de supabase/phase7.sql.
-- Persiste instantáneas inmutables de los informes finales de integridad académica.

create table public.integrity_report_snapshots (
  id uuid primary key default gen_random_uuid(),
  target_version_id uuid not null references public.document_versions(id) on delete cascade,
  target_document_id uuid not null references public.documents(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict,
  report_number integer not null check (report_number > 0),
  report_schema_version text not null check (char_length(report_schema_version) between 1 and 50),
  final_status text not null check (final_status in ('pending', 'approved', 'observed', 'correction_required', 'rejected')),
  final_observation text check (final_observation is null or char_length(final_observation) <= 5000),
  snapshot jsonb not null,
  snapshot_sha256 text not null check (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  released_to_student boolean not null default false,
  created_at timestamptz not null default now(),
  unique (target_version_id, report_number),
  check (jsonb_typeof(snapshot) = 'object')
);

create index integrity_report_target_idx
  on public.integrity_report_snapshots(target_version_id, report_number desc);

create index integrity_report_document_idx
  on public.integrity_report_snapshots(target_document_id, created_at desc);

alter table public.integrity_report_snapshots enable row level security;

grant select on public.integrity_report_snapshots to authenticated;

create policy "integrity_reports_select_coordinator_or_released_owner"
on public.integrity_report_snapshots
for select
to authenticated
using (
  public.is_coordinator()
  or (
    released_to_student
    and exists (
      select 1
      from public.documents d
      where d.id = target_document_id
        and d.owner_id = auth.uid()
    )
  )
);

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
  if v_user is null or not public.is_coordinator() then
    raise exception 'Solo el coordinador puede crear informes finales';
  end if;

  select dv.document_id, dv.extraction_status
  into v_document_id, v_status
  from public.document_versions dv
  where dv.id = p_target_version_id;

  if not found then
    raise exception 'La versión objetivo no existe';
  end if;

  if v_status <> 'ready'::public.extraction_status then
    raise exception 'La versión objetivo no tiene texto listo';
  end if;

  if char_length(trim(coalesce(p_report_schema_version, ''))) < 1
     or char_length(trim(p_report_schema_version)) > 50 then
    raise exception 'Versión de esquema de informe inválida';
  end if;

  if p_final_status not in ('pending', 'approved', 'observed', 'correction_required', 'rejected') then
    raise exception 'Estado final inválido';
  end if;

  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then
    raise exception 'La instantánea del informe debe ser un objeto JSON';
  end if;

  if p_snapshot_sha256 is null or p_snapshot_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Huella SHA-256 del informe inválida';
  end if;

  if char_length(coalesce(p_final_observation, '')) > 5000 then
    raise exception 'La observación final supera el límite permitido';
  end if;

  -- Evita que dos solicitudes concurrentes asignen el mismo número de informe.
  perform pg_advisory_xact_lock(hashtextextended(p_target_version_id::text, 0));

  select coalesce(max(r.report_number), 0) + 1
  into v_report_number
  from public.integrity_report_snapshots r
  where r.target_version_id = p_target_version_id;

  insert into public.integrity_report_snapshots (
    target_version_id,
    target_document_id,
    created_by,
    report_number,
    report_schema_version,
    final_status,
    final_observation,
    snapshot,
    snapshot_sha256
  ) values (
    p_target_version_id,
    v_document_id,
    v_user,
    v_report_number,
    trim(p_report_schema_version),
    p_final_status,
    nullif(trim(coalesce(p_final_observation, '')), ''),
    p_snapshot,
    p_snapshot_sha256
  ) returning id into v_report_id;

  return v_report_id;
end;
$$;

revoke all on function public.save_integrity_report_snapshot(uuid,text,text,text,jsonb,text) from public;
grant execute on function public.save_integrity_report_snapshot(uuid,text,text,text,jsonb,text) to authenticated;

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
    raise exception 'Solo el coordinador puede liberar informes finales';
  end if;

  update public.integrity_report_snapshots
  set released_to_student = coalesce(p_released, false)
  where id = p_report_id;

  if not found then
    raise exception 'El informe final no existe';
  end if;
end;
$$;

revoke all on function public.set_integrity_report_release(uuid,boolean) from public;
grant execute on function public.set_integrity_report_release(uuid,boolean) to authenticated;

comment on table public.integrity_report_snapshots is 'Instantáneas inmutables y verificables de los informes consolidados de SIAI.';
comment on function public.save_integrity_report_snapshot is 'Crea una nueva versión del informe final sin sobrescribir informes anteriores.';
