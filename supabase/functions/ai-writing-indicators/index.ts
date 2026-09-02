import { createClient } from 'npm:@supabase/supabase-js@2';

const ALGORITHM_VERSION = 'siai-ai-evidence-v1';
const TARGET_SEGMENT_WORDS = 140;
const MIN_SEGMENT_WORDS = 55;
const MAX_TARGET_TEXT_CHARS = 1_500_000;
const MAX_BASELINE_VERSIONS = 6;
const MAX_BASELINE_TEXT_CHARS = 500_000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type UnknownRecord = Record<string, unknown>;
type RiskLevel = 'low' | 'medium' | 'high';
type BaselineStatus = 'student_history' | 'document_internal' | 'limited';

interface Token {
  raw: string;
  normalized: string;
  start: number;
  end: number;
}

interface Features {
  sentence_mean: number;
  sentence_cv: number;
  lexical_diversity: number;
  average_word_length: number;
  punctuation_per_100: number;
  commas_per_sentence: number;
  connectors_per_100: number;
  function_word_ratio: number;
  repeated_trigram_ratio: number;
  repeated_opener_ratio: number;
}

interface SegmentDraft {
  segmentIndex: number;
  startChar: number;
  endChar: number;
  startWord: number;
  endWord: number;
  wordCount: number;
  text: string;
  features: Features;
}

interface Signal {
  key: string;
  label: string;
  score: number;
  weight: number;
  detail: string;
}

interface SegmentResult extends SegmentDraft {
  evidenceScore: number;
  riskLevel: RiskLevel;
  baselineDistance: number | null;
  previousOverlapPercent: number | null;
  signals: Signal[];
}

const FUNCTION_WORDS = new Set([
  'de', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'en', 'del', 'al', 'para', 'por', 'con',
  'sin', 'que', 'se', 'es', 'son', 'como', 'su', 'sus', 'a', 'e', 'u', 'lo', 'le', 'les', 'este', 'esta', 'estos',
  'estas', 'entre', 'desde', 'hasta', 'sobre', 'durante', 'mediante', 'tambien', 'también', 'más', 'mas', 'menos', 'ya',
  'si', 'sí', 'no', 'pero', 'porque', 'cuando', 'donde', 'cual', 'cuales', 'the', 'and', 'of', 'to', 'in', 'for', 'with',
  'is', 'are', 'this', 'that', 'from', 'as', 'by', 'on', 'or', 'be', 'was', 'were',
]);

const FORMULAIC_CONNECTORS = [
  'en este sentido', 'por otro lado', 'por otra parte', 'cabe destacar', 'es importante señalar', 'es importante destacar',
  'en conclusión', 'en consecuencia', 'de esta manera', 'de este modo', 'en este contexto', 'por consiguiente',
  'asimismo', 'además', 'adicionalmente', 'en definitiva', 'a partir de lo anterior', 'en relación con', 'con base en',
  'resulta fundamental', 'resulta importante', 'desde esta perspectiva', 'en términos generales',
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function asRecord(value: unknown): UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals = 2): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function normalizeWord(value: string): string {
  return value.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeKey(value: string): string {
  return normalizeWord(value).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    const start = match.index ?? 0;
    tokens.push({ raw: match[0], normalized: normalizeWord(match[0]), start, end: start + match[0].length });
  }
  return tokens;
}

function bibliographyCut(text: string): number {
  const headings = new Set(['referencias', 'referencias bibliograficas', 'bibliografia', 'references']);
  let cursor = 0;
  for (const line of text.split(/\r?\n/)) {
    if (cursor > text.length * 0.42 && headings.has(normalizeKey(line))) return cursor;
    cursor += line.length + 1;
  }
  return text.length;
}

function scrubLongQuotes(value: string): string {
  const chars = [...value];
  const patterns = [/“[^”]{60,}”/gu, /"[^"\n]{60,}"/gu, /‘[^’]{60,}’/gu];
  for (const pattern of patterns) {
    for (const match of value.matchAll(pattern)) {
      const start = match.index ?? 0;
      for (let index = start; index < start + match[0].length && index < chars.length; index += 1) chars[index] = ' ';
    }
  }
  return chars.join('');
}

function sentenceStrings(text: string): string[] {
  return (text.match(/[^.!?]+(?:[.!?]+|$)/gu) ?? []).map((sentence) => sentence.trim()).filter((sentence) => tokenize(sentence).length >= 3);
}

