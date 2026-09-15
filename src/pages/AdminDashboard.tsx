import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '../components/AppShell';
import { AdminAiEvaluatorsPanel } from '../components/AdminAiEvaluatorsPanel';
import {
  adminSetPeriodState,
  adminSetProfileRole,
  loadAdminOverview,
  loadEnrollments,
  loadInstitutionalStudents,
  loadPeriods,
  loadProfiles,
  type AdminOverview,
  type InstitutionalStudent,
} from '../lib/plagGuard';
import type { Profile, AppRole } from '../types/auth';
import type { AcademicPeriod, StudentEnrollment } from '../types/plagGuard';

const roleLabels: Record<AppRole, string> = {
  student: 'Estudiante',
  coordinator: 'Coordinador',
  admin: 'Administrador',
};

type AdminSection = 'resumen' | 'periodos' | 'procesos' | 'estudiantes' | 'usuarios' | 'ia';

export function AdminDashboard(): React.JSX.Element {
  const [section, setSection] = useState<AdminSection>('resumen');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [institutionalStudents, setInstitutionalStudents] = useState<InstitutionalStudent[]>([]);
  const [periods, setPeriods] = useState<AcademicPeriod[]>([]);
  const [enrollments, setEnrollments] = useState<StudentEnrollment[]>([]);
  const [overview, setOverview] = useState<AdminOverview>({
    students: 0,
    activeProcesses: 0,
    pendingArticles: 0,
    articles: 0,
    attempts: 0,
    complies: 0,
    doesNotComply: 0,
    repository: 0,
  });
  const [studentQuery, setStudentQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const [profileRows, studentRows, periodRows, enrollmentRows, overviewRow] = await Promise.all([
      loadProfiles(),
      loadInstitutionalStudents(),
      loadPeriods(),
      loadEnrollments(),
      loadAdminOverview(),
    ]);
    setProfiles(profileRows);
    setInstitutionalStudents(studentRows);
    setPeriods(periodRows);
    setEnrollments(enrollmentRows);
    setOverview(overviewRow);
  }, []);

  useEffect(() => {
    void refresh()
      .catch((caught) => setError(caught instanceof Error ? caught.message : 'No fue posible cargar la administración.'))
      .finally(() => setLoading(false));
  }, [refresh]);

  const activeEnrollments = useMemo(() => enrollments.filter((enrollment) => enrollment.active), [enrollments]);
  const profileById = useMemo(() => new Map(profiles.map((profile) => [profile.id, profile])), [profiles]);
  const periodById = useMemo(() => new Map(periods.map((period) => [period.id, period])), [periods]);

  const visibleStudents = useMemo(() => {
    const query = studentQuery.trim().toLocaleLowerCase('es');
    const rows = query
      ? institutionalStudents.filter((student) =>
          student.identification.includes(query)
          || student.full_name.toLocaleLowerCase('es').includes(query)
          || (student.career_name || '').toLocaleLowerCase('es').includes(query)
        )
      : institutionalStudents;
    return rows.slice(0, 30);
  }, [institutionalStudents, studentQuery]);

  const run = async (task: () => Promise<void>, success: string): Promise<void> => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await task();
      await refresh();
      setMessage(success);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible completar la acción.');
    } finally {
      setBusy(false);
    }
  };

  const navButton = (key: AdminSection, label: string): React.JSX.Element => (
    <button
      type="button"
      className={section === key ? 'active' : ''}
      aria-current={section === key ? 'page' : undefined}
      onClick={() => setSection(key)}
    >
      {label}
    </button>
  );

  return (
    <AppShell role="admin">
      <header className="page-header compact-header admin-page-header">
        <div>
          <span className="eyebrow dark">Administración institucional</span>
          <h1>Panel de Administración</h1>
          <p>Configura y supervisa PlagGuard desde un solo menú.</p>
        </div>
      </header>

      <nav className="admin-quick-nav" aria-label="Módulos administrativos" style={{ marginBottom: '18px' }}>
        {navButton('resumen', 'Resumen')}
        {navButton('periodos', 'Periodos')}
        {navButton('procesos', 'Procesos')}
        {navButton('estudiantes', 'Estudiantes')}
        {navButton('usuarios', 'Usuarios')}
        {navButton('ia', 'Inteligencias artificiales')}
      </nav>

      {error && <div className="alert error-alert page-alert">{error}</div>}
      {message && <div className="alert success-alert page-alert">{message}</div>}

      {section === 'resumen' && (
        <section className="metric-grid admin-metric-grid">
          <article className="metric-card"><span>Estudiantes</span><strong>{overview.students}</strong><small>Firebase UTET</small></article>
          <article className="metric-card"><span>Procesos activos</span><strong>{overview.activeProcesses}</strong><small>{overview.pendingArticles} artículos pendientes</small></article>
          <article className="metric-card"><span>Artículos</span><strong>{overview.articles}</strong><small>Versionados en PlagGuard</small></article>
          <article className="metric-card"><span>Intentos</span><strong>{overview.attempts}</strong><small>{overview.doesNotComply} No cumple</small></article>
          <article className="metric-card"><span>Cumple</span><strong>{overview.complies}</strong><small>{overview.repository} en repositorio final</small></article>
          <article className="metric-card"><span>Regla institucional</span><strong>20 %</strong><small>3 Ordinario + 3 Supletorio</small></article>
        </section>
      )}

      {section !== 'ia' && loading ? (
        <div className="panel-card inline-loading"><span className="mini-spinner" />Cargando administración…</div>
      ) : (
        <>
          {section === 'resumen' && (
            <section className="admin-grid">
              <article className="panel-card">
                <div className="section-heading"><div><span className="eyebrow dark">Estado general</span><h2>Operación institucional</h2><p className="muted-copy">Usa el menú superior para entrar directamente a cada módulo.</p></div></div>
              </article>
              <article className="panel-card">
                <div className="section-heading"><div><span className="eyebrow dark">IA</span><h2>Revisión académica</h2><p className="muted-copy">La administración de evaluadores queda concentrada en Inteligencias artificiales.</p></div></div>
              </article>
            </section>
          )}

          {section === 'periodos' && (
            <section className="panel-card">
              <div className="section-heading"><div><span className="eyebrow dark">Periodos</span><h2>Periodos institucionales</h2><p className="muted-copy">Fuente: Firebase UTET. PlagGuard solo controla la apertura de Ordinario y Supletorio.</p></div></div>
              <div className="admin-list">
                {periods.map((period) => (
                  <div className="admin-row" key={period.id}>
                    <div><strong>{period.name}</strong><span>{period.firebase_period_id || 'Sin ID Firebase'} · {period.active ? 'Activo' : 'Inactivo'}</span></div>
                    <div className="admin-actions">
                      <label><input type="checkbox" checked={period.ordinary_open} onChange={(event) => void run(() => adminSetPeriodState(period.id, event.target.checked, period.supplementary_open, period.active), 'Estado de Ordinario actualizado.')} disabled={busy || !period.active} /> Ordinario</label>
                      <label><input type="checkbox" checked={period.supplementary_open} onChange={(event) => void run(() => adminSetPeriodState(period.id, period.ordinary_open, event.target.checked, period.active), event.target.checked ? 'Supletorio abierto.' : 'Supletorio cerrado.')} disabled={busy || !period.active} /> Supletorio</label>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {section === 'procesos' && (
            <section className="panel-card">
              <div className="section-heading"><div><span className="eyebrow dark">Procesos</span><h2>Asignación automática</h2><p className="muted-copy">Periodo, carrera y modalidad se obtienen de Firebase al ingresar el estudiante.</p></div></div>
              <div className="admin-list">
                {activeEnrollments.map((enrollment) => {
                  const profile = profileById.get(enrollment.student_id);
                  const period = periodById.get(enrollment.period_id);
                  return (
                    <div className="admin-row" key={enrollment.id}>
                      <div><strong>{profile?.full_name || profile?.cedula || 'Estudiante'}</strong><span>{period?.name || 'Periodo'} · {enrollment.career} · {enrollment.modality} · {enrollment.source === 'firebase' ? 'Firebase' : 'Manual'}</span></div>
                    </div>
                  );
                })}
                {activeEnrollments.length === 0 && <p className="muted-copy">Los procesos aparecerán automáticamente cuando los estudiantes ingresen.</p>}
              </div>
            </section>
          )}

          {section === 'estudiantes' && (
            <section className="panel-card">
              <div className="section-heading"><div><span className="eyebrow dark">Estudiantes</span><h2>Padrón institucional</h2><p className="muted-copy">{institutionalStudents.length} estudiantes disponibles desde Firebase UTET.</p></div></div>
              <input className="admin-student-search" value={studentQuery} onChange={(event) => setStudentQuery(event.target.value)} placeholder="Buscar por nombre, cédula o carrera" />
              <div className="admin-list admin-student-list">
                {visibleStudents.map((student) => (
                  <div className="admin-row" key={student.identification}>
                    <div><strong>{student.full_name}</strong><span>{student.identification} · {student.career_name || 'Sin carrera'}{student.campus ? ' · ' + student.campus : ''}</span></div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {section === 'usuarios' && (
            <section className="panel-card">
              <div className="section-heading"><div><span className="eyebrow dark">Usuarios y roles</span><h2>Cuentas de acceso</h2></div></div>
              <div className="admin-list">
                {profiles.map((profile) => (
                  <div className="admin-row" key={profile.id}>
                    <div><strong>{profile.full_name || 'Sin nombre'}</strong><span>{profile.cedula ? profile.cedula + ' · ' : ''}{profile.email}</span></div>
                    <select value={profile.role} disabled={busy} onChange={(event) => void run(() => adminSetProfileRole(profile.id, event.target.value as AppRole), 'Rol actualizado a ' + roleLabels[event.target.value as AppRole] + '.')}>
                      <option value="student">Estudiante</option>
                      <option value="coordinator">Coordinador</option>
                      <option value="admin">Administrador</option>
                    </select>
                  </div>
                ))}
              </div>
            </section>
          )}

          {section === 'ia' && <AdminAiEvaluatorsPanel embedded />}
        </>
      )}
    </AppShell>
  );
}
