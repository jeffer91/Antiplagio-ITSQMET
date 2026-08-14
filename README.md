# SIAI — Antiplagio ITSQMET

Sistema de Integridad Académica Institucional. Aplicación Electron para entregas académicas, similitud interna y externa, revisión de citas y bibliografía, trazabilidad de versiones e indicadores de uso probable de IA.

## Estado

**Fase 6 — Citas, referencias y APA 7**

- Electron + React + TypeScript + Vite.
- Supabase Auth con roles `student` y `coordinator`.
- PDF y DOCX de hasta 25 MB, Storage privado, SHA-256 y versiones inmutables.
- Extracción de texto y detección de PDF que requiere OCR.
- Similitud institucional contra el corpus ITSQMET.
- Informe interactivo con texto resaltado, fuentes numeradas, exclusiones y porcentaje ajustado.
- Búsqueda externa mediante Edge Function con OpenAlex, CORE, Semantic Scholar, Crossref y búsqueda web opcional.
- Fuentes externas no verificables se muestran como candidatos y no aumentan el porcentaje.
- Revisión de citas autor-fecha contra la bibliografía del documento.
- Detección de citas sin referencia, citas ambiguas y referencias no citadas.
- Verificación bibliográfica mediante Crossref y OpenAlex.
- Clasificación de referencias como `verified`, `probable`, `not_found` o `incomplete`.
- Detección de DOI, título, autor y año para contrastar metadatos.
- Hallazgos APA 7: campos faltantes, DOI no canónico, posibles duplicados y orden alfabético.
- El estudiante solo puede ver los análisis que el coordinador libera.
- CI valida la aplicación y las Edge Functions con TypeScript/Deno.

## Principio de la Fase 6

SIAI separa tres conceptos que no deben confundirse:

1. **Existencia de la fuente:** una referencia puede verificarse contra registros públicos.
2. **Relación cita ↔ referencia:** una cita del cuerpo debe poder enlazarse con una entrada de la bibliografía.
3. **Formato APA:** una fuente puede existir y estar bien citada, pero tener problemas de formato.

Una referencia marcada como **No localizada** significa que SIAI no encontró una coincidencia suficientemente fiable en los servicios consultados. No constituye por sí sola una conclusión de que la referencia haya sido inventada.

## Revisión bibliográfica

La Edge Function `citation-integrity`:

```text
Documento
   ↓
Detectar sección Referencias / Bibliografía
   ↓
Separar y parsear referencias
   ↓
Detectar citas autor-fecha en el cuerpo
   ↓
Vincular cita ↔ referencia por autor + año
   ↓
Consultar Crossref
   ↓
Consultar OpenAlex como apoyo cuando está configurado
   ↓
Comparar título + autor + año + DOI
   ↓
Guardar verificación + hallazgos APA
```

### Estados de una referencia

- **Verificada:** existe una coincidencia bibliográfica de alta confianza.
- **Coincidencia probable:** existe una candidata razonable, pero debe revisarse manualmente.
- **No localizada:** los servicios respondieron, pero no apareció una coincidencia suficientemente fiable.
- **No verificable:** faltan datos o los servicios no estuvieron disponibles.

## APA 7 en esta fase

SIAI puede señalar automáticamente:

- autor no identificable;
- año ausente;
- título no identificable;
- DOI escrito en un formato distinto de `https://doi.org/...`;
- posible referencia duplicada;
- bibliografía posiblemente fuera de orden alfabético;
- encabezado de bibliografía no detectado.

La extracción de texto no conserva todos los atributos visuales del documento, por lo que esta fase **no afirma comprobar sangría francesa, cursivas, interlineado o tipografía**. Esos elementos requieren análisis de formato del archivo original y no se califican como correctos o incorrectos a partir del texto plano.

## Citas dentro del texto

Actualmente se detectan principalmente patrones autor-fecha del tipo:

```text
(Pérez, 2024)
(Pérez & Gómez, 2024)
(Pérez et al., 2024)
Pérez (2024)
```

También se separan varias citas dentro del mismo paréntesis cuando están delimitadas por punto y coma.

El enlace se realiza por autor principal + año. Si existen dos referencias con la misma combinación y no puede determinarse una sola, la cita queda como **ambigua** y se solicita revisión manual.

## Fuentes de verificación

### Crossref

Es el verificador bibliográfico principal. Si la referencia contiene DOI, se intenta resolver directamente. Si no, SIAI realiza una búsqueda bibliográfica y compara metadatos.

`CROSSREF_MAILTO` es opcional y permite identificar las solicitudes institucionales.

