import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '../components/AppShell';
import {
  adminAssignStudent,
  adminSetPeriodState,
  adminSetProfileRole,
  loadAdminOverview,
  loadEnrollments,
  loadInstitutionalStudent,
  loadPeriods,
  loadProfiles,
  type AdminOverview,
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
  const [periods, setPeriods] = useState<AcademicPeriod[]>([]);
  const [enrollments, setEnrollments] = useState<StudentEnrollment[]>([]);
  const [overview, setOverview] = useState<AdminOverview>({ articles: 0, attempts: 0, complies: 0, doesNotComply: 0, repository: 0 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [studentId, setStudentId] = useState('');
  const [periodId, setPeriodId] = useState('');
  const [career, setCareer] = useState('');
  const [modality, setModality] = useState('Presencial');

  const refresh = useCallback(async (): Promise<void> => {
    const [profileRows, periodRows, enrollmentRows, overviewRow] = await Promise.all([
      loadProfiles(),
      loadPeriods(),
      loadEnrollments(),
      loadAdminOverview(),
    ]);
    setProfiles(profileRows);
    setPeriods(periodRows);
    setEnrollments(enrollmentRows);
    setOverview(overviewRow);
  }, []);

  useEffect(() => {
    void refresh()
      .catch((caught) => setError(caught instanceof Error ? caught.message : 'No fue posible cargar la administración.'))
      .finally(() => setLoading(false));
  }, [refresh]);

  const students = useMemo(() => profiles.filter((profile) => profile.role === 'student'), [profiles]);
  const coordinators = useMemo(() => profiles.filter((profile) => profile.role === 'coordinator'), [profiles]);
  const activeEnrollments = useMemo(() => enrollments.filter((enrollment) => enrollment.active), [enrollments]);

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

  const chooseStudent = async (value: string): Promise<void> => {
    setStudentId(value);
    const selected = students.find((student) => student.id === value);
    if (!selected?.cedula) {
      setCareer('');
      return;
    }
    try {
      const institutional = await loadInstitutionalStudent(selected.cedula);
      setCareer(institutional?.career_name ?? '');
    } catch {
      setCareer('');
    }
  };

  const assignStudent = async (): Promise<void> => {
    if (!studentId || !periodId || !career.trim() || !modality.trim()) {
      setError('Completa estudiante, periodo, carrera y modalidad.');
      return;
    }
    await run(async () => {
      await adminAssignStudent(studentId, periodId, career.trim(), modality.trim());
    }, 'Asignación académica actualizada.');
  };

  return (
    <AppShell role="admin">
      <header className="page-header compact-header admin-page-header">
        <div>
          <span className="eyebrow dark">Administración institucional</span>
          <h1>Panel de Administración</h1>
          <p>Supervisa artículos, resultados, periodos, intentos, estudiantes y accesos de PlagGuard.</p>
        </div>
        <nav className="admin-quick-nav" aria-label="Secciones administrativas">
          <button type="button" onClick={() => document.getElementById('admin-periodos')?.scrollIntoView({ behavior: 'smooth' })}>Periodos</button>
          <button type="button" onClick={() => document.getElementById('admin-asignaciones')?.scrollIntoView({ behavior: 'smooth' })}>Procesos</button>
          <button type="button" onClick={() => document.getElementById('admin-usuarios')?.scrollIntoView({ behavior: 'smooth' })}>Usuarios</button>
        </nav>
      </header>

      {error && <div className="alert error-alert page-alert">{error}</div>}
      {message && <div className="alert success-alert page-alert">{message}</div>}

      <section className="metric-grid admin-metric-grid">
        <article className="metric-card"><span>Estudiantes</span><strong>{students.length}</strong><small>{activeEnrollments.length} con proceso activo</small></article>
        <article className="metric-card"><span>Artículos</span><strong>{overview.articles}</strong><small>Versionados en PlagGuard</small></article>
        <article className="metric-card"><span>Intentos ejecutados</span><strong>{overview.attempts}</strong><small>{overview.doesNotComply} No cumple</small></article>
        <article className="metric-card"><span>Cumple</span><strong>{overview.complies}</strong><small>{overview.repository} en repositorio final</small></article>
        <article className="metric-card"><span>Periodos</span><strong>{periods.length}</strong><small>{periods.filter((period) => period.active).length} activos</small></article>
        <article className="metric-card"><span>Regla institucional</span><strong>20 %</strong><small>3 Ordinario + 3 Supletorio</small></article>
      </section>

      {loading ? <div className="panel-card inline-loading"><span className="mini-spinner" />Cargando configuración…</div> : (
        <>
          <section className="admin-grid">
            <article className="panel-card" id="admin-periodos">
              <div className="section-heading">
                <div>
                  <span className="eyebrow dark">Periodos</span>
                  <h2>Periodos institucionales</h2>
                  <p className="muted-copy">Fuente automática: Firebase UTET · colección <strong>periodos</strong>. No se crean ni editan manualmente en PlagGuard.</p>
                </div>
              </div>
              <div className="admin-list">
                {periods.map((period) => (
                  <div className="admin-row" key={period.id}>
                    <div>
                      <strong>{period.name}</strong>
                      <span>
                        {period.firebase_period_id ? `${period.firebase_period_id} · ` : ''}
                        {period.active ? 'Activo en Firebase' : 'Inactivo en Firebase'}
                        {' · '}{period.similarity_limit.toFixed(0)} % · {period.ordinary_attempts} Ordinario + {period.supplementary_attempts} Supletorio
                      </span>
                    </div>
                    <div className="admin-actions">
                      <label><input type="checkbox" checked={period.ordinary_open} onChange={(event) => void run(() => adminSetPeriodState(period.id, event.target.checked, period.supplementary_open, period.active), 'Estado de Ordinario actualizado.')} disabled={busy || !period.active} /> Ordinario</label>
                      <label><input type="checkbox" checked={period.supplementary_open} onChange={(event) => void run(() => adminSetPeriodState(period.id, period.ordinary_open, event.target.checked, period.active), event.target.checked ? 'Supletorio abierto.' : 'Supletorio cerrado.')} disabled={busy || !period.active} /> Supletorio</label>
                    </div>
                  </div>
                ))}
                {periods.length === 0 && <p className="muted-copy">No se encontraron periodos activos en Firebase UTET.</p>}
              </div>
            </article>

            <article className="panel-card" id="admin-asignaciones">
              <div className="section-heading"><div><span className="eyebrow dark">Procesos</span><h2>Periodo + carrera + modalidad</h2></div></div>
              <label className="field-label">Estudiante
                <select value={studentId} onChange={(event) => void chooseStudent(event.target.value)} disabled={busy}>
                  <option value="">Seleccionar…</option>
                  {students.map((student) => <option key={student.id} value={student.id}>{student.full_name || student.email}{student.cedula ? ` · ${student.cedula}` : ''}</option>)}
                </select>
              </label>
              <label className="field-label">Periodo
                <select value={periodId} onChange={(event) => setPeriodId(event.target.value)} disabled={busy}>
                  <option value="">Seleccionar…</option>
                  {periods.filter((period) => period.active).map((period) => <option key={period.id} value={period.id}>{period.name}</option>)}
                </select>
              </label>
              <label className="field-label">Carrera
                <input value={career} onChange={(event) => setCareer(event.target.value)} placeholder="Se completa desde Firebase al elegir estudiante" disabled={busy} />
              </label>
              <label className="field-label">Modalidad
                <select value={modality} onChange={(event) => setModality(event.target.value)} disabled={busy}>
                  <option>Presencial</option><option>Online</option><option>Híbrida</option>
                </select>
              </label>
              <button className="primary-button compact" type="button" onClick={() => void assignStudent()} disabled={busy}>Guardar asignación</button>
            </article>
          </section>

          <section className="panel-card" id="admin-usuarios">
            <div className="section-heading"><div><span className="eyebrow dark">Usuarios y roles</span><h2>Perfiles y roles</h2></div></div>
            <div className="admin-list">
              {profiles.map((profile) => (
                <div className="admin-row" key={profile.id}>
                  <div><strong>{profile.full_name || 'Sin nombre'}</strong><span>{profile.cedula ? `${profile.cedula} · ` : ''}{profile.email}</span></div>
                  <select
                    value={profile.role}
                    disabled={busy}
                    onChange={(event) => void run(() => adminSetProfileRole(profile.id, event.target.value as AppRole), `Rol actualizado a ${roleLabels[event.target.value as AppRole]}.`)}
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
