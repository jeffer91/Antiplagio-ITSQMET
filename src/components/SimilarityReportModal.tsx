import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { saveSimilarityAdjustment } from '../lib/similarity';
import {
  buildSimilarityViewModel,
  DEFAULT_SIMILARITY_FILTERS,
  type ViewerMatch,
} from '../lib/similarityView';
import type { DocumentVersion } from '../types/documents';
import type {
  SimilarityAdjustment,
  SimilarityAnalysisResult,
  SimilarityFilterSettings,
  SimilaritySourceResult,
} from '../types/similarity';

interface Props {
  version: DocumentVersion;
  analysis: SimilarityAnalysisResult;
  canEdit: boolean;
  onClose: () => void;
  onAdjustmentSaved: (adjustment: SimilarityAdjustment) => void;
}

function filtersFromAnalysis(analysis: SimilarityAnalysisResult): SimilarityFilterSettings {
  if (!analysis.adjustment) return { ...DEFAULT_SIMILARITY_FILTERS, excluded_source_ids: [] };
  return {
    exclude_bibliography: analysis.adjustment.exclude_bibliography,
    exclude_quoted_text: analysis.adjustment.exclude_quoted_text,
    min_match_words: analysis.adjustment.min_match_words,
    excluded_source_ids: [...analysis.adjustment.excluded_source_ids],
  };
}

function sourceId(source: SimilaritySourceResult, index: number): string {
  return source.id ?? `${source.source_version_id}-${index}`;
}

