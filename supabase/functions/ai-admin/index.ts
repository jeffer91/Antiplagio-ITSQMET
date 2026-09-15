import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  firestoreAdminDelete,
  firestoreAdminGet,
  firestoreAdminList,
  firestoreAdminPut,
  type FirestoreRecord,
} from "../_shared/firestore-admin.ts";

const MODELS_COLLECTION = "plagguard_ai_models";
const CREDENTIALS_COLLECTION = "plagguard_ai_credentials";
const ALLOWED_ORIGINS = new Set([
  "https://jeffer91.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
]);
const ALLOWED_AI_HOSTS = new Set([
  "api.groq.com",
  "openrouter.ai",
  "api.cohere.com",
  "generativelanguage.googleapis.com",
  "api.cloudflare.com",
]);

type UnknownRecord = Record<string, unknown>;
type Adapter = "openai" | "gemini" | "cohere" | "cloudflare" | "custom";

type SeedModel = {
  provider: string;
  adapter: Adapter;
  display_name: string;
  access_tier: string;
  specialty: string;
  priority: number;
  supports_vision?: boolean;
  runtime?: "cloud" | "local";
};

const CATALOG: SeedModel[] = [
  { provider: "Google", adapter: "gemini", display_name: "Gemini 3.8 Flash", access_tier: "Gemini API", specialty: "Revisión general, metodología y coherencia", priority: 10 },
  { provider: "Google", adapter: "gemini", display_name: "Gemini 3.7 Flash", access_tier: "Gemini API", specialty: "Texto largo y análisis integral", priority: 9.9 },
  { provider: "Google", adapter: "gemini", display_name: "Gemini 3.6 Flash", access_tier: "Gemini API", specialty: "Revisión académica rápida", priority: 9.8 },
  { provider: "OpenRouter", adapter: "openai", display_name: "NVIDIA Nemotron 3 Ultra", access_tier: "OpenRouter", specialty: "Razonamiento profundo y documentos largos", priority: 9.7 },
  { provider: "OpenRouter", adapter: "openai", display_name: "NVIDIA Nemotron 3 Super", access_tier: "OpenRouter", specialty: "Evaluación crítica y coherencia científica", priority: 9.6 },
  { provider: "OpenRouter", adapter: "openai", display_name: "Gemma 4 31B", access_tier: "OpenRouter", specialty: "Comprensión de documentos académicos", priority: 9.5 },
  { provider: "OpenRouter", adapter: "openai", display_name: "Gemma 4 26B A4B", access_tier: "OpenRouter", specialty: "Estructura, redacción y análisis", priority: 9.4 },
  { provider: "OpenRouter", adapter: "openai", display_name: "Thinking Machines Inkling", access_tier: "OpenRouter", specialty: "Razonamiento y análisis multidocumento", priority: 9.3 },
  { provider: "OpenRouter", adapter: "openai", display_name: "Inkling Small", access_tier: "OpenRouter", specialty: "Revisión secundaria ligera", priority: 9.2 },
  { provider: "OpenRouter", adapter: "openai", display_name: "Dots3-Note Preview", access_tier: "OpenRouter", specialty: "Documentos extensos y estructura", priority: 9.1 },
  { provider: "OpenRouter", adapter: "openai", display_name: "Ling 3.0 Flash VL", access_tier: "OpenRouter", specialty: "Texto, figuras y tablas", priority: 9, supports_vision: true },
  { provider: "OpenRouter", adapter: "openai", display_name: "Ling 3.0 Flash Sante", access_tier: "OpenRouter", specialty: "Artículos de salud y ciencias médicas", priority: 8.9 },
  { provider: "OpenRouter", adapter: "openai", display_name: "Ling 3.0 Flash Fin", access_tier: "OpenRouter", specialty: "Finanzas, economía y análisis cuantitativo", priority: 8.8 },
  { provider: "OpenRouter", adapter: "openai", display_name: "NVIDIA Nemotron 3.5 Lightning", access_tier: "OpenRouter", specialty: "Revisión rápida y contraste", priority: 8.7 },
  { provider: "OpenRouter", adapter: "openai", display_name: "NVIDIA Nemotron 3 Nano Omni", access_tier: "OpenRouter", specialty: "Modelo multimodal de contraste", priority: 8.6, supports_vision: true },
  { provider: "OpenRouter", adapter: "openai", display_name: "Nex-N2.5-Pro", access_tier: "OpenRouter", specialty: "Razonamiento y procesos complejos", priority: 8.5 },
  { provider: "OpenRouter", adapter: "openai", display_name: "Nex-N2.5-Mini", access_tier: "OpenRouter", specialty: "Revisión rápida secundaria", priority: 8.4 },
  { provider: "OpenRouter", adapter: "openai", display_name: "Poolside Laguna S 2.1", access_tier: "OpenRouter", specialty: "Revisor académico adicional", priority: 8.3 },
  { provider: "OpenRouter", adapter: "openai", display_name: "Poolside Laguna XS 2.1", access_tier: "OpenRouter", specialty: "Revisión secundaria rápida", priority: 8.2 },
  { provider: "OpenRouter", adapter: "openai", display_name: "Cohere North Mini Code", access_tier: "OpenRouter", specialty: "Contraste lógico y técnico", priority: 8.1 },
  { provider: "Groq", adapter: "openai", display_name: "GPT-OSS 120B", access_tier: "Groq / Ollama", specialty: "Razonamiento académico profundo", priority: 9.5 },
  { provider: "Groq", adapter: "openai", display_name: "GPT-OSS 20B", access_tier: "Groq / Ollama", specialty: "Revisión académica rápida", priority: 8.8 },
  { provider: "Ollama local", adapter: "custom", display_name: "Qwen 3.5 27B", access_tier: "Local", specialty: "Español y razonamiento; requiere agente local seguro", priority: 9.2, runtime: "local" },
  { provider: "Ollama local", adapter: "custom", display_name: "Qwen 3.5 9B", access_tier: "Local", specialty: "Revisión local ligera; requiere agente local seguro", priority: 8.4, runtime: "local" },
  { provider: "Ollama local", adapter: "custom", display_name: "Gemma 3 27B", access_tier: "Local", specialty: "Redacción y análisis local; requiere agente local seguro", priority: 8.7, runtime: "local" },
  { provider: "Ollama local", adapter: "custom", display_name: "Gemma 3 12B", access_tier: "Local", specialty: "Revisión local ligera; requiere agente local seguro", priority: 8, runtime: "local" },
];

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
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(req), "Content-Type": "application/json; charset=utf-8" } });
}
function originAllowed(req: Request): boolean {
  const origin = req.headers.get("Origin");
  return !origin || ALLOWED_ORIGINS.has(origin);
}
function asRecord(value: unknown): UnknownRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {}; }
function asString(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function asBool(value: unknown, fallback = false): boolean { return typeof value === "boolean" ? value : fallback; }
function asNumber(value: unknown, fallback: number): number { const n = typeof value === "number" ? value : Number(value); return Number.isFinite(n) ? n : fallback; }
function bytesToBase64(bytes: Uint8Array): string { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }
function base64ToArrayBuffer(value: string): ArrayBuffer { const binary = atob(value); const result = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i += 1) result[i] = binary.charCodeAt(i); return result.buffer; }
function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer; }

