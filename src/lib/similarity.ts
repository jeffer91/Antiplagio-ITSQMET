import { supabase } from './supabase';
import type { DocumentVersion } from '../types/documents';
import type {
  AnalysisProgress,
  CoveredWordRange,
  SimilarityAdjustment,
  SimilarityAnalysisResult,
  SimilarityFilterSettings,
  SimilarityMatch,
  SimilaritySourceResult,
} from '../types/similarity';

export const INTERNAL_SIMILARITY_ALGORITHM = 'siai-internal-shingle-v2';

const SHINGLE_SIZE = 5;
const MIN_MATCH_WORDS = 10;
const MAX_TARGET_GAP = 5;
const MAX_SOURCE_DRIFT = 7;
const MAX_SOURCES = 25;
const MAX_MATCHES_PER_SOURCE = 20;

interface PreparedToken {
  raw: string;
  normalized: string;
}

interface PreparedText {
  tokens: PreparedToken[];
  shingles: string[];
}

interface LocalSourceResult {
  sourceVersionId: string;
  sourceDocumentId: string;
  matches: SimilarityMatch[];
  coveredTargetWords: number[];
  matchedWords: number;
  similarityPercent: number;
}

interface CorpusVersion {
  id: string;
  document_id: string;
  version_number: number;
  extracted_text: string;
  word_count: number;
}

function requireClient() {
  if (!supabase) throw new Error('Supabase no está configurado.');
  return supabase;
}

function normalizeWord(value: string): string {
  return value
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function prepareText(text: string): PreparedText {
  const tokens: PreparedToken[] = [];
  const matcher = /[\p{L}\p{N}]+/gu;
  for (const match of text.matchAll(matcher)) {
    const raw = match[0];
    tokens.push({ raw, normalized: normalizeWord(raw) });
  }

  const shingles: string[] = [];
  for (let index = 0; index <= tokens.length - SHINGLE_SIZE; index += 1) {
    shingles.push(tokens.slice(index, index + SHINGLE_SIZE).map((token) => token.normalized).join('\u001f'));
  }
  return { tokens, shingles };
}

function excerpt(prepared: PreparedText, start: number, end: number): string {
  const from = Math.max(0, start - 4);
  const to = Math.min(prepared.tokens.length, end + 4);
  const prefix = from > 0 ? '… ' : '';
  const suffix = to < prepared.tokens.length ? ' …' : '';
  return `${prefix}${prepared.tokens.slice(from, to).map((token) => token.raw).join(' ')}${suffix}`;
}

function buildSourceIndex(source: PreparedText): Map<string, number[]> {
  const index = new Map<string, number[]>();
  for (let position = 0; position < source.shingles.length; position += 1) {
    const key = source.shingles[position];
    const positions = index.get(key);
    if (positions) {
      if (positions.length < 30) positions.push(position);
    } else {
      index.set(key, [position]);
    }
  }
  return index;
}

function chooseSourcePosition(candidates: number[], expected: number, previous: number): number | null {
  let selected: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (candidate < previous) continue;
    const distance = Math.abs(candidate - expected);
    if (distance < bestDistance) {
      bestDistance = distance;
      selected = candidate;
    }
  }
  return selected !== null && bestDistance <= MAX_SOURCE_DRIFT ? selected : null;
}

function compressWords(words: Iterable<number>): CoveredWordRange[] {
  const sorted = [...new Set(words)].sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const ranges: CoveredWordRange[] = [];
  let start = sorted[0];
  let previous = sorted[0];
  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index];
    if (current === previous + 1) {
      previous = current;
      continue;
    }
    ranges.push([start, previous + 1]);
    start = current;
    previous = current;
  }
  ranges.push([start, previous + 1]);
  return ranges;
}