export function SimilarityReportModal({
  version,
  analysis,
  canEdit,
  onClose,
  onAdjustmentSaved,
}: Props): React.JSX.Element {
  const [settings, setSettings] = useState<SimilarityFilterSettings>(() => filtersFromAnalysis(analysis));
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(() => (
    analysis.sources[0] ? sourceId(analysis.sources[0], 0) : null
  ));
  const [selectedMatchKey, setSelectedMatchKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSettings(filtersFromAnalysis(analysis));
  }, [analysis]);

  const model = useMemo(
    () => buildSimilarityViewModel(version.extracted_text, analysis, settings),
    [analysis, settings, version.extracted_text],
  );

  const selectedSourceSummary = model.sources.find((item) => (
    sourceId(item.source, item.sourceIndex) === selectedSourceId
  )) ?? model.sources[0] ?? null;

  const selectedSourceMatches = selectedSourceSummary
    ? model.matches.filter((item) => item.sourceIndex === selectedSourceSummary.sourceIndex)
    : [];

  const toggleSource = (id: string): void => {
    if (!canEdit) return;
    setSaveMessage(null);
    setSettings((current) => ({
      ...current,
      excluded_source_ids: current.excluded_source_ids.includes(id)
        ? current.excluded_source_ids.filter((value) => value !== id)
        : [...current.excluded_source_ids, id],
    }));
  };

  const reset = (): void => {
    if (!canEdit) return;
    setSaveMessage(null);
    setSettings({ ...DEFAULT_SIMILARITY_FILTERS, excluded_source_ids: [] });
  };

  const save = async (): Promise<void> => {
    if (!canEdit) return;
    setSaving(true);
    setError(null);
    setSaveMessage(null);
    try {
      const adjustment = await saveSimilarityAdjustment(
        analysis.id,
        settings,
        model.adjustedSimilarityPercent,
        model.adjustedMatchedWords,
      );
      onAdjustmentSaved(adjustment);
      setSaveMessage('Ajustes guardados. Este será el resultado visible cuando liberes el informe.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible guardar los ajustes.');
    } finally {
      setSaving(false);
    }
  };

  const focusMatch = (item: ViewerMatch): void => {
    setSelectedMatchKey(item.matchKey);
    setSelectedSourceId(sourceId(item.source, item.sourceIndex));
    const word = item.activeWords[0] ?? item.coveredWords[0] ?? item.match.target_start_word;
    window.setTimeout(() => {
      document.getElementById(`siai-report-${analysis.id}-word-${word}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }, 0);
  };

  const renderDocument = (): ReactNode[] => {
    const nodes: ReactNode[] = [];
    let cursor = 0;
    model.tokens.forEach((token, index) => {
      if (token.start > cursor) {
        nodes.push(<Fragment key={`gap-${index}`}>{version.extracted_text.slice(cursor, token.start)}</Fragment>);
      }
      const highlight = model.highlights.get(index);
      const tokenText = version.extracted_text.slice(token.start, token.end);
      if (highlight) {
        const tone = (highlight.sourceIndex % 8) + 1;
        nodes.push(
          <mark
            id={`siai-report-${analysis.id}-word-${index}`}
            key={`word-${index}`}
            className={`report-highlight source-tone-${tone} ${highlight.matchType} ${selectedMatchKey === highlight.matchKey ? 'selected' : ''}`}
            onClick={() => {
              const item = model.matches.find((match) => match.matchKey === highlight.matchKey);
              if (item) focusMatch(item);
            }}
            title={`Fuente ${highlight.sourceIndex + 1}`}
          >
            {tokenText}
          </mark>,
        );
      } else {
        nodes.push(<Fragment key={`word-${index}`}><span id={`siai-report-${analysis.id}-word-${index}`}>{tokenText}</span></Fragment>);
      }
      cursor = token.end;
    });
    if (cursor < version.extracted_text.length) {
      nodes.push(<Fragment key="tail">{version.extracted_text.slice(cursor)}</Fragment>);
    }
    return nodes;
  };

  const displayedPercent = model.adjustedSimilarityPercent;
  const changed = Math.abs(displayedPercent - analysis.similarity_percent) >= 0.005;

  return (
    <div className="report-overlay" role="presentation">
      <section className="report-shell" role="dialog" aria-modal="true" aria-label="Informe interactivo de similitud">
        <header className="report-topbar">
          <div className="report-title-block">
            <span className="eyebrow dark">Informe interactivo</span>
            <strong>{version.original_file_name}</strong>
            <small>Versión {version.version_number} · {analysis.algorithm_version}</small>
          </div>
          <div className="report-score-pair">
            <div className="report-score adjusted"><strong>{displayedPercent.toFixed(1)}%</strong><span>{changed ? 'ajustado' : 'similitud'}</span></div>
            {changed && <div className="report-score original"><strong>{analysis.similarity_percent.toFixed(1)}%</strong><span>original</span></div>}
          </div>
          <button className="report-close" type="button" onClick={onClose} aria-label="Cerrar informe">×</button>
        </header>

        <div className="report-toolbar">
          {canEdit ? (
            <>
              <label className="report-check">
                <input
                  type="checkbox"
                  checked={settings.exclude_bibliography}
                  onChange={(event) => setSettings((current) => ({ ...current, exclude_bibliography: event.target.checked }))}
                />
                Excluir bibliografía
                <small>{model.bibliographyStartWord !== null ? 'sección detectada' : 'no detectada'}</small>
              </label>
              <label className="report-check">
                <input
                  type="checkbox"
                  checked={settings.exclude_quoted_text}
                  onChange={(event) => setSettings((current) => ({ ...current, exclude_quoted_text: event.target.checked }))}
                />
                Excluir citas textuales
                <small>{model.quotedWordCount.toLocaleString('es-EC')} palabras entre comillas</small>
              </label>
              <label className="report-minimum">
                <span>Ignorar coincidencias menores de</span>
                <input
                  type="number"
                  min={10}
                  max={200}
                  value={settings.min_match_words}
                  onChange={(event) => {
                    const value = Math.max(10, Math.min(200, Number(event.target.value) || 10));
                    setSettings((current) => ({ ...current, min_match_words: value }));
                  }}
                />
                <span>palabras</span>
              </label>
              <button className="report-reset" type="button" onClick={reset}>Restablecer</button>
              <button className="report-save" type="button" disabled={saving} onClick={() => void save()}>{saving ? 'Guardando…' : 'Guardar ajustes'}</button>
            </>
          ) : (
            <div className="report-readonly-filters">
              <strong>Filtros definidos por el coordinador</strong>
              <span>{settings.exclude_bibliography ? 'Bibliografía excluida' : 'Bibliografía incluida'}</span>
              <span>{settings.exclude_quoted_text ? 'Citas textuales excluidas' : 'Citas textuales incluidas'}</span>
              <span>Mínimo {settings.min_match_words} palabras</span>
            </div>
          )}
        </div>

        {(error || saveMessage) && <div className={`report-message ${error ? 'error' : 'success'}`}>{error ?? saveMessage}</div>}

        <div className="report-workspace">
          <main className="report-document-column">
            <div className="report-document-meta">
              <span>{model.adjustedMatchedWords.toLocaleString('es-EC')} de {analysis.total_words.toLocaleString('es-EC')} palabras contabilizadas</span>
              <span>{model.sources.filter((source) => !source.excluded && source.activeMatches > 0).length} fuentes activas</span>
            </div>
            <article className="report-document">{renderDocument()}</article>
          </main>

          <aside className="report-sources-column">
            <div className="report-sidebar-heading">
              <strong>Fuentes</strong>
              <span>{analysis.sources.length}</span>
            </div>
            <div className="report-source-list">
              {model.sources.map((item) => {
                const id = sourceId(item.source, item.sourceIndex);
                const tone = (item.sourceIndex % 8) + 1;
                return (
                  <div className={`report-source-row ${selectedSourceId === id ? 'selected' : ''} ${item.excluded ? 'excluded' : ''}`} key={id}>
                    <button className="report-source-main" type="button" onClick={() => setSelectedSourceId(id)}>
                      <span className={`report-source-number source-tone-${tone}`}>{item.sourceIndex + 1}</span>
                      <span className="report-source-copy">
                        <strong>{item.source.source_title}</strong>
                        <small>{item.source.owner_name ?? 'Repositorio institucional'} · V{item.source.source_version_number}</small>
                      </span>
                      <b>{item.adjustedSimilarityPercent.toFixed(1)}%</b>
                    </button>
                    {canEdit && item.source.id && (
                      <button className="report-source-toggle" type="button" onClick={() => toggleSource(item.source.id!)}>
                        {item.excluded ? 'Incluir' : 'Excluir'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {selectedSourceSummary && (
              <div className="report-match-panel">
                <div className="report-match-title">
                  <strong>Coincidencias de la fuente {selectedSourceSummary.sourceIndex + 1}</strong>
                  <span>{selectedSourceMatches.filter((item) => item.active).length} activas</span>
                </div>
                {selectedSourceMatches.map((item, index) => (
                  <button
                    className={`report-match-item ${item.active ? '' : 'filtered'} ${selectedMatchKey === item.matchKey ? 'selected' : ''}`}
                    type="button"
                    key={item.matchKey}
                    onClick={() => focusMatch(item)}
                  >
                    <span>{item.match.match_type === 'exact' ? 'Textual' : 'Cercana'} · {item.match.similarity_score.toFixed(0)}%</span>
                    <p>{item.match.target_excerpt}</p>
                    <small>{item.active ? `${item.activeWords.length} palabras contabilizadas` : `Coincidencia ${index + 1} excluida por filtros`}</small>
                  </button>
                ))}
              </div>
            )}
          </aside>
        </div>

        {!model.exactCoverageAvailable && (
          <footer className="report-legacy-note">
            Este análisis fue generado antes de la Fase 4. El recálculo usa una aproximación proporcional. Ejecuta “Analizar de nuevo” para obtener cobertura exacta por palabra.
          </footer>
        )}
      </section>
    </div>
  );
}
