-- PlagGuard · ITSQMET - Fase 13
-- Ejecutar DESPUÉS de supabase/phase12.sql.
-- Endurecimiento de privacidad del repositorio institucional.

-- 1) El corpus completo nunca se entrega al cliente ---------------------------
revoke execute on function public.get_repository_corpus(uuid) from public, authenticated;

-- 2) El estudiante no puede consultar tablas crudas de coincidencias internas -
-- La lectura se realiza mediante get_internal_similarity_safe(), que oculta
-- identidad, título y texto de la fuente institucional para estudiantes.
drop policy if exists "similarity_analyses_select_owner" on public.similarity_analyses;
drop policy if exists "similarity_analyses_select_coordinator_or_released_owner" on public.similarity_analyses;
drop policy if exists "similarity_sources_select_accessible_analysis" on public.similarity_sources;
drop policy if exists "similarity_matches_select_accessible_analysis" on public.similarity_matches;
drop policy if exists "similarity_adjustments_select_accessible_analysis" on public.similarity_adjustments;

create policy "similarity_analyses_select_staff"
on public.similarity_analyses for select to authenticated
using (public.is_coordinator());

create policy "similarity_sources_select_staff"
on public.similarity_sources for select to authenticated
using (public.is_coordinator());

create policy "similarity_matches_select_staff"
on public.similarity_matches for select to authenticated
using (public.is_coordinator());

create policy "similarity_adjustments_select_staff"
on public.similarity_adjustments for select to authenticated
using (public.is_coordinator());

create or replace function public.can_access_similarity_analysis(p_analysis_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_coordinator() and exists (
    select 1 from public.similarity_analyses a where a.id = p_analysis_id
  );
$$;

-- 3) Lectura segura de análisis institucional --------------------------------
create or replace function public.get_internal_similarity_safe(
  p_target_version_id uuid default null,
  p_analysis_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_analysis public.similarity_analyses%rowtype;
  v_owner uuid;
  v_is_staff boolean;
  v_sources jsonb;
  v_adjustment jsonb;
begin
  if v_user is null then raise exception 'Sesión no válida'; end if;
  if p_target_version_id is null and p_analysis_id is null then
    raise exception 'Debes indicar una versión o un análisis';
  end if;

  if p_analysis_id is not null then
    select * into v_analysis from public.similarity_analyses where id = p_analysis_id;
  else
    select * into v_analysis
    from public.similarity_analyses
    where target_version_id = p_target_version_id
    order by created_at desc
    limit 1;
  end if;

  if not found then return null; end if;

  select d.owner_id into v_owner
  from public.documents d
  where d.id = v_analysis.target_document_id;

  v_is_staff := public.is_coordinator();
  if not v_is_staff and v_owner <> v_user then raise exception 'Acceso denegado'; end if;

  select coalesce(jsonb_agg(source_payload order by matched_words desc), '[]'::jsonb)
  into v_sources
  from (
    select
      s.matched_words,
      jsonb_build_object(
        'id', s.id,
        'analysis_id', s.analysis_id,
        'source_version_id', case when v_is_staff then s.source_version_id else s.id end,
        'source_document_id', case when v_is_staff then s.source_document_id else s.id end,
        'source_owner_id', case when v_is_staff then s.source_owner_id else '00000000-0000-0000-0000-000000000000'::uuid end,
        'source_title', case when v_is_staff then s.source_title else 'Repositorio institucional' end,
        'source_version_number', case when v_is_staff then s.source_version_number else 1 end,
        'similarity_percent', s.similarity_percent,
        'matched_words', s.matched_words,
        'owner_name', case when v_is_staff then coalesce(p.full_name, 'Usuario institucional') else null end,
        'matches', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', m.id,
              'source_id', m.source_id,
              'match_type', m.match_type,
              'target_start_word', m.target_start_word,
              'target_end_word', m.target_end_word,
              'source_start_word', case when v_is_staff then m.source_start_word else 0 end,
              'source_end_word', case when v_is_staff then m.source_end_word else 1 end,
              'target_excerpt', m.target_excerpt,
              'source_excerpt', case when v_is_staff then m.source_excerpt else 'Coincidencia detectada en el repositorio institucional.' end,
              'similarity_score', m.similarity_score,
              'target_covered_ranges', m.target_covered_ranges
            ) order by m.target_start_word
          )
          from public.similarity_matches m
          where m.source_id = s.id
        ), '[]'::jsonb)
      ) as source_payload
    from public.similarity_sources s
    left join public.profiles p on p.id = s.source_owner_id
    where s.analysis_id = v_analysis.id
  ) q;

  select case when a.analysis_id is null then null else jsonb_build_object(
    'analysis_id', a.analysis_id,
    'exclude_bibliography', a.exclude_bibliography,
    'exclude_quoted_text', a.exclude_quoted_text,
    'min_match_words', a.min_match_words,
    'excluded_source_ids', a.excluded_source_ids,
    'adjusted_similarity_percent', a.adjusted_similarity_percent,
    'adjusted_matched_words', a.adjusted_matched_words,
    'saved_by', case when v_is_staff then a.saved_by else v_user end,
    'updated_at', a.updated_at
  ) end
  into v_adjustment
  from public.similarity_adjustments a
  where a.analysis_id = v_analysis.id;

  return jsonb_build_object(
    'id', v_analysis.id,
    'target_version_id', v_analysis.target_version_id,
    'target_document_id', v_analysis.target_document_id,
    'created_by', case when v_is_staff then v_analysis.created_by else v_user end,
    'algorithm_version', v_analysis.algorithm_version,
    'similarity_percent', v_analysis.similarity_percent,
    'matched_words', v_analysis.matched_words,
    'total_words', v_analysis.total_words,
    'source_count', v_analysis.source_count,
    'released_to_student', v_analysis.released_to_student,
    'created_at', v_analysis.created_at,
    'sources', v_sources,
    'adjustment', v_adjustment
  );
end;
$$;

revoke all on function public.get_internal_similarity_safe(uuid,uuid) from public;
grant execute on function public.get_internal_similarity_safe(uuid,uuid) to authenticated;

comment on function public.get_internal_similarity_safe is 'Entrega análisis institucional completo al staff y una versión anonimizada al estudiante propietario.';
