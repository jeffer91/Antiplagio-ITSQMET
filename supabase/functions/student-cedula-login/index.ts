import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const FIREBASE_PROJECT_ID = "utet-4387a";
const FIREBASE_API_KEY = "AIzaSyCaHf1C0BB0X_H3BDZ1o-UDAsPmLTjsZLA";
const STUDENT_COLLECTIONS = ["Estudiante", "Estudiantes"];
const ALLOWED_ORIGINS = new Set([
  "https://jeffer91.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
]);

type UnknownRecord = Record<string, unknown>;

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

function json(req: Request, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

function unwrapValue(value: UnknownRecord | undefined): unknown {
  if (!value) return null;
  if ("stringValue" in value) return String(value.stringValue ?? "");
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("integerValue" in value) return Number(value.integerValue ?? 0);
  if ("doubleValue" in value) return Number(value.doubleValue ?? 0);
  if ("timestampValue" in value) return String(value.timestampValue ?? "");
  if ("referenceValue" in value) return String(value.referenceValue ?? "");
  if ("nullValue" in value) return null;
  if ("mapValue" in value) {
    const fields = (value.mapValue as UnknownRecord | undefined)?.fields as UnknownRecord | undefined;
    return unwrapFields(fields);
  }
  if ("arrayValue" in value) {
    const values = ((value.arrayValue as UnknownRecord | undefined)?.values as UnknownRecord[] | undefined) ?? [];
    return values.map((item) => unwrapValue(item));
  }
  return null;
}

function unwrapFields(fields: UnknownRecord | undefined): UnknownRecord {
  const result: UnknownRecord = {};
  for (const [key, raw] of Object.entries(fields ?? {})) {
    result[key] = unwrapValue(raw as UnknownRecord);
  }
  return result;
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function flatten(record: unknown, prefix = ""): Array<{ path: string; value: unknown }> {
  if (Array.isArray(record)) {
    return record.flatMap((value, index) => flatten(value, prefix ? `${prefix}.${index}` : String(index)));
  }
  if (record && typeof record === "object") {
    return Object.entries(record as UnknownRecord).flatMap(([key, value]) =>
      flatten(value, prefix ? `${prefix}.${key}` : key)
    );
  }
  return [{ path: prefix.toLowerCase(), value: record }];
}

function containsExactValue(record: UnknownRecord, expected: string): boolean {
  return flatten(record).some(({ value }) => clean(value) === expected);
}

async function firestoreDocument(collection: string, documentId: string): Promise<UnknownRecord | null> {
  const url =
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${encodeURIComponent(collection)}/${encodeURIComponent(documentId)}?key=${FIREBASE_API_KEY}`;
  const response = await fetch(url);
  if (response.status === 404) return null;
  if (!response.ok) {
    console.error("Firestore GET", collection, response.status);
    return null;
  }
  const payload = await response.json();
  return unwrapFields(payload.fields);
}

async function queryByField(collection: string, field: string, value: string): Promise<UnknownRecord | null> {
  const url =
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: collection }],
        where: {
          fieldFilter: {
            field: { fieldPath: field },
            op: "EQUAL",
            value: { stringValue: value },
          },
        },
        limit: 3,
      },
    }),
  });
  if (!response.ok) return null;
  const payload = await response.json();
  const row = Array.isArray(payload) ? payload.find((item) => item?.document?.fields) : null;
  return row?.document?.fields ? unwrapFields(row.document.fields) : null;
}

async function listCollectionForCedula(collection: string, cedula: string): Promise<UnknownRecord | null> {
  let pageToken = "";
  for (let page = 0; page < 6; page += 1) {
    const url = new URL(
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${encodeURIComponent(collection)}`,
    );
    url.searchParams.set("key", FIREBASE_API_KEY);
    url.searchParams.set("pageSize", "300");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const response = await fetch(url);
    if (!response.ok) return null;
    const payload = await response.json();

    for (const document of payload.documents ?? []) {
      const row = unwrapFields(document.fields);
      if (containsExactValue(row, cedula)) {
        row.__documentId = clean(document.name).split("/").pop() ?? "";
        return row;
      }
    }

    pageToken = clean(payload.nextPageToken);
    if (!pageToken) break;
  }
  return null;
}

