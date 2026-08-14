-- SIAI / ITSQMET - Fase 7
-- Ejecutar DESPUÉS de supabase/phase6.sql.
-- Persiste indicadores de escritura asistida por IA como evidencia revisable, no como prueba de autoría.

create table public.ai_writing_analyses (
  id uuid primary key default gen_random_uuid(),
  target_version_id uuid not null references public.document_versions(id) on delete cascade,
  target_document_id uuid not null references public.documents(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict,
  algorithm_version text not null check (char_length(algorithm_version) between 1 and 100),
  evidence_score numeric(5,2) not null check (evidence_score between 0 and 100),
  flagged_word_percent numeric(5,2) not null check (flagged_word_percent between 0 and 100),
  flagged_words integer not null default 0 check (flagged_words >= 0),
  analyzed_words integer not null check (analyzed_words > 0),
  high_segment_count integer not null default 0 check (high_segment_count >= 0),
  medium_segment_count integer not null default 0 check (medium_segment_count >= 0),
  baseline_source_count integer not null default 0 check (baseline_source_count >= 0),
  baseline_status text not null check (baseline_status in ('student_history', 'document_internal', 'limited')),
  summary jsonb not null default '{}'::jsonb,
  released_to_student boolean not null default false,
  created_at timestamptz not null default now(),
  check (flagged_words <= analyzed_words),
  check (jsonb_typeof(summary) = 'object')
);

create table public.ai_writing_segments (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.ai_writing_analyses(id) on delete cascade,
  segment_index integer not null check (segment_index >= 0),
  start_char integer not null check (start_char >= 0),
  end_char integer not null check (end_char > start_char),
  start_word integer not null check (start_word >= 0),
  end_word integer not null check (end_word > start_word),
  word_count integer not null check (word_count > 0),
  excerpt text not null check (char_length(excerpt) between 1 and 5000),
  evidence_score numeric(5,2) not null check (evidence_score between 0 and 100),
  risk_level text not null check (risk_level in ('low', 'medium', 'high')),
  baseline_distance numeric(6,2) check (baseline_distance is null or baseline_distance between 0 and 500),
  previous_overlap_percent numeric(5,2) check (previous_overlap_percent is null or previous_overlap_percent between 0 and 100),
  signals jsonb not null default '[]'::jsonb,
  feature_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (analysis_id, segment_index),
  check (jsonb_typeof(signals) = 'array'),
  check (jsonb_typeof(feature_snapshot) = 'object')
);

create table public.ai_writing_segment_reviews (
  segment_id uuid primary key references public.ai_writing_segments(id) on delete cascade,
  decision text not null default 'unreviewed' check (decision in ('unreviewed', 'review', 'request_explanation', 'dismissed')),
  note text check (note is null or char_length(note) <= 2000),
  reviewed_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now()
);

create index ai_writing_analyses_target_idx on public.ai_writing_analyses(target_version_id, created_at desc);
create index ai_writing_segments_analysis_idx on public.ai_writing_segments(analysis_id, segment_index);
create index ai_writing_segments_risk_idx on public.ai_writing_segments(analysis_id, risk_level, evidence_score desc);

alter table public.ai_writing_analyses enable row level security;
alter table public.ai_writing_segments enable row level security;
alter table public.ai_writing_segment_reviews enable row level security;

grant select on public.ai_writing_analyses to authenticated;
grant select on public.ai_writing_segments to authenticated;
grant select on public.ai_writing_segment_reviews to authenticated;

create policy "ai_writing_analyses_select_coordinator_or_released_owner"
on public.ai_writing_analyses
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
      and (
        public.is_coordinator()
        or (a.released_to_student and d.owner_id = auth.uid())
      )
  );
$$;

revoke all on function public.can_access_ai_writing_analysis(uuid) from public;
grant execute on function public.can_access_ai_writing_analysis(uuid) to authenticated;

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
        or (
          a.released_to_student
          and d.owner_id = auth.uid()
          and coalesce(r.decision, 'unreviewed') <> 'dismissed'
        )
      )
  );
