import { loadLatestAiWritingAnalysis } from './aiWriting';
import { loadLatestCitationIntegrityAnalysis } from './citationIntegrity';
import { loadLatestExternalSimilarityAnalysis } from './externalSimilarity';
import { buildSimilarityViewModel, DEFAULT_SIMILARITY_FILTERS, tokenizeForViewer } from './similarityView';
import { loadLatestSimilarityAnalysis } from './similarity';
import { supabase } from './supabase';
import type { DocumentListItem, DocumentVersion } from '../types/documents';
import type { ExternalSimilarityMatch } from '../types/externalSimilarity';
import type {
  IntegrityReportFinalStatus,
  IntegrityReportRecord,
  IntegrityReportSnapshot,
} from '../types/integrityReport';
import type { SimilarityFilterSettings, SimilarityMatch } from '../types/similarity';

export const REPORT_SCHEMA_VERSION = 'siai-integrity-report-v1';

type WordRange = [number, number];

function requireClient() {
  if (!supabase) throw new Error('Supabase no está configurado.');
  return supabase;
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(row[key])}`).join(',')}}`;
}

async function sha256Text(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
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

function bibliographyStartWord(text: string): number | null {
  const accepted = new Set(['referencias', 'referencias bibliograficas', 'bibliografia', 'fuentes bibliograficas', 'references']);
  const tokens = tokenizeForViewer(text);
  const lines = text.split(/\r?\n/);
  let cursor = 0;
  let selected: number | null = null;
  for (const line of lines) {
    if (accepted.has(normalizeHeading(line)) && cursor >= text.length * 0.4) selected = cursor;
    cursor += line.length + 1;
  }
  if (selected === null) return null;
  const index = tokens.findIndex((token) => token.start >= selected!);
  return index >= 0 ? index : null;
}

function quotedWords(text: string): Set<number> {
  const tokens = tokenizeForViewer(text);
  const ranges: Array<[number, number]> = [];
  const patterns = [/“[^”]{2,4000}”/gs, /«[^»]{2,4000}»/gs, /"[^"\n]{2,1200}"/g];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      ranges.push([start, start + match[0].length]);
    }
  }
  const output = new Set<number>();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (ranges.some(([start, end]) => token.start < end && token.end > start)) output.add(index);
  }
  return output;
}

function expandRanges(ranges: WordRange[], tokenCount: number): number[] {
  const output = new Set<number>();
  for (const [rawStart, rawEnd] of ranges) {
    const start = Math.max(0, Math.min(tokenCount, Math.floor(rawStart)));
    const end = Math.max(start, Math.min(tokenCount, Math.floor(rawEnd)));
    for (let index = start; index < end; index += 1) output.add(index);
  }
  return [...output];
}

function internalMatchRanges(match: SimilarityMatch): WordRange[] {
  const supplied = match.target_covered_ranges;
  if (Array.isArray(supplied) && supplied.length) return supplied as WordRange[];
  return [[match.target_start_word, match.target_end_word]];
}

function externalMatchRanges(match: ExternalSimilarityMatch): WordRange[] {
  if (Array.isArray(match.target_covered_ranges) && match.target_covered_ranges.length) {
    return match.target_covered_ranges as WordRange[];
  }
  return [[match.target_start_word, match.target_end_word]];
}

function externalActiveWords(
  text: string,
  matches: ExternalSimilarityMatch[],
  settings: SimilarityFilterSettings,
): Set<number> {
  const tokenCount = tokenizeForViewer(text).length;
  const bibStart = settings.exclude_bibliography ? bibliographyStartWord(text) : null;
  const quoteSet = settings.exclude_quoted_text ? quotedWords(text) : new Set<number>();
  const output = new Set<number>();

  for (const match of matches) {
    const covered = expandRanges(externalMatchRanges(match), tokenCount);
    if (covered.length < settings.min_match_words) continue;
    const active = covered.filter((word) => {
      if (bibStart !== null && word >= bibStart) return false;
      if (quoteSet.has(word)) return false;
      return true;
    });
    if (active.length < settings.min_match_words) continue;
    active.forEach((word) => output.add(word));
  }
  return output;
}

