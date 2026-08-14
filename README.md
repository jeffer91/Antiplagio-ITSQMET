# SIAI — Antiplagio ITSQMET

Sistema de Integridad Académica Institucional. Aplicación de escritorio orientada a entregas académicas, similitud, trazabilidad de versiones, revisión bibliográfica e indicadores de uso probable de IA.

## Estado

**Fase 1 — Base de la aplicación**

- Electron con aislamiento del renderer (`contextIsolation`, `sandbox`, sin `nodeIntegration`).
- React + TypeScript + Vite.
- Supabase Auth con correo y contraseña.
- Dos roles: `student` y `coordinator`.
- Toda cuenta creada desde la aplicación nace como `student`.
- El rol de coordinador se asigna únicamente desde la base de datos.
- Row Level Security activa para perfiles.
- Interfaz independiente para estudiante y coordinador.
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

1. Abre el SQL Editor de tu proyecto Supabase.
2. Ejecuta todo el archivo `supabase/schema.sql`.
3. Inicia SIAI y crea tu cuenta.
4. En SQL Editor cambia únicamente tu cuenta a coordinador:

```sql
update public.profiles
set role = 'coordinator'
where email = 'TU_CORREO';
```

Las demás cuentas permanecen como `student`.

## Desarrollo

```powershell
npm run dev
```

Se ejecutan en paralelo Vite, el compilador del proceso Electron y Electron.

## Validar el proyecto

```powershell
npm run typecheck
npm run build
```

## Seguridad de la Fase 1

El permiso no se decide ocultando pantallas. El renderer recibe una clave publicable de Supabase y las políticas RLS determinan qué filas puede leer cada usuario. El cliente no dispone de políticas para insertar, actualizar o eliminar perfiles; por ello un estudiante no puede cambiar su propio rol mediante una llamada directa a la API.

## Estructura

```text
electron/                 Proceso principal y preload seguro
src/
  auth/                   Sesión y perfil
  components/             Componentes compartidos
  lib/                    Cliente Supabase
  pages/                  Pantallas por rol
  types/                  Tipos del dominio
supabase/
  schema.sql              Esquema, trigger y RLS
.github/workflows/ci.yml  Validación automática
```

## Ruta del proyecto

- Fase 1: Electron + React + Supabase + roles ✅
- Fase 2: carga PDF/DOCX + almacenamiento + versiones + extracción
- Fase 3: similitud contra corpus institucional
- Fase 4: visor interactivo de coincidencias
- Fase 5: fuentes académicas y web públicas
- Fase 6: citas, bibliografía y APA 7
- Fase 7: indicadores de escritura asistida por IA
- Fase 8: informes PDF/Excel
- Fase 9: instalador y actualizaciones

## Principio del sistema

SIAI presentará evidencia de similitud e indicadores de posible uso de IA. La decisión académica final corresponde a una persona responsable de la revisión.
