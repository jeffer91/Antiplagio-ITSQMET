import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadAiEvaluators, setAiEvaluatorEnabled, setAllAiEvaluatorsEnabled } from '../lib/articleReview';
import type { AiEvaluatorConfig } from '../types/articleReview';

export function AdminAiEvaluatorsPanel(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [evaluators, setEvaluators] = useState<AiEvaluatorConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [busySlot, setBusySlot] = useState<number | 'all' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      setEvaluators(await loadAiEvaluators());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible cargar los evaluadores IA.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const activeCount = useMemo(() => evaluators.filter((item) => item.enabled).length, [evaluators]);

  const toggle = async (slot: number, enabled: boolean): Promise<void> => {
    setBusySlot(slot);
    setError(null);
    try {
      await setAiEvaluatorEnabled(slot, enabled);
      setEvaluators((current) => current.map((item) => item.slot === slot ? { ...item, enabled } : item));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible actualizar el evaluador.');
    } finally {
      setBusySlot(null);
    }
  };

  const toggleAll = async (enabled: boolean): Promise<void> => {
    setBusySlot('all');
    setError(null);
    try {
      await setAllAiEvaluatorsEnabled(enabled);
      setEvaluators((current) => current.map((item) => ({ ...item, enabled })));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible actualizar los evaluadores.');
    } finally {
      setBusySlot(null);
    }
  };

  return (
    <aside className={`ai-admin-drawer ${open ? 'open' : ''}`} aria-label="Evaluadores IA">
      <button className="ai-admin-trigger" type="button" onClick={() => setOpen((value) => !value)}>
        <span>IA</span>
        <strong>{activeCount || 0}/15</strong>
      </button>

      {open && (
        <div className="ai-admin-panel">
          <header>
            <div>
              <span className="eyebrow dark">Revisión global</span>
              <h2>15 evaluadores IA</h2>
              <p>Activa solo los evaluadores que quieras usar en la siguiente prueba.</p>
            </div>
            <button className="ghost-button compact" type="button" onClick={() => setOpen(false)}>Cerrar</button>
          </header>

          <div className="ai-admin-toolbar">
            <span><strong>{activeCount}</strong> activos</span>
            <div>
              <button type="button" onClick={() => void toggleAll(true)} disabled={busySlot !== null || loading}>Todos ON</button>
              <button type="button" onClick={() => void toggleAll(false)} disabled={busySlot !== null || loading}>Todos OFF</button>
            </div>
          </div>

          {error && <div className="alert error-alert">{error}</div>}
          {loading ? <div className="inline-loading"><span className="mini-spinner" />Cargando evaluadores…</div> : (
            <div className="ai-evaluator-grid">
              {evaluators.map((evaluator) => (
                <label className={`ai-evaluator-row ${evaluator.enabled ? 'enabled' : 'disabled'}`} key={evaluator.slot}>
                  <div>
                    <strong>{evaluator.name}</strong>
                    <span>{evaluator.enabled ? 'Participa en la evaluación' : 'No participa'}</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={evaluator.enabled}
                    disabled={busySlot !== null}
                    onChange={(event) => void toggle(evaluator.slot, event.target.checked)}
                  />
                </label>
              ))}
            </div>
          )}

          <footer>
            Las IA activas evalúan el artículo completo en paralelo. El antiplagio sigue ejecutándose por separado.
          </footer>
        </div>
      )}
    </aside>
  );
}
