-- SIAI / ITSQMET - Fase 4
-- Ejecutar DESPUÉS de supabase/phase3.sql.
-- Agrega evidencia exacta de cobertura y ajustes persistentes del informe interactivo.

alter table public.similarity_matches
add column if not exists target_covered_ranges jsonb;

alter table public.similarity_matches
add constraint similarity_matches_covered_ranges_array
check (target_covered_ranges is null or jsonb_typeof(target_covered_ranges) = 'array')
not valid;

create table public.similarity_adjustments (
  analysis_id uuid primary key references public.similarity_analyses(id) on delete cascade,
  exclude_bibliography boolean not null default false,
  exclude_quoted_text boolean not null default false,
  min_match_words integer not null default 10 check (min_match_words between 10 and 200),
  excluded_source_ids uuid[] not null default '{}'::uuid[],
  adjusted_similarity_percent numeric(5,2) not null check (adjusted_similarity_percent between 0 and 100),
  adjusted_matched_words integer not null check (adjusted_matched_words >= 0),
  saved_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now()
);

alter table public.similarity_adjustments enable row level security;
grant select on public.similarity_adjustments to authenticated;

create policy "similarity_adjustments_select_accessible_analysis"
on public.similarity_adjustments
for select
to authenticated
using (public.can_access_similarity_analysis(analysis_id));

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
declare
  v_user uuid := auth.uid();
  v_target_document_id uuid;
  v_target_status public.extraction_status;
  v_analysis_id uuid;
  v_source jsonb;
  v_match jsonb;
  v_source_version_id uuid;
  v_source_document_id uuid;
  v_source_owner_id uuid;
  v_source_title text;
  v_source_version_number integer;
  v_source_row_id uuid;
  v_source_count integer := 0;
  v_ranges jsonb;
begin
  if v_user is null or not public.is_coordinator() then
    raise exception 'Solo el coordinador puede guardar análisis institucionales';
  end if;

  select dv.document_id, dv.extraction_status
  into v_target_document_id, v_target_status
  from public.document_versions dv
  where dv.id = p_target_version_id;

  if not found then
    raise exception 'La versión objetivo no existe';
  end if;

  if v_target_status <> 'ready'::public.extraction_status then
    raise exception 'La versión objetivo no tiene texto listo';
  end if;

  if char_length(trim(coalesce(p_algorithm_version, ''))) < 1
     or char_length(trim(p_algorithm_version)) > 80 then
    raise exception 'Versión de algoritmo inválida';
  end if;

  if p_total_words is null or p_total_words <= 0 then
    raise exception 'Total de palabras inválido';
  end if;

  if p_matched_words is null or p_matched_words < 0 or p_matched_words > p_total_words then
    raise exception 'Cantidad de palabras coincidentes inválida';
  end if;

  if p_similarity_percent is null or p_similarity_percent < 0 or p_similarity_percent > 100 then
    raise exception 'Porcentaje de similitud inválido';
  end if;

  if p_sources is null or jsonb_typeof(p_sources) <> 'array' then
    raise exception 'Las fuentes deben enviarse como un arreglo JSON';
  end if;

  insert into public.similarity_analyses (
    target_version_id, target_document_id, created_by, algorithm_version,
    similarity_percent, matched_words, total_words, source_count
  ) values (
    p_target_version_id, v_target_document_id, v_user, trim(p_algorithm_version),
    round(p_similarity_percent, 2), p_matched_words, p_total_words, 0
  ) returning id into v_analysis_id;

  for v_source in select value from jsonb_array_elements(p_sources)
  loop
    v_source_version_id := (v_source ->> 'source_version_id')::uuid;

    select dv.document_id, dv.version_number, d.owner_id, d.title
    into v_source_document_id, v_source_version_number, v_source_owner_id, v_source_title
    from public.document_versions dv
    join public.documents d on d.id = dv.document_id
    where dv.id = v_source_version_id
      and dv.extraction_status = 'ready'::public.extraction_status;

    if not found or v_source_document_id = v_target_document_id then
      continue;
    end if;

    v_source_row_id := null;

    insert into public.similarity_sources (
      analysis_id, source_version_id, source_document_id, source_owner_id,
      source_title, source_version_number, similarity_percent, matched_words
    ) values (
      v_analysis_id,
      v_source_version_id,
      v_source_document_id,
      v_source_owner_id,
      v_source_title,
      v_source_version_number,
      least(100, greatest(0, coalesce((v_source ->> 'similarity_percent')::numeric, 0))),
      greatest(0, coalesce((v_source ->> 'matched_words')::integer, 0))
    )
    on conflict (analysis_id, source_document_id) do nothing
    returning id into v_source_row_id;

    if v_source_row_id is null then
      continue;
    end if;

    v_source_count := v_source_count + 1;

    if jsonb_typeof(coalesce(v_source -> 'matches', '[]'::jsonb)) = 'array' then
      for v_match in select value from jsonb_array_elements(coalesce(v_source -> 'matches', '[]'::jsonb))
      loop
        v_ranges := case
          when jsonb_typeof(v_match -> 'target_covered_ranges') = 'array'
          then v_match -> 'target_covered_ranges'
          else null
        end;

        insert into public.similarity_matches (
          source_id, match_type,
          target_start_word, target_end_word,
          source_start_word, source_end_word,
          target_excerpt, source_excerpt, similarity_score,
          target_covered_ranges
        ) values (
          v_source_row_id,
          case when v_match ->> 'match_type' = 'exact' then 'exact' else 'near' end,
          greatest(0, (v_match ->> 'target_start_word')::integer),
          greatest(1, (v_match ->> 'target_end_word')::integer),
          greatest(0, (v_match ->> 'source_start_word')::integer),
          greatest(1, (v_match ->> 'source_end_word')::integer),
          left(coalesce(v_match ->> 'target_excerpt', ''), 2000),
          left(coalesce(v_match ->> 'source_excerpt', ''), 2000),
          least(100, greatest(0, coalesce((v_match ->> 'similarity_score')::numeric, 0))),
          v_ranges
        );
      end loop;
    end if;
  end loop;

  update public.similarity_analyses
  set source_count = v_source_count
  where id = v_analysis_id;

  return v_analysis_id;
