# SIAI — Antiplagio ITSQMET

Sistema de Integridad Académica Institucional. Aplicación Electron para entregas académicas, similitud interna y externa, revisión de citas y bibliografía, trazabilidad de versiones e indicadores de escritura asistida por IA.

## Estado

**Fase 7 — Indicadores de escritura asistida por IA**

- Electron + React + TypeScript + Vite.
- Supabase Auth con roles `student` y `coordinator`.
- PDF y DOCX de hasta 25 MB, Storage privado, SHA-256 y versiones inmutables.
- Similitud institucional contra el corpus ITSQMET.
- Informe interactivo con fuentes, exclusiones y porcentaje ajustado.
- Búsqueda externa con OpenAlex, CORE, Semantic Scholar, Crossref y web opcional.
- Revisión de citas, referencias y hallazgos APA 7.
- Indicadores estilométricos por fragmento, separados del porcentaje de similitud.
- Comparación con el estilo interno del documento y, cuando existe suficiente material, con versiones previas del estudiante.
- Revisión humana por fragmento: revisar, solicitar explicación o descartar alerta.
- Las alertas descartadas por el coordinador no se muestran al estudiante cuando se libera el informe.
- CI valida la aplicación y las tres Edge Functions con TypeScript/Deno.

## Principio de la Fase 7

SIAI **no presenta el índice de IA como una probabilidad de autoría**. Un resultado como `74/100` significa que el fragmento reúne varias señales que justifican revisión; no significa “74 % de probabilidad de que ChatGPT lo haya escrito”.

El motor `siai-ai-evidence-v1` trabaja así:

```text
Documento
   ↓
Excluir bibliografía y reducir el peso de citas textuales largas
   ↓
Dividir el cuerpo en fragmentos de tamaño comparable
   ↓
Extraer rasgos estilométricos
   ↓
Comparar cada fragmento con el resto del documento
   ↓
Comparar con versiones previas del estudiante cuando existen
   ↓
Combinar señales independientes
   ↓
Índice de evidencia + fragmentos señalados
   ↓
Revisión humana del coordinador
```

## Señales utilizadas

La primera versión del motor combina, entre otras:

- **Cambio de estilo dentro del documento:** distancia entre un fragmento y el patrón estilométrico general del texto.
- **Diferencia frente al historial del estudiante:** se activa cuando hay suficiente texto en versiones anteriores.
- **Uniformidad de longitud de oraciones:** identifica segmentos con una regularidad inusual respecto del resto.
- **Repetición de secuencias:** mide repetición de trigramas dentro del fragmento.
- **Conectores formulaicos:** frecuencia de expresiones académicas muy repetitivas.
- **Inicio repetitivo de oraciones:** regularidad en la apertura de las frases.
- **Novedad frente a la versión anterior:** aporta contexto cuando aparece un bloque completamente nuevo; por sí sola no eleva una acusación.

Una señal aislada no genera automáticamente un nivel alto. El motor exige varias señales fuertes y al menos una diferencia estilométrica relevante para clasificar un fragmento como **evidencia alta**.

## Niveles

- **Baja:** el fragmento no reúne evidencia suficiente para priorizarlo.
- **Media:** conviene una revisión humana.
- **Alta:** varias señales independientes coinciden y el fragmento merece una revisión prioritaria.

El informe muestra también el porcentaje de palabras que pertenecen a fragmentos de evidencia media o alta. Ese porcentaje es independiente de la similitud institucional y externa.

## Línea base del estudiante

SIAI intenta construir una línea base con hasta seis versiones previas accesibles del mismo estudiante. Si dispone de al menos una cantidad mínima de texto útil, compara los fragmentos actuales con ese historial.

Si no existe suficiente historial, usa el patrón interno del propio documento. El informe indica claramente cuál de estos estados se utilizó:

- `student_history`
- `document_internal`
- `limited`

## Revisión humana