async function cryptoKey(): Promise<CryptoKey> {
  const material = (Deno.env.get("AI_CREDENTIALS_MASTER_KEY") || "").trim();
  if (material.length < 32) throw new Error("AI_CREDENTIALS_MASTER_KEY es obligatoria y debe tener al menos 32 caracteres.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return await crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function encryptSecret(value: string): Promise<{ encrypted_key: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(value);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: bytesToArrayBuffer(iv) }, await cryptoKey(), bytesToArrayBuffer(encoded));
  return { encrypted_key: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}
async function decryptSecret(encrypted: string, iv: string): Promise<string> {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToArrayBuffer(iv) }, await cryptoKey(), base64ToArrayBuffer(encrypted));
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
function validateApiUrl(value: string): string {
  if (!value) return value;
  let parsed: URL;
  try { parsed = new URL(value.replace("{model}", "model")); } catch { throw new Error("API URL inválida."); }
  if (parsed.protocol !== "https:") throw new Error("La API URL debe usar HTTPS.");
  if (!ALLOWED_AI_HOSTS.has(parsed.hostname.toLowerCase())) throw new Error("El dominio de la API URL no está autorizado para recibir credenciales IA.");
  return value;
}
async function testOpenAi(url: string, apiKey: string, modelId: string): Promise<void> {
  const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: modelId, temperature: 0, max_tokens: 30, messages: [{ role: "user", content: 'Responde únicamente {"status":"ok"}' }] }), signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 260)}`);
  const payload = asRecord(await response.json()); const choices = Array.isArray(payload.choices) ? payload.choices : []; const message = asRecord(asRecord(choices[0]).message);
  if (!asString(message.content)) throw new Error("El proveedor no devolvió contenido.");
}
async function testGemini(baseUrl: string, apiKey: string, modelId: string): Promise<void> {
  const root = baseUrl || "https://generativelanguage.googleapis.com/v1beta";
  const response = await fetch(`${root.replace(/\/$/, "")}/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: 'Responde únicamente {"status":"ok"}' }] }] }), signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 260)}`);
  const payload = asRecord(await response.json()); const candidates = Array.isArray(payload.candidates) ? payload.candidates : []; const content = asRecord(asRecord(candidates[0]).content); const parts = Array.isArray(content.parts) ? content.parts : [];
  if (!asString(asRecord(parts[0]).text)) throw new Error("Gemini no devolvió contenido.");
}
async function testCohere(url: string, apiKey: string, modelId: string): Promise<void> {
  const response = await fetch(url || "https://api.cohere.com/v2/chat", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: modelId, temperature: 0, max_tokens: 30, messages: [{ role: "user", content: 'Responde únicamente {"status":"ok"}' }] }), signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 260)}`);
  const payload = asRecord(await response.json()); const message = asRecord(payload.message); const content = Array.isArray(message.content) ? message.content : [];
  if (!content.some((part) => Boolean(asString(asRecord(part).text)))) throw new Error("Cohere no devolvió contenido.");
}
async function testCloudflare(url: string, apiKey: string, modelId: string): Promise<void> {
  if (!url) throw new Error("Cloudflare requiere el endpoint de la cuenta en API URL.");
  const endpoint = url.includes("{model}") ? url.replace("{model}", encodeURIComponent(modelId)) : url;
  const response = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: 'Responde únicamente {"status":"ok"}' }], max_tokens: 30 }), signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 260)}`);
  const payload = asRecord(await response.json()); if (!("result" in payload)) throw new Error("Cloudflare no devolvió un resultado válido.");
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
  const modelId = asString(model.model_id); const adapter = asString(model.adapter) as Adapter; const provider = asString(model.provider); const runtime = asString(model.runtime) || "cloud";
  if (runtime === "local") return { status: "unconfigured", latency_ms: 0, error: "Este modelo requiere un agente local seguro; Supabase no puede acceder al localhost del usuario." };
  if (!modelId) return { status: "unconfigured", latency_ms: 0, error: "Falta Model ID." };
  if (!credential) return { status: "unconfigured", latency_ms: 0, error: "Falta la API key." };
  const apiKey = await decryptSecret(asString(credential.encrypted_key), asString(credential.iv));
  const apiUrl = validateApiUrl(asString(model.api_url) || defaultApiUrl(provider, adapter));
  if (!apiUrl) return { status: "unconfigured", latency_ms: 0, error: "Falta una API URL autorizada." };
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

async function ensureCatalog(): Promise<FirestoreRecord[]> {
  let models = await firestoreAdminList(MODELS_COLLECTION);
  if (models.length) return models;
  const now = new Date().toISOString();
  for (const seed of CATALOG) {
    const id = crypto.randomUUID();
    await firestoreAdminPut(MODELS_COLLECTION, id, {
      id,
      ...seed,
      runtime: seed.runtime || "cloud",
      model_id: "",
      api_url: null,
      enabled: false,
      selected_for_review: false,
      fallback: false,
      supports_vision: Boolean(seed.supports_vision),
      max_concurrency: 2,
      timeout_ms: 110000,
      last_status: "unconfigured",
      last_test_at: null,
      last_latency_ms: null,
      last_error: null,
      created_at: now,
      updated_at: now,
    });
  }
  models = await firestoreAdminList(MODELS_COLLECTION);
  return models;
}

Deno.serve(async (req: Request) => {
  if (!originAllowed(req)) return json(req, 403, { error: "Origen no permitido." });
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Método no permitido." });

  const authHeader = req.headers.get("Authorization") || "";
  const url = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !anonKey || !serviceKey) return json(req, 503, { error: "Supabase no está configurado." });
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
      const models = await ensureCatalog();
      const credentials = await firestoreAdminList(CREDENTIALS_COLLECTION);
      const configured = new Set(credentials.map((row) => String(row.id)));
      const ordered = [...models].sort((a, b) => asNumber(b.priority, 0) - asNumber(a.priority, 0) || asString(a.display_name).localeCompare(asString(b.display_name)));
      return json(req, 200, { models: ordered.map((model) => ({ ...model, credential_configured: configured.has(String(model.id)), storage: "firebase" })) });
    }

    if (action === "upsert") {
      const raw = asRecord(body.model);
      const id = asString(raw.id) || crypto.randomUUID();
      const existing = await firestoreAdminGet(MODELS_COLLECTION, id);
      const requestedApiUrl = asString(raw.api_url);
      if (requestedApiUrl) validateApiUrl(requestedApiUrl);
      const runtime = asString(raw.runtime) === "local" ? "local" : "cloud";
      const modelId = asString(raw.model_id);
      const apiKey = asString(body.api_key);
      const credential = await firestoreAdminGet(CREDENTIALS_COLLECTION, id);
      const enabling = asBool(raw.enabled);
      if (enabling && runtime === "local") return json(req, 409, { error: "Los modelos Ollama locales necesitan primero un agente local seguro; no pueden habilitarse directamente desde GitHub Pages." });
      if (enabling && !modelId) return json(req, 409, { error: "Completa el Model ID antes de habilitar la IA." });
      if (enabling && !apiKey && !credential) return json(req, 409, { error: "Configura la API key antes de habilitar la IA." });

      const now = new Date().toISOString();
      const row: FirestoreRecord = {
        id,
        provider: asString(raw.provider) || "Custom",
        adapter: asString(raw.adapter) || "openai",
        runtime,
        display_name: asString(raw.display_name),
        model_id: modelId,
        api_url: requestedApiUrl || null,
        access_tier: asString(raw.access_tier) || null,
        specialty: asString(raw.specialty) || null,
        priority: Math.max(0, Math.min(10, asNumber(raw.priority, 5))),
        enabled: enabling,
        selected_for_review: false,
        fallback: asBool(raw.fallback),
        supports_vision: asBool(raw.supports_vision),
        max_concurrency: Math.max(1, Math.min(10, Math.round(asNumber(raw.max_concurrency, 2)))),
        timeout_ms: Math.max(5000, Math.min(180000, Math.round(asNumber(raw.timeout_ms, 110000)))),
        last_status: enabling ? asString(existing?.last_status) || "unconfigured" : asString(existing?.last_status) || "unconfigured",
        last_test_at: existing?.last_test_at ?? null,
        last_latency_ms: existing?.last_latency_ms ?? null,
        last_error: existing?.last_error ?? null,
        created_at: existing?.created_at ?? now,
        updated_at: now,
      };
      if (!asString(row.display_name)) return json(req, 400, { error: "El nombre del modelo es obligatorio." });
      await firestoreAdminPut(MODELS_COLLECTION, id, row);
      if (apiKey) {
        const protectedKey = await encryptSecret(apiKey);
        await firestoreAdminPut(CREDENTIALS_COLLECTION, id, { id, ...protectedKey, updated_at: now, created_at: credential?.created_at ?? now });
      }
      return json(req, 200, { model: { ...row, credential_configured: Boolean(apiKey || credential), storage: "firebase" } });
    }

    if (action === "test") {
      const id = asString(body.model_id);
      const model = await firestoreAdminGet(MODELS_COLLECTION, id);
      if (!model) return json(req, 404, { error: "Modelo no encontrado en Firebase." });
      const credential = await firestoreAdminGet(CREDENTIALS_COLLECTION, id);
      const result = await runModelTest(model, credential);
      await firestoreAdminPut(MODELS_COLLECTION, id, { ...model, last_status: result.status, last_test_at: new Date().toISOString(), last_latency_ms: result.latency_ms || null, last_error: result.error, updated_at: new Date().toISOString() });
      return json(req, 200, { model_id: id, ...result });
    }

    if (action === "test_all") {
      const models = (await ensureCatalog()).filter((row) => asBool(row.enabled));
      const results: UnknownRecord[] = [];
      for (let i = 0; i < models.length; i += 4) {
        const batch = models.slice(i, i + 4);
        const tested = await Promise.all(batch.map(async (model) => {
          const id = asString(model.id);
          const credential = await firestoreAdminGet(CREDENTIALS_COLLECTION, id);
          const result = await runModelTest(model, credential);
          await firestoreAdminPut(MODELS_COLLECTION, id, { ...model, last_status: result.status, last_test_at: new Date().toISOString(), last_latency_ms: result.latency_ms || null, last_error: result.error, updated_at: new Date().toISOString() });
          return { model_id: id, ...result };
        }));
        results.push(...tested);
      }
      return json(req, 200, { results });
    }

    if (action === "delete") {
      const id = asString(body.model_id);
      await Promise.all([firestoreAdminDelete(MODELS_COLLECTION, id), firestoreAdminDelete(CREDENTIALS_COLLECTION, id)]);
      return json(req, 200, { ok: true });
    }

    if (action === "reset_catalog") {
      const models = await firestoreAdminList(MODELS_COLLECTION);
      for (const model of models) {
        if (!asBool(model.enabled) && !asString(model.model_id)) await firestoreAdminDelete(MODELS_COLLECTION, asString(model.id));
      }
      const seeded = await ensureCatalog();
      return json(req, 200, { ok: true, count: seeded.length });
    }

    return json(req, 400, { error: "Acción no válida." });
  } catch (error) {
    console.error("ai-admin", error);
    return json(req, 500, { error: error instanceof Error ? error.message : "No fue posible gestionar las IA." });
  }
});
