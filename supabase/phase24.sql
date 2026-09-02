-- PlagGuard · ITSQMET · Fase 24
-- Limpieza final de privilegios y search_path en helpers internos.

revoke execute on function public.current_user_cedula() from anon;
revoke execute on function public.handle_new_user() from anon, authenticated;
revoke execute on function public.rls_auto_enable() from anon, authenticated;

create or replace function public.plagguard_tokens(p_text text)
returns text[]
language sql
immutable
parallel safe
set search_path = pg_catalog, public
as $$
  select coalesce(array_agg(token order by ord), '{}'::text[])
  from (
    select ord, token
    from unnest(
      regexp_split_to_array(
        trim(regexp_replace(lower(coalesce(p_text, '')), '[^[:alnum:]áéíóúüñ]+', ' ', 'g')),
        '\\s+'
      )
    ) with ordinality as t(token, ord)
    where char_length(token) > 0
  ) q;
$$;
