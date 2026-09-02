import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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

function json(req: Request, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, "0")).join("");
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

Deno.serve(async (req: Request) => {
  if (!originAllowed(req)) return json(req, 403, { error: "Origen no permitido." });
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Método no permitido." });

  try {
    const body = await req.json();
    const cedula = String(body?.cedula ?? "").replace(/\D/g, "");
    const pin = String(body?.pin ?? "").replace(/\D/g, "");

    if (!/^\d{10}$/.test(cedula)) return json(req, 400, { error: "Ingresa una cédula válida de 10 dígitos." });
    if (!/^\d{4,6}$/.test(pin)) return json(req, 400, { error: "Ingresa un PIN válido." });

    const admin: any = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const ip = String(req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
    const rateKey = `admin:${await hashText(`${ip}:${cedula}`)}`;
    const now = Date.now();
    const { data: rate } = await admin.from("auth_rate_limits")
      .select("attempt_count,window_started_at,blocked_until")
      .eq("rate_key", rateKey)
      .maybeSingle();

    if (rate?.blocked_until && new Date(rate.blocked_until).getTime() > now) {
      return json(req, 429, { error: "Acceso temporalmente bloqueado. Intenta nuevamente en unos minutos." });
    }

    const windowStarted = rate?.window_started_at ? new Date(rate.window_started_at).getTime() : 0;
    const expired = !windowStarted || now - windowStarted > 15 * 60 * 1000;
    const nextCount = expired ? 1 : Number(rate?.attempt_count ?? 0) + 1;
    const ipBlockedUntil = nextCount > 8 ? new Date(now + 15 * 60 * 1000).toISOString() : null;

    await admin.from("auth_rate_limits").upsert({
      rate_key: rateKey,
      attempt_count: ipBlockedUntil ? 0 : nextCount,
      window_started_at: expired ? new Date(now).toISOString() : rate?.window_started_at ?? new Date(now).toISOString(),
      blocked_until: ipBlockedUntil,
      updated_at: new Date(now).toISOString(),
    });

    if (ipBlockedUntil) {
      return json(req, 429, { error: "Demasiados intentos. Acceso bloqueado por 15 minutos." });
    }

    const { data: credential, error: credentialError } = await admin
      .from("admin_pin_credentials")
      .select("admin_user_id,cedula,pin_salt,pin_hash,iterations,failed_attempts,locked_until,active")
      .eq("cedula", cedula)
      .maybeSingle();

    if (credentialError) throw credentialError;
    if (!credential || !credential.active) {
      return json(req, 401, { error: "Cédula o PIN incorrectos." });
    }

    if (credential.locked_until && new Date(credential.locked_until).getTime() > now) {
      return json(req, 429, { error: "Acceso temporalmente bloqueado. Intenta nuevamente en unos minutos." });
    }

    const candidateHash = await hashPin(pin, credential.pin_salt, Number(credential.iterations));
    if (candidateHash !== credential.pin_hash) {
      const failed = Number(credential.failed_attempts ?? 0) + 1;
      const lock = failed >= 5 ? new Date(now + 15 * 60 * 1000).toISOString() : null;
      await admin.from("admin_pin_credentials").update({
        failed_attempts: lock ? 0 : failed,
        locked_until: lock,
        updated_at: new Date(now).toISOString(),
      }).eq("admin_user_id", credential.admin_user_id);

      return json(req, 401, {
        error: lock ? "Acceso bloqueado por 15 minutos." : "Cédula o PIN incorrectos.",
      });
    }

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id,email,full_name,role")
      .eq("id", credential.admin_user_id)
      .maybeSingle();

    if (profileError) throw profileError;
    if (!profile || profile.role !== "admin") {
      return json(req, 403, { error: "La cuenta no tiene rol Administrador." });
    }

    await Promise.all([
      admin.from("admin_pin_credentials").update({
        failed_attempts: 0,
        locked_until: null,
        updated_at: new Date(now).toISOString(),
      }).eq("admin_user_id", credential.admin_user_id),
      admin.from("auth_rate_limits").delete().eq("rate_key", rateKey),
    ]);

    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: profile.email,
    });

    if (linkError) throw linkError;
    const tokenHash = link.properties?.hashed_token;
    if (!tokenHash) throw new Error("No fue posible generar la sesión.");

    return json(req, 200, {
      token_hash: tokenHash,
      admin: { id: profile.id, full_name: profile.full_name, cedula },
    });
  } catch (error) {
    console.error(error);
    return json(req, 500, { error: "No fue posible iniciar sesión administrativa." });
  }
});