function collectRawInternalWords(matches: SimilarityMatch[], tokenCount: number): Set<number> {
  const output = new Set<number>();
  for (const match of matches) expandRanges(internalMatchRanges(match), tokenCount).forEach((word) => output.add(word));
  return output;
}

function collectRawExternalWords(matches: ExternalSimilarityMatch[], tokenCount: number): Set<number> {
  const output = new Set<number>();
  for (const match of matches) expandRanges(externalMatchRanges(match), tokenCount).forEach((word) => output.add(word));
  return output;
}

function compactExcerpt(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 900);
}

export async function buildIntegrityReportSnapshot(
  document: DocumentListItem,
  version: DocumentVersion,
): Promise<IntegrityReportSnapshot> {
  const [internal, external, citations, ai] = await Promise.all([
    loadLatestSimilarityAnalysis(version.id),
    loadLatestExternalSimilarityAnalysis(version.id),
    loadLatestCitationIntegrityAnalysis(version.id),
    loadLatestAiWritingAnalysis(version.id),
  ]);

  const tokenCount = tokenizeForViewer(version.extracted_text).length;
  const settings: SimilarityFilterSettings = internal?.adjustment
    ? {
        exclude_bibliography: internal.adjustment.exclude_bibliography,
        exclude_quoted_text: internal.adjustment.exclude_quoted_text,
        min_match_words: internal.adjustment.min_match_words,
        excluded_source_ids: internal.adjustment.excluded_source_ids,
      }
    : { ...DEFAULT_SIMILARITY_FILTERS };

  const internalView = internal ? buildSimilarityViewModel(version.extracted_text, internal, settings) : null;
  const rawInternal = internal
    ? collectRawInternalWords(internal.sources.flatMap((source) => source.matches), tokenCount)
    : new Set<number>();
  const activeInternal = internalView ? new Set<number>(internalView.highlights.keys()) : new Set<number>();

  const verifiedExternal = external?.sources.filter((source) => source.verification_status === 'verified') ?? [];
  const externalMatches = verifiedExternal.flatMap((source) => source.matches);
  const rawExternal = collectRawExternalWords(externalMatches, tokenCount);
  const activeExternal = externalActiveWords(version.extracted_text, externalMatches, settings);

  const rawCombined = new Set<number>([...rawInternal, ...rawExternal]);
  const adjustedCombined = new Set<number>([...activeInternal, ...activeExternal]);
  const hasSimilarity = Boolean(internal || external);

  const internalSources = internal && internalView
    ? internalView.sources
        .filter((summary) => !summary.excluded && summary.adjustedMatchedWords > 0)
        .map((summary) => ({
          title: summary.source.source_title,
          version_number: summary.source.source_version_number,
          similarity_percent: summary.adjustedSimilarityPercent,
          matched_words: summary.adjustedMatchedWords,
          repository_label: 'Repositorio institucional ITSQMET',
          matches: internalView.matches
            .filter((match) => match.source.id === summary.source.id && match.active)
            .slice(0, 8)
            .map((match) => ({
              type: match.match.match_type,
              score: match.match.similarity_score,
              target_excerpt: compactExcerpt(match.match.target_excerpt),
              source_excerpt: compactExcerpt(match.match.source_excerpt),
            })),
        }))
    : [];

  const externalSources = verifiedExternal.map((source) => ({
    provider: source.provider,
    title: source.title,
    authors: source.authors,
    publication_year: source.publication_year,
    doi: source.doi,
    url: source.url ?? source.content_url,
    verification_scope: source.verification_scope,
    similarity_percent: source.similarity_percent,
    matched_words: source.matched_words,
    matches: source.matches.slice(0, 8).map((match) => ({
      type: match.match_type,
      score: match.similarity_score,
      target_excerpt: compactExcerpt(match.target_excerpt),
      source_excerpt: compactExcerpt(match.source_excerpt),
    })),
  }));

  const visibleAiSegments = ai?.segments
    .filter((segment) => segment.risk_level !== 'low' && segment.review?.decision !== 'dismissed')
    .map((segment) => ({
      segment_index: segment.segment_index,
      evidence_score: segment.evidence_score,
      risk_level: segment.risk_level,
      excerpt: compactExcerpt(segment.excerpt),
      signals: segment.signals.map((signal) => ({ label: signal.label, score: signal.score, detail: signal.detail })),
    })) ?? [];

  return {
    schema_version: REPORT_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    document: {
      document_id: document.id,
      version_id: version.id,
      title: document.title,
      owner_name: document.owner_name,
      owner_email: document.owner_email,
      version_number: version.version_number,
      original_file_name: version.original_file_name,
      sha256: version.sha256,
      word_count: version.word_count,
      page_count: version.page_count,
    },
    summary: {
      consolidated_similarity_original: hasSimilarity && tokenCount > 0 ? roundPercent((rawCombined.size / tokenCount) * 100) : null,
      consolidated_similarity_adjusted: hasSimilarity && tokenCount > 0 ? roundPercent((adjustedCombined.size / tokenCount) * 100) : null,
      internal_similarity_original: internal?.similarity_percent ?? null,
      internal_similarity_adjusted: internal ? (internalView?.adjustedSimilarityPercent ?? internal.similarity_percent) : null,
      external_similarity_verified: external?.similarity_percent ?? null,
      citation_count: citations?.citation_count ?? null,
      unlinked_citation_count: citations?.unlinked_citation_count ?? null,
      verified_reference_count: citations?.verified_reference_count ?? null,
      reference_not_found_count: citations?.suspicious_reference_count ?? null,
      apa_issue_count: citations?.apa_issue_count ?? null,
      ai_evidence_score: ai?.evidence_score ?? null,
      ai_flagged_word_percent: ai?.flagged_word_percent ?? null,
    },
    internal_similarity: internal ? {
      analysis_id: internal.id,
      algorithm_version: internal.algorithm_version,
      analyzed_at: internal.created_at,
      original_percent: internal.similarity_percent,
      adjusted_percent: internalView?.adjustedSimilarityPercent ?? internal.similarity_percent,
      matched_words: internal.matched_words,
      adjusted_matched_words: internalView?.adjustedMatchedWords ?? internal.matched_words,
      total_words: internal.total_words,
      filters: {
        exclude_bibliography: settings.exclude_bibliography,
        exclude_quoted_text: settings.exclude_quoted_text,
        min_match_words: settings.min_match_words,
        excluded_source_count: settings.excluded_source_ids.length,
      },
      sources: internalSources,
    } : null,
    external_similarity: external ? {
      analysis_id: external.id,
      algorithm_version: external.algorithm_version,
      analyzed_at: external.created_at,
      similarity_percent: external.similarity_percent,
      matched_words: external.matched_words,
      total_words: external.total_words,
      verified_source_count: external.verified_source_count,
      candidate_source_count: external.candidate_source_count,
      sources: externalSources,
    } : null,
    citation_integrity: citations ? {
      analysis_id: citations.id,
      algorithm_version: citations.algorithm_version,
      analyzed_at: citations.created_at,
      bibliography_found: citations.bibliography_found,
      citation_count: citations.citation_count,
      linked_citation_count: citations.linked_citation_count,
      unlinked_citation_count: citations.unlinked_citation_count,
      ambiguous_citation_count: citations.ambiguous_citation_count,
      reference_count: citations.reference_count,
      verified_reference_count: citations.verified_reference_count,
      reference_not_found_count: citations.suspicious_reference_count,
      uncited_reference_count: citations.uncited_reference_count,
      apa_issue_count: citations.apa_issue_count,
      global_issues: citations.global_issues,
      unlinked_citations: citations.mentions.filter((mention) => mention.link_status !== 'linked').map((mention) => mention.raw_citation),
      references: citations.references.map((reference) => ({
        ordinal: reference.ordinal,
        raw_reference: reference.raw_reference,
        status: reference.verification_status,
        provider: reference.verification_provider,
        confidence: reference.confidence,
        doi: reference.doi,
        cited_in_text_count: reference.cited_in_text_count,
        apa_issues: reference.apa_issues,
      })),
    } : null,
    ai_writing: ai ? {
      analysis_id: ai.id,
      algorithm_version: ai.algorithm_version,
      analyzed_at: ai.created_at,
      evidence_score: ai.evidence_score,
      flagged_word_percent: ai.flagged_word_percent,
      flagged_words: ai.flagged_words,
      analyzed_words: ai.analyzed_words,
      high_segment_count: ai.high_segment_count,
      medium_segment_count: ai.medium_segment_count,
      baseline_status: ai.baseline_status,
      baseline_source_count: ai.baseline_source_count,
      segments: visibleAiSegments,
    } : null,
    provenance: {
      internal_analysis_id: internal?.id ?? null,
      external_analysis_id: external?.id ?? null,
      citation_analysis_id: citations?.id ?? null,
      ai_analysis_id: ai?.id ?? null,
    },
  };
}

