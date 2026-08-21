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
    .select('id,owner_id,academic_period_id,career,modality,title,current_version,status,created_at,updated_at')
    .order('updated_at', { ascending: false });
  if (error) throw error;

  const docs = (documents ?? []) as AcademicDocument[];
  if (docs.length === 0) return [];

  const ids = docs.map((document) => document.id);
  const ownerIds = [...new Set(docs.map((document) => document.owner_id))];
  const periodIds = [...new Set(docs.map((document) => document.academic_period_id).filter((id): id is string => Boolean(id)))];

  const [versionsResult, profilesResult, periodsResult] = await Promise.all([
    client
      .from('document_versions')
      .select('id,document_id,version_number,uploaded_by,original_file_name,mime_type,size_bytes,sha256,storage_path,extracted_text,extracted_pages,word_count,character_count,page_count,extraction_status,extraction_error,created_at')
      .in('document_id', ids)
      .order('version_number', { ascending: false }),
    client.from('profiles').select('id,full_name,email').in('id', ownerIds),
    periodIds.length > 0
      ? client.from('academic_periods').select('id,name').in('id', periodIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (versionsResult.error) throw versionsResult.error;
  if (profilesResult.error) throw profilesResult.error;
  if (periodsResult.error) throw periodsResult.error;

  const latestByDocument = new Map<string, DocumentVersion>();
  for (const version of (versionsResult.data ?? []) as DocumentVersion[]) {
    if (!latestByDocument.has(version.document_id)) latestByDocument.set(version.document_id, version);
  }

  const profileById = new Map(
    (profilesResult.data ?? []).map((profile) => [profile.id as string, profile as { id: string; full_name: string; email: string }]),
  );
  const periodById = new Map(
    (periodsResult.data ?? []).map((period) => [String(period.id), String(period.name)]),
  );

  return docs.map((document) => {
    const owner = profileById.get(document.owner_id);
    return {
      ...document,
      owner_name: owner?.full_name || 'Estudiante',
      owner_email: owner?.email || '',
      period_name: document.academic_period_id ? periodById.get(document.academic_period_id) || 'Periodo sin nombre' : 'Sin periodo',
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
  ownerId?: string;
  periodId?: string;
  career?: string;
  modality?: string;
  onProgress?: (step: UploadProgressStep) => void;
}

interface ResolvedAcademicContext {
  ownerId: string;
  periodId: string;
  career: string;
  modality: string;
}

async function resolveAcademicContext(input: UploadDocumentInput, currentUserId: string): Promise<ResolvedAcademicContext> {
  const client = requireClient();

  if (input.documentId) {
    const { data, error } = await client
      .from('documents')
      .select('owner_id,academic_period_id,career,modality')
      .eq('id', input.documentId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('El documento ya no existe.');
    if (!data.academic_period_id || !data.career || !data.modality) {
      throw new Error('El documento no tiene contexto académico. El Administrador debe regularizarlo antes de crear otra versión.');
    }
    return {
      ownerId: String(data.owner_id),
      periodId: String(data.academic_period_id),
      career: String(data.career),
      modality: String(data.modality),
    };
  }

  if (input.ownerId && input.periodId && input.career && input.modality) {
    return {
      ownerId: input.ownerId,
      periodId: input.periodId,
      career: input.career,
      modality: input.modality,
    };
  }

  const ownerId = input.ownerId ?? currentUserId;
  const { data, error } = await client
    .from('student_enrollments')
    .select('period_id,career,modality')
    .eq('student_id', ownerId)
    .eq('active', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('El estudiante todavía no tiene periodo, carrera y modalidad asignados.');
  return {
    ownerId,
    periodId: String(data.period_id),
    career: String(data.career),
    modality: String(data.modality),
  };
}

export async function uploadDocumentVersion(input: UploadDocumentInput): Promise<{ documentId: string; versionNumber: number }> {
  const { title, file, documentId, onProgress } = input;
  const client = requireClient();
  onProgress?.('validating');
  validateFile(file);

  const cleanTitle = title.trim();
  if (!cleanTitle) throw new Error('Escribe el título del trabajo.');
  if (cleanTitle.length > 240) throw new Error('El título no puede superar 240 caracteres.');

  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) throw new Error('La sesión no es válida. Vuelve a iniciar sesión.');
  const userId = userData.user.id;
  const context = await resolveAcademicContext(input, userId);
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
  const storagePath = `${context.ownerId}/${resolvedDocumentId}/${hash.slice(0, 16)}-${storedName}`;

  onProgress?.('uploading');
  const { error: uploadError } = await client.storage.from(DOCUMENT_BUCKET).upload(storagePath, file, {
    cacheControl: '3600',
    contentType: file.type || (storedName.endsWith('.pdf') ? PDF_MIME : DOCX_MIME),
    upsert: false,
  });
  if (uploadError) throw uploadError;

  try {
    onProgress?.('registering');
    const { data, error } = await client.rpc('register_document_version_v2', {
      p_document_id: resolvedDocumentId,
      p_owner_id: context.ownerId,
      p_period_id: context.periodId,
      p_career: context.career,
      p_modality: context.modality,
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
