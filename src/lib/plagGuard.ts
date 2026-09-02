import { supabase } from './supabase';
import type { Profile, AppRole } from '../types/auth';
import type {
  AcademicPeriod,
  AnalysisAttempt,
  AppNotification,
  StudentCurrentResult,
  StudentEnrollment,
  StudentProcessState,
} from '../types/plagGuard';
import type { IntegrityReportSnapshot } from '../types/integrityReport';

function requireClient() {
  if (!supabase) throw new Error('Supabase no está configurado.');
  return supabase;
}

function notifyChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('plagguard:notifications-changed'));
}

export interface StudentUploadTarget {
  studentId: string;
  fullName: string;
  email: string;
  periodId: string;
  periodName: string;
  career: string;
  modality: string;
}

export interface InstitutionalStudent {
  identification: string;
  full_name: string;
  career_code: string | null;
  career_name: string | null;
  campus: string | null;
}

export interface StudentCorrection {
  id: string;
  category: 'similarity' | 'citation' | 'apa' | 'assisted_writing';
  fragment: string;
  source: string;
  reason: string;
  action: string;
  url?: string | null;
  affectsSimilarity: boolean;
}

export interface CompleteAnalysisResult {
  attempt: AnalysisAttempt;
  snapshot: IntegrityReportSnapshot;
  corrections: StudentCorrection[];
}

export interface AdminOverview {
  articles: number;
  attempts: number;
  complies: number;
  doesNotComply: number;
  repository: number;
}

export async function loadProcessState(studentId?: string, periodId?: string): Promise<StudentProcessState> {
  const client = requireClient();
  const { data, error } = await client.rpc('get_student_process_state', {
    p_student_id: studentId ?? null,
    p_period_id: periodId ?? null,
  });
  if (error) throw error;
  const value = (data ?? { configured: false, student_id: studentId ?? '' }) as StudentProcessState;
  return {
    ...value,
    similarity_limit: value.similarity_limit === undefined ? undefined : Number(value.similarity_limit),
    complied_similarity: value.complied_similarity === null || value.complied_similarity === undefined
      ? null
      : Number(value.complied_similarity),
  };
}

export async function loadStudentCurrentResult(studentId?: string, periodId?: string): Promise<StudentCurrentResult> {
  const client = requireClient();
  const { data, error } = await client.rpc('get_student_current_result', {
    p_student_id: studentId ?? null,
    p_period_id: periodId ?? null,
  });
  if (error) throw error;
  const value = (data ?? { available: false }) as StudentCurrentResult;
  return {
    ...value,
    attempt_number: value.attempt_number === undefined ? undefined : Number(value.attempt_number),
    consolidated_similarity: value.consolidated_similarity === undefined ? undefined : Number(value.consolidated_similarity),
  };
}

export async function loadAdminOverview(): Promise<AdminOverview> {
  const client = requireClient();

  const [articles, attempts, complies, doesNotComply, repository] = await Promise.all([
    client.from('documents').select('id', { count: 'exact', head: true }),
    client.from('analysis_attempts').select('id', { count: 'exact', head: true }),
    client.from('analysis_attempts').select('id', { count: 'exact', head: true }).eq('status', 'complies'),
    client.from('analysis_attempts').select('id', { count: 'exact', head: true }).eq('status', 'does_not_comply'),
    client.from('institutional_repository').select('id', { count: 'exact', head: true }).eq('active', true),
  ]);

  for (const response of [articles, attempts, complies, doesNotComply, repository]) {
    if (response.error) throw response.error;
  }

  return {
    articles: articles.count ?? 0,
    attempts: attempts.count ?? 0,
    complies: complies.count ?? 0,
    doesNotComply: doesNotComply.count ?? 0,
    repository: repository.count ?? 0,
  };
}

export async function loadPeriods(): Promise<AcademicPeriod[]> {
  const client = requireClient();

  // Firebase UTET es la fuente oficial de periodos. Antes de leerlos,
  // sincronizamos la colección "periodos" con la tabla operativa de PlagGuard.
  const { data: syncData, error: syncError } = await client.functions.invoke('sync-firebase-periods', {
    body: {},
  });

  if (syncError) {
    console.warn(
      'No fue posible actualizar periodos desde Firebase:',
      (syncData as { error?: string } | null)?.error || syncError.message,
    );
  }

  const { data, error } = await client
    .from('academic_periods')
    .select('id,name,similarity_limit,ordinary_attempts,supplementary_attempts,ordinary_open,supplementary_open,active,firebase_period_id,firebase_data_hash,firebase_updated_at,created_at,updated_at')
    .order('name', { ascending: true });
  if (error) throw error;

  return (data ?? []).map((row) => ({
    ...(row as AcademicPeriod),
    similarity_limit: Number(row.similarity_limit),
    ordinary_attempts: Number(row.ordinary_attempts),
    supplementary_attempts: Number(row.supplementary_attempts),
  }));
}