function comparePrepared(target: PreparedText, source: PreparedText): { matches: SimilarityMatch[]; coveredTargetWords: number[] } {
  if (target.tokens.length < MIN_MATCH_WORDS || source.tokens.length < MIN_MATCH_WORDS) {
    return { matches: [], coveredTargetWords: [] };
  }

  const sourceIndex = buildSourceIndex(source);
  const matches: SimilarityMatch[] = [];
  const covered = new Set<number>();
  let run: Array<{ target: number; source: number }> = [];

  const flushRun = (): void => {
    if (run.length < 2) {
      run = [];
      return;
    }

    const startTarget = run[0].target;
    const endTarget = run[run.length - 1].target + SHINGLE_SIZE;
    const startSource = run[0].source;
    const endSource = run[run.length - 1].source + SHINGLE_SIZE;
    const spanWords = endTarget - startTarget;
    const possibleShingles = Math.max(1, spanWords - SHINGLE_SIZE + 1);
    const density = run.length / possibleShingles;

    if (spanWords >= MIN_MATCH_WORDS && density >= 0.45) {
      const localCovered = new Set<number>();
      for (const point of run) {
        for (let offset = 0; offset < SHINGLE_SIZE; offset += 1) {
          covered.add(point.target + offset);
          localCovered.add(point.target + offset);
        }
      }

      matches.push({
        match_type: density >= 0.82 ? 'exact' : 'near',
        target_start_word: startTarget,
        target_end_word: endTarget,
        source_start_word: startSource,
        source_end_word: endSource,
        target_excerpt: excerpt(target, startTarget, endTarget),
        source_excerpt: excerpt(source, startSource, endSource),
        similarity_score: Math.min(100, Math.round(density * 10000) / 100),
        target_covered_ranges: compressWords(localCovered),
      });
    }
    run = [];
  };

  for (let targetPosition = 0; targetPosition < target.shingles.length; targetPosition += 1) {
    const candidates = sourceIndex.get(target.shingles[targetPosition]);
    if (!candidates) continue;

    if (run.length === 0) {
      run = [{ target: targetPosition, source: candidates[0] }];
      continue;
    }

    const previous = run[run.length - 1];
    const targetGap = targetPosition - previous.target;
    if (targetGap > MAX_TARGET_GAP) {
      flushRun();
      run = [{ target: targetPosition, source: candidates[0] }];
      continue;
    }

    const expectedSource = previous.source + targetGap;
    const sourcePosition = chooseSourcePosition(candidates, expectedSource, previous.source);
    if (sourcePosition === null) {
      flushRun();
      run = [{ target: targetPosition, source: candidates[0] }];
      continue;
    }

    run.push({ target: targetPosition, source: sourcePosition });
  }
  flushRun();

  const sortedMatches = matches
    .sort((a, b) => (b.target_end_word - b.target_start_word) - (a.target_end_word - a.target_start_word))
    .slice(0, MAX_MATCHES_PER_SOURCE)
    .sort((a, b) => a.target_start_word - b.target_start_word);

  const acceptedCovered = new Set<number>();
  for (const match of sortedMatches) {
    for (const [start, end] of match.target_covered_ranges ?? []) {
      for (let index = start; index < end; index += 1) acceptedCovered.add(index);
    }
  }

  return { matches: sortedMatches, coveredTargetWords: [...acceptedCovered] };
}

async function loadCorpus(target: DocumentVersion): Promise<CorpusVersion[]> {
  const client = requireClient();
  const { data, error } = await client
    .from('document_versions')
    .select('id,document_id,version_number,extracted_text,word_count')
    .eq('extraction_status', 'ready')
    .neq('id', target.id);
  if (error) throw error;

  return ((data ?? []) as CorpusVersion[]).filter(
    (version) => version.document_id !== target.document_id && version.extracted_text.trim().length > 0,
  );
}

