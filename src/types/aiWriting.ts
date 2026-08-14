export type AiRiskLevel = 'low' | 'medium' | 'high';
export type AiReviewDecision = 'unreviewed' | 'review' | 'request_explanation' | 'dismissed';

export interface AiWritingSignal {
  key: string;
  label: string;
  score: number;
  weight: number;
  detail: string;
}

export interface AiWritingSegmentReview {
  segment_id: string;
  decision: AiReviewDecision;
  note: string | null;
  reviewed_by: string;
  updated_at: string;
}

export interface AiWritingSegment {
  id: string;
  analysis_id: string;
  segment_index: number;
  start_char: number;
  end_char: number;
  start_word: number;
  end_word: number;
  word_count: number;
  excerpt: string;
  evidence_score: number;
  risk_level: AiRiskLevel;
  baseline_distance: number | null;
  previous_overlap_percent: number | null;
  signals: AiWritingSignal[];
  feature_snapshot: Record<string, number>;
  review: AiWritingSegmentReview | null;
}

export interface AiWritingAnalysisResult {
  id: string;
  target_version_id: string;
  target_document_id: string;
  created_by: string;
  algorithm_version: string;
  evidence_score: number;
  flagged_word_percent: number;
  flagged_words: number;
  analyzed_words: number;
  high_segment_count: number;
  medium_segment_count: number;
  baseline_source_count: number;
  baseline_status: 'student_history' | 'document_internal' | 'limited';
  summary: Record<string, unknown>;
  released_to_student: boolean;
  created_at: string;
  segments: AiWritingSegment[];
}