async function findStudent(cedula: string): Promise<UnknownRecord | null> {
  for (const collection of STUDENT_COLLECTIONS) {
    const direct = await firestoreDocument(collection, cedula);
    if (direct) return direct;
  }

  const fieldNames = ["cedula", "id", "firebaseDocumentId"];
  for (const collection of STUDENT_COLLECTIONS) {
    const results = await Promise.all(fieldNames.map((field) => queryByField(collection, field, cedula)));
    const found = results.find(Boolean);
    if (found) return found;
  }
  return null;
}

async function findMatricula(cedula: string): Promise<UnknownRecord | null> {
  const direct = await firestoreDocument("matriculas", cedula);
  if (direct) return direct;

  const fields = [
    "cedula",
    "cedulaEstudiante",
    "estudianteCedula",
    "identificacion",
    "numeroDocumento",
    "studentCedula",
    "idEstudiante",
    "estudianteId",
  ];
  const queried = await Promise.all(fields.map((field) => queryByField("matriculas", field, cedula)));
  const active = queried.find((row) => row && row.eliminado !== true && row.activo !== false);
  if (active) return active;

  return await listCollectionForCedula("matriculas", cedula);
}

function resolveModality(...records: Array<UnknownRecord | null>): string {
  for (const record of records) {
    if (!record) continue;
    const match = flatten(record).find(({ path, value }) =>
      /modalidad|modality/.test(path) && typeof value === "string" && clean(value)
    );
    if (match) return clean(match.value);
  }
  return "";
}

function fallbackModality(careerCode: string): string {
  if (/-P-/i.test(careerCode)) return "Presencial";
  if (/-L-/i.test(careerCode)) return "Online";
  return "Institucional";
}

