import "jsr:@supabase/functions-js/edge-runtime.d.ts";
Deno.serve(async () => new Response(
  JSON.stringify({ error: "Configuración inicial deshabilitada." }),
  { status: 410, headers: { "Content-Type": "application/json" } },
));