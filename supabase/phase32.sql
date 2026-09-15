-- PlagGuard · ITSQMET · Fase 32
-- Revisión académica multi-IA sin límite fijo de 15 modelos.
-- Todas las IA habilitadas participan automáticamente en cada revisión.

-- 1) Quitar límites heredados de la Fase 28 -------------------------------
alter table public.article_review_runs
  drop constraint if exists article_review_runs_evaluator_count_check;
alter table public.article_review_runs
  drop constraint if exists article_review_runs_successful_evaluators_check;
alter table public.article_reviewer_results
  drop constraint if exists article_reviewer_results_evaluator_slot_check;

alter table public.article_review_runs
  add constraint article_review_runs_evaluator_count_check
  check (evaluator_count >= 0);
alter table public.article_review_runs
  add constraint article_review_runs_successful_evaluators_check
  check (successful_evaluators >= 0 and successful_evaluators <= evaluator_count);
alter table public.article_reviewer_results
  add constraint article_reviewer_results_evaluator_slot_check
  check (evaluator_slot >= 1);

-- `selected_for_review` se conserva solo por compatibilidad histórica.
-- El motor nuevo usa directamente todas las filas con enabled = true.
update public.ai_models
set selected_for_review = false,
    updated_at = now()
where selected_for_review = true;

-- 2) Retirar únicamente semillas antiguas que nunca fueron configuradas ----
-- No se elimina ninguna IA que ya tenga un Model ID configurado por el admin.
delete from public.ai_models
where coalesce(model_id, '') = ''
  and display_name in (
    'Gemini 2.5 Pro',
    'Gemini 2.5 Flash',
    'Gemini 2.5 Flash-Lite',
    'Command A Reasoning',
    'Command A+',
    'Command A',
    'Command R+',
    'Command R',
    'Command R7B',
    'Qwen 3.8 27B',
    'Qwen 3.6 27B',
    'GLM 4.7 Flash',
    'Gemma 4 26B A4B IT',
    'Nemotron 3 120B A12B',
    'OpenRouter Free Router',
    'Ling 3.0 Flash Santé',
    'Inkling'
  );

-- 3) Catálogo solicitado de 26 IA -----------------------------------------
-- Se cargan como catálogo, pero permanecen deshabilitadas hasta que el
-- Administrador coloque el Model ID real y las credenciales correspondientes.
-- Las IA Ollama requieren un agente/puente local seguro; GitHub Pages y una
-- Edge Function en la nube no pueden acceder al localhost del estudiante.
insert into public.ai_models
  (provider, adapter, display_name, model_id, access_tier, specialty, priority, enabled, selected_for_review, fallback, supports_vision)
values
  ('Google', 'gemini', 'Gemini 3.8 Flash', '', 'Gemini API', 'Revisión general, metodología y coherencia', 10.00, false, false, false, false),
  ('Google', 'gemini', 'Gemini 3.7 Flash', '', 'Gemini API', 'Texto largo y análisis integral', 9.90, false, false, false, false),
  ('Google', 'gemini', 'Gemini 3.6 Flash', '', 'Gemini API', 'Revisión académica rápida', 9.80, false, false, false, false),
  ('OpenRouter', 'openai', 'NVIDIA Nemotron 3 Ultra', '', 'OpenRouter', 'Razonamiento profundo y documentos largos', 9.70, false, false, false, false),
  ('OpenRouter', 'openai', 'NVIDIA Nemotron 3 Super', '', 'OpenRouter', 'Evaluación crítica y coherencia científica', 9.60, false, false, false, false),
  ('OpenRouter', 'openai', 'Gemma 4 31B', '', 'OpenRouter', 'Comprensión de documentos académicos', 9.50, false, false, false, false),
  ('OpenRouter', 'openai', 'Gemma 4 26B A4B', '', 'OpenRouter', 'Estructura, redacción y análisis', 9.40, false, false, false, false),
  ('OpenRouter', 'openai', 'Thinking Machines Inkling', '', 'OpenRouter', 'Razonamiento y análisis multidocumento', 9.30, false, false, false, false),
  ('OpenRouter', 'openai', 'Inkling Small', '', 'OpenRouter', 'Revisión secundaria ligera', 9.20, false, false, false, false),
  ('OpenRouter', 'openai', 'Dots3-Note Preview', '', 'OpenRouter', 'Documentos extensos y estructura', 9.10, false, false, false, false),
  ('OpenRouter', 'openai', 'Ling 3.0 Flash VL', '', 'OpenRouter', 'Texto, figuras y tablas', 9.00, false, false, false, true),
  ('OpenRouter', 'openai', 'Ling 3.0 Flash Sante', '', 'OpenRouter', 'Artículos de salud y ciencias médicas', 8.90, false, false, false, false),
  ('OpenRouter', 'openai', 'Ling 3.0 Flash Fin', '', 'OpenRouter', 'Finanzas, economía y análisis cuantitativo', 8.80, false, false, false, false),
  ('OpenRouter', 'openai', 'NVIDIA Nemotron 3.5 Lightning', '', 'OpenRouter', 'Revisión rápida y contraste', 8.70, false, false, false, false),
  ('OpenRouter', 'openai', 'NVIDIA Nemotron 3 Nano Omni', '', 'OpenRouter', 'Modelo multimodal de contraste', 8.60, false, false, false, true),
  ('OpenRouter', 'openai', 'Nex-N2.5-Pro', '', 'OpenRouter', 'Razonamiento y procesos complejos', 8.50, false, false, false, false),
  ('OpenRouter', 'openai', 'Nex-N2.5-Mini', '', 'OpenRouter', 'Revisión rápida secundaria', 8.40, false, false, false, false),
  ('OpenRouter', 'openai', 'Poolside Laguna S 2.1', '', 'OpenRouter', 'Revisor académico adicional', 8.30, false, false, false, false),
  ('OpenRouter', 'openai', 'Poolside Laguna XS 2.1', '', 'OpenRouter', 'Revisión secundaria rápida', 8.20, false, false, false, false),
  ('OpenRouter', 'openai', 'Cohere North Mini Code', '', 'OpenRouter', 'Contraste lógico y técnico', 8.10, false, false, false, false),
  ('Groq', 'openai', 'GPT-OSS 120B', '', 'Groq / Ollama', 'Razonamiento académico profundo', 9.50, false, false, false, false),
  ('Groq', 'openai', 'GPT-OSS 20B', '', 'Groq / Ollama', 'Revisión académica rápida', 8.80, false, false, false, false),
  ('Ollama local', 'custom', 'Qwen 3.5 27B', '', 'Local', 'Español y razonamiento; requiere agente local seguro', 9.20, false, false, false, false),
  ('Ollama local', 'custom', 'Qwen 3.5 9B', '', 'Local', 'Revisión local ligera; requiere agente local seguro', 8.40, false, false, false, false),
  ('Ollama local', 'custom', 'Gemma 3 27B', '', 'Local', 'Redacción y análisis local; requiere agente local seguro', 8.70, false, false, false, false),
  ('Ollama local', 'custom', 'Gemma 3 12B', '', 'Local', 'Revisión local ligera; requiere agente local seguro', 8.00, false, false, false, false)
on conflict (display_name) do update set
  provider = excluded.provider,
  adapter = excluded.adapter,
  access_tier = excluded.access_tier,
  specialty = excluded.specialty,
  priority = excluded.priority,
  supports_vision = excluded.supports_vision,
  selected_for_review = false,
  updated_at = now();

comment on column public.ai_models.selected_for_review is
  'Campo legado. Desde Fase 32 todas las IA con enabled=true participan automáticamente en la revisión.';
