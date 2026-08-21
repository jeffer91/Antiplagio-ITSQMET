-- PlagGuard · ITSQMET - Fase 11
-- Ejecutar DESPUÉS de supabase/phase10.sql.
-- Cierra dos puntos de producción:
-- 1) permite que las Edge Functions existentes validen a un estudiante sin convertirlo en staff;
-- 2) ejecuta la comparación institucional dentro de PostgreSQL para no descargar el repositorio al equipo del estudiante.

-- 1) Compatibilidad segura con las Edge Functions de Fases 5, 6 y 7 ---------
-- Esas funciones hacen una llamada aislada a rpc/is_coordinator antes de conocer la versión.
-- Permitimos que esa LLAMADA DE SONDEO devuelva true a un estudiante. Esto no eleva
-- privilegios en otras consultas: las políticas RLS y los demás RPC se ejecutan en
-- request.path distintos y continúan exigiendo propietario o staff.
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
    )
    or (
      coalesce(current_setting('request.path', true), '') like '%/rpc/is_coordinator'
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role = 'student'::public.app_role
      )
    );
$$;

-- 2) Normalización de texto para el motor institucional ----------------------
create or replace function public.plagguard_tokens(p_text text)
returns text[]
language sql
immutable
parallel safe
as $$
  select coalesce(array_agg(token order by ord), '{}'::text[])
  from (
    select ord, token
    from unnest(
      regexp_split_to_array(
        trim(regexp_replace(lower(coalesce(p_text, '')), '[^[:alnum:]áéíóúüñ]+', ' ', 'g')),
        '\s+'
      )
    ) with ordinality as t(token, ord)
    where char_length(token) > 0
  ) q;
$$;

revoke all on function public.plagguard_tokens(text) from public, authenticated;

