# SIAI — Antiplagio ITSQMET

Sistema de Integridad Académica Institucional. Aplicación de escritorio orientada a entregas académicas, similitud, trazabilidad de versiones, revisión bibliográfica e indicadores de uso probable de IA.

## Estado

**Fase 2 — Ingesta documental**

- Electron con aislamiento del renderer (`contextIsolation`, `sandbox`, sin `nodeIntegration`).
- React + TypeScript + Vite.
- Supabase Auth con roles `student` y `coordinator`.
- Carga de archivos PDF y DOCX de hasta 25 MB.
- Storage privado de Supabase con políticas por propietario.
- Historial de versiones sin reemplazar entregas anteriores.
- Huella SHA-256 por archivo y rechazo de duplicados dentro del mismo trabajo.
- Extracción de texto de PDF mediante PDF.js.
- Extracción de texto de DOCX mediante Mammoth.
- Detección de PDF con poco texto seleccionable y estado `needs_ocr`.
- Vista del coordinador de todas las entregas y del estudiante únicamente de las propias.
- Apertura temporal del original mediante URL firmada.
- CI en GitHub para validar TypeScript y compilación.

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

> No colocar jamás una clave `service_role` en `.env` de Electron. Todo valor `VITE_*` termina disponible para el renderer.

## Preparar Supabase

En un proyecto nuevo:

1. Ejecuta `supabase/schema.sql` en SQL Editor.
2. Ejecuta `supabase/phase2.sql`.
3. Inicia SIAI y crea tu cuenta.
4. Convierte únicamente tu cuenta en coordinador:

```sql
update public.profiles
set role = 'coordinator'
where email = 'TU_CORREO';
```

Las demás cuentas permanecen como `student`.

### Seguridad de documentos

El bucket `academic-documents` es privado. El estudiante puede cargar y abrir archivos únicamente dentro de su carpeta (`auth.uid()`), mientras que el coordinador puede consultar los originales de todos los trabajos. La numeración de versiones se calcula en PostgreSQL mediante `register_document_version`; el cliente no tiene permisos directos de INSERT/UPDATE sobre las tablas documentales.

## Flujo de la Fase 2

```text
Seleccionar PDF/DOCX
        ↓
Validar formato y tamaño
        ↓
Extraer texto localmente
        ↓
Calcular SHA-256
        ↓
Subir original a Storage privado
        ↓
Registrar versión en PostgreSQL
        ↓
Mostrar historial y vista previa del texto
```

Si el registro SQL falla después de la subida, la aplicación elimina el objeto recién subido para evitar archivos huérfanos.

## Desarrollo

```powershell
npm run dev
```

## Validar el proyecto

```powershell
npm run typecheck
npm run build
```

## Estructura

```text
electron/                       Proceso principal y preload seguro
src/
  auth/                         Sesión y perfil
  components/                   Carga, listado e historial documental
  lib/
    supabase.ts                 Cliente Supabase
    documentExtractor.ts        Extracción PDF/DOCX
    documents.ts                Storage, SHA-256 y registro de versiones
  pages/                        Paneles por rol
  types/                        Tipos del dominio
supabase/
  schema.sql                    Fase 1: perfiles y roles
  phase2.sql                    Documentos, versiones, Storage y RLS
.github/workflows/ci.yml        Validación automática
```

## Ruta del proyecto

- Fase 1: Electron + React + Supabase + roles ✅
- Fase 2: carga PDF/DOCX + almacenamiento + versiones + extracción ✅
- Fase 3: similitud contra corpus institucional
- Fase 4: visor interactivo de coincidencias
- Fase 5: fuentes académicas y web públicas
- Fase 6: citas, bibliografía y APA 7
- Fase 7: indicadores de escritura asistida por IA
- Fase 8: informes PDF/Excel
- Fase 9: instalador y actualizaciones

## Principio del sistema

SIAI presentará evidencia de similitud e indicadores de posible uso de IA. La decisión académica final corresponde a una persona responsable de la revisión.
