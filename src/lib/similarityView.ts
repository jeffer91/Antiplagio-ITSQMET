import type {
  CoveredWordRange,
  SimilarityAnalysisResult,
  SimilarityFilterSettings,
  SimilarityMatch,
  SimilarityMatchType,
  SimilaritySourceResult,
} from '../types/similarity';

export const DEFAULT_SIMILARITY_FILTERS: SimilarityFilterSettings = {
  exclude_bibliography: false,
  exclude_quoted_text: false,
  min_match_words: 10,
  excluded_source_ids: [],
};

export interface ViewerToken {
  raw: string;
  start: number;
  end: number;
}

export interface ViewerHighlight {
  sourceId: string;
  sourceIndex: number;
  matchKey: string;
  matchType: SimilarityMatchType;
}

export interface ViewerMatch {
  matchKey: string;
  source: SimilaritySourceResult;
  sourceIndex: number;
  match: SimilarityMatch;
  coveredWords: number[];
  activeWords: number[];
  active: boolean;
}

export interface ViewerSourceSummary {
  source: SimilaritySourceResult;
  sourceIndex: number;
  excluded: boolean;
  adjustedMatchedWords: number;
  adjustedSimilarityPercent: number;
  activeMatches: number;
}

export interface SimilarityViewModel {
  tokens: ViewerToken[];
  highlights: Map<number, ViewerHighlight>;
  matches: ViewerMatch[];
  sources: ViewerSourceSummary[];
  bibliographyStartWord: number | null;
  quotedWordCount: number;
  adjustedMatchedWords: number;
  adjustedSimilarityPercent: number;
  exactCoverageAvailable: boolean;
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

export function tokenizeForViewer(text: string): ViewerToken[] {
  const tokens: ViewerToken[] = [];
  const matcher = /[\p{L}\p{N}]+/gu;
  for (const match of text.matchAll(matcher)) {
    const raw = match[0];
    const start = match.index ?? 0;
    tokens.push({ raw, start, end: start + raw.length });
  }
  return tokens;
}

function normalizeHeading(value: string): string {
  return value
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findBibliographyStartChar(text: string): number | null {
  const accepted = new Set([
    'referencias',
    'referencias bibliograficas',
    'bibliografia',
    'fuentes bibliograficas',
    'references',
  ]);
  const lines = text.split(/\r?\n/);
  let cursor = 0;
  let selected: number | null = null;
  for (const line of lines) {
    const trimmed = normalizeHeading(line);
    if (accepted.has(trimmed) && cursor >= text.length * 0.4) selected = cursor;
    cursor += line.length + 1;
  }
  return selected;
}

function findQuoteRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const patterns = [
    /“[^”]{2,4000}”/gs,
    /«[^»]{2,4000}»/gs,
    /"[^"\n]{2,1200}"/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      ranges.push([start, start + match[0].length]);
    }
  }
  return ranges.sort((a, b) => a[0] - b[0]);
}

function wordsInsideCharRanges(tokens: ViewerToken[], ranges: Array<[number, number]>): Set<number> {
  const result = new Set<number>();
  if (ranges.length === 0) return result;
  let rangeIndex = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    while (rangeIndex < ranges.length && ranges[rangeIndex][1] <= token.start) rangeIndex += 1;
    if (rangeIndex >= ranges.length) break;
    const [start, end] = ranges[rangeIndex];
    if (token.start < end && token.end > start) result.add(index);
  }
  return result;
}

function sanitizeRanges(match: SimilarityMatch): CoveredWordRange[] {
  const supplied = match.target_covered_ranges;
  if (Array.isArray(supplied) && supplied.length > 0) {
    return supplied
      .filter((range): range is CoveredWordRange => Array.isArray(range) && range.length === 2)
      .map(([start, end]) => [Math.max(0, Math.floor(start)), Math.max(0, Math.floor(end))])
      .filter(([start, end]) => end > start);
  }
  return [[match.target_start_word, match.target_end_word]];
}

function expandRanges(ranges: CoveredWordRange[], tokenCount: number): number[] {
  const words = new Set<number>();
  for (const [rawStart, rawEnd] of ranges) {
    const start = Math.max(0, Math.min(tokenCount, rawStart));
    const end = Math.max(start, Math.min(tokenCount, rawEnd));
    for (let index = start; index < end; index += 1) words.add(index);
  }
  return [...words];
}

