-- SIAI / ITSQMET - Fase 5
-- Ejecutar DESPUÉS de supabase/phase4.sql.
-- Persiste búsqueda de similitud externa sin guardar el texto completo de las fuentes públicas.

create table public.external_similarity_analyses (
  id uuid primary key default gen_random_uuid(),
  target_version_id uuid not null references public.document_versions(id) on delete cascade,
  target_document_id uuid not null references public.documents(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict,
  algorithm_version text not null check (char_length(algorithm_version) between 1 and 100),
  similarity_percent numeric(5,2) not null check (similarity_percent between 0 and 100),
  matched_words integer not null check (matched_words >= 0),
  total_words integer not null check (total_words > 0),
  source_count integer not null default 0 check (source_count >= 0),
  verified_source_count integer not null default 0 check (verified_source_count >= 0),
  candidate_source_count integer not null default 0 check (candidate_source_count >= 0),
  provider_summary jsonb not null default '{}'::jsonb,
  released_to_student boolean not null default false,
  created_at timestamptz not null default now(),
  check (matched_words <= total_words),
  check (jsonb_typeof(provider_summary) = 'object')
);

create table public.external_similarity_sources (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.external_similarity_analyses(id) on delete cascade,
  provider text not null check (provider in ('openalex', 'core', 'semantic_scholar', 'crossref', 'brave')),
  provider_source_id text not null check (char_length(provider_source_id) between 1 and 500),
  title text not null check (char_length(title) between 1 and 1000),
  authors jsonb not null default '[]'::jsonb,
  publication_year integer check (publication_year is null or publication_year between 1000 and 2200),
  doi text,
  url text,
  content_url text,
  license text,
  verification_status text not null check (verification_status in ('verified', 'candidate')),
  verification_scope text not null check (verification_scope in ('full_text', 'snippet', 'abstract', 'metadata')),
  similarity_percent numeric(5,2) not null default 0 check (similarity_percent between 0 and 100),
  matched_words integer not null default 0 check (matched_words >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (analysis_id, provider, provider_source_id),
  check (jsonb_typeof(authors) = 'array'),
  check (jsonb_typeof(metadata) = 'object')
);

create table public.external_similarity_matches (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.external_similarity_sources(id) on delete cascade,
  match_type text not null check (match_type in ('exact', 'near')),
  target_start_word integer not null check (target_start_word >= 0),
  target_end_word integer not null check (target_end_word > target_start_word),
  source_start_word integer not null check (source_start_word >= 0),
  source_end_word integer not null check (source_end_word > source_start_word),
  target_excerpt text not null,
  source_excerpt text not null,
  similarity_score numeric(5,2) not null check (similarity_score between 0 and 100),
  target_covered_ranges jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  check (char_length(target_excerpt) <= 2500),
  check (char_length(source_excerpt) <= 2500),
  check (jsonb_typeof(target_covered_ranges) = 'array')
);

-- Índice reutilizable. No almacena texto completo externo: únicamente hashes ordenados de shingles.
create table public.external_source_cache (
  cache_key text primary key,
  provider text not null check (provider in ('openalex', 'core', 'semantic_scholar', 'crossref', 'brave')),
  provider_source_id text not null,
  title text not null,
  doi text,
  url text,
  content_fingerprint_sha256 text,
  shingle_hashes jsonb not null default '[]'::jsonb,
  shingle_count integer not null default 0 check (shingle_count >= 0),
  metadata jsonb not null default '{}'::jsonb,
  last_verified_at timestamptz not null default now(),
  check (content_fingerprint_sha256 is null or content_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  check (jsonb_typeof(shingle_hashes) = 'array'),
  check (jsonb_typeof(metadata) = 'object')
);

create index external_similarity_analyses_target_idx on public.external_similarity_analyses(target_version_id, created_at desc);
create index external_similarity_sources_analysis_idx on public.external_similarity_sources(analysis_id, matched_words desc);
create index external_similarity_sources_doi_idx on public.external_similarity_sources(doi) where doi is not null;
create index external_similarity_matches_source_idx on public.external_similarity_matches(source_id, target_start_word);

alter table public.external_similarity_analyses enable row level security;
alter table public.external_similarity_sources enable row level security;
alter table public.external_similarity_matches enable row level security;
alter table public.external_source_cache enable row level security;

grant select on public.external_similarity_analyses to authenticated;
grant select on public.external_similarity_sources to authenticated;
grant select on public.external_similarity_matches to authenticated;
grant select on public.external_source_cache to authenticated;

create policy "external_similarity_analyses_select_coordinator_or_released_owner"
on public.external_similarity_analyses
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
      and (
        public.is_coordinator()
        or (a.released_to_student and d.owner_id = auth.uid())
      )
  );
$$;

revoke all on function public.can_access_external_similarity_analysis(uuid) from public;
grant execute on function public.can_access_external_similarity_analysis(uuid) to authenticated;

create policy "external_similarity_sources_select_accessible_analysis"
on public.external_similarity_sources
for select
to authenticated
using (public.can_access_external_similarity_analysis(analysis_id));

create policy "external_similarity_matches_select_accessible_analysis"
on public.external_similarity_matches
for select
to authenticated
using (
  exists (
    select 1 from public.external_similarity_sources s
    where s.id = source_id
      and public.can_access_external_similarity_analysis(s.analysis_id)
  )
);

create policy "external_source_cache_select_coordinator"
on public.external_source_cache
for select
to authenticated
using (public.is_coordinator());

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
declare
  v_user uuid := auth.uid();
  v_target_document_id uuid;
  v_target_status public.extraction_status;
  v_analysis_id uuid;
  v_source jsonb;
  v_match jsonb;
  v_source_row_id uuid;
  v_provider text;
  v_provider_source_id text;
  v_status text;
  v_scope text;
  v_source_count integer := 0;
  v_verified_count integer := 0;
  v_candidate_count integer := 0;
  v_ranges jsonb;
begin
  if v_user is null or not public.is_coordinator() then
    raise exception 'Solo el coordinador puede guardar análisis externos';
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
     or char_length(trim(p_algorithm_version)) > 100 then
    raise exception 'Versión de algoritmo inválida';
  end if;

  if p_total_words is null or p_total_words <= 0 then
    raise exception 'Total de palabras inválido';
  end if;

  if p_matched_words is null or p_matched_words < 0 or p_matched_words > p_total_words then
    raise exception 'Cantidad de palabras coincidentes inválida';
  end if;

  if p_similarity_percent is null or p_similarity_percent < 0 or p_similarity_percent > 100 then
    raise exception 'Porcentaje externo inválido';
  end if;

  if p_provider_summary is null or jsonb_typeof(p_provider_summary) <> 'object' then
    raise exception 'Resumen de proveedores inválido';
  end if;

  if p_sources is null or jsonb_typeof(p_sources) <> 'array' then
    raise exception 'Las fuentes externas deben enviarse como un arreglo';
  end if;

  insert into public.external_similarity_analyses (
    target_version_id, target_document_id, created_by, algorithm_version,
    similarity_percent, matched_words, total_words, provider_summary
  ) values (
    p_target_version_id, v_target_document_id, v_user, trim(p_algorithm_version),
    round(p_similarity_percent, 2), p_matched_words, p_total_words, p_provider_summary
  ) returning id into v_analysis_id;

  for v_source in select value from jsonb_array_elements(p_sources)
  loop
    v_provider := coalesce(v_source ->> 'provider', '');
    if v_provider not in ('openalex', 'core', 'semantic_scholar', 'crossref', 'brave') then
      continue;
    end if;

    v_provider_source_id := left(trim(coalesce(v_source ->> 'provider_source_id', '')), 500);
    if char_length(v_provider_source_id) < 1 then
      continue;
    end if;

    v_status := case when v_source ->> 'verification_status' = 'verified' then 'verified' else 'candidate' end;
    v_scope := case
      when v_source ->> 'verification_scope' = 'full_text' then 'full_text'
      when v_source ->> 'verification_scope' = 'snippet' then 'snippet'
      when v_source ->> 'verification_scope' = 'abstract' then 'abstract'
      else 'metadata'
    end;

    v_source_row_id := null;
    insert into public.external_similarity_sources (
      analysis_id, provider, provider_source_id, title, authors, publication_year,
      doi, url, content_url, license, verification_status, verification_scope,
      similarity_percent, matched_words, metadata
    ) values (
      v_analysis_id,
      v_provider,
      v_provider_source_id,
      left(coalesce(nullif(trim(v_source ->> 'title'), ''), 'Fuente externa sin título'), 1000),
      case when jsonb_typeof(v_source -> 'authors') = 'array' then v_source -> 'authors' else '[]'::jsonb end,
      case
        when (v_source ->> 'publication_year') ~ '^\d{4}$'
         and (v_source ->> 'publication_year')::integer between 1000 and 2200
        then (v_source ->> 'publication_year')::integer
        else null
      end,
      nullif(left(trim(coalesce(v_source ->> 'doi', '')), 500), ''),
      nullif(v_source ->> 'url', ''),
      nullif(v_source ->> 'content_url', ''),
      nullif(left(coalesce(v_source ->> 'license', ''), 300), ''),
      v_status,
      v_scope,
      least(100, greatest(0, coalesce((v_source ->> 'similarity_percent')::numeric, 0))),
      greatest(0, coalesce((v_source ->> 'matched_words')::integer, 0)),
      case when jsonb_typeof(v_source -> 'metadata') = 'object' then v_source -> 'metadata' else '{}'::jsonb end
    )
    on conflict (analysis_id, provider, provider_source_id) do nothing
    returning id into v_source_row_id;

    if v_source_row_id is null then
      continue;
    end if;

    v_source_count := v_source_count + 1;
    if v_status = 'verified' then
      v_verified_count := v_verified_count + 1;
    else
      v_candidate_count := v_candidate_count + 1;
    end if;

    if v_status = 'verified' and jsonb_typeof(coalesce(v_source -> 'matches', '[]'::jsonb)) = 'array' then
      for v_match in select value from jsonb_array_elements(coalesce(v_source -> 'matches', '[]'::jsonb))
      loop
        v_ranges := case
          when jsonb_typeof(v_match -> 'target_covered_ranges') = 'array'
          then v_match -> 'target_covered_ranges'
          else '[]'::jsonb
        end;

        insert into public.external_similarity_matches (
          source_id, match_type,
          target_start_word, target_end_word,
          source_start_word, source_end_word,
          target_excerpt, source_excerpt,
          similarity_score, target_covered_ranges
        ) values (
          v_source_row_id,
          case when v_match ->> 'match_type' = 'exact' then 'exact' else 'near' end,
          greatest(0, coalesce((v_match ->> 'target_start_word')::integer, 0)),
          greatest(1, coalesce((v_match ->> 'target_end_word')::integer, 1)),
          greatest(0, coalesce((v_match ->> 'source_start_word')::integer, 0)),
          greatest(1, coalesce((v_match ->> 'source_end_word')::integer, 1)),
          left(coalesce(v_match ->> 'target_excerpt', ''), 2500),
          left(coalesce(v_match ->> 'source_excerpt', ''), 2500),
          least(100, greatest(0, coalesce((v_match ->> 'similarity_score')::numeric, 0))),
          v_ranges
        );
      end loop;
    end if;
  end loop;

  update public.external_similarity_analyses
  set source_count = v_source_count,
      verified_source_count = v_verified_count,
      candidate_source_count = v_candidate_count
  where id = v_analysis_id;

  return v_analysis_id;
end;
$$;

revoke all on function public.save_external_similarity_analysis(uuid,text,numeric,integer,integer,jsonb,jsonb) from public;
grant execute on function public.save_external_similarity_analysis(uuid,text,numeric,integer,integer,jsonb,jsonb) to authenticated;

create or replace function public.upsert_external_source_cache(
  p_cache_key text,
  p_provider text,
  p_provider_source_id text,
  p_title text,
  p_doi text,
  p_url text,
  p_content_fingerprint_sha256 text,
  p_shingle_hashes jsonb,
  p_metadata jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_coordinator() then
    raise exception 'Solo el coordinador puede actualizar el índice externo';
  end if;

  if p_provider not in ('openalex', 'core', 'semantic_scholar', 'crossref', 'brave') then
    raise exception 'Proveedor inválido';
  end if;

  if char_length(trim(coalesce(p_cache_key, ''))) < 1 then
    raise exception 'Clave de caché inválida';
  end if;

  if p_content_fingerprint_sha256 is not null
     and p_content_fingerprint_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Huella de contenido inválida';
  end if;

  if p_shingle_hashes is null or jsonb_typeof(p_shingle_hashes) <> 'array' then
    raise exception 'Índice de shingles inválido';
  end if;

  insert into public.external_source_cache (
    cache_key, provider, provider_source_id, title, doi, url,
    content_fingerprint_sha256, shingle_hashes, shingle_count, metadata, last_verified_at
  ) values (
    left(trim(p_cache_key), 1000), p_provider, left(p_provider_source_id, 500), left(p_title, 1000),
    nullif(left(coalesce(p_doi, ''), 500), ''), nullif(p_url, ''), p_content_fingerprint_sha256,
    p_shingle_hashes, jsonb_array_length(p_shingle_hashes),
    case when jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) = 'object' then coalesce(p_metadata, '{}'::jsonb) else '{}'::jsonb end,
    now()
  )
  on conflict (cache_key) do update
  set provider = excluded.provider,
      provider_source_id = excluded.provider_source_id,
      title = excluded.title,
      doi = excluded.doi,
      url = excluded.url,
      content_fingerprint_sha256 = excluded.content_fingerprint_sha256,
      shingle_hashes = excluded.shingle_hashes,
      shingle_count = excluded.shingle_count,
      metadata = excluded.metadata,
      last_verified_at = now();
end;
$$;

revoke all on function public.upsert_external_source_cache(text,text,text,text,text,text,text,jsonb,jsonb) from public;
grant execute on function public.upsert_external_source_cache(text,text,text,text,text,text,text,jsonb,jsonb) to authenticated;

create or replace function public.set_external_similarity_release(
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
    raise exception 'Solo el coordinador puede liberar resultados externos';
  end if;

  update public.external_similarity_analyses
  set released_to_student = coalesce(p_released, false)
  where id = p_analysis_id;

  if not found then
    raise exception 'El análisis externo no existe';
  end if;
end;
$$;

revoke all on function public.set_external_similarity_release(uuid,boolean) from public;
grant execute on function public.set_external_similarity_release(uuid,boolean) to authenticated;

comment on table public.external_similarity_analyses is 'Ejecuciones de similitud externa. El porcentaje incluye solo texto efectivamente verificable.';
comment on table public.external_similarity_sources is 'Fuentes públicas encontradas y su estado de verificación. No almacena el texto completo de terceros.';
comment on table public.external_source_cache is 'Índice reutilizable de metadatos y hashes de shingles de fuentes públicas previamente verificadas.';
comment on function public.save_external_similarity_analysis is 'Persiste de forma controlada la evidencia generada por la Edge Function de Fase 5.';
