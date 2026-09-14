import { createClient } from 'npm:@supabase/supabase-js@2';

const RUBRIC_VERSION = 'elite-2026-v1';
const PROMPT_VERSION = 'global-review-v1';
const MAX_ARTICLE_CHARS = 180_000;
const MAX_FINDINGS_PER_REVIEWER = 40;
const REQUEST_TIMEOUT_MS = 110_000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type UnknownRecord = Record<string, unknown>;
type Severity = 'low' | 'medium' | 'high' | 'critical';

interface EvaluatorRow {
  slot: number;
  name: string;
  enabled: boolean;
}

interface Finding {
  criterion: string;
  issue_key: string;
  title: string;
  severity: Severity;
  page: number | null;
  fragment: string;
  explanation: string;
  recommendation: string;
  deduction: number;
}

interface ReviewerResult {
  evaluator_slot: number;
  evaluator_name: string;
  score: number | null;
  duration_ms: number;
  status: 'completed' | 'failed';
  findings: Finding[];
  error_message: string | null;
}

interface Cluster {
  representative: Finding;
  findings: Finding[];
  slots: number[];
}

const CRITERIA = new Set([
  'format_elite',
  'topic_relevance',
  'purpose_objectives',
  'introduction_background',
  'methodology',
  'results',
  'discussion',
  'conclusions',
  'global_coherence',
  'academic_writing',
  'apa_references',
  'source_quality',
  'tables_figures',
  'statistics_data',
  'integrity_originality',
]);

