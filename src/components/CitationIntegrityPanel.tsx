import { useEffect, useMemo, useState } from 'react';
import {
  loadLatestCitationIntegrityAnalysis,
  runCitationIntegrityAnalysis,
  setCitationIntegrityRelease,
} from '../lib/citationIntegrity';
import type { DocumentVersion } from '../types/documents';
import type {
  CitationIntegrityAnalysisResult,
  CitationReferenceResult,
  CitationVerificationStatus,
} from '../types/citationIntegrity';

interface Props {
  version: DocumentVersion;
  canRun: boolean;
}

const verificationLabels: Record<CitationVerificationStatus, string> = {
  verified: 'Verificada',
  probable: 'Coincidencia probable',
  not_found: 'No localizada',
  incomplete: 'No verificable',
};

const issueLabels: Record<string, string> = {
  bibliography_heading_not_found: 'No se identificó el encabezado de bibliografía',
  bibliography_empty_or_unreadable: 'La bibliografía no pudo separarse correctamente',
  references_not_alphabetical: 'Las referencias parecen no estar ordenadas alfabéticamente',
  missing_author: 'Falta autor identificable',
  missing_year: 'Falta año',
  missing_title: 'Falta título identificable',
  year_not_parenthesized: 'Año fuera del patrón APA esperado',
  doi_not_canonical: 'DOI no está en formato https://doi.org/...',
  duplicate_reference: 'Posible referencia duplicada',
};

function formatDate(value: string): string {
  return new Date(value).toLocaleString('es-EC', { dateStyle: 'medium', timeStyle: 'short' });
}

function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function referenceUrl(reference: CitationReferenceResult): string | null {
  const verified = safeHttpUrl(reference.verified_metadata.url);
  if (verified) return verified;
  const own = safeHttpUrl(reference.url);
  if (own) return own;
  return reference.doi ? `https://doi.org/${reference.doi}` : null;
}

function verificationDetail(reference: CitationReferenceResult): string {
  if (reference.verification_status === 'verified') {
    const provider = reference.verification_provider === 'openalex' ? 'OpenAlex' : 'Crossref';
    return `${provider} · confianza ${reference.confidence.toFixed(0)}%`;
  }
  if (reference.verification_status === 'probable') {
    return `Requiere revisión manual · confianza ${reference.confidence.toFixed(0)}%`;
  }
  if (reference.verification_status === 'not_found') {
    return 'No se encontró una coincidencia bibliográfica suficientemente fiable en las fuentes consultadas.';
  }
  const reason = typeof reference.verified_metadata.reason === 'string' ? reference.verified_metadata.reason : '';
  if (reason === 'verification_services_unavailable') return 'Los servicios de verificación no estuvieron disponibles en esta ejecución.';
  if (reason === 'verification_limit_reached') return 'Quedó fuera del límite de verificación automática de esta ejecución.';
  return 'La referencia no contiene datos suficientes para una verificación automática fiable.';
}