async function hashText(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
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

  if (data?.blocked_until && new Date(data.blocked_until).getTime() > now) {
    throw new Error("RATE_LIMITED");
  }

  const windowStarted = data?.window_started_at ? new Date(data.window_started_at).getTime() : 0;
  const expired = !windowStarted || now - windowStarted > 10 * 60 * 1000;
  const nextCount = expired ? 1 : Number(data?.attempt_count ?? 0) + 1;
  const blockedUntil = nextCount > 12 ? new Date(now + 15 * 60 * 1000).toISOString() : null;

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

Deno.serve(async (req: Request) => {
  if (!originAllowed(req)) return json(req, 403, { error: "Origen no permitido." });
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Método no permitido." });

  const admin: any = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  let rateKey = "";

  try {
    const { cedula } = await req.json();
    const cleanCedula = clean(cedula).replace(/\D/g, "");
    if (!/^\d{10}$/.test(cleanCedula)) {
      return json(req, 400, { error: "Ingresa una cédula válida de 10 dígitos." });
    }

    try {
      rateKey = await enforceRateLimit(admin, req, cleanCedula);
    } catch (error) {
      if (error instanceof Error && error.message === "RATE_LIMITED") {
        return json(req, 429, { error: "Demasiados intentos. Espera unos minutos antes de volver a intentar." });
      }
      throw error;
    }

    const student = await findStudent(cleanCedula);
    if (!student || student.eliminado === true || student.activo === false) {
      return json(req, 401, { error: "La cédula no consta en los estudiantes habilitados de Firebase UTET." });
    }

    const sourceCedula = clean(student.cedula || student.id || student.firebaseDocumentId);
    if (sourceCedula && sourceCedula !== cleanCedula) {
      return json(req, 401, { error: "La cédula no coincide con el registro institucional." });
    }

    const careerCode = clean(student.codigoCarreraActual);
    const careerRow = careerCode ? await firestoreDocument("carreras", careerCode) : null;
    const careerName =
      clean(careerRow?.nombreCarrera)
      || clean(student.nombreCarreraActual)
      || "Sin carrera registrada";

    const fullName = clean(student.nombres) || "Estudiante";
    const institutionalEmail = clean(student.correoInstitucional);
    const personalEmail = clean(student.correoPersonal);
    const phone = clean(student.celular);
    const campus = clean(student.sede);

    const { error: cacheError } = await admin.from("students").upsert({
      identification: cleanCedula,
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
    if (cacheError) console.error("student cache", cacheError);

    let { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id,email,full_name,cedula,role")
      .eq("cedula", cleanCedula)
      .maybeSingle();
    if (profileError) throw profileError;

    let email = profile?.email?.trim() || "";
    let userId = profile?.id || "";

    if (!profile) {
      email = institutionalEmail || personalEmail || `student-${cleanCedula}@plagguard.itsqmet.local`;
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { full_name: fullName, cedula: cleanCedula },
      });

      if (createError) {
        const { data: listed, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        if (listError) throw listError;
        const existing = listed.users.find((user: { id: string; email?: string | null }) => user.email?.toLowerCase() === email.toLowerCase());

        if (existing) {
          const { data: existingProfile } = await admin
            .from("profiles")
            .select("id,cedula")
            .eq("id", existing.id)
            .maybeSingle();
          if (existingProfile?.cedula && existingProfile.cedula !== cleanCedula) {
            email = `student-${cleanCedula}@plagguard.itsqmet.local`;
            const retry = await admin.auth.admin.createUser({
              email,
              email_confirm: true,
              user_metadata: { full_name: fullName, cedula: cleanCedula },
            });
            if (retry.error || !retry.data.user) throw retry.error ?? new Error("No fue posible crear el acceso.");
            userId = retry.data.user.id;
          } else {
            userId = existing.id;
          }
        } else {
          throw createError;
        }
      } else {
        if (!created.user) throw new Error("No fue posible crear el acceso.");
        userId = created.user.id;
      }

      const { error: upsertError } = await admin.from("profiles").upsert({
        id: userId,
        email,
        full_name: fullName,
        role: "student",
        cedula: cleanCedula,
      }, { onConflict: "id" });
      if (upsertError) throw upsertError;

      profile = { id: userId, email, full_name: fullName, role: "student", cedula: cleanCedula };
    } else {
      if (profile.role !== "student") {
        return json(req, 403, { error: "Este acceso es exclusivo para estudiantes." });
      }
      const { error: syncProfileError } = await admin.from("profiles").update({
        full_name: fullName,
      }).eq("id", profile.id);
      if (syncProfileError) throw syncProfileError;
    }

    const matricula = await findMatricula(cleanCedula);
    const { data: periodRows, error: periodsError } = await admin
      .from("academic_periods")
      .select("id,name,firebase_period_id,active")
      .eq("active", true);
    if (periodsError) throw periodsError;

    const sourceForPeriod = matricula ?? student;
    const entries = flatten(sourceForPeriod);
    type PeriodRow = { id: string; name: string; firebase_period_id: string | null; active: boolean };
    const activePeriods = (periodRows ?? []) as PeriodRow[];
    let period = activePeriods.find((candidate: PeriodRow) =>
      entries.some(({ path, value }) =>
        /period/.test(path)
        && (
          clean(value) === clean(candidate.firebase_period_id)
          || clean(value) === clean(candidate.name)
          || clean(value).includes(clean(candidate.firebase_period_id))
        )
      )
    );

    if (!period) {
      period = activePeriods.find((candidate: PeriodRow) =>
        entries.some(({ value }) =>
          clean(value) === clean(candidate.firebase_period_id)
          || clean(value) === clean(candidate.name)
          || clean(value).includes(clean(candidate.firebase_period_id))
        )
      );
    }

    let processConfigured = false;
    let modality = resolveModality(matricula, student, careerRow);
    if (!modality) modality = fallbackModality(careerCode);

    if (period && userId) {
      await admin.from("student_enrollments")
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq("student_id", userId)
        .eq("active", true);

      const matriculaId = clean(matricula?.firebaseDocumentId || matricula?.id || matricula?.__documentId) || null;
      const { error: enrollmentError } = await admin.from("student_enrollments").upsert({
        student_id: userId,
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
      }).eq("owner_id", userId).is("academic_period_id", null);
      if (attachError) throw attachError;

      processConfigured = true;
    }

    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (linkError) throw linkError;

    const tokenHash = link.properties?.hashed_token;
    if (!tokenHash) throw new Error("No fue posible generar la sesión.");

    if (rateKey) await clearRateLimit(admin, rateKey);

    return json(req, 200, {
      token_hash: tokenHash,
      student: {
        id: userId,
        cedula: cleanCedula,
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
    return json(req, 500, { error: "No fue posible consultar Firebase UTET o iniciar la sesión." });
  }
});