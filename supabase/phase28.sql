-- PlagGuard · ITSQMET · Fase 28
-- Revisor global de artículos: 15 evaluadores IA configurables, resultados individuales
-- y novedades consolidadas. El antiplagio existente permanece independiente.

create table if not exists public.ai_evaluators (
  slot smallint primary key check (slot between 1 and 15),
  name text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.ai_evaluators (slot, name, enabled)
select value, 'IA ' || lpad(value::text, 2, '0'), true
from generate_series(1, 15) as value
on conflict (slot) do update set name = excluded.name;

create table if not exists public.article_review_runs (
  id uuid primary key default gen_random_uuid(),
  target_version_id uuid not null references public.document_versions(id) on delete cascade,
  analysis_attempt_id uuid references public.analysis_attempts(id) on delete set null,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'running' check (status in ('running','completed','partial','failed')),
  rubric_version text not null default 'elite-2026-v1',
  prompt_version text not null default 'global-review-v1',
  evaluator_count integer not null default 0 check (evaluator_count between 0 and 15),
  successful_evaluators integer not null default 0 check (successful_evaluators between 0 and 15),
  evaluator_slots smallint[] not null default '{}',
  similarity_percent numeric(6,2),
  final_score numeric(4,2),
  performance_level text,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists article_review_runs_version_idx
  on public.article_review_runs(target_version_id, created_at desc);
create index if not exists article_review_runs_requester_idx
  on public.article_review_runs(requested_by, created_at desc);

create table if not exists public.article_reviewer_results (
  run_id uuid not null references public.article_review_runs(id) on delete cascade,
  evaluator_slot smallint not null check (evaluator_slot between 1 and 15),
  evaluator_name text not null,
  score numeric(4,2),
  duration_ms integer,
  status text not null check (status in ('completed','failed')),
  findings jsonb not null default '[]'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  primary key (run_id, evaluator_slot)
);

create table if not exists public.article_review_findings (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.article_review_runs(id) on delete cascade,
  issue_key text not null,
  criterion text not null,
  title text not null,
  severity text not null check (severity in ('low','medium','high','critical')),
  page integer,
  fragment text not null default '',
  explanation text not null,
  recommendation text not null,
  deduction numeric(4,2) not null check (deduction >= 0),
  detected_by smallint[] not null default '{}',
  detected_by_count integer not null default 1,
  confidence numeric(5,4) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists article_review_findings_run_idx
  on public.article_review_findings(run_id, deduction desc);

create or replace function public.can_read_article_review_version(p_version_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.document_versions dv
    join public.documents d on d.id = dv.document_id
    where dv.id = p_version_id
      and (
        d.owner_id = auth.uid()
        or exists (
          select 1 from public.profiles p
          where p.id = auth.uid()
            and p.role::text in ('coordinator','admin')
        )
      )
  );
$$;

revoke all on function public.can_read_article_review_version(uuid) from public;
grant execute on function public.can_read_article_review_version(uuid) to authenticated, service_role;

create or replace function public.admin_set_ai_evaluator_enabled(p_slot smallint, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role::text = 'admin'
  ) then
    raise exception 'Solo el administrador puede cambiar los evaluadores IA';
  end if;

  if p_slot < 1 or p_slot > 15 then
    raise exception 'Evaluador IA no válido';
  end if;

  update public.ai_evaluators
  set enabled = p_enabled, updated_at = now()
  where slot = p_slot;
end;
$$;

revoke all on function public.admin_set_ai_evaluator_enabled(smallint, boolean) from public;
grant execute on function public.admin_set_ai_evaluator_enabled(smallint, boolean) to authenticated;

alter table public.ai_evaluators enable row level security;
alter table public.article_review_runs enable row level security;
alter table public.article_reviewer_results enable row level security;
alter table public.article_review_findings enable row level security;

drop policy if exists ai_evaluators_read_authenticated on public.ai_evaluators;
create policy ai_evaluators_read_authenticated
on public.ai_evaluators for select
to authenticated
using (true);

drop policy if exists article_review_runs_read_authorized on public.article_review_runs;
create policy article_review_runs_read_authorized
on public.article_review_runs for select
to authenticated
using (public.can_read_article_review_version(target_version_id));

drop policy if exists article_reviewer_results_read_authorized on public.article_reviewer_results;
create policy article_reviewer_results_read_authorized
on public.article_reviewer_results for select
to authenticated
using (
  exists (
    select 1 from public.article_review_runs r
    where r.id = run_id
      and public.can_read_article_review_version(r.target_version_id)
  )
);

drop policy if exists article_review_findings_read_authorized on public.article_review_findings;
create policy article_review_findings_read_authorized
on public.article_review_findings for select
to authenticated
using (
  exists (
    select 1 from public.article_review_runs r
    where r.id = run_id
      and public.can_read_article_review_version(r.target_version_id)
  )
);

grant select on public.ai_evaluators to authenticated;
grant select on public.article_review_runs to authenticated;
grant select on public.article_reviewer_results to authenticated;
grant select on public.article_review_findings to authenticated;

grant all on public.ai_evaluators to service_role;
grant all on public.article_review_runs to service_role;
grant all on public.article_reviewer_results to service_role;
grant all on public.article_review_findings to service_role;
