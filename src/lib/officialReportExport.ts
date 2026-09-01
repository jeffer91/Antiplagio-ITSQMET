import { buildIntegrityReportHtml, buildIntegrityReportSpreadsheet } from './integrityReport';
import { verifyOfficialReport } from './reportVerification';
import type { IntegrityReportRecord } from '../types/integrityReport';

function reportStem(report: IntegrityReportRecord): string {
  return `PlagGuard_Informe_${report.report_number}_${report.snapshot.document.owner_name || 'estudiante'}`
    .replace(/[^\p{L}\p{N}_-]+/gu, '_')
    .slice(0, 100);
}

function brandHtml(value: string): string {
  return value
    .replaceAll('SIAI · ITSQMET', 'PlagGuard · ITSQMET')
    .replaceAll('SIAI presenta evidencia técnica', 'PlagGuard presenta evidencia técnica')
    .replaceAll('<small>Índice IA</small>', '<small>Señales de escritura asistida</small>')
    .replaceAll('El índice de IA es evidencia para revisión humana.', 'Las señales de escritura asistida son evidencia para revisión humana y no constituyen por sí solas una conclusión de autoría.');
}

function brandSpreadsheet(value: string): string {
  return value
    .replaceAll('Índice evidencia IA', 'Índice de señales de escritura asistida')
    .replaceAll('% palabras IA señaladas', '% palabras con señales estilométricas')
    .replaceAll('Indicadores IA', 'Escritura asistida');
}

function downloadBlob(content: string, mimeType: string, fileName: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function printHtmlAsPdf(html: string, title: string): void {
  const printWindow = window.open('', '_blank', 'noopener,noreferrer');
  if (!printWindow) {
    throw new Error('El navegador bloqueó la ventana del informe. Permite ventanas emergentes para PlagGuard e inténtalo nuevamente.');
  }

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.document.title = title;

  const triggerPrint = () => {
    printWindow.focus();
    printWindow.print();
  };

  if (printWindow.document.readyState === 'complete') {
    window.setTimeout(triggerPrint, 250);
  } else {
    printWindow.addEventListener('load', () => window.setTimeout(triggerPrint, 250), { once: true });
  }
}

export async function exportOfficialReportPdf(report: IntegrityReportRecord): Promise<{ canceled: boolean; filePath: string | null }> {
  if (!(await verifyOfficialReport(report))) throw new Error('La huella oficial del informe no pudo verificarse en el servidor.');

  const fileName = `${reportStem(report)}.pdf`;
  const html = brandHtml(buildIntegrityReportHtml(report));

  if (window.siaiDesktop?.savePdf) {
    return window.siaiDesktop.savePdf(html, fileName);
  }

  printHtmlAsPdf(html, fileName);
  return { canceled: false, filePath: null };
}

export async function exportOfficialReportExcel(report: IntegrityReportRecord): Promise<{ canceled: boolean; filePath: string | null }> {
  if (!(await verifyOfficialReport(report))) throw new Error('La huella oficial del informe no pudo verificarse en el servidor.');

  const fileName = `${reportStem(report)}.xls`;
  const content = brandSpreadsheet(buildIntegrityReportSpreadsheet(report));

  if (window.siaiDesktop?.saveExcel) {
    return window.siaiDesktop.saveExcel(content, fileName);
  }

  downloadBlob(content, 'application/vnd.ms-excel;charset=utf-8', fileName);
  return { canceled: false, filePath: null };
}
