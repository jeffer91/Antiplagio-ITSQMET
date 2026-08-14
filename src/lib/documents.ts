import { supabase } from './supabase';
import { extractDocument } from './documentExtractor';
import type {
  AcademicDocument,
  DocumentListItem,
  DocumentVersion,
  UploadProgressStep,
} from '../types/documents';

export const DOCUMENT_BUCKET = 'academic-documents';
export const MAX_DOCUMENT_SIZE = 25 * 1024 * 1024;

const PDF_MIME = 'application/pdf';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function requireClient() {
  if (!supabase) throw new Error('Supabase no está configurado.');
  return supabase;
}

function safeFileName(name: string): string {
  const extension = name.toLowerCase().endsWith('.docx') ? '.docx' : '.pdf';
  const stem = name
    .replace(/\.(pdf|docx)$/i, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'documento';
  return `${stem}${extension}`;
}

function validateFile(file: File): void {
  const lowerName = file.name.toLowerCase();
  const isPdf = file.type === PDF_MIME || lowerName.endsWith('.pdf');
  const isDocx = file.type === DOCX_MIME || lowerName.endsWith('.docx');
  if (!isPdf && !isDocx) throw new Error('Solo se permiten archivos PDF o DOCX.');
  if (file.size <= 0) throw new Error('El archivo está vacío.');
  if (file.size > MAX_DOCUMENT_SIZE) throw new Error('El archivo supera el límite de 25 MB.');
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function loadDocuments(): Promise<DocumentListItem[]> {
  const client = requireClient();
  const { data: documents, error } = await client
    .from('documents')
    .select('id,owner_id,title,current_version,status,created_at,updated_at')
    .order('updated_at', { ascending: false });
  if (error) throw error;

  const docs = (documents ?? []) as AcademicDocument[];
  if (docs.length === 0) return [];

  const ids = docs.map((document) => document.id);
  const ownerIds = [...new Set(docs.map((document) => document.owner_id))];

  const [{ data: versions, error: versionsError }, { data: profiles, error: profilesError }] = await Promise.all([
    client
      .from('document_versions')
      .select('id,document_id,version_number,uploaded_by,original_file_name,mime_type,size_bytes,sha256,storage_path,extracted_text,extracted_pages,word_count,character_count,page_count,extraction_status,extraction_error,created_at')
      .in('document_id', ids)
      .order('version_number', { ascending: false }),
    client.from('profiles').select('id,full_name,email').in('id', ownerIds),
  ]);

  if (versionsError) throw versionsError;
  if (profilesError) throw profilesError;

  const latestByDocument = new Map<string, DocumentVersion>();
  for (const version of (versions ?? []) as DocumentVersion[]) {
    if (!latestByDocument.has(version.document_id)) latestByDocument.set(version.document_id, version);
  }

  const profileById = new Map(
    (profiles ?? []).map((profile) => [profile.id as string, profile as { id: string; full_name: string; email: string }]),
  );

  return docs.map((document) => {
    const owner = profileById.get(document.owner_id);
    return {
      ...document,
      owner_name: owner?.full_name || 'Usuario SIAI',
      owner_email: owner?.email || '',
      latest_version: latestByDocument.get(document.id) ?? null,
    };
  });
}

export async function loadDocumentVersions(documentId: string): Promise<DocumentVersion[]> {
  const client = requireClient();
  const { data, error } = await client
    .from('document_versions')
    .select('id,document_id,version_number,uploaded_by,original_file_name,mime_type,size_bytes,sha256,storage_path,extracted_text,extracted_pages,word_count,character_count,page_count,extraction_status,extraction_error,created_at')
    .eq('document_id', documentId)
    .order('version_number', { ascending: false });
  if (error) throw error;
  return (data ?? []) as DocumentVersion[];
}

export async function createOriginalSignedUrl(storagePath: string): Promise<string> {
  const client = requireClient();
  const { data, error } = await client.storage.from(DOCUMENT_BUCKET).createSignedUrl(storagePath, 60);
  if (error) throw error;
  return data.signedUrl;
}

interface UploadDocumentInput {
  title: string;
  file: File;
  documentId?: string;
  onProgress?: (step: UploadProgressStep) => void;
}

export async function uploadDocumentVersion({ title, file, documentId, onProgress }: UploadDocumentInput): Promise<{ documentId: string; versionNumber: number }> {
  const client = requireClient();
  onProgress?.('validating');
  validateFile(file);

  const cleanTitle = title.trim();
  if (!cleanTitle) throw new Error('Escribe el título del trabajo.');
  if (cleanTitle.length > 240) throw new Error('El título no puede superar 240 caracteres.');

  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) throw new Error('La sesión no es válida. Vuelve a iniciar sesión.');
  const userId = userData.user.id;
  const resolvedDocumentId = documentId ?? crypto.randomUUID();

  onProgress?.('extracting');
  const extraction = await extractDocument(file);

  onProgress?.('hashing');
  const hash = await sha256(file);

  if (documentId) {
    const { data: duplicate, error: duplicateError } = await client
      .from('document_versions')
      .select('version_number')
      .eq('document_id', documentId)
      .eq('sha256', hash)
      .maybeSingle();
    if (duplicateError) throw duplicateError;
    if (duplicate) throw new Error(`Este mismo archivo ya fue cargado como versión ${duplicate.version_number}.`);
  }

  const storedName = safeFileName(file.name);
  const storagePath = `${userId}/${resolvedDocumentId}/${hash.slice(0, 16)}-${storedName}`;

  onProgress?.('uploading');
  const { error: uploadError } = await client.storage.from(DOCUMENT_BUCKET).upload(storagePath, file, {
    cacheControl: '3600',
    contentType: file.type || (storedName.endsWith('.pdf') ? PDF_MIME : DOCX_MIME),
    upsert: false,
  });
  if (uploadError) throw uploadError;

  try {
    onProgress?.('registering');
    const { data, error } = await client.rpc('register_document_version', {
      p_document_id: resolvedDocumentId,
      p_title: cleanTitle,
      p_original_file_name: file.name,
      p_mime_type: file.type || (storedName.endsWith('.pdf') ? PDF_MIME : DOCX_MIME),
      p_size_bytes: file.size,
      p_sha256: hash,
      p_storage_path: storagePath,
      p_extracted_text: extraction.text,
      p_extracted_pages: extraction.pages,
      p_word_count: extraction.wordCount,
      p_character_count: extraction.characterCount,
      p_page_count: extraction.pageCount,
      p_extraction_status: extraction.status,
      p_extraction_error: extraction.error,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('Supabase no devolvió la versión registrada.');
    onProgress?.('done');
    return { documentId: resolvedDocumentId, versionNumber: Number(row.version_number) };
  } catch (error) {
    await client.storage.from(DOCUMENT_BUCKET).remove([storagePath]);
    throw error;
  }
}
