import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { clean, findStudent, firestoreDocument, type UnknownRecord } from "../_shared/firebase.ts";

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

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
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
  return bytesToHex(new Uint8Array(bits));
}

function randomPin(): string {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return String(100000 + (values[0] % 900000));
}

async function loadStudent(service: any, cedula: string): Promise<UnknownRecord | null> {
  try {
    const firebaseStudent = await findStudent(cedula);
    if (firebaseStudent) return firebaseStudent;
  } catch (error) {
    console.warn("Firebase no disponible durante emisión de PIN:", error);
  }

  const { data } = await service
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
  };
}

async function ensureStudentProfile(service: any, student: UnknownRecord, cedula: string): Promise<{ id: string; email: string; fullName: string }> {
  const fullName = clean(student.nombres) || "Estudiante";
  const careerCode = clean(student.codigoCarreraActual);
  let careerName = clean(student.nombreCarreraActual);
  if (careerCode) {
    try {
      const career = await firestoreDocument("carreras", careerCode);
      careerName = clean(career?.nombreCarrera) || careerName;
    } catch {
      // El perfil puede emitirse desde el espejo local si Firebase está temporalmente indisponible.
    }
  }

  const institutionalEmail = clean(student.correoInstitucional);
  const personalEmail = clean(student.correoPersonal);
  const phone = clean(student.celular);
  const campus = clean(student.sede);

  await service.from("students").upsert({
    identification: cedula,
    full_name: fullName,
    career_code: careerCode || null,
    career_name: careerName || "Sin carrera registrada",
    personal_email: personalEmail || null,
    institutional_email: institutionalEmail || null,
    phone: phone || null,
    campus: campus || null,
    active: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: "identification" });

  const { data: existingProfile, error: profileError } = await service
    .from("profiles")
    .select("id,email,full_name,cedula,role")
    .eq("cedula", cedula)
    .maybeSingle();
  if (profileError) throw profileError;
  if (existingProfile) {
    if (existingProfile.role !== "student") throw new Error("La cédula pertenece a una cuenta que no es de estudiante.");
    await service.from("profiles").update({ full_name: fullName }).eq("id", existingProfile.id);
    return { id: existingProfile.id, email: existingProfile.email, fullName };
  }

  let email = institutionalEmail || personalEmail || `student-${cedula}@plagguard.itsqmet.local`;
  let userId = "";
  const created = await service.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: fullName, cedula },
  });

  if (created.error) {
    const listed = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listed.error) throw listed.error;
    const existing = listed.data.users.find((user: { id: string; email?: string | null }) => user.email?.toLowerCase() === email.toLowerCase());
    if (existing) {
      const { data: linked } = await service.from("profiles").select("id,cedula,role").eq("id", existing.id).maybeSingle();
      if (linked?.cedula && linked.cedula !== cedula) {
        email = `student-${cedula}@plagguard.itsqmet.local`;
        const retry = await service.auth.admin.createUser({
          email,
          email_confirm: true,
          user_metadata: { full_name: fullName, cedula },
        });
        if (retry.error || !retry.data.user) throw retry.error ?? new Error("No fue posible crear el acceso del estudiante.");
        userId = retry.data.user.id;
      } else {
        userId = existing.id;
      }
    } else {
      throw created.error;
    }
  } else {
    if (!created.data.user) throw new Error("No fue posible crear el acceso del estudiante.");
    userId = created.data.user.id;
  }

  const { error: upsertError } = await service.from("profiles").upsert({
    id: userId,
    email,
    full_name: fullName,
    role: "student",
    cedula,
  }, { onConflict: "id" });
  if (upsertError) throw upsertError;
  return { id: userId, email, fullName };
}

Deno.serve(async (req: Request) => {
  if (!originAllowed(req)) return json(req, 403, { error: "Origen no permitido." });
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Método no permitido." });

  const url = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !anonKey || !serviceKey) return json(req, 500, { error: "Supabase no está configurado en el servidor." });

  const authorization = req.headers.get("Authorization") || "";
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const { data: userData, error: userError } = await caller.auth.getUser();
    if (userError || !userData.user) return json(req, 401, { error: "Sesión no válida." });

    const { data: callerProfile } = await service.from("profiles").select("role").eq("id", userData.user.id).maybeSingle();
    if (!callerProfile || callerProfile.role !== "admin") {
      return json(req, 403, { error: "Solo el Administrador puede emitir o restablecer PIN de estudiantes." });
    }

    const body = await req.json();
    const action = clean(body?.action) || "issue";
    if (action !== "issue") return json(req, 400, { error: "Acción no válida." });

    const cedula = clean(body?.cedula).replace(/\D/g, "");
    if (!/^\d{10}$/.test(cedula)) return json(req, 400, { error: "Ingresa una cédula válida de 10 dígitos." });

    const student = await loadStudent(service, cedula);
    if (!student || student.eliminado === true || student.activo === false) {
      return json(req, 404, { error: "La cédula no consta como estudiante activo de UTET." });
    }

    const sourceCedula = clean(student.cedula || student.id || student.firebaseDocumentId);
    if (sourceCedula && sourceCedula !== cedula) return json(req, 409, { error: "La cédula no coincide con el registro institucional." });

    const profile = await ensureStudentProfile(service, student, cedula);
    const pin = randomPin();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const saltHex = bytesToHex(salt);
    const iterations = 210000;
    const pinHash = await hashPin(pin, saltHex, iterations);

    const { error: credentialError } = await service.from("student_pin_credentials").upsert({
      student_user_id: profile.id,
      cedula,
      pin_salt: saltHex,
      pin_hash: pinHash,
      iterations,
      failed_attempts: 0,
      locked_until: null,
      active: true,
      must_rotate: false,
      created_by: userData.user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: "student_user_id" });
    if (credentialError) throw credentialError;

    return json(req, 200, {
      ok: true,
      cedula,
      full_name: profile.fullName,
      temporary_pin: pin,
    });
  } catch (error) {
    console.error(error);
    return json(req, 500, { error: error instanceof Error ? error.message : "No fue posible emitir el PIN." });
  }
});
