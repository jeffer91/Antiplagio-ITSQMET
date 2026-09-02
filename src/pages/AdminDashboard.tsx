import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '../components/AppShell';
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

export function AdminDashboard(): React.JSX.Element {
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

  return (
    <AppShell role="admin">
      <header className="page-header compact-header admin-page-header">
        <div>
          <span className="eyebrow dark">Administración institucional</span>
          <h1>Panel de Administración</h1>
          <p>Supervisa estudiantes, procesos, periodos, artículos e intentos de PlagGuard.</p>
        </div>
        <nav className="admin-quick-nav" aria-label="Secciones administrativas">
          <button type="button" onClick={() => document.getElementById('admin-periodos')?.scrollIntoView({ behavior: 'smooth' })}>Periodos</button>
          <button type="button" onClick={() => document.getElementById('admin-procesos')?.scrollIntoView({ behavior: 'smooth' })}>Procesos</button>
          <button type="button" onClick={() => document.getElementById('admin-estudiantes')?.scrollIntoView({ behavior: 'smooth' })}>Estudiantes</button>
          <button type="button" onClick={() => document.getElementById('admin-usuarios')?.scrollIntoView({ behavior: 'smooth' })}>Usuarios</button>
        </nav>
      </header>

      {error && <div className="alert error-alert page-alert">{error}</div>}
      {message && <div className="alert success-alert page-alert">{message}</div>}

      <section className="metric-grid admin-metric-grid">
        <article className="metric-card"><span>Estudiantes</span><strong>{overview.students}</strong><small>Firebase UTET</small></article>
        <article className="metric-card"><span>Procesos activos</span><strong>{overview.activeProcesses}</strong><small>{overview.pendingArticles} artículos pendientes</small></article>
        <article className="metric-card"><span>Artículos</span><strong>{overview.articles}</strong><small>Versionados en PlagGuard</small></article>
        <article className="metric-card"><span>Intentos</span><strong>{overview.attempts}</strong><small>{overview.doesNotComply} No cumple</small></article>
        <article className="metric-card"><span>Cumple</span><strong>{overview.complies}</strong><small>{overview.repository} en repositorio final</small></article>
        <article className="metric-card"><span>Regla institucional</span><strong>20 %</strong><small>3 Ordinario + 3 Supletorio</small></article>
      </section>

      {loading ? <div className="panel-card inline-loading"><span className="mini-spinner" />Cargando administración…</div> : (
        <>
          <section className="admin-grid">
            <article className="panel-card" id="admin-periodos">
              <div className="section-heading">
                <div>
                  <span className="eyebrow dark">Periodos</span>
                  <h2>Periodos institucionales</h2>
                  <p className="muted-copy">Fuente: Firebase UTET. PlagGuard solo controla la apertura de Ordinario y Supletorio.</p>
                </div>
              </div>
              <div className="admin-list">
                {periods.map((period) => (
                  <div className="admin-row" key={period.id}>
                    <div>
                      <strong>{period.name}</strong>
                      <span>{period.firebase_period_id || 'Sin ID Firebase'} · {period.active ? 'Activo' : 'Inactivo'}</span>
                    </div>
                    <div className="admin-actions">
                      <label><input type="checkbox" checked={period.ordinary_open} onChange={(event) => void run(() => adminSetPeriodState(period.id, event.target.checked, period.supplementary_open, period.active), 'Estado de Ordinario actualizado.')} disabled={busy || !period.active} /> Ordinario</label>
                      <label><input type="checkbox" checked={period.supplementary_open} onChange={(event) => void run(() => adminSetPeriodState(period.id, period.ordinary_open, event.target.checked, period.active), event.target.checked ? 'Supletorio abierto.' : 'Supletorio cerrado.')} disabled={busy || !period.active} /> Supletorio</label>
                    </div>
                  </div>
                ))}
              </div>
            </article>

            <article className="panel-card" id="admin-procesos">
              <div className="section-heading">
                <div>
                  <span className="eyebrow dark">Procesos</span>
                  <h2>Asignación automática</h2>
                  <p className="muted-copy">Periodo, carrera y modalidad se obtienen de Firebase al ingresar el estudiante. No se capturan manualmente.</p>
                </div>
              </div>
              <div className="admin-list">
                {activeEnrollments.map((enrollment) => {
                  const profile = profileById.get(enrollment.student_id);
                  const period = periodById.get(enrollment.period_id);
                  return (
                    <div className="admin-row" key={enrollment.id}>
                      <div>
                        <strong>{profile?.full_name || profile?.cedula || 'Estudiante'}</strong>
                        <span>{period?.name || 'Periodo'} · {enrollment.career} · {enrollment.modality} · {enrollment.source === 'firebase' ? 'Firebase' : 'Manual'}</span>
                      </div>
                    </div>
                  );
                })}
                {activeEnrollments.length === 0 && <p className="muted-copy">Los procesos aparecerán automáticamente cuando los estudiantes ingresen y su matrícula pueda vincularse con un periodo institucional.</p>}
              </div>
            </article>
          </section>

          <section className="panel-card" id="admin-estudiantes">
            <div className="section-heading">
              <div>
                <span className="eyebrow dark">Estudiantes</span>
                <h2>Padrón institucional</h2>
                <p className="muted-copy">{institutionalStudents.length} estudiantes disponibles desde Firebase UTET.</p>
              </div>
            </div>
            <input
              className="admin-student-search"
              value={studentQuery}
              onChange={(event) => setStudentQuery(event.target.value)}
              placeholder="Buscar por nombre, cédula o carrera"
            />
            <div className="admin-list admin-student-list">
              {visibleStudents.map((student) => (
                <div className="admin-row" key={student.identification}>
                  <div>
                    <strong>{student.full_name}</strong>
                    <span>{student.identification} · {student.career_name || 'Sin carrera'}{student.campus ? ' · ' + student.campus : ''}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="panel-card" id="admin-usuarios">
            <div className="section-heading"><div><span className="eyebrow dark">Usuarios y roles</span><h2>Cuentas de acceso</h2></div></div>
            <div className="admin-list">
              {profiles.map((profile) => (
                <div className="admin-row" key={profile.id}>
                  <div><strong>{profile.full_name || 'Sin nombre'}</strong><span>{profile.cedula ? profile.cedula + ' · ' : ''}{profile.email}</span></div>
                  <select
                    value={profile.role}
                    disabled={busy}
                    onChange={(event) => void run(() => adminSetProfileRole(profile.id, event.target.value as AppRole), 'Rol actualizado a ' + roleLabels[event.target.value as AppRole] + '.')}
                  >
                    <option value="student">Estudiante</option>
                    <option value="coordinator">Coordinador</option>
                    <option value="admin">Administrador</option>
                  </select>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </AppShell>
  );
}
