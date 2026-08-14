import { loadLatestAiWritingAnalysis } from './aiWriting';
import { loadLatestCitationIntegrityAnalysis } from './citationIntegrity';
import { loadLatestExternalSimilarityAnalysis } from './externalSimilarity';
import { loadLatestSimilarityAnalysis } from './similarity';
import { buildSimilarityViewModel, DEFAULT_SIMILARITY_FILTERS, tokenizeForViewer } from './similarityView';
import { supabase } from './supabase';
import type { DocumentListItem, DocumentVersion } from '../types/documents';
import type { ExternalSimilarityMatch } from '../types/externalSimilarity';
import type { IntegrityReportFinalStatus, IntegrityReportRecord, IntegrityReportSnapshot } from '../types/integrityReport';
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
  if (value === undefined) return 'null';
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
  return value.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
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
  const index = tokens.findIndex((token) => token.start >= selected);
  return index >= 0 ? index : null;
}

function quotedWords(text: string): Set<number> {
  const tokens = tokenizeForViewer(text);
  const ranges: Array<[number, number]> = [];
  for (const pattern of [/“[^”]{2,4000}”/gs, /«[^»]{2,4000}»/gs, /"[^"\n]{2,1200}"/g]) {
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      ranges.push([start, start + match[0].length]);
    }
  }
  const output = new Set<number>();
  tokens.forEach((token, index) => {
    if (ranges.some(([start, end]) => token.start < end && token.end > start)) output.add(index);
  });
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

function internalRanges(match: SimilarityMatch): WordRange[] {
  return Array.isArray(match.target_covered_ranges) && match.target_covered_ranges.length
    ? match.target_covered_ranges as WordRange[]
    : [[match.target_start_word, match.target_end_word]];
}

function externalRanges(match: ExternalSimilarityMatch): WordRange[] {
  return Array.isArray(match.target_covered_ranges) && match.target_covered_ranges.length
    ? match.target_covered_ranges as WordRange[]
    : [[match.target_start_word, match.target_end_word]];
}

function rawInternalWords(matches: SimilarityMatch[], tokenCount: number): Set<number> {
  const output = new Set<number>();
  matches.forEach((match) => expandRanges(internalRanges(match), tokenCount).forEach((word) => output.add(word)));
  return output;
}

function rawExternalWords(matches: ExternalSimilarityMatch[], tokenCount: number): Set<number> {
  const output = new Set<number>();
  matches.forEach((match) => expandRanges(externalRanges(match), tokenCount).forEach((word) => output.add(word)));
  return output;
}

function adjustedExternalWords(text: string, matches: ExternalSimilarityMatch[], settings: SimilarityFilterSettings): Set<number> {
  const tokenCount = tokenizeForViewer(text).length;
  const bibStart = settings.exclude_bibliography ? bibliographyStartWord(text) : null;
  const quoteSet = settings.exclude_quoted_text ? quotedWords(text) : new Set<number>();
  const output = new Set<number>();
  for (const match of matches) {
    const covered = expandRanges(externalRanges(match), tokenCount);
    if (covered.length < settings.min_match_words) continue;
    const active = covered.filter((word) => !(bibStart !== null && word >= bibStart) && !quoteSet.has(word));
    if (active.length < settings.min_match_words) continue;
    active.forEach((word) => output.add(word));
  }
  return output;
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 900);
}