$$;

revoke all on function public.can_access_ai_writing_segment(uuid) from public;
grant execute on function public.can_access_ai_writing_segment(uuid) to authenticated;

create policy "ai_writing_segments_select_accessible"
on public.ai_writing_segments
for select
to authenticated
using (public.can_access_ai_writing_segment(id));

create policy "ai_writing_reviews_select_coordinator"
on public.ai_writing_segment_reviews
for select
to authenticated
using (public.is_coordinator());

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
declare
  v_user uuid := auth.uid();
  v_target_document_id uuid;
  v_target_status public.extraction_status;
  v_analysis_id uuid;
  v_segment jsonb;
  v_high_count integer := 0;
  v_medium_count integer := 0;
  v_level text;
begin
  if v_user is null or not public.is_coordinator() then
    raise exception 'Solo el coordinador puede guardar indicadores de escritura asistida';
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

  if p_evidence_score is null or p_evidence_score < 0 or p_evidence_score > 100 then
    raise exception 'Índice de evidencia inválido';
  end if;

  if p_flagged_word_percent is null or p_flagged_word_percent < 0 or p_flagged_word_percent > 100 then
    raise exception 'Porcentaje de texto señalado inválido';
  end if;

  if p_analyzed_words is null or p_analyzed_words <= 0 then
    raise exception 'Cantidad de palabras analizadas inválida';
  end if;

  if p_flagged_words is null or p_flagged_words < 0 or p_flagged_words > p_analyzed_words then
    raise exception 'Cantidad de palabras señaladas inválida';
  end if;

  if p_baseline_source_count is null or p_baseline_source_count < 0 then
    raise exception 'Cantidad de fuentes de línea base inválida';
  end if;

  if p_baseline_status not in ('student_history', 'document_internal', 'limited') then
    raise exception 'Estado de línea base inválido';
  end if;

  if p_summary is null or jsonb_typeof(p_summary) <> 'object' then
    raise exception 'Resumen de análisis inválido';
  end if;

  if p_segments is null or jsonb_typeof(p_segments) <> 'array' then
    raise exception 'Los segmentos deben enviarse como un arreglo';
  end if;

  insert into public.ai_writing_analyses (
    target_version_id, target_document_id, created_by, algorithm_version,
    evidence_score, flagged_word_percent, flagged_words, analyzed_words,
    baseline_source_count, baseline_status, summary
  ) values (
    p_target_version_id, v_target_document_id, v_user, trim(p_algorithm_version),
    round(p_evidence_score, 2), round(p_flagged_word_percent, 2), p_flagged_words, p_analyzed_words,
    p_baseline_source_count, p_baseline_status, p_summary
  ) returning id into v_analysis_id;

  for v_segment in select value from jsonb_array_elements(p_segments)
  loop
    v_level := case
      when v_segment ->> 'risk_level' = 'high' then 'high'
      when v_segment ->> 'risk_level' = 'medium' then 'medium'
      else 'low'
    end;

    insert into public.ai_writing_segments (
      analysis_id, segment_index, start_char, end_char, start_word, end_word,
      word_count, excerpt, evidence_score, risk_level, baseline_distance,
      previous_overlap_percent, signals, feature_snapshot
    ) values (
      v_analysis_id,
      greatest(0, coalesce((v_segment ->> 'segment_index')::integer, 0)),
      greatest(0, coalesce((v_segment ->> 'start_char')::integer, 0)),
      greatest(1, coalesce((v_segment ->> 'end_char')::integer, 1)),
      greatest(0, coalesce((v_segment ->> 'start_word')::integer, 0)),
      greatest(1, coalesce((v_segment ->> 'end_word')::integer, 1)),
      greatest(1, coalesce((v_segment ->> 'word_count')::integer, 1)),
      left(coalesce(nullif(trim(v_segment ->> 'excerpt'), ''), 'Fragmento sin vista previa'), 5000),
      least(100, greatest(0, coalesce((v_segment ->> 'evidence_score')::numeric, 0))),
      v_level,
      case when (v_segment ->> 'baseline_distance') ~ '^\d+(\.\d+)?$'
        then least(500, greatest(0, (v_segment ->> 'baseline_distance')::numeric)) else null end,
      case when (v_segment ->> 'previous_overlap_percent') ~ '^\d+(\.\d+)?$'
        then least(100, greatest(0, (v_segment ->> 'previous_overlap_percent')::numeric)) else null end,
      case when jsonb_typeof(v_segment -> 'signals') = 'array' then v_segment -> 'signals' else '[]'::jsonb end,
      case when jsonb_typeof(v_segment -> 'feature_snapshot') = 'object' then v_segment -> 'feature_snapshot' else '{}'::jsonb end
    );

    if v_level = 'high' then v_high_count := v_high_count + 1; end if;
    if v_level = 'medium' then v_medium_count := v_medium_count + 1; end if;
  end loop;

  update public.ai_writing_analyses
  set high_segment_count = v_high_count,
      medium_segment_count = v_medium_count
  where id = v_analysis_id;

  return v_analysis_id;
