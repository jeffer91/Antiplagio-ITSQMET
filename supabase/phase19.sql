-- PlagGuard · ITSQMET - Fase 19
-- Acceso administrativo por cédula + PIN.
-- El PIN se deriva con PBKDF2 en Edge Functions y nunca se guarda en texto plano.

create table if not exists public.admin_pin_credentials (
  admin_user_id uuid primary key references auth.users(id) on delete cascade,
  cedula text not null unique check (cedula ~ '^[0-9]{10}$'),
  pin_salt text not null,
  pin_hash text not null,
  iterations integer not null default 210000 check (iterations >= 100000),
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.admin_pin_credentials enable row level security;
revoke all on public.admin_pin_credentials from anon, authenticated;
