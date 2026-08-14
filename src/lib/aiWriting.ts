import { supabase } from './supabase';
import type { DocumentVersion } from '../types/documents';
import type {
  AiReviewDecision,
  AiWritingAnalysisResult,
  AiWritingSegment,
  AiWritingSegmentReview,
  AiWritingSignal,
} from '../types/aiWriting';

function requireClient() {
  if (!supabase) throw new Error('Supabase no está configurado.');
  return supabase;
}

function normalizeSignals(value: unknown): AiWritingSignal[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({
      key: String(item.key ?? 'signal'),
      label: String(item.label ?? 'Señal'),
      score: Number(item.score ?? 0),
      weight: Number(item.weight ?? 0),
      detail: String(item.detail ?? ''),
    }));
}

export async function runAiWritingAnalysis(target: DocumentVersion): Promise<AiWritingAnalysisResult> {
  if (target.extraction_status !== 'ready' || !target.extracted_text.trim()) {
    throw new Error('Esta versión no tiene texto listo para analizar.');
  }

  const client = requireClient();
  const { data, error } = await client.functions.invoke('ai-writing-indicators', {
    body: { target_version_id: target.id },
  });
  if (error) throw new Error(error.message || 'No fue posible ejecutar los indicadores de escritura asistida.');

  const analysisId = typeof data?.analysis_id === 'string' ? data.analysis_id : '';
  if (!analysisId) throw new Error('La función no devolvió el identificador del análisis.');

  const result = await loadAiWritingAnalysis(analysisId);
  if (!result) throw new Error('El análisis se guardó, pero no fue posible volver a cargarlo.');
  return result;
}

export async function loadLatestAiWritingAnalysis(targetVersionId: string): Promise<AiWritingAnalysisResult | null> {
  const client = requireClient();
  const { data, error } = await client
    .from('ai_writing_analyses')
    .select('id')
    .eq('target_version_id', targetVersionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return loadAiWritingAnalysis(String(data.id));
}

export async function loadAiWritingAnalysis(analysisId: string): Promise<AiWritingAnalysisResult | null> {
  const client = requireClient();
  const { data: analysis, error } = await client
    .from('ai_writing_analyses')
    .select('id,target_version_id,target_document_id,created_by,algorithm_version,evidence_score,flagged_word_percent,flagged_words,analyzed_words,high_segment_count,medium_segment_count,baseline_source_count,baseline_status,summary,released_to_student,created_at')
    .eq('id', analysisId)
    .maybeSingle();
  if (error) throw error;
  if (!analysis) return null;

  const { data: segmentRows, error: segmentError } = await client
    .from('ai_writing_segments')
    .select('id,analysis_id,segment_index,start_char,end_char,start_word,end_word,word_count,excerpt,evidence_score,risk_level,baseline_distance,previous_overlap_percent,signals,feature_snapshot')
    .eq('analysis_id', analysisId)
    .order('segment_index', { ascending: true });
  if (segmentError) throw segmentError;

  const segmentIds = (segmentRows ?? []).map((row) => String(row.id));
  let reviews: AiWritingSegmentReview[] = [];
  if (segmentIds.length > 0) {
    const { data: reviewRows, error: reviewError } = await client
      .from('ai_writing_segment_reviews')
      .select('segment_id,decision,note,reviewed_by,updated_at')
      .in('segment_id', segmentIds);
    if (reviewError) {
      // Students do not have access to internal review decisions. Their report remains readable.
      reviews = [];
    } else {
      reviews = (reviewRows ?? []) as AiWritingSegmentReview[];
    }
  }

  const segments: AiWritingSegment[] = (segmentRows ?? []).map((row) => ({
    id: String(row.id),
    analysis_id: String(row.analysis_id),
    segment_index: Number(row.segment_index),
    start_char: Number(row.start_char),
    end_char: Number(row.end_char),
    start_word: Number(row.start_word),
    end_word: Number(row.end_word),
    word_count: Number(row.word_count),
    excerpt: String(row.excerpt),
    evidence_score: Number(row.evidence_score),
    risk_level: row.risk_level as AiWritingSegment['risk_level'],
    baseline_distance: row.baseline_distance === null ? null : Number(row.baseline_distance),
    previous_overlap_percent: row.previous_overlap_percent === null ? null : Number(row.previous_overlap_percent),
    signals: normalizeSignals(row.signals),
    feature_snapshot: row.feature_snapshot && typeof row.feature_snapshot === 'object' && !Array.isArray(row.feature_snapshot)
      ? row.feature_snapshot as Record<string, number>
      : {},
    review: reviews.find((review) => review.segment_id === row.id) ?? null,
  }));

  return {
    id: String(analysis.id),
    target_version_id: String(analysis.target_version_id),
    target_document_id: String(analysis.target_document_id),
    created_by: String(analysis.created_by),
    algorithm_version: String(analysis.algorithm_version),
    evidence_score: Number(analysis.evidence_score),
    flagged_word_percent: Number(analysis.flagged_word_percent),
    flagged_words: Number(analysis.flagged_words),
    analyzed_words: Number(analysis.analyzed_words),
    high_segment_count: Number(analysis.high_segment_count),
    medium_segment_count: Number(analysis.medium_segment_count),
    baseline_source_count: Number(analysis.baseline_source_count),
    baseline_status: analysis.baseline_status as AiWritingAnalysisResult['baseline_status'],
    summary: analysis.summary && typeof analysis.summary === 'object' && !Array.isArray(analysis.summary)
      ? analysis.summary as Record<string, unknown>
      : {},
    released_to_student: Boolean(analysis.released_to_student),
    created_at: String(analysis.created_at),
    segments,
  };
}

export async function setAiWritingRelease(analysisId: string, released: boolean): Promise<void> {
  const client = requireClient();
  const { error } = await client.rpc('set_ai_writing_release', {
    p_analysis_id: analysisId,
    p_released: released,
  });
  if (error) throw error;
}

export async function saveAiSegmentReview(
  segmentId: string,
  decision: AiReviewDecision,
  note: string,
): Promise<AiWritingSegmentReview> {
  const client = requireClient();
  const { data, error } = await client.rpc('save_ai_writing_segment_review', {
    p_segment_id: segmentId,
    p_decision: decision,
    p_note: note,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('No fue posible guardar la revisión del fragmento.');
  return row as AiWritingSegmentReview;
}
