-- PlagGuard · ITSQMET - Pre-Fase 9
-- IMPORTANTE: ejecutar este archivo como una ejecución SQL independiente y confirmar
-- que finalice correctamente ANTES de ejecutar supabase/phase9.sql.
-- PostgreSQL no permite usar un valor nuevo de ENUM dentro de la misma transacción
-- donde se añadió por primera vez.

alter type public.app_role add value if not exists 'admin';