export async function loadProfiles(): Promise<Profile[]> {
  const client = requireClient();
  const { data, error } = await client
    .from('profiles')
    .select('id,email,full_name,role,cedula,created_at')
    .order('full_name', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Profile[];
}

export async function loadInstitutionalStudent(identification: string): Promise<InstitutionalStudent | null> {
  const client = requireClient();
  const { data, error } = await client
    .from('students')
    .select('identification,full_name,career_code,career_name,campus')
    .eq('identification', identification)
    .maybeSingle();
  if (error) throw error;
  return data ? data as InstitutionalStudent : null;
}

export async function attachPendingDocumentToCurrentProcess(documentId: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.rpc('attach_pending_document_to_current_process', {
    p_document_id: documentId,
  });
  if (error) throw error;
}

export async function loadEnrollments(): Promise<StudentEnrollment[]> {
  const client = requireClient();
  const { data, error } = await client
    .from('student_enrollments')
    .select('id,student_id,period_id,career,modality,active,created_at,updated_at')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as StudentEnrollment[];
}

export async function loadStudentUploadTargets(): Promise<StudentUploadTarget[]> {
  const [profiles, periods, enrollments] = await Promise.all([loadProfiles(), loadPeriods(), loadEnrollments()]);
  const profileMap = new Map(profiles.filter((profile) => profile.role === 'student').map((profile) => [profile.id, profile]));
  const periodMap = new Map(periods.map((period) => [period.id, period]));
  return enrollments
    .filter((enrollment) => enrollment.active)
    .map((enrollment) => {
      const profile = profileMap.get(enrollment.student_id);
      const period = periodMap.get(enrollment.period_id);
      if (!profile || !period) return null;
      return {
        studentId: profile.id,
        fullName: profile.full_name || profile.email,
        email: profile.email,
        periodId: period.id,
        periodName: period.name,
        career: enrollment.career,
        modality: enrollment.modality,
      } satisfies StudentUploadTarget;
    })
    .filter((value): value is StudentUploadTarget => Boolean(value))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'es'));
}

export async function loadNotifications(): Promise<AppNotification[]> {
  const client = requireClient();
  const { data, error } = await client
    .from('notifications')
    .select('id,user_id,kind,title,message,resolved,created_at,resolved_at')
    .eq('resolved', false)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as AppNotification[];
}

export async function resolveNotification(id: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.rpc('resolve_notification', { p_notification_id: id });
  if (error) throw error;
  notifyChanged();
}

export async function adminCreatePeriod(name: string): Promise<string> {
  const client = requireClient();
  const { data, error } = await client.rpc('admin_create_period', {
    p_name: name,
    p_similarity_limit: 20,
    p_ordinary_attempts: 3,
    p_supplementary_attempts: 3,
    p_ordinary_open: true,
    p_supplementary_open: false,
  });
  if (error) throw error;
  notifyChanged();
  return String(data ?? '');
}

export async function adminSetPeriodState(periodId: string, ordinaryOpen: boolean, supplementaryOpen: boolean, active: boolean): Promise<void> {
  const client = requireClient();
  const { error } = await client.rpc('admin_set_period_state', {
    p_period_id: periodId,
    p_ordinary_open: ordinaryOpen,
    p_supplementary_open: supplementaryOpen,
    p_active: active,
  });
  if (error) throw error;
  notifyChanged();
}

export async function adminSetProfileRole(userId: string, role: AppRole): Promise<void> {
  const client = requireClient();
  const { error } = await client.rpc('admin_set_profile_role', { p_user_id: userId, p_role: role });
  if (error) throw error;
}

export async function adminAssignStudent(studentId: string, periodId: string, career: string, modality: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.rpc('admin_assign_student', {
    p_student_id: studentId,
    p_period_id: periodId,
    p_career: career,
    p_modality: modality,
  });
  if (error) throw error;
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 650);
}

