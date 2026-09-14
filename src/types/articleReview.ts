export type ArticleReviewSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface AiEvaluatorConfig {
  slot: number;
  name: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
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
  score: number | null;
  duration_ms: number | null;
  status: 'completed' | 'failed';
  findings: ArticleReviewerFinding[];
  error_message: string | null;
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
