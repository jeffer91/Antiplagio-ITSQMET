# SIAI — Antiplagio ITSQMET

Sistema de Integridad Académica Institucional. Aplicación Electron orientada a entregas académicas, similitud, trazabilidad de versiones, revisión bibliográfica e indicadores de uso probable de IA.

## Estado

**Fase 3 — Similitud institucional**

- Electron + React + TypeScript + Vite.
- Supabase Auth con roles `student` y `coordinator`.
- PDF y DOCX de hasta 25 MB.
- Storage privado y versiones inmutables.
- SHA-256 por archivo.
- Extracción de texto PDF/DOCX.
- Detección de PDF que requiere OCR.
- Comparación contra todas las versiones disponibles del corpus institucional.
- Exclusión automática de versiones anteriores del mismo trabajo revisado.
- Normalización de texto y shingles de 5 palabras.
- Detección de coincidencias textuales y modificaciones leves conservando suficiente texto común.
- Agrupación por trabajo fuente: si una fuente tiene varias versiones, se conserva la versión con mayor evidencia para no inflar el porcentaje.
- Cálculo de similitud mediante cobertura única de palabras del documento objetivo: un fragmento coincidente con varias fuentes no se suma varias veces.
- Evidencia por fragmento con extracto del trabajo y extracto de la fuente.
- Historial de ejecuciones de análisis.
- El coordinador decide cuándo liberar un resultado al estudiante.
- RLS para impedir que el estudiante consulte análisis no liberados o documentos ajenos.
- CI en GitHub para validar TypeScript y compilación.

## Qué detecta la Fase 3

El motor `siai-internal-shingle-v1` está diseñado para la **similitud interna del ITSQMET**. Detecta principalmente copia textual y modificaciones ligeras donde siguen existiendo secuencias comunes de palabras. El umbral mínimo de evidencia es de 10 palabras y las coincidencias se localizan mediante shingles de 5 palabras.

Esta fase **no afirma detectar paráfrasis semántica profunda ni plagio externo en Internet**. Esas capas se incorporan posteriormente para evitar presentar como resuelto algo que necesita otro tipo de modelos y fuentes.

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
Coordinador abre una versión
        ↓
Analizar similitud interna
        ↓
Normalizar texto y crear fingerprints de 5 palabras
        ↓
Comparar contra el resto del corpus ITSQMET
        ↓
Agrupar fuentes y eliminar doble conteo
        ↓
Guardar porcentaje + fuentes + fragmentos coincidentes
        ↓
Coordinador puede liberar u ocultar el resultado al estudiante
```

Las versiones del mismo trabajo objetivo se excluyen de la comparación para evitar que una V2 obtenga un porcentaje artificialmente alto por coincidir con su propia V1.

## Seguridad

El estudiante puede leer únicamente sus documentos y los análisis que el coordinador haya liberado. Las tablas de similitud no aceptan inserciones directas desde el cliente. La persistencia se realiza mediante `save_internal_similarity_analysis`, que valida en PostgreSQL que el usuario sea coordinador.

El nombre del propietario de una fuente institucional solo se resuelve para quien tenga permiso sobre el perfil; de lo contrario la interfaz muestra `Repositorio institucional`.

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
    SimilarityPanel.tsx          Resultado y evidencia institucional
  lib/
    documentExtractor.ts         Extracción PDF/DOCX
    documents.ts                 Storage y versionamiento
    similarity.ts                Motor de similitud institucional
  types/
    similarity.ts                Tipos del análisis
supabase/
  schema.sql                     Fase 1: perfiles y roles
  phase2.sql                     Documentos, versiones y Storage
  phase3.sql                     Análisis, fuentes, coincidencias y RLS
```

## Ruta del proyecto

- Fase 1: Electron + React + Supabase + roles ✅
- Fase 2: carga PDF/DOCX + almacenamiento + versiones + extracción ✅
- Fase 3: similitud contra corpus institucional ✅
- Fase 4: visor interactivo tipo Turnitin + exclusiones y recálculo
- Fase 5: fuentes académicas y web públicas
- Fase 6: citas, bibliografía y APA 7
- Fase 7: indicadores de escritura asistida por IA
- Fase 8: informes PDF/Excel
- Fase 9: instalador y actualizaciones

## Principio del sistema

SIAI presenta evidencia de similitud e indicadores para revisión académica. La decisión final corresponde a una persona responsable de la evaluación.
