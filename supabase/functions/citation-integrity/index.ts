import { createClient } from 'npm:@supabase/supabase-js@2';

const ALGORITHM_VERSION = 'siai-citation-integrity-v1';
const MAX_TARGET_TEXT_CHARS = 1_500_000;
const MAX_REFERENCES_TO_VERIFY = 60;
const VERIFY_BATCH_SIZE = 4;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type UnknownRecord = Record<string, unknown>;
type VerificationStatus = 'verified' | 'probable' | 'not_found' | 'incomplete';
type VerificationProvider = 'crossref' | 'openalex' | null;
type CitationStyle = 'parenthetical' | 'narrative';
type LinkStatus = 'linked' | 'unlinked' | 'ambiguous';

interface PageText {
  page: number;
  text: string;
}

interface BibliographySection {
  found: boolean;
  heading: string | null;
  body: string;
  bibliography: string;
  startChar: number;
}

interface ParsedReference {
  ordinal: number;
  raw_reference: string;
  author_key: string | null;
  year_label: string | null;
  parsed_title: string | null;
  doi: string | null;
  url: string | null;
  verification_status: VerificationStatus;
  verification_provider: VerificationProvider;
  external_id: string | null;
  confidence: number;
  verified_metadata: UnknownRecord;
  apa_issues: string[];
}

interface CitationMention {
  raw_citation: string;
  citation_style: CitationStyle;
  author_key: string;
  year_label: string;
  start_char: number;
  end_char: number;
  page_number: number | null;
  link_status: LinkStatus;
  reference_ordinal: number | null;
}

interface BibliographicCandidate {
  provider: Exclude<VerificationProvider, null>;
  externalId: string;
  title: string;
  authors: string[];
  year: string | null;
  doi: string | null;
  url: string | null;
  metadata: UnknownRecord;
}

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

function normalizeKey(value: string): string {
  return value
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeUrl(value: unknown): string | null {
  const text = asString(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeDoi(value: unknown): string | null {
  let doi = asString(value).toLocaleLowerCase('en');
  if (!doi) return null;
  doi = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, '').replace(/^doi:\s*/, '').trim();
  doi = doi.replace(/[\s.,;:)\]}]+$/g, '');
  return doi.startsWith('10.') && doi.includes('/') ? doi.slice(0, 500) : null;
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

function findBibliography(text: string): BibliographySection {
  const accepted = new Set([
    'referencias',
    'referencias bibliograficas',
    'bibliografia',
    'fuentes bibliograficas',
    'references',
    'works cited',
  ]);
  const lines = text.split(/\r?\n/);
  let cursor = 0;
  for (const line of lines) {
    const normalized = normalizeKey(line);
    if (accepted.has(normalized) && cursor >= text.length * 0.35) {
      const afterHeading = cursor + line.length;
      return {
        found: true,
        heading: line.trim(),
        body: text.slice(0, cursor).trim(),
        bibliography: text.slice(afterHeading).trim(),
        startChar: cursor,
      };
    }
    cursor += line.length + 1;
  }
  return { found: false, heading: null, body: text, bibliography: '', startChar: text.length };
}

function looksLikeReferenceStart(line: string): boolean {
  const value = line.trim();
  if (value.length < 8) return false;
  return /\((?:19|20)\d{2}[a-z]?\)/i.test(value)
    && (/^[A-ZÁÉÍÓÚÑ][\p{L}'’.-]{1,80},/u.test(value) || /^[A-ZÁÉÍÓÚÑ][^()]{2,100}\((?:19|20)\d{2}[a-z]?\)/u.test(value));
}

function splitDenseBibliography(text: string): string[] {
  const starts: number[] = [];
  const pattern = /[A-ZÁÉÍÓÚÑ][\p{L}'’.-]{1,70},\s+[^()]{0,190}?\((?:19|20)\d{2}[a-z]?\)/gu;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (!starts.length || index - starts[starts.length - 1] > 30) starts.push(index);
  }
  if (starts.length < 2) return text.trim() ? [text.replace(/\s+/g, ' ').trim()] : [];
  const output: string[] = [];
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index];
    const end = index + 1 < starts.length ? starts[index + 1] : text.length;
    const value = text.slice(start, end).replace(/\s+/g, ' ').trim();
    if (value.length >= 12) output.push(value);
  }
  return output;
}

