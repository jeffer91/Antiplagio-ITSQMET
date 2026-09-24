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