export function CitationIntegrityPanel({ version, canRun }: Props): React.JSX.Element | null {
  const [analysis, setAnalysis] = useState<CitationIntegrityAnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void loadLatestCitationIntegrityAnalysis(version.id)
      .then((result) => active && setAnalysis(result))
      .catch((caught) => active && setError(caught instanceof Error ? caught.message : 'No fue posible cargar la revisión bibliográfica.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [version.id]);

  const unlinkedMentions = useMemo(
    () => analysis?.mentions.filter((mention) => mention.link_status !== 'linked') ?? [],
    [analysis],
  );
  const uncitedReferences = useMemo(
    () => analysis?.references.filter((reference) => reference.cited_in_text_count === 0) ?? [],
    [analysis],
  );

  const run = async (): Promise<void> => {
    setRunning(true);
    setError(null);
    try {
      setAnalysis(await runCitationIntegrityAnalysis(version));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible revisar las citas y referencias.');
    } finally {
      setRunning(false);
    }
  };

  const toggleRelease = async (): Promise<void> => {
    if (!analysis) return;
    setReleaseBusy(true);
    setError(null);
    try {
      const next = !analysis.released_to_student;
      await setCitationIntegrityRelease(analysis.id, next);
      setAnalysis({ ...analysis, released_to_student: next });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible cambiar la visibilidad de la revisión bibliográfica.');
    } finally {
      setReleaseBusy(false);
    }
  };

  if (!canRun && !analysis && !loading) return null;

  return (
    <section className="citation-panel">
      <div className="citation-heading">
        <div>
          <span className="eyebrow dark">Citas y bibliografía</span>
          <h3>Integridad bibliográfica y APA 7</h3>
          <p>SIAI vincula citas autor-fecha con la bibliografía, verifica referencias en fuentes públicas y separa problemas de formato de posibles problemas de existencia.</p>
        </div>
        {analysis && (
          <div className="citation-score">
            <strong>{analysis.verified_reference_count}/{analysis.reference_count}</strong>
            <span>verificadas</span>
          </div>
        )}
      </div>

      {loading && <div className="inline-loading"><span className="mini-spinner" />Cargando revisión de citas…</div>}
      {error && <div className="alert error-alert">{error}</div>}

      {!loading && !analysis && canRun && (
        <div className="citation-empty">
          <p>Esta versión todavía no tiene una revisión de citas, referencias y formato bibliográfico.</p>
          <button className="secondary-button" type="button" disabled={running || version.extraction_status !== 'ready'} onClick={() => void run()}>
            {running ? 'Revisando bibliografía…' : 'Revisar citas y bibliografía'}
          </button>
        </div>
      )}

      {running && (
        <div className="citation-running">
          <span className="mini-spinner" />
          <div><strong>Analizando citas y referencias…</strong><small>Extracción de bibliografía, enlace de citas y verificación en Crossref/OpenAlex.</small></div>
        </div>
      )}

      {analysis && (
        <>
          <div className="citation-stats">
            <span><strong>{analysis.citation_count}</strong> citas detectadas</span>
            <span><strong>{analysis.reference_count}</strong> referencias</span>
            <span><strong>{analysis.linked_citation_count}</strong> citas enlazadas</span>
            <span><strong>{analysis.unlinked_citation_count + analysis.ambiguous_citation_count}</strong> por revisar</span>
            <span><strong>{analysis.suspicious_reference_count}</strong> no localizadas</span>
            <span><strong>{analysis.apa_issue_count}</strong> hallazgos APA</span>
          </div>

          <div className="citation-meta">
            Bibliografía: {analysis.bibliography_found ? `detectada${analysis.bibliography_heading ? ` como “${analysis.bibliography_heading}”` : ''}` : 'no detectada'} · Última revisión: {formatDate(analysis.created_at)}
          </div>

          {analysis.global_issues.length > 0 && (
            <div className="citation-global-issues">
              <strong>Hallazgos generales</strong>
              <div>{analysis.global_issues.map((issue) => <span key={issue}>{issueLabels[issue] ?? issue}</span>)}</div>
            </div>
          )}

          {unlinkedMentions.length > 0 && (
            <div className="citation-section">
              <div className="citation-section-title"><strong>Citas que requieren revisión</strong><span>No se vinculó automáticamente una referencia única.</span></div>
              <div className="citation-mention-list">
                {unlinkedMentions.slice(0, 20).map((mention) => (
                  <article className={`citation-mention ${mention.link_status}`} key={mention.id}>
                    <strong>{mention.raw_citation}</strong>
                    <span>{mention.link_status === 'ambiguous' ? 'Coincide con más de una referencia' : 'No tiene referencia vinculada'}{mention.page_number ? ` · pág. ${mention.page_number}` : ''}</span>
                  </article>
                ))}
              </div>
            </div>
          )}

          <div className="citation-section">
            <div className="citation-section-title"><strong>Referencias bibliográficas</strong><span>“No localizada” significa que requiere revisión; no demuestra que una fuente haya sido inventada.</span></div>
            <div className="citation-reference-list">
              {analysis.references.length === 0 ? (
                <div className="no-sources">No fue posible separar referencias bibliográficas en esta versión.</div>
              ) : analysis.references.map((reference) => {
                const url = referenceUrl(reference);
                return (
                  <article className={`citation-reference ${reference.verification_status}`} key={reference.id}>
                    <div className="citation-reference-head">
                      <span className="citation-reference-number">{reference.ordinal}</span>
                      <div>
                        <strong>{reference.parsed_title ?? reference.raw_reference.slice(0, 180)}</strong>
                        <small>{reference.author_key ?? 'Autor no identificado'}{reference.year_label ? ` · ${reference.year_label}` : ''} · citada {reference.cited_in_text_count} {reference.cited_in_text_count === 1 ? 'vez' : 'veces'}</small>
                      </div>
                      <span className={`citation-verification ${reference.verification_status}`}>{verificationLabels[reference.verification_status]}</span>
                    </div>
                    <p className="citation-raw-reference">{reference.raw_reference}</p>
                    <div className="citation-verification-detail">
                      <span>{verificationDetail(reference)}</span>
                      {reference.doi && <code>DOI {reference.doi}</code>}
                      {url && <a href={url} target="_blank" rel="noreferrer">Abrir fuente</a>}
                    </div>
                    {reference.apa_issues.length > 0 && (
                      <div className="citation-issue-chips">
                        {reference.apa_issues.map((issue) => <span key={issue}>{issueLabels[issue] ?? issue}</span>)}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </div>

          {uncitedReferences.length > 0 && (
            <div className="citation-uncited-note">
              <strong>{analysis.uncited_reference_count} referencias no fueron localizadas en las citas autor-fecha del cuerpo.</strong>
              <span>Esto puede ser correcto en casos especiales, pero conviene revisarlas antes de liberar el informe.</span>
            </div>
          )}

          {canRun && (
            <div className="citation-actions">
              <button className="secondary-button compact-button" type="button" disabled={running} onClick={() => void run()}>{running ? 'Revisando…' : 'Revisar de nuevo'}</button>
              <button className="secondary-button compact-button" type="button" disabled={releaseBusy} onClick={() => void toggleRelease()}>
                {analysis.released_to_student ? 'Ocultar al estudiante' : 'Liberar al estudiante'}
              </button>
              <span className={analysis.released_to_student ? 'release-state released' : 'release-state'}>{analysis.released_to_student ? 'Visible para el estudiante' : 'Solo coordinador'}</span>
            </div>
          )}
        </>
      )}
    </section>
  );
}
