-- PlagGuard · ITSQMET - Fase 12
-- Ejecutar DESPUÉS de supabase/phase11.sql.
-- Regla institucional de similitud externa:
--   * una fuente parcial (abstract/snippet/metadata) puede mostrarse como evidencia,
--     pero NO aumenta el porcentaje;
--   * una coincidencia cercana débil se conserva para revisión, pero NO aumenta
--     el porcentaje hasta superar el umbral de evidencia;
--   * el porcentaje guardado se recalcula con cobertura única de palabras.

-- Conserva el wrapper seguro de Fase 10 como implementación interna.
alter function public.save_external_similarity_analysis(uuid,text,numeric,integer,integer,jsonb,jsonb)
  rename to save_external_similarity_analysis_phase10;

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
  v_source jsonb;
  v_match jsonb;
  v_normalized_matches jsonb;
  v_normalized_sources jsonb := '[]'::jsonb;
  v_source_covered integer[];
  v_global_covered integer[] := '{}'::integer[];
  v_ranges jsonb;
  v_range jsonb;
  v_start integer;
  v_end integer;
  v_word integer;
  v_scope text;
  v_status text;
  v_match_type text;
  v_score numeric;
  v_counts boolean;
  v_source_matched integer;
  v_similarity numeric;
  v_result uuid;
  v_metadata jsonb;
begin
  if not public.can_analyze_version(p_target_version_id) then
    raise exception 'No puedes analizar esta versión';
  end if;
  if p_total_words is null or p_total_words <= 0 then
    raise exception 'Total de palabras inválido';
  end if;
  if p_sources is null or jsonb_typeof(p_sources) <> 'array' then
    raise exception 'Fuentes externas inválidas';
  end if;

  for v_source in select value from jsonb_array_elements(p_sources)
  loop
    v_scope := lower(coalesce(v_source->>'verification_scope', 'metadata'));
    v_status := lower(coalesce(v_source->>'verification_status', 'candidate'));
    v_source_covered := '{}'::integer[];
    v_normalized_matches := '[]'::jsonb;

    for v_match in select value from jsonb_array_elements(coalesce(v_source->'matches', '[]'::jsonb))
    loop
      v_match_type := lower(coalesce(v_match->>'match_type', 'near'));
      v_score := coalesce((v_match->>'similarity_score')::numeric, 0);

      -- Exacta a texto completo siempre cuenta. Cercana/paráfrasis solo cuenta
      -- cuando la evidencia es suficientemente fuerte (>= 70/100).
      v_counts := v_status = 'verified'
        and v_scope = 'full_text'
        and (v_match_type = 'exact' or v_score >= 70);

      if v_counts then
        v_ranges := coalesce(v_match->'target_covered_ranges', '[]'::jsonb);
        if jsonb_typeof(v_ranges) <> 'array' or jsonb_array_length(v_ranges) = 0 then
          v_ranges := jsonb_build_array(jsonb_build_array(
            greatest(0, coalesce((v_match->>'target_start_word')::integer, 0)),
            greatest(0, coalesce((v_match->>'target_end_word')::integer, 0))
          ));
        end if;

        for v_range in select value from jsonb_array_elements(v_ranges)
        loop
          if jsonb_typeof(v_range) <> 'array' or jsonb_array_length(v_range) <> 2 then continue; end if;
          v_start := greatest(0, coalesce((v_range->>0)::integer, 0));
          v_end := least(p_total_words, greatest(v_start, coalesce((v_range->>1)::integer, v_start)));
          if v_end <= v_start then continue; end if;
          for v_word in v_start..(v_end - 1)
          loop
            v_source_covered := array_append(v_source_covered, v_word);
            v_global_covered := array_append(v_global_covered, v_word);
          end loop;
        end loop;

        v_normalized_matches := v_normalized_matches || jsonb_build_array(
          jsonb_set(v_match, '{plagguard_counts}', 'true'::jsonb, true)
        );
      else
        -- Se conserva el fragmento para que estudiante/coordinador sepan qué revisar,
        -- pero una cobertura [0,0] evita que el consolidado lo contabilice.
        v_match := jsonb_set(v_match, '{target_covered_ranges}', '[[0,0]]'::jsonb, true);
        v_match := jsonb_set(v_match, '{plagguard_counts}', 'false'::jsonb, true);
        v_normalized_matches := v_normalized_matches || jsonb_build_array(v_match);
      end if;
    end loop;

    select coalesce(array_agg(distinct item order by item), '{}'::integer[])
      into v_source_covered from unnest(v_source_covered) item;
    v_source_matched := cardinality(v_source_covered);

    v_source := jsonb_set(v_source, '{matches}', v_normalized_matches, true);
    v_source := jsonb_set(v_source, '{matched_words}', to_jsonb(v_source_matched), true);
    v_source := jsonb_set(
      v_source,
      '{similarity_percent}',
      to_jsonb(round((v_source_matched::numeric / greatest(p_total_words,1)) * 100, 2)),
      true
    );

    if v_status = 'verified' and v_scope <> 'full_text' then
      v_metadata := coalesce(v_source->'metadata', '{}'::jsonb)
        || jsonb_build_object(
          'plagguard_verification', 'partial',
          'plagguard_counts_in_similarity', false
        );
      v_source := jsonb_set(v_source, '{metadata}', v_metadata, true);
    end if;

    v_normalized_sources := v_normalized_sources || jsonb_build_array(v_source);
  end loop;

  select coalesce(array_agg(distinct item order by item), '{}'::integer[])
    into v_global_covered from unnest(v_global_covered) item;

  p_matched_words := cardinality(v_global_covered);
  v_similarity := round((p_matched_words::numeric / greatest(p_total_words,1)) * 100, 2);

  v_result := public.save_external_similarity_analysis_phase10(
    p_target_version_id,
    p_algorithm_version || '+plagguard-policy-v1',
    least(100, greatest(0, v_similarity)),
    p_matched_words,
    p_total_words,
    p_provider_summary,
    v_normalized_sources
  );
  return v_result;
end;
$$;

revoke all on function public.save_external_similarity_analysis(uuid,text,numeric,integer,integer,jsonb,jsonb) from public;
grant execute on function public.save_external_similarity_analysis(uuid,text,numeric,integer,integer,jsonb,jsonb) to authenticated;
revoke all on function public.save_external_similarity_analysis_phase10(uuid,text,numeric,integer,integer,jsonb,jsonb) from public, authenticated;

comment on function public.save_external_similarity_analysis is 'Aplica política PlagGuard: parcial no cuenta; similitud cercana débil queda como alerta; cobertura externa se guarda sin doble conteo.';
