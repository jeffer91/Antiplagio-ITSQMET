-- SIAI / ITSQMET - Fase 2
-- Ejecutar DESPUÉS de supabase/schema.sql.
-- Crea documentos, versiones, bucket privado y políticas de acceso.

create type public.extraction_status as enum ('ready', 'needs_ocr', 'failed');

create table public.documents (
  id uuid primary key,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  title text not null check (char_length(title) between 1 and 240),
  current_version integer not null default 0 check (current_version >= 0),
  status public.extraction_status not null default 'failed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  original_file_name text not null,
  mime_type text not null check (mime_type in ('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 26214400),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  storage_path text not null unique,
  extracted_text text not null default '',
  extracted_pages jsonb,
  word_count integer not null default 0 check (word_count >= 0),
  character_count integer not null default 0 check (character_count >= 0),
  page_count integer check (page_count is null or page_count > 0),
  extraction_status public.extraction_status not null,
  extraction_error text,
  created_at timestamptz not null default now(),
  unique (document_id, version_number),
  unique (document_id, sha256),
  check (extracted_pages is null or jsonb_typeof(extracted_pages) = 'array')
);

create index documents_owner_idx on public.documents(owner_id);
create index documents_updated_idx on public.documents(updated_at desc);
create index document_versions_document_idx on public.document_versions(document_id, version_number desc);
create index document_versions_sha_idx on public.document_versions(sha256);

alter table public.documents enable row level security;
alter table public.document_versions enable row level security;

grant select on public.documents to authenticated;
grant select on public.document_versions to authenticated;

create policy "documents_select_own_or_coordinator"
on public.documents
for select
to authenticated
using (owner_id = auth.uid() or public.is_coordinator());

create or replace function public.can_access_document(p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.documents d
    where d.id = p_document_id
      and (d.owner_id = auth.uid() or public.is_coordinator())
  );
$$;

revoke all on function public.can_access_document(uuid) from public;
grant execute on function public.can_access_document(uuid) to authenticated;

create policy "document_versions_select_accessible"
on public.document_versions
for select
to authenticated
using (public.can_access_document(document_id));

create or replace function public.register_document_version(
  p_document_id uuid,
  p_title text,
  p_original_file_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_sha256 text,
  p_storage_path text,
  p_extracted_text text,
  p_extracted_pages jsonb,
  p_word_count integer,
  p_character_count integer,
  p_page_count integer,
  p_extraction_status public.extraction_status,
  p_extraction_error text
)
returns setof public.document_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_document public.documents%rowtype;
  v_version integer;
  v_row public.document_versions%rowtype;
begin
  if v_user is null then
    raise exception 'Sesión no válida';
  end if;

  if char_length(trim(p_title)) < 1 or char_length(trim(p_title)) > 240 then
    raise exception 'Título inválido';
  end if;

  if p_mime_type not in ('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') then
    raise exception 'Formato no permitido';
  end if;

  if p_size_bytes <= 0 or p_size_bytes > 26214400 then
    raise exception 'Tamaño de archivo no permitido';
  end if;

  if p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'SHA-256 inválido';
  end if;

  if split_part(p_storage_path, '/', 1) <> v_user::text then
    raise exception 'Ruta de almacenamiento inválida';
  end if;

  select * into v_document
  from public.documents
  where id = p_document_id
  for update;

  if found then
    if v_document.owner_id <> v_user then
      raise exception 'Solo el propietario puede agregar una nueva versión';
    end if;
    if exists (
      select 1 from public.document_versions
      where document_id = p_document_id and sha256 = p_sha256
    ) then
      raise exception 'Este archivo ya existe en el historial del documento';
    end if;
  else
    insert into public.documents (id, owner_id, title, current_version, status)
    values (p_document_id, v_user, trim(p_title), 0, p_extraction_status)
    returning * into v_document;
  end if;

  select coalesce(max(version_number), 0) + 1 into v_version
  from public.document_versions
  where document_id = p_document_id;

  insert into public.document_versions (
    document_id, version_number, uploaded_by, original_file_name, mime_type,
    size_bytes, sha256, storage_path, extracted_text, extracted_pages,
    word_count, character_count, page_count, extraction_status, extraction_error
  ) values (
    p_document_id, v_version, v_user, p_original_file_name, p_mime_type,
    p_size_bytes, p_sha256, p_storage_path, coalesce(p_extracted_text, ''), p_extracted_pages,
    greatest(coalesce(p_word_count, 0), 0), greatest(coalesce(p_character_count, 0), 0),
    p_page_count, p_extraction_status, p_extraction_error
  ) returning * into v_row;

  update public.documents
  set current_version = v_version,
      status = p_extraction_status,
      updated_at = now()
  where id = p_document_id;

  return next v_row;
end;
$$;

revoke all on function public.register_document_version(uuid,text,text,text,bigint,text,text,text,jsonb,integer,integer,integer,public.extraction_status,text) from public;
grant execute on function public.register_document_version(uuid,text,text,text,bigint,text,text,text,jsonb,integer,integer,integer,public.extraction_status,text) to authenticated;

-- Bucket privado: 25 MB, únicamente PDF/DOCX.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'academic-documents',
  'academic-documents',
  false,
  26214400,
  array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "academic_documents_select_own_or_coordinator"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'academic-documents'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_coordinator()
  )
);

create policy "academic_documents_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'academic-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Se habilita DELETE únicamente sobre archivos propios para permitir rollback si falla el registro SQL.
create policy "academic_documents_delete_own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'academic-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

comment on table public.documents is 'Trabajo académico lógico. Conserva un historial inmutable de versiones.';
comment on table public.document_versions is 'Versiones documentales con archivo, SHA-256 y texto extraído para análisis posteriores.';
comment on function public.register_document_version is 'Registra de forma controlada una nueva versión sin permitir al cliente alterar numeración o propietario.';
