import { createClient } from 'npm:@supabase/supabase-js@2';

const ALGORITHM_VERSION = 'siai-external-ai-semantic-v2';
const AI_SEMANTIC_VERSION = 'source-grounded-v1';
const AI_SEMANTIC_MIN_SCORE = 84;
const AI_SEMANTIC_MAX_CANDIDATES = 4;
const AI_SEMANTIC_TIMEOUT_MS = 30_000;
const SHINGLE_SIZE = 5;
const MIN_MATCH_WORDS = 10;
const MAX_TARGET_GAP = 5;
const MAX_SOURCE_DRIFT = 7;
const MAX_MATCHES_PER_SOURCE = 12;
const MAX_VERIFIED_SOURCES = 15;
const MAX_CANDIDATE_SOURCES = 20;
const MAX_SOURCE_TEXT_CHARS = 450_000;
const MAX_TARGET_TEXT_CHARS = 1_500_000;
const MAX_CACHE_SHINGLES = 20_000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Provider = 'openalex' | 'core' | 'semantic_scholar' | 'crossref' | 'brave';
type VerificationScope = 'full_text' | 'snippet' | 'abstract' | 'metadata';
type DiscoveryMode = 'exact' | 'semantic' | 'bibliographic' | 'web';
type CoveredRange = [number, number];
type UnknownRecord = Record<string, unknown>;

interface PreparedToken {
  raw: string;
  normalized: string;
}

interface PreparedText {
  tokens: PreparedToken[];
  shingles: string[];
}

interface ExternalMatch {
  match_type: 'exact' | 'near';
  target_start_word: number;
  target_end_word: number;
  source_start_word: number;
  source_end_word: number;
  target_excerpt: string;
  source_excerpt: string;
  similarity_score: number;
  target_covered_ranges: CoveredRange[];
}

interface Candidate {
  provider: Provider;
  providerSourceId: string;
  title: string;
  authors: string[];
  publicationYear: number | null;
  doi: string | null;
  url: string | null;
  contentUrl: string | null;
  license: string | null;
  text: string | null;
  verificationScope: VerificationScope;
  discoveryModes: DiscoveryMode[];
  discoveredBy: Provider[];
  metadata: UnknownRecord;
}

interface ComparedCandidate extends Candidate {
  verificationStatus: 'verified' | 'candidate';
  similarityPercent: number;
  matchedWords: number;
  matches: ExternalMatch[];
  coveredTargetWords: number[];
}

interface ProviderState {
  status: 'ok' | 'disabled' | 'error';
  candidates: number;
  verified: number;
  message?: string;
}

interface SearchQueries {
  exact: string[];
  semantic: string[];
}

interface AiSemanticConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
}

interface AiSemanticPayloadMatch {
  target_excerpt?: unknown;
  source_excerpt?: unknown;
  similarity_score?: unknown;
}

const STOPWORDS = new Set([
  'de', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'en', 'del', 'al', 'para', 'por', 'con',
  'sin', 'que', 'se', 'es', 'son', 'como', 'su', 'sus', 'a', 'e', 'u', 'lo', 'le', 'les', 'este', 'esta', 'estos',
  'estas', 'entre', 'desde', 'hasta', 'sobre', 'durante', 'mediante', 'the', 'and', 'of', 'to', 'in', 'for', 'with', 'is',
  'are', 'this', 'that', 'from', 'as', 'by', 'an', 'a', 'on', 'or', 'be', 'was', 'were',
]);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function asRecord(value: unknown): UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function normalizeWord(value: string): string {
  return value
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizeTextKey(value: string): string {
  return normalizeWord(value).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenize(text: string): PreparedToken[] {
  const tokens: PreparedToken[] = [];
  for (const match of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    const raw = match[0];
    tokens.push({ raw, normalized: normalizeWord(raw) });
  }
  return tokens;
}

function prepareText(text: string): PreparedText {
  const tokens = tokenize(text);
  const shingles: string[] = [];
  for (let index = 0; index <= tokens.length - SHINGLE_SIZE; index += 1) {
    shingles.push(tokens.slice(index, index + SHINGLE_SIZE).map((token) => token.normalized).join('\u001f'));
  }
  return { tokens, shingles };
}

function excerpt(prepared: PreparedText, start: number, end: number): string {
  const from = Math.max(0, start - 4);
  const to = Math.min(prepared.tokens.length, end + 4);
  return `${from > 0 ? '… ' : ''}${prepared.tokens.slice(from, to).map((token) => token.raw).join(' ')}${to < prepared.tokens.length ? ' …' : ''}`;
}

function compressWords(words: Iterable<number>): CoveredRange[] {
  const sorted = [...new Set(words)].sort((a, b) => a - b);
  if (!sorted.length) return [];
  const ranges: CoveredRange[] = [];
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

function buildSourceIndex(source: PreparedText): Map<string, number[]> {
  const index = new Map<string, number[]>();
  for (let position = 0; position < source.shingles.length; position += 1) {
    const key = source.shingles[position];
    const values = index.get(key);
    if (values) {
      if (values.length < 30) values.push(position);
    } else {
      index.set(key, [position]);
    }
  }
  return index;
}

function chooseSourcePosition(candidates: number[], expected: number, previous: number): number | null {
  let selected: number | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (candidate < previous) continue;
    const nextDistance = Math.abs(candidate - expected);
    if (nextDistance < distance) {
      selected = candidate;
      distance = nextDistance;
    }
  }
  return selected !== null && distance <= MAX_SOURCE_DRIFT ? selected : null;
}

function comparePrepared(target: PreparedText, source: PreparedText): { matches: ExternalMatch[]; coveredTargetWords: number[] } {
  if (target.tokens.length < MIN_MATCH_WORDS || source.tokens.length < MIN_MATCH_WORDS) {
    return { matches: [], coveredTargetWords: [] };
  }

  const sourceIndex = buildSourceIndex(source);
  const matches: ExternalMatch[] = [];
  let run: Array<{ target: number; source: number }> = [];

  const flush = (): void => {
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
        for (let offset = 0; offset < SHINGLE_SIZE; offset += 1) localCovered.add(point.target + offset);
      }
      matches.push({
        match_type: density >= 0.82 ? 'exact' : 'near',
        target_start_word: startTarget,
        target_end_word: endTarget,
        source_start_word: startSource,
        source_end_word: endSource,
        target_excerpt: excerpt(target, startTarget, endTarget),
        source_excerpt: excerpt(source, startSource, endSource),
        similarity_score: Math.min(100, Math.round(density * 10_000) / 100),
        target_covered_ranges: compressWords(localCovered),
      });
    }
    run = [];
  };

  for (let targetPosition = 0; targetPosition < target.shingles.length; targetPosition += 1) {
    const candidates = sourceIndex.get(target.shingles[targetPosition]);
    if (!candidates) continue;
    if (!run.length) {
      run = [{ target: targetPosition, source: candidates[0] }];
      continue;
    }
    const previous = run[run.length - 1];
    const targetGap = targetPosition - previous.target;
    if (targetGap > MAX_TARGET_GAP) {
      flush();
      run = [{ target: targetPosition, source: candidates[0] }];
      continue;
    }
    const sourcePosition = chooseSourcePosition(candidates, previous.source + targetGap, previous.source);
    if (sourcePosition === null) {
      flush();
      run = [{ target: targetPosition, source: candidates[0] }];
      continue;
    }
    run.push({ target: targetPosition, source: sourcePosition });
  }
  flush();

  const accepted = matches
    .sort((a, b) => (b.target_end_word - b.target_start_word) - (a.target_end_word - a.target_start_word))
    .slice(0, MAX_MATCHES_PER_SOURCE)
    .sort((a, b) => a.target_start_word - b.target_start_word);

  const covered = new Set<number>();
  for (const match of accepted) {
    for (const [start, end] of match.target_covered_ranges) {
      for (let index = start; index < end; index += 1) covered.add(index);
    }
  }
  return { matches: accepted, coveredTargetWords: [...covered] };
}

