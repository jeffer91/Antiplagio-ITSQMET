import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  deleteAiModel,
  loadAiModels,
  saveAiModel,
  testAiModel,
  testAllAiModels,
} from '../lib/articleReview';
import type { AiAdapter, AiModelConfig, AiModelStatus } from '../types/articleReview';

const EMPTY_MODEL: Partial<AiModelConfig> = {
  provider: 'OpenRouter',
  adapter: 'openai',
  display_name: '',
  model_id: '',
  api_url: '',
  access_tier: 'Free',
  specialty: '',
  priority: 5,
  enabled: false,
  selected_for_review: false,
  fallback: false,
  supports_vision: false,
  max_concurrency: 2,
  timeout_ms: 110000,
};

function statusLabel(status: AiModelStatus): string {
  if (status === 'available') return 'Disponible';
  if (status === 'degraded') return 'Degradada';
  if (status === 'rate_limited') return 'Límite temporal';
  if (status === 'invalid_credentials') return 'Credencial inválida';
  if (status === 'model_not_found') return 'Modelo no encontrado';
  if (status === 'provider_down') return 'Proveedor caído';
  if (status === 'error') return 'Error';
  return 'Sin configurar';
}

function statusTone(status: AiModelStatus): string {
  if (status === 'available') return 'ok';
  if (status === 'degraded' || status === 'rate_limited') return 'warn';
  if (status === 'unconfigured') return 'off';
  return 'bad';
}

