import { supabase } from './supabase';
import type { DocumentVersion } from '../types/documents';
import type {
  ExternalProviderSummary,
  ExternalSimilarityAnalysisResult,
  ExternalSimilarityMatch,
  ExternalSimilaritySource,
} from '../types/externalSimilarity';

function requireClient() {
  if (!supabase) throw new Error('Supabase no está configurado.');
  return supabase;
}

function normalizeProviderSummary(value: unknown): ExternalProviderSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as ExternalProviderSummary;
}

export async function runExternalSimilarityAnalysis(target: DocumentVersion): Promise<ExternalSimilarityAnalysisResult> {
  if (target.extraction_status !== 'ready' || !target.extracted_text.trim()) {
    throw new Error('Esta versión no tiene texto listo para una búsqueda externa.');
  }

  const client = requireClient();
  const { data, error } = await client.functions.invoke('external-similarity', {
    body: { target_version_id: target.id },
  });
  if (error) throw new Error(error.message || 'No fue posible ejecutar la búsqueda externa.');

  const analysisId = typeof data?.analysis_id === 'string' ? data.analysis_id : '';
  if (!analysisId) throw new Error('La función externa no devolvió el identificador del análisis.');

  const result = await loadExternalSimilarityAnalysis(analysisId);
  if (!result) throw new Error('El análisis externo se guardó, pero no fue posible volver a cargarlo.');
  return result;
}

export async function loadLatestExternalSimilarityAnalysis(targetVersionId: string): Promise<ExternalSimilarityAnalysisResult | null> {
  const client = requireClient();
  const { data, error } = await client
    .from('external_similarity_analyses')
    .select('id')
    .eq('target_version_id', targetVersionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return loadExternalSimilarityAnalysis(data.id as string);
}

export async function loadExternalSimilarityAnalysis(analysisId: string): Promise<ExternalSimilarityAnalysisResult | null> {
  const client = requireClient();
  const { data: analysis, error } = await client
    .from('external_similarity_analyses')
    .select('id,target_version_id,target_document_id,created_by,algorithm_version,similarity_percent,matched_words,total_words,source_count,verified_source_count,candidate_source_count,provider_summary,released_to_student,created_at')
    .eq('id', analysisId)
    .maybeSingle();
  if (error) throw error;
  if (!analysis) return null;

  const { data: sourceRows, error: sourceError } = await client
    .from('external_similarity_sources')
    .select('id,analysis_id,provider,provider_source_id,title,authors,publication_year,doi,url,content_url,license,verification_status,verification_scope,similarity_percent,matched_words,metadata')
    .eq('analysis_id', analysisId)
    .order('matched_words', { ascending: false });
  if (sourceError) throw sourceError;

  const sourceIds = (sourceRows ?? []).map((source) => source.id as string);
  let matches: ExternalSimilarityMatch[] = [];
  if (sourceIds.length > 0) {
    const { data: matchRows, error: matchError } = await client
      .from('external_similarity_matches')
      .select('id,source_id,match_type,target_start_word,target_end_word,source_start_word,source_end_word,target_excerpt,source_excerpt,similarity_score,target_covered_ranges')
      .in('source_id', sourceIds)
      .order('target_start_word', { ascending: true });
    if (matchError) throw matchError;
    matches = (matchRows ?? []).map((match) => ({
      ...(match as ExternalSimilarityMatch),
      similarity_score: Number(match.similarity_score),
      target_covered_ranges: Array.isArray(match.target_covered_ranges) ? match.target_covered_ranges : [],
    }));
  }

  const sources: ExternalSimilaritySource[] = (sourceRows ?? []).map((source) => ({
    ...(source as Omit<ExternalSimilaritySource, 'matches' | 'similarity_percent' | 'authors' | 'metadata'>),
    authors: Array.isArray(source.authors) ? source.authors.map(String) : [],
    metadata: source.metadata && typeof source.metadata === 'object' && !Array.isArray(source.metadata)
      ? source.metadata as Record<string, unknown>
      : {},
    publication_year: source.publication_year === null ? null : Number(source.publication_year),
    similarity_percent: Number(source.similarity_percent),
    matched_words: Number(source.matched_words),
    matches: matches.filter((match) => match.source_id === source.id),
  }));

  return {
    id: analysis.id as string,
    target_version_id: analysis.target_version_id as string,
    target_document_id: analysis.target_document_id as string,
    created_by: analysis.created_by as string,
    algorithm_version: analysis.algorithm_version as string,
    similarity_percent: Number(analysis.similarity_percent),
    matched_words: Number(analysis.matched_words),
    total_words: Number(analysis.total_words),
    source_count: Number(analysis.source_count),
    verified_source_count: Number(analysis.verified_source_count),
    candidate_source_count: Number(analysis.candidate_source_count),
    provider_summary: normalizeProviderSummary(analysis.provider_summary),
    released_to_student: Boolean(analysis.released_to_student),
    created_at: analysis.created_at as string,
    sources,
  };
}

export async function setExternalSimilarityRelease(analysisId: string, released: boolean): Promise<void> {
  const client = requireClient();
  const { error } = await client.rpc('set_external_similarity_release', {
    p_analysis_id: analysisId,
    p_released: released,
  });
  if (error) throw error;
}
