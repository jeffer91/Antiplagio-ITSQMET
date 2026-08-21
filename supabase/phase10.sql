-- PlagGuard · ITSQMET - Fase 10
-- Ejecutar DESPUÉS de supabase/phase9.sql.
-- Habilita análisis por el estudiante sobre sus propias versiones, mantiene
-- las decisiones/revisiones oficiales en personal autorizado y protege el historial completo.

-- 1) Autorización específica para ejecutar un análisis -----------------------
create or replace function public.can_analyze_version(p_version_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.document_versions dv
    join public.documents d on d.id = dv.document_id
    where dv.id = p_version_id
      and (d.owner_id = auth.uid() or public.is_coordinator())
  );
$$;

revoke all on function public.can_analyze_version(uuid) from public;
grant execute on function public.can_analyze_version(uuid) to authenticated;

-- Los RPC históricos de las fases 4-7 verifican is_coordinator().
-- Durante un wrapper de análisis legítimo, permitimos temporalmente ese chequeo
-- solo para la versión cuyo propietario es el usuario autenticado.
create or replace function public.is_coordinator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('coordinator'::public.app_role, 'admin'::public.app_role)
    )
    or (
      current_setting('plagguard.allow_analysis', true) = 'on'
      and coalesce(current_setting('plagguard.target_version', true), '') ~ '^[0-9a-fA-F-]{36}$'
      and exists (
        select 1
        from public.document_versions dv
        join public.documents d on d.id = dv.document_id
        where dv.id = current_setting('plagguard.target_version', true)::uuid
          and d.owner_id = auth.uid()
      )
    );
$$;

-- 2) El estudiante puede leer la evidencia de SUS análisis ------------------
create policy "similarity_analyses_select_owner"
on public.similarity_analyses
for select to authenticated
using (
  exists (select 1 from public.documents d where d.id = target_document_id and d.owner_id = auth.uid())
);

create or replace function public.can_access_similarity_analysis(p_analysis_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.similarity_analyses a
    join public.documents d on d.id = a.target_document_id
    where a.id = p_analysis_id
      and (public.is_coordinator() or d.owner_id = auth.uid())
  );
$$;

create policy "external_similarity_analyses_select_owner"
on public.external_similarity_analyses
for select to authenticated
using (
  exists (select 1 from public.documents d where d.id = target_document_id and d.owner_id = auth.uid())
);

create or replace function public.can_access_external_similarity_analysis(p_analysis_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.external_similarity_analyses a
    join public.documents d on d.id = a.target_document_id
    where a.id = p_analysis_id
      and (public.is_coordinator() or d.owner_id = auth.uid())
  );
$$;

create policy "citation_integrity_analyses_select_owner"
on public.citation_integrity_analyses
for select to authenticated
using (
  exists (select 1 from public.documents d where d.id = target_document_id and d.owner_id = auth.uid())
);

create or replace function public.can_access_citation_integrity_analysis(p_analysis_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.citation_integrity_analyses a
    join public.documents d on d.id = a.target_document_id
    where a.id = p_analysis_id
      and (public.is_coordinator() or d.owner_id = auth.uid())
  );
$$;

create policy "ai_writing_analyses_select_owner"
on public.ai_writing_analyses
for select to authenticated
using (
  exists (select 1 from public.documents d where d.id = target_document_id and d.owner_id = auth.uid())
);

create or replace function public.can_access_ai_writing_analysis(p_analysis_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.ai_writing_analyses a
    join public.documents d on d.id = a.target_document_id
    where a.id = p_analysis_id
      and (public.is_coordinator() or d.owner_id = auth.uid())
  );
$$;

create or replace function public.can_access_ai_writing_segment(p_segment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.ai_writing_segments s
    join public.ai_writing_analyses a on a.id = s.analysis_id
    join public.documents d on d.id = a.target_document_id
    left join public.ai_writing_segment_reviews r on r.segment_id = s.id
    where s.id = p_segment_id
      and (
        public.is_coordinator()
        or (d.owner_id = auth.uid() and coalesce(r.decision, 'unreviewed') <> 'dismissed')
      )
  );
$$;

-- 3) Wrappers seguros sobre los RPC de guardado existentes ------------------
-- Renombramos una vez las implementaciones históricas para conservar toda su validación.
alter function public.save_internal_similarity_analysis_v2(uuid,text,numeric,integer,integer,jsonb)
  rename to save_internal_similarity_analysis_v2_staff;
alter function public.save_similarity_adjustment(uuid,boolean,boolean,integer,uuid[],numeric,integer)
  rename to save_similarity_adjustment_staff;
