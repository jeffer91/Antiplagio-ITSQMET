import { runAiWritingAnalysis } from './aiWriting';
import { runArticleReview } from './articleReview';
import { runCitationIntegrityAnalysis } from './citationIntegrity';
import { loadDocumentVersion } from './documents';
import { runExternalSimilarityAnalysis } from './externalSimilarity';
import { buildIntegrityReportSnapshot } from './integrityReport';
import { buildStudentCorrections, recordAnalysisAttempt, type CompleteAnalysisResult } from './plagGuard';
import { runSecureInternalSimilarityAnalysis } from './secureInternalSimilarity';
import { saveSimilarityAdjustment } from './similarity';
import { buildSimilarityViewModel } from './similarityView';
import type { DocumentListItem, DocumentVersion, DocumentVersionSummary } from '../types/documents';

export async function runPlagGuardAttempt(
  document: DocumentListItem,
  version: DocumentVersion | DocumentVersionSummary,
  onProgress?: (message: string) => void,
): Promise<CompleteAnalysisResult> {
  if (version.extraction_status !== 'ready') {
    throw new Error('El archivo no tiene texto listo para analizar.');
  }

  const fullVersion: DocumentVersion = 'extracted_text' in version
    ? version
    : await loadDocumentVersion(version.id);

  if (fullVersion.extraction_status !== 'ready' || !fullVersion.extracted_text?.trim()) {
    throw new Error('El archivo no tiene texto completo disponible para analizar.');
  }

  onProgress?.('1/5 · Comparando con el repositorio institucional…');
  const internal = await runSecureInternalSimilarityAnalysis(fullVersion);
  const automaticFilters = {
    exclude_bibliography: true,
    exclude_quoted_text: true,
    min_match_words: 10,
    excluded_source_ids: [] as string[],
  };
  const internalView = buildSimilarityViewModel(fullVersion.extracted_text, internal, automaticFilters);
  await saveSimilarityAdjustment(
    internal.id,
    automaticFilters,
    internalView.adjustedSimilarityPercent,
    internalView.adjustedMatchedWords,
  );

  onProgress?.('2/5 · Buscando en fuentes académicas y web…');
  await runExternalSimilarityAnalysis(fullVersion);

  onProgress?.('3/5 · Revisando citas, referencias y APA 7…');
  await runCitationIntegrityAnalysis(fullVersion);

  onProgress?.('4/5 · Revisando señales de escritura asistida…');
  await runAiWritingAnalysis(fullVersion);

  onProgress?.('Calculando el porcentaje consolidado de similitud…');
  const snapshot = await buildIntegrityReportSnapshot(document, fullVersion);
  const consolidated = snapshot.summary.consolidated_similarity_adjusted;
  if (consolidated === null) throw new Error('No fue posible calcular la similitud consolidada.');

  const attempt = await recordAnalysisAttempt(fullVersion.id, consolidated, snapshot.provenance);

  let globalReviewCompleted = false;
  onProgress?.('5/5 · Ejecutando revisión global con las IA activas…');
  try {
    await runArticleReview(fullVersion.id, attempt.id, consolidated, snapshot);
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
