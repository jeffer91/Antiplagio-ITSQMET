import { supabase } from './supabase';
import type { IntegrityReportSnapshot } from '../types/integrityReport';
import type {
  AiEvaluatorConfig,
  AiModelConfig,
  AiModelTestResult,
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

// Compatibilidad con la Fase 28. Se mantiene para datos históricos.
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

async function invokeAiAdmin<T>(body: Record<string, unknown>): Promise<T> {
  const client = requireClient();
  const { data, error } = await client.functions.invoke('ai-admin', { body });
  const payload = (data ?? {}) as { error?: string } & T;
  if (error) throw new Error(payload.error || error.message || 'No fue posible gestionar las IA.');
  if (payload.error) throw new Error(payload.error);
  return payload;
}

export async function loadAiModels(): Promise<{ models: AiModelConfig[]; maxSelected: number }> {
  const payload = await invokeAiAdmin<{ models: AiModelConfig[]; max_selected?: number }>({ action: 'list' });
  return {
    models: (payload.models ?? []).map((model) => ({
      ...model,
      priority: Number(model.priority ?? 0),
      max_concurrency: Number(model.max_concurrency ?? 2),
      timeout_ms: Number(model.timeout_ms ?? 110000),
      last_latency_ms: model.last_latency_ms === null ? null : Number(model.last_latency_ms),
      enabled: Boolean(model.enabled),
      selected_for_review: Boolean(model.selected_for_review),
      fallback: Boolean(model.fallback),
      supports_vision: Boolean(model.supports_vision),
      credential_configured: Boolean(model.credential_configured),
    })),
    maxSelected: Number(payload.max_selected ?? 15),
  };
}

export async function saveAiModel(model: Partial<AiModelConfig>, apiKey?: string): Promise<AiModelConfig> {
  const payload = await invokeAiAdmin<{ model: AiModelConfig }>({
    action: 'upsert',
    model,
    api_key: apiKey?.trim() || undefined,
  });
  return payload.model;
}

export async function testAiModel(modelId: string): Promise<AiModelTestResult> {
  return await invokeAiAdmin<AiModelTestResult>({ action: 'test', model_id: modelId });
}

export async function testAllAiModels(): Promise<AiModelTestResult[]> {
  const payload = await invokeAiAdmin<{ results: AiModelTestResult[] }>({ action: 'test_all' });
  return payload.results ?? [];
}

export async function deleteAiModel(modelId: string): Promise<void> {
  await invokeAiAdmin<{ ok: boolean }>({ action: 'delete', model_id: modelId });
}

const RUN_SELECT_NEW = 'id,target_version_id,analysis_attempt_id,requested_by,status,rubric_version,prompt_version,evaluator_count,successful_evaluators,evaluator_slots,selected_model_ids,successful_model_ids,minimum_consensus,minimum_success,config_snapshot,similarity_percent,final_score,performance_level,error_message,created_at,completed_at';
const RUN_SELECT_LEGACY = 'id,target_version_id,analysis_attempt_id,requested_by,status,rubric_version,prompt_version,evaluator_count,successful_evaluators,evaluator_slots,similarity_percent,final_score,performance_level,error_message,created_at,completed_at';
const REVIEWER_SELECT_NEW = 'evaluator_slot,evaluator_name,model_ref,provider,provider_model_id,adapter,score,duration_ms,status,findings,error_message,started_at,completed_at';
const REVIEWER_SELECT_LEGACY = 'evaluator_slot,evaluator_name,score,duration_ms,status,findings,error_message';

async function findLatestRun(versionId?: string | null, attemptId?: string | null): Promise<Record<string, unknown> | null> {
  const client = requireClient();
  const build = (fields: string) => {
    let query = client
      .from('article_review_runs')
      .select(fields)
      .order('created_at', { ascending: false })
      .limit(1);
    if (versionId) query = query.eq('target_version_id', versionId);
    if (attemptId) query = query.eq('analysis_attempt_id', attemptId);
    return query.maybeSingle();
  };

  const modern = await build(RUN_SELECT_NEW);
  if (!modern.error) return modern.data as Record<string, unknown> | null;

  // Permite desplegar primero el frontend y luego phase29 sin romper la vista del estudiante.
  const legacy = await build(RUN_SELECT_LEGACY);
  if (legacy.error) throw modern.error;
  return legacy.data as Record<string, unknown> | null;
}

export async function loadLatestArticleReview(
  versionId?: string | null,
  attemptId?: string | null,
): Promise<ArticleReviewBundle | null> {
  const client = requireClient();
  const runData = await findLatestRun(versionId, attemptId);
  if (!runData) return null;

  const run = {
    ...(runData as unknown as ArticleReviewRun),
    evaluator_count: Number(runData.evaluator_count ?? 0),
    successful_evaluators: Number(runData.successful_evaluators ?? 0),
    similarity_percent: runData.similarity_percent === null ? null : Number(runData.similarity_percent),
    final_score: runData.final_score === null ? null : Number(runData.final_score),
    evaluator_slots: Array.isArray(runData.evaluator_slots) ? runData.evaluator_slots.map(Number) : [],
    selected_model_ids: Array.isArray(runData.selected_model_ids) ? runData.selected_model_ids.map(String) : [],
    successful_model_ids: Array.isArray(runData.successful_model_ids) ? runData.successful_model_ids.map(String) : [],
    minimum_consensus: runData.minimum_consensus === null || runData.minimum_consensus === undefined ? undefined : Number(runData.minimum_consensus),
    minimum_success: runData.minimum_success === null || runData.minimum_success === undefined ? undefined : Number(runData.minimum_success),
    config_snapshot: runData.config_snapshot && typeof runData.config_snapshot === 'object' ? runData.config_snapshot as Record<string, unknown> : {},
  } satisfies ArticleReviewRun;

  const findingsPromise = client
    .from('article_review_findings')
    .select('id,run_id,issue_key,criterion,title,severity,page,fragment,explanation,recommendation,deduction,detected_by,detected_by_count,confidence,created_at')
    .eq('run_id', run.id)
    .order('deduction', { ascending: false });

  const modernReviewers = await client
    .from('article_reviewer_results')
    .select(REVIEWER_SELECT_NEW)
    .eq('run_id', run.id)
    .order('evaluator_slot', { ascending: true });

  let reviewerRows: Record<string, unknown>[] = [];
  let reviewerError = modernReviewers.error;
  if (!modernReviewers.error) {
    reviewerRows = (modernReviewers.data ?? []) as unknown as Record<string, unknown>[];
  } else {
    const legacyReviewers = await client
      .from('article_reviewer_results')
      .select(REVIEWER_SELECT_LEGACY)
      .eq('run_id', run.id)
      .order('evaluator_slot', { ascending: true });
    reviewerError = legacyReviewers.error;
    reviewerRows = (legacyReviewers.data ?? []) as unknown as Record<string, unknown>[];
  }

  const findingsResult = await findingsPromise;
  if (findingsResult.error) throw findingsResult.error;
  if (reviewerError) throw reviewerError;

  const findings = (findingsResult.data ?? []).map((row) => ({
    ...(row as ConsolidatedArticleFinding),
    page: row.page === null ? null : Number(row.page),
    deduction: Number(row.deduction ?? 0),
    detected_by: Array.isArray(row.detected_by) ? row.detected_by.map(Number) : [],
    detected_by_count: Number(row.detected_by_count ?? 0),
    confidence: Number(row.confidence ?? 0),
  }));

  const reviewers = reviewerRows.map((row) => ({
    ...(row as unknown as ArticleReviewerResult),
    evaluator_slot: Number(row.evaluator_slot),
    score: row.score === null ? null : Number(row.score),
    duration_ms: row.duration_ms === null ? null : Number(row.duration_ms),
    findings: Array.isArray(row.findings) ? row.findings : [],
  })) as ArticleReviewerResult[];

  return { run, findings, reviewers };
}