function splitReferences(text: string): string[] {
  if (!text.trim()) return [];
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const usefulLines = lines.filter(Boolean);
  const startCount = usefulLines.filter(looksLikeReferenceStart).length;

  if (startCount < 2 || usefulLines.length <= 4) return splitDenseBibliography(text);

  const references: string[] = [];
  let current = '';
  const flush = (): void => {
    const value = current.replace(/\s+/g, ' ').trim();
    if (value.length >= 12) references.push(value);
    current = '';
  };

  for (const line of lines) {
    if (!line) {
      if (current) flush();
      continue;
    }
    if (looksLikeReferenceStart(line) && current) flush();
    current = current ? `${current} ${line}` : line;
  }
  if (current) flush();
  return references;
}

function firstAuthorKey(authorPart: string): string | null {
  const cleaned = authorPart
    .replace(/^\s*(?:véase|vease|see|cf\.?|cfr\.?)\s+/i, '')
    .replace(/\bet\s+al\.?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  const beforeComma = cleaned.split(',')[0]?.trim() || cleaned;
  const beforeConnector = beforeComma.split(/\s+(?:&|y|and)\s+/i)[0]?.trim() || beforeComma;
  const words = normalizeKey(beforeConnector).split(' ').filter(Boolean);
  if (!words.length) return null;
  return words[0].slice(0, 200);
}

function parseReference(raw: string, ordinal: number): ParsedReference {
  const yearMatch = raw.match(/\(((?:19|20)\d{2}[a-z]?|s\.?\s*f\.?)\)/i);
  const yearLabel = yearMatch ? yearMatch[1].replace(/\s+/g, '').toLocaleLowerCase('es') : null;
  const yearIndex = yearMatch?.index ?? -1;
  const authorPart = yearIndex >= 0 ? raw.slice(0, yearIndex).trim().replace(/[.,;:\s]+$/g, '') : '';
  const authorKey = firstAuthorKey(authorPart);
  const doiMatch = raw.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i);
  const doi = normalizeDoi(doiMatch?.[0] ?? null);
  const urlMatch = raw.match(/https?:\/\/[^\s<>]+/i);
  const url = safeUrl(urlMatch?.[0]?.replace(/[.,;:)\]}]+$/g, '') ?? null);

  let parsedTitle: string | null = null;
  if (yearMatch && yearIndex >= 0) {
    const afterYear = raw.slice(yearIndex + yearMatch[0].length).replace(/^[\s.,;:]+/, '').trim();
    const titleMatch = afterYear.match(/^(.{4,700}?)(?:\.\s+(?=[A-ZÁÉÍÓÚÑ]|https?:\/\/|doi:)|$)/u);
    parsedTitle = (titleMatch?.[1] ?? afterYear.slice(0, 700)).trim() || null;
  }

  const issues: string[] = [];
  if (!authorKey) issues.push('missing_author');
  if (!yearLabel) issues.push('missing_year');
  if (!parsedTitle || parsedTitle.length < 4) issues.push('missing_title');
  if (yearLabel && !raw.includes(`(${yearMatch?.[1] ?? ''})`)) issues.push('year_not_parenthesized');
  if (doi) {
    const canonical = `https://doi.org/${doi}`;
    if (!raw.toLocaleLowerCase('en').includes(canonical.toLocaleLowerCase('en'))) issues.push('doi_not_canonical');
  }

  return {
    ordinal,
    raw_reference: raw,
    author_key: authorKey,
    year_label: yearLabel,
    parsed_title: parsedTitle,
    doi,
    url,
    verification_status: 'incomplete',
    verification_provider: null,
    external_id: null,
    confidence: 0,
    verified_metadata: {},
    apa_issues: issues,
  };
}

function findDuplicateIssues(references: ParsedReference[]): void {
  const seen = new Map<string, ParsedReference>();
  for (const reference of references) {
    const key = reference.doi
      ? `doi:${reference.doi}`
      : `ref:${normalizeKey(`${reference.author_key ?? ''} ${reference.year_label ?? ''} ${reference.parsed_title ?? ''}`)}`;
    if (key.length < 12) continue;
    const previous = seen.get(key);
    if (previous) {
      if (!previous.apa_issues.includes('duplicate_reference')) previous.apa_issues.push('duplicate_reference');
      if (!reference.apa_issues.includes('duplicate_reference')) reference.apa_issues.push('duplicate_reference');
    } else {
      seen.set(key, reference);
    }
  }
}