function stripMarkup(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function safeUrl(value: unknown): string | null {
  const text = asString(value);
  if (!text) return null;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeDoi(value: unknown): string | null {
  let doi = asString(value).toLocaleLowerCase('en');
  if (!doi) return null;
  doi = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, '').replace(/^doi:\s*/, '').trim();
  return doi.startsWith('10.') && doi.includes('/') ? doi.slice(0, 500) : null;
}

function removeBibliography(text: string): string {
  const lines = text.split(/\r?\n/);
  let cursor = 0;
  let cut = text.length;
  const accepted = new Set(['referencias', 'referencias bibliograficas', 'bibliografia', 'references']);
  for (const line of lines) {
    const heading = normalizeTextKey(line);
    if (accepted.has(heading) && cursor > text.length * 0.42) {
      cut = cursor;
      break;
    }
    cursor += line.length + 1;
  }
  return text.slice(0, cut);
}

function jaccardWords(a: string, b: string): number {
  const left = new Set(tokenize(a).map((token) => token.normalized));
  const right = new Set(tokenize(b).map((token) => token.normalized));
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const word of left) if (right.has(word)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function selectSearchQueries(text: string): SearchQueries {
  const body = removeBibliography(text);
  const trimmedBody = body.slice(Math.min(500, Math.floor(body.length * 0.04)));
  const paragraphs = trimmedBody
    .split(/\n{2,}|(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ])/u)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter((paragraph) => paragraph.length >= 120)
    .filter((paragraph) => !/@|\b(?:cedula|cédula|telefono|teléfono|correo)\b/i.test(paragraph))
    .filter((paragraph) => !/\b\d{7,}\b/.test(paragraph));

  const frequencies = new Map<string, number>();
  for (const token of tokenize(trimmedBody)) {
    frequencies.set(token.normalized, (frequencies.get(token.normalized) ?? 0) + 1);
  }

  const windows: Array<{ query: string; score: number }> = [];
  const semanticCandidates: Array<{ query: string; score: number }> = [];

  for (const paragraph of paragraphs) {
    const words = tokenize(paragraph);
    if (words.length < 18) continue;
    const semanticWords = words.slice(0, Math.min(70, words.length));
    const semanticScore = semanticWords.reduce((sum, token) => sum + (token.normalized.length >= 7 ? 1 : 0), 0);
    semanticCandidates.push({ query: semanticWords.map((token) => token.raw).join(' '), score: semanticScore });

    const windowSize = 12;
    const step = Math.max(6, Math.floor((words.length - windowSize) / 3));
    for (let start = 0; start <= words.length - windowSize; start += step) {
      const selected = words.slice(start, start + windowSize);
      const unique = new Set(selected.map((token) => token.normalized));
      const informative = selected.filter((token) => token.normalized.length >= 6 && !STOPWORDS.has(token.normalized));
      const rarity = informative.reduce((sum, token) => sum + 1 / Math.max(1, frequencies.get(token.normalized) ?? 1), 0);
      const score = informative.length * 2 + unique.size / windowSize * 4 + rarity * 3;
      windows.push({ query: selected.map((token) => token.raw).join(' '), score });
      if (start + step > words.length - windowSize && start !== words.length - windowSize) {
        start = Math.max(start, words.length - windowSize - step);
      }
    }
  }

  const exact: string[] = [];
  for (const candidate of windows.sort((a, b) => b.score - a.score)) {
    if (exact.some((query) => jaccardWords(query, candidate.query) >= 0.68)) continue;
    exact.push(candidate.query);
    if (exact.length >= 5) break;
  }

  const semantic: string[] = [];
  for (const candidate of semanticCandidates.sort((a, b) => b.score - a.score)) {
    if (semantic.some((query) => jaccardWords(query, candidate.query) >= 0.6)) continue;
    semantic.push(candidate.query);
    if (semantic.length >= 2) break;
  }

  if (!exact.length) {
    const fallback = tokenize(trimmedBody).slice(0, 12).map((token) => token.raw).join(' ');
    if (fallback) exact.push(fallback);
  }
  if (!semantic.length) {
    const fallback = tokenize(trimmedBody).slice(0, 55).map((token) => token.raw).join(' ');
    if (fallback) semantic.push(fallback);
  }
  return { exact, semantic };
}

async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 12_000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function authorsFromUnknown(value: unknown): string[] {
  const names: string[] = [];
  for (const item of asArray(value)) {
    if (typeof item === 'string') {
      if (item.trim()) names.push(item.trim());
      continue;
    }
    const row = asRecord(item);
    const author = asRecord(row.author);
    const name = asString(row.name) || asString(author.display_name) || asString(author.name);
    if (name) names.push(name);
  }
  return [...new Set(names)].slice(0, 20);
}

function openAlexAuthors(value: unknown): string[] {
  const names: string[] = [];
  for (const item of asArray(value)) {
    const row = asRecord(item);
    const author = asRecord(row.author);
    const name = asString(author.display_name);
    if (name) names.push(name);
  }
  return [...new Set(names)].slice(0, 20);
}

function crossrefAuthors(value: unknown): string[] {
  const names: string[] = [];
  for (const item of asArray(value)) {
    const row = asRecord(item);
    const given = asString(row.given);
    const family = asString(row.family);
    const name = `${given} ${family}`.trim() || asString(row.name);
    if (name) names.push(name);
  }
  return [...new Set(names)].slice(0, 20);
}

function abstractFromInvertedIndex(value: unknown): string | null {
  const inverted = asRecord(value);
  const positioned = new Map<number, string>();
  let max = -1;
  for (const [word, positionsValue] of Object.entries(inverted)) {
    for (const positionValue of asArray(positionsValue)) {
      const position = asNumber(positionValue);
      if (position === null || position < 0 || !Number.isInteger(position)) continue;
      positioned.set(position, word);
      max = Math.max(max, position);
    }
  }
  if (max < 0) return null;
  const words: string[] = [];
  for (let index = 0; index <= max; index += 1) words.push(positioned.get(index) ?? '');
  const text = words.join(' ').replace(/\s+/g, ' ').trim();
  return text.length >= 80 ? text : null;
}

function stableFallbackId(provider: Provider, title: string, url: string | null): string {
  return `${provider}:${normalizeTextKey(title || url || 'source').slice(0, 420) || 'source'}`;
}

function candidateKey(candidate: Candidate): string {
  if (candidate.doi) return `doi:${candidate.doi}`;
  if (candidate.url) {
    try {
      const parsed = new URL(candidate.url);
      return `url:${parsed.hostname.toLocaleLowerCase('en')}${parsed.pathname.replace(/\/$/, '')}`;
    } catch {
      // Fall through to title.
    }
  }
  return `title:${normalizeTextKey(candidate.title).slice(0, 500)}`;
}

function scopeRank(scope: VerificationScope): number {
  if (scope === 'full_text') return 4;
  if (scope === 'snippet') return 3;
  if (scope === 'abstract') return 2;
  return 0;
}

function mergeCandidates(candidates: Candidate[]): Candidate[] {
  const byKey = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const key = candidateKey(candidate);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...candidate });
      continue;
    }

    existing.discoveredBy = [...new Set([...existing.discoveredBy, ...candidate.discoveredBy])];
    existing.discoveryModes = [...new Set([...existing.discoveryModes, ...candidate.discoveryModes])];
    existing.authors = [...new Set([...existing.authors, ...candidate.authors])].slice(0, 20);
    existing.doi ??= candidate.doi;
    existing.url ??= candidate.url;
    existing.contentUrl ??= candidate.contentUrl;
    existing.license ??= candidate.license;
    existing.publicationYear ??= candidate.publicationYear;
    existing.metadata = { ...existing.metadata, ...candidate.metadata };

    const existingRank = scopeRank(existing.verificationScope);
    const candidateRank = scopeRank(candidate.verificationScope);
    if (candidate.text && (candidateRank > existingRank || (candidateRank === existingRank && candidate.text.length > (existing.text?.length ?? 0)))) {
      existing.provider = candidate.provider;
      existing.providerSourceId = candidate.providerSourceId;
      existing.text = candidate.text;
      existing.verificationScope = candidate.verificationScope;
      existing.title = candidate.title || existing.title;
    }
  }
  return [...byKey.values()];
}

