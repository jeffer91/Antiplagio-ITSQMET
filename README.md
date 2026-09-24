# PlagGuard · ITSQMET

PlagGuard es el sistema institucional de **antiplagio y similitud** del ITSQMET. Su alcance es deliberadamente único: localizar coincidencias, verificar sus fuentes, detectar paráfrasis con apoyo de IA y calcular un porcentaje de similitud trazable.

**PlagGuard no califica artículos, no revisa metodología, resultados, discusión, conclusiones ni calidad académica, y no intenta determinar si un texto fue escrito por IA.**

## Qué analiza

Cada intento ejecuta un único flujo:

```text
PDF / DOCX
   ↓
Extracción de texto + SHA-256
   ↓
1. Similitud contra repositorio institucional
   ↓
2. Búsqueda de fuentes académicas y web
   ↓
3. IA semántica contra las fuentes reales localizadas
   ↓
4. Citas, referencias y exclusiones necesarias para el cálculo
   ↓
Cobertura única de palabras coincidentes
   ↓
Porcentaje consolidado
   ↓
≤ 20 % → Cumple     > 20 % → No cumple
```

La IA **no inventa un porcentaje**. Solo puede aportar una coincidencia semántica si el fragmento devuelto existe literalmente tanto en el documento del estudiante como en una fuente localizada. Las coincidencias de abstracts, snippets o metadatos pueden conservarse como evidencia, pero únicamente el texto completo verificable puede aumentar el porcentaje institucional.

Si la búsqueda externa o la IA obligatoria no pueden completarse, PlagGuard detiene el intento y muestra un error de **análisis incompleto**. Un fallo técnico no debe convertirse en un resultado de 0 %.

## Regla institucional

- Límite de similitud: **20 %**.
- Ordinario: **3 intentos**.
- Supletorio: **3 intentos adicionales**.
- La primera versión que obtiene **Cumple** cierra el proceso.
- Los intentos anteriores permanecen en la trazabilidad institucional.
- El repositorio institucional incorpora la versión final que obtuvo Cumple.

El porcentaje consolidado usa cobertura única de palabras. Si el mismo fragmento aparece en varias fuentes, no se suma varias veces.

## Fuentes externas

La búsqueda externa utiliza, según disponibilidad:

- OpenAlex;
- CORE;
- Semantic Scholar;
- Crossref;
- Brave Search para búsqueda web general.

La validación semántica usa directamente IA dentro de la Edge Function de antiplagio. Si existen `PLAGIARISM_AI_*`, utiliza ese proveedor compatible con OpenAI Chat Completions. Si no existen, usa como fallback el modelo de embeddings integrado de Supabase (`gte-small`) sin exponer claves en el navegador. En ambos casos la IA compara el texto objetivo únicamente contra contenido de fuentes ya localizadas; no recibe instrucciones de evaluación académica.

El fallback integrado se usa de forma conservadora (umbral alto) porque `gte-small` está optimizado principalmente para inglés. Para documentos mayoritariamente en español conviene configurar un modelo externo multilingüe; la ausencia de ese proveedor no deja la aplicación sin IA ni permite inventar fuentes.

## Roles

### Estudiante

Puede cargar PDF/DOCX, ejecutar su intento, ver el porcentaje, Cumple/No cumple y las coincidencias que debe corregir. Las fuentes institucionales se presentan de forma anonimizada.

### Coordinador

Puede consultar documentos, versiones, intentos, fuentes y evidencia de similitud, además de generar el informe oficial cuando una versión obtiene Cumple.

### Administrador

Gestiona periodos, apertura de Ordinario/Supletorio, padrón institucional y roles. No existe un módulo de evaluadores académicos ni una revisión global de artículos.

## Seguridad y trazabilidad

- Supabase Auth, PostgreSQL, RLS y Storage privado.
- Versiones inmutables y SHA-256 del archivo.
- Comparación institucional ejecutada en PostgreSQL.
- Credenciales de proveedores únicamente en Supabase Edge Functions.
- Las API keys nunca deben exponerse en variables `VITE_*`.
- El informe oficial conserva identificadores de los análisis utilizados y huella SHA-256.

La huella del archivo original se calcula actualmente en el cliente antes de la carga. Para una cadena de custodia de nivel forense, sigue siendo recomendable verificar también los bytes en un entorno de servidor controlado.

## Preparar Supabase

En un proyecto nuevo ejecuta las migraciones en este orden:

```text
schema.sql
phase2.sql
phase3.sql
phase4.sql
phase5.sql
phase6.sql
phase7.sql
phase8.sql
phase9.sql
phase9_role.sql
phase10.sql
phase11.sql
phase12.sql
phase13.sql
phase14.sql
phase15.sql
phase16.sql
phase18.sql
phase19.sql
phase20.sql
phase21.sql
phase22.sql
phase23.sql
phase24.sql
phase25.sql
phase26.sql
phase27.sql
phase28.sql
phase29.sql
```

La fase 29 conserva los intentos anteriores como historial, deja de contarlos dentro del límite 3+3 y permite reanalizar la misma versión con el motor `plagguard-antiplagio-v2`. Los resultados históricos no cierran el proceso actual ni permanecen activos en el corpus hasta ser revalidados.

No existe `phase17.sql`. La fase 28 actual retira de forma segura las tablas y funciones del antiguo revisor académico global. En instalaciones que aplicaron una versión anterior de la fase 28, vuelve a ejecutar la fase 28 actual para completar esa limpieza.

Algunas tablas históricas conservan nombres internos anteriores por compatibilidad de trazabilidad. Eso no habilita detección de autoría por IA ni revisión académica.

## Edge Functions

Despliega las funciones de acceso/sincronización que utilice tu instalación y, para el antiplagio, asegúrate de desplegar:

```powershell
supabase functions deploy external-similarity
supabase functions deploy ai-semantic-similarity
supabase functions deploy citation-integrity
```

La antigua función `article-review` y el detector `ai-writing-indicators` ya no forman parte de PlagGuard.

## Secretos de proveedores

```env
OPENALEX_API_KEY=
CORE_API_KEY=
SEMANTIC_SCHOLAR_API_KEY=
BRAVE_SEARCH_API_KEY=
CROSSREF_MAILTO=

PLAGIARISM_AI_API_URL=
PLAGIARISM_AI_API_KEY=
PLAGIARISM_AI_MODEL=
```

`PLAGIARISM_AI_API_URL` debe apuntar a un endpoint compatible con Chat Completions cuando se quiera usar un modelo externo. Estas tres variables son opcionales porque existe el fallback integrado de Supabase. El servidor valida las respuestas contra el texto real antes de incorporarlas como evidencia.

## Variables del renderer

```env
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REEMPLAZAR
```

Nunca coloques `service_role` ni claves privadas de proveedores en el cliente.

## Desarrollo

```powershell
git clone https://github.com/jeffer91/Antiplagio-ITSQMET.git
cd Antiplagio-ITSQMET
npm install
Copy-Item .env.example .env
npm run dev
```

## Validación

```powershell
npm run typecheck
npm run build
```

El workflow de CI compila React/Electron y ejecuta `deno check` sobre las Edge Functions activas. GitHub Pages se publica desde `main`.

## Alcance del producto

PlagGuard responde una sola pregunta institucional: **qué porcentaje de similitud verificable tiene este documento y de dónde provienen las coincidencias**.

La evaluación académica del contenido pertenece a otro proceso y no forma parte de esta aplicación.
