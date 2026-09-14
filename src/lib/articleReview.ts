import { supabase } from './supabase';
import type { IntegrityReportSnapshot } from '../types/integrityReport';
import type {
  AiEvaluatorConfig,
  ArticleReviewBundle,
  ArticleReviewRun,
  ArticleReviewerResult,
  ConsolidatedArticleFinding,
} from '../types/articleReview';

function requireClient() {
  if (!supabase) throw new Error('Supabase no está configurado.');
  return supabase;
}

function notifyChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('plagguard:article-review-changed'));
}

function compactIntegrity(snapshot: IntegrityReportSnapshot): Record<string, unknown> {
  const citation = snapshot.citation_integrity;
  const assisted = snapshot.ai_writing;
  return {
    consolidated_similarity_adjusted: snapshot.summary.consolidated_similarity_adjusted,
    internal_similarity_adjusted: snapshot.summary.internal_similarity_adjusted,
    external_similarity_verified: snapshot.summary.external_similarity_verified,
    citation_integrity: citation ? {
      citation_count: citation.citation_count,
      reference_count: citation.reference_count,
      unlinked_citations: citation.unlinked_citation_count,
      references_with_apa_issues: citation.apa_issue_count,
    } : null,
    assisted_writing: assisted ? {
      evidence_score: assisted.evidence_score,
      flagged_word_percent: assisted.flagged_word_percent,
      high_segment_count: assisted.high_segment_count,
      medium_segment_count: assisted.medium_segment_count,
    } : null,
  };
}

export async function runArticleReview(
  versionId: string,
  attemptId: string,
  similarityPercent: number,
  snapshot: IntegrityReportSnapshot,
): Promise<ArticleReviewBundle> {
  const client = requireClient();
  const { data, error } = await client.functions.invoke('article-review', {
    body: {
      target_version_id: versionId,
      analysis_attempt_id: attemptId,
      similarity_percent: similarityPercent,
      integrity_summary: compactIntegrity(snapshot),
    },
  });

  const payload = (data ?? {}) as {
    error?: string;
    run?: ArticleReviewRun;
    findings?: ConsolidatedArticleFinding[];
    reviewers?: ArticleReviewerResult[];
  };
  if (error) throw new Error(payload.error || error.message || 'No fue posible completar la revisión global.');
  if (!payload.run) throw new Error(payload.error || 'La revisión global no devolvió un resultado válido.');
  notifyChanged();
  return {
    run: payload.run,
    findings: payload.findings ?? [],
    reviewers: payload.reviewers ?? [],
  };
}

export async function loadAiEvaluators(): Promise<AiEvaluatorConfig[]> {
  const client = requireClient();
  const { data, error } = await client
    .from('ai_evaluators')
    .select('slot,name,enabled,created_at,updated_at')
    .order('slot', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    ...(row as AiEvaluatorConfig),
    slot: Number(row.slot),
    enabled: Boolean(row.enabled),
  }));
}

export async function setAiEvaluatorEnabled(slot: number, enabled: boolean): Promise<void> {
  const client = requireClient();
  const { error } = await client.rpc('admin_set_ai_evaluator_enabled', {
    p_slot: slot,
    p_enabled: enabled,
  });
  if (error) throw error;
}

export async function setAllAiEvaluatorsEnabled(enabled: boolean): Promise<void> {
  const evaluators = await loadAiEvaluators();
  await Promise.all(evaluators.map((evaluator) => setAiEvaluatorEnabled(evaluator.slot, enabled)));
}

export async function loadLatestArticleReview(): Promise<ArticleReviewBundle | null> {
  const client = requireClient();
  const { data: runData, error: runError } = await client
    .from('article_review_runs')
    .select('id,target_version_id,analysis_attempt_id,requested_by,status,rubric_version,prompt_version,evaluator_count,successful_evaluators,evaluator_slots,similarity_percent,final_score,performance_level,error_message,created_at,completed_at')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (runError) throw runError;
  if (!runData) return null;

  const run = {
    ...(runData as ArticleReviewRun),
    evaluator_count: Number(runData.evaluator_count ?? 0),
    successful_evaluators: Number(runData.successful_evaluators ?? 0),
    similarity_percent: runData.similarity_percent === null ? null : Number(runData.similarity_percent),
    final_score: runData.final_score === null ? null : Number(runData.final_score),
    evaluator_slots: Array.isArray(runData.evaluator_slots) ? runData.evaluator_slots.map(Number) : [],
  } satisfies ArticleReviewRun;

  const [{ data: findingsData, error: findingsError }, { data: reviewerData, error: reviewerError }] = await Promise.all([
    client
      .from('article_review_findings')
      .select('id,run_id,issue_key,criterion,title,severity,page,fragment,explanation,recommendation,deduction,detected_by,detected_by_count,confidence,created_at')
      .eq('run_id', run.id)
      .order('deduction', { ascending: false }),
    client
      .from('article_reviewer_results')
      .select('evaluator_slot,evaluator_name,score,duration_ms,status,findings,error_message')
      .eq('run_id', run.id)
      .order('evaluator_slot', { ascending: true }),
  ]);
  if (findingsError) throw findingsError;
  if (reviewerError) throw reviewerError;

  const findings = (findingsData ?? []).map((row) => ({
    ...(row as ConsolidatedArticleFinding),
    page: row.page === null ? null : Number(row.page),
    deduction: Number(row.deduction ?? 0),
    detected_by: Array.isArray(row.detected_by) ? row.detected_by.map(Number) : [],
    detected_by_count: Number(row.detected_by_count ?? 0),
    confidence: Number(row.confidence ?? 0),
  }));

  const reviewers = (reviewerData ?? []).map((row) => ({
    ...(row as ArticleReviewerResult),
    evaluator_slot: Number(row.evaluator_slot),
    score: row.score === null ? null : Number(row.score),
    duration_ms: row.duration_ms === null ? null : Number(row.duration_ms),
    findings: Array.isArray(row.findings) ? row.findings : [],
  })) as ArticleReviewerResult[];

  return { run, findings, reviewers };
}
