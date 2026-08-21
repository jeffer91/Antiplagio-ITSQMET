export type AttemptProcess = 'ordinary' | 'supplementary';
export type AttemptStatus = 'complies' | 'does_not_comply';
export type ProcessStage =
  | 'ordinary'
  | 'ordinary_closed'
  | 'awaiting_supplementary'
  | 'supplementary'
  | 'completed'
  | 'exhausted';

export interface AcademicPeriod {
  id: string;
  name: string;
  similarity_limit: number;
  ordinary_attempts: number;
  supplementary_attempts: number;
  ordinary_open: boolean;
  supplementary_open: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface StudentEnrollment {
  id: string;
  student_id: string;
  period_id: string;
  career: string;
  modality: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface StudentProcessState {
  configured: boolean;
  student_id: string;
  period_id?: string;
  period_name?: string;
  career?: string;
  modality?: string;
  similarity_limit?: number;
  ordinary_limit?: number;
  ordinary_used?: number;
  ordinary_remaining?: number;
  supplementary_limit?: number;
  supplementary_used?: number;
  supplementary_remaining?: number;
  ordinary_open?: boolean;
  supplementary_open?: boolean;
  stage?: ProcessStage;
  complied_attempt_id?: string | null;
  complied_similarity?: number | null;
  complied_at?: string | null;
}

export interface AnalysisAttempt {
  id: string;
  student_id: string;
  period_id: string;
  target_document_id: string;
  target_version_id: string;
  process: AttemptProcess;
  attempt_number: number;
  consolidated_similarity: number;
  status: AttemptStatus;
  executed_by: string;
  observation: string | null;
  provenance: Record<string, unknown>;
  created_at: string;
}

export interface AppNotification {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  message: string;
  resolved: boolean;
  created_at: string;
  resolved_at: string | null;
}

export interface InstitutionalRepositoryEntry {
  id: string;
  document_id: string;
  version_id: string;
  owner_id: string;
  period_id: string;
  active: boolean;
  included_at: string;
  excluded_at: string | null;
  excluded_by: string | null;
  exclusion_reason: string | null;
}
