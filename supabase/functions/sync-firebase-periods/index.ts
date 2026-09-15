import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://jeffer91.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
]);

type FirestoreValue = {
  stringValue?: string;
  booleanValue?: boolean;
  integerValue?: string;
  doubleValue?: number;
  timestampValue?: string;
};

function firebaseConfig(): { projectId: string; apiKey: string } {
  const projectId = (Deno.env.get("FIREBASE_PROJECT_ID") || "").trim();
  const apiKey = (Deno.env.get("FIREBASE_API_KEY") || "").trim();
  if (!projectId || !apiKey) throw new Error("Firebase UTET no está configurado en los secretos del servidor.");
  return { projectId, apiKey };
}

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
    headers: { ...corsHeaders(req), "Content-Type": "application/json; charset=utf-8" },
  });
}

function unwrap(fields: Record<string, FirestoreValue> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields ?? {})) {
    if ("stringValue" in value) out[key] = value.stringValue ?? "";
    else if ("booleanValue" in value) out[key] = Boolean(value.booleanValue);
    else if ("integerValue" in value) out[key] = Number(value.integerValue ?? 0);
    else if ("doubleValue" in value) out[key] = Number(value.doubleValue ?? 0);
    else if ("timestampValue" in value) out[key] = value.timestampValue ?? "";
  }
  return out;
}

async function listFirebasePeriods(): Promise<Record<string, unknown>[]> {
  const { projectId, apiKey } = firebaseConfig();
  const all: Record<string, unknown>[] = [];
  let pageToken = "";

  do {
    const url = new URL(
      `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/periodos`,
    );
    url.searchParams.set("key", apiKey);
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) {
      console.error("Firestore periods error", response.status);
      throw new Error("No fue posible consultar los periodos de Firebase.");
    }

    const payload = await response.json();
    for (const doc of payload.documents ?? []) all.push(unwrap(doc.fields));
    pageToken = String(payload.nextPageToken ?? "");
  } while (pageToken);

  return all;
}

Deno.serve(async (req: Request) => {
  if (!originAllowed(req)) return json(req, 403, { error: "Origen no permitido." });
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Método no permitido." });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceKey) throw new Error("Supabase no está configurado en el servidor.");

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const sourcePeriods = await listFirebasePeriods();
    const normalized = sourcePeriods
      .map((row) => {
        const firebasePeriodId = String(row.periodoId ?? row.id ?? row.firebaseDocumentId ?? "").trim();
        const name = String(row.label ?? firebasePeriodId).trim();
        const active = row.activo === true && row.eliminado !== true;

        return {
          firebasePeriodId,
          name,
          active,
          dataHash: String(row.dataHash ?? "").trim() || null,
          updatedAt: String(row.updatedAt ?? "").trim() || null,
        };
      })
      .filter((row) => row.firebasePeriodId && row.name);

    for (const period of normalized) {
      const { data: existing, error: existingError } = await admin
        .from("academic_periods")
        .select("id")
        .eq("firebase_period_id", period.firebasePeriodId)
        .maybeSingle();
      if (existingError) throw existingError;

      if (existing) {
        const { error } = await admin
          .from("academic_periods")
          .update({
            name: period.name,
            active: period.active,
            firebase_data_hash: period.dataHash,
            firebase_updated_at: period.updatedAt,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await admin
          .from("academic_periods")
          .insert({
            name: period.name,
            similarity_limit: 20,
            ordinary_attempts: 3,
            supplementary_attempts: 3,
            ordinary_open: true,
            supplementary_open: false,
            active: period.active,
            firebase_period_id: period.firebasePeriodId,
            firebase_data_hash: period.dataHash,
            firebase_updated_at: period.updatedAt,
          });
        if (error) throw error;
      }
    }

    return json(req, 200, {
      ok: true,
      total: normalized.length,
      active: normalized.filter((row) => row.active).length,
      periods: normalized,
    });
  } catch (error) {
    console.error(error);
    return json(req, 500, { error: error instanceof Error ? error.message : "No fue posible sincronizar los periodos desde Firebase." });
  }
});