alter function public.save_external_similarity_analysis(uuid,text,numeric,integer,integer,jsonb,jsonb)
  rename to save_external_similarity_analysis_staff;
alter function public.save_citation_integrity_analysis(uuid,text,boolean,text,jsonb,jsonb,jsonb)
  rename to save_citation_integrity_analysis_staff;
alter function public.save_ai_writing_analysis(uuid,text,numeric,numeric,integer,integer,integer,text,jsonb,jsonb)
  rename to save_ai_writing_analysis_staff;

create or replace function public.save_internal_similarity_analysis_v2(
  p_target_version_id uuid,
  p_algorithm_version text,
  p_similarity_percent numeric,
  p_matched_words integer,
  p_total_words integer,
  p_sources jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_result uuid;
begin
  if not public.can_analyze_version(p_target_version_id) then raise exception 'No puedes analizar esta versión'; end if;
  perform set_config('plagguard.target_version', p_target_version_id::text, true);
  perform set_config('plagguard.allow_analysis', 'on', true);
  v_result := public.save_internal_similarity_analysis_v2_staff(
    p_target_version_id,p_algorithm_version,p_similarity_percent,p_matched_words,p_total_words,p_sources
  );
  perform set_config('plagguard.allow_analysis', 'off', true);
  perform set_config('plagguard.target_version', '', true);
  return v_result;
end;
$$;

create or replace function public.save_similarity_adjustment(
  p_analysis_id uuid,
  p_exclude_bibliography boolean,
  p_exclude_quoted_text boolean,
  p_min_match_words integer,
  p_excluded_source_ids uuid[],
  p_adjusted_similarity_percent numeric,
  p_adjusted_matched_words integer
)
returns setof public.similarity_adjustments
language plpgsql
security definer
set search_path = public
as $$
declare v_target uuid; v_row public.similarity_adjustments%rowtype;
begin
  select target_version_id into v_target from public.similarity_analyses where id = p_analysis_id;
  if v_target is null or not public.can_analyze_version(v_target) then raise exception 'No puedes modificar este análisis'; end if;
  perform set_config('plagguard.target_version', v_target::text, true);
  perform set_config('plagguard.allow_analysis', 'on', true);
  select * into v_row from public.save_similarity_adjustment_staff(
    p_analysis_id,p_exclude_bibliography,p_exclude_quoted_text,p_min_match_words,
    p_excluded_source_ids,p_adjusted_similarity_percent,p_adjusted_matched_words
  );
  perform set_config('plagguard.allow_analysis', 'off', true);
  perform set_config('plagguard.target_version', '', true);
  return next v_row;
end;
$$;

create or replace function public.save_external_similarity_analysis(
  p_target_version_id uuid,
  p_algorithm_version text,
  p_similarity_percent numeric,
  p_matched_words integer,
  p_total_words integer,
  p_provider_summary jsonb,
  p_sources jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_result uuid;
begin
  if not public.can_analyze_version(p_target_version_id) then raise exception 'No puedes analizar esta versión'; end if;
  perform set_config('plagguard.target_version', p_target_version_id::text, true);
  perform set_config('plagguard.allow_analysis', 'on', true);
  v_result := public.save_external_similarity_analysis_staff(
    p_target_version_id,p_algorithm_version,p_similarity_percent,p_matched_words,p_total_words,p_provider_summary,p_sources
  );
  perform set_config('plagguard.allow_analysis', 'off', true);
  perform set_config('plagguard.target_version', '', true);
  return v_result;
end;
$$;

create or replace function public.save_citation_integrity_analysis(
  p_target_version_id uuid,
  p_algorithm_version text,
  p_bibliography_found boolean,
  p_bibliography_heading text,
  p_global_issues jsonb,
  p_references jsonb,
  p_mentions jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_result uuid;
begin
  if not public.can_analyze_version(p_target_version_id) then raise exception 'No puedes analizar esta versión'; end if;
  perform set_config('plagguard.target_version', p_target_version_id::text, true);
  perform set_config('plagguard.allow_analysis', 'on', true);
  v_result := public.save_citation_integrity_analysis_staff(
    p_target_version_id,p_algorithm_version,p_bibliography_found,p_bibliography_heading,
    p_global_issues,p_references,p_mentions
  );
  perform set_config('plagguard.allow_analysis', 'off', true);
  perform set_config('plagguard.target_version', '', true);
  return v_result;
end;
$$;

create or replace function public.save_ai_writing_analysis(
  p_target_version_id uuid,
  p_algorithm_version text,
  p_evidence_score numeric,
  p_flagged_word_percent numeric,
  p_flagged_words integer,
  p_analyzed_words integer,
  p_baseline_source_count integer,
  p_baseline_status text,
  p_summary jsonb,
  p_segments jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_result uuid;
begin
  if not public.can_analyze_version(p_target_version_id) then raise exception 'No puedes analizar esta versión'; end if;
  perform set_config('plagguard.target_version', p_target_version_id::text, true);
  perform set_config('plagguard.allow_analysis', 'on', true);
  v_result := public.save_ai_writing_analysis_staff(
    p_target_version_id,p_algorithm_version,p_evidence_score,p_flagged_word_percent,p_flagged_words,
    p_analyzed_words,p_baseline_source_count,p_baseline_status,p_summary,p_segments
  );
  perform set_config('plagguard.allow_analysis', 'off', true);
  perform set_config('plagguard.target_version', '', true);
  return v_result;
end;
$$;

revoke all on function public.save_internal_similarity_analysis_v2(uuid,text,numeric,integer,integer,jsonb) from public;
revoke all on function public.save_similarity_adjustment(uuid,boolean,boolean,integer,uuid[],numeric,integer) from public;
revoke all on function public.save_external_similarity_analysis(uuid,text,numeric,integer,integer,jsonb,jsonb) from public;
revoke all on function public.save_citation_integrity_analysis(uuid,text,boolean,text,jsonb,jsonb,jsonb) from public;
revoke all on function public.save_ai_writing_analysis(uuid,text,numeric,numeric,integer,integer,integer,text,jsonb,jsonb) from public;
grant execute on function public.save_internal_similarity_analysis_v2(uuid,text,numeric,integer,integer,jsonb) to authenticated;
grant execute on function public.save_similarity_adjustment(uuid,boolean,boolean,integer,uuid[],numeric,integer) to authenticated;
grant execute on function public.save_external_similarity_analysis(uuid,text,numeric,integer,integer,jsonb,jsonb) to authenticated;
grant execute on function public.save_citation_integrity_analysis(uuid,text,boolean,text,jsonb,jsonb,jsonb) to authenticated;
grant execute on function public.save_ai_writing_analysis(uuid,text,numeric,numeric,integer,integer,integer,text,jsonb,jsonb) to authenticated;

-- Las implementaciones *_staff solo pueden ser invocadas por los wrappers SECURITY DEFINER.
revoke all on function public.save_internal_similarity_analysis_v2_staff(uuid,text,numeric,integer,integer,jsonb) from public, authenticated;
revoke all on function public.save_similarity_adjustment_staff(uuid,boolean,boolean,integer,uuid[],numeric,integer) from public, authenticated;
revoke all on function public.save_external_similarity_analysis_staff(uuid,text,numeric,integer,integer,jsonb,jsonb) from public, authenticated;
revoke all on function public.save_citation_integrity_analysis_staff(uuid,text,boolean,text,jsonb,jsonb,jsonb) from public, authenticated;
revoke all on function public.save_ai_writing_analysis_staff(uuid,text,numeric,numeric,integer,integer,integer,text,jsonb,jsonb) from public, authenticated;

-- 4) El historial completo de intentos es exclusivo de Coordinador/Admin -------
drop policy if exists "analysis_attempts_select_staff_or_current_student_result" on public.analysis_attempts;
create policy "analysis_attempts_select_staff"
on public.analysis_attempts
for select to authenticated
using (public.is_coordinator());

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
  where student_id = v_student and (v_period is null or period_id = v_period)
  order by created_at desc
  limit 1;

  if not found then return jsonb_build_object('available', false); end if;
  return jsonb_build_object(
    'available', true,
    'id', v_row.id,
    'target_document_id', v_row.target_document_id,
    'target_version_id', v_row.target_version_id,
    'process', v_row.process,
    'attempt_number', v_row.attempt_number,
    'consolidated_similarity', v_row.consolidated_similarity,
    'status', v_row.status,
    'created_at', v_row.created_at
  );
end;
$$;

revoke all on function public.get_student_current_result(uuid,uuid) from public;
grant execute on function public.get_student_current_result(uuid,uuid) to authenticated;

-- 5) Resultados visibles al estudiante sin informes oficiales -----------------
-- El informe oficial sigue protegido por Fase 9 y solo se genera para Cumple.
-- Las decisiones humanas sobre segmentos de escritura asistida siguen siendo
-- exclusivas de Coordinador/Admin mediante save_ai_writing_segment_review().

comment on function public.can_analyze_version is 'Autoriza análisis únicamente al propietario de la versión o a personal autorizado.';
comment on function public.get_student_current_result is 'Devuelve solo el resultado vigente del estudiante; no expone el historial completo de intentos.';
