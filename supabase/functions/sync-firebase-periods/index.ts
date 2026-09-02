import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const FIREBASE_PROJECT_ID = "utet-4387a";
const FIREBASE_API_KEY = "AIzaSyCaHf1C0BB0X_H3BDZ1o-UDAsPmLTjsZLA";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type FirestoreValue = {
  stringValue?: string;
  booleanValue?: boolean;
  integerValue?: string;
  doubleValue?: number;
  timestampValue?: string;
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
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
  const all: Record<string, unknown>[] = [];
  let pageToken = "";

  do {
    const url = new URL(
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/periodos`,
    );
    url.searchParams.set("key", FIREBASE_API_KEY);
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const response = await fetch(url);
    if (!response.ok) {
      const detail = await response.text();
      console.error("Firestore periods error", response.status, detail);
      throw new Error("No fue posible consultar los periodos de Firebase.");
    }

    const payload = await response.json();
    for (const doc of payload.documents ?? []) all.push(unwrap(doc.fields));
    pageToken = String(payload.nextPageToken ?? "");
  } while (pageToken);

  return all;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Método no permitido." });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const sourcePeriods = await listFirebasePeriods();
    const normalized = sourcePeriods
      .map((row) => {
        const firebasePeriodId = String(
          row.periodoId ?? row.id ?? row.firebaseDocumentId ?? "",
        ).trim();
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

    return json(200, {
      ok: true,
      total: normalized.length,
      active: normalized.filter((row) => row.active).length,
      periods: normalized,
    });
  } catch (error) {
    console.error(error);
    return json(500, { error: "No fue posible sincronizar los periodos desde Firebase." });
  }
});