function coefficientOfVariation(values: number[]): number {
  if (values.length < 2) return 0.7;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (mean <= 0) return 0.7;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

function countFormulaicConnectors(text: string): number {
  const normalized = normalizeKey(text);
  let count = 0;
  for (const connector of FORMULAIC_CONNECTORS) {
    const needle = normalizeKey(connector);
    let cursor = 0;
    while (needle && (cursor = normalized.indexOf(needle, cursor)) >= 0) {
      count += 1;
      cursor += needle.length;
    }
  }
  return count;
}

function repeatedTrigramRatio(tokens: Token[]): number {
  if (tokens.length < 8) return 0;
  const counts = new Map<string, number>();
  let total = 0;
  for (let index = 0; index <= tokens.length - 3; index += 1) {
    const key = tokens.slice(index, index + 3).map((token) => token.normalized).join(' ');
    counts.set(key, (counts.get(key) ?? 0) + 1);
    total += 1;
  }
  let repeated = 0;
  for (const count of counts.values()) if (count > 1) repeated += count - 1;
  return total ? repeated / total : 0;
}

function repeatedOpenerRatio(sentences: string[]): number {
  if (sentences.length < 4) return 0;
  const counts = new Map<string, number>();
  for (const sentence of sentences) {
    const words = tokenize(sentence).slice(0, 2).map((token) => token.normalized);
    if (!words.length) continue;
    const key = words.join(' ');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let repeated = 0;
  for (const count of counts.values()) if (count > 1) repeated += count - 1;
  return repeated / Math.max(1, sentences.length - 1);
}

function extractFeatures(text: string): Features {
  const clean = scrubLongQuotes(text);
  const tokens = tokenize(clean);
  const sentences = sentenceStrings(clean);
  const sentenceLengths = sentences.map((sentence) => tokenize(sentence).length);
  const sentenceMean = sentenceLengths.length
    ? sentenceLengths.reduce((sum, value) => sum + value, 0) / sentenceLengths.length
    : Math.max(1, tokens.length);
  const unique = new Set(tokens.map((token) => token.normalized));
  const punctuationCount = (clean.match(/[,:;.!?()]/g) ?? []).length;
  const commaCount = (clean.match(/,/g) ?? []).length;
  const connectorCount = countFormulaicConnectors(clean);
  const functionWords = tokens.filter((token) => FUNCTION_WORDS.has(token.normalized)).length;
  const totalWordLength = tokens.reduce((sum, token) => sum + token.raw.length, 0);

  return {
    sentence_mean: round(sentenceMean, 3),
    sentence_cv: round(coefficientOfVariation(sentenceLengths), 4),
    lexical_diversity: round(tokens.length ? unique.size / tokens.length : 0, 4),
    average_word_length: round(tokens.length ? totalWordLength / tokens.length : 0, 3),
    punctuation_per_100: round(tokens.length ? punctuationCount / tokens.length * 100 : 0, 3),
    commas_per_sentence: round(sentences.length ? commaCount / sentences.length : 0, 3),
    connectors_per_100: round(tokens.length ? connectorCount / tokens.length * 100 : 0, 3),
    function_word_ratio: round(tokens.length ? functionWords / tokens.length : 0, 4),
    repeated_trigram_ratio: round(repeatedTrigramRatio(tokens), 4),
    repeated_opener_ratio: round(repeatedOpenerRatio(sentences), 4),
  };
}

function splitIntoSegments(text: string): SegmentDraft[] {
  const body = text.slice(0, bibliographyCut(text));
  const tokens = tokenize(body);
  if (tokens.length < MIN_SEGMENT_WORDS) return [];

  const segments: SegmentDraft[] = [];
  let startWord = 0;
  let segmentIndex = 0;
  while (startWord < tokens.length) {
    let endWord = Math.min(tokens.length, startWord + TARGET_SEGMENT_WORDS);
    if (tokens.length - endWord < MIN_SEGMENT_WORDS && endWord < tokens.length) endWord = tokens.length;
    const selected = tokens.slice(startWord, endWord);
    if (selected.length < MIN_SEGMENT_WORDS && segments.length) {
      const previous = segments[segments.length - 1];
      previous.endWord = endWord;
      previous.endChar = selected[selected.length - 1].end;
      previous.wordCount = previous.endWord - previous.startWord;
      previous.text = body.slice(previous.startChar, previous.endChar);
      previous.features = extractFeatures(previous.text);
      break;
    }
    const startChar = selected[0].start;
    const endChar = selected[selected.length - 1].end;
    const segmentText = body.slice(startChar, endChar);
    segments.push({
      segmentIndex,
      startChar,
      endChar,
      startWord,
      endWord,
      wordCount: selected.length,
      text: segmentText,
      features: extractFeatures(segmentText),
    });
    segmentIndex += 1;
    startWord = endWord;
  }
  return segments;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function medianFeatures(features: Features[]): Features {
  const key = <K extends keyof Features>(name: K): number => median(features.map((item) => item[name]));
  return {
    sentence_mean: key('sentence_mean'),
    sentence_cv: key('sentence_cv'),
    lexical_diversity: key('lexical_diversity'),
    average_word_length: key('average_word_length'),
    punctuation_per_100: key('punctuation_per_100'),
    commas_per_sentence: key('commas_per_sentence'),
    connectors_per_100: key('connectors_per_100'),
    function_word_ratio: key('function_word_ratio'),
    repeated_trigram_ratio: key('repeated_trigram_ratio'),
    repeated_opener_ratio: key('repeated_opener_ratio'),
  };
}

function styleDistance(left: Features, right: Features): number {
  const scales: Record<keyof Features, number> = {
    sentence_mean: 12,
    sentence_cv: 0.28,
    lexical_diversity: 0.13,
    average_word_length: 0.8,
    punctuation_per_100: 3.2,
    commas_per_sentence: 0.9,
    connectors_per_100: 1.4,
    function_word_ratio: 0.075,
    repeated_trigram_ratio: 0.045,
    repeated_opener_ratio: 0.18,
  };
  const keys = Object.keys(scales) as Array<keyof Features>;
  const squared = keys.map((key) => ((left[key] - right[key]) / scales[key]) ** 2);
  const rms = Math.sqrt(squared.reduce((sum, value) => sum + value, 0) / squared.length);
  return round(clamp(rms * 38, 0, 100), 2);
}

function shingleSet(text: string, size = 5): Set<string> {
  const words = tokenize(text).map((token) => token.normalized);
  const shingles = new Set<string>();
  for (let index = 0; index <= words.length - size; index += 1) shingles.add(words.slice(index, index + size).join('\u001f'));
  return shingles;
}

function overlapWithPrevious(text: string, previous: Set<string> | null): number | null {
  if (!previous) return null;
  const current = shingleSet(text);
  if (!current.size) return 0;
  let overlap = 0;
  for (const shingle of current) if (previous.has(shingle)) overlap += 1;
  return round(overlap / current.size * 100, 2);
}

function makeSignal(key: string, label: string, score: number, weight: number, detail: string): Signal {
  return { key, label, score: round(clamp(score), 2), weight, detail };
}

function evaluateSegment(
  segment: SegmentDraft,
  documentBaseline: Features,
  studentBaseline: Features | null,
  previousShingles: Set<string> | null,
): SegmentResult {
  const f = segment.features;
  const documentDistance = styleDistance(f, documentBaseline);
  const baselineDistance = studentBaseline ? styleDistance(f, studentBaseline) : null;
  const previousOverlapPercent = overlapWithPrevious(segment.text, previousShingles);

  const signals: Signal[] = [
    makeSignal(
      'document_style_shift',
      'Cambio de estilo dentro del documento',
      documentDistance,
      0.27,
      `Distancia estilométrica interna ${documentDistance.toFixed(0)}/100. Un cambio fuerte merece revisión, pero no identifica por sí solo el origen del texto.`,
    ),
    makeSignal(
      'sentence_uniformity',
      'Uniformidad de longitud de oraciones',
      clamp((0.56 - f.sentence_cv) / 0.38 * 100),
      0.14,
      `Variación relativa de longitud de oraciones: ${f.sentence_cv.toFixed(2)}.`,
    ),
    makeSignal(
      'phrase_repetition',
      'Repetición de secuencias',
      clamp((f.repeated_trigram_ratio - 0.012) / 0.075 * 100),
      0.12,
      `Proporción de trigramas repetidos: ${(f.repeated_trigram_ratio * 100).toFixed(1)}%.`,
    ),
    makeSignal(
      'formulaic_connectors',
      'Conectores formulaicos',
      clamp((f.connectors_per_100 - 1.1) / 2.8 * 100),
      0.07,
      `Conectores académicos formulaicos: ${f.connectors_per_100.toFixed(1)} por cada 100 palabras.`,
    ),
    makeSignal(
      'sentence_openers',
      'Inicio repetitivo de oraciones',
      clamp((f.repeated_opener_ratio - 0.08) / 0.42 * 100),
      0.05,
      `Repetición de aperturas de oración: ${(f.repeated_opener_ratio * 100).toFixed(1)}%.`,
    ),
  ];

  if (studentBaseline && baselineDistance !== null) {
    signals.push(makeSignal(
      'student_baseline_mismatch',
      'Diferencia frente al historial del estudiante',
      baselineDistance,
      0.30,
      `Distancia frente a la línea base de versiones previas: ${baselineDistance.toFixed(0)}/100.`,
    ));
  }

  if (previousOverlapPercent !== null) {
    const novelty = 100 - previousOverlapPercent;
    signals.push(makeSignal(
      'revision_novelty',
      'Bloque nuevo respecto a la versión anterior',
      clamp((novelty - 60) / 35 * 100),
      0.05,
      `Coincidencia por shingles con la versión anterior: ${previousOverlapPercent.toFixed(1)}%. Un bloque nuevo no implica uso de IA; solo aporta contexto.`,
    ));
  }

  const weightTotal = signals.reduce((sum, signal) => sum + signal.weight, 0);
  let evidenceScore = signals.reduce((sum, signal) => sum + signal.score * signal.weight, 0) / Math.max(0.01, weightTotal);
  const strongSignals = signals.filter((signal) => signal.score >= 65).length;
  const styleStrong = documentDistance >= 60 || (baselineDistance ?? 0) >= 60;

  if (evidenceScore >= 72 && (strongSignals < 2 || !styleStrong)) evidenceScore = 68;
  evidenceScore = round(clamp(evidenceScore), 2);

  const riskLevel: RiskLevel = evidenceScore >= 72 ? 'high' : evidenceScore >= 48 ? 'medium' : 'low';
  return {
    ...segment,
    evidenceScore,
    riskLevel,
    baselineDistance,
    previousOverlapPercent,
    signals: signals.sort((a, b) => b.score * b.weight - a.score * a.weight),
  };
}

function safeError(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 500);
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
      .select('id,document_id,version_number,extracted_text,word_count,extraction_status')
      .eq('id', targetVersionId)
      .single();
    if (targetError || !targetRow) return jsonResponse({ error: 'La versión objetivo no existe o no es accesible' }, 404);
    if (targetRow.extraction_status !== 'ready') return jsonResponse({ error: 'La versión objetivo no tiene texto listo' }, 400);

    const targetText = asString(targetRow.extracted_text).slice(0, MAX_TARGET_TEXT_CHARS);
    const segments = splitIntoSegments(targetText);
    if (!segments.length) return jsonResponse({ error: 'El documento no tiene suficiente texto analizable fuera de la bibliografía' }, 400);

    const { data: documentRow, error: documentError } = await client
      .from('documents')
      .select('id,owner_id')
      .eq('id', targetRow.document_id)
      .single();
    if (documentError || !documentRow) return jsonResponse({ error: 'No fue posible identificar al propietario del documento' }, 404);

    const documentBaseline = medianFeatures(segments.map((segment) => segment.features));

    const { data: sameDocumentRows } = await client
      .from('document_versions')
      .select('id,document_id,version_number,extracted_text,word_count')
      .eq('document_id', targetRow.document_id)
      .eq('extraction_status', 'ready')
      .neq('id', targetVersionId)
      .order('version_number', { ascending: false })
      .limit(MAX_BASELINE_VERSIONS);

    const { data: ownerDocuments } = await client
      .from('documents')
      .select('id')
      .eq('owner_id', documentRow.owner_id)
      .neq('id', targetRow.document_id)
      .limit(8);

    const ownerDocumentIds = (ownerDocuments ?? []).map((row) => String(row.id));
    let otherRows: Array<Record<string, unknown>> = [];
    if (ownerDocumentIds.length) {
      const { data } = await client
        .from('document_versions')
        .select('id,document_id,version_number,extracted_text,word_count')
        .in('document_id', ownerDocumentIds)
        .eq('extraction_status', 'ready')
        .order('created_at', { ascending: false })
        .limit(MAX_BASELINE_VERSIONS);
      otherRows = (data ?? []) as Array<Record<string, unknown>>;
    }

    const baselineRows = [...(sameDocumentRows ?? []), ...otherRows]
      .filter((row, index, all) => all.findIndex((item) => item.id === row.id) === index)
      .slice(0, MAX_BASELINE_VERSIONS);

    const baselineFeatures: Features[] = [];
    let baselineWords = 0;
    for (const row of baselineRows) {
      const text = asString(row.extracted_text).slice(0, MAX_BASELINE_TEXT_CHARS);
      const baselineSegments = splitIntoSegments(text).slice(0, 8);
      baselineFeatures.push(...baselineSegments.map((segment) => segment.features));
      baselineWords += asNumber(row.word_count) ?? tokenize(text).length;
    }

    const studentBaseline = baselineWords >= 500 && baselineFeatures.length >= 2 ? medianFeatures(baselineFeatures) : null;
    const baselineStatus: BaselineStatus = studentBaseline
      ? 'student_history'
      : segments.length >= 3
        ? 'document_internal'
        : 'limited';

    const targetVersionNumber = asNumber(targetRow.version_number) ?? 1;
    const previousVersion = (sameDocumentRows ?? [])
      .filter((row) => (asNumber(row.version_number) ?? 0) < targetVersionNumber)
      .sort((a, b) => (asNumber(b.version_number) ?? 0) - (asNumber(a.version_number) ?? 0))[0];
    const previousShingles = previousVersion ? shingleSet(asString(previousVersion.extracted_text)) : null;

    const evaluated = segments.map((segment) => evaluateSegment(segment, documentBaseline, studentBaseline, previousShingles));
    const analyzedWords = evaluated.reduce((sum, segment) => sum + segment.wordCount, 0);
    const flagged = evaluated.filter((segment) => segment.riskLevel !== 'low');
    const flaggedWords = flagged.reduce((sum, segment) => sum + segment.wordCount, 0);
    const weightedMean = evaluated.reduce((sum, segment) => sum + segment.evidenceScore * segment.wordCount, 0) / Math.max(1, analyzedWords);
    const ranked = [...evaluated].sort((a, b) => b.evidenceScore - a.evidenceScore);
    const topCount = Math.max(1, Math.ceil(ranked.length / 3));
    const topMean = ranked.slice(0, topCount).reduce((sum, segment) => sum + segment.evidenceScore, 0) / topCount;
    const evidenceScore = round(weightedMean * 0.65 + topMean * 0.35, 2);
    const flaggedWordPercent = round(flaggedWords / Math.max(1, analyzedWords) * 100, 2);

    const summary = {
      methodology: 'stylometric_multi_signal',
      probability_claim: false,
      disclaimer: 'El índice combina señales estilométricas y de revisión. No identifica de forma concluyente si una persona o un modelo escribió el texto.',
      baseline_words: baselineWords,
      baseline_versions: baselineRows.length,
      previous_version_available: Boolean(previousVersion),
      segments_analyzed: evaluated.length,
      high_segments: evaluated.filter((segment) => segment.riskLevel === 'high').length,
      medium_segments: evaluated.filter((segment) => segment.riskLevel === 'medium').length,
      thresholds: { medium: 48, high: 72 },
      signals_used: [
        'document_style_shift', 'student_baseline_mismatch', 'sentence_uniformity', 'phrase_repetition',
        'formulaic_connectors', 'sentence_openers', 'revision_novelty',
      ],
    };

    const payload = evaluated.map((segment) => ({
      segment_index: segment.segmentIndex,
      start_char: segment.startChar,
      end_char: segment.endChar,
      start_word: segment.startWord,
      end_word: segment.endWord,
      word_count: segment.wordCount,
      excerpt: segment.text.replace(/\s+/g, ' ').trim().slice(0, 5000),
      evidence_score: segment.evidenceScore,
      risk_level: segment.riskLevel,
      baseline_distance: segment.baselineDistance,
      previous_overlap_percent: segment.previousOverlapPercent,
      signals: segment.signals,
      feature_snapshot: segment.features,
    }));

    const { data: analysisId, error: saveError } = await client.rpc('save_ai_writing_analysis', {
      p_target_version_id: targetVersionId,
      p_algorithm_version: ALGORITHM_VERSION,
      p_evidence_score: evidenceScore,
      p_flagged_word_percent: flaggedWordPercent,
      p_flagged_words: flaggedWords,
      p_analyzed_words: analyzedWords,
      p_baseline_source_count: baselineRows.length,
      p_baseline_status: baselineStatus,
      p_summary: summary,
      p_segments: payload,
    });
    if (saveError || typeof analysisId !== 'string') throw new Error(saveError?.message || 'No fue posible guardar el análisis de escritura asistida');

    return jsonResponse({
      analysis_id: analysisId,
      evidence_score: evidenceScore,
      flagged_word_percent: flaggedWordPercent,
      flagged_words: flaggedWords,
      analyzed_words: analyzedWords,
      baseline_status: baselineStatus,
      baseline_source_count: baselineRows.length,
    });
  } catch (error) {
    return jsonResponse({ error: safeError(error) }, 500);
  }
});
