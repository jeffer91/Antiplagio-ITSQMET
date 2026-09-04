import * as mammoth from 'mammoth';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { ExtractedPage, ExtractionStatus } from '../types/documents';

export interface ExtractionResult {
  text: string;
  pages: ExtractedPage[] | null;
  pageCount: number | null;
  wordCount: number;
  characterCount: number;
  status: ExtractionStatus;
  error: string | null;
}

const PDF_MIME = 'application/pdf';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function normalizeText(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function countWords(value: string): number {
  const text = value.trim();
  return text ? text.split(/\s+/u).length : 0;
}

function resultFrom(text: string, pages: ExtractedPage[] | null, pageCount: number | null, status: ExtractionStatus, error: string | null): ExtractionResult {
  const normalized = normalizeText(text);
  return {
    text: normalized,
    pages,
    pageCount,
    wordCount: countWords(normalized),
    characterCount: normalized.length,
    status,
    error,
  };
}

async function extractPdf(file: File): Promise<ExtractionResult> {
  try {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjs.getDocument({ data }).promise;
    const pages: ExtractedPage[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = normalizeText(
        content.items
          .map((item) => ('str' in item ? item.str : ''))
          .filter(Boolean)
          .join(' '),
      );
      pages.push({ page: pageNumber, text });
    }

    const fullText = pages.map((page) => page.text).filter(Boolean).join('\n\n');
    if (normalizeText(fullText).length < 80) {
      return resultFrom(
        fullText,
        pages,
        pdf.numPages,
        'needs_ocr',
        'El PDF parece estar escaneado o contiene muy poco texto seleccionable. PlagGuard no analiza documentos escaneados; sube un PDF con texto seleccionable o un archivo DOCX.',
      );
    }

    return resultFrom(fullText, pages, pdf.numPages, 'ready', null);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No fue posible leer el PDF.';
    return resultFrom('', null, null, 'failed', message);
  }
}

async function extractDocx(file: File): Promise<ExtractionResult> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const response = await mammoth.extractRawText({ arrayBuffer });
    const text = normalizeText(response.value);

    if (!text) {
      return resultFrom('', null, null, 'failed', 'El archivo DOCX no contiene texto extraíble.');
    }

    return resultFrom(text, null, null, 'ready', null);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No fue posible leer el DOCX.';
    return resultFrom('', null, null, 'failed', message);
  }
}

export async function extractDocument(file: File): Promise<ExtractionResult> {
  const lowerName = file.name.toLowerCase();
  if (file.type === PDF_MIME || lowerName.endsWith('.pdf')) {
    return extractPdf(file);
  }
  if (file.type === DOCX_MIME || lowerName.endsWith('.docx')) {
    return extractDocx(file);
  }
  throw new Error('Formato no compatible. Utiliza PDF o DOCX.');
}