const STOPWORDS = new Set([
  'de','la','el','los','las','un','una','unos','unas','y','o','en','del','al','para','por','con','sin','que','se','es','son',
  'como','su','sus','a','lo','le','les','este','esta','estos','estas','entre','desde','hasta','sobre','durante','mediante','muy',
  'más','mas','menos','no','si','the','and','of','to','in','for','with','is','are','this','that','from','as','by','on','or',
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

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals = 2): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function normalizeText(value: string): string {
  return value
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeKey(value: string): string {
  return normalizeText(value).replace(/\s+/g, '_').toUpperCase().slice(0, 110);
}

function tokens(value: string): Set<string> {
  return new Set(normalizeText(value).split(' ').filter((word) => word.length > 2 && !STOPWORDS.has(word)));
}

function jaccard(left: string, right: string): number {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const word of a) if (b.has(word)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union ? intersection / union : 0;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function severityRank(value: Severity): number {
  if (value === 'critical') return 4;
  if (value === 'high') return 3;
  if (value === 'medium') return 2;
  return 1;
}

function highestSeverity(values: Severity[]): Severity {
  return values.reduce((best, current) => severityRank(current) > severityRank(best) ? current : best, 'low' as Severity);
}

function performanceLevel(score: number): string {
  if (score >= 9) return 'Excelente (A)';
  if (score >= 8) return 'Muy Bueno (B)';
  if (score >= 7) return 'Aceptable (C)';
  return 'Insuficiente (D)';
}

function safeError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return 'Tiempo de espera agotado';
  if (error instanceof Error) return error.message.slice(0, 500);
  return 'Error no identificado';
}

function pageText(extractedPages: unknown, fallback: string): string {
  if (!Array.isArray(extractedPages) || extractedPages.length === 0) return fallback.slice(0, MAX_ARTICLE_CHARS);
  const chunks: string[] = [];
  let used = 0;
  for (const raw of extractedPages) {
    const page = asRecord(raw);
    const number = asNumber(page.page);
    const text = asString(page.text);
    if (!text) continue;
    const chunk = `\n\n=== PÁGINA ${number ?? '?'} ===\n${text}`;
    if (used + chunk.length > MAX_ARTICLE_CHARS) {
      chunks.push(chunk.slice(0, Math.max(0, MAX_ARTICLE_CHARS - used)));
      break;
    }
    chunks.push(chunk);
    used += chunk.length;
  }
  return chunks.join('').trim() || fallback.slice(0, MAX_ARTICLE_CHARS);
}

function buildPrompt(article: string, metadata: UnknownRecord, integrity: UnknownRecord): string {
  return `Eres uno de 15 evaluadores académicos independientes. Debes evaluar TODO el artículo, no una sola sección. Todos los evaluadores usan exactamente esta misma rúbrica. No conoces ni debes inferir las respuestas de los otros evaluadores.

REGLA DE NOTA
- Parte de 10.00/10.
- Cada novedad real y demostrable descuenta puntos una sola vez dentro de tu evaluación.
- No repitas la misma novedad con otras palabras.
- Descuento orientativo: bajo 0.05-0.15; medio 0.15-0.40; alto 0.40-0.90; crítico 0.90-2.00.
- No inventes errores para bajar la nota. Si no existe un problema, no lo reportes.
- La nota de tu evaluación será 10 menos la suma de tus descuentos.

RÚBRICA INSTITUCIONAL OFICIAL (10 puntos)
1. Tema general de interés: claridad, pertinencia, delimitación y relación justificada con el campo profesional.
2. Propósito de la investigación: claridad, precisión y coherencia con el tema.
3. Resultados: deben responder y validar los objetivos, con análisis claro y evidencia suficiente.
4. Redacción y formato: claridad, coherencia, estructura y APA 7.
5. Declaración de originalidad: completa, clara y acorde con principios éticos.
Escala: 9-10 Excelente; 8-<9 Muy Bueno; 7-<8 Aceptable; <7 Insuficiente.

REVISIÓN GLOBAL OBLIGATORIA
Evalúa las 15 áreas completas usando estos códigos exactos en "criterion":
format_elite, topic_relevance, purpose_objectives, introduction_background, methodology, results, discussion, conclusions, global_coherence, academic_writing, apa_references, source_quality, tables_figures, statistics_data, integrity_originality.

FORMATO REVISTA ÉLITE A COMPROBAR CUANDO SEA APLICABLE
- Artículo entre 6 y 15 páginas; 8 páginas es una recomendación, no una obligación.
- Redacción académica preferentemente en tercera persona; evitar opiniones personales.
- Resumen entre 150 y 250 palabras e integrado por contexto, objetivo, métodos, resultados y conclusiones sin encabezados internos.
- 3 a 5 palabras clave.
- Título en español y traducción; autoría/afiliación; resumen/abstract; introducción; metodología; resultados; discusión/conclusiones y referencias según la plantilla disponible.
- Revisa coherencia de tablas, figuras, títulos, fuentes y menciones en el texto solo cuando exista evidencia textual suficiente. No inventes problemas visuales que no puedas comprobar.

COHERENCIA CIENTÍFICA
Comprueba especialmente la cadena: título → problema → propósito/objetivos → metodología → resultados → discusión → conclusiones. Verifica que los resultados realmente permitan las conclusiones, que la metodología permita obtener esos resultados y que cálculos/porcentajes/ANOVA/correlaciones se interpreten correctamente cuando existan.

ANTIPLAGIO
El porcentaje de similitud adjunto proviene del motor antiplagio y NO puedes modificarlo ni recalcularlo. Puedes señalar problemas de integridad o citación sustentados por la evidencia, pero jamás sustituir el porcentaje oficial.

METADATOS DEL DOCUMENTO
${JSON.stringify(metadata)}

RESUMEN DEL MOTOR DE INTEGRIDAD/ANTIPLAGIO
${JSON.stringify(integrity)}

SALIDA
Devuelve SOLO JSON válido, sin Markdown ni texto adicional, con esta forma:
{
  "summary": "síntesis breve de la calidad del artículo",
  "findings": [
    {
      "criterion": "uno de los 15 códigos exactos",
      "issue_key": "CODIGO_ESTABLE_CORTO_DEL_PROBLEMA",
      "title": "nombre corto de la novedad",
      "severity": "low|medium|high|critical",
      "page": 3,
      "fragment": "fragmento textual breve que demuestra el problema; vacío si no aplica",
      "explanation": "por qué está mal y qué afecta",
      "recommendation": "cómo corregirlo de manera concreta",
      "deduction": 0.40
    }
  ]
}
Si no hay novedades, findings debe ser []. La página puede ser null si no puede determinarse con seguridad.

ARTÍCULO COMPLETO
${article}`;
}

function extractContent(payload: UnknownRecord): string {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
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
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    return asRecord(JSON.parse(trimmed));
  } catch {
    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first >= 0 && last > first) return asRecord(JSON.parse(trimmed.slice(first, last + 1)));
    throw new Error('La IA no devolvió JSON válido');
  }
}