async function searchOpenAlex(queries: SearchQueries, apiKey: string): Promise<Candidate[]> {
  const byId = new Map<string, Candidate>();

  const search = async (query: string, mode: 'exact' | 'semantic'): Promise<void> => {
    const params = new URLSearchParams({ api_key: apiKey, per_page: '4' });
    params.set(mode === 'exact' ? 'search.exact' : 'search.semantic', query);
    const json = asRecord(await fetchJson(`https://api.openalex.org/works?${params.toString()}`));
    for (const item of asArray(json.results)) {
      const row = asRecord(item);
      const idUrl = asString(row.id);
      const workId = idUrl.split('/').pop() || '';
      if (!workId) continue;
      const primary = asRecord(row.primary_location);
      const bestOa = asRecord(row.best_oa_location);
      const contentUrl = safeUrl(row.content_url);
      const abstract = abstractFromInvertedIndex(row.abstract_inverted_index);
      const candidate: Candidate = {
        provider: 'openalex',
        providerSourceId: workId,
        title: asString(row.display_name) || asString(row.title) || 'Fuente OpenAlex',
        authors: openAlexAuthors(row.authorships),
        publicationYear: asNumber(row.publication_year),
        doi: normalizeDoi(row.doi),
        url: safeUrl(primary.landing_page_url) ?? safeUrl(bestOa.landing_page_url) ?? safeUrl(row.doi),
        contentUrl: contentUrl ?? safeUrl(bestOa.pdf_url) ?? safeUrl(primary.pdf_url),
        license: asString(bestOa.license) || asString(primary.license) || null,
        text: abstract,
        verificationScope: abstract ? 'abstract' : 'metadata',
        discoveryModes: [mode],
        discoveredBy: ['openalex'],
        metadata: { openalex_id: workId, content_available: Boolean(contentUrl), discovery_mode: mode },
      };
      const existing = byId.get(workId);
      if (!existing) byId.set(workId, candidate);
      else {
        existing.discoveryModes = [...new Set([...existing.discoveryModes, mode])];
        if (!existing.text && abstract) {
          existing.text = abstract;
          existing.verificationScope = 'abstract';
        }
      }
    }
  };

  for (const query of queries.exact.slice(0, 3)) await search(query, 'exact');
  for (const query of queries.semantic.slice(0, 1)) await search(query, 'semantic');

  const contentCandidates = [...byId.values()]
    .filter((candidate) => candidate.metadata.content_available === true)
    .slice(0, 2);

  for (const candidate of contentCandidates) {
    try {
      const url = `https://content.openalex.org/works/${encodeURIComponent(candidate.providerSourceId)}.grobid-xml?api_key=${encodeURIComponent(apiKey)}`;
      const xml = await fetchText(url);
      const text = stripMarkup(xml).slice(0, MAX_SOURCE_TEXT_CHARS);
      if (text.length >= 500) {
        candidate.text = text;
        candidate.verificationScope = 'full_text';
        candidate.metadata = { ...candidate.metadata, content_format: 'grobid_xml' };
      }
    } catch {
      candidate.metadata = { ...candidate.metadata, content_download: 'unavailable' };
    }
  }

  return [...byId.values()];
}

