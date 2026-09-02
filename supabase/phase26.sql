-- PlagGuard · ITSQMET · Fase 26
-- Corrige el tokenizador SQL usado por la comparación institucional.
-- El patrón anterior no separaba correctamente por espacios y convertía
-- documentos completos en un único token.

create or replace function public.plagguard_tokens(p_text text)
returns text[]
language sql
immutable
parallel safe
set search_path to 'pg_catalog', 'public'
as $function$
  select coalesce(array_agg(token order by ord), '{}'::text[])
  from (
    select ord, token
    from regexp_split_to_table(
      trim(
        regexp_replace(
          lower(coalesce(p_text, '')),
          '[^[:alnum:]áéíóúüñ]+',
          ' ',
          'g'
        )
      ),
      '[[:space:]]+'
    ) with ordinality as t(token, ord)
    where char_length(token) > 0
  ) q;
$function$;

revoke all on function public.plagguard_tokens(text) from public;
revoke execute on function public.plagguard_tokens(text) from anon, authenticated;
grant execute on function public.plagguard_tokens(text) to service_role;
