import { createClient } from 'npm:@supabase/supabase-js@2';

const ALGORITHM_VERSION = 'siai-semantic-plagiarism-trace-v1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type UnknownRecord = Record<string, unknown>;

interface Token {
  start: number;
  end: number;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function asRecord(value: unknown): UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asNumber(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    const start = match.index ?? 0;
    tokens.push({ start, end: start + match[0].length });
  }
  return tokens;
}

function safeError(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 500);
  return 'No disponible en esta ejecución';
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Método no permitido' }, 405);

  const authorization = request.headers.get('Authorization');
  if (!authorization) return jsonResponse({ error: 'Falta autenticación' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: 'Supabase no está configurado en la función' }, 500);
  }

  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: userData, error: userError } = await caller.auth.getUser();
    if (userError || !userData.user) return jsonResponse({ error: 'Sesión no válida' }, 401);

    const body = asRecord(await request.json());
    const targetVersionId = asString(body.target_version_id);
    if (!targetVersionId) return jsonResponse({ error: 'Falta target_version_id' }, 400);

    const { data: canAnalyze, error: accessError } = await caller.rpc('can_analyze_version', {
      p_version_id: targetVersionId,
    });
    if (accessError || !canAnalyze) {
      return jsonResponse({ error: 'No tienes acceso para analizar esta versión' }, 403);
    }

    const { data: version, error: versionError } = await service
      .from('document_versions')
      .select('id,document_id,extracted_text,word_count,extraction_status')
      .eq('id', targetVersionId)
      .single();
    if (versionError || !version) return jsonResponse({ error: 'La versión objetivo no existe' }, 404);
    if (version.extraction_status !== 'ready') return jsonResponse({ error: 'La versión objetivo no tiene texto listo' }, 400);

    const { data: external, error: externalError } = await service
      .from('external_similarity_analyses')
      .select('id,total_words,provider_summary')
      .eq('target_version_id', targetVersionId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (externalError) throw externalError;
    if (!external) {
      return jsonResponse({ error: 'Análisis incompleto: falta la búsqueda externa previa.' }, 409);
    }

    const providerSummary = asRecord(external.provider_summary);
    const aiState = asRecord(providerSummary.ai_semantic);
    if (asString(aiState.status) !== 'ok') {
      return jsonResponse({ error: 'Análisis incompleto: la verificación semántica con IA no terminó correctamente.' }, 409);
    }

    const { data: sources, error: sourceError } = await service
      .from('external_similarity_sources')
      .select('id,provider,title,verification_scope,metadata')
      .eq('analysis_id', external.id);
    if (sourceError) throw sourceError;

    const semanticSources = (sources ?? []).filter((source) => {
      const metadata = asRecord(source.metadata);
      return metadata.ai_semantic_reviewed === true;
    });
    const sourceById = new Map(semanticSources.map((source) => [String(source.id), source]));
    const sourceIds = [...sourceById.keys()];

    let matches: Array<Record<string, unknown>> = [];
    if (sourceIds.length) {
      const { data: matchRows, error: matchError } = await service
        .from('external_similarity_matches')
        .select('id,source_id,match_type,target_start_word,target_end_word,target_excerpt,source_excerpt,similarity_score')
        .in('source_id', sourceIds)
        .eq('match_type', 'near')
        .order('similarity_score', { ascending: false });
      if (matchError) throw matchError;
      matches = (matchRows ?? []) as Array<Record<string, unknown>>;
    }

    const targetText = asString(version.extracted_text);
    const targetTokens = tokenize(targetText);
    const analyzedWords = Math.max(1, asNumber(external.total_words) || asNumber(version.word_count) || targetTokens.length);
    const covered = new Set<number>();
    const segments: Array<Record<string, unknown>> = [];

    for (const match of matches) {
      const source = sourceById.get(asString(match.source_id));
      if (!source) continue;
      const metadata = asRecord(source.metadata);
      if (metadata.ai_semantic_verified !== true) continue;

      const startWord = Math.max(0, Math.floor(asNumber(match.target_start_word)));
      const endWord = Math.min(targetTokens.length, Math.max(startWord + 1, Math.floor(asNumber(match.target_end_word))));
      if (endWord - startWord < 10 || startWord >= targetTokens.length) continue;
      const score = Math.min(100, Math.max(0, asNumber(match.similarity_score)));
      if (score < 84) continue;

      for (let index = startWord; index < endWord; index += 1) covered.add(index);
      const startChar = targetTokens[startWord]?.start ?? startWord;
      const endChar = targetTokens[endWord - 1]?.end ?? Math.max(startChar + 1, endWord);
      const verificationScope = asString(source.verification_scope);
      const countsInstitutionally = verificationScope === 'full_text';

      segments.push({
        segment_index: segments.length,
        start_char: startChar,
        end_char: Math.max(startChar + 1, endChar),
        start_word: startWord,
        end_word: endWord,
        word_count: endWord - startWord,
        excerpt: asString(match.target_excerpt).slice(0, 5000) || targetText.slice(startChar, endChar).slice(0, 5000),
        evidence_score: score,
        risk_level: score >= 92 ? 'high' : 'medium',
        baseline_distance: null,
        previous_overlap_percent: null,
        signals: [{
          key: 'semantic_source_match',
          label: 'Similitud semántica con fuente externa',
          score,
          weight: 1,
          detail: `${source.provider} · ${source.title} · ${verificationScope || 'alcance no disponible'}`,
        }],
        feature_snapshot: {
          similarity_score: score,
          counts_institutionally: countsInstitutionally ? 1 : 0,
        },
      });
    }

    const flaggedWords = Math.min(analyzedWords, covered.size);
    const flaggedWordPercent = Math.round(flaggedWords / analyzedWords * 10_000) / 100;
    const evidenceScore = segments.length
      ? Math.round(segments.reduce((sum, segment) => sum + asNumber(segment.evidence_score), 0) / segments.length * 100) / 100
      : 0;

    const summary = {
      methodology: 'source_grounded_semantic_similarity',
      external_analysis_id: external.id,
      ai_semantic_status: aiState.status,
      ai_semantic_model: aiState.message ?? null,
      sources_reviewed: semanticSources.length,
      semantic_matches: segments.length,
      probability_claim: false,
      disclaimer: 'La IA solo valida similitud semántica contra fuentes reales localizadas. No evalúa metodología, redacción, calidad académica ni autoría por IA.',
    };

    const { data: analysisId, error: saveError } = await caller.rpc('save_ai_writing_analysis', {
      p_target_version_id: targetVersionId,
      p_algorithm_version: ALGORITHM_VERSION,
      p_evidence_score: evidenceScore,
      p_flagged_word_percent: flaggedWordPercent,
      p_flagged_words: flaggedWords,
      p_analyzed_words: analyzedWords,
      p_baseline_source_count: semanticSources.length,
      p_baseline_status: 'limited',
      p_summary: summary,
      p_segments: segments,
    });
    if (saveError || typeof analysisId !== 'string') {
      throw new Error(saveError?.message || 'No fue posible guardar la trazabilidad semántica');
    }

    return jsonResponse({
      analysis_id: analysisId,
      external_analysis_id: external.id,
      sources_reviewed: semanticSources.length,
      semantic_matches: segments.length,
      semantic_covered_words: flaggedWords,
      semantic_covered_percent: flaggedWordPercent,
    });
  } catch (error) {
    return jsonResponse({ error: safeError(error) }, 500);
  }
});