end;
$$;

revoke all on function public.save_internal_similarity_analysis_v2(uuid,text,numeric,integer,integer,jsonb) from public;
grant execute on function public.save_internal_similarity_analysis_v2(uuid,text,numeric,integer,integer,jsonb) to authenticated;

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
declare
  v_user uuid := auth.uid();
  v_total_words integer;
  v_clean_source_ids uuid[];
  v_row public.similarity_adjustments%rowtype;
begin
  if v_user is null or not public.is_coordinator() then
    raise exception 'Solo el coordinador puede guardar exclusiones';
  end if;

  select total_words into v_total_words
  from public.similarity_analyses
  where id = p_analysis_id;

  if not found then
    raise exception 'El análisis no existe';
  end if;

  if p_min_match_words is null or p_min_match_words < 10 or p_min_match_words > 200 then
    raise exception 'El mínimo de palabras debe estar entre 10 y 200';
  end if;

  if p_adjusted_similarity_percent is null
     or p_adjusted_similarity_percent < 0
     or p_adjusted_similarity_percent > 100 then
    raise exception 'Porcentaje ajustado inválido';
  end if;

  if p_adjusted_matched_words is null
     or p_adjusted_matched_words < 0
     or p_adjusted_matched_words > v_total_words then
    raise exception 'Cantidad ajustada de palabras inválida';
  end if;

  select coalesce(array_agg(s.id order by s.id), '{}'::uuid[])
  into v_clean_source_ids
  from public.similarity_sources s
  where s.analysis_id = p_analysis_id
    and s.id = any(coalesce(p_excluded_source_ids, '{}'::uuid[]));

  insert into public.similarity_adjustments (
    analysis_id,
    exclude_bibliography,
    exclude_quoted_text,
    min_match_words,
    excluded_source_ids,
    adjusted_similarity_percent,
    adjusted_matched_words,
    saved_by,
    updated_at
  ) values (
    p_analysis_id,
    coalesce(p_exclude_bibliography, false),
    coalesce(p_exclude_quoted_text, false),
    p_min_match_words,
    v_clean_source_ids,
    round(p_adjusted_similarity_percent, 2),
    p_adjusted_matched_words,
    v_user,
    now()
  )
  on conflict (analysis_id) do update
  set exclude_bibliography = excluded.exclude_bibliography,
      exclude_quoted_text = excluded.exclude_quoted_text,
      min_match_words = excluded.min_match_words,
      excluded_source_ids = excluded.excluded_source_ids,
      adjusted_similarity_percent = excluded.adjusted_similarity_percent,
      adjusted_matched_words = excluded.adjusted_matched_words,
      saved_by = excluded.saved_by,
      updated_at = now()
  returning * into v_row;

  return next v_row;
end;
$$;

revoke all on function public.save_similarity_adjustment(uuid,boolean,boolean,integer,uuid[],numeric,integer) from public;
grant execute on function public.save_similarity_adjustment(uuid,boolean,boolean,integer,uuid[],numeric,integer) to authenticated;

comment on table public.similarity_adjustments is 'Filtros y porcentaje ajustado del informe interactivo. Solo el coordinador puede modificarlos.';
comment on function public.save_similarity_adjustment is 'Valida y persiste exclusiones del coordinador sin alterar el resultado original del motor.';
comment on function public.save_internal_similarity_analysis_v2 is 'Guarda análisis institucionales incluyendo rangos exactos de palabras cubiertas para recálculo reproducible.';
