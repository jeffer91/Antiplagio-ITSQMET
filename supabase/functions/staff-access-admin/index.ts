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

function json(req: Request, status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json; charset=utf-8" },
  });
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function randomPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  let output = "Aa7!";
  for (const byte of bytes) output += alphabet[byte % alphabet.length];
  return output;
}

Deno.serve(async (req: Request) => {
  if (!originAllowed(req)) return json(req, 403, { error: "Origen no permitido." });
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Método no permitido." });

  const url = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !anonKey || !serviceKey) return json(req, 503, { error: "Supabase no está configurado en el servidor." });

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
      return json(req, 403, { error: "Solo el Administrador puede gestionar credenciales del Coordinador." });
    }

    const body = await req.json();
    const action = clean(body?.action) || "reset_password";
    if (action !== "reset_password") return json(req, 400, { error: "Acción no válida." });

    const userId = clean(body?.user_id);
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return json(req, 400, { error: "Usuario no válido." });

    const { data: profile, error: profileError } = await service
      .from("profiles")
      .select("id,email,full_name,role")
      .eq("id", userId)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile || profile.role !== "coordinator") {
      return json(req, 409, { error: "El usuario debe tener rol Coordinador antes de generar su acceso." });
    }
    if (!clean(profile.email)) return json(req, 409, { error: "El Coordinador no tiene correo asociado." });

    const temporaryPassword = randomPassword();
    const { error: updateError } = await service.auth.admin.updateUserById(userId, {
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: { full_name: profile.full_name || "Coordinador" },
    });
    if (updateError) throw updateError;

    return json(req, 200, {
      ok: true,
      user_id: profile.id,
      email: profile.email,
      full_name: profile.full_name,
      temporary_password: temporaryPassword,
    });
  } catch (error) {
    console.error("staff-access-admin", error);
    return json(req, 500, { error: error instanceof Error ? error.message : "No fue posible generar el acceso del Coordinador." });
  }
});