async function searchCore(queries: SearchQueries, apiKey: string | null): Promise<Candidate[]> {
  const output: Candidate[] = [];
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  for (const query of queries.exact.slice(0, 2)) {
    const params = new URLSearchParams({ q: `"${query}"`, limit: '5', offset: '0' });
    const json = asRecord(await fetchJson(`https://api.core.ac.uk/v3/search/works?${params.toString()}`, { headers }));
    for (const item of asArray(json.results)) {
      const row = asRecord(item);
      const title = asString(row.title) || 'Fuente CORE';
      const providerSourceId = asString(row.id) || stableFallbackId('core', title, safeUrl(row.downloadUrl));
      const fullText = asString(row.fullText);
      output.push({
        provider: 'core',
        providerSourceId,
        title,
        authors: authorsFromUnknown(row.authors),
        publicationYear: asNumber(row.yearPublished) ?? asNumber(row.year),
        doi: normalizeDoi(row.doi),
        url: safeUrl(row.downloadUrl) ?? safeUrl(row.url) ?? safeUrl(row.sourceFulltextUrls),
        contentUrl: safeUrl(row.downloadUrl),
        license: asString(row.license) || null,
        text: fullText ? stripMarkup(fullText).slice(0, MAX_SOURCE_TEXT_CHARS) : null,
        verificationScope: fullText ? 'full_text' : 'metadata',
        discoveryModes: ['exact'],
        discoveredBy: ['core'],
        metadata: { core_id: providerSourceId, discovery_mode: 'exact' },
      });
    }
  }
  return output;
}

async function searchSemanticScholar(queries: SearchQueries, apiKey: string | null): Promise<Candidate[]> {
  const output: Candidate[] = [];
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) headers['x-api-key'] = apiKey;

  for (const query of queries.exact.slice(0, 4)) {
    const params = new URLSearchParams({ query, limit: '4' });
    const json = asRecord(await fetchJson(`https://api.semanticscholar.org/graph/v1/snippet/search?${params.toString()}`, { headers }));
    for (const item of asArray(json.data)) {
      const row = asRecord(item);
      const snippet = asRecord(row.snippet);
      const paper = asRecord(row.paper);
      const text = asString(snippet.text) || asString(row.text);
      const title = asString(paper.title) || asString(row.title) || 'Fuente Semantic Scholar';
      const openAccess = asRecord(paper.openAccessInfo);
      const providerSourceId = asString(paper.paperId)
        || String(asNumber(paper.corpusId) ?? asNumber(row.corpusId) ?? '')
        || stableFallbackId('semantic_scholar', title, safeUrl(openAccess.url));
      output.push({
        provider: 'semantic_scholar',
        providerSourceId,
        title,
        authors: authorsFromUnknown(paper.authors ?? row.authors),
        publicationYear: asNumber(paper.year) ?? asNumber(row.year),
        doi: normalizeDoi(asRecord(paper.externalIds).DOI),
        url: safeUrl(openAccess.url) ?? safeUrl(paper.url),
        contentUrl: safeUrl(openAccess.url),
        license: asString(openAccess.license) || null,
        text: text ? stripMarkup(text).slice(0, MAX_SOURCE_TEXT_CHARS) : null,
        verificationScope: text ? 'snippet' : 'metadata',
        discoveryModes: ['exact'],
        discoveredBy: ['semantic_scholar'],
        metadata: { snippet_kind: asString(snippet.snippetKind), section: asString(snippet.section), discovery_mode: 'exact' },
      });
    }
  }
  return output;
}

