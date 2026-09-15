export type ArticleReviewSeverity = 'low' | 'medium' | 'high' | 'critical';
export type AiModelStatus =
  | 'unconfigured'
  | 'available'
  | 'degraded'
  | 'rate_limited'
  | 'invalid_credentials'
  | 'model_not_found'
  | 'provider_down'
  | 'error';
export type AiAdapter = 'openai' | 'gemini' | 'cohere' | 'cloudflare' | 'custom';

// Compatibilidad con Fase 28. Los slots históricos no se eliminan.
export interface AiEvaluatorConfig {
  slot: number;
  name: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface AiModelConfig {
  id: string;
  provider: string;
  adapter: AiAdapter;
  display_name: string;
  model_id: string;
  api_url: string | null;
  access_tier: string | null;
  specialty: string | null;
  priority: number;
  enabled: boolean;
  selected_for_review: boolean;
  fallback: boolean;
  supports_vision: boolean;
  max_concurrency: number;
  timeout_ms: number;
  last_status: AiModelStatus;
  last_test_at: string | null;
  last_latency_ms: number | null;
  last_error: string | null;
  credential_configured?: boolean;
  created_at: string;
  updated_at: string;
}

export interface AiModelTestResult {
  model_id: string;
  status: AiModelStatus;
  latency_ms: number;
  error: string | null;
}

export interface ArticleReviewerFinding {
  criterion: string;
  issue_key: string;
  title: string;
  severity: ArticleReviewSeverity;
  page: number | null;
  fragment: string;
  explanation: string;
  recommendation: string;
  deduction: number;
}

export interface ArticleReviewerResult {
  evaluator_slot: number;
  evaluator_name: string;
  model_ref?: string | null;
  provider?: string | null;
  provider_model_id?: string | null;
  adapter?: string | null;
  score: number | null;
  duration_ms: number | null;
  status: 'completed' | 'failed';
  findings: ArticleReviewerFinding[];
  error_message: string | null;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface ConsolidatedArticleFinding {
  id: string;
  run_id: string;
  issue_key: string;
  criterion: string;
  title: string;
  severity: ArticleReviewSeverity;
  page: number | null;
  fragment: string;
  explanation: string;
  recommendation: string;
  deduction: number;
  detected_by: number[];
  detected_by_count: number;
  confidence: number;
  created_at: string;
}

export interface ArticleReviewRun {
  id: string;
  target_version_id: string;
  analysis_attempt_id: string | null;
  requested_by: string;
  status: 'running' | 'completed' | 'partial' | 'failed';
  rubric_version: string;
  prompt_version: string;
  evaluator_count: number;
  successful_evaluators: number;
  evaluator_slots: number[];
  selected_model_ids?: string[];
  successful_model_ids?: string[];
  minimum_consensus?: number;
  minimum_success?: number;
  config_snapshot?: Record<string, unknown>;
  similarity_percent: number | null;
  final_score: number | null;
  performance_level: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface ArticleReviewBundle {
  run: ArticleReviewRun;
  findings: ConsolidatedArticleFinding[];
  reviewers?: ArticleReviewerResult[];
}