function normalizeFinding(value: unknown, pageCount: number | null): Finding | null {
  const row = asRecord(value);
  const title = asString(row.title).slice(0, 180);
  const explanation = asString(row.explanation).slice(0, 1600);
  const recommendation = asString(row.recommendation).slice(0, 1200);
  if (!title || !explanation || !recommendation) return null;

  const rawCriterion = asString(row.criterion);
  const criterion = CRITERIA.has(rawCriterion) ? rawCriterion : 'global_coherence';
  const rawSeverity = asString(row.severity) as Severity;
  const severity: Severity = ['low','medium','high','critical'].includes(rawSeverity) ? rawSeverity : 'medium';
  const rawDeduction = asNumber(row.deduction) ?? 0.2;
  const deduction = round(clamp(rawDeduction, 0.05, 2), 2);
  const pageValue = asNumber(row.page);
  const page = pageValue !== null && Number.isInteger(pageValue) && pageValue >= 1 && (!pageCount || pageValue <= pageCount)
    ? pageValue
    : null;
  const rawKey = asString(row.issue_key) || title;

  return {
    criterion,
    issue_key: safeKey(`${criterion}_${rawKey}`),
    title,
    severity,
    page,
    fragment: asString(row.fragment).slice(0, 700),
    explanation,
    recommendation,
    deduction,
  };
}

function dedupeReviewerFindings(findings: Finding[]): Finding[] {
  const result: Finding[] = [];
  for (const finding of findings) {
    const duplicate = result.some((existing) => existing.criterion === finding.criterion && (
      existing.issue_key === finding.issue_key
      || jaccard(`${existing.title} ${existing.fragment}`, `${finding.title} ${finding.fragment}`) >= 0.62
    ));
    if (!duplicate) result.push(finding);
    if (result.length >= MAX_FINDINGS_PER_REVIEWER) break;
  }
  return result;
}

