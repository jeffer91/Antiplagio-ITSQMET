import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '../components/AppShell';
import {
  adminAssignStudent,
  adminCreatePeriod,
  adminSetPeriodState,
  adminSetProfileRole,
  loadEnrollments,
  loadInstitutionalStudent,
  loadPeriods,
  loadProfiles,
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
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [newPeriodName, setNewPeriodName] = useState('');
  const [studentId, setStudentId] = useState('');
  const [periodId, setPeriodId] = useState('');
  const [career, setCareer] = useState('');
  const [modality, setModality] = useState('Presencial');

  const refresh = useCallback(async (): Promise<void> => {
    const [profileRows, periodRows, enrollmentRows] = await Promise.all([
      loadProfiles(),
      loadPeriods(),
      loadEnrollments(),
    ]);
    setProfiles(profileRows);
    setPeriods(periodRows);
    setEnrollments(enrollmentRows);
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

  const createPeriod = async (): Promise<void> => {
    if (!newPeriodName.trim()) {
      setError('Escribe el nombre del periodo.');
      return;
    }
    await run(async () => {
      await adminCreatePeriod(newPeriodName.trim());
      setNewPeriodName('');
    }, 'Periodo creado con 20 % y 3 intentos Ordinario + 3 Supletorio.');
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
      <header className="page-header compact-header">
        <div>
          <span className="eyebrow dark">Administración institucional</span>
          <h1>Control de PlagGuard</h1>
          <p>Gestiona usuarios, periodos, reglas, asignaciones académicas y la apertura de Ordinario/Supletorio.</p>
        </div>
      </header>

      {error && <div className="alert error-alert page-alert">{error}</div>}
      {message && <div className="alert success-alert page-alert">{message}</div>}

      <section className="metric-grid">
        <article className="metric-card"><span>Estudiantes</span><strong>{students.length}</strong><small>{activeEnrollments.length} con asignación activa</small></article>
        <article className="metric-card"><span>Coordinadores</span><strong>{coordinators.length}</strong><small>Acceso a análisis e informes</small></article>
        <article className="metric-card"><span>Periodos</span><strong>{periods.length}</strong><small>{periods.filter((period) => period.active).length} activos</small></article>
        <article className="metric-card"><span>Regla institucional</span><strong>20 %</strong><small>3 Ordinario + 3 Supletorio</small></article>
      </section>

      {loading ? <div className="panel-card inline-loading"><span className="mini-spinner" />Cargando configuración…</div> : (
        <>
          <section className="admin-grid">
            <article className="panel-card">
              <div className="section-heading"><div><span className="eyebrow dark">Periodos</span><h2>Apertura de procesos</h2></div></div>
              <div className="inline-form">
                <input value={newPeriodName} onChange={(event) => setNewPeriodName(event.target.value)} placeholder="Ej. Abril 2026 – Septiembre 2026" disabled={busy} />
                <button className="primary-button compact" type="button" onClick={() => void createPeriod()} disabled={busy}>Crear periodo</button>
              </div>
              <div className="admin-list">
                {periods.map((period) => (
                  <div className="admin-row" key={period.id}>
                    <div><strong>{period.name}</strong><span>{period.similarity_limit.toFixed(0)} % · {period.ordinary_attempts} Ordinario + {period.supplementary_attempts} Supletorio</span></div>
                    <div className="admin-actions">
                      <label><input type="checkbox" checked={period.ordinary_open} onChange={(event) => void run(() => adminSetPeriodState(period.id, event.target.checked, period.supplementary_open, period.active), 'Estado del periodo actualizado.')} disabled={busy} /> Ordinario</label>
                      <label><input type="checkbox" checked={period.supplementary_open} onChange={(event) => void run(() => adminSetPeriodState(period.id, period.ordinary_open, event.target.checked, period.active), event.target.checked ? 'Supletorio abierto.' : 'Supletorio cerrado.')} disabled={busy} /> Supletorio</label>
                      <label><input type="checkbox" checked={period.active} onChange={(event) => void run(() => adminSetPeriodState(period.id, period.ordinary_open, period.supplementary_open, event.target.checked), 'Estado del periodo actualizado.')} disabled={busy} /> Activo</label>
                    </div>
                  </div>
                ))}
                {periods.length === 0 && <p className="muted-copy">Todavía no existen periodos.</p>}
              </div>
            </article>

            <article className="panel-card">
              <div className="section-heading"><div><span className="eyebrow dark">Asignación</span><h2>Periodo + carrera + modalidad</h2></div></div>
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

          <section className="panel-card">
            <div className="section-heading"><div><span className="eyebrow dark">Usuarios</span><h2>Perfiles y roles</h2></div></div>
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
