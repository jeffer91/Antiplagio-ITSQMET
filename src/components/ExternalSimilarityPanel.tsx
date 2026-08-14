import { useEffect, useMemo, useState } from 'react';
import {
  loadLatestExternalSimilarityAnalysis,
  runExternalSimilarityAnalysis,
  setExternalSimilarityRelease,
} from '../lib/externalSimilarity';
import type { DocumentVersion } from '../types/documents';
import type {
  ExternalProvider,
  ExternalProviderState,
  ExternalSimilarityAnalysisResult,
  ExternalSimilaritySource,
} from '../types/externalSimilarity';

interface Props {
  version: DocumentVersion;
  canRun: boolean;
}

const providerLabels: Record<ExternalProvider, string> = {
  openalex: 'OpenAlex',
  core: 'CORE',
  semantic_scholar: 'Semantic Scholar',
  crossref: 'Crossref',
  brave: 'Web',
};

const providerOrder: ExternalProvider[] = ['openalex', 'core', 'semantic_scholar', 'crossref', 'brave'];

function formatDate(value: string): string {
  return new Date(value).toLocaleString('es-EC', { dateStyle: 'medium', timeStyle: 'short' });
}

function safeHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function statusLabel(state: ExternalProviderState | undefined): string {
  if (!state) return 'Sin ejecutar';
  if (state.status === 'disabled') return 'Sin configurar';
  if (state.status === 'error') return 'Con error';
  return `${state.candidates} candidatos`;
}

function verificationLabel(source: ExternalSimilaritySource): string {
  if (source.verification_status === 'candidate') return 'Candidato no verificado';
  if (source.verification_scope === 'full_text') return 'Verificado · texto completo';
  if (source.verification_scope === 'snippet') return 'Verificado · fragmento indexado';
  if (source.verification_scope === 'abstract') return 'Verificado · resumen';
  return 'Verificado';
}

