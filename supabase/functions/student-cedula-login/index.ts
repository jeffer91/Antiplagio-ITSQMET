import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: student, error: studentError } = await admin
      .from("students")
      .select("identification,full_name,personal_email,institutional_email,active")
      .eq("identification", cleanCedula)
      .eq("active", true)
      .maybeSingle();

    if (studentError) throw studentError;
    if (!student) return json(401, { error: "La cédula no está habilitada para ingresar." });

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
        String(student.institutional_email ?? "").trim() ||
        String(student.personal_email ?? "").trim() ||
        `${cleanCedula}@plagguard.itsqmet.local`;

      let createdUserId = "";
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: {
          full_name: String(student.full_name ?? "").trim(),
          cedula: cleanCedula,
        },
      });

      if (createError) {
        const { data: listed, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        if (listError) throw listError;
        const existing = listed.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
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
          full_name: String(student.full_name ?? "").trim(),
          role: "student",
          cedula: cleanCedula,
        }, { onConflict: "id" });

      if (upsertError) throw upsertError;
    } else if (profile.role !== "student") {
      return json(403, { error: "Este acceso es exclusivo para estudiantes." });
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
      email,
      student: {
        id: userId,
        full_name: String(student.full_name ?? "").trim(),
        cedula: cleanCedula,
      },
    });
  } catch (error) {
    console.error(error);
    return json(500, { error: "No fue posible iniciar sesión. Intenta nuevamente." });
  }
});
