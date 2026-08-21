import { supabase } from './supabase';
import type { AnalysisAttempt } from '../types/plagGuard';

function requireClient() {
  if (!supabase) throw new Error('Supabase no está configurado.');
  return supabase;
}

export async function loadDocumentAttempts(documentId: string): Promise<AnalysisAttempt[]> {
  const client = requireClient();
  const { data, error } = await client
    .from('analysis_attempts')
    .select('id,student_id,period_id,target_document_id,target_version_id,process,attempt_number,consolidated_similarity,status,executed_by,observation,provenance,created_at')
    .eq('target_document_id', documentId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    ...(row as AnalysisAttempt),
    attempt_number: Number(row.attempt_number),
    consolidated_similarity: Number(row.consolidated_similarity),
  }));
}