function calculateLocalResult(targetPrepared: PreparedText, source: CorpusVersion): LocalSourceResult | null {
  const sourcePrepared = prepareText(source.extracted_text);
  const comparison = comparePrepared(targetPrepared, sourcePrepared);
  if (comparison.coveredTargetWords.length < MIN_MATCH_WORDS || comparison.matches.length === 0) return null;

  const matchedWords = comparison.coveredTargetWords.length;
  return {
    sourceVersionId: source.id,
    sourceDocumentId: source.document_id,
    matches: comparison.matches,
    coveredTargetWords: comparison.coveredTargetWords,
    matchedWords,
    similarityPercent: Math.min(100, (matchedWords / Math.max(1, targetPrepared.tokens.length)) * 100),
  };
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function runInternalSimilarityAnalysis(
  target: DocumentVersion,
  onProgress?: (progress: AnalysisProgress) => void,
): Promise<SimilarityAnalysisResult> {
  if (target.extraction_status !== 'ready' || !target.extracted_text.trim()) {
    throw new Error('Esta versión no tiene texto listo para comparar.');
  }

  const targetPrepared = prepareText(target.extracted_text);
  if (targetPrepared.tokens.length < MIN_MATCH_WORDS) {
    throw new Error(`El documento necesita al menos ${MIN_MATCH_WORDS} palabras analizables.`);
  }

  onProgress?.({ stage: 'loading', current: 0, total: 0, message: 'Cargando corpus institucional…' });
  const corpus = await loadCorpus(target);
  const bestByDocument = new Map<string, LocalSourceResult>();

  for (let index = 0; index < corpus.length; index += 1) {
    const source = corpus[index];
    onProgress?.({
      stage: 'comparing',
      current: index + 1,
      total: corpus.length,
      message: `Comparando ${index + 1} de ${corpus.length} versiones…`,
    });

    const result = calculateLocalResult(targetPrepared, source);
    if (!result) continue;
    const previous = bestByDocument.get(result.sourceDocumentId);
    if (!previous || result.matchedWords > previous.matchedWords) {
      bestByDocument.set(result.sourceDocumentId, result);
    }
  }

  const selected = [...bestByDocument.values()]
    .sort((a, b) => b.matchedWords - a.matchedWords)
    .slice(0, MAX_SOURCES);

  const globalCovered = new Set<number>();
  for (const source of selected) {
    for (const wordIndex of source.coveredTargetWords) globalCovered.add(wordIndex);
  }

  const matchedWords = globalCovered.size;
  const similarityPercent = roundPercent((matchedWords / targetPrepared.tokens.length) * 100);
  const payload = selected.map((source) => ({
    source_version_id: source.sourceVersionId,
    similarity_percent: roundPercent(source.similarityPercent),
    matched_words: source.matchedWords,
    matches: source.matches,
  }));

  onProgress?.({ stage: 'saving', current: selected.length, total: selected.length, message: 'Guardando evidencia…' });
  const client = requireClient();
  const { data, error } = await client.rpc('save_internal_similarity_analysis_v2', {
    p_target_version_id: target.id,
    p_algorithm_version: INTERNAL_SIMILARITY_ALGORITHM,
    p_similarity_percent: similarityPercent,
    p_matched_words: matchedWords,
    p_total_words: targetPrepared.tokens.length,
    p_sources: payload,
  });
  if (error) throw error;

  const analysisId = typeof data === 'string' ? data : String(data ?? '');
  if (!analysisId) throw new Error('Supabase no devolvió el identificador del análisis.');
  onProgress?.({ stage: 'done', current: selected.length, total: selected.length, message: 'Análisis completado.' });

  const result = await loadSimilarityAnalysis(analysisId);
  if (!result) throw new Error('El análisis se guardó, pero no fue posible volver a cargarlo.');
  return result;
}

function normalizeSafeAnalysis(value: unknown): SimilarityAnalysisResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!raw.id) return null;

  const rawSources = Array.isArray(raw.sources) ? raw.sources : [];
  const sources: SimilaritySourceResult[] = rawSources.map((item) => {
    const source = item as Record<string, unknown>;
    const rawMatches = Array.isArray(source.matches) ? source.matches : [];
    return {
      id: String(source.id ?? ''),
      analysis_id: String(source.analysis_id ?? raw.id),
      source_version_id: String(source.source_version_id ?? ''),
      source_document_id: String(source.source_document_id ?? ''),
      source_owner_id: String(source.source_owner_id ?? ''),
      source_title: String(source.source_title ?? 'Repositorio institucional'),
      source_version_number: Number(source.source_version_number ?? 1),
      similarity_percent: Number(source.similarity_percent ?? 0),
      matched_words: Number(source.matched_words ?? 0),
      owner_name: source.owner_name === null || source.owner_name === undefined ? null : String(source.owner_name),
      matches: rawMatches.map((itemMatch) => {
        const match = itemMatch as Record<string, unknown>;
        return {
          id: String(match.id ?? ''),
          source_id: String(match.source_id ?? source.id ?? ''),
          match_type: match.match_type === 'exact' ? 'exact' : 'near',
          target_start_word: Number(match.target_start_word ?? 0),
          target_end_word: Number(match.target_end_word ?? 1),
          source_start_word: Number(match.source_start_word ?? 0),
          source_end_word: Number(match.source_end_word ?? 1),
          target_excerpt: String(match.target_excerpt ?? ''),
          source_excerpt: String(match.source_excerpt ?? ''),
          similarity_score: Number(match.similarity_score ?? 0),
          target_covered_ranges: Array.isArray(match.target_covered_ranges)
            ? match.target_covered_ranges as CoveredWordRange[]
            : null,
        } satisfies SimilarityMatch;
      }),
    } satisfies SimilaritySourceResult;
  });

  const adjustmentRaw = raw.adjustment && typeof raw.adjustment === 'object' && !Array.isArray(raw.adjustment)
    ? raw.adjustment as Record<string, unknown>
    : null;
  const adjustment: SimilarityAdjustment | null = adjustmentRaw ? {
    analysis_id: String(adjustmentRaw.analysis_id ?? raw.id),
    exclude_bibliography: Boolean(adjustmentRaw.exclude_bibliography),
    exclude_quoted_text: Boolean(adjustmentRaw.exclude_quoted_text),
    min_match_words: Number(adjustmentRaw.min_match_words ?? 10),
    excluded_source_ids: Array.isArray(adjustmentRaw.excluded_source_ids)
      ? adjustmentRaw.excluded_source_ids.map(String)
      : [],
    adjusted_similarity_percent: Number(adjustmentRaw.adjusted_similarity_percent ?? raw.similarity_percent ?? 0),
    adjusted_matched_words: Number(adjustmentRaw.adjusted_matched_words ?? raw.matched_words ?? 0),
    saved_by: String(adjustmentRaw.saved_by ?? raw.created_by ?? ''),
    updated_at: String(adjustmentRaw.updated_at ?? raw.created_at ?? new Date(0).toISOString()),
  } : null;

  return {
    id: String(raw.id),
    target_version_id: String(raw.target_version_id ?? ''),
    target_document_id: String(raw.target_document_id ?? ''),
    created_by: String(raw.created_by ?? ''),
    algorithm_version: String(raw.algorithm_version ?? ''),
    similarity_percent: Number(raw.similarity_percent ?? 0),
    matched_words: Number(raw.matched_words ?? 0),
    total_words: Number(raw.total_words ?? 0),
    source_count: Number(raw.source_count ?? sources.length),
    released_to_student: Boolean(raw.released_to_student),
    created_at: String(raw.created_at ?? ''),
    sources,
    adjustment,
  };
}

