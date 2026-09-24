import { runAiSemanticSimilarityAnalysis } from './aiWriting';
import { runCitationIntegrityAnalysis } from './citationIntegrity';
import { runExternalSimilarityAnalysis } from './externalSimilarity';
import { buildIntegrityReportSnapshot } from './integrityReport';
import { buildStudentCorrections, recordAnalysisAttempt, type CompleteAnalysisResult } from './plagGuard';
import { runSecureInternalSimilarityAnalysis } from './secureInternalSimilarity';
import { saveSimilarityAdjustment } from './similarity';
import { buildSimilarityViewModel } from './similarityView';
import type { DocumentListItem, DocumentVersion } from '../types/documents';

export async function runPlagGuardAttempt(
  document: DocumentListItem,
  version: DocumentVersion,
  onProgress?: (message: string) => void,
): Promise<CompleteAnalysisResult> {
  if (version.extraction_status !== 'ready') {
    throw new Error('El archivo no tiene texto listo para analizar.');
  }

  onProgress?.('1/4 · Comparando con el repositorio institucional…');
  const internal = await runSecureInternalSimilarityAnalysis(version);
  const automaticFilters = {
    exclude_bibliography: true,
    exclude_quoted_text: true,
    min_match_words: 10,
    excluded_source_ids: [] as string[],
  };
  const internalView = buildSimilarityViewModel(version.extracted_text, internal, automaticFilters);
  await saveSimilarityAdjustment(
    internal.id,
    automaticFilters,
    internalView.adjustedSimilarityPercent,
    internalView.adjustedMatchedWords,
  );

  onProgress?.('2/4 · Buscando fuentes y verificando similitud semántica con IA…');
  await runExternalSimilarityAnalysis(version);

  onProgress?.('3/4 · Revisando citas, referencias y exclusiones…');
  await runCitationIntegrityAnalysis(version);

  // Este módulo conserva la trazabilidad histórica del cuarto análisis,
  // pero ahora registra exclusivamente evidencia semántica de plagio
  // ya vinculada a fuentes reales localizadas por la búsqueda externa.
  onProgress?.('4/4 · Registrando evidencia semántica de plagio…');
  await runAiSemanticSimilarityAnalysis(version);

  onProgress?.('Calculando el porcentaje consolidado de similitud…');
  const snapshot = await buildIntegrityReportSnapshot(document, version);
  const consolidated = snapshot.summary.consolidated_similarity_adjusted;
  if (consolidated === null) throw new Error('No fue posible calcular la similitud consolidada.');

  const attempt = await recordAnalysisAttempt(version.id, consolidated, snapshot.provenance);

  onProgress?.('Análisis de plagio completado.');
  return { attempt, snapshot, corrections: buildStudentCorrections(snapshot) };
}