function normalizeReportRow(row: Record<string, unknown>): IntegrityReportRecord {
  return {
    id: String(row.id),
    target_version_id: String(row.target_version_id),
    target_document_id: String(row.target_document_id),
    created_by: String(row.created_by),
    report_number: Number(row.report_number),
    report_schema_version: String(row.report_schema_version),
    final_status: row.final_status as IntegrityReportFinalStatus,
    final_observation: row.final_observation === null ? null : String(row.final_observation),
    snapshot: row.snapshot as IntegrityReportSnapshot,
    snapshot_sha256: String(row.snapshot_sha256),
    released_to_student: Boolean(row.released_to_student),
    created_at: String(row.created_at),
  };
}

export async function saveIntegrityReport(
  document: DocumentListItem,
  version: DocumentVersion,
  finalStatus: IntegrityReportFinalStatus,
  finalObservation: string,
): Promise<IntegrityReportRecord> {
  const snapshot = await buildIntegrityReportSnapshot(document, version);
  const snapshotHash = await sha256Text(canonicalJson(snapshot));
  const client = requireClient();
  const { data, error } = await client.rpc('save_integrity_report_snapshot', {
    p_target_version_id: version.id,
    p_report_schema_version: REPORT_SCHEMA_VERSION,
    p_final_status: finalStatus,
    p_final_observation: finalObservation,
    p_snapshot: snapshot,
    p_snapshot_sha256: snapshotHash,
  });
  if (error) throw error;
  const reportId = typeof data === 'string' ? data : String(data ?? '');
  if (!reportId) throw new Error('Supabase no devolvió el identificador del informe.');
  const report = await loadIntegrityReport(reportId);
  if (!report) throw new Error('El informe se guardó, pero no fue posible volver a cargarlo.');
  return report;
}