async function searchCrossref(queries: SearchQueries, mailto: string | null): Promise<Candidate[]> {
  const output: Candidate[] = [];
  for (const query of queries.exact.slice(0, 2)) {
    const params = new URLSearchParams({ 'query.bibliographic': query, rows: '4' });
    if (mailto) params.set('mailto', mailto);
    const json = asRecord(await fetchJson(`https://api.crossref.org/works?${params.toString()}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'SIAI-ITSQMET/0.5 (academic-integrity)' },
    }));
    const message = asRecord(json.message);
    for (const item of asArray(message.items)) {
      const row = asRecord(item);
      const titles = asArray(row.title).map(asString).filter(Boolean);
      const title = titles[0] || 'Fuente Crossref';
      const doi = normalizeDoi(row.DOI);
      const abstract = stripMarkup(asString(row.abstract));
      const published = asRecord(row.published);
      const dateParts = asArray(published['date-parts']);
      const firstDate = asArray(dateParts[0]);
      const year = asNumber(firstDate[0]);
      output.push({
        provider: 'crossref',
        providerSourceId: doi || stableFallbackId('crossref', title, safeUrl(row.URL)),
        title,
        authors: crossrefAuthors(row.author),
        publicationYear: year,
        doi,
        url: safeUrl(row.URL) ?? (doi ? `https://doi.org/${doi}` : null),
        contentUrl: null,
        license: null,
        text: abstract.length >= 80 ? abstract.slice(0, MAX_SOURCE_TEXT_CHARS) : null,
        verificationScope: abstract.length >= 80 ? 'abstract' : 'metadata',
        discoveryModes: ['bibliographic'],
        discoveredBy: ['crossref'],
        metadata: { type: asString(row.type), discovery_mode: 'bibliographic' },
      });
    }
  }
  return output;
}

async function searchBrave(queries: SearchQueries, apiKey: string): Promise<Candidate[]> {
  const output: Candidate[] = [];
  for (const query of queries.exact.slice(0, 2)) {
    const params = new URLSearchParams({ q: `"${query}"`, count: '5', search_lang: 'es', country: 'EC' });
    const json = asRecord(await fetchJson(`https://api.search.brave.com/res/v1/web/search?${params.toString()}`, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey },
    }));
    const web = asRecord(json.web);
    for (const item of asArray(web.results)) {
      const row = asRecord(item);
      const url = safeUrl(row.url);
      const title = asString(row.title) || url || 'Resultado web';
      output.push({
        provider: 'brave',
        providerSourceId: url || stableFallbackId('brave', title, url),
        title,
        authors: [],
        publicationYear: null,
        doi: null,
        url,
        contentUrl: null,
        license: null,
        text: null,
        verificationScope: 'metadata',
        discoveryModes: ['web'],
        discoveredBy: ['brave'],
        metadata: { description: asString(row.description).slice(0, 800), discovery_mode: 'web' },
      });
    }
  }
  return output;
}

function compareCandidate(target: PreparedText, candidate: Candidate): ComparedCandidate {
  if (!candidate.text || candidate.text.length < 80) {
    return { ...candidate, verificationStatus: 'candidate', similarityPercent: 0, matchedWords: 0, matches: [], coveredTargetWords: [] };
  }
  const source = prepareText(candidate.text.slice(0, MAX_SOURCE_TEXT_CHARS));
  const comparison = comparePrepared(target, source);
  const matchedWords = comparison.coveredTargetWords.length;
  if (matchedWords < MIN_MATCH_WORDS || !comparison.matches.length) {
    return { ...candidate, verificationStatus: 'candidate', similarityPercent: 0, matchedWords: 0, matches: [], coveredTargetWords: [] };
  }
  return {
    ...candidate,
    // Solo el texto completo verificable puede aumentar el porcentaje institucional.
    // Abstracts y snippets se conservan como evidencia/candidatos aunque exista coincidencia.
    verificationStatus: candidate.verificationScope === 'full_text' ? 'verified' : 'candidate',
    matchedWords,
    similarityPercent: Math.round((matchedWords / Math.max(1, target.tokens.length)) * 10_000) / 100,
    matches: comparison.matches,
    coveredTargetWords: comparison.coveredTargetWords,
  };
}


function extractChatContent(payload: UnknownRecord): string {
  const choices = asArray(payload.choices);
  const first = asRecord(choices[0]);
  const message = asRecord(first.message);
  const content = message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => asString(asRecord(part).text)).filter(Boolean).join('\n');
  }
  return '';
}

function parseJsonObject(raw: string): UnknownRecord {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    return asRecord(JSON.parse(cleaned));
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return asRecord(JSON.parse(cleaned.slice(start, end + 1)));
      } catch {
        return {};
      }
    }
    return {};
  }
}

function locateTokenSequence(prepared: PreparedText, excerptText: string): [number, number] | null {
  const needle = tokenize(excerptText).map((token) => token.normalized);
  if (needle.length < MIN_MATCH_WORDS || needle.length > 60) return null;
  const haystack = prepared.tokens.map((token) => token.normalized);
  outer: for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) continue outer;
    }
    return [start, start + needle.length];
  }
  return null;
}

function semanticWindows(prepared: PreparedText, size = 90, step = 55, limit = 8): string[] {
  const output: string[] = [];
  if (!prepared.tokens.length) return output;
  for (let start = 0; start < prepared.tokens.length && output.length < limit; start += step) {
    const end = Math.min(prepared.tokens.length, start + size);
    if (end - start < 20) break;
    output.push(prepared.tokens.slice(start, end).map((token) => token.raw).join(' '));
    if (end === prepared.tokens.length) break;
  }
  return output;
}