-- 3) Comparación institucional server-side ----------------------------------
create or replace function public.run_internal_similarity_secure(p_target_version_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.document_versions%rowtype;
  v_target_tokens text[];
  v_target_count integer;
  v_source record;
  v_source_tokens text[];
  v_source_count integer;
  v_target_starts integer[];
  v_source_starts integer[];
  v_covered integer[];
  v_global_covered integer[] := '{}'::integer[];
  v_matches jsonb;
  v_sources jsonb := '[]'::jsonb;
  v_payload_source jsonb;
  v_run_start integer;
  v_previous integer;
  v_current integer;
  v_run_end integer;
  v_run_length integer;
  v_source_start integer;
  v_match_count integer;
  v_index integer;
  v_similarity numeric;
  v_source_similarity numeric;
  v_analysis_id uuid;
  v_excerpt_target text;
  v_excerpt_source text;
  v_range jsonb;
  v_source_matched integer;
  v_global_matched integer;
  v_max_sources constant integer := 25;
  v_min_words constant integer := 10;
begin
  if auth.uid() is null or not public.can_analyze_version(p_target_version_id) then
    raise exception 'No puedes analizar esta versión';
  end if;

  select * into v_target
  from public.document_versions
  where id = p_target_version_id and extraction_status = 'ready'::public.extraction_status;
  if not found then raise exception 'La versión objetivo no tiene texto listo'; end if;

  v_target_tokens := public.plagguard_tokens(v_target.extracted_text);
  v_target_count := cardinality(v_target_tokens);
  if v_target_count < v_min_words then raise exception 'El documento no tiene suficiente texto analizable'; end if;

  -- Solo se compara contra la versión final Cumple activa de cada trabajo.
  for v_source in
    select dv.id, dv.document_id, dv.version_number, dv.extracted_text
    from public.institutional_repository r
    join public.document_versions dv on dv.id = r.version_id
    where r.active
      and dv.extraction_status = 'ready'::public.extraction_status
      and dv.document_id <> v_target.document_id
      and char_length(trim(dv.extracted_text)) > 0
    order by r.included_at desc
  loop
    v_source_tokens := public.plagguard_tokens(v_source.extracted_text);
    v_source_count := cardinality(v_source_tokens);
    if v_source_count < v_min_words then continue; end if;

    -- Relaciona shingles exactos de 5 palabras. Para frases repetidas se toma
    -- la primera posición de fuente para cada posición objetivo.
    with target_shingles as (
      select i,
             array_to_string(v_target_tokens[i:least(i + 4, v_target_count)], E'\u001f') as shingle
      from generate_series(1, greatest(v_target_count - 4, 0)) i
    ),
    source_shingles as (
      select i,
             array_to_string(v_source_tokens[i:least(i + 4, v_source_count)], E'\u001f') as shingle
      from generate_series(1, greatest(v_source_count - 4, 0)) i
    ),
    pairs as (
      select t.i as target_i, min(s.i) as source_i
      from target_shingles t
      join source_shingles s on s.shingle = t.shingle
      group by t.i
      order by t.i
    )
    select array_agg(target_i order by target_i), array_agg(source_i order by target_i)
    into v_target_starts, v_source_starts
    from pairs;

    if coalesce(cardinality(v_target_starts), 0) = 0 then continue; end if;

    select coalesce(array_agg(distinct word order by word), '{}'::integer[])
    into v_covered
    from (
      select generate_series(start_i, least(start_i + 4, v_target_count)) as word
      from unnest(v_target_starts) start_i
    ) q;

    v_source_matched := cardinality(v_covered);
    if v_source_matched < v_min_words then continue; end if;

    v_matches := '[]'::jsonb;
    v_match_count := 0;
    v_run_start := null;
    v_previous := null;

    for v_index in 1..cardinality(v_covered)
    loop
      v_current := v_covered[v_index];
      if v_run_start is null then
        v_run_start := v_current;
        v_previous := v_current;
        continue;
      end if;

      if v_current = v_previous + 1 then
        v_previous := v_current;
        continue;
      end if;

      v_run_end := v_previous;
      v_run_length := v_run_end - v_run_start + 1;
      if v_run_length >= v_min_words and v_match_count < 20 then
        select min(source_i) into v_source_start
        from unnest(v_target_starts, v_source_starts) as p(target_i, source_i)
        where target_i between greatest(1, v_run_start - 4) and v_run_end;
        v_source_start := greatest(1, coalesce(v_source_start, 1));
        v_excerpt_target := array_to_string(v_target_tokens[greatest(1,v_run_start-4):least(v_target_count,v_run_end+4)], ' ');
        v_excerpt_source := array_to_string(v_source_tokens[greatest(1,v_source_start-4):least(v_source_count,v_source_start+v_run_length+7)], ' ');
        v_range := jsonb_build_array(jsonb_build_array(v_run_start - 1, v_run_end));
        v_matches := v_matches || jsonb_build_array(jsonb_build_object(
          'match_type', 'exact',
          'target_start_word', v_run_start - 1,
          'target_end_word', v_run_end,
          'source_start_word', v_source_start - 1,
          'source_end_word', least(v_source_count, v_source_start + v_run_length - 1),
          'target_excerpt', left(v_excerpt_target, 2000),
          'source_excerpt', left(v_excerpt_source, 2000),
          'similarity_score', 100,
          'target_covered_ranges', v_range
        ));
        v_match_count := v_match_count + 1;
      end if;

      v_run_start := v_current;
      v_previous := v_current;
    end loop;

    -- último rango
    if v_run_start is not null then
      v_run_end := v_previous;
      v_run_length := v_run_end - v_run_start + 1;
      if v_run_length >= v_min_words and v_match_count < 20 then
        select min(source_i) into v_source_start
        from unnest(v_target_starts, v_source_starts) as p(target_i, source_i)
        where target_i between greatest(1, v_run_start - 4) and v_run_end;
        v_source_start := greatest(1, coalesce(v_source_start, 1));
        v_excerpt_target := array_to_string(v_target_tokens[greatest(1,v_run_start-4):least(v_target_count,v_run_end+4)], ' ');
        v_excerpt_source := array_to_string(v_source_tokens[greatest(1,v_source_start-4):least(v_source_count,v_source_start+v_run_length+7)], ' ');
        v_range := jsonb_build_array(jsonb_build_array(v_run_start - 1, v_run_end));
        v_matches := v_matches || jsonb_build_array(jsonb_build_object(
          'match_type', 'exact',
          'target_start_word', v_run_start - 1,
          'target_end_word', v_run_end,
          'source_start_word', v_source_start - 1,
          'source_end_word', least(v_source_count, v_source_start + v_run_length - 1),
          'target_excerpt', left(v_excerpt_target, 2000),
          'source_excerpt', left(v_excerpt_source, 2000),
          'similarity_score', 100,
          'target_covered_ranges', v_range
        ));
      end if;
    end if;

    if jsonb_array_length(v_matches) = 0 then continue; end if;

    v_source_similarity := round((v_source_matched::numeric / greatest(v_target_count,1)) * 100, 2);
    v_payload_source := jsonb_build_object(
      'source_version_id', v_source.id,
      'similarity_percent', least(100, greatest(0, v_source_similarity)),
      'matched_words', v_source_matched,
      'matches', v_matches
    );
    v_sources := v_sources || jsonb_build_array(v_payload_source);

    select coalesce(array_agg(distinct word order by word), '{}'::integer[])
    into v_global_covered
    from unnest(v_global_covered || v_covered) word;

    exit when jsonb_array_length(v_sources) >= v_max_sources;
  end loop;

  v_global_matched := cardinality(v_global_covered);
  v_similarity := round((v_global_matched::numeric / greatest(v_target_count,1)) * 100, 2);

  v_analysis_id := public.save_internal_similarity_analysis_v2(
    p_target_version_id,
    'plagguard-internal-server-v1',
    least(100, greatest(0, v_similarity)),
    v_global_matched,
    v_target_count,
    v_sources
  );

  return v_analysis_id;
end;
$$;

revoke all on function public.run_internal_similarity_secure(uuid) from public;
grant execute on function public.run_internal_similarity_secure(uuid) to authenticated;

comment on function public.run_internal_similarity_secure is 'Compara una versión contra el repositorio institucional final dentro del servidor; no entrega el corpus completo al cliente.';

-- 4) Alertas: al abrir Supletorio se resuelve el aviso de espera --------------
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

  if coalesce(p_supplementary_open, false) then
    -- Los avisos persistentes dejan de mostrarse cuando la condición de espera se resuelve.
    update public.notifications n
    set resolved = true, resolved_at = now()
    where not n.resolved
      and n.kind = 'supplementary_required'
      and (
        exists (
          select 1
          from public.student_enrollments e
          where e.student_id = n.user_id and e.period_id = p_period_id
        )
        or exists (
          select 1 from public.profiles p
          where p.id = n.user_id and p.role in ('coordinator'::public.app_role, 'admin'::public.app_role)
        )
      );
  end if;
end;
$$;

comment on function public.admin_set_period_state is 'Administra apertura de Ordinario/Supletorio y resuelve alertas persistentes cuando Supletorio se habilita.';