async function evaluateOne(
  evaluator: EvaluatorRow,
  apiUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  pageCount: number | null,
): Promise<ReviewerResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.15,
        messages: [
          {
            role: 'system',
            content: `Evaluador académico independiente ${evaluator.name}. Evalúa el artículo completo y devuelve únicamente JSON válido.`,
          },
          { role: 'user', content: prompt },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Proveedor IA HTTP ${response.status}: ${body.slice(0, 220)}`);
    }

    const payload = asRecord(await response.json());
    const content = extractContent(payload);
    if (!content) throw new Error('El proveedor IA no devolvió contenido');
    const parsed = parseJsonObject(content);
    const rawFindings = Array.isArray(parsed.findings) ? parsed.findings : [];
    const findings = dedupeReviewerFindings(
      rawFindings.map((item) => normalizeFinding(item, pageCount)).filter((item): item is Finding => Boolean(item)),
    );
    const score = round(clamp(10 - findings.reduce((sum, finding) => sum + finding.deduction, 0), 0, 10), 2);

    return {
      evaluator_slot: evaluator.slot,
      evaluator_name: evaluator.name,
      score,
      duration_ms: Date.now() - started,
      status: 'completed',
      findings,
      error_message: null,
    };
  } catch (error) {
    return {
      evaluator_slot: evaluator.slot,
      evaluator_name: evaluator.name,
      score: null,
      duration_ms: Date.now() - started,
      status: 'failed',
      findings: [],
      error_message: safeError(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function sameIssue(left: Finding, right: Finding): boolean {
  if (left.criterion !== right.criterion) return false;
  if (left.issue_key === right.issue_key) return true;
  if (left.page !== null && right.page !== null && Math.abs(left.page - right.page) > 1) return false;
  const leftText = `${left.title} ${left.fragment} ${left.explanation}`;
  const rightText = `${right.title} ${right.fragment} ${right.explanation}`;
  return jaccard(leftText, rightText) >= 0.48 || jaccard(left.title, right.title) >= 0.58;
}

function consolidate(results: ReviewerResult[]): Array<UnknownRecord> {
  const clusters: Cluster[] = [];
  for (const result of results.filter((item) => item.status === 'completed')) {
    for (const finding of result.findings) {
      const cluster = clusters.find((candidate) => sameIssue(candidate.representative, finding));
      if (cluster) {
        cluster.findings.push(finding);
        if (!cluster.slots.includes(result.evaluator_slot)) cluster.slots.push(result.evaluator_slot);
        if (finding.explanation.length > cluster.representative.explanation.length) cluster.representative = finding;
      } else {
        clusters.push({ representative: finding, findings: [finding], slots: [result.evaluator_slot] });
      }
    }
  }

  const successful = Math.max(1, results.filter((item) => item.status === 'completed').length);
  return clusters.map((cluster) => {
    const representative = cluster.representative;
    const deductions = cluster.findings.map((finding) => finding.deduction);
    const severities = cluster.findings.map((finding) => finding.severity);
    const pages = cluster.findings.map((finding) => finding.page).filter((page): page is number => page !== null);
    const page = pages.length ? Math.round(median(pages)) : representative.page;
    const detectedBy = [...cluster.slots].sort((a, b) => a - b);
    return {
      issue_key: representative.issue_key,
      criterion: representative.criterion,
      title: representative.title,
      severity: highestSeverity(severities),
      page,
      fragment: representative.fragment,
      explanation: representative.explanation,
      recommendation: representative.recommendation,
      deduction: round(median(deductions), 2),
      detected_by: detectedBy,
      detected_by_count: detectedBy.length,
      confidence: round(detectedBy.length / successful, 4),
    };
  }).sort((a, b) => Number(b.deduction) - Number(a.deduction));
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Método no permitido' }, 405);

  const authorization = request.headers.get('Authorization');
  if (!authorization) return jsonResponse({ error: 'Falta autenticación' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return jsonResponse({ error: 'Supabase no está configurado en la función' }, 500);

  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let runId: string | null = null;
  try {
    const { data: userData, error: userError } = await caller.auth.getUser();
    if (userError || !userData.user) return jsonResponse({ error: 'Sesión no válida' }, 401);

    const body = asRecord(await request.json());
    const targetVersionId = asString(body.target_version_id);
    const analysisAttemptId = asString(body.analysis_attempt_id) || null;
    const similarityPercent = asNumber(body.similarity_percent);
    const integritySummary = asRecord(body.integrity_summary);
    if (!targetVersionId) return jsonResponse({ error: 'Falta target_version_id' }, 400);

    const { data: canAnalyze, error: accessError } = await caller.rpc('can_analyze_version', { p_version_id: targetVersionId });
    if (accessError || !canAnalyze) return jsonResponse({ error: 'No tienes acceso para analizar esta versión' }, 403);

    const { data: version, error: versionError } = await service
      .from('document_versions')
      .select('id,document_id,original_file_name,extracted_text,extracted_pages,page_count,word_count,extraction_status')
      .eq('id', targetVersionId)
      .single();
    if (versionError || !version) return jsonResponse({ error: 'La versión objetivo no existe' }, 404);
    if (version.extraction_status !== 'ready') return jsonResponse({ error: 'La versión objetivo no tiene texto listo' }, 400);

    const { data: document } = await service
      .from('documents')
      .select('id,title,career,modality,academic_period_id')
      .eq('id', version.document_id)
      .maybeSingle();

    const { data: evaluatorsData, error: evaluatorError } = await service
      .from('ai_evaluators')
      .select('slot,name,enabled')
      .eq('enabled', true)
      .order('slot', { ascending: true });
    if (evaluatorError) throw evaluatorError;
    const evaluators = (evaluatorsData ?? []).map((row) => ({
      slot: Number(row.slot),
      name: asString(row.name) || `IA ${String(row.slot).padStart(2, '0')}`,
      enabled: Boolean(row.enabled),
    })) as EvaluatorRow[];
    if (!evaluators.length) return jsonResponse({ error: 'No hay evaluadores IA activos. Activa al menos uno desde Administración.' }, 400);

    const { data: run, error: runError } = await service
      .from('article_review_runs')
      .insert({
        target_version_id: targetVersionId,
        analysis_attempt_id: analysisAttemptId,
        requested_by: userData.user.id,
        status: 'running',
        rubric_version: RUBRIC_VERSION,
        prompt_version: PROMPT_VERSION,
        evaluator_count: evaluators.length,
        evaluator_slots: evaluators.map((item) => item.slot),
        similarity_percent: similarityPercent,
      })
      .select('*')
      .single();
    if (runError || !run) throw new Error(runError?.message || 'No fue posible crear la revisión global');
    runId = String(run.id);

    const apiUrl = asString(Deno.env.get('ARTICLE_REVIEW_API_URL'));
    const apiKey = asString(Deno.env.get('ARTICLE_REVIEW_API_KEY'));
    const model = asString(Deno.env.get('ARTICLE_REVIEW_MODEL'));
    if (!apiUrl || !apiKey || !model) {
      const message = 'Configura ARTICLE_REVIEW_API_URL, ARTICLE_REVIEW_API_KEY y ARTICLE_REVIEW_MODEL en los secretos de Supabase.';
      await service.from('article_review_runs').update({ status: 'failed', error_message: message, completed_at: new Date().toISOString() }).eq('id', runId);
      return jsonResponse({ error: message, run: { ...run, status: 'failed', error_message: message } }, 503);
    }

    const article = pageText(version.extracted_pages, asString(version.extracted_text));
    if (article.length < 80) throw new Error('El artículo no contiene suficiente texto para la revisión global');

    const metadata: UnknownRecord = {
      file_name: version.original_file_name,
      page_count: version.page_count,
      word_count: version.word_count,
      title: document?.title ?? null,
      career: document?.career ?? null,
      modality: document?.modality ?? null,
    };
    const prompt = buildPrompt(article, metadata, integritySummary);

    const results = await Promise.all(
      evaluators.map((evaluator) => evaluateOne(evaluator, apiUrl, apiKey, model, prompt, asNumber(version.page_count))),
    );

    const reviewerRows = results.map((result) => ({
      run_id: runId,
      evaluator_slot: result.evaluator_slot,
      evaluator_name: result.evaluator_name,
      score: result.score,
      duration_ms: result.duration_ms,
      status: result.status,
      findings: result.findings,
      error_message: result.error_message,
    }));
    const { error: reviewerSaveError } = await service.from('article_reviewer_results').insert(reviewerRows);
    if (reviewerSaveError) throw reviewerSaveError;

    const successful = results.filter((result) => result.status === 'completed');
    if (!successful.length) {
      const message = results.map((result) => result.error_message).filter(Boolean).slice(0, 3).join(' · ') || 'Ninguna IA pudo completar la revisión.';
      const { data: failedRun } = await service.from('article_review_runs').update({
        status: 'failed',
        successful_evaluators: 0,
        error_message: message,
        completed_at: new Date().toISOString(),
      }).eq('id', runId).select('*').single();
      return jsonResponse({ error: message, run: failedRun, findings: [], reviewers: results }, 502);
    }

    const consolidated = consolidate(results);
    if (consolidated.length) {
      const { error: findingError } = await service.from('article_review_findings').insert(
        consolidated.map((finding) => ({ ...finding, run_id: runId })),
      );
      if (findingError) throw findingError;
    }

    const totalDeduction = consolidated.reduce((sum, finding) => sum + Number(finding.deduction ?? 0), 0);
    const finalScore = round(clamp(10 - totalDeduction, 0, 10), 2);
    const finalStatus = successful.length === evaluators.length ? 'completed' : 'partial';
    const { data: completedRun, error: completeError } = await service.from('article_review_runs').update({
      status: finalStatus,
      successful_evaluators: successful.length,
      final_score: finalScore,
      performance_level: performanceLevel(finalScore),
      error_message: finalStatus === 'partial' ? `${evaluators.length - successful.length} evaluador(es) no completaron la revisión.` : null,
      completed_at: new Date().toISOString(),
    }).eq('id', runId).select('*').single();
    if (completeError || !completedRun) throw new Error(completeError?.message || 'No fue posible cerrar la revisión global');

    const { data: savedFindings } = await service
      .from('article_review_findings')
      .select('*')
      .eq('run_id', runId)
      .order('deduction', { ascending: false });

    return jsonResponse({ run: completedRun, findings: savedFindings ?? [], reviewers: results });
  } catch (error) {
    const message = safeError(error);
    if (runId) {
      await service.from('article_review_runs').update({
        status: 'failed',
        error_message: message,
        completed_at: new Date().toISOString(),
      }).eq('id', runId);
    }
    return jsonResponse({ error: message }, 500);
  }
});
