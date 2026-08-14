import { supabase } from './supabase';
import type { DocumentVersion } from '../types/documents';
import type {
  CitationIntegrityAnalysisResult,
  CitationMentionResult,
  CitationReferenceResult,
} from '../types/citationIntegrity';

function requireClient() {
  if (!supabase) throw new Error('Supabase no está configurado.');
  return supabase;
}

export async function runCitationIntegrityAnalysis(target: DocumentVersion): Promise<CitationIntegrityAnalysisResult> {
  if (target.extraction_status !== 'ready' || !target.extracted_text.trim()) {
    throw new Error('Esta versión no tiene texto listo para revisar citas y bibliografía.');
  }

  const client = requireClient();
  const { data, error } = await client.functions.invoke('citation-integrity', {
    body: { target_version_id: target.id },
  });
  if (error) throw new Error(error.message || 'No fue posible ejecutar la revisión bibliográfica.');

  const analysisId = typeof data?.analysis_id === 'string' ? data.analysis_id : '';
  if (!analysisId) throw new Error('La función de citas no devolvió el identificador del análisis.');

  const result = await loadCitationIntegrityAnalysis(analysisId);
  if (!result) throw new Error('La revisión se guardó, pero no fue posible volver a cargarla.');
  return result;
}

export async function loadLatestCitationIntegrityAnalysis(targetVersionId: string): Promise<CitationIntegrityAnalysisResult | null> {
  const client = requireClient();
  const { data, error } = await client
    .from('citation_integrity_analyses')
    .select('id')
    .eq('target_version_id', targetVersionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return loadCitationIntegrityAnalysis(data.id as string);
}

export async function loadCitationIntegrityAnalysis(analysisId: string): Promise<CitationIntegrityAnalysisResult | null> {
  const client = requireClient();
  const { data: analysis, error } = await client
    .from('citation_integrity_analyses')
    .select('id,target_version_id,target_document_id,created_by,algorithm_version,bibliography_found,bibliography_heading,citation_count,reference_count,linked_citation_count,unlinked_citation_count,ambiguous_citation_count,verified_reference_count,suspicious_reference_count,uncited_reference_count,apa_issue_count,global_issues,released_to_student,created_at')
    .eq('id', analysisId)
    .maybeSingle();
  if (error) throw error;
  if (!analysis) return null;

  const { data: referenceRows, error: referenceError } = await client
    .from('citation_references')
    .select('id,analysis_id,ordinal,raw_reference,author_key,year_label,parsed_title,doi,url,verification_status,verification_provider,external_id,confidence,verified_metadata,apa_issues,cited_in_text_count')
    .eq('analysis_id', analysisId)
    .order('ordinal', { ascending: true });
  if (referenceError) throw referenceError;

  const { data: mentionRows, error: mentionError } = await client
    .from('citation_mentions')
    .select('id,analysis_id,raw_citation,citation_style,author_key,year_label,start_char,end_char,page_number,linked_reference_id,link_status')
    .eq('analysis_id', analysisId)
    .order('start_char', { ascending: true });
  if (mentionError) throw mentionError;

  const references: CitationReferenceResult[] = (referenceRows ?? []).map((row) => ({
    ...(row as Omit<CitationReferenceResult, 'confidence' | 'ordinal' | 'cited_in_text_count' | 'verified_metadata' | 'apa_issues'>),
    ordinal: Number(row.ordinal),
    confidence: Number(row.confidence),
    cited_in_text_count: Number(row.cited_in_text_count),
    verified_metadata: row.verified_metadata && typeof row.verified_metadata === 'object' && !Array.isArray(row.verified_metadata)
      ? row.verified_metadata as Record<string, unknown>
      : {},
    apa_issues: Array.isArray(row.apa_issues) ? row.apa_issues.map(String) : [],
  }));

  const mentions: CitationMentionResult[] = (mentionRows ?? []).map((row) => ({
    ...(row as Omit<CitationMentionResult, 'start_char' | 'end_char' | 'page_number'>),
    start_char: Number(row.start_char),
    end_char: Number(row.end_char),
    page_number: row.page_number === null ? null : Number(row.page_number),
  }));

  return {
    id: analysis.id as string,
    target_version_id: analysis.target_version_id as string,
    target_document_id: analysis.target_document_id as string,
    created_by: analysis.created_by as string,
    algorithm_version: analysis.algorithm_version as string,
    bibliography_found: Boolean(analysis.bibliography_found),
    bibliography_heading: analysis.bibliography_heading as string | null,
    citation_count: Number(analysis.citation_count),
    reference_count: Number(analysis.reference_count),
    linked_citation_count: Number(analysis.linked_citation_count),
    unlinked_citation_count: Number(analysis.unlinked_citation_count),
    ambiguous_citation_count: Number(analysis.ambiguous_citation_count),
    verified_reference_count: Number(analysis.verified_reference_count),
    suspicious_reference_count: Number(analysis.suspicious_reference_count),
    uncited_reference_count: Number(analysis.uncited_reference_count),
    apa_issue_count: Number(analysis.apa_issue_count),
    global_issues: Array.isArray(analysis.global_issues) ? analysis.global_issues.map(String) : [],
    released_to_student: Boolean(analysis.released_to_student),
    created_at: analysis.created_at as string,
    references,
    mentions,
  };
}

export async function setCitationIntegrityRelease(analysisId: string, released: boolean): Promise<void> {
  const client = requireClient();
  const { error } = await client.rpc('set_citation_integrity_release', {
    p_analysis_id: analysisId,
    p_released: released,
  });
  if (error) throw error;
}
