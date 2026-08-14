-- SIAI / ITSQMET - Fase 6
-- Ejecutar DESPUÉS de supabase/phase5.sql.
-- Persiste revisión de citas, referencias, verificación bibliográfica y hallazgos APA 7.

create table public.citation_integrity_analyses (
  id uuid primary key default gen_random_uuid(),
  target_version_id uuid not null references public.document_versions(id) on delete cascade,
  target_document_id uuid not null references public.documents(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict,
  algorithm_version text not null check (char_length(algorithm_version) between 1 and 100),
  bibliography_found boolean not null default false,
  bibliography_heading text,
  citation_count integer not null default 0 check (citation_count >= 0),
  reference_count integer not null default 0 check (reference_count >= 0),
  linked_citation_count integer not null default 0 check (linked_citation_count >= 0),
  unlinked_citation_count integer not null default 0 check (unlinked_citation_count >= 0),
  ambiguous_citation_count integer not null default 0 check (ambiguous_citation_count >= 0),
  verified_reference_count integer not null default 0 check (verified_reference_count >= 0),
  suspicious_reference_count integer not null default 0 check (suspicious_reference_count >= 0),
  uncited_reference_count integer not null default 0 check (uncited_reference_count >= 0),
  apa_issue_count integer not null default 0 check (apa_issue_count >= 0),
  global_issues jsonb not null default '[]'::jsonb,
  released_to_student boolean not null default false,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(global_issues) = 'array')
);

create table public.citation_references (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.citation_integrity_analyses(id) on delete cascade,
  ordinal integer not null check (ordinal > 0),
  raw_reference text not null check (char_length(raw_reference) between 1 and 6000),
  author_key text,
  year_label text,
  parsed_title text,
  doi text,
  url text,
  verification_status text not null check (verification_status in ('verified', 'probable', 'not_found', 'incomplete')),
  verification_provider text check (verification_provider is null or verification_provider in ('crossref', 'openalex')),
  external_id text,
  confidence numeric(5,2) not null default 0 check (confidence between 0 and 100),
  verified_metadata jsonb not null default '{}'::jsonb,
  apa_issues jsonb not null default '[]'::jsonb,
  cited_in_text_count integer not null default 0 check (cited_in_text_count >= 0),
  created_at timestamptz not null default now(),
  unique (analysis_id, ordinal),
  check (jsonb_typeof(verified_metadata) = 'object'),
  check (jsonb_typeof(apa_issues) = 'array')
);

create table public.citation_mentions (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.citation_integrity_analyses(id) on delete cascade,
  raw_citation text not null check (char_length(raw_citation) between 1 and 1000),
  citation_style text not null check (citation_style in ('parenthetical', 'narrative')),
  author_key text not null,
  year_label text not null,
  start_char integer not null check (start_char >= 0),
  end_char integer not null check (end_char > start_char),
  page_number integer check (page_number is null or page_number > 0),
  linked_reference_id uuid references public.citation_references(id) on delete set null,
  link_status text not null check (link_status in ('linked', 'unlinked', 'ambiguous')),
  created_at timestamptz not null default now()
);

create index citation_integrity_target_idx on public.citation_integrity_analyses(target_version_id, created_at desc);
create index citation_references_analysis_idx on public.citation_references(analysis_id, ordinal);
create index citation_references_doi_idx on public.citation_references(doi) where doi is not null;
create index citation_mentions_analysis_idx on public.citation_mentions(analysis_id, start_char);

alter table public.citation_integrity_analyses enable row level security;
alter table public.citation_references enable row level security;
alter table public.citation_mentions enable row level security;

grant select on public.citation_integrity_analyses to authenticated;
grant select on public.citation_references to authenticated;
grant select on public.citation_mentions to authenticated;

create policy "citation_integrity_select_coordinator_or_released_owner"
on public.citation_integrity_analyses
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
      and (
        public.is_coordinator()
        or (a.released_to_student and d.owner_id = auth.uid())
      )
  );
$$;

revoke all on function public.can_access_citation_integrity_analysis(uuid) from public;
grant execute on function public.can_access_citation_integrity_analysis(uuid) to authenticated;

create policy "citation_references_select_accessible_analysis"
on public.citation_references
for select
to authenticated
using (public.can_access_citation_integrity_analysis(analysis_id));