function formatLatency(value: number | null): string {
  if (value === null || value === undefined) return '—';
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${value} ms`;
}

export function AdminAiEvaluatorsPanel(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<AiModelConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<AiModelConfig> | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [query, setQuery] = useState('');

  const refresh = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const result = await loadAiModels();
      setModels(result.models);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible cargar los modelos IA.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const activeCount = useMemo(() => models.filter((item) => item.enabled).length, [models]);
  const availableCount = useMemo(() => models.filter((item) => item.last_status === 'available').length, [models]);
  const configuredCount = useMemo(() => models.filter((item) => item.credential_configured && item.model_id).length, [models]);
  const problemCount = useMemo(() => models.filter((item) => item.enabled && item.last_status !== 'available' && item.last_status !== 'unconfigured').length, [models]);

  const visibleModels = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('es');
    if (!needle) return models;
    return models.filter((item) => [item.display_name, item.provider, item.specialty, item.model_id]
      .some((value) => (value || '').toLocaleLowerCase('es').includes(needle)));
  }, [models, query]);

  const mutate = async (id: string, task: () => Promise<void>, success?: string): Promise<void> => {
    setBusy(id);
    setError(null);
    setMessage(null);
    try {
      await task();
      await refresh();
      if (success) setMessage(success);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible completar la acción.');
    } finally {
      setBusy(null);
    }
  };

  const patchModel = async (model: AiModelConfig, patch: Partial<AiModelConfig>): Promise<void> => {
    await saveAiModel({ ...model, ...patch, selected_for_review: false });
  };

  const saveEditing = async (): Promise<void> => {
    if (!editing) return;
    setBusy('save');
    setError(null);
    setMessage(null);
    try {
      await saveAiModel({ ...editing, selected_for_review: false }, apiKey);
      setEditing(null);
      setApiKey('');
      await refresh();
      setMessage('Modelo IA guardado. Si está habilitado, participará automáticamente en la próxima revisión.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible guardar el modelo.');
    } finally {
      setBusy(null);
    }
  };

  const runTest = (model: AiModelConfig): void => {
    void mutate(`test:${model.id}`, async () => { await testAiModel(model.id); }, `Prueba completada: ${model.display_name}.`);
  };

  const runAllTests = (): void => {
    void mutate('test-all', async () => { await testAllAiModels(); }, 'Pruebas de todas las IA habilitadas completadas.');
  };

  return (
    <aside className={`ai-admin-drawer ai-model-manager ${open ? 'open' : ''}`} aria-label="Inteligencias artificiales">
      <button className="ai-admin-trigger" type="button" onClick={() => setOpen((value) => !value)}>
        <span>IA</span>
        <strong>{activeCount}/{models.length}</strong>
        <small>{availableCount} disponibles</small>
      </button>

      {open && (
        <div className="ai-admin-panel ai-model-panel">
          <header>
            <div>
              <span className="eyebrow dark">Administración</span>
              <h2>Inteligencias Artificiales</h2>
              <p>Configura las IA. Todas las que estén habilitadas revisarán el artículo automáticamente.</p>
            </div>
            <button className="ghost-button compact" type="button" onClick={() => setOpen(false)}>Cerrar</button>
          </header>

          <div className="ai-status-summary">
            <div><span>Catálogo</span><strong>{models.length}</strong></div>
            <div><span>Configuradas</span><strong>{configuredCount}</strong></div>
            <div><span>Habilitadas</span><strong>{activeCount}</strong></div>
            <div><span>Disponibles</span><strong>{availableCount}</strong></div>
          </div>

          <div className="ai-admin-toolbar ai-model-toolbar">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar IA o proveedor" />
            <div>
              <button type="button" onClick={() => { setEditing({ ...EMPTY_MODEL }); setApiKey(''); }}>Agregar IA</button>
              <button type="button" onClick={runAllTests} disabled={busy !== null || loading || activeCount === 0}>Probar habilitadas</button>
            </div>
          </div>

          {error && <div className="alert error-alert">{error}</div>}
          {message && <div className="alert success-alert">{message}</div>}

          {loading ? <div className="inline-loading"><span className="mini-spinner" />Cargando modelos…</div> : (
            <div className="ai-model-table-wrap">
              <table className="ai-model-table">
                <thead>
                  <tr>
                    <th>Estado</th>
                    <th>IA / modelo</th>
                    <th>Proveedor</th>
                    <th>Uso</th>
                    <th>Latencia</th>
                    <th>Participa</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleModels.map((model) => {
                    const readyToEnable = Boolean(model.model_id && model.credential_configured);
                    return (
                      <tr key={model.id}>
                        <td>
                          <span className={`ai-status-chip ${statusTone(model.last_status)}`} title={model.last_error || statusLabel(model.last_status)}>
                            <i />{statusLabel(model.last_status)}
                          </span>
                        </td>
                        <td>
                          <strong>{model.display_name}</strong>
                          <small>{model.model_id || 'Falta Model ID'} · {model.access_tier || 'Sin acceso definido'}</small>
                        </td>
                        <td>{model.provider}</td>
                        <td className="ai-model-specialty">{model.specialty || 'Evaluación general'}</td>
                        <td>{formatLatency(model.last_latency_ms)}</td>
                        <td>
                          <input
                            type="checkbox"
                            checked={model.enabled}
                            disabled={busy !== null || (!model.enabled && !readyToEnable)}
                            title={!model.enabled && !readyToEnable ? 'Completa Model ID y API key antes de habilitarla' : 'Las IA habilitadas participan automáticamente'}
                            onChange={(event) => void mutate(`enable:${model.id}`, () => patchModel(model, { enabled: event.target.checked }))}
                          />
                        </td>
                        <td>
                          <div className="ai-row-actions">
                            <button type="button" onClick={() => runTest(model)} disabled={busy !== null || !readyToEnable}>Probar</button>
                            <button type="button" onClick={() => { setEditing({ ...model }); setApiKey(''); }} disabled={busy !== null}>Editar</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {visibleModels.length === 0 && <div className="article-review-empty compact">No hay modelos que coincidan con la búsqueda.</div>}
            </div>
          )}

          <footer>
            Regla de ejecución: toda IA habilitada participa en paralelo en la revisión del estudiante. Si una falla, las demás continúan y el informe muestra la falla por separado.
          </footer>
        </div>
      )}

      {editing && (
        <div className="ai-model-editor-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && busy === null) { setEditing(null); setApiKey(''); }
        }}>
          <section className="ai-model-editor" role="dialog" aria-modal="true" aria-label="Configurar modelo IA">
            <header>
              <div>
                <span className="eyebrow dark">Modelo IA</span>
                <h3>{editing.id ? 'Editar configuración' : 'Agregar IA'}</h3>
              </div>
              <button type="button" className="ghost-button compact" onClick={() => { setEditing(null); setApiKey(''); }} disabled={busy !== null}>Cerrar</button>
            </header>

            <div className="ai-editor-grid">
              <label>Nombre visible<input value={editing.display_name ?? ''} onChange={(event) => setEditing({ ...editing, display_name: event.target.value })} placeholder="Gemini / Nemotron / Qwen…" /></label>
              <label>Proveedor<input value={editing.provider ?? ''} onChange={(event) => setEditing({ ...editing, provider: event.target.value })} placeholder="Google, OpenRouter, Groq…" /></label>
              <label>Adaptador<select value={editing.adapter ?? 'openai'} onChange={(event) => setEditing({ ...editing, adapter: event.target.value as AiAdapter })}><option value="openai">OpenAI compatible</option><option value="gemini">Gemini</option><option value="cohere">Cohere</option><option value="cloudflare">Cloudflare</option><option value="custom">Custom</option></select></label>
              <label>Model ID<input value={editing.model_id ?? ''} onChange={(event) => setEditing({ ...editing, model_id: event.target.value })} placeholder="ID exacto del proveedor" /></label>
              <label className="wide">API URL<input value={editing.api_url ?? ''} onChange={(event) => setEditing({ ...editing, api_url: event.target.value })} placeholder="Opcional para Google/Groq/OpenRouter/Cohere; requerido para custom" /></label>
              <label>Tipo de acceso<input value={editing.access_tier ?? ''} onChange={(event) => setEditing({ ...editing, access_tier: event.target.value })} placeholder="Free Tier / Local" /></label>
              <label>Prioridad<input type="number" min="0" max="10" step="0.1" value={editing.priority ?? 5} onChange={(event) => setEditing({ ...editing, priority: Number(event.target.value) })} /></label>
              <label className="wide">Mejor uso<textarea value={editing.specialty ?? ''} onChange={(event) => setEditing({ ...editing, specialty: event.target.value })} placeholder="Metodología, discusión, razonamiento crítico…" /></label>
              <label className="wide">API key<input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={editing.credential_configured ? 'Dejar vacío para conservar la actual' : 'Ingresa la clave del proveedor'} /></label>
            </div>

            <div className="ai-editor-options">
              <label><input type="checkbox" checked={Boolean(editing.enabled)} onChange={(event) => setEditing({ ...editing, enabled: event.target.checked })} /> Habilitada</label>
              <label><input type="checkbox" checked={Boolean(editing.fallback)} onChange={(event) => setEditing({ ...editing, fallback: event.target.checked })} /> Respaldo informativo</label>
              <label><input type="checkbox" checked={Boolean(editing.supports_vision)} onChange={(event) => setEditing({ ...editing, supports_vision: event.target.checked })} /> Soporta visión</label>
            </div>

            <div className="modal-actions">
              {editing.id && <button className="danger-text-button" type="button" disabled={busy !== null} onClick={() => {
                const id = editing.id!;
                if (!window.confirm('¿Eliminar este modelo del catálogo?')) return;
                void mutate(`delete:${id}`, async () => { await deleteAiModel(id); setEditing(null); }, 'Modelo eliminado.');
              }}>Eliminar</button>}
              <button className="ghost-button" type="button" onClick={() => { setEditing(null); setApiKey(''); }} disabled={busy !== null}>Cancelar</button>
              <button className="primary-button compact" type="button" onClick={() => void saveEditing()} disabled={busy !== null || !editing.display_name?.trim()}>{busy === 'save' ? 'Guardando…' : 'Guardar modelo'}</button>
            </div>
          </section>
        </div>
      )}
    </aside>
  );
}
