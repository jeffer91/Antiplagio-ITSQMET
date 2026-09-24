-- PlagGuard · ITSQMET · Fase 28
-- Alcance actual: SOLO antiplagio/similitud.
-- Esta fase retira el antiguo revisor académico global y sus 15 evaluadores.
-- Es segura tanto para instalaciones que aplicaron la versión anterior de Fase 28
-- como para instalaciones nuevas, porque todos los DROP usan IF EXISTS.

drop function if exists public.admin_set_ai_evaluator_enabled(smallint, boolean);
drop function if exists public.can_read_article_review_version(uuid);

drop table if exists public.article_review_findings cascade;
drop table if exists public.article_reviewer_results cascade;
drop table if exists public.article_review_runs cascade;
drop table if exists public.ai_evaluators cascade;

comment on table public.external_similarity_analyses is
  'Análisis antiplagio externo. Puede incluir validación semántica con IA contra fuentes reales localizadas.';

-- Se conservan estos nombres de tabla por compatibilidad con intentos e informes
-- ya emitidos, pero desde esta fase su contenido representa trazabilidad de
-- coincidencias semánticas contra fuentes, no detección de autoría por IA.
comment on table public.ai_writing_analyses is
  'Trazabilidad histórica/compatible de la validación semántica con IA usada por PlagGuard.';
comment on table public.ai_writing_segments is
  'Fragmentos de similitud semántica vinculados a fuentes externas localizadas.';
comment on table public.ai_writing_segment_reviews is
  'Tabla histórica de decisiones sobre segmentos; se conserva por compatibilidad de trazabilidad.';
