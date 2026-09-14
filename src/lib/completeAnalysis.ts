import { runAiWritingAnalysis } from './aiWriting';
import { runArticleReview } from './articleReview';
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

  onProgress?.('1/5 · Comparando con el repositorio institucional…');
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

  onProgress?.('2/5 · Buscando en fuentes académicas y web…');
  await runExternalSimilarityAnalysis(version);

  onProgress?.('3/5 · Revisando citas, referencias y APA 7…');
  await runCitationIntegrityAnalysis(version);

  onProgress?.('4/5 · Revisando señales de escritura asistida…');
  await runAiWritingAnalysis(version);

  onProgress?.('Calculando el porcentaje consolidado de similitud…');
  const snapshot = await buildIntegrityReportSnapshot(document, version);
  const consolidated = snapshot.summary.consolidated_similarity_adjusted;
  if (consolidated === null) throw new Error('No fue posible calcular la similitud consolidada.');

  const attempt = await recordAnalysisAttempt(version.id, consolidated, snapshot.provenance);

  let globalReviewCompleted = false;
  onProgress?.('5/5 · Ejecutando revisión global con las IA activas…');
  try {
    await runArticleReview(version.id, attempt.id, consolidated, snapshot);
    globalReviewCompleted = true;
  } catch (error) {
    console.warn('La revisión global no pudo completarse. El antiplagio se conservó:', error);
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('plagguard:article-review-changed'));
  }

  onProgress?.(globalReviewCompleted
    ? 'Análisis integral completado.'
    : 'Antiplagio completado. La revisión global IA quedó pendiente o no está configurada.');

  return { attempt, snapshot, corrections: buildStudentCorrections(snapshot) };
}
