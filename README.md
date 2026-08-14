# SIAI — Antiplagio ITSQMET

Sistema de Integridad Académica Institucional. Aplicación Electron orientada a entregas académicas, similitud, trazabilidad de versiones, revisión bibliográfica e indicadores de uso probable de IA.

## Estado

**Fase 4 — Informe interactivo de similitud**

- Electron + React + TypeScript + Vite.
- Supabase Auth con roles `student` y `coordinator`.
- Carga PDF/DOCX, Storage privado, SHA-256 y versiones inmutables.
- Extracción de texto y detección de PDF que requiere OCR.
- Similitud interna contra el corpus ITSQMET.
- Exclusión automática de versiones anteriores del mismo trabajo.
- Motor `siai-internal-shingle-v2` con cobertura exacta de palabras coincidentes.
- Documento completo resaltado por colores según la fuente.
- Fuentes institucionales numeradas y ordenadas por evidencia.
- Navegación desde una fuente o coincidencia hasta el fragmento del documento.
- Diferenciación entre coincidencia textual y coincidencia cercana.
- Exclusión de bibliografía detectada al final del documento.
- Exclusión de citas textuales delimitadas por comillas.
- Exclusión manual de una fuente completa.
- Umbral configurable para ignorar coincidencias pequeñas, entre 10 y 200 palabras.
- Recálculo en tiempo real sin modificar el resultado original del motor.
- Persistencia del porcentaje ajustado y de todos los filtros aplicados.
- El estudiante puede ver únicamente informes liberados y no puede modificar exclusiones.
- CI en GitHub para validar TypeScript y compilación.

## Resultado original vs. resultado ajustado

SIAI conserva siempre dos conceptos distintos:

- **Similitud original:** porcentaje calculado por el motor sobre la evidencia institucional encontrada. No se sobrescribe.
- **Similitud ajustada:** porcentaje resultante después de aplicar las exclusiones definidas por el coordinador.

Esto permite reconstruir por qué un informe pasó, por ejemplo, de `31,4 %` a `18,2 %`, sin perder la evidencia inicial.

## Exclusiones de la Fase 4

El coordinador puede activar o desactivar desde el informe interactivo:

1. Bibliografía.
2. Citas textuales entre comillas.
3. Fuentes institucionales específicas.
4. Coincidencias menores a un número mínimo de palabras.

Los cambios se recalculan inmediatamente en pantalla. Solo se vuelven oficiales cuando el coordinador pulsa **Guardar ajustes**.

La detección de la sección bibliográfica es heurística: SIAI busca encabezados como `Referencias`, `Referencias bibliográficas`, `Bibliografía` o `References` en la parte final del documento. El visor informa si encontró o no esa sección.

## Requisitos

- Node.js 24 o superior.
- Un proyecto Supabase.

## Instalación local

```powershell
git clone https://github.com/jeffer91/Antiplagio-ITSQMET.git
cd Antiplagio-ITSQMET
npm install
Copy-Item .env.example .env
```

Configura `.env`:

```env
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REEMPLAZAR
```

> Nunca coloques una clave `service_role` dentro de Electron. Todo valor `VITE_*` puede terminar disponible para el renderer.

## Preparar Supabase

En un proyecto nuevo ejecuta, en este orden:

1. `supabase/schema.sql`
2. `supabase/phase2.sql`
3. `supabase/phase3.sql`
4. `supabase/phase4.sql`

Después crea tu cuenta y convierte únicamente la cuenta administrativa en coordinador:

```sql
update public.profiles
set role = 'coordinator'
where email = 'TU_CORREO';
```

Las cuentas creadas normalmente permanecen como `student`.

## Flujo actual

```text
Estudiante carga PDF/DOCX
        ↓
Extracción + SHA-256 + almacenamiento privado
        ↓
Versión V1 / V2 / V3...
        ↓
Coordinador ejecuta similitud institucional
        ↓
Resultado original + fuentes + evidencia por palabra
        ↓
Abrir informe interactivo
        ↓
Documento resaltado + fuentes numeradas
        ↓
Excluir bibliografía / citas / fuentes / coincidencias pequeñas
        ↓
Recalcular porcentaje en tiempo real
        ↓
Guardar ajustes
        ↓
Liberar u ocultar el informe al estudiante
```

## Compatibilidad con análisis anteriores

Los análisis creados con `siai-internal-shingle-v1` no almacenaban cobertura exacta por palabra. El visor puede abrirlos y recalcular mediante una aproximación proporcional, pero muestra una advertencia. Para obtener el comportamiento exacto de la Fase 4, ejecuta **Analizar de nuevo** y se generará un análisis `siai-internal-shingle-v2`.

## Seguridad

El resultado original permanece inmutable. La tabla `similarity_adjustments` guarda únicamente filtros y resultado ajustado.

El estudiante:

- solo puede leer sus documentos;
- solo puede leer análisis liberados por el coordinador;
- puede abrir el informe interactivo en modo lectura;
- no puede excluir fuentes, modificar filtros ni guardar ajustes.

La función `save_similarity_adjustment` valida en PostgreSQL que la operación provenga de una cuenta con rol `coordinator`.

## Desarrollo

```powershell
npm run dev
```

## Validar el proyecto

```powershell
npm run typecheck
npm run build
```

## Estructura relevante

```text
src/
  components/
    SimilarityPanel.tsx
    SimilarityReportModal.tsx
  lib/
    documentExtractor.ts
    documents.ts
    similarity.ts
    similarityView.ts
  types/
    similarity.ts
  similarity.css
  phase4.css
supabase/
  schema.sql
  phase2.sql
  phase3.sql
  phase4.sql
```

## Ruta del proyecto

- Fase 1: Electron + React + Supabase + roles ✅
- Fase 2: carga PDF/DOCX + almacenamiento + versiones + extracción ✅
- Fase 3: similitud contra corpus institucional ✅
- Fase 4: visor interactivo + exclusiones + recálculo ✅
- Fase 5: fuentes académicas y web públicas
- Fase 6: citas, bibliografía y APA 7
- Fase 7: indicadores de escritura asistida por IA
- Fase 8: informes PDF/Excel
- Fase 9: instalador y actualizaciones

## Principio del sistema

SIAI presenta evidencia de similitud e indicadores para revisión académica. El porcentaje no representa por sí solo una conclusión de plagio y la decisión final corresponde a una persona responsable de la evaluación.
