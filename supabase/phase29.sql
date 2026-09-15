-- PlagGuard · ITSQMET · Fase 29
-- Catálogo multi-proveedor de IA, credenciales protegidas por Edge Function,
-- pruebas de disponibilidad y trazabilidad por modelo en cada revisión.

create table if not exists public.ai_models (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  adapter text not null default 'openai' check (adapter in ('openai','gemini','cohere','cloudflare','custom')),
  display_name text not null unique,
  model_id text not null default '',
  api_url text,
  access_tier text,
  specialty text,
  priority numeric(4,2) not null default 5,
  enabled boolean not null default false,
  selected_for_review boolean not null default false,
  fallback boolean not null default false,
  supports_vision boolean not null default false,
  max_concurrency integer not null default 2 check (max_concurrency between 1 and 10),
  timeout_ms integer not null default 110000 check (timeout_ms between 5000 and 180000),
  last_status text not null default 'unconfigured' check (last_status in ('unconfigured','available','degraded','rate_limited','invalid_credentials','model_not_found','provider_down','error')),
  last_test_at timestamptz,
  last_latency_ms integer,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_model_credentials (
  model_id uuid primary key references public.ai_models(id) on delete cascade,
  encrypted_key text not null,
  iv text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ai_models enable row level security;
alter table public.ai_model_credentials enable row level security;

drop policy if exists ai_models_read_authenticated on public.ai_models;
create policy ai_models_read_authenticated
on public.ai_models for select
to authenticated
using (true);

-- Las credenciales nunca son legibles directamente por el navegador.
revoke all on public.ai_model_credentials from anon, authenticated;
grant all on public.ai_model_credentials to service_role;
grant select on public.ai_models to authenticated;
grant all on public.ai_models to service_role;

create index if not exists ai_models_review_idx
  on public.ai_models(selected_for_review, enabled, priority desc);
create index if not exists ai_models_provider_idx
  on public.ai_models(provider, enabled);

alter table public.article_review_runs
  add column if not exists selected_model_ids uuid[] not null default '{}',
  add column if not exists successful_model_ids uuid[] not null default '{}',
  add column if not exists minimum_consensus numeric(5,4) not null default 0.20,
  add column if not exists minimum_success integer not null default 2,
  add column if not exists config_snapshot jsonb not null default '{}'::jsonb;

alter table public.article_reviewer_results
  add column if not exists model_ref uuid references public.ai_models(id) on delete set null,
  add column if not exists provider text,
  add column if not exists provider_model_id text,
  add column if not exists adapter text,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz;

create index if not exists article_reviewer_results_model_idx
  on public.article_reviewer_results(model_ref, created_at desc);

-- Catálogo inicial solicitado. Los IDs técnicos y credenciales se completan
-- desde Administración; por seguridad todos inician desactivados.
insert into public.ai_models (provider, adapter, display_name, access_tier, specialty, priority, supports_vision)
values
  ('Google','gemini','Gemini 2.5 Pro','Google Free Tier','Evaluación académica profunda, metodología, discusión y documento completo',10.00,false),
  ('Google','gemini','Gemini 2.5 Flash','Google Free Tier','Revisión integral rápida de artículos',9.90,false),
  ('OpenRouter','openai','NVIDIA Nemotron 3 Ultra','OpenRouter Free','Razonamiento crítico y detección de inconsistencias',9.80,false),
  ('Groq','openai','GPT-OSS 120B','Groq Free','Segundo dictamen académico independiente',9.70,false),
  ('OpenRouter','openai','NVIDIA Nemotron 3 Super','OpenRouter Free','Metodología, resultados y discusión',9.60,false),
  ('Cohere','cohere','Command A Reasoning','Cohere Evaluation','Argumentación y razonamiento científico',9.50,false),
  ('OpenRouter','openai','Inkling','OpenRouter Free','Artículos extensos y análisis multimodal',9.50,true),
  ('Google','gemini','Gemini 2.5 Flash-Lite','Google Free Tier','Preevaluación, clasificación y extracción',9.40,false),
  ('Groq','openai','Qwen 3.8 27B','Groq Free','Análisis crítico, lógica y metodología',9.30,false),
  ('Cohere','cohere','Command A+','Cohere Evaluation','Calidad académica y lenguaje',9.30,false),
  ('OpenRouter','openai','Dots3-Note Preview','OpenRouter Free','Documentos largos, estructura y razonamiento',9.20,false),
  ('OpenRouter','openai','Ling 3.0 Flash Santé','OpenRouter Free','Artículos de medicina y ciencias de la salud',9.20,false),
  ('Cloudflare','cloudflare','GLM 4.7 Flash','Cloudflare Free','Redacción, coherencia y revisión multilingüe',9.10,false),
  ('Cloudflare','cloudflare','Gemma 4 26B A4B IT','Cloudflare Free','Evaluación general, tablas e imágenes',9.00,true),
  ('Cloudflare','cloudflare','Nemotron 3 120B A12B','Cloudflare Free','Razonamiento y evaluación metodológica',9.00,false),
  ('OpenRouter','openai','Ling 3.0 Flash VL','OpenRouter Free','Figuras, gráficos y contenido visual',8.90,true),
  ('Cohere','cohere','Command A','Cohere Evaluation','Coherencia, redacción y argumentación',8.90,false),
  ('Cohere','cohere','Command R+','Cohere Evaluation','Comparación con rúbricas y documentos de apoyo',8.80,false),
  ('OpenRouter','openai','Inkling Small','OpenRouter Free','Revisión rápida con contexto amplio',8.80,false),
  ('OpenRouter','openai','Nemotron 3.5 Lightning','OpenRouter Free','Evaluaciones masivas rápidas',8.70,false),
  ('Groq','openai','Qwen 3.6 27B','Groq Free','Metodología y revisión lógica',8.70,false),
  ('Groq','openai','GPT-OSS 20B','Groq Free','Preevaluaciones y segunda opinión',8.60,false),
  ('Cohere','cohere','Command R','Cohere Evaluation','RAG, referencias y documentación',8.50,false),
  ('Cohere','cohere','Command R7B','Cohere Evaluation','Revisiones sencillas de bajo consumo',8.20,false),
  ('OpenRouter','openai','OpenRouter Free Router','OpenRouter Free','Respaldo automático con un modelo gratuito disponible',9.00,false)
on conflict (display_name) do update set
  provider = excluded.provider,
  adapter = excluded.adapter,
  access_tier = excluded.access_tier,
  specialty = excluded.specialty,
  priority = excluded.priority,
  supports_vision = excluded.supports_vision,
  updated_at = now();

-- Compatibilidad: si phase28 dejó slots habilitados, se conservan hasta que
-- el motor nuevo tenga modelos configurados. No se eliminan datos históricos.