Cada fragmento señalado permite al coordinador elegir:

- **Sin revisar**
- **Revisar**
- **Solicitar explicación**
- **Descartar alerta**

También puede registrar una observación interna. Las decisiones quedan persistidas en Supabase.

Cuando una alerta se marca como **Descartar alerta**, el estudiante no la recibe en el informe liberado. Esto permite corregir falsos positivos antes de compartir el resultado.

## Privacidad

La Fase 7 no necesita enviar el documento a un proveedor externo de “detección de IA”. El análisis estilométrico se ejecuta dentro de la Edge Function `ai-writing-indicators` con los textos ya almacenados en Supabase.

El estudiante:

- solo puede leer sus propios documentos;
- no puede ejecutar el análisis de IA;
- no puede cambiar índices o decisiones del coordinador;
- solo puede ver el informe cuando el coordinador lo libera;
- no ve alertas descartadas por revisión humana.

## Preparar Supabase

En un proyecto nuevo ejecuta, en este orden:

1. `supabase/schema.sql`
2. `supabase/phase2.sql`
3. `supabase/phase3.sql`
4. `supabase/phase4.sql`
5. `supabase/phase5.sql`
6. `supabase/phase6.sql`
7. `supabase/phase7.sql`

Después convierte únicamente la cuenta administrativa en coordinador:

```sql
update public.profiles
set role = 'coordinator'
where email = 'TU_CORREO';
```

## Edge Functions

Para las fases de búsqueda externa y bibliografía, configura los secretos necesarios según `supabase/functions/.env.example`.

Despliega las tres funciones actuales:

```powershell
supabase functions deploy external-similarity
supabase functions deploy citation-integrity
supabase functions deploy ai-writing-indicators
```

`ai-writing-indicators` no requiere una clave privada de un proveedor de detección de IA.

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
Citas + bibliografía + APA 7
        ↓
Indicadores de escritura asistida por IA
        ↓
Revisión humana por fragmento
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
deno check supabase/functions/external-similarity/index.ts supabase/functions/citation-integrity/index.ts supabase/functions/ai-writing-indicators/index.ts
```

## Estructura relevante

```text
src/
  components/
    SimilarityPanel.tsx
    SimilarityReportModal.tsx
    ExternalSimilarityPanel.tsx
    CitationIntegrityPanel.tsx
    AiWritingPanel.tsx
  lib/
    documents.ts
    similarity.ts
    similarityView.ts
    externalSimilarity.ts
    citationIntegrity.ts
    aiWriting.ts
  types/
    similarity.ts
    externalSimilarity.ts
    citationIntegrity.ts
    aiWriting.ts
  phase4.css
  external.css
  phase6.css
  phase7.css
supabase/
  schema.sql
  phase2.sql
  phase3.sql
  phase4.sql
  phase5.sql
  phase6.sql
  phase7.sql
  functions/
    external-similarity/index.ts
    citation-integrity/index.ts
    ai-writing-indicators/index.ts
```

## Ruta del proyecto

- Fase 1: Electron + React + Supabase + roles ✅
- Fase 2: carga PDF/DOCX + almacenamiento + versiones + extracción ✅
- Fase 3: similitud contra corpus institucional ✅
- Fase 4: visor interactivo + exclusiones + recálculo ✅
- Fase 5: fuentes académicas y web públicas ✅
- Fase 6: citas + referencias + verificación bibliográfica + APA 7 ✅
- Fase 7: indicadores de escritura asistida por IA + revisión humana ✅
- Fase 8: informes PDF/Excel
- Fase 9: instalador y actualizaciones

## Principio del sistema

SIAI presenta evidencia para revisión académica. Ningún porcentaje, referencia no localizada o indicador automático constituye por sí solo una conclusión de plagio, fabricación de fuentes o uso indebido de inteligencia artificial. La decisión final corresponde a la persona responsable de la evaluación.