function globalIssues(section: BibliographySection, references: ParsedReference[]): string[] {
  const issues: string[] = [];
  if (!section.found) issues.push('bibliography_heading_not_found');
  if (section.found && references.length === 0) issues.push('bibliography_empty_or_unreadable');
  const keys = references.map((reference) => reference.author_key).filter((value): value is string => Boolean(value));
  if (keys.length >= 3) {
    const sorted = [...keys].sort((a, b) => a.localeCompare(b, 'es'));
    if (keys.some((value, index) => value !== sorted[index])) issues.push('references_not_alphabetical');
  }
  return issues;
}

function pageForOffset(text: string, pagesValue: unknown, offset: number): number | null {
  const pages = asArray(pagesValue)
    .map((item) => asRecord(item))
    .map((item) => ({ page: asNumber(item.page) ?? 0, text: asString(item.text) }))
    .filter((item): item is PageText => item.page > 0 && Boolean(item.text));
  if (!pages.length) return null;
  let cursor = 0;
  for (const page of pages) {
    const end = cursor + page.text.length;
    if (offset <= end + 2) return page.page;
    cursor = end + 2;
  }
  return pages[pages.length - 1]?.page ?? null;
}

function citationAuthorKey(value: string): string | null {
  return firstAuthorKey(value.replace(/[()[\]]/g, ' ').replace(/\s+/g, ' ').trim());
}

