export type ExtractionStatus = 'ready' | 'needs_ocr' | 'failed';

export interface AcademicDocument {
  id: string;
  owner_id: string;
  title: string;
  current_version: number;
  status: ExtractionStatus;
  created_at: string;
  updated_at: string;
}

export interface ExtractedPage {
  page: number;
  text: string;
}

export interface DocumentVersion {
  id: string;
  document_id: string;
  version_number: number;
  uploaded_by: string;
  original_file_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  storage_path: string;
  extracted_text: string;
  extracted_pages: ExtractedPage[] | null;
  word_count: number;
  character_count: number;
  page_count: number | null;
  extraction_status: ExtractionStatus;
  extraction_error: string | null;
  created_at: string;
}

export interface DocumentListItem extends AcademicDocument {
  owner_name: string;
  owner_email: string;
  latest_version: DocumentVersion | null;
}

export type UploadProgressStep =
  | 'validating'
  | 'extracting'
  | 'hashing'
  | 'uploading'
  | 'registering'
  | 'done';