### OpenAlex

Se usa como segundo verificador cuando `OPENALEX_API_KEY` está configurado. SIAI busca por título y compara autor, año, DOI y similitud del título.

## Privacidad y seguridad

Las claves de proveedores nunca se guardan en variables `VITE_*` ni dentro del renderer de Electron.

La revisión bibliográfica se ejecuta en Supabase Edge Functions. El estudiante:

- solo puede leer sus propios documentos;
- no puede iniciar la verificación bibliográfica;
- no puede cambiar resultados ni estados;
- solo puede ver el informe cuando el coordinador lo libera.

## Preparar Supabase

En un proyecto nuevo ejecuta, en este orden:

1. `supabase/schema.sql`
2. `supabase/phase2.sql`
3. `supabase/phase3.sql`
4. `supabase/phase4.sql`
5. `supabase/phase5.sql`
6. `supabase/phase6.sql`

Después crea tu cuenta y convierte únicamente la cuenta administrativa en coordinador:

```sql
update public.profiles
set role = 'coordinator'
where email = 'TU_CORREO';
```

Las cuentas creadas desde la aplicación permanecen como `student`.

## Configurar Edge Functions

Los secretos esperados están documentados en:

```text
supabase/functions/.env.example
```

Ejemplo:

```powershell
supabase secrets set OPENALEX_API_KEY="TU_CLAVE"
supabase secrets set CORE_API_KEY="TU_CLAVE"
supabase secrets set SEMANTIC_SCHOLAR_API_KEY="TU_CLAVE"
supabase secrets set BRAVE_SEARCH_API_KEY="TU_CLAVE"
supabase secrets set CROSSREF_MAILTO="correo@institucion.edu.ec"
```

Despliega las dos funciones actuales:

```powershell
supabase functions deploy external-similarity
supabase functions deploy citation-integrity
```

## Flujo actual

```text
Estudiante carga PDF/DOCX
        ↓
Extracción + SHA-256 + versiones
        ↓
Similitud interna ITSQMET
        ↓
Informe interactivo + exclusiones
        ↓
Búsqueda externa pública
        ↓
Revisión de citas y bibliografía
        ↓
Crossref / OpenAlex
        ↓
Citas sin referencia + referencias no citadas
        ↓
Hallazgos APA 7
        ↓
Coordinador libera u oculta cada informe
```

## Desarrollo

```powershell
git clone https://github.com/jeffer91/Antiplagio-ITSQMET.git
cd Antiplagio-ITSQMET
npm install
Copy-Item .env.example .env
npm run dev
```

Configura `.env` del renderer solo con valores publicables:

```env
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REEMPLAZAR
```

Nunca coloques una clave `service_role` o claves privadas de proveedores dentro de Electron.

## Validación

```powershell
npm run typecheck
npm run build
```

GitHub Actions también ejecuta:

```text
deno check supabase/functions/external-similarity/index.ts supabase/functions/citation-integrity/index.ts
```

## Estructura relevante

```text
src/
  components/
    SimilarityPanel.tsx
    SimilarityReportModal.tsx
    ExternalSimilarityPanel.tsx
    CitationIntegrityPanel.tsx
  lib/
    documents.ts
    similarity.ts
    similarityView.ts
    externalSimilarity.ts
    citationIntegrity.ts
  types/
    similarity.ts
    externalSimilarity.ts
    citationIntegrity.ts
  phase4.css
  external.css
  phase6.css
supabase/
  schema.sql
  phase2.sql
  phase3.sql
  phase4.sql
  phase5.sql
  phase6.sql
  functions/
    external-similarity/index.ts
    citation-integrity/index.ts
```

## Ruta del proyecto

- Fase 1: Electron + React + Supabase + roles ✅
- Fase 2: carga PDF/DOCX + almacenamiento + versiones + extracción ✅
- Fase 3: similitud contra corpus institucional ✅
- Fase 4: visor interactivo + exclusiones + recálculo ✅
- Fase 5: fuentes académicas y web públicas ✅
- Fase 6: citas + referencias + verificación bibliográfica + APA 7 ✅
- Fase 7: indicadores de escritura asistida por IA
- Fase 8: informes PDF/Excel
- Fase 9: instalador y actualizaciones

## Principio del sistema

SIAI presenta evidencia para revisión académica. Ningún porcentaje, referencia no localizada o indicador automático constituye por sí solo una conclusión de plagio, fabricación de fuentes o uso indebido de inteligencia artificial. La decisión final corresponde a la persona responsable de la evaluación.
