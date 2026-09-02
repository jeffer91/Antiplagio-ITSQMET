-- PlagGuard · ITSQMET · Fase 22
-- Capacidad de análisis limitada a la versión propia dentro de un proceso activo.

create or replace function public.is_coordinator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role in ('coordinator'::public.app_role, 'admin'::public.app_role)
    )
    or (
      current_setting('plagguard.allow_analysis', true) = 'on'
      and coalesce(current_setting('plagguard.target_version', true), '') ~ '^[0-9a-fA-F-]{36}$'
      and exists (
        select 1
        from public.document_versions dv
        join public.documents d on d.id = dv.document_id
        where dv.id = current_setting('plagguard.target_version', true)::uuid
          and d.owner_id = auth.uid()
      )
    );
$$;

create or replace function public.can_analyze_version(p_version_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.document_versions dv
    join public.documents d on d.id = dv.document_id
    where dv.id = p_version_id
      and (
        public.is_admin()
        or exists (
          select 1
          from public.profiles p
          where p.id = auth.uid()
            and p.role = 'coordinator'::public.app_role
        )
        or (
          d.owner_id = auth.uid()
          and d.academic_period_id is not null
          and exists (
            select 1
            from public.student_enrollments e
            join public.academic_periods ap on ap.id = e.period_id
            where e.student_id = d.owner_id
              and e.period_id = d.academic_period_id
              and e.active
              and ap.active
          )
        )
      )
  );
$$;

revoke execute on function public.is_coordinator() from anon;
revoke execute on function public.can_analyze_version(uuid) from anon;
grant execute on function public.is_coordinator() to authenticated, service_role;
grant execute on function public.can_analyze_version(uuid) to authenticated, service_role;