export async function loadLatestSimilarityAnalysis(targetVersionId: string): Promise<SimilarityAnalysisResult | null> {
  const client = requireClient();
  const { data, error } = await client.rpc('get_internal_similarity_safe', {
    p_target_version_id: targetVersionId,
    p_analysis_id: null,
  });
  if (error) throw error;
  return normalizeSafeAnalysis(data);
}

export async function loadSimilarityAnalysis(analysisId: string): Promise<SimilarityAnalysisResult | null> {
  const client = requireClient();
  const { data, error } = await client.rpc('get_internal_similarity_safe', {
    p_target_version_id: null,
    p_analysis_id: analysisId,
  });
  if (error) throw error;
  return normalizeSafeAnalysis(data);
}

export async function saveSimilarityAdjustment(
  analysisId: string,
  settings: SimilarityFilterSettings,
  adjustedSimilarityPercent: number,
  adjustedMatchedWords: number,
): Promise<SimilarityAdjustment> {
  const client = requireClient();
  const { data, error } = await client.rpc('save_similarity_adjustment', {
    p_analysis_id: analysisId,
    p_exclude_bibliography: settings.exclude_bibliography,
    p_exclude_quoted_text: settings.exclude_quoted_text,
    p_min_match_words: settings.min_match_words,
    p_excluded_source_ids: settings.excluded_source_ids,
    p_adjusted_similarity_percent: adjustedSimilarityPercent,
    p_adjusted_matched_words: adjustedMatchedWords,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('Supabase no devolvió los ajustes guardados.');
  return {
    ...(row as SimilarityAdjustment),
    adjusted_similarity_percent: Number(row.adjusted_similarity_percent),
    excluded_source_ids: (row.excluded_source_ids ?? []) as string[],
  };
}

export async function setSimilarityRelease(analysisId: string, released: boolean): Promise<void> {
  const client = requireClient();
  const { error } = await client.rpc('set_similarity_release', {
    p_analysis_id: analysisId,
    p_released: released,
  });
  if (error) throw error;
}