function bestSemanticPairs(target: PreparedText, source: PreparedText): Array<{ target: string; source: string; rank: number }> {
  const targetWindows = semanticWindows(target);
  const sourceWindows = semanticWindows(source);
  const pairs: Array<{ target: string; source: string; rank: number }> = [];
  for (const targetWindow of targetWindows) {
    for (const sourceWindow of sourceWindows) {
      const rank = jaccardWords(targetWindow, sourceWindow);
      pairs.push({ target: targetWindow, source: sourceWindow, rank });
    }
  }
  return pairs.sort((a, b) => b.rank - a.rank).slice(0, 4);
}

function mergeSemanticEvidence(
  candidate: ComparedCandidate,
  matches: ExternalMatch[],
): ComparedCandidate {
  if (!matches.length) {
    return {
      ...candidate,
      metadata: {
        ...candidate.metadata,
        ai_semantic_reviewed: true,
        ai_semantic_verified: false,
        ai_semantic_match_count: 0,
        ai_semantic_version: AI_SEMANTIC_VERSION,
      },
    };
  }

  const byRange = new Map<string, ExternalMatch>();
  for (const match of [...candidate.matches, ...matches]) {
    const key = `${match.target_start_word}:${match.target_end_word}:${match.source_start_word}:${match.source_end_word}`;
    const existing = byRange.get(key);
    if (!existing || match.similarity_score > existing.similarity_score) byRange.set(key, match);
  }
  const mergedMatches = [...byRange.values()].sort((a, b) => a.target_start_word - b.target_start_word);
  const covered = new Set(candidate.coveredTargetWords);
  for (const match of matches) {
    for (const [start, end] of match.target_covered_ranges) {
      for (let index = start; index < end; index += 1) covered.add(index);
    }
  }
  const coveredTargetWords = [...covered].sort((a, b) => a - b);
  const fullTextEvidence = candidate.verificationScope === 'full_text' && coveredTargetWords.length >= MIN_MATCH_WORDS;

  return {
    ...candidate,
    verificationStatus: fullTextEvidence ? 'verified' : candidate.verificationStatus,
    similarityPercent: Math.round((coveredTargetWords.length / Math.max(1, candidate.metadata.target_total_words as number || 1)) * 10_000) / 100,
    matchedWords: coveredTargetWords.length,
    matches: mergedMatches.slice(0, MAX_MATCHES_PER_SOURCE),
    coveredTargetWords,
    metadata: {
      ...candidate.metadata,
      ai_semantic_reviewed: true,
      ai_semantic_verified: matches.length > 0,
      ai_semantic_match_count: matches.length,
      ai_semantic_version: AI_SEMANTIC_VERSION,
    },
  };
}

async function reviewCandidateWithAi(
  target: PreparedText,
  candidate: ComparedCandidate,
  config: AiSemanticConfig,
): Promise<ComparedCandidate> {
  if (!candidate.text || candidate.text.length < 80) {
    return {
      ...candidate,
      metadata: {
        ...candidate.metadata,
        ai_semantic_reviewed: true,
        ai_semantic_verified: false,
        ai_semantic_match_count: 0,
        ai_semantic_version: AI_SEMANTIC_VERSION,
      },
    };
  }

  const source = prepareText(candidate.text.slice(0, MAX_SOURCE_TEXT_CHARS));
  const pairs = bestSemanticPairs(target, source);
  if (!pairs.length) return candidate;

  const context = pairs.map((pair, index) =>
    `PAR ${index + 1}\nTARGET:\n${pair.target}\n\nSOURCE:\n${pair.source}`
  ).join('\n\n---\n\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_SEMANTIC_TIMEOUT_MS);
  try {
    const response = await fetch(config.apiUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content: 'Analiza SOLO similitud/plagio entre TARGET y SOURCE. Busca paráfrasis semánticamente equivalentes o reproducción sustancial. No evalúes metodología, redacción, calidad académica ni autoría por IA. Nunca inventes texto. Devuelve únicamente JSON válido.',
          },
          {
            role: 'user',
            content: `Compara los pares siguientes. Devuelve {"matches":[{"target_excerpt":"10 a 45 palabras consecutivas copiadas literalmente de TARGET","source_excerpt":"10 a 45 palabras consecutivas copiadas literalmente de SOURCE","similarity_score":0-100}]}. Incluye solo similitudes sustanciales con score >= ${AI_SEMANTIC_MIN_SCORE}. Si solo comparten tema o vocabulario genérico, devuelve {"matches":[]}. Máximo 3 coincidencias.\n\n${context}`,
          },
        ],
      }),
    });
    if (!response.ok) throw new Error(`IA semántica HTTP ${response.status}`);
    const payload = asRecord(await response.json());
    const parsed = parseJsonObject(extractChatContent(payload));
    const rawMatches = asArray(parsed.matches).map(asRecord) as AiSemanticPayloadMatch[];
    const matches: ExternalMatch[] = [];

    for (const rawMatch of rawMatches.slice(0, 3)) {
      const targetExcerpt = asString(rawMatch.target_excerpt);
      const sourceExcerpt = asString(rawMatch.source_excerpt);
      const score = asNumber(rawMatch.similarity_score) ?? 0;
      if (score < AI_SEMANTIC_MIN_SCORE || !targetExcerpt || !sourceExcerpt) continue;
      const targetRange = locateTokenSequence(target, targetExcerpt);
      const sourceRange = locateTokenSequence(source, sourceExcerpt);
      if (!targetRange || !sourceRange) continue;
      matches.push({
        match_type: 'near',
        target_start_word: targetRange[0],
        target_end_word: targetRange[1],
        source_start_word: sourceRange[0],
        source_end_word: sourceRange[1],
        target_excerpt: excerpt(target, targetRange[0], targetRange[1]),
        source_excerpt: excerpt(source, sourceRange[0], sourceRange[1]),
        similarity_score: Math.min(100, Math.max(AI_SEMANTIC_MIN_SCORE, score)),
        target_covered_ranges: [[targetRange[0], targetRange[1]]],
      });
    }

    const enriched = {
      ...candidate,
      metadata: { ...candidate.metadata, target_total_words: target.tokens.length },
    };
    return mergeSemanticEvidence(enriched, matches);
  } finally {
    clearTimeout(timer);
  }
}

