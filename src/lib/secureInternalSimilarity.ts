import { loadSimilarityAnalysis } from './similarity';
import { supabase } from './supabase';
import type { DocumentVersion } from '../types/documents';
import type { SimilarityAnalysisResult } from '../types/similarity';

function requireClient() {
  if (!supabase) throw new Error('Supabase no está configurado.');
  return supabase;
}

export async function runSecureInternalSimilarityAnalysis(version: DocumentVersion): Promise<SimilarityAnalysisResult> {
  if (version.extraction_status !== 'ready' || !version.extracted_text.trim()) {
    throw new Error('Esta versión no tiene texto listo para comparar.');
  }

  const client = requireClient();
  const { data, error } = await client.rpc('run_internal_similarity_secure', {
    p_target_version_id: version.id,
  });
  if (error) throw error;

  const analysisId = typeof data === 'string' ? data : String(data ?? '');
  if (!analysisId) throw new Error('No fue posible registrar la comparación institucional.');

  const analysis = await loadSimilarityAnalysis(analysisId);
  if (!analysis) throw new Error('La comparación institucional se guardó, pero no pudo volver a cargarse.');
  return analysis;
}