export function ExternalSimilarityPanel({ version, canRun }: Props): React.JSX.Element | null {
  const [analysis, setAnalysis] = useState<ExternalSimilarityAnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void loadLatestExternalSimilarityAnalysis(version.id)
      .then((result) => active && setAnalysis(result))
      .catch((caught) => active && setError(caught instanceof Error ? caught.message : 'No fue posible cargar la similitud externa.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [version.id]);

  const verifiedSources = useMemo(
    () => analysis?.sources.filter((source) => source.verification_status === 'verified') ?? [],
    [analysis],
  );
  const candidateSources = useMemo(
    () => analysis?.sources.filter((source) => source.verification_status === 'candidate') ?? [],
    [analysis],
  );

  const run = async (): Promise<void> => {
    setRunning(true);
    setError(null);
    try {
      const result = await runExternalSimilarityAnalysis(version);
      setAnalysis(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible consultar las fuentes externas.');
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
      await setExternalSimilarityRelease(analysis.id, next);
      setAnalysis({ ...analysis, released_to_student: next });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible cambiar la visibilidad del informe externo.');
    } finally {
      setReleaseBusy(false);
    }
  };

  if (!canRun && !analysis && !loading) return null;

  return (
    <section className="external-panel">
      <div className="external-heading">
        <div>
          <span className="eyebrow dark">Similitud externa</span>
          <h3>Fuentes académicas y web públicas</h3>
          <p>Solo las fuentes con texto verificable aportan al porcentaje. Los candidatos sin contenido accesible se muestran aparte y no lo modifican.</p>
        </div>
        {analysis && (
          <div className={`external-score ${analysis.similarity_percent >= 30 ? 'high' : analysis.similarity_percent >= 15 ? 'medium' : 'low'}`}>
            <strong>{analysis.similarity_percent.toFixed(1)}%</strong>
            <span>verificado</span>
          </div>
        )}
      </div>

      {loading && <div className="inline-loading"><span className="mini-spinner" />Cargando búsqueda externa…</div>}
      {error && <div className="alert error-alert">{error}</div>}

      {!loading && !analysis && canRun && (
        <div className="external-empty">
          <p>Esta versión todavía no ha sido consultada contra las fuentes públicas configuradas.</p>
          <button className="secondary-button" type="button" disabled={running || version.extraction_status !== 'ready'} onClick={() => void run()}>
            {running ? 'Consultando fuentes…' : 'Buscar fuentes externas'}
          </button>
        </div>
      )}

      {running && (
        <div className="external-running">
          <span className="mini-spinner" />
          <div><strong>Consultando fuentes públicas…</strong><small>OpenAlex, CORE, Semantic Scholar, Crossref y búsqueda web configurada. Este proceso puede tardar unos segundos.</small></div>
        </div>
      )}

      {analysis && (
        <>
          <div className="external-stats">
            <span><strong>{analysis.matched_words.toLocaleString('es-EC')}</strong> palabras verificadas</span>
            <span><strong>{analysis.verified_source_count}</strong> fuentes verificadas</span>
            <span><strong>{analysis.candidate_source_count}</strong> candidatos sin verificar</span>
            <span><strong>{analysis.total_words.toLocaleString('es-EC')}</strong> palabras analizadas</span>
          </div>

          <div className="provider-grid">
            {providerOrder.map((provider) => {
              const state = analysis.provider_summary[provider];
              return (
                <div className={`provider-chip ${state?.status ?? 'idle'}`} key={provider} title={state?.message ?? ''}>
                  <strong>{providerLabels[provider]}</strong>
                  <span>{statusLabel(state)}</span>
                </div>
              );
            })}
          </div>

          <div className="external-meta">Última búsqueda: {formatDate(analysis.created_at)} · {analysis.algorithm_version}</div>

          {verifiedSources.length > 0 && (
            <div className="external-source-section">
              <div className="external-section-title"><strong>Fuentes verificadas</strong><span>Estas sí aportan al porcentaje externo.</span></div>
              <div className="external-source-list">
                {verifiedSources.map((source, index) => {
                  const sourceUrl = safeHttpUrl(source.url ?? source.content_url);
                  return (
                    <article className="external-source-card verified" key={source.id}>
                      <div className="external-source-head">
                        <span className="external-source-number">{index + 1}</span>
                        <div className="external-source-copy">
                          <strong>{source.title}</strong>
                          <small>{providerLabels[source.provider]}{source.publication_year ? ` · ${source.publication_year}` : ''}{source.authors.length ? ` · ${source.authors.slice(0, 3).join(', ')}` : ''}</small>
                        </div>
                        <div className="external-source-score"><b>{source.similarity_percent.toFixed(1)}%</b><span>{source.matched_words} palabras</span></div>
                      </div>
                      <div className="verification-row">
                        <span className="verification-badge verified">{verificationLabel(source)}</span>
                        {source.doi && <code>DOI {source.doi}</code>}
                        {sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer">Abrir fuente</a>}
                      </div>
                      <div className="external-match-list">
                        {source.matches.slice(0, 3).map((match, matchIndex) => (
                          <div className="external-match" key={match.id ?? `${source.id}-${matchIndex}`}>
                            <span className={`match-kind ${match.match_type}`}>{match.match_type === 'exact' ? 'Coincidencia textual' : 'Coincidencia cercana'} · {match.similarity_score.toFixed(0)}%</span>
                            <p><b>Trabajo revisado:</b> {match.target_excerpt}</p>
                            <p><b>Fuente:</b> {match.source_excerpt}</p>
                          </div>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          )}

          {candidateSources.length > 0 && (
            <div className="external-source-section candidate-section">
              <div className="external-section-title"><strong>Candidatos no verificados</strong><span>Se encontraron en índices públicos, pero no hay texto suficiente para confirmar una coincidencia. No afectan el porcentaje.</span></div>
              <div className="candidate-list">
                {candidateSources.slice(0, 12).map((source) => {
                  const sourceUrl = safeHttpUrl(source.url ?? source.content_url);
                  return (
                    <article className="candidate-card" key={source.id}>
                      <div><strong>{source.title}</strong><small>{providerLabels[source.provider]}{source.publication_year ? ` · ${source.publication_year}` : ''}</small></div>
                      <span className="verification-badge candidate">No contabilizado</span>
                      {sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer">Revisar</a>}
                    </article>
                  );
                })}
              </div>
            </div>
          )}

          {verifiedSources.length === 0 && candidateSources.length === 0 && (
            <div className="no-sources">No se encontraron fuentes externas con evidencia suficiente en esta ejecución.</div>
          )}

          {canRun && (
            <div className="external-actions">
              <button className="secondary-button compact-button" type="button" disabled={running} onClick={() => void run()}>{running ? 'Consultando…' : 'Buscar de nuevo'}</button>
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
