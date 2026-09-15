import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://jeffer91.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
]);

const MAX_SELECTED = 15;
type UnknownRecord = Record<string, unknown>;
type Adapter = "openai" | "gemini" | "cohere" | "cloudflare" | "custom";

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://jeffer91.github.io",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json; charset=utf-8" },
  });
}

function originAllowed(req: Request): boolean {
  const origin = req.headers.get("Origin");
  return !origin || ALLOWED_ORIGINS.has(origin);
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asBool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const result = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) result[i] = binary.charCodeAt(i);
  return result.buffer;
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function cryptoKey(): Promise<CryptoKey> {
  const material = Deno.env.get("AI_CREDENTIALS_MASTER_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!material) throw new Error("No existe una clave maestra para proteger credenciales IA.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return await crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptSecret(value: string): Promise<{ encrypted_key: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(value);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: bytesToArrayBuffer(iv) },
    await cryptoKey(),
    bytesToArrayBuffer(encoded),
  );
  return {
    encrypted_key: bytesToBase64(new Uint8Array(encrypted)),
    iv: bytesToBase64(iv),
  };
}

async function decryptSecret(encrypted: string, iv: string): Promise<string> {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToArrayBuffer(iv) },
    await cryptoKey(),
    base64ToArrayBuffer(encrypted),
  );
  return new TextDecoder().decode(plain);
}

function defaultApiUrl(provider: string, adapter: Adapter): string {
  const normalized = provider.toLowerCase();
  if (adapter === "gemini") return "https://generativelanguage.googleapis.com/v1beta";
  if (normalized === "groq") return "https://api.groq.com/openai/v1/chat/completions";
  if (normalized === "openrouter") return "https://openrouter.ai/api/v1/chat/completions";
  if (adapter === "cohere" || normalized === "cohere") return "https://api.cohere.com/v2/chat";
  return "";
}

async function testOpenAi(url: string, apiKey: string, modelId: string): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: modelId,
      temperature: 0,
      max_tokens: 30,
      messages: [{ role: "user", content: 'Responde únicamente {"status":"ok"}' }],
    }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 260)}`);
  const payload = asRecord(await response.json());
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const message = asRecord(asRecord(choices[0]).message);
  if (!asString(message.content)) throw new Error("El proveedor no devolvió contenido.");
}

async function testGemini(baseUrl: string, apiKey: string, modelId: string): Promise<void> {
  const root = baseUrl || "https://generativelanguage.googleapis.com/v1beta";
  const url = `${root.replace(/\/$/, "")}/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: 'Responde únicamente {"status":"ok"}' }] }] }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 260)}`);
  const payload = asRecord(await response.json());
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const content = asRecord(asRecord(candidates[0]).content);
  const parts = Array.isArray(content.parts) ? content.parts : [];
  if (!asString(asRecord(parts[0]).text)) throw new Error("Gemini no devolvió contenido.");
}

async function testCohere(url: string, apiKey: string, modelId: string): Promise<void> {
  const response = await fetch(url || "https://api.cohere.com/v2/chat", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: modelId,
      temperature: 0,
      max_tokens: 30,
      messages: [{ role: "user", content: 'Responde únicamente {"status":"ok"}' }],
    }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 260)}`);
  const payload = asRecord(await response.json());
  const message = asRecord(payload.message);
  const content = Array.isArray(message.content) ? message.content : [];
  if (!content.some((part) => Boolean(asString(asRecord(part).text)))) throw new Error("Cohere no devolvió contenido.");
}