function getSourceId(source: SimilaritySourceResult, sourceIndex: number): string {
  return source.id ?? `${source.source_version_id}-${sourceIndex}`;
}

export function buildSimilarityViewModel(
  text: string,
  analysis: SimilarityAnalysisResult,
  settings: SimilarityFilterSettings,
): SimilarityViewModel {
  const tokens = tokenizeForViewer(text);
  const bibliographyStartChar = findBibliographyStartChar(text);
  const bibliographyStartWord = bibliographyStartChar === null
    ? null
    : Math.max(0, tokens.findIndex((token) => token.start >= bibliographyStartChar));
  const quoteRanges = findQuoteRanges(text);
  const quotedWords = wordsInsideCharRanges(tokens, quoteRanges);
  const excludedSources = new Set(settings.excluded_source_ids);
  const globalBaseline = new Set<number>();
  const globalActive = new Set<number>();
  const highlights = new Map<number, ViewerHighlight>();
  const viewerMatches: ViewerMatch[] = [];
  const sourceSummaries: ViewerSourceSummary[] = [];
  let exactCoverageAvailable = true;

  analysis.sources.forEach((source, sourceIndex) => {
    const sourceId = getSourceId(source, sourceIndex);
    const sourceExcluded = excludedSources.has(sourceId);
    const sourceBaseline = new Set<number>();
    const sourceActive = new Set<number>();
    let activeMatches = 0;

    source.matches.forEach((match, matchIndex) => {
      if (!match.target_covered_ranges?.length) exactCoverageAvailable = false;
      const coveredWords = expandRanges(sanitizeRanges(match), tokens.length);
      coveredWords.forEach((word) => {
        globalBaseline.add(word);
        sourceBaseline.add(word);
      });

      const activeWords = sourceExcluded || coveredWords.length < settings.min_match_words
        ? []
        : coveredWords.filter((word) => {
            if (settings.exclude_bibliography && bibliographyStartWord !== null && word >= bibliographyStartWord) return false;
            if (settings.exclude_quoted_text && quotedWords.has(word)) return false;
            return true;
          });

      const isActive = activeWords.length >= settings.min_match_words;
      const acceptedWords = isActive ? activeWords : [];
      const matchKey = `${sourceId}:${match.id ?? matchIndex}`;
      if (isActive) activeMatches += 1;

      acceptedWords.forEach((word) => {
        globalActive.add(word);
        sourceActive.add(word);
        const previous = highlights.get(word);
        if (!previous || source.matched_words > analysis.sources[previous.sourceIndex]?.matched_words) {
          highlights.set(word, {
            sourceId,
            sourceIndex,
            matchKey,
            matchType: match.match_type,
          });
        }
      });

      viewerMatches.push({
        matchKey,
        source,
        sourceIndex,
        match,
        coveredWords,
        activeWords: acceptedWords,
        active: isActive,
      });
    });

    let adjustedSourceWords: number;
    if (exactCoverageAvailable) {
      adjustedSourceWords = sourceActive.size;
    } else {
      const ratio = sourceBaseline.size > 0 ? sourceActive.size / sourceBaseline.size : 0;
      adjustedSourceWords = Math.round(source.matched_words * ratio);
    }

    sourceSummaries.push({
      source,
      sourceIndex,
      excluded: sourceExcluded,
      adjustedMatchedWords: adjustedSourceWords,
      adjustedSimilarityPercent: roundPercent((adjustedSourceWords / Math.max(1, analysis.total_words)) * 100),
      activeMatches,
    });
  });

  let adjustedMatchedWords: number;
  if (exactCoverageAvailable) {
    adjustedMatchedWords = globalActive.size;
  } else {
    const ratio = globalBaseline.size > 0 ? globalActive.size / globalBaseline.size : 0;
    adjustedMatchedWords = Math.round(analysis.matched_words * ratio);
  }
  adjustedMatchedWords = Math.min(analysis.matched_words, Math.max(0, adjustedMatchedWords));

  return {
    tokens,
    highlights,
    matches: viewerMatches,
    sources: sourceSummaries,
    bibliographyStartWord: bibliographyStartWord >= 0 ? bibliographyStartWord : null,
    quotedWordCount: quotedWords.size,
    adjustedMatchedWords,
    adjustedSimilarityPercent: roundPercent((adjustedMatchedWords / Math.max(1, analysis.total_words)) * 100),
    exactCoverageAvailable,
  };
}