export async function buildIntegrityReportSnapshot(document: DocumentListItem, version: DocumentVersion): Promise<IntegrityReportSnapshot> {
  const [internal, external, citations, ai] = await Promise.all([
    loadLatestSimilarityAnalysis(version.id),
    loadLatestExternalSimilarityAnalysis(version.id),
    loadLatestCitationIntegrityAnalysis(version.id),
    loadLatestAiWritingAnalysis(version.id),
  ]);

  const tokenCount = tokenizeForViewer(version.extracted_text).length;
  const settings: SimilarityFilterSettings = internal?.adjustment ? {
    exclude_bibliography: internal.adjustment.exclude_bibliography,
    exclude_quoted_text: internal.adjustment.exclude_quoted_text,
    min_match_words: internal.adjustment.min_match_words,
    excluded_source_ids: internal.adjustment.excluded_source_ids,
  } : { ...DEFAULT_SIMILARITY_FILTERS };

  const internalView = internal ? buildSimilarityViewModel(version.extracted_text, internal, settings) : null;
  const rawInternal = internal ? rawInternalWords(internal.sources.flatMap((source) => source.matches), tokenCount) : new Set<number>();
  const activeInternal = internalView ? new Set<number>(internalView.highlights.keys()) : new Set<number>();
  const verifiedExternal = external?.sources.filter((source) => source.verification_status === 'verified') ?? [];
  const extMatches = verifiedExternal.flatMap((source) => source.matches);
  const rawExternal = rawExternalWords(extMatches, tokenCount);
  const activeExternal = adjustedExternalWords(version.extracted_text, extMatches, settings);
  const rawCombined = new Set<number>([...rawInternal, ...rawExternal]);
  const adjustedCombined = new Set<number>([...activeInternal, ...activeExternal]);
  const hasSimilarity = Boolean(internal || external);

  const internalSources = internal && internalView ? internalView.sources
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
          target_excerpt: compact(match.match.target_excerpt),
          source_excerpt: compact(match.match.source_excerpt),
        })),
    })) : [];

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
      target_excerpt: compact(match.target_excerpt),
      source_excerpt: compact(match.source_excerpt),
    })),
  }));

  const aiSegments = ai?.segments
    .filter((segment) => segment.risk_level !== 'low' && segment.review?.decision !== 'dismissed')
    .map((segment) => ({
      segment_index: segment.segment_index,
      evidence_score: segment.evidence_score,
      risk_level: segment.risk_level,
      excerpt: compact(segment.excerpt),
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
      internal_similarity_adjusted: internal ? internalView?.adjustedSimilarityPercent ?? internal.similarity_percent : null,
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
      segments: aiSegments,
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

export async function saveIntegrityReport(document: DocumentListItem, version: DocumentVersion, finalStatus: IntegrityReportFinalStatus, finalObservation: string): Promise<IntegrityReportRecord> {
  const snapshot = await buildIntegrityReportSnapshot(document, version);
  const hash = await sha256Text(canonicalJson(snapshot));
  const client = requireClient();
  const { data, error } = await client.rpc('save_integrity_report_snapshot', {
    p_target_version_id: version.id,
    p_report_schema_version: REPORT_SCHEMA_VERSION,
    p_final_status: finalStatus,
    p_final_observation: finalObservation,
    p_snapshot: snapshot,
    p_snapshot_sha256: hash,
  });
  if (error) throw error;
  const id = typeof data === 'string' ? data : String(data ?? '');
  if (!id) throw new Error('Supabase no devolvió el identificador del informe.');
  const report = await loadIntegrityReport(id);
  if (!report) throw new Error('El informe se guardó, pero no fue posible volver a cargarlo.');
  return report;
}

export async function loadIntegrityReport(reportId: string): Promise<IntegrityReportRecord | null> {
  const client = requireClient();
  const { data, error } = await client.from('integrity_report_snapshots')
    .select('id,target_version_id,target_document_id,created_by,report_number,report_schema_version,final_status,final_observation,snapshot,snapshot_sha256,released_to_student,created_at')
    .eq('id', reportId).maybeSingle();
  if (error) throw error;
  return data ? normalizeReportRow(data as Record<string, unknown>) : null;
}

export async function loadLatestIntegrityReport(targetVersionId: string): Promise<IntegrityReportRecord | null> {
  const client = requireClient();
  const { data, error } = await client.from('integrity_report_snapshots')
    .select('id,target_version_id,target_document_id,created_by,report_number,report_schema_version,final_status,final_observation,snapshot,snapshot_sha256,released_to_student,created_at')
    .eq('target_version_id', targetVersionId).order('report_number', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data ? normalizeReportRow(data as Record<string, unknown>) : null;
}

export async function setIntegrityReportRelease(reportId: string, released: boolean): Promise<void> {
  const client = requireClient();
  const { error } = await client.rpc('set_integrity_report_release', { p_report_id: reportId, p_released: released });
  if (error) throw error;
}

export async function verifyIntegrityReport(report: IntegrityReportRecord): Promise<boolean> {
  return (await sha256Text(canonicalJson(report.snapshot))) === report.snapshot_sha256;
}

function htmlEsc(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function xmlEsc(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function pct(value: number | null): string {
  return value === null ? 'No disponible' : `${value.toFixed(1)} %`;
}

function statusLabel(value: IntegrityReportFinalStatus): string {
  return {
    pending: 'Pendiente de decisión', approved: 'Aprobado', observed: 'Con observaciones',
    correction_required: 'Requiere corrección', rejected: 'No aprobado',
  }[value];
}

export function buildIntegrityReportHtml(report: IntegrityReportRecord): string {
  const s = report.snapshot;
  const internal = s.internal_similarity?.sources.map((source, index) => `<div class="box"><b>${index + 1}. ${htmlEsc(source.title)}</b><span>${source.similarity_percent.toFixed(1)} %</span><small>${htmlEsc(source.repository_label)} · V${source.version_number} · ${source.matched_words} palabras</small>${source.matches.slice(0, 3).map((m) => `<p>${htmlEsc(m.target_excerpt)}</p>`).join('')}</div>`).join('') ?? '<p>Sin fuentes institucionales activas.</p>';
  const external = s.external_similarity?.sources.map((source, index) => `<div class="box"><b>${index + 1}. ${htmlEsc(source.title)}</b><span>${source.similarity_percent.toFixed(1)} %</span><small>${htmlEsc(source.provider)}${source.doi ? ` · DOI ${htmlEsc(source.doi)}` : ''}</small>${source.matches.slice(0, 3).map((m) => `<p>${htmlEsc(m.target_excerpt)}</p>`).join('')}</div>`).join('') ?? '<p>Sin fuentes externas verificadas.</p>';
  const refs = s.citation_integrity?.references.map((ref) => `<tr><td>${ref.ordinal}</td><td>${htmlEsc(ref.raw_reference)}</td><td>${htmlEsc(ref.status)}</td><td>${ref.confidence.toFixed(0)} %</td><td>${htmlEsc(ref.apa_issues.join('; ') || '—')}</td></tr>`).join('') ?? '';
  const ai = s.ai_writing?.segments.map((segment) => `<div class="box"><b>Fragmento ${segment.segment_index + 1} · ${segment.risk_level === 'high' ? 'Evidencia alta' : 'Evidencia media'}</b><span>${segment.evidence_score.toFixed(0)}/100</span><p>${htmlEsc(segment.excerpt)}</p><small>${segment.signals.slice(0, 4).map((sig) => `${htmlEsc(sig.label)} ${sig.score.toFixed(0)}/100`).join(' · ')}</small></div>`).join('') ?? '';

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>@page{size:A4;margin:14mm}body{font-family:Arial,sans-serif;color:#172033;font-size:10.5px;line-height:1.4}h1{font-size:23px}h2{font-size:15px;margin-top:20px;border-bottom:2px solid #dfe6f1;padding-bottom:5px}.meta,small{color:#657187}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}.card,.box{border:1px solid #dfe5ee;border-radius:8px;padding:8px;margin:7px 0}.card b{font-size:16px;display:block}.box>b{display:inline-block;max-width:82%}.box>span{float:right;font-weight:700}.box small{display:block;clear:both}.box p{margin:5px 0}.notice{border-left:4px solid #596d91;background:#f5f7fb;padding:8px}.status{display:inline-block;border:1px solid #aab7ca;border-radius:14px;padding:4px 9px;font-weight:700}table{width:100%;border-collapse:collapse;font-size:9px}th,td{border:1px solid #dfe5ee;padding:5px;vertical-align:top}th{background:#f2f5f9}.hash{font-family:monospace;font-size:8px;word-break:break-all}.footer{margin-top:18px;border-top:1px solid #dfe5ee;padding-top:8px;color:#657187;font-size:8.5px}</style></head><body>
  <div class="meta">SIAI · ITSQMET</div><h1>Informe de Integridad Académica y Similitud</h1><p class="meta">Informe #${report.report_number} · ${htmlEsc(new Date(report.created_at).toLocaleString('es-EC'))}</p>
  <h2>Identificación</h2><p><b>Estudiante:</b> ${htmlEsc(s.document.owner_name)}<br><b>Correo:</b> ${htmlEsc(s.document.owner_email)}<br><b>Trabajo:</b> ${htmlEsc(s.document.title)}<br><b>Archivo:</b> ${htmlEsc(s.document.original_file_name)} · Versión ${s.document.version_number}<br><b>SHA-256:</b> <span class="hash">${htmlEsc(s.document.sha256)}</span></p><p><span class="status">${htmlEsc(statusLabel(report.final_status))}</span></p>${report.final_observation ? `<div class="notice"><b>Observación final:</b> ${htmlEsc(report.final_observation)}</div>` : ''}
  <h2>Resumen ejecutivo</h2><div class="cards"><div class="card"><b>${pct(s.summary.consolidated_similarity_adjusted)}</b><small>Consolidada ajustada</small></div><div class="card"><b>${pct(s.summary.internal_similarity_adjusted)}</b><small>Institucional ajustada</small></div><div class="card"><b>${pct(s.summary.external_similarity_verified)}</b><small>Externa verificada</small></div><div class="card"><b>${s.summary.ai_evidence_score === null ? 'N/D' : `${s.summary.ai_evidence_score.toFixed(0)}/100`}</b><small>Índice IA</small></div></div><div class="notice">La similitud consolidada usa cobertura única de palabras; no suma porcentajes. El índice de IA es evidencia para revisión humana.</div>
  <h2>1. Similitud institucional</h2>${s.internal_similarity ? `<p>Original <b>${s.internal_similarity.original_percent.toFixed(1)} %</b> · Ajustada <b>${s.internal_similarity.adjusted_percent.toFixed(1)} %</b> · ${s.internal_similarity.adjusted_matched_words} palabras activas.</p>${internal}` : '<p>No existe análisis institucional.</p>'}
  <h2>2. Similitud externa</h2>${s.external_similarity ? `<p><b>${s.external_similarity.similarity_percent.toFixed(1)} %</b> · ${s.external_similarity.verified_source_count} fuentes verificadas · ${s.external_similarity.candidate_source_count} candidatos no contabilizados.</p>${external}` : '<p>No existe búsqueda externa.</p>'}
  <h2>3. Citas, referencias y APA 7</h2>${s.citation_integrity ? `<div class="cards"><div class="card"><b>${s.citation_integrity.citation_count}</b><small>Citas</small></div><div class="card"><b>${s.citation_integrity.unlinked_citation_count}</b><small>Sin referencia</small></div><div class="card"><b>${s.citation_integrity.verified_reference_count}</b><small>Verificadas</small></div><div class="card"><b>${s.citation_integrity.apa_issue_count}</b><small>Hallazgos APA</small></div></div><table><thead><tr><th>#</th><th>Referencia</th><th>Estado</th><th>Confianza</th><th>APA</th></tr></thead><tbody>${refs}</tbody></table>` : '<p>No existe revisión bibliográfica.</p>'}
  <h2>4. Indicadores de escritura asistida por IA</h2>${s.ai_writing ? `<p>Índice <b>${s.ai_writing.evidence_score.toFixed(0)}/100</b> · ${s.ai_writing.flagged_word_percent.toFixed(1)} % de palabras señaladas.</p>${ai || '<p>Sin fragmentos medios/altos visibles después de revisión.</p>'}` : '<p>No existe análisis de IA.</p>'}
  <h2>5. Trazabilidad</h2><p class="hash"><b>Huella informe:</b> ${htmlEsc(report.snapshot_sha256)}<br><b>Esquema:</b> ${htmlEsc(report.report_schema_version)}<br><b>Interno:</b> ${htmlEsc(s.provenance.internal_analysis_id ?? 'N/D')}<br><b>Externo:</b> ${htmlEsc(s.provenance.external_analysis_id ?? 'N/D')}<br><b>Citas:</b> ${htmlEsc(s.provenance.citation_analysis_id ?? 'N/D')}<br><b>IA:</b> ${htmlEsc(s.provenance.ai_analysis_id ?? 'N/D')}</p><div class="footer">SIAI presenta evidencia técnica para revisión académica. Ningún indicador automático constituye por sí solo una conclusión de plagio, fabricación de fuentes o uso indebido de IA.</div></body></html>`;
}

function xlsCell(value: unknown): string {
  return `<Cell><Data ss:Type="String">${xmlEsc(value)}</Data></Cell>`;
}

function xlsRow(values: unknown[]): string {
  return `<Row>${values.map(xlsCell).join('')}</Row>`;
}

function xlsSheet(name: string, rows: string[]): string {
  return `<Worksheet ss:Name="${xmlEsc(name.slice(0, 31))}"><Table>${rows.join('')}</Table></Worksheet>`;
}

export function buildIntegrityReportSpreadsheet(report: IntegrityReportRecord): string {
  const s = report.snapshot;
  const summary = [
    xlsRow(['Campo', 'Valor']),
    xlsRow(['Informe', report.report_number]), xlsRow(['Estado final', statusLabel(report.final_status)]),
    xlsRow(['Observación final', report.final_observation ?? '']), xlsRow(['Estudiante', s.document.owner_name]),
    xlsRow(['Correo', s.document.owner_email]), xlsRow(['Trabajo', s.document.title]), xlsRow(['Versión', s.document.version_number]),
    xlsRow(['Archivo', s.document.original_file_name]), xlsRow(['SHA-256 archivo', s.document.sha256]),
    xlsRow(['Similitud consolidada original', s.summary.consolidated_similarity_original ?? 'N/D']),
    xlsRow(['Similitud consolidada ajustada', s.summary.consolidated_similarity_adjusted ?? 'N/D']),
    xlsRow(['Similitud interna ajustada', s.summary.internal_similarity_adjusted ?? 'N/D']),
    xlsRow(['Similitud externa verificada', s.summary.external_similarity_verified ?? 'N/D']),
    xlsRow(['Índice evidencia IA', s.summary.ai_evidence_score ?? 'N/D']),
    xlsRow(['% palabras IA señaladas', s.summary.ai_flagged_word_percent ?? 'N/D']), xlsRow(['Huella informe', report.snapshot_sha256]),
  ];

  const internal = [xlsRow(['Fuente', 'Versión', '% ajustado', 'Palabras', 'Repositorio'])];
  (s.internal_similarity?.sources ?? []).forEach((source) => internal.push(xlsRow([source.title, source.version_number, source.similarity_percent, source.matched_words, source.repository_label])));

  const external = [xlsRow(['Proveedor', 'Título', 'Autores', 'Año', 'DOI', 'URL', '%', 'Palabras'])];
  (s.external_similarity?.sources ?? []).forEach((source) => external.push(xlsRow([source.provider, source.title, source.authors.join('; '), source.publication_year ?? '', source.doi ?? '', source.url ?? '', source.similarity_percent, source.matched_words])));

  const citations = [xlsRow(['Indicador', 'Valor'])];
  if (s.citation_integrity) {
    citations.push(xlsRow(['Citas', s.citation_integrity.citation_count]), xlsRow(['Citas enlazadas', s.citation_integrity.linked_citation_count]), xlsRow(['Citas sin referencia', s.citation_integrity.unlinked_citation_count]), xlsRow(['Citas ambiguas', s.citation_integrity.ambiguous_citation_count]), xlsRow(['Referencias', s.citation_integrity.reference_count]), xlsRow(['Referencias verificadas', s.citation_integrity.verified_reference_count]), xlsRow(['Referencias no localizadas', s.citation_integrity.reference_not_found_count]), xlsRow(['Referencias no citadas', s.citation_integrity.uncited_reference_count]), xlsRow(['Hallazgos APA', s.citation_integrity.apa_issue_count]));
  }

  const references = [xlsRow(['#', 'Referencia', 'Estado', 'Proveedor', 'Confianza', 'DOI', 'Veces citada', 'Hallazgos APA'])];
  (s.citation_integrity?.references ?? []).forEach((ref) => references.push(xlsRow([ref.ordinal, ref.raw_reference, ref.status, ref.provider ?? '', ref.confidence, ref.doi ?? '', ref.cited_in_text_count, ref.apa_issues.join('; ')])));

  const ai = [xlsRow(['Fragmento', 'Riesgo', 'Índice', 'Texto', 'Señales'])];
  (s.ai_writing?.segments ?? []).forEach((segment) => ai.push(xlsRow([segment.segment_index + 1, segment.risk_level, segment.evidence_score, segment.excerpt, segment.signals.map((signal) => `${signal.label}: ${signal.score.toFixed(0)}`).join('; ')])));

  return `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${xlsSheet('Resumen', summary)}${xlsSheet('Similitud interna', internal)}${xlsSheet('Fuentes externas', external)}${xlsSheet('Citas y APA', citations)}${xlsSheet('Referencias', references)}${xlsSheet('Indicadores IA', ai)}</Workbook>`;
}

function reportStem(report: IntegrityReportRecord): string {
  return `SIAI_Informe_${report.report_number}_${report.snapshot.document.owner_name || 'estudiante'}`.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 100);
}

export async function exportIntegrityReportPdf(report: IntegrityReportRecord): Promise<{ canceled: boolean; filePath: string | null }> {
  if (!window.siaiDesktop?.savePdf) throw new Error('La exportación PDF solo está disponible en la aplicación de escritorio.');
  if (!(await verifyIntegrityReport(report))) throw new Error('La huella del informe no coincide con la instantánea almacenada.');
  return window.siaiDesktop.savePdf(buildIntegrityReportHtml(report), `${reportStem(report)}.pdf`);
}

export async function exportIntegrityReportExcel(report: IntegrityReportRecord): Promise<{ canceled: boolean; filePath: string | null }> {
  if (!window.siaiDesktop?.saveExcel) throw new Error('La exportación Excel solo está disponible en la aplicación de escritorio.');
  if (!(await verifyIntegrityReport(report))) throw new Error('La huella del informe no coincide con la instantánea almacenada.');
  return window.siaiDesktop.saveExcel(buildIntegrityReportSpreadsheet(report), `${reportStem(report)}.xls`);
}
