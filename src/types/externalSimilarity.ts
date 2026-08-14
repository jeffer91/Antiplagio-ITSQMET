export type ExternalProvider = 'openalex' | 'core' | 'semantic_scholar' | 'crossref' | 'brave';
export type ExternalVerificationStatus = 'verified' | 'candidate';
export type ExternalVerificationScope = 'full_text' | 'snippet' | 'abstract' | 'metadata';
export type ExternalMatchType = 'exact' | 'near';
export type ExternalCoveredWordRange = [number, number];

export interface ExternalProviderState {
  status: 'ok' | 'disabled' | 'error';
  candidates: number;
  verified: number;
  message?: string;
}

export type ExternalProviderSummary = Partial<Record<ExternalProvider, ExternalProviderState>>;

export interface ExternalSimilarityMatch {
  id?: string;
  source_id?: string;
  match_type: ExternalMatchType;
  target_start_word: number;
  target_end_word: number;
  source_start_word: number;
  source_end_word: number;
  target_excerpt: string;
  source_excerpt: string;
  similarity_score: number;
  target_covered_ranges: ExternalCoveredWordRange[];
}

export interface ExternalSimilaritySource {
  id: string;
  analysis_id: string;
  provider: ExternalProvider;
  provider_source_id: string;
  title: string;
  authors: string[];
  publication_year: number | null;
  doi: string | null;
  url: string | null;
  content_url: string | null;
  license: string | null;
  verification_status: ExternalVerificationStatus;
  verification_scope: ExternalVerificationScope;
  similarity_percent: number;
  matched_words: number;
  metadata: Record<string, unknown>;
  matches: ExternalSimilarityMatch[];
}

export interface ExternalSimilarityAnalysisResult {
  id: string;
  target_version_id: string;
  target_document_id: string;
  created_by: string;
  algorithm_version: string;
  similarity_percent: number;
  matched_words: number;
  total_words: number;
  source_count: number;
  verified_source_count: number;
  candidate_source_count: number;
  provider_summary: ExternalProviderSummary;
  released_to_student: boolean;
  created_at: string;
  sources: ExternalSimilaritySource[];
}