end;
$$;

revoke all on function public.save_ai_writing_analysis(uuid,text,numeric,numeric,integer,integer,integer,text,jsonb,jsonb) from public;
grant execute on function public.save_ai_writing_analysis(uuid,text,numeric,numeric,integer,integer,integer,text,jsonb,jsonb) to authenticated;

create or replace function public.set_ai_writing_release(
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
    raise exception 'Solo el coordinador puede liberar el informe de escritura asistida';
  end if;

  update public.ai_writing_analyses
  set released_to_student = coalesce(p_released, false)
  where id = p_analysis_id;

  if not found then
    raise exception 'El análisis no existe';
  end if;
end;
$$;

revoke all on function public.set_ai_writing_release(uuid,boolean) from public;
grant execute on function public.set_ai_writing_release(uuid,boolean) to authenticated;

create or replace function public.save_ai_writing_segment_review(
  p_segment_id uuid,
  p_decision text,
  p_note text
)
returns setof public.ai_writing_segment_reviews
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_clean_decision text;
  v_row public.ai_writing_segment_reviews%rowtype;
begin
  if v_user is null or not public.is_coordinator() then
    raise exception 'Solo el coordinador puede revisar fragmentos';
  end if;

  if not exists (select 1 from public.ai_writing_segments where id = p_segment_id) then
    raise exception 'El fragmento no existe';
  end if;

  v_clean_decision := case
    when p_decision = 'review' then 'review'
    when p_decision = 'request_explanation' then 'request_explanation'
    when p_decision = 'dismissed' then 'dismissed'
    else 'unreviewed'
  end;

  insert into public.ai_writing_segment_reviews (segment_id, decision, note, reviewed_by, updated_at)
  values (
    p_segment_id,
    v_clean_decision,
    nullif(left(trim(coalesce(p_note, '')), 2000), ''),
    v_user,
    now()
  )
  on conflict (segment_id) do update
  set decision = excluded.decision,
      note = excluded.note,
      reviewed_by = excluded.reviewed_by,
      updated_at = now()
  returning * into v_row;

  return next v_row;
end;
$$;

revoke all on function public.save_ai_writing_segment_review(uuid,text,text) from public;
grant execute on function public.save_ai_writing_segment_review(uuid,text,text) to authenticated;

comment on table public.ai_writing_analyses is 'Índices de evidencia de escritura asistida. No representan una probabilidad de autoría por IA.';
comment on table public.ai_writing_segments is 'Fragmentos y señales estilométricas que sustentan el índice de evidencia.';
comment on table public.ai_writing_segment_reviews is 'Decisión humana del coordinador sobre cada fragmento señalado.';
comment on function public.save_ai_writing_analysis is 'Guarda evidencia estilométrica calculada por la Edge Function; solo el coordinador puede ejecutarla.';
