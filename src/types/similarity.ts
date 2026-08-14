export type SimilarityMatchType = 'exact' | 'near';

export interface SimilarityMatch {
  id?: string;
  source_id?: string;
  match_type: SimilarityMatchType;
  target_start_word: number;
  target_end_word: number;
  source_start_word: number;
  source_end_word: number;
  target_excerpt: string;
  source_excerpt: string;
  similarity_score: number;
}

export interface SimilaritySourceResult {
  id?: string;
  analysis_id?: string;
  source_version_id: string;
  source_document_id: string;
  source_owner_id: string;
  source_title: string;
  source_version_number: number;
  similarity_percent: number;
  matched_words: number;
  owner_name: string | null;
  matches: SimilarityMatch[];
}

export interface SimilarityAnalysisResult {
  id: string;
  target_version_id: string;
  target_document_id: string;
  created_by: string;
  algorithm_version: string;
  similarity_percent: number;
  matched_words: number;
  total_words: number;
  source_count: number;
  released_to_student: boolean;
  created_at: string;
  sources: SimilaritySourceResult[];
}

export type AnalysisStage = 'loading' | 'comparing' | 'saving' | 'done';

export interface AnalysisProgress {
  stage: AnalysisStage;
  current: number;
  total: number;
  message: string;
}
