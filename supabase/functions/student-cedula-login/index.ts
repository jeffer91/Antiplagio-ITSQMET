import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FIREBASE_PROJECT_ID = "utet-4387a";
const FIREBASE_API_KEY = "AIzaSyCaHf1C0BB0X_H3BDZ1o-UDAsPmLTjsZLA";
const STUDENT_COLLECTIONS = ["Estudiante", "Estudiantes"];

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type FirestoreValue = {
  stringValue?: string;
  booleanValue?: boolean;
  integerValue?: string;
  doubleValue?: number;
  timestampValue?: string;
  nullValue?: null;
};

function unwrap(fields: Record<string, FirestoreValue> | undefined): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields ?? {})) {
    if ("stringValue" in value) result[key] = value.stringValue ?? "";
    else if ("booleanValue" in value) result[key] = Boolean(value.booleanValue);
    else if ("integerValue" in value) result[key] = Number(value.integerValue ?? 0);
    else if ("doubleValue" in value) result[key] = Number(value.doubleValue ?? 0);
    else if ("timestampValue" in value) result[key] = value.timestampValue ?? "";
    else result[key] = null;
  }
  return result;
}

async function firestoreDocument(collection: string, documentId: string): Promise<Record<string, unknown> | null> {
  const url =
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${encodeURIComponent(collection)}/${encodeURIComponent(documentId)}?key=${FIREBASE_API_KEY}`;

  const response = await fetch(url);
  if (response.status === 404) return null;

  if (!response.ok) {
    const detail = await response.text();
    console.error("Firestore GET error", collection, response.status, detail);
    throw new Error("No fue posible consultar el registro institucional.");
  }

  const payload = await response.json();
  return unwrap(payload.fields);
}

async function queryFirestoreByField(
  collection: string,
  field: string,
  value: string,
): Promise<Record<string, unknown> | null> {
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
        limit: 1,
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error("Firestore query error", collection, field, response.status, detail);
    return null;
  }

  const payload = await response.json();
  const row = Array.isArray(payload)
    ? payload.find((item) => item?.document?.fields)
    : null;

  return row?.document?.fields ? unwrap(row.document.fields) : null;
}

async function findStudentByCedula(cedula: string): Promise<Record<string, unknown> | null> {
  // 1) Camino rápido: en UTET normalmente el documentId es la cédula.
  for (const collection of STUDENT_COLLECTIONS) {
    const direct = await firestoreDocument(collection, cedula);
    if (direct) return direct;
  }

  // 2) Respaldo: algunas importaciones pueden conservar otro documentId.
  // Buscamos por los campos institucionales que ya existen en Firebase.
  for (const collection of STUDENT_COLLECTIONS) {
    for (const field of ["cedula", "id", "firebaseDocumentId"]) {
      const found = await queryFirestoreByField(collection, field, cedula);
      if (found) return found;
    }
  }

  return null;
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Método no permitido." });

  try {
    const { cedula } = await req.json();
    const cleanCedula = String(cedula ?? "").replace(/\D/g, "");

    if (!/^\d{10}$/.test(cleanCedula)) {
      return json(400, { error: "Ingresa una cédula válida de 10 dígitos." });
    }

    const student = await findStudentByCedula(cleanCedula);

    if (!student) {
      return json(401, {
        error: "La cédula no consta en los estudiantes habilitados de Firebase UTET.",
      });
    }

    if (student.eliminado === true) {
      return json(401, { error: "El registro del estudiante está eliminado en Firebase UTET." });
    }

    const sourceCedula = clean(student.cedula || student.id || student.firebaseDocumentId);
    if (sourceCedula && sourceCedula !== cleanCedula) {
      return json(401, { error: "La cédula no coincide con el registro institucional." });
    }

    const careerCode = clean(student.codigoCarreraActual);
    const career = careerCode ? await firestoreDocument("carreras", careerCode) : null;
    const careerIsUsable = Boolean(career && career.eliminado !== true && career.activo !== false);
    const careerName =
      (careerIsUsable ? clean(career?.nombreCarrera) : "")
      || clean(student.nombreCarreraActual)
      || "Sin carrera registrada";

    const fullName = clean(student.nombres) || "Estudiante";
    const institutionalEmail = clean(student.correoInstitucional);
    const personalEmail = clean(student.correoPersonal);
    const phone = clean(student.celular);
    const campus = clean(student.sede);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const { error: cacheError } = await admin
      .from("students")
      .upsert({
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

    if (cacheError) console.error("Student cache sync", cacheError);

    let { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id,email,full_name,cedula,role")
      .eq("cedula", cleanCedula)
      .maybeSingle();

    if (profileError) throw profileError;

    let email = profile?.email?.trim() || "";
    let userId = profile?.id || "";

    if (!profile) {
      email =
        institutionalEmail
        || personalEmail
        || `${cleanCedula}@students.itsqmet.edu.ec`;

      let createdUserId = "";
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: {
          full_name: fullName,
          cedula: cleanCedula,
          career_code: careerCode,
          career_name: careerName,
          campus,
        },
      });

      if (createError) {
        const { data: listed, error: listError } = await admin.auth.admin.listUsers({
          page: 1,
          perPage: 1000,
        });

        if (listError) throw listError;

        const existing = listed.users.find(
          (user) => user.email?.toLowerCase() === email.toLowerCase(),
        );

        if (!existing) throw createError;
        createdUserId = existing.id;
      } else {
        createdUserId = created.user.id;
      }

      userId = createdUserId;

      const { error: upsertError } = await admin
        .from("profiles")
        .upsert({
          id: userId,
          email,
          full_name: fullName,
          role: "student",
          cedula: cleanCedula,
        }, { onConflict: "id" });

      if (upsertError) throw upsertError;
    } else {
      if (profile.role !== "student") {
        return json(403, { error: "Este acceso es exclusivo para estudiantes." });
      }

      const { error: syncProfileError } = await admin
        .from("profiles")
        .update({
          full_name: fullName,
          cedula: cleanCedula,
        })
        .eq("id", profile.id);

      if (syncProfileError) throw syncProfileError;
    }

    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });

    if (linkError) throw linkError;

    const tokenHash = link.properties?.hashed_token;
    if (!tokenHash) throw new Error("No fue posible generar la sesión.");

    return json(200, {
      token_hash: tokenHash,
      student: {
        id: userId,
        cedula: cleanCedula,
        full_name: fullName,
        career_code: careerCode,
        career_name: careerName,
        campus,
      },
    });
  } catch (error) {
    console.error(error);
    return json(500, {
      error: "No fue posible consultar Firebase UTET o iniciar la sesión.",
    });
  }
});