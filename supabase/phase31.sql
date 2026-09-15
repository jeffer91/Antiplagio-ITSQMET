-- PlagGuard · ITSQMET · Fase 31
-- Cierre de permisos residuales detectados por Supabase Security Advisor.

-- Estas funciones forman parte del flujo autenticado/RLS y nunca deben
-- exponerse al rol anon.
revoke all on function public.admin_set_ai_evaluator_enabled(smallint, boolean) from anon;
revoke all on function public.can_read_article_review_version(uuid) from anon;

grant execute on function public.admin_set_ai_evaluator_enabled(smallint, boolean) to authenticated, service_role;
grant execute on function public.can_read_article_review_version(uuid) to authenticated, service_role;

-- El catálogo legacy de evaluadores solo se administra desde Administración.
drop policy if exists ai_evaluators_read_authenticated on public.ai_evaluators;
drop policy if exists ai_evaluators_read_admin on public.ai_evaluators;
create policy ai_evaluators_read_admin
on public.ai_evaluators for select
to authenticated
using (public.is_admin());

revoke select on public.ai_evaluators from anon;
grant select on public.ai_evaluators to authenticated;