create policy "citation_mentions_select_accessible_analysis"
on public.citation_mentions
for select
to authenticated
using (public.can_access_citation_integrity_analysis(analysis_id));

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
declare
  v_user uuid := auth.uid();
  v_target_document_id uuid;
  v_target_status public.extraction_status;
  v_analysis_id uuid;
  v_reference jsonb;
  v_mention jsonb;
  v_reference_id uuid;
  v_linked_reference_id uuid;
  v_ref_map jsonb := '{}'::jsonb;
  v_ordinal integer;
begin
  if v_user is null or not public.is_coordinator() then
    raise exception 'Solo el coordinador puede guardar análisis de citas';
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

  if p_global_issues is null or jsonb_typeof(p_global_issues) <> 'array' then
    raise exception 'Hallazgos globales inválidos';
  end if;

  if p_references is null or jsonb_typeof(p_references) <> 'array' then
    raise exception 'Las referencias deben enviarse como un arreglo';
  end if;

  if p_mentions is null or jsonb_typeof(p_mentions) <> 'array' then
    raise exception 'Las citas deben enviarse como un arreglo';
  end if;

  insert into public.citation_integrity_analyses (
    target_version_id, target_document_id, created_by, algorithm_version,
    bibliography_found, bibliography_heading, global_issues
  ) values (
    p_target_version_id, v_target_document_id, v_user, trim(p_algorithm_version),
    coalesce(p_bibliography_found, false),
    nullif(left(trim(coalesce(p_bibliography_heading, '')), 300), ''),
    p_global_issues
  ) returning id into v_analysis_id;

  for v_reference in select value from jsonb_array_elements(p_references)
  loop
    v_ordinal := greatest(1, coalesce((v_reference ->> 'ordinal')::integer, 1));
    v_reference_id := null;

    insert into public.citation_references (
      analysis_id, ordinal, raw_reference, author_key, year_label, parsed_title,
      doi, url, verification_status, verification_provider, external_id,
      confidence, verified_metadata, apa_issues
    ) values (
      v_analysis_id,
      v_ordinal,
      left(coalesce(nullif(trim(v_reference ->> 'raw_reference'), ''), 'Referencia sin contenido'), 6000),
      nullif(left(trim(coalesce(v_reference ->> 'author_key', '')), 300), ''),
      nullif(left(trim(coalesce(v_reference ->> 'year_label', '')), 30), ''),
      nullif(left(trim(coalesce(v_reference ->> 'parsed_title', '')), 2000), ''),
      nullif(left(trim(coalesce(v_reference ->> 'doi', '')), 500), ''),
      nullif(v_reference ->> 'url', ''),
      case
        when v_reference ->> 'verification_status' = 'verified' then 'verified'
        when v_reference ->> 'verification_status' = 'probable' then 'probable'
        when v_reference ->> 'verification_status' = 'not_found' then 'not_found'
        else 'incomplete'
      end,
      case
        when v_reference ->> 'verification_provider' = 'crossref' then 'crossref'
        when v_reference ->> 'verification_provider' = 'openalex' then 'openalex'
        else null
      end,
      nullif(left(trim(coalesce(v_reference ->> 'external_id', '')), 1000), ''),
      least(100, greatest(0, coalesce((v_reference ->> 'confidence')::numeric, 0))),
      case when jsonb_typeof(v_reference -> 'verified_metadata') = 'object' then v_reference -> 'verified_metadata' else '{}'::jsonb end,
      case when jsonb_typeof(v_reference -> 'apa_issues') = 'array' then v_reference -> 'apa_issues' else '[]'::jsonb end
    )
    on conflict (analysis_id, ordinal) do nothing
    returning id into v_reference_id;

    if v_reference_id is not null then
      v_ref_map := v_ref_map || jsonb_build_object(v_ordinal::text, v_reference_id::text);
    end if;
  end loop;

  for v_mention in select value from jsonb_array_elements(p_mentions)
  loop
    v_linked_reference_id := null;
    if (v_mention ->> 'reference_ordinal') ~ '^\d+$' then
      if v_ref_map ? (v_mention ->> 'reference_ordinal') then
        v_linked_reference_id := (v_ref_map ->> (v_mention ->> 'reference_ordinal'))::uuid;
      end if;
    end if;

    insert into public.citation_mentions (
      analysis_id, raw_citation, citation_style, author_key, year_label,
      start_char, end_char, page_number, linked_reference_id, link_status
    ) values (
      v_analysis_id,
      left(coalesce(nullif(trim(v_mention ->> 'raw_citation'), ''), 'Cita sin contenido'), 1000),
      case when v_mention ->> 'citation_style' = 'narrative' then 'narrative' else 'parenthetical' end,
      left(coalesce(nullif(trim(v_mention ->> 'author_key'), ''), 'desconocido'), 300),
      left(coalesce(nullif(trim(v_mention ->> 'year_label'), ''), 's.f.'), 30),
      greatest(0, coalesce((v_mention ->> 'start_char')::integer, 0)),
      greatest(1, coalesce((v_mention ->> 'end_char')::integer, 1)),
      case when (v_mention ->> 'page_number') ~ '^\d+$' then greatest(1, (v_mention ->> 'page_number')::integer) else null end,
      v_linked_reference_id,
      case
        when v_mention ->> 'link_status' = 'linked' and v_linked_reference_id is not null then 'linked'
        when v_mention ->> 'link_status' = 'ambiguous' then 'ambiguous'
        else 'unlinked'
      end
    );
  end loop;

  update public.citation_references r
  set cited_in_text_count = (
    select count(*)::integer
    from public.citation_mentions m
    where m.linked_reference_id = r.id
  )
  where r.analysis_id = v_analysis_id;

  update public.citation_integrity_analyses a
  set citation_count = (select count(*)::integer from public.citation_mentions m where m.analysis_id = v_analysis_id),
      reference_count = (select count(*)::integer from public.citation_references r where r.analysis_id = v_analysis_id),
      linked_citation_count = (select count(*)::integer from public.citation_mentions m where m.analysis_id = v_analysis_id and m.link_status = 'linked'),
      unlinked_citation_count = (select count(*)::integer from public.citation_mentions m where m.analysis_id = v_analysis_id and m.link_status = 'unlinked'),
      ambiguous_citation_count = (select count(*)::integer from public.citation_mentions m where m.analysis_id = v_analysis_id and m.link_status = 'ambiguous'),
      verified_reference_count = (select count(*)::integer from public.citation_references r where r.analysis_id = v_analysis_id and r.verification_status = 'verified'),
      suspicious_reference_count = (select count(*)::integer from public.citation_references r where r.analysis_id = v_analysis_id and r.verification_status = 'not_found'),
      uncited_reference_count = (select count(*)::integer from public.citation_references r where r.analysis_id = v_analysis_id and r.cited_in_text_count = 0),
      apa_issue_count = jsonb_array_length(a.global_issues) + coalesce((
        select sum(jsonb_array_length(r.apa_issues))::integer
        from public.citation_references r
        where r.analysis_id = v_analysis_id
      ), 0)
  where a.id = v_analysis_id;

  return v_analysis_id;
