-- SIAI / ITSQMET - Fase 3
-- Ejecutar DESPUÉS de supabase/phase2.sql.
-- Persiste análisis de similitud institucional, fuentes y evidencia por fragmento.

create table public.similarity_analyses (
  id uuid primary key default gen_random_uuid(),
  target_version_id uuid not null references public.document_versions(id) on delete cascade,
  target_document_id uuid not null references public.documents(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict,
  algorithm_version text not null check (char_length(algorithm_version) between 1 and 80),
  similarity_percent numeric(5,2) not null check (similarity_percent between 0 and 100),
  matched_words integer not null check (matched_words >= 0),
  total_words integer not null check (total_words > 0),
  source_count integer not null default 0 check (source_count >= 0),
  released_to_student boolean not null default false,
  created_at timestamptz not null default now(),
  check (matched_words <= total_words)
);

create table public.similarity_sources (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.similarity_analyses(id) on delete cascade,
  source_version_id uuid not null references public.document_versions(id) on delete cascade,
  source_document_id uuid not null references public.documents(id) on delete cascade,
  source_owner_id uuid not null references public.profiles(id) on delete restrict,
  source_title text not null,
  source_version_number integer not null check (source_version_number > 0),
  similarity_percent numeric(5,2) not null check (similarity_percent between 0 and 100),
  matched_words integer not null check (matched_words >= 0),
  created_at timestamptz not null default now(),
  unique (analysis_id, source_document_id)
);

create table public.similarity_matches (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.similarity_sources(id) on delete cascade,
  match_type text not null check (match_type in ('exact', 'near')),
  target_start_word integer not null check (target_start_word >= 0),
  target_end_word integer not null check (target_end_word > target_start_word),
  source_start_word integer not null check (source_start_word >= 0),
  source_end_word integer not null check (source_end_word > source_start_word),
  target_excerpt text not null,
  source_excerpt text not null,
  similarity_score numeric(5,2) not null check (similarity_score between 0 and 100),
  created_at timestamptz not null default now(),
  check (char_length(target_excerpt) <= 2000),
  check (char_length(source_excerpt) <= 2000)
);

create index similarity_analyses_target_idx on public.similarity_analyses(target_version_id, created_at desc);
create index similarity_sources_analysis_idx on public.similarity_sources(analysis_id, matched_words desc);
create index similarity_matches_source_idx on public.similarity_matches(source_id, target_start_word);

alter table public.similarity_analyses enable row level security;
alter table public.similarity_sources enable row level security;
alter table public.similarity_matches enable row level security;

grant select on public.similarity_analyses to authenticated;
grant select on public.similarity_sources to authenticated;
grant select on public.similarity_matches to authenticated;

create policy "similarity_analyses_select_coordinator_or_released_owner"
on public.similarity_analyses
for select
to authenticated
using (
  public.is_coordinator()
  or (
    released_to_student
    and exists (
      select 1 from public.documents d
      where d.id = target_document_id
        and d.owner_id = auth.uid()
    )
  )
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
      and (
        public.is_coordinator()
        or (a.released_to_student and d.owner_id = auth.uid())
      )
  );
$$;

revoke all on function public.can_access_similarity_analysis(uuid) from public;
grant execute on function public.can_access_similarity_analysis(uuid) to authenticated;

create policy "similarity_sources_select_accessible_analysis"
on public.similarity_sources
for select
to authenticated
using (public.can_access_similarity_analysis(analysis_id));

create policy "similarity_matches_select_accessible_analysis"
on public.similarity_matches
for select
to authenticated
using (
  exists (
    select 1 from public.similarity_sources s
    where s.id = source_id
      and public.can_access_similarity_analysis(s.analysis_id)
  )
);

create or replace function public.save_internal_similarity_analysis(
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
        insert into public.similarity_matches (
          source_id, match_type,
          target_start_word, target_end_word,
          source_start_word, source_end_word,
          target_excerpt, source_excerpt, similarity_score
        ) values (
          v_source_row_id,
          case when v_match ->> 'match_type' = 'exact' then 'exact' else 'near' end,
          greatest(0, (v_match ->> 'target_start_word')::integer),
          greatest(1, (v_match ->> 'target_end_word')::integer),
          greatest(0, (v_match ->> 'source_start_word')::integer),
          greatest(1, (v_match ->> 'source_end_word')::integer),
          left(coalesce(v_match ->> 'target_excerpt', ''), 2000),
          left(coalesce(v_match ->> 'source_excerpt', ''), 2000),
          least(100, greatest(0, coalesce((v_match ->> 'similarity_score')::numeric, 0)))
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

revoke all on function public.save_internal_similarity_analysis(uuid,text,numeric,integer,integer,jsonb) from public;
grant execute on function public.save_internal_similarity_analysis(uuid,text,numeric,integer,integer,jsonb) to authenticated;

create or replace function public.set_similarity_release(
  p_analysis_id uuid,
  p_released boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_coordinator() then
    raise exception 'Solo el coordinador puede liberar resultados';
  end if;

  update public.similarity_analyses
  set released_to_student = coalesce(p_released, false)
  where id = p_analysis_id;

  if not found then
    raise exception 'El análisis no existe';
  end if;
end;
$$;

revoke all on function public.set_similarity_release(uuid,boolean) from public;
grant execute on function public.set_similarity_release(uuid,boolean) to authenticated;

comment on table public.similarity_analyses is 'Ejecuciones reproducibles de similitud interna por versión documental.';
comment on table public.similarity_sources is 'Fuentes institucionales agrupadas por trabajo para evitar inflar porcentajes con múltiples versiones.';
comment on table public.similarity_matches is 'Evidencia de fragmentos coincidentes entre el trabajo revisado y una fuente institucional.';
comment on function public.save_internal_similarity_analysis is 'Guarda resultados calculados por el coordinador; no acepta escrituras directas del estudiante.';
