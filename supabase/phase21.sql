-- PlagGuard · ITSQMET · Fase 21
-- Hardening de autenticación y metadatos de proceso provenientes de Firebase.

create table if not exists public.auth_rate_limits (
  rate_key text primary key,
  attempt_count integer not null default 0,
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.auth_rate_limits enable row level security;
revoke all on public.auth_rate_limits from anon, authenticated;
grant all on public.auth_rate_limits to service_role;

alter table public.student_enrollments
  add column if not exists source text not null default 'manual',
  add column if not exists firebase_matricula_id text,
  add column if not exists firebase_updated_at text;

create index if not exists student_enrollments_firebase_matricula_idx
  on public.student_enrollments(firebase_matricula_id)
  where firebase_matricula_id is not null;

create or replace function public.admin_set_period_state(
  p_period_id uuid,
  p_ordinary_open boolean,
  p_supplementary_open boolean,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Solo el Administrador puede modificar periodos';
  end if;

  update public.academic_periods
  set ordinary_open = coalesce(p_ordinary_open, ordinary_open),
      supplementary_open = coalesce(p_supplementary_open, supplementary_open),
      updated_at = now()
  where id = p_period_id;

  if not found then raise exception 'Periodo no encontrado'; end if;

  if coalesce(p_supplementary_open, false) then
    update public.notifications
    set resolved = true, resolved_at = now()
    where period_id = p_period_id
      and kind = 'supplementary_required'
      and not resolved;
  end if;
end;
$$;

revoke execute on function public.admin_create_period(text,numeric,integer,integer,boolean,boolean)
  from anon, authenticated;
grant execute on function public.admin_create_period(text,numeric,integer,integer,boolean,boolean)
  to service_role;

revoke execute on all functions in schema public from anon;

grant execute on function public.is_admin() to authenticated, service_role;
