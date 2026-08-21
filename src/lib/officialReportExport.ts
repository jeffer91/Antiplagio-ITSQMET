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

export async function exportOfficialReportPdf(report: IntegrityReportRecord): Promise<{ canceled: boolean; filePath: string | null }> {
  if (!window.siaiDesktop?.savePdf) throw new Error('La exportación PDF solo está disponible en la aplicación de escritorio.');
  if (!(await verifyOfficialReport(report))) throw new Error('La huella oficial del informe no pudo verificarse en el servidor.');
  return window.siaiDesktop.savePdf(brandHtml(buildIntegrityReportHtml(report)), `${reportStem(report)}.pdf`);
}

export async function exportOfficialReportExcel(report: IntegrityReportRecord): Promise<{ canceled: boolean; filePath: string | null }> {
  if (!window.siaiDesktop?.saveExcel) throw new Error('La exportación Excel solo está disponible en la aplicación de escritorio.');
  if (!(await verifyOfficialReport(report))) throw new Error('La huella oficial del informe no pudo verificarse en el servidor.');
  return window.siaiDesktop.saveExcel(brandSpreadsheet(buildIntegrityReportSpreadsheet(report)), `${reportStem(report)}.xls`);
}
