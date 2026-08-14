export type CitationVerificationStatus = 'verified' | 'probable' | 'not_found' | 'incomplete';
export type CitationVerificationProvider = 'crossref' | 'openalex' | null;
export type CitationStyle = 'parenthetical' | 'narrative';
export type CitationLinkStatus = 'linked' | 'unlinked' | 'ambiguous';

export interface CitationReferenceResult {
  id: string;
  analysis_id: string;
  ordinal: number;
  raw_reference: string;
  author_key: string | null;
  year_label: string | null;
  parsed_title: string | null;
  doi: string | null;
  url: string | null;
  verification_status: CitationVerificationStatus;
  verification_provider: CitationVerificationProvider;
  external_id: string | null;
  confidence: number;
  verified_metadata: Record<string, unknown>;
  apa_issues: string[];
  cited_in_text_count: number;
}

export interface CitationMentionResult {
  id: string;
  analysis_id: string;
  raw_citation: string;
  citation_style: CitationStyle;
  author_key: string;
  year_label: string;
  start_char: number;
  end_char: number;
  page_number: number | null;
  linked_reference_id: string | null;
  link_status: CitationLinkStatus;
}

export interface CitationIntegrityAnalysisResult {
  id: string;
  target_version_id: string;
  target_document_id: string;
  created_by: string;
  algorithm_version: string;
  bibliography_found: boolean;
  bibliography_heading: string | null;
  citation_count: number;
  reference_count: number;
  linked_citation_count: number;
  unlinked_citation_count: number;
  ambiguous_citation_count: number;
  verified_reference_count: number;
  suspicious_reference_count: number;
  uncited_reference_count: number;
  apa_issue_count: number;
  global_issues: string[];
  released_to_student: boolean;
  created_at: string;
  references: CitationReferenceResult[];
  mentions: CitationMentionResult[];
}