export function buildStudentCorrections(snapshot: IntegrityReportSnapshot): StudentCorrection[] {
  const corrections: StudentCorrection[] = [];

  for (const [sourceIndex, source] of (snapshot.internal_similarity?.sources ?? []).entries()) {
    for (const [matchIndex, match] of source.matches.entries()) {
      const strongEvidence = match.type === 'exact' || match.score >= 70;
      corrections.push({
        id: `internal-${sourceIndex}-${matchIndex}`,
        category: 'similarity',
        fragment: compact(match.target_excerpt),
        source: 'Repositorio institucional',
        reason: match.type === 'exact'
          ? 'El fragmento coincide de forma directa con una fuente del repositorio institucional.'
          : strongEvidence
            ? 'El fragmento presenta una similitud cercana con evidencia suficiente y debe revisarse como posible parafraseo demasiado próximo.'
            : 'El fragmento presenta una similitud cercana para revisión. No se considera por sí sola una prueba de plagio.',
        action: 'Reescribe con elaboración propia y cita la fuente cuando la idea no sea original. Si es una cita textual válida, usa el formato de citación correspondiente.',
        affectsSimilarity: strongEvidence,
      });
    }
  }

  for (const [sourceIndex, source] of (snapshot.external_similarity?.sources ?? []).entries()) {
    const fullText = source.verification_scope === 'full_text';
    for (const [matchIndex, match] of source.matches.entries()) {
      const strongEvidence = match.type === 'exact' || match.score >= 70;
      const counts = fullText && strongEvidence;
      corrections.push({
        id: `external-${sourceIndex}-${matchIndex}`,
        category: 'similarity',
        fragment: compact(match.target_excerpt),
        source: source.title || source.provider,
        reason: !fullText
          ? 'La fuente solo pudo verificarse parcialmente. Se muestra como referencia para revisión y no aumenta el porcentaje institucional.'
          : match.type === 'exact'
            ? 'El texto coincide con una fuente externa verificada a texto completo.'
            : strongEvidence
              ? 'Existe una similitud cercana con evidencia suficiente en una fuente externa verificada; puede requerir una mejor paráfrasis o citación.'
              : 'Existe una posible paráfrasis o similitud cercana, pero la evidencia todavía es insuficiente para aumentar el porcentaje. Se muestra para revisión.',
        action: 'Contrasta la fuente, reescribe el fragmento con redacción propia y agrega la cita/referencia cuando corresponda.',
        url: source.url,
        affectsSimilarity: counts,
      });
    }
  }

  const citation = snapshot.citation_integrity;
  if (citation) {
    citation.unlinked_citations.forEach((raw, index) => {
      corrections.push({
        id: `citation-${index}`,
        category: 'citation',
        fragment: compact(raw),
        source: 'Citas y referencias',
        reason: 'La cita no pudo vincularse claramente con una referencia bibliográfica.',
        action: 'Verifica autor y año, y agrega o corrige la referencia completa en la bibliografía.',
        affectsSimilarity: false,
      });
    });

    citation.references.forEach((reference) => {
      if (reference.apa_issues.length === 0) return;
      corrections.push({
        id: `apa-${reference.ordinal}`,
        category: 'apa',
        fragment: compact(reference.raw_reference),
        source: 'APA 7',
        reason: reference.apa_issues.join(' · '),
        action: 'Corrige la referencia siguiendo APA 7 y vuelve a comprobar los datos bibliográficos.',
        affectsSimilarity: false,
      });
    });
  }

  for (const segment of snapshot.ai_writing?.segments ?? []) {
    corrections.push({
      id: `assisted-${segment.segment_index}`,
      category: 'assisted_writing',
      fragment: compact(segment.excerpt),
      source: 'Señales de escritura asistida',
      reason: 'El fragmento presenta señales estilométricas que merecen revisión humana; esto no demuestra por sí solo uso de IA ni plagio.',
      action: 'Revisa la redacción, asegúrate de comprender y poder sustentar el contenido, y conserva evidencia de autoría cuando sea necesario.',
      affectsSimilarity: false,
    });
  }

  return corrections.slice(0, 80);
}

export async function recordAnalysisAttempt(
  versionId: string,
  consolidatedSimilarity: number,
  provenance: Record<string, unknown>,
  observation = '',
): Promise<AnalysisAttempt> {
  const client = requireClient();
  const { data, error } = await client.rpc('record_analysis_attempt', {
    p_target_version_id: versionId,
    p_consolidated_similarity: consolidatedSimilarity,
    p_observation: observation,
    p_provenance: provenance,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('No fue posible registrar el intento.');
  notifyChanged();
  return {
    ...(row as AnalysisAttempt),
    attempt_number: Number(row.attempt_number),
    consolidated_similarity: Number(row.consolidated_similarity),
  };
}
