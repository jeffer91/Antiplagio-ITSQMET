export type IntegrityReportFinalStatus = 'pending' | 'approved' | 'observed' | 'correction_required' | 'rejected';

export interface IntegrityReportDocumentSnapshot {
  document_id: string;
  version_id: string;
  title: string;
  owner_name: string;
  owner_email: string;
  version_number: number;
  original_file_name: string;
  sha256: string;
  word_count: number;
  page_count: number | null;
}

export interface IntegrityReportInternalSource {
  title: string;
  version_number: number;
  similarity_percent: number;
  matched_words: number;
  repository_label: string;
  matches: Array<{
    type: 'exact' | 'near';
    score: number;
    target_excerpt: string;
    source_excerpt: string;
  }>;
}

export interface IntegrityReportExternalSource {
  provider: string;
  title: string;
  authors: string[];
  publication_year: number | null;
  doi: string | null;
  url: string | null;
  verification_scope: string;
  similarity_percent: number;
  matched_words: number;
  matches: Array<{
    type: 'exact' | 'near';
    score: number;
    target_excerpt: string;
    source_excerpt: string;
  }>;
}

export interface IntegrityReportReference {
  ordinal: number;
  raw_reference: string;
  status: string;
  provider: string | null;
  confidence: number;
  doi: string | null;
  cited_in_text_count: number;
  apa_issues: string[];
}

export interface IntegrityReportAiSegment {
  segment_index: number;
  evidence_score: number;
  risk_level: 'low' | 'medium' | 'high';
  excerpt: string;
  signals: Array<{ label: string; score: number; detail: string }>;
}

export interface IntegrityReportSnapshot {
  schema_version: string;
  generated_at: string;
  document: IntegrityReportDocumentSnapshot;
  summary: {
    consolidated_similarity_original: number | null;
    consolidated_similarity_adjusted: number | null;
    internal_similarity_original: number | null;
    internal_similarity_adjusted: number | null;
    external_similarity_verified: number | null;
    citation_count: number | null;
    unlinked_citation_count: number | null;
    verified_reference_count: number | null;
    reference_not_found_count: number | null;
    apa_issue_count: number | null;
    ai_evidence_score: number | null;
    ai_flagged_word_percent: number | null;
  };
  internal_similarity: null | {
    analysis_id: string;
    algorithm_version: string;
    analyzed_at: string;
    original_percent: number;
    adjusted_percent: number;
    matched_words: number;
    adjusted_matched_words: number;
    total_words: number;
    filters: {
      exclude_bibliography: boolean;
      exclude_quoted_text: boolean;
      min_match_words: number;
      excluded_source_count: number;
    };
    sources: IntegrityReportInternalSource[];
  };
  external_similarity: null | {
    analysis_id: string;
    algorithm_version: string;
    analyzed_at: string;
    similarity_percent: number;
    matched_words: number;
    total_words: number;
    verified_source_count: number;
    candidate_source_count: number;
    sources: IntegrityReportExternalSource[];
  };
  citation_integrity: null | {
    analysis_id: string;
    algorithm_version: string;
    analyzed_at: string;
    bibliography_found: boolean;
    citation_count: number;
    linked_citation_count: number;
    unlinked_citation_count: number;
    ambiguous_citation_count: number;
    reference_count: number;
    verified_reference_count: number;
    reference_not_found_count: number;
    uncited_reference_count: number;
    apa_issue_count: number;
    global_issues: string[];
    unlinked_citations: string[];
    references: IntegrityReportReference[];
  };
  ai_writing: null | {
    analysis_id: string;
    algorithm_version: string;
    analyzed_at: string;
    evidence_score: number;
    flagged_word_percent: number;
    flagged_words: number;
    analyzed_words: number;
    high_segment_count: number;
    medium_segment_count: number;
    baseline_status: string;
    baseline_source_count: number;
    segments: IntegrityReportAiSegment[];
  };
  provenance: {
    internal_analysis_id: string | null;
    external_analysis_id: string | null;
    citation_analysis_id: string | null;
    ai_analysis_id: string | null;
  };
}

export interface IntegrityReportRecord {
  id: string;
  target_version_id: string;
  target_document_id: string;
  created_by: string;
  report_number: number;
  report_schema_version: string;
  final_status: IntegrityReportFinalStatus;
  final_observation: string | null;
  snapshot: IntegrityReportSnapshot;
  snapshot_sha256: string;
  released_to_student: boolean;
  created_at: string;
}
