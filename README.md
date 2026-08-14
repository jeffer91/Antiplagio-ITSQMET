# SIAI — Antiplagio ITSQMET

Sistema de Integridad Académica Institucional. Aplicación Electron para entregas académicas, similitud interna y externa, revisión de citas y bibliografía, indicadores de escritura asistida por IA e informes finales verificables.

## Estado

**Fase 8 — Informes finales PDF y Excel**

- Electron + React + TypeScript + Vite.
- Supabase Auth con roles `student` y `coordinator`.
- PDF y DOCX de hasta 25 MB, Storage privado, SHA-256 y versiones inmutables.
- Similitud institucional contra el corpus ITSQMET.
- Informe interactivo con exclusiones y porcentaje ajustado.
- Búsqueda externa con OpenAlex, CORE, Semantic Scholar, Crossref y web opcional.
- Revisión de citas, referencias y hallazgos APA 7.
- Indicadores estilométricos por fragmento y revisión humana.
- Informe final consolidado con estado, observación del coordinador y trazabilidad de los análisis utilizados.
- Exportación a PDF mediante `webContents.printToPDF` de Electron.
- Exportación para Excel mediante SpreadsheetML compatible con Excel (`.xls`).
- Instantáneas de informe inmutables, versionadas y selladas con SHA-256.
- El estudiante solo puede abrir y descargar informes finales liberados por el coordinador.
- CI valida la aplicación y las tres Edge Functions con TypeScript/Deno.

## Principio de la Fase 8

El informe final no recalcula ni sobrescribe la evidencia histórica. Cuando el coordinador crea un informe, SIAI toma una **instantánea** de los últimos análisis accesibles de esa versión:

```text
Versión del estudiante
        ↓
Similitud institucional + ajustes
        ↓
Similitud externa verificada
        ↓
Citas + referencias + APA 7
        ↓
Indicadores de escritura asistida por IA
        ↓
Cobertura consolidada sin doble conteo
        ↓
Estado + observación del coordinador
        ↓
Instantánea JSON + SHA-256
        ↓
PDF / Excel / liberación al estudiante
```

Si después se ejecuta un análisis nuevo o cambia una exclusión, el informe anterior **no se modifica**. El coordinador crea el Informe #2, #3, etc.

## Similitud consolidada

SIAI no suma porcentajes internos y externos.

Si las palabras 200–250 aparecen tanto en un trabajo del repositorio ITSQMET como en una publicación pública, esa cobertura se contabiliza una sola vez.

El informe conserva:

- similitud consolidada original;
- similitud consolidada ajustada;
- similitud institucional original;
- similitud institucional ajustada;
- similitud externa verificada.

Para la consolidada ajustada se reutilizan los filtros guardados en el análisis institucional: exclusión de bibliografía, citas textuales y coincidencias pequeñas. Las exclusiones de fuentes institucionales se respetan únicamente sobre las fuentes institucionales correspondientes.

## Contenido del PDF

El PDF incluye:

1. identificación del estudiante, trabajo, versión y archivo;
2. SHA-256 del archivo original;
3. resultado/estado definido por el coordinador;
4. observación final;
5. resumen ejecutivo de indicadores;
6. similitud institucional y fuentes;
7. similitud externa verificada y fuentes;
8. citas, referencias y APA 7;
9. indicadores de escritura asistida por IA no descartados;
10. identificadores de los análisis utilizados;
11. SHA-256 de la instantánea del informe;
12. nota de interpretación académica.

El PDF se genera localmente desde Electron y se guarda en la ubicación elegida por el usuario.

## Excel

La exportación genera un libro SpreadsheetML compatible con Microsoft Excel con hojas separadas:

- `Resumen`
- `Similitud interna`
- `Fuentes externas`
- `Citas y APA`
- `Referencias`
- `Indicadores IA`

No se añade una dependencia pesada de terceros para esta fase: el archivo se produce desde SIAI y se guarda mediante el proceso principal de Electron.

## Integridad del informe

