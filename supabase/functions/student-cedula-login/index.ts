import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  clean,
  fallbackModality,
  findMatricula,
  findStudent,
  flatten,
  firestoreDocument,
  resolveModality,
  type UnknownRecord,
} from "../_shared/firebase.ts";

const ALLOWED_ORIGINS = new Set([
  "https://jeffer91.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
]);

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://jeffer91.github.io",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function originAllowed(req: Request): boolean {
  const origin = req.headers.get("Origin");
  return !origin || ALLOWED_ORIGINS.has(origin);
}

function json(req: Request, status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json; charset=utf-8" },
  });
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes.buffer as ArrayBuffer;
}

async function hashPin(pin: string, saltHex: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    hash: "SHA-256",
    salt: hexToBytes(saltHex),
    iterations,
  }, key, 256);
  return bytesToHex(bits);
}

async function hashText(value: string): Promise<string> {
  return bytesToHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function enforceRateLimit(admin: any, req: Request, cedula: string): Promise<string> {
  const forwarded = clean(req.headers.get("x-forwarded-for")).split(",")[0]?.trim() || "unknown";
  const rateKey = `student:${await hashText(`${forwarded}:${cedula}`)}`;
  const now = Date.now();
  const { data } = await admin
    .from("auth_rate_limits")
    .select("attempt_count,window_started_at,blocked_until")
    .eq("rate_key", rateKey)
    .maybeSingle();

  if (data?.blocked_until && new Date(data.blocked_until).getTime() > now) throw new Error("RATE_LIMITED");

  const windowStarted = data?.window_started_at ? new Date(data.window_started_at).getTime() : 0;
  const expired = !windowStarted || now - windowStarted > 10 * 60 * 1000;
  const nextCount = expired ? 1 : Number(data?.attempt_count ?? 0) + 1;
  const blockedUntil = nextCount > 8 ? new Date(now + 15 * 60 * 1000).toISOString() : null;

  await admin.from("auth_rate_limits").upsert({
    rate_key: rateKey,
    attempt_count: blockedUntil ? 0 : nextCount,
    window_started_at: expired ? new Date(now).toISOString() : data?.window_started_at ?? new Date(now).toISOString(),
    blocked_until: blockedUntil,
    updated_at: new Date(now).toISOString(),
  });

  if (blockedUntil) throw new Error("RATE_LIMITED");
  return rateKey;
}

async function clearRateLimit(admin: any, rateKey: string): Promise<void> {
  await admin.from("auth_rate_limits").delete().eq("rate_key", rateKey);
}

async function loadInstitutionalStudent(admin: any, cedula: string): Promise<UnknownRecord | null> {
  try {
    const live = await findStudent(cedula);
    if (live) return live;
  } catch (error) {
    console.warn("Firebase UTET no disponible; se intentará el espejo local:", error);
  }

  const { data } = await admin
    .from("students")
    .select("identification,full_name,career_code,career_name,institutional_email,personal_email,phone,campus,active")
    .eq("identification", cedula)
    .eq("active", true)
    .maybeSingle();
  if (!data) return null;
  return {
    cedula: data.identification,
    nombres: data.full_name,
    codigoCarreraActual: data.career_code,
    nombreCarreraActual: data.career_name,
    correoInstitucional: data.institutional_email,
    correoPersonal: data.personal_email,
    celular: data.phone,
    sede: data.campus,
    activo: data.active,
    __source: "supabase_firebase_cache",
  };
}

Deno.serve(async (req: Request) => {
  if (!originAllowed(req)) return json(req, 403, { error: "Origen no permitido." });
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Método no permitido." });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceKey) return json(req, 500, { error: "Supabase no está configurado en el servidor." });

  const admin: any = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let rateKey = "";
  try {
    const body = await req.json();
    const cedula = clean(body?.cedula).replace(/\D/g, "");
    const pin = clean(body?.pin).replace(/\D/g, "");
    if (!/^\d{10}$/.test(cedula)) return json(req, 400, { error: "Ingresa una cédula válida de 10 dígitos." });
    if (!/^\d{6}$/.test(pin)) return json(req, 400, { error: "Ingresa tu PIN de 6 dígitos." });

    try {
      rateKey = await enforceRateLimit(admin, req, cedula);
    } catch (error) {
      if (error instanceof Error && error.message === "RATE_LIMITED") {
        return json(req, 429, { error: "Demasiados intentos. Espera 15 minutos antes de volver a intentar." });
      }
      throw error;
    }

    const { data: credential, error: credentialError } = await admin
      .from("student_pin_credentials")
      .select("student_user_id,cedula,pin_salt,pin_hash,iterations,failed_attempts,locked_until,active")
      .eq("cedula", cedula)
      .maybeSingle();
    if (credentialError) throw credentialError;
    if (!credential || !credential.active) {
      return json(req, 403, { error: "Tu acceso con PIN todavía no está habilitado. Solicítalo a Titulación." });
    }

    const now = Date.now();
    if (credential.locked_until && new Date(credential.locked_until).getTime() > now) {
      return json(req, 429, { error: "Acceso temporalmente bloqueado. Intenta nuevamente en 15 minutos." });
    }

    const candidate = await hashPin(pin, credential.pin_salt, Number(credential.iterations));
    if (candidate !== credential.pin_hash) {
      const failed = Number(credential.failed_attempts ?? 0) + 1;
      const lockedUntil = failed >= 5 ? new Date(now + 15 * 60 * 1000).toISOString() : null;
      await admin.from("student_pin_credentials").update({
        failed_attempts: lockedUntil ? 0 : failed,
        locked_until: lockedUntil,
        updated_at: new Date(now).toISOString(),
      }).eq("student_user_id", credential.student_user_id);
      return json(req, 401, { error: lockedUntil ? "Acceso bloqueado por 15 minutos." : "Cédula o PIN incorrectos." });
    }

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id,email,full_name,cedula,role")
      .eq("id", credential.student_user_id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile || profile.role !== "student" || clean(profile.cedula) !== cedula) {
      return json(req, 403, { error: "La credencial no está vinculada a un perfil de estudiante válido." });
    }

    const student = await loadInstitutionalStudent(admin, cedula);
    if (!student || student.eliminado === true || student.activo === false) {
      return json(req, 401, { error: "La cédula no consta entre los estudiantes habilitados de UTET." });
    }

    const sourceCedula = clean(student.cedula || student.id || student.firebaseDocumentId);
    if (sourceCedula && sourceCedula !== cedula) {
      return json(req, 401, { error: "La cédula no coincide con el registro institucional." });
    }

    const careerCode = clean(student.codigoCarreraActual);
    let careerRow: UnknownRecord | null = null;
    if (careerCode) {
      try {
        careerRow = await firestoreDocument("carreras", careerCode);
      } catch {
        careerRow = null;
      }
    }
    const careerName = clean(careerRow?.nombreCarrera) || clean(student.nombreCarreraActual) || "Sin carrera registrada";
    const fullName = clean(student.nombres) || profile.full_name || "Estudiante";
    const institutionalEmail = clean(student.correoInstitucional);
    const personalEmail = clean(student.correoPersonal);
    const phone = clean(student.celular);
    const campus = clean(student.sede);

    await admin.from("students").upsert({
      identification: cedula,
      full_name: fullName,
      career_code: careerCode || null,
      career_name: careerName,
      personal_email: personalEmail || null,
      institutional_email: institutionalEmail || null,
      phone: phone || null,
      campus: campus || null,
      active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: "identification" });
    await admin.from("profiles").update({ full_name: fullName }).eq("id", profile.id);

    let matricula: UnknownRecord | null = null;
    try {
      matricula = await findMatricula(cedula);
    } catch (error) {
      console.warn("No fue posible consultar matrícula en Firebase:", error);
    }

    const { data: periodRows, error: periodsError } = await admin
      .from("academic_periods")
      .select("id,name,firebase_period_id,active")
      .eq("active", true);
    if (periodsError) throw periodsError;

    const entries = flatten(matricula ?? student);
    type PeriodRow = { id: string; name: string; firebase_period_id: string | null; active: boolean };
    const activePeriods = (periodRows ?? []) as PeriodRow[];
    let period = activePeriods.find((candidate) => entries.some(({ path, value }) =>
      /period/.test(path) && (
        clean(value) === clean(candidate.firebase_period_id)
        || clean(value) === clean(candidate.name)
        || (clean(candidate.firebase_period_id) && clean(value).includes(clean(candidate.firebase_period_id)))
      )
    ));

    if (!period) {
      period = activePeriods.find((candidate) => entries.some(({ value }) =>
        clean(value) === clean(candidate.firebase_period_id)
        || clean(value) === clean(candidate.name)
        || (clean(candidate.firebase_period_id) && clean(value).includes(clean(candidate.firebase_period_id)))
      ));
    }

    let processConfigured = false;
    let modality = resolveModality(matricula, student, careerRow);
    if (!modality) modality = fallbackModality(careerCode);

    if (period) {
      await admin.from("student_enrollments")
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq("student_id", profile.id)
        .eq("active", true);

      const matriculaId = clean(matricula?.firebaseDocumentId || matricula?.id || matricula?.__documentId) || null;
      const { error: enrollmentError } = await admin.from("student_enrollments").upsert({
        student_id: profile.id,
        period_id: period.id,
        career: careerName,
        modality,
        active: true,
        source: "firebase",
        firebase_matricula_id: matriculaId,
        firebase_updated_at: clean(matricula?.updatedAt) || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "student_id,period_id,career,modality" });
      if (enrollmentError) throw enrollmentError;

      const { error: attachError } = await admin.from("documents").update({
        academic_period_id: period.id,
        career: careerName,
        modality,
        updated_at: new Date().toISOString(),
      }).eq("owner_id", profile.id).is("academic_period_id", null);
      if (attachError) throw attachError;
      processConfigured = true;
    }

    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: profile.email,
    });
    if (linkError) throw linkError;
    const tokenHash = link.properties?.hashed_token;
    if (!tokenHash) throw new Error("No fue posible generar la sesión.");

    await Promise.all([
      admin.from("student_pin_credentials").update({
        failed_attempts: 0,
        locked_until: null,
        updated_at: new Date().toISOString(),
      }).eq("student_user_id", profile.id),
      rateKey ? clearRateLimit(admin, rateKey) : Promise.resolve(),
    ]);

    return json(req, 200, {
      token_hash: tokenHash,
      student: {
        id: profile.id,
        cedula,
        full_name: fullName,
        career_code: careerCode,
        career_name: careerName,
        campus,
      },
      process: {
        configured: processConfigured,
        period_id: period?.id ?? null,
        period_name: period?.name ?? null,
        modality: processConfigured ? modality : null,
        source: processConfigured ? "firebase" : null,
      },
    });
  } catch (error) {
    console.error(error);
    return json(req, 500, { error: "No fue posible validar el acceso del estudiante." });
  }
});