async function testCloudflare(url: string, apiKey: string, modelId: string): Promise<void> {
  if (!url) throw new Error("Cloudflare requiere el endpoint de la cuenta en API URL.");
  const endpoint = url.includes("{model}") ? url.replace("{model}", encodeURIComponent(modelId)) : url;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: 'Responde únicamente {"status":"ok"}' }], max_tokens: 30 }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 260)}`);
  const payload = asRecord(await response.json());
  if (!("result" in payload)) throw new Error("Cloudflare no devolvió un resultado válido.");
}

function classifyError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("429") || lower.includes("rate")) return "rate_limited";
  if (lower.includes("401") || lower.includes("403") || lower.includes("credential") || lower.includes("api key")) return "invalid_credentials";
  if (lower.includes("404") || lower.includes("model")) return "model_not_found";
  if (lower.includes("timeout") || lower.includes("fetch") || lower.includes("network")) return "provider_down";
  return "error";
}

async function runModelTest(model: UnknownRecord, credential: UnknownRecord | null): Promise<{ status: string; latency_ms: number; error: string | null }> {
  const modelId = asString(model.model_id);
  const adapter = asString(model.adapter) as Adapter;
  const provider = asString(model.provider);
  if (!modelId) return { status: "unconfigured", latency_ms: 0, error: "Falta Model ID." };
  if (!credential) return { status: "unconfigured", latency_ms: 0, error: "Falta la API key." };

  const apiKey = await decryptSecret(asString(credential.encrypted_key), asString(credential.iv));
  const apiUrl = asString(model.api_url) || defaultApiUrl(provider, adapter);
  const started = Date.now();
  try {
    if (adapter === "gemini") await testGemini(apiUrl, apiKey, modelId);
    else if (adapter === "cohere") await testCohere(apiUrl, apiKey, modelId);
    else if (adapter === "cloudflare") await testCloudflare(apiUrl, apiKey, modelId);
    else await testOpenAi(apiUrl, apiKey, modelId);
    return { status: "available", latency_ms: Date.now() - started, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Error no identificado";
    return { status: classifyError(message), latency_ms: Date.now() - started, error: message };
  }
}

Deno.serve(async (req: Request) => {
  if (!originAllowed(req)) return json(req, 403, { error: "Origen no permitido." });
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Método no permitido." });

  const authHeader = req.headers.get("Authorization") || "";
  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const caller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const service = createClient(url, serviceKey, { auth: { persistSession: false } });

  try {
    const { data: userData, error: userError } = await caller.auth.getUser();
    if (userError || !userData.user) return json(req, 401, { error: "Sesión no válida." });
    const { data: profile } = await service.from("profiles").select("role").eq("id", userData.user.id).maybeSingle();
    if (!profile || profile.role !== "admin") return json(req, 403, { error: "Solo el Administrador puede gestionar las IA." });

    const body = asRecord(await req.json());
    const action = asString(body.action) || "list";

    if (action === "list") {
      const { data: models, error } = await service.from("ai_models").select("*").order("priority", { ascending: false }).order("display_name");
      if (error) throw error;
      const ids = (models ?? []).map((row) => row.id);
      const credentialResult = ids.length
        ? await service.from("ai_model_credentials").select("model_id").in("model_id", ids)
        : { data: [] as Array<{ model_id: string }>, error: null };
      if (credentialResult.error) throw credentialResult.error;
      const configured = new Set((credentialResult.data ?? []).map((row: any) => String(row.model_id)));
      return json(req, 200, {
        models: (models ?? []).map((model) => ({ ...model, credential_configured: configured.has(String(model.id)) })),
        max_selected: MAX_SELECTED,
      });
    }

    if (action === "upsert") {
      const raw = asRecord(body.model);
      const id = asString(raw.id) || null;
      const selected = asBool(raw.selected_for_review);
      if (selected) {
        let query = service.from("ai_models").select("id", { count: "exact", head: true }).eq("selected_for_review", true);
        if (id) query = query.neq("id", id);
        const { count } = await query;
        if ((count ?? 0) >= MAX_SELECTED) return json(req, 409, { error: `Solo puedes seleccionar ${MAX_SELECTED} modelos por revisión.` });
      }

      const row = {
        provider: asString(raw.provider) || "Custom",
        adapter: asString(raw.adapter) || "openai",
        display_name: asString(raw.display_name),
        model_id: asString(raw.model_id),
        api_url: asString(raw.api_url) || null,
        access_tier: asString(raw.access_tier) || null,
        specialty: asString(raw.specialty) || null,
        priority: Math.max(0, Math.min(10, asNumber(raw.priority, 5))),
        enabled: asBool(raw.enabled),
        selected_for_review: selected,
        fallback: asBool(raw.fallback),
        supports_vision: asBool(raw.supports_vision),
        max_concurrency: Math.max(1, Math.min(10, Math.round(asNumber(raw.max_concurrency, 2)))),
        timeout_ms: Math.max(5000, Math.min(180000, Math.round(asNumber(raw.timeout_ms, 110000)))),
        updated_at: new Date().toISOString(),
      };
      if (!row.display_name) return json(req, 400, { error: "El nombre del modelo es obligatorio." });

      const modelResult = id
        ? await service.from("ai_models").update(row).eq("id", id).select("*").single()
        : await service.from("ai_models").insert(row).select("*").single();
      if (modelResult.error || !modelResult.data) throw modelResult.error || new Error("No se pudo guardar el modelo.");

      const apiKey = asString(body.api_key);
      if (apiKey) {
        const protectedKey = await encryptSecret(apiKey);
        const { error: credentialError } = await service.from("ai_model_credentials").upsert({
          model_id: modelResult.data.id,
          ...protectedKey,
          updated_at: new Date().toISOString(),
        });
        if (credentialError) throw credentialError;
      }
      return json(req, 200, { model: modelResult.data });
    }

    if (action === "test") {
      const id = asString(body.model_id);
      const { data: model, error: modelError } = await service.from("ai_models").select("*").eq("id", id).single();
      if (modelError || !model) return json(req, 404, { error: "Modelo no encontrado." });
      const { data: credential } = await service.from("ai_model_credentials").select("encrypted_key,iv").eq("model_id", id).maybeSingle();
      const result = await runModelTest(model as UnknownRecord, credential as UnknownRecord | null);
      await service.from("ai_models").update({
        last_status: result.status,
        last_test_at: new Date().toISOString(),
        last_latency_ms: result.latency_ms || null,
        last_error: result.error,
        updated_at: new Date().toISOString(),
      }).eq("id", id);
      return json(req, 200, { model_id: id, ...result });
    }

    if (action === "test_all") {
      const { data: models, error } = await service.from("ai_models").select("*").eq("enabled", true).order("priority", { ascending: false });
      if (error) throw error;
      const results: UnknownRecord[] = [];
      for (let i = 0; i < (models ?? []).length; i += 3) {
        const batch = (models ?? []).slice(i, i + 3);
        const tested = await Promise.all(batch.map(async (model) => {
          const { data: credential } = await service.from("ai_model_credentials").select("encrypted_key,iv").eq("model_id", model.id).maybeSingle();
          const result = await runModelTest(model as UnknownRecord, credential as UnknownRecord | null);
          await service.from("ai_models").update({
            last_status: result.status,
            last_test_at: new Date().toISOString(),
            last_latency_ms: result.latency_ms || null,
            last_error: result.error,
            updated_at: new Date().toISOString(),
          }).eq("id", model.id);
          return { model_id: model.id, ...result };
        }));
        results.push(...tested);
      }
      return json(req, 200, { results });
    }

    if (action === "delete") {
      const id = asString(body.model_id);
      const { error } = await service.from("ai_models").delete().eq("id", id);
      if (error) throw error;
      return json(req, 200, { ok: true });
    }

    return json(req, 400, { error: "Acción no válida." });
  } catch (error) {
    console.error("ai-admin", error);
    return json(req, 500, { error: error instanceof Error ? error.message : "No fue posible gestionar las IA." });
  }
});