export async function loadIntegrityReport(reportId: string): Promise<IntegrityReportRecord | null> {
  const client = requireClient();
  const { data, error } = await client
    .from('integrity_report_snapshots')
    .select('id,target_version_id,target_document_id,created_by,report_number,report_schema_version,final_status,final_observation,snapshot,snapshot_sha256,released_to_student,created_at')
    .eq('id', reportId)
    .maybeSingle();
  if (error) throw error;
  return data ? normalizeReportRow(data as Record<string, unknown>) : null;
}

export async function loadLatestIntegrityReport(targetVersionId: string): Promise<IntegrityReportRecord | null> {
  const client = requireClient();
  const { data, error } = await client
    .from('integrity_report_snapshots')
    .select('id,target_version_id,target_document_id,created_by,report_number,report_schema_version,final_status,final_observation,snapshot,snapshot_sha256,released_to_student,created_at')
    .eq('target_version_id', targetVersionId)
    .order('report_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? normalizeReportRow(data as Record<string, unknown>) : null;
}

export async function setIntegrityReportRelease(reportId: string, released: boolean): Promise<void> {
  const client = requireClient();
  const { error } = await client.rpc('set_integrity_report_release', {
    p_report_id: reportId,
    p_released: released,
  });
  if (error) throw error;
}

export async function verifyIntegrityReport(report: IntegrityReportRecord): Promise<boolean> {
  return (await sha256Text(canonicalJson(report.snapshot))) === report.snapshot_sha256;
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function percent(value: number | null): string {
  return value === null ? 'No disponible' : `${value.toFixed(1)} %`;
}

function statusLabel(value: IntegrityReportFinalStatus): string {
  const labels: Record<IntegrityReportFinalStatus, string> = {
    pending: 'Pendiente de decisión',
    approved: 'Aprobado',
    observed: 'Con observaciones',
    correction_required: 'Requiere corrección',
    rejected: 'No aprobado',
  };
  return labels[value];
}

export function buildIntegrityReportHtml(report: IntegrityReportRecord): string {
  const s = report.snapshot;
  const internalRows = s.internal_similarity?.sources.map((source, index) => `
    <div class="source"><div class="source-head"><b>${index + 1}. ${esc(source.title)}</b><span>${source.similarity_percent.toFixed(1)} %</span></div>
    <small>${esc(source.repository_label)} · V${source.version_number} · ${source.matched_words} palabras</small>
    ${source.matches.slice(0, 4).map((match) => `<p><b>${match.type === 'exact' ? 'Coincidencia textual' : 'Coincidencia cercana'}:</b> ${esc(match.target_excerpt)}</p>`).join('')}</div>`).join('') ?? '<p>Sin fuentes institucionales activas.</p>';

  const externalRows = s.external_similarity?.sources.map((source, index) => `
    <div class="source"><div class="source-head"><b>${index + 1}. ${esc(source.title)}</b><span>${source.similarity_percent.toFixed(1)} %</span></div>
    <small>${esc(source.provider)}${source.publication_year ? ` · ${source.publication_year}` : ''}${source.doi ? ` · DOI ${esc(source.doi)}` : ''}</small>
    ${source.matches.slice(0, 4).map((match) => `<p><b>${match.type === 'exact' ? 'Coincidencia textual' : 'Coincidencia cercana'}:</b> ${esc(match.target_excerpt)}</p>`).join('')}</div>`).join('') ?? '<p>Sin fuentes externas verificadas.</p>';

  const referenceRows = s.citation_integrity?.references.map((reference) => `
    <tr><td>${reference.ordinal}</td><td>${esc(reference.raw_reference)}</td><td>${esc(reference.status)}</td><td>${reference.confidence.toFixed(0)} %</td><td>${esc(reference.apa_issues.join('; ') || '—')}</td></tr>`).join('') ?? '';

  const aiRows = s.ai_writing?.segments.map((segment) => `
    <div class="ai-segment"><div class="source-head"><b>Fragmento ${segment.segment_index + 1} · ${segment.risk_level === 'high' ? 'Evidencia alta' : 'Evidencia media'}</b><span>${segment.evidence_score.toFixed(0)}/100</span></div>
    <p>${esc(segment.excerpt)}</p><small>${segment.signals.slice(0, 4).map((signal) => `${esc(signal.label)}: ${signal.score.toFixed(0)}/100`).join(' · ')}</small></div>`).join('') ?? '';

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Informe SIAI</title><style>
    @page{size:A4;margin:14mm 13mm 15mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#172033;font-size:10.5px;line-height:1.42;margin:0}h1{font-size:23px;margin:4px 0}h2{font-size:15px;margin:20px 0 8px;border-bottom:2px solid #dfe6f1;padding-bottom:5px}h3{font-size:12px;margin:14px 0 6px}.brand{font-size:12px;font-weight:700;letter-spacing:.12em;color:#41516f}.meta{color:#647089}.cover{padding:18px 0 12px}.status{display:inline-block;border:1px solid #aab7ca;border-radius:14px;padding:4px 9px;font-weight:700}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin:12px 0}.card{border:1px solid #dce3ed;border-radius:8px;padding:8px}.card b{display:block;font-size:16px}.card span{color:#657187;font-size:9px}.source,.ai-segment{border:1px solid #e0e6ef;border-radius:7px;padding:8px;margin:7px 0;break-inside:avoid}.source-head{display:flex;justify-content:space-between;gap:10px}.source-head span{font-weight:700;white-space:nowrap}.source p,.ai-segment p{margin:5px 0}.source small,.ai-segment small{color:#657187}table{width:100%;border-collapse:collapse;font-size:9px}th,td{border:1px solid #dfe5ee;padding:5px;vertical-align:top}th{background:#f2f5f9;text-align:left}.notice{border-left:4px solid #596d91;background:#f5f7fb;padding:8px 10px;margin:10px 0}.hash{font-family:monospace;font-size:8px;word-break:break-all}.footer{margin-top:18px;padding-top:8px;border-top:1px solid #dfe5ee;color:#657187;font-size:8.5px}.page-break{break-before:page}
  </style></head><body>
    <div class="cover"><div class="brand">SIAI · ITSQMET</div><h1>Informe de Integridad Académica y Similitud</h1><div class="meta">Informe #${report.report_number} · ${esc(new Date(report.created_at).toLocaleString('es-EC'))}</div></div>
    <h2>Identificación</h2><p><b>Estudiante:</b> ${esc(s.document.owner_name)}<br><b>Correo:</b> ${esc(s.document.owner_email)}<br><b>Trabajo:</b> ${esc(s.document.title)}<br><b>Archivo:</b> ${esc(s.document.original_file_name)} · Versión ${s.document.version_number}<br><b>Extensión:</b> ${s.document.word_count.toLocaleString('es-EC')} palabras${s.document.page_count ? ` · ${s.document.page_count} páginas` : ''}<br><b>SHA-256 del archivo:</b> <span class="hash">${esc(s.document.sha256)}</span></p>
    <p><span class="status">${esc(statusLabel(report.final_status))}</span></p>${report.final_observation ? `<div class="notice"><b>Observación final:</b> ${esc(report.final_observation)}</div>` : ''}
    <h2>Resumen ejecutivo</h2><div class="cards"><div class="card"><b>${percent(s.summary.consolidated_similarity_adjusted)}</b><span>Similitud consolidada ajustada</span></div><div class="card"><b>${percent(s.summary.internal_similarity_adjusted)}</b><span>Similitud institucional ajustada</span></div><div class="card"><b>${percent(s.summary.external_similarity_verified)}</b><span>Similitud externa verificada</span></div><div class="card"><b>${s.summary.ai_evidence_score === null ? 'N/D' : `${s.summary.ai_evidence_score.toFixed(0)}/100`}</b><span>Índice de evidencia IA</span></div></div>
    <div class="notice">La similitud consolidada se calcula mediante cobertura única de palabras encontradas en fuentes institucionales y externas; no se obtiene sumando porcentajes. Los indicadores de IA son evidencia para revisión humana y no una probabilidad de autoría.</div>
    <h2>1. Similitud institucional</h2>${s.internal_similarity ? `<p>Original: <b>${s.internal_similarity.original_percent.toFixed(1)} %</b> · Ajustada: <b>${s.internal_similarity.adjusted_percent.toFixed(1)} %</b> · ${s.internal_similarity.adjusted_matched_words.toLocaleString('es-EC')} palabras activas.</p><p class="meta">Filtros: bibliografía ${s.internal_similarity.filters.exclude_bibliography ? 'excluida' : 'incluida'} · citas textuales ${s.internal_similarity.filters.exclude_quoted_text ? 'excluidas' : 'incluidas'} · mínimo ${s.internal_similarity.filters.min_match_words} palabras · ${s.internal_similarity.filters.excluded_source_count} fuentes excluidas.</p>${internalRows}` : '<p>No existe un análisis institucional para esta versión.</p>'}
    <h2>2. Similitud externa verificada</h2>${s.external_similarity ? `<p>Similitud externa: <b>${s.external_similarity.similarity_percent.toFixed(1)} %</b> · ${s.external_similarity.verified_source_count} fuentes verificadas · ${s.external_similarity.candidate_source_count} candidatos no contabilizados.</p>${externalRows}` : '<p>No existe una búsqueda externa para esta versión.</p>'}
    <div class="page-break"></div><h2>3. Citas, referencias y APA 7</h2>${s.citation_integrity ? `<div class="cards"><div class="card"><b>${s.citation_integrity.citation_count}</b><span>Citas detectadas</span></div><div class="card"><b>${s.citation_integrity.unlinked_citation_count}</b><span>Citas sin referencia</span></div><div class="card"><b>${s.citation_integrity.verified_reference_count}</b><span>Referencias verificadas</span></div><div class="card"><b>${s.citation_integrity.apa_issue_count}</b><span>Hallazgos APA</span></div></div>${s.citation_integrity.global_issues.length ? `<div class="notice">${s.citation_integrity.global_issues.map(esc).join('<br>')}</div>` : ''}<table><thead><tr><th>#</th><th>Referencia</th><th>Verificación</th><th>Confianza</th><th>APA</th></tr></thead><tbody>${referenceRows}</tbody></table>` : '<p>No existe revisión bibliográfica para esta versión.</p>'}
    <h2>4. Indicadores de escritura asistida por IA</h2>${s.ai_writing ? `<p>Índice de evidencia: <b>${s.ai_writing.evidence_score.toFixed(0)}/100</b> · ${s.ai_writing.flagged_word_percent.toFixed(1)} % de palabras en fragmentos señalados · línea base: ${esc(s.ai_writing.baseline_status)}.</p>${aiRows || '<p>No quedaron fragmentos de evidencia media/alta después de la revisión del coordinador.</p>'}` : '<p>No existe análisis de indicadores de IA para esta versión.</p>'}
    <h2>5. Trazabilidad</h2><p class="hash"><b>Huella del informe:</b> ${esc(report.snapshot_sha256)}<br><b>Esquema:</b> ${esc(report.report_schema_version)}<br><b>Análisis institucional:</b> ${esc(s.provenance.internal_analysis_id ?? 'N/D')}<br><b>Análisis externo:</b> ${esc(s.provenance.external_analysis_id ?? 'N/D')}<br><b>Citas:</b> ${esc(s.provenance.citation_analysis_id ?? 'N/D')}<br><b>IA:</b> ${esc(s.provenance.ai_analysis_id ?? 'N/D')}</p>
    <div class="footer">SIAI presenta evidencia técnica para revisión académica. Un porcentaje de similitud, una referencia no localizada o un indicador de escritura asistida por IA no constituye por sí solo una conclusión de plagio, fabricación de fuentes o uso indebido de IA. La decisión académica corresponde al responsable de la evaluación.</div>
  </body></html>`;
}

function xmlEsc(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function cell(value: unknown, type: 'String' | 'Number' = 'String'): string {
  const normalized = type === 'Number' && typeof value === 'number' && Number.isFinite(value) ? value : String(value ?? '');
  return `<Cell><Data ss:Type="${type}">${xmlEsc(normalized)}</Data></Cell>`;
}

function row(values: Array<[unknown, 'String' | 'Number'?]>): string {
  return `<Row>${values.map(([value, type]) => cell(value, type ?? 'String')).join('')}</Row>`;
}

function sheet(name: string, rows: string[]): string {
  return `<Worksheet ss:Name="${xmlEsc(name.slice(0, 31))}"><Table>${rows.join('')}</Table></Worksheet>`;
}

export function buildIntegrityReportSpreadsheet(report: IntegrityReportRecord): string {
  const s = report.snapshot;
  const summaryRows = [
    row([['Campo'], ['Valor']]),
    row([['Informe'], [report.report_number, 'Number']]),
    row([['Estado final'], [statusLabel(report.final_status)]]),
    row([['Observación final'], [report.final_observation ?? '']]),
    row([['Estudiante'], [s.document.owner_name]]),
    row([['Correo'], [s.document.owner_email]]),
    row([['Trabajo'], [s.document.title]]),
    row([['Versión'], [s.document.version_number, 'Number']]),
    row([['Archivo'], [s.document.original_file_name]]),
    row([['SHA-256 archivo'], [s.document.sha256]]),
    row([['Similitud consolidada original'], [s.summary.consolidated_similarity_original ?? '', s.summary.consolidated_similarity_original === null ? 'String' : 'Number']]),
    row([['Similitud consolidada ajustada'], [s.summary.consolidated_similarity_adjusted ?? '', s.summary.consolidated_similarity_adjusted === null ? 'String' : 'Number']]),
    row([['Similitud interna ajustada'], [s.summary.internal_similarity_adjusted ?? '', s.summary.internal_similarity_adjusted === null ? 'String' : 'Number']]),
    row([['Similitud externa verificada'], [s.summary.external_similarity_verified ?? '', s.summary.external_similarity_verified === null ? 'String' : 'Number']]),
    row([['Índice evidencia IA'], [s.summary.ai_evidence_score ?? '', s.summary.ai_evidence_score === null ? 'String' : 'Number']]),
    row([['% palabras IA señaladas'], [s.summary.ai_flagged_word_percent ?? '', s.summary.ai_flagged_word_percent === null ? 'String' : 'Number']]),
    row([['Huella informe'], [report.snapshot_sha256]]),
  ];

  const internalRows = [row([['Fuente'], ['Versión'], ['% ajustado'], ['Palabras'], ['Repositorio']])];
  for (const source of s.internal_similarity?.sources ?? []) {
    internalRows.push(row([[source.title], [source.version_number, 'Number'], [source.similarity_percent, 'Number'], [source.matched_words, 'Number'], [source.repository_label]]));
  }

  const externalRows = [row([['Proveedor'], ['Título'], ['Autores'], ['Año'], ['DOI'], ['URL'], ['%'], ['Palabras']])];
  for (const source of s.external_similarity?.sources ?? []) {
    externalRows.push(row([[source.provider], [source.title], [source.authors.join('; ')], [source.publication_year ?? ''], [source.doi ?? ''], [source.url ?? ''], [source.similarity_percent, 'Number'], [source.matched_words, 'Number']]));
  }

  const citationRows = [row([['Indicador'], ['Valor']])];
  if (s.citation_integrity) {
    citationRows.push(
      row([['Citas'], [s.citation_integrity.citation_count, 'Number']]),
      row([['Citas enlazadas'], [s.citation_integrity.linked_citation_count, 'Number']]),
      row([['Citas sin referencia'], [s.citation_integrity.unlinked_citation_count, 'Number']]),
      row([['Citas ambiguas'], [s.citation_integrity.ambiguous_citation_count, 'Number']]),
      row([['Referencias'], [s.citation_integrity.reference_count, 'Number']]),
      row([['Referencias verificadas'], [s.citation_integrity.verified_reference_count, 'Number']]),
      row([['Referencias no localizadas'], [s.citation_integrity.reference_not_found_count, 'Number']]),
      row([['Referencias no citadas'], [s.citation_integrity.uncited_reference_count, 'Number']]),
      row([['Hallazgos APA'], [s.citation_integrity.apa_issue_count, 'Number']]),
    );
  }

  const referenceRows = [row([['#'], ['Referencia'], ['Estado'], ['Proveedor'], ['Confianza'], ['DOI'], ['Veces citada'], ['Hallazgos APA']])];
  for (const reference of s.citation_integrity?.references ?? []) {
    referenceRows.push(row([[reference.ordinal, 'Number'], [reference.raw_reference], [reference.status], [reference.provider ?? ''], [reference.confidence, 'Number'], [reference.doi ?? ''], [reference.cited_in_text_count, 'Number'], [reference.apa_issues.join('; ')]]));
  }

  const aiRows = [row([['Fragmento'], ['Riesgo'], ['Índice'], ['Texto'], ['Señales']])];
  for (const segment of s.ai_writing?.segments ?? []) {
    aiRows.push(row([[segment.segment_index + 1, 'Number'], [segment.risk_level], [segment.evidence_score, 'Number'], [segment.excerpt], [segment.signals.map((signal) => `${signal.label}: ${signal.score.toFixed(0)}`).join('; ')]]));
  }

  return `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${[
    sheet('Resumen', summaryRows),
    sheet('Similitud interna', internalRows),
    sheet('Fuentes externas', externalRows),
    sheet('Citas y APA', citationRows),
    sheet('Referencias', referenceRows),
    sheet('Indicadores IA', aiRows),
  ].join('')}</Workbook>`;
}

function reportFileStem(report: IntegrityReportRecord): string {
  const name = report.snapshot.document.owner_name || 'estudiante';
  return `SIAI_Informe_${report.report_number}_${name}`.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 100);
}

export async function exportIntegrityReportPdf(report: IntegrityReportRecord): Promise<{ canceled: boolean; filePath: string | null }> {
  if (!window.siaiDesktop?.savePdf) throw new Error('La exportación PDF solo está disponible en la aplicación de escritorio.');
  if (!(await verifyIntegrityReport(report))) throw new Error('La huella del informe no coincide con la instantánea almacenada.');
  return window.siaiDesktop.savePdf(buildIntegrityReportHtml(report), `${reportFileStem(report)}.pdf`);
}

export async function exportIntegrityReportExcel(report: IntegrityReportRecord): Promise<{ canceled: boolean; filePath: string | null }> {
  if (!window.siaiDesktop?.saveExcel) throw new Error('La exportación Excel solo está disponible en la aplicación de escritorio.');
  if (!(await verifyIntegrityReport(report))) throw new Error('La huella del informe no coincide con la instantánea almacenada.');
  return window.siaiDesktop.saveExcel(buildIntegrityReportSpreadsheet(report), `${reportFileStem(report)}.xls`);
}