function shouldKeepCandidate(candidate: ComparedCandidate): boolean {
  if (candidate.verificationStatus === 'verified') return true;
  if (Number(candidate.metadata.ai_semantic_match_count ?? 0) > 0) return true;
  return candidate.discoveryModes.some((mode) => mode === 'exact' || mode === 'bibliographic' || mode === 'web');
}

function fnv1a32(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

async function sha256Text(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function safeError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return 'Tiempo de espera agotado';
  if (error instanceof Error && /^HTTP \d{3}$/.test(error.message)) return error.message;
  return 'No disponible en esta ejecución';
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Método no permitido' }, 405);

  const authorization = request.headers.get('Authorization');
  if (!authorization) return jsonResponse({ error: 'Falta autenticación' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) return jsonResponse({ error: 'Supabase no está configurado en la función' }, 500);

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData.user) return jsonResponse({ error: 'Sesión no válida' }, 401);

    const body = asRecord(await request.json());
    const targetVersionId = asString(body.target_version_id);
    if (!targetVersionId) return jsonResponse({ error: 'Falta target_version_id' }, 400);

    const { data: canAnalyze, error: accessError } = await client.rpc('can_analyze_version', {
      p_version_id: targetVersionId,
    });
    if (accessError || !canAnalyze) {
      return jsonResponse({ error: 'No tienes acceso para analizar esta versión' }, 403);
    }

    const { data: targetRow, error: targetError } = await client
      .from('document_versions')
      .select('id,document_id,extracted_text,word_count,extraction_status')
      .eq('id', targetVersionId)
      .single();
    if (targetError || !targetRow) return jsonResponse({ error: 'La versión objetivo no existe o no es accesible' }, 404);
    if (targetRow.extraction_status !== 'ready') return jsonResponse({ error: 'La versión objetivo no tiene texto listo' }, 400);

    const targetText = asString(targetRow.extracted_text).slice(0, MAX_TARGET_TEXT_CHARS);
    const targetPrepared = prepareText(targetText);
    if (targetPrepared.tokens.length < MIN_MATCH_WORDS) return jsonResponse({ error: 'El documento no tiene suficiente texto analizable' }, 400);

    const queries = selectSearchQueries(targetText);
    const openAlexKey = asString(Deno.env.get('OPENALEX_API_KEY'));
    const coreKey = asString(Deno.env.get('CORE_API_KEY')) || null;
    const semanticKey = asString(Deno.env.get('SEMANTIC_SCHOLAR_API_KEY')) || null;
    const braveKey = asString(Deno.env.get('BRAVE_SEARCH_API_KEY'));
    const crossrefMailto = asString(Deno.env.get('CROSSREF_MAILTO')) || null;
    const aiConfig: AiSemanticConfig = {
      apiUrl: asString(Deno.env.get('PLAGIARISM_AI_API_URL')) || asString(Deno.env.get('ARTICLE_REVIEW_API_URL')),
      apiKey: asString(Deno.env.get('PLAGIARISM_AI_API_KEY')) || asString(Deno.env.get('ARTICLE_REVIEW_API_KEY')),
      model: asString(Deno.env.get('PLAGIARISM_AI_MODEL')) || asString(Deno.env.get('ARTICLE_REVIEW_MODEL')),
    };
    if (!aiConfig.apiUrl || !aiConfig.apiKey || !aiConfig.model) {
      return jsonResponse({
        error: 'Análisis incompleto: configura PLAGIARISM_AI_API_URL, PLAGIARISM_AI_API_KEY y PLAGIARISM_AI_MODEL.',
      }, 503);
    }

    const providerSummary: Record<Provider | 'ai_semantic', ProviderState> = {
      openalex: openAlexKey
        ? { status: 'ok', candidates: 0, verified: 0 }
        : { status: 'disabled', candidates: 0, verified: 0, message: 'Configura OPENALEX_API_KEY' },
      core: { status: 'ok', candidates: 0, verified: 0 },
      semantic_scholar: { status: 'ok', candidates: 0, verified: 0 },
      crossref: { status: 'ok', candidates: 0, verified: 0 },
      brave: braveKey
        ? { status: 'ok', candidates: 0, verified: 0 }
        : { status: 'disabled', candidates: 0, verified: 0, message: 'Configura BRAVE_SEARCH_API_KEY para búsqueda web general' },
      ai_semantic: { status: 'ok', candidates: 0, verified: 0, message: `Modelo ${aiConfig.model}` },
    };

    const allCandidates: Candidate[] = [];
    const collect = async (provider: Provider, task: () => Promise<Candidate[]>): Promise<void> => {
      try {
        const found = await task();
        providerSummary[provider] = { ...providerSummary[provider], status: 'ok', candidates: found.length };
        allCandidates.push(...found);
      } catch (error) {
        providerSummary[provider] = { status: 'error', candidates: 0, verified: 0, message: safeError(error) };
      }
    };

    await Promise.all([
      openAlexKey ? collect('openalex', () => searchOpenAlex(queries, openAlexKey)) : Promise.resolve(),
      collect('core', () => searchCore(queries, coreKey)),
      collect('semantic_scholar', () => searchSemanticScholar(queries, semanticKey)),
      collect('crossref', () => searchCrossref(queries, crossrefMailto)),
      braveKey ? collect('brave', () => searchBrave(queries, braveKey)) : Promise.resolve(),
    ]);

    const discoveryProviders: Provider[] = ['openalex', 'core', 'semantic_scholar', 'crossref', 'brave'];
    const successfulProviders = discoveryProviders.filter((provider) => providerSummary[provider].status === 'ok');
    if (!successfulProviders.length) {
      throw new Error('Análisis incompleto: ninguna fuente externa pudo consultarse. No se registrará un resultado 0%.');
    }

    const merged = mergeCandidates(allCandidates);
    let compared = merged.map((candidate) => ({
      ...compareCandidate(targetPrepared, candidate),
      metadata: { ...candidate.metadata, target_total_words: targetPrepared.tokens.length },
    }));

    const aiTargets = compared
      .filter((candidate) => Boolean(candidate.text) && candidate.verificationScope !== 'metadata')
      .sort((a, b) => {
        const fullText = Number(b.verificationScope === 'full_text') - Number(a.verificationScope === 'full_text');
        if (fullText !== 0) return fullText;
        const semantic = Number(b.discoveryModes.includes('semantic')) - Number(a.discoveryModes.includes('semantic'));
        return semantic !== 0 ? semantic : b.matchedWords - a.matchedWords;
      })
      .slice(0, AI_SEMANTIC_MAX_CANDIDATES);

    providerSummary.ai_semantic.candidates = aiTargets.length;
    if (aiTargets.length) {
      const reviewed = await Promise.allSettled(
        aiTargets.map((candidate) => reviewCandidateWithAi(targetPrepared, candidate, aiConfig)),
      );
      const successful = reviewed.filter((result): result is PromiseFulfilledResult<ComparedCandidate> => result.status === 'fulfilled');
      if (!successful.length) {
        providerSummary.ai_semantic = {
          status: 'error',
          candidates: aiTargets.length,
          verified: 0,
          message: 'La IA semántica no pudo verificar las fuentes candidatas.',
        };
        throw new Error('Análisis incompleto: la IA semántica no respondió correctamente.');
      }
      const reviewedByKey = new Map(successful.map((result) => [candidateKey(result.value), result.value]));
      compared = compared.map((candidate) => reviewedByKey.get(candidateKey(candidate)) ?? candidate);
      providerSummary.ai_semantic.verified = successful.reduce(
        (sum, result) => sum + (Number(result.value.metadata.ai_semantic_match_count ?? 0) > 0 ? 1 : 0),
        0,
      );
      const failures = reviewed.length - successful.length;
      if (failures > 0) providerSummary.ai_semantic.message = `${failures} fuente(s) no pudieron verificarse; las demás sí fueron procesadas.`;
    } else {
      providerSummary.ai_semantic.message = 'Sin fuentes con texto suficiente para comparación semántica.';
    }

    compared = compared.filter(shouldKeepCandidate);
    const verified = compared
      .filter((candidate) => candidate.verificationStatus === 'verified')
      .sort((a, b) => b.matchedWords - a.matchedWords)
      .slice(0, MAX_VERIFIED_SOURCES);
    const candidateOnly = compared
      .filter((candidate) => candidate.verificationStatus === 'candidate')
      .slice(0, MAX_CANDIDATE_SOURCES);

    for (const candidate of verified) providerSummary[candidate.provider].verified += 1;

    const globalCovered = new Set<number>();
    for (const candidate of verified) {
      for (const word of candidate.coveredTargetWords) globalCovered.add(word);
    }
    const matchedWords = globalCovered.size;
    const similarityPercent = Math.round((matchedWords / Math.max(1, targetPrepared.tokens.length)) * 10_000) / 100;

    const selected = [...verified, ...candidateOnly];
    const payload = selected.map((candidate) => ({
      provider: candidate.provider,
      provider_source_id: candidate.providerSourceId,
      title: candidate.title,
      authors: candidate.authors,
      publication_year: candidate.publicationYear,
      doi: candidate.doi,
      url: candidate.url,
      content_url: candidate.contentUrl,
      license: candidate.license,
      verification_status: candidate.verificationStatus,
      verification_scope: candidate.verificationScope,
      similarity_percent: candidate.similarityPercent,
      matched_words: candidate.matchedWords,
      metadata: {
        ...candidate.metadata,
        discovered_by: candidate.discoveredBy,
        discovery_modes: candidate.discoveryModes,
      },
      matches: candidate.matches,
    }));

    const { data: analysisId, error: saveError } = await client.rpc('save_external_similarity_analysis', {
      p_target_version_id: targetVersionId,
      p_algorithm_version: ALGORITHM_VERSION,
      p_similarity_percent: similarityPercent,
      p_matched_words: matchedWords,
      p_total_words: targetPrepared.tokens.length,
      p_provider_summary: providerSummary,
      p_sources: payload,
    });
    if (saveError || typeof analysisId !== 'string') throw new Error(saveError?.message || 'No fue posible guardar el análisis externo');

    await Promise.allSettled(verified.map(async (candidate) => {
      if (!candidate.text) return;
      const prepared = prepareText(candidate.text);
      const shingleHashes = prepared.shingles.slice(0, MAX_CACHE_SHINGLES).map(fnv1a32);
      const contentHash = await sha256Text(candidate.text);
      await client.rpc('upsert_external_source_cache', {
        p_cache_key: candidateKey(candidate),
        p_provider: candidate.provider,
        p_provider_source_id: candidate.providerSourceId,
        p_title: candidate.title,
        p_doi: candidate.doi,
        p_url: candidate.url,
        p_content_fingerprint_sha256: contentHash,
        p_shingle_hashes: shingleHashes,
        p_metadata: { discovered_by: candidate.discoveredBy, verification_scope: candidate.verificationScope },
      });
    }));

    return jsonResponse({
      analysis_id: analysisId,
      similarity_percent: similarityPercent,
      verified_sources: verified.length,
      candidate_sources: candidateOnly.length,
      queries_used: queries.exact.length + queries.semantic.length,
    });
  } catch (error) {
    return jsonResponse({ error: safeError(error) }, 500);
  }
});