function detectMentions(body: string, fullText: string, pagesValue: unknown): CitationMention[] {
  const mentions: CitationMention[] = [];
  const dedupe = new Set<string>();

  for (const match of body.matchAll(/\(([^()\n]{1,280})\)/g)) {
    const content = match[1];
    if (!/(?:19|20)\d{2}[a-z]?/i.test(content)) continue;
    const pieces = content.split(';');
    for (const piece of pieces) {
      const years = [...piece.matchAll(/(?:19|20)\d{2}[a-z]?/gi)];
      if (!years.length) continue;
      const firstYearIndex = years[0].index ?? 0;
      const authorPart = piece.slice(0, firstYearIndex).replace(/[\s,]+$/g, '');
      const authorKey = citationAuthorKey(authorPart);
      if (!authorKey) continue;
      for (const year of years) {
        const yearLabel = year[0].toLocaleLowerCase('es');
        const start = match.index ?? 0;
        const end = start + match[0].length;
        const key = `p:${start}:${authorKey}:${yearLabel}`;
        if (dedupe.has(key)) continue;
        dedupe.add(key);
        mentions.push({
          raw_citation: `(${piece.trim()})`,
          citation_style: 'parenthetical',
          author_key: authorKey,
          year_label: yearLabel,
          start_char: start,
          end_char: end,
          page_number: pageForOffset(fullText, pagesValue, start),
          link_status: 'unlinked',
          reference_ordinal: null,
        });
      }
    }
  }

  const narrativePattern = /\b([A-ZÁÉÍÓÚÑ][\p{L}'’.-]{1,80}(?:\s+et\s+al\.)?)\s*\(((?:19|20)\d{2}[a-z]?)\)/gu;
  for (const match of body.matchAll(narrativePattern)) {
    const authorKey = citationAuthorKey(match[1]);
    if (!authorKey) continue;
    const yearLabel = match[2].toLocaleLowerCase('es');
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const key = `n:${start}:${authorKey}:${yearLabel}`;
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    mentions.push({
      raw_citation: match[0],
      citation_style: 'narrative',
      author_key: authorKey,
      year_label: yearLabel,
      start_char: start,
      end_char: end,
      page_number: pageForOffset(fullText, pagesValue, start),
      link_status: 'unlinked',
      reference_ordinal: null,
    });
  }

  return mentions.sort((a, b) => a.start_char - b.start_char);
}

function linkMentions(mentions: CitationMention[], references: ParsedReference[]): void {
  for (const mention of mentions) {
    const candidates = references.filter((reference) =>
      reference.author_key === mention.author_key
      && reference.year_label === mention.year_label
    );
    if (candidates.length === 1) {
      mention.link_status = 'linked';
      mention.reference_ordinal = candidates[0].ordinal;
    } else if (candidates.length > 1) {
      mention.link_status = 'ambiguous';
      mention.reference_ordinal = null;
    } else {
      mention.link_status = 'unlinked';
      mention.reference_ordinal = null;
    }
  }
}

function tokenSet(value: string): Set<string> {
  return new Set(normalizeKey(value).split(' ').filter((word) => word.length >= 2));
}

function jaccard(a: string, b: string): number {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (!left.size || !right.size) return 0;
  let common = 0;
  for (const token of left) if (right.has(token)) common += 1;
  return common / (left.size + right.size - common);
}

function crossrefAuthors(value: unknown): string[] {
  const output: string[] = [];
  for (const item of asArray(value)) {
    const row = asRecord(item);
    const name = `${asString(row.given)} ${asString(row.family)}`.trim() || asString(row.name);
    if (name) output.push(name);
  }
  return output.slice(0, 30);
}

function openAlexAuthors(value: unknown): string[] {
  const output: string[] = [];
  for (const item of asArray(value)) {
    const row = asRecord(item);
    const author = asRecord(row.author);
    const name = asString(author.display_name);
    if (name) output.push(name);
  }
  return output.slice(0, 30);
}

function crossrefYear(row: UnknownRecord): string | null {
  for (const field of ['published', 'issued', 'published-online', 'published-print']) {
    const date = asRecord(row[field]);
    const parts = asArray(date['date-parts']);
    const first = asArray(parts[0]);
    const year = asNumber(first[0]);
    if (year && year >= 1000 && year <= 2200) return String(Math.trunc(year));
  }
  return null;
}

function crossrefCandidate(row: UnknownRecord): BibliographicCandidate {
  const doi = normalizeDoi(row.DOI);
  const title = asArray(row.title).map(asString).find(Boolean) || asString(row.title) || 'Sin título';
  return {
    provider: 'crossref',
    externalId: doi || asString(row.URL) || normalizeKey(title).slice(0, 500),
    title,
    authors: crossrefAuthors(row.author),
    year: crossrefYear(row),
    doi,
    url: safeUrl(row.URL) ?? (doi ? `https://doi.org/${doi}` : null),
    metadata: { type: asString(row.type), container_title: asArray(row['container-title']).map(asString).find(Boolean) || null },
  };
}

function openAlexCandidate(row: UnknownRecord): BibliographicCandidate {
  const id = asString(row.id);
  const doi = normalizeDoi(row.doi);
  return {
    provider: 'openalex',
    externalId: id.split('/').pop() || doi || normalizeKey(asString(row.display_name)).slice(0, 500),
    title: asString(row.display_name) || asString(row.title) || 'Sin título',
    authors: openAlexAuthors(row.authorships),
    year: asNumber(row.publication_year) ? String(Math.trunc(asNumber(row.publication_year)!)) : null,
    doi,
    url: safeUrl(asRecord(row.primary_location).landing_page_url) ?? (doi ? `https://doi.org/${doi}` : null),
    metadata: { openalex_id: id || null },
  };
}

function scoreCandidate(reference: ParsedReference, candidate: BibliographicCandidate): number {
  const titleScore = reference.parsed_title ? jaccard(reference.parsed_title, candidate.title) : 0;
  const authorScore = reference.author_key && candidate.authors.some((author) => normalizeKey(author).split(' ').includes(reference.author_key!)) ? 1 : 0;
  const yearScore = reference.year_label && candidate.year && reference.year_label.slice(0, 4) === candidate.year ? 1 : 0;
  return Math.round((titleScore * 70 + authorScore * 20 + yearScore * 10) * 100) / 100;
}

function verificationMetadata(reference: ParsedReference, candidate: BibliographicCandidate, confidence: number): UnknownRecord {
  const mismatches: string[] = [];
  if (reference.parsed_title && jaccard(reference.parsed_title, candidate.title) < 0.45) mismatches.push('title_mismatch');
  if (reference.year_label && candidate.year && reference.year_label.slice(0, 4) !== candidate.year) mismatches.push('year_mismatch');
  if (reference.doi && candidate.doi && reference.doi !== candidate.doi) mismatches.push('doi_mismatch');
  return {
    title: candidate.title,
    authors: candidate.authors,
    year: candidate.year,
    doi: candidate.doi,
    url: candidate.url,
    confidence,
    mismatches,
    ...candidate.metadata,
  };
}

async function searchCrossref(reference: ParsedReference, mailto: string | null): Promise<{ candidates: BibliographicCandidate[]; succeeded: boolean }> {
  const headers = { Accept: 'application/json', 'User-Agent': 'SIAI-ITSQMET/0.6 (academic-integrity)' };
  if (reference.doi) {
    try {
      const params = mailto ? `?mailto=${encodeURIComponent(mailto)}` : '';
      const json = asRecord(await fetchJson(`https://api.crossref.org/works/${encodeURIComponent(reference.doi)}${params}`, { headers }));
      const message = asRecord(json.message);
      if (Object.keys(message).length) return { candidates: [crossrefCandidate(message)], succeeded: true };
    } catch (error) {
      if (error instanceof Error && error.message === 'HTTP 404') {
        // Continue with bibliographic search; a DOI typo can still match by metadata.
      }
    }
  }

  const query = reference.raw_reference.slice(0, 1200);
  const params = new URLSearchParams({ 'query.bibliographic': query, rows: '4' });
  if (mailto) params.set('mailto', mailto);
  try {
    const json = asRecord(await fetchJson(`https://api.crossref.org/works?${params.toString()}`, { headers }));
    const items = asArray(asRecord(json.message).items).map((item) => crossrefCandidate(asRecord(item)));
    return { candidates: items, succeeded: true };
  } catch {
    return { candidates: [], succeeded: false };
  }
}

async function searchOpenAlex(reference: ParsedReference, apiKey: string | null): Promise<{ candidates: BibliographicCandidate[]; succeeded: boolean }> {
  if (!apiKey || !reference.parsed_title || reference.parsed_title.length < 8) return { candidates: [], succeeded: false };
  const params = new URLSearchParams({ api_key: apiKey, per_page: '4', 'search.exact': reference.parsed_title.slice(0, 500) });
  try {
    const json = asRecord(await fetchJson(`https://api.openalex.org/works?${params.toString()}`));
    return { candidates: asArray(json.results).map((item) => openAlexCandidate(asRecord(item))), succeeded: true };
  } catch {
    return { candidates: [], succeeded: false };
  }
}

async function verifyReference(reference: ParsedReference, mailto: string | null, openAlexKey: string | null): Promise<ParsedReference> {
  if (!reference.doi && (!reference.author_key || !reference.year_label || !reference.parsed_title || reference.parsed_title.length < 6)) {
    return { ...reference, verification_status: 'incomplete', verified_metadata: { reason: 'insufficient_reference_data' } };
  }

  let succeeded = false;
  const candidates: BibliographicCandidate[] = [];
  const crossref = await searchCrossref(reference, mailto);
  succeeded ||= crossref.succeeded;
  candidates.push(...crossref.candidates);

  const bestCrossref = candidates
    .map((candidate) => ({ candidate, score: reference.doi && candidate.doi === reference.doi ? 100 : scoreCandidate(reference, candidate) }))
    .sort((a, b) => b.score - a.score)[0];

  if (bestCrossref && bestCrossref.score >= 78) {
    return {
      ...reference,
      verification_status: 'verified',
      verification_provider: bestCrossref.candidate.provider,
      external_id: bestCrossref.candidate.externalId,
      confidence: bestCrossref.score,
      verified_metadata: verificationMetadata(reference, bestCrossref.candidate, bestCrossref.score),
    };
  }

  const openalex = await searchOpenAlex(reference, openAlexKey);
  succeeded ||= openalex.succeeded;
  const all = [...candidates, ...openalex.candidates]
    .map((candidate) => ({ candidate, score: reference.doi && candidate.doi === reference.doi ? 100 : scoreCandidate(reference, candidate) }))
    .sort((a, b) => b.score - a.score);
  const best = all[0];

  if (best && best.score >= 78) {
    return {
      ...reference,
      verification_status: 'verified',
      verification_provider: best.candidate.provider,
      external_id: best.candidate.externalId,
      confidence: best.score,
      verified_metadata: verificationMetadata(reference, best.candidate, best.score),
    };
  }
  if (best && best.score >= 58) {
    return {
      ...reference,
      verification_status: 'probable',
      verification_provider: best.candidate.provider,
      external_id: best.candidate.externalId,
      confidence: best.score,
      verified_metadata: verificationMetadata(reference, best.candidate, best.score),
    };
  }

  return {
    ...reference,
    verification_status: succeeded ? 'not_found' : 'incomplete',
    verification_provider: best?.candidate.provider ?? null,
    external_id: best?.candidate.externalId ?? null,
    confidence: best?.score ?? 0,
    verified_metadata: best
      ? verificationMetadata(reference, best.candidate, best.score)
      : { reason: succeeded ? 'no_reliable_match' : 'verification_services_unavailable' },
  };
}

async function verifyReferences(references: ParsedReference[], mailto: string | null, openAlexKey: string | null): Promise<ParsedReference[]> {
  const output = [...references];
  const limit = Math.min(output.length, MAX_REFERENCES_TO_VERIFY);
  for (let start = 0; start < limit; start += VERIFY_BATCH_SIZE) {
    const batch = output.slice(start, Math.min(limit, start + VERIFY_BATCH_SIZE));
    const verified = await Promise.all(batch.map((reference) => verifyReference(reference, mailto, openAlexKey)));
    verified.forEach((reference, offset) => { output[start + offset] = reference; });
  }
  for (let index = limit; index < output.length; index += 1) {
    output[index] = {
      ...output[index],
      verification_status: 'incomplete',
      verified_metadata: { reason: 'verification_limit_reached', limit: MAX_REFERENCES_TO_VERIFY },
    };
  }
  return output;
}

function safeError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return 'Tiempo de espera agotado';
  if (error instanceof Error && /^HTTP \d{3}$/.test(error.message)) return error.message;
  return error instanceof Error ? error.message.slice(0, 300) : 'No disponible en esta ejecución';
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
      .select('id,document_id,extracted_text,extracted_pages,extraction_status')
      .eq('id', targetVersionId)
      .single();
    if (targetError || !targetRow) return jsonResponse({ error: 'La versión objetivo no existe o no es accesible' }, 404);
    if (targetRow.extraction_status !== 'ready') return jsonResponse({ error: 'La versión objetivo no tiene texto listo' }, 400);

    const targetText = asString(targetRow.extracted_text).slice(0, MAX_TARGET_TEXT_CHARS);
    if (targetText.length < 80) return jsonResponse({ error: 'El documento no tiene suficiente texto analizable' }, 400);

    const section = findBibliography(targetText);
    const references = splitReferences(section.bibliography).map((raw, index) => parseReference(raw, index + 1));
    findDuplicateIssues(references);
    const issues = globalIssues(section, references);
    const mentions = detectMentions(section.body, targetText, targetRow.extracted_pages);
    linkMentions(mentions, references);

    const mailto = asString(Deno.env.get('CROSSREF_MAILTO')) || null;
    const openAlexKey = asString(Deno.env.get('OPENALEX_API_KEY')) || null;
    const verifiedReferences = await verifyReferences(references, mailto, openAlexKey);

    const { data: analysisId, error: saveError } = await client.rpc('save_citation_integrity_analysis', {
      p_target_version_id: targetVersionId,
      p_algorithm_version: ALGORITHM_VERSION,
      p_bibliography_found: section.found,
      p_bibliography_heading: section.heading,
      p_global_issues: issues,
      p_references: verifiedReferences,
      p_mentions: mentions,
    });
    if (saveError || typeof analysisId !== 'string') throw new Error(saveError?.message || 'No fue posible guardar la revisión de citas');

    return jsonResponse({
      analysis_id: analysisId,
      citations: mentions.length,
      references: verifiedReferences.length,
      bibliography_found: section.found,
      verified_references: verifiedReferences.filter((reference) => reference.verification_status === 'verified').length,
      not_found_references: verifiedReferences.filter((reference) => reference.verification_status === 'not_found').length,
    });
  } catch (error) {
    return jsonResponse({ error: safeError(error) }, 500);
  }
});