Cada instantánea almacena:

```text
report_number
report_schema_version
final_status
final_observation
snapshot
snapshot_sha256
created_at
released_to_student
```

Antes de permitir una descarga, el renderer vuelve a canonicalizar la instantánea y recalcula SHA-256. Si la huella no coincide, SIAI bloquea la exportación.

## Privacidad

El informe final destinado al estudiante no expone el nombre del propietario de un trabajo institucional coincidente. Las fuentes internas aparecen como **Repositorio institucional ITSQMET**.

Las alertas de IA marcadas por el coordinador como **Descartar alerta** tampoco forman parte de la instantánea final.

El estudiante:

- solo accede a sus propios documentos;
- no crea informes finales;
- no cambia el resultado final;
- no modifica la instantánea;
- solo descarga un informe cuando el coordinador lo libera.

## Estados del informe

El coordinador puede guardar cada instantánea con uno de estos estados:

- Pendiente de decisión
- Aprobado
- Con observaciones
- Requiere corrección
- No aprobado

El estado forma parte de la instantánea histórica. Para cambiarlo posteriormente se genera un informe nuevo.

## Preparar Supabase

En un proyecto nuevo ejecuta, en este orden:

1. `supabase/schema.sql`
2. `supabase/phase2.sql`
3. `supabase/phase3.sql`
4. `supabase/phase4.sql`
5. `supabase/phase5.sql`
6. `supabase/phase6.sql`
7. `supabase/phase7.sql`
8. `supabase/phase8.sql`

Después convierte únicamente la cuenta administrativa en coordinador:

```sql
update public.profiles
set role = 'coordinator'
where email = 'TU_CORREO';
```

## Edge Functions

Despliega las tres funciones actuales:

```powershell
supabase functions deploy external-similarity
supabase functions deploy citation-integrity
supabase functions deploy ai-writing-indicators
```

La Fase 8 no agrega una Edge Function nueva: la consolidación del snapshot utiliza datos protegidos por RLS y la exportación PDF/Excel se realiza en Electron.

## Flujo actual

```text
Estudiante carga PDF/DOCX
        ↓
Extracción + SHA-256 + versiones
        ↓
Similitud interna ITSQMET
        ↓
Exclusiones + recálculo
        ↓
Búsqueda externa pública
        ↓
Citas + bibliografía + APA 7
        ↓
Indicadores de escritura asistida por IA
        ↓
Revisión humana
        ↓
Informe final versionado + SHA-256
        ↓
PDF / Excel
        ↓
Coordinador libera al estudiante
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
    IntegrityReportPanel.tsx
  lib/
    similarity.ts
    similarityView.ts
    externalSimilarity.ts
    citationIntegrity.ts
    aiWriting.ts
    integrityReport.ts
  types/
    similarity.ts
    externalSimilarity.ts
    citationIntegrity.ts
    aiWriting.ts
    integrityReport.ts
    desktop.d.ts
  phase8.css
electron/
  main.ts
  preload.ts
supabase/
  phase8.sql
```

## Ruta del proyecto

- Fase 1: Electron + React + Supabase + roles ✅
- Fase 2: carga PDF/DOCX + almacenamiento + versiones + extracción ✅
- Fase 3: similitud contra corpus institucional ✅
- Fase 4: visor interactivo + exclusiones + recálculo ✅
- Fase 5: fuentes académicas y web públicas ✅
- Fase 6: citas + referencias + verificación bibliográfica + APA 7 ✅
- Fase 7: indicadores de escritura asistida por IA + revisión humana ✅
- Fase 8: informes finales PDF/Excel + snapshot SHA-256 ✅
- Fase 9: instalador y actualizaciones

## Principio del sistema

SIAI presenta evidencia para revisión académica. Ningún porcentaje, referencia no localizada o indicador automático constituye por sí solo una conclusión de plagio, fabricación de fuentes o uso indebido de inteligencia artificial. La decisión final corresponde a la persona responsable de la evaluación.
