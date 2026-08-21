-- PlagGuard · ITSQMET - Fase 15
-- Ejecutar DESPUÉS de supabase/phase14.sql.
-- La verificación oficial exige no solo la huella, sino también un intento Cumple
-- con el mismo porcentaje y la misma procedencia de los cuatro módulos.

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
    where r.id = p_report_id
      and public.is_coordinator()
      and r.final_status = 'approved'
      and coalesce(jsonb_typeof(r.snapshot->'internal_similarity'), 'null') = 'object'
      and coalesce(jsonb_typeof(r.snapshot->'external_similarity'), 'null') = 'object'
      and coalesce(jsonb_typeof(r.snapshot->'citation_integrity'), 'null') = 'object'
      and coalesce(jsonb_typeof(r.snapshot->'ai_writing'), 'null') = 'object'
      and coalesce(r.snapshot#>>'{document,version_id}', '') = r.target_version_id::text
      and coalesce(r.snapshot#>>'{provenance,internal_analysis_id}', '') = coalesce(a.provenance->>'internal_analysis_id','')
      and coalesce(r.snapshot#>>'{provenance,external_analysis_id}', '') = coalesce(a.provenance->>'external_analysis_id','')
      and coalesce(r.snapshot#>>'{provenance,citation_analysis_id}', '') = coalesce(a.provenance->>'citation_analysis_id','')
      and coalesce(r.snapshot#>>'{provenance,ai_analysis_id}', '') = coalesce(a.provenance->>'ai_analysis_id','')
      and abs(coalesce((r.snapshot#>>'{summary,consolidated_similarity_adjusted}')::numeric, -1) - a.consolidated_similarity) <= 0.01
      and r.snapshot_sha256 = public.plagguard_sha256_jsonb(r.snapshot)
  );
$$;

revoke all on function public.verify_integrity_report(uuid) from public;
grant execute on function public.verify_integrity_report(uuid) to authenticated;

comment on function public.verify_integrity_report is 'Verifica huella, módulos, porcentaje y procedencia contra el intento Cumple antes de exportar un informe oficial.';
