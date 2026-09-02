-- PlagGuard · ITSQMET - Fase 20
-- Firebase UTET es la fuente oficial de periodos.
-- PlagGuard mantiene un espejo operativo para relaciones e intentos.

alter table public.academic_periods
  add column if not exists firebase_period_id text,
  add column if not exists firebase_data_hash text,
  add column if not exists firebase_updated_at text;

create unique index if not exists academic_periods_firebase_period_id_uidx
  on public.academic_periods(firebase_period_id)
  where firebase_period_id is not null;

comment on column public.academic_periods.firebase_period_id is
'Identificador fuente de la colección periodos en Firebase UTET.';
