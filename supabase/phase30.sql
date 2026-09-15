-- PlagGuard · ITSQMET · Fase 30
-- Hardening posterior a auditoría: segundo factor por PIN para estudiantes,
-- menor exposición de configuración IA y endpoints de proveedores restringidos.

-- 1) Credenciales PIN de estudiantes -----------------------------------------
create table if not exists public.student_pin_credentials (
  student_user_id uuid primary key references public.profiles(id) on delete cascade,
  cedula text not null unique check (cedula ~ '^\d{10}$'),
  pin_salt text not null,
  pin_hash text not null,
  iterations integer not null default 210000 check (iterations between 100000 and 1000000),
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  active boolean not null default true,
  must_rotate boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists student_pin_credentials_cedula_idx
  on public.student_pin_credentials(cedula)
  where active;

alter table public.student_pin_credentials enable row level security;
revoke all on public.student_pin_credentials from anon, authenticated;
grant all on public.student_pin_credentials to service_role;

comment on table public.student_pin_credentials is
  'Credenciales PIN de estudiantes. Nunca son accesibles desde el navegador; solo Edge Functions con service_role.';

-- 2) Configuración IA: metadatos operativos solo para Administración ----------
drop policy if exists ai_models_read_authenticated on public.ai_models;
drop policy if exists ai_models_read_admin on public.ai_models;
create policy ai_models_read_admin
on public.ai_models for select
to authenticated
using (public.is_admin());

revoke select on public.ai_models from anon;
grant select on public.ai_models to authenticated;

-- 3) Bloqueo de endpoints arbitrarios ----------------------------------------
-- Las API keys cifradas solo pueden enviarse a proveedores explícitamente
-- autorizados. El campo puede permanecer NULL para que el servidor use el
-- endpoint oficial predeterminado del proveedor.
alter table public.ai_models
  drop constraint if exists ai_models_api_url_safe;

alter table public.ai_models
  add constraint ai_models_api_url_safe check (
    api_url is null
    or (
      lower(api_url) ~ '^https://'
      and (
        lower(api_url) like 'https://api.groq.com/%'
        or lower(api_url) like 'https://openrouter.ai/%'
        or lower(api_url) like 'https://api.cohere.com/%'
        or lower(api_url) like 'https://generativelanguage.googleapis.com/%'
        or lower(api_url) like 'https://api.cloudflare.com/%'
      )
    )
  );

comment on constraint ai_models_api_url_safe on public.ai_models is
  'Impide enviar credenciales IA a endpoints arbitrarios o sin HTTPS.';