end;
$$;

revoke all on function public.save_citation_integrity_analysis(uuid,text,boolean,text,jsonb,jsonb,jsonb) from public;
grant execute on function public.save_citation_integrity_analysis(uuid,text,boolean,text,jsonb,jsonb,jsonb) to authenticated;

create or replace function public.set_citation_integrity_release(
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
    raise exception 'Solo el coordinador puede liberar la revisión bibliográfica';
  end if;

  update public.citation_integrity_analyses
  set released_to_student = coalesce(p_released, false)
  where id = p_analysis_id;

  if not found then
    raise exception 'El análisis no existe';
  end if;
end;
$$;

revoke all on function public.set_citation_integrity_release(uuid,boolean) from public;
grant execute on function public.set_citation_integrity_release(uuid,boolean) to authenticated;

comment on table public.citation_integrity_analyses is 'Revisión reproducible de citas, bibliografía, verificación de fuentes y hallazgos APA.';
comment on table public.citation_references is 'Referencias bibliográficas parseadas y verificadas contra servicios públicos.';
comment on table public.citation_mentions is 'Citas autor-fecha detectadas en el cuerpo y vinculadas con la bibliografía.';
comment on function public.save_citation_integrity_analysis is 'Guarda la evidencia bibliográfica calculada por la Edge Function; solo el coordinador puede ejecutarla.';
