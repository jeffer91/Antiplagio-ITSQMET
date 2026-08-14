# SIAI — Antiplagio ITSQMET

Sistema de Integridad Académica Institucional. Aplicación Electron orientada a entregas académicas, similitud interna y externa, trazabilidad de versiones, revisión bibliográfica e indicadores de uso probable de IA.

## Estado

**Fase 5 — Fuentes académicas y web públicas**

- Electron + React + TypeScript + Vite.
- Supabase Auth con roles `student` y `coordinator`.
- PDF y DOCX de hasta 25 MB, Storage privado, SHA-256 y versiones inmutables.
- Extracción de texto y detección de PDF que requiere OCR.
- Similitud institucional contra el corpus ITSQMET.
- Informe interactivo con texto resaltado, fuentes numeradas, exclusiones y porcentaje ajustado.
- Búsqueda externa ejecutada desde una Supabase Edge Function, sin exponer claves en Electron.
- OpenAlex: búsqueda exacta y semántica; cuando existe contenido en OpenAlex se intenta recuperar TEI/GROBID para comparación textual.
- CORE: búsqueda de trabajos y uso de texto completo cuando el API lo proporciona.
- Semantic Scholar: búsqueda de snippets indexados del cuerpo de publicaciones.
- Crossref: descubrimiento y metadatos bibliográficos; un resumen depositado puede servir como evidencia textual cuando realmente coincide.
- Brave Search: búsqueda web general opcional. Sus snippets se consideran candidatos, no prueba textual.
- Fuentes sin texto verificable se muestran como **candidatos no verificados** y no modifican el porcentaje.
- Un mismo DOI/URL/título detectado en varios proveedores se agrupa para evitar fuentes duplicadas.
- El porcentaje externo usa cobertura única de palabras: una palabra coincidente con dos fuentes no se suma dos veces.
- Se conserva un índice reutilizable de metadatos y hashes de shingles de fuentes externas verificadas, sin almacenar el texto completo de terceros.
- El estudiante solo puede ver un informe externo cuando el coordinador lo libera.
- CI valida tanto la aplicación Electron como la Edge Function de Deno.

## Principio de la Fase 5

SIAI separa **descubrimiento** de **verificación**.

Un buscador puede indicar que una publicación o página parece relacionada, pero eso no basta para sumarla al índice de similitud. La fuente solo afecta el porcentaje cuando SIAI dispone de texto auténtico de esa fuente y encuentra una coincidencia textual comprobable.

Ejemplo:

```text
OpenAlex encuentra Artículo A
        ↓
¿Existe texto/abstract verificable?
        ↓ sí
Comparación local por shingles
        ↓
Coincidencia comprobada → aporta al porcentaje

Brave encuentra Página B
        ↓
Solo existe URL + snippet de buscador
        ↓
Candidato no verificado → 0 % en el cálculo
```

## Proveedores

### OpenAlex

Requiere `OPENALEX_API_KEY`. La Fase 5 usa consultas `search.exact` y `search.semantic`. Para un número limitado de candidatos con contenido disponible intenta obtener el XML GROBID desde el servicio de contenido de OpenAlex. Esta descarga puede consumir el presupuesto diario de la cuenta OpenAlex.

### CORE

SIAI consulta CORE API V3. `CORE_API_KEY` es opcional en el código: si existe se envía como Bearer token; sin clave se intenta utilizar el acceso público sujeto a los límites y condiciones vigentes de CORE.

### Semantic Scholar

Usa el endpoint de búsqueda de snippets para localizar fragmentos indexados de aproximadamente el cuerpo de los artículos. `SEMANTIC_SCHOLAR_API_KEY` es opcional, pero recomendable para un uso institucional más estable.

### Crossref

No requiere clave. `CROSSREF_MAILTO` es opcional y permite identificar educadamente las solicitudes institucionales. Crossref se utiliza principalmente para metadatos, DOI y resúmenes depositados; no se trata como una base de texto completo.

### Brave Search

Es opcional. Si no existe `BRAVE_SEARCH_API_KEY`, el informe indica **Sin configurar** y el resto de proveedores continúa funcionando. Los resultados web encontrados por Brave se conservan como candidatos hasta disponer de texto verificable por otra vía.

## Privacidad de las búsquedas externas

La aplicación Electron **no envía el documento completo directamente a los proveedores**. La Edge Function selecciona un número pequeño de fragmentos distintivos del cuerpo académico y evita, en lo posible, portada, referencias, correos, cédulas y secuencias numéricas largas.

El análisis externo debe ejecutarlo expresamente el coordinador. El texto completo del artículo permanece en Supabase; hacia los proveedores salen únicamente las consultas necesarias para localizar candidatos.

SIAI tampoco persiste el texto completo descargado de publicaciones externas. Guarda:

