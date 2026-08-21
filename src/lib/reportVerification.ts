import { supabase } from './supabase';
import type { IntegrityReportRecord } from '../types/integrityReport';

function requireClient() {
  if (!supabase) throw new Error('Supabase no está configurado.');
  return supabase;
}

export async function verifyOfficialReport(report: IntegrityReportRecord): Promise<boolean> {
  const client = requireClient();
  const { data, error } = await client.rpc('verify_integrity_report', {
    p_report_id: report.id,
  });
  if (error) throw error;
  return data === true;
}