- metadatos de la fuente;
- DOI/URL;
- tipo de verificación;
- porcentaje y cobertura;
- extractos breves que sustentan la coincidencia;
- hashes de shingles para un índice reutilizable.

## Preparar Supabase

En un proyecto nuevo ejecuta, en este orden:

1. `supabase/schema.sql`
2. `supabase/phase2.sql`
3. `supabase/phase3.sql`
4. `supabase/phase4.sql`
5. `supabase/phase5.sql`

Después crea tu cuenta y convierte únicamente la cuenta administrativa en coordinador:

```sql
update public.profiles
set role = 'coordinator'
where email = 'TU_CORREO';
```

Las cuentas creadas desde la aplicación permanecen como `student`.

## Configurar la Edge Function

Nunca coloques claves de proveedores en `.env` del renderer ni en variables `VITE_*`.

Los nombres de secretos esperados están documentados en:

```text
supabase/functions/.env.example
```

Configura los que vayas a utilizar:

```powershell
supabase secrets set OPENALEX_API_KEY="TU_CLAVE"
supabase secrets set CORE_API_KEY="TU_CLAVE"
supabase secrets set SEMANTIC_SCHOLAR_API_KEY="TU_CLAVE"
supabase secrets set BRAVE_SEARCH_API_KEY="TU_CLAVE"
supabase secrets set CROSSREF_MAILTO="correo@institucion.edu.ec"
```

Luego despliega:

```powershell
supabase functions deploy external-similarity
```

`OPENALEX_API_KEY` y `BRAVE_SEARCH_API_KEY` controlan conectores que se desactivan limpiamente si no están configurados. CORE, Semantic Scholar y Crossref se intentan consultar incluso sin una clave específica, según las condiciones de acceso de cada servicio.

## Flujo actual

```text
Estudiante carga PDF/DOCX
        ↓
Extracción + SHA-256 + almacenamiento privado
        ↓
Versión V1 / V2 / V3...
        ↓
Similitud interna ITSQMET
        ↓
Informe interactivo + exclusiones
        ↓
Coordinador: Buscar fuentes externas
        ↓
Edge Function selecciona fragmentos distintivos
        ↓
OpenAlex + CORE + Semantic Scholar + Crossref + Web opcional
        ↓
Deduplicar DOI / URL / título
        ↓
Verificar texto disponible
        ↓
Comparar y guardar evidencia
        ↓
Fuentes verificadas + candidatos no verificados
        ↓
Coordinador decide si libera el resultado
```

## Qué detecta actualmente la similitud externa

El motor `siai-external-shingle-v1` detecta principalmente copia textual y modificaciones pequeñas cuando la fuente pública ofrece texto verificable. Usa shingles de 5 palabras, exige al menos 10 palabras de evidencia y registra rangos exactos de cobertura.

La Fase 5 **todavía no afirma resolver paráfrasis semántica profunda**. OpenAlex puede usar búsqueda semántica para descubrir candidatos conceptualmente relacionados, pero un candidato semántico solo entra al porcentaje si posteriormente existe evidencia textual suficiente.

## Desarrollo

```powershell
git clone https://github.com/jeffer91/Antiplagio-ITSQMET.git
cd Antiplagio-ITSQMET
npm install
Copy-Item .env.example .env
npm run dev
```

Configura `.env` del renderer únicamente con valores publicables:

```env
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REEMPLAZAR
```

## Validación

```powershell
npm run typecheck
npm run build
```

GitHub Actions además ejecuta:

```text
deno check supabase/functions/external-similarity/index.ts
```

## Estructura relevante

```text
src/
  components/
    SimilarityPanel.tsx
    SimilarityReportModal.tsx
    ExternalSimilarityPanel.tsx
  lib/
    documents.ts
    similarity.ts
    similarityView.ts
    externalSimilarity.ts
  types/
    similarity.ts
    externalSimilarity.ts
  similarity.css
  phase4.css
  external.css
supabase/
  schema.sql
  phase2.sql
  phase3.sql
  phase4.sql
  phase5.sql
  functions/
    .env.example
    external-similarity/
      index.ts
```

## Ruta del proyecto

- Fase 1: Electron + React + Supabase + roles ✅
- Fase 2: carga PDF/DOCX + almacenamiento + versiones + extracción ✅
- Fase 3: similitud contra corpus institucional ✅
- Fase 4: visor interactivo + exclusiones + recálculo ✅
- Fase 5: fuentes académicas y web públicas ✅
- Fase 6: citas, bibliografía y APA 7
- Fase 7: indicadores de escritura asistida por IA
- Fase 8: informes PDF/Excel
- Fase 9: instalador y actualizaciones

## Principio del sistema

SIAI presenta evidencia para revisión académica. Un porcentaje de similitud, una fuente candidata o un indicador de IA no constituyen por sí solos una conclusión de plagio. La decisión final corresponde a una persona responsable de la evaluación.
