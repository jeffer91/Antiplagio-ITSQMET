# PlagGuard · ITSQMET

Aplicación institucional de integridad académica para gestionar entregas, versiones, intentos y evidencia de similitud del ITSQMET.

## Estado actual

**PlagGuard 1.0**

- Electron + React + TypeScript + Vite.
- Supabase Auth, PostgreSQL, RLS y Storage privado.
- Roles: `student`, `coordinator` y `admin`.
- PDF y DOCX de hasta 25 MB.
- Versiones inmutables y huella SHA-256 del archivo.
- Similitud institucional contra el repositorio final ITSQMET.
- Búsqueda externa con OpenAlex, CORE, Semantic Scholar, Crossref y Brave opcional.
- Revisión de citas, referencias y APA 7.
- Señales estilométricas de escritura asistida para revisión humana; no se presentan como prueba de autoría por IA.
- Similitud consolidada por cobertura única de palabras para evitar doble conteo.
- Intentos Ordinario/Supletorio con trazabilidad completa.
- Informe oficial PDF/Excel exclusivo de Coordinador/Administrador.

## Regla institucional

PlagGuard utiliza como resultado del intento la **similitud consolidada ajustada**.

```text
0 % a 20 %   → Cumple
más de 20 %  → No cumple
```

El porcentaje consolidado no suma simplemente similitud interna + externa. Se calcula sobre las palabras cubiertas, evitando contabilizar dos veces un mismo fragmento encontrado en varias fuentes.

Las citas textuales y bibliografía pueden excluirse del cálculo de forma controlada. Las fuentes externas disponibles solo como abstract, snippet o metadatos pueden mostrarse como evidencia de revisión, pero no aumentan el porcentaje institucional.

## Intentos

Cada estudiante dispone de:

- **Ordinario: 3 intentos**.
- **Supletorio: 3 intentos adicionales**.
- Límite: **20 % en ambos procesos**.

Cada intento queda ligado a una versión concreta del archivo y registra:

- estudiante;
- periodo;
- versión;
- Ordinario o Supletorio;
- número de intento;
- porcentaje consolidado;
- Cumple / No cumple;
- usuario que ejecutó el análisis;
- fecha;
- observación;
- identificadores de los cuatro análisis utilizados.

La primera versión que obtiene **Cumple** cierra el proceso. Los intentos anteriores permanecen en el historial institucional.

Si se agotan los tres intentos Ordinarios sin Cumple, el sistema muestra **Pasa a Supletorio** y genera alertas internas. Los intentos adicionales no se habilitan automáticamente: el **Administrador** debe abrir el Supletorio del periodo.

## Roles

### Estudiante

El estudiante puede:

- cargar su trabajo;
- subir nuevas versiones mientras tenga intentos disponibles;
- ejecutar el análisis completo;
- ver su porcentaje exacto y Cumple/No cumple;
- ver qué fragmentos debe corregir, por qué aparecen y qué acción se recomienda;
- consultar alertas de similitud, citas, referencias, APA 7 y señales de escritura asistida.

El estudiante **no accede al historial completo de intentos** ni al informe oficial institucional.

Cuando una coincidencia proviene del repositorio interno, el estudiante no recibe el nombre, propietario ni texto de la obra institucional utilizada como fuente.

### Coordinador

El Coordinador puede:

- cargar un trabajo en nombre de un estudiante;
- subir nuevas versiones corregidas para el estudiante;
- ejecutar el intento completo;
- consultar el historial completo de versiones e intentos;
- revisar evidencia interna y externa;
- consultar citas, APA y señales de escritura asistida;
- generar el informe oficial cuando una versión obtiene Cumple;
- exportar el informe oficial a PDF y Excel.

Aunque el Coordinador cargue el archivo, **el estudiante permanece como propietario del trabajo**.

### Administrador

El Administrador puede:

- crear y activar periodos;
- abrir/cerrar Ordinario;
- abrir/cerrar Supletorio;
- asignar periodo, carrera y modalidad a estudiantes;
- administrar roles.

La base de datos también dispone de funciones administrativas para controlar la inclusión/exclusión del repositorio institucional; esa gestión avanzada no forma parte todavía del panel visual principal.

## Flujo del estudiante

```text
Administrador asigna periodo + carrera + modalidad
                    ↓
Estudiante carga PDF/DOCX
                    ↓
Extracción + SHA-256 + versión
                    ↓
1. Similitud institucional segura
                    ↓
2. Similitud externa
                    ↓
3. Citas + referencias + APA 7
                    ↓
4. Señales de escritura asistida
                    ↓
Similitud consolidada ajustada
                    ↓
          ≤20 %             >20 %
          Cumple           No cumple
             ↓                 ↓
     proceso cerrado     correcciones +
                         nueva versión
```

## Repositorio institucional

El corpus institucional no contiene todas las cargas intermedias. Solo incorpora la **versión final que obtuvo Cumple**.

La comparación institucional se ejecuta en PostgreSQL para evitar entregar el corpus completo al equipo del estudiante. La lectura de resultados del estudiante está anonimizada.

## Informe oficial

El informe oficial:

- solo puede generarse para una versión que obtuvo **Cumple**;
- exige los cuatro módulos de análisis;
- debe utilizar exactamente los identificadores de análisis registrados en el intento Cumple;
- debe conservar el mismo porcentaje consolidado del intento;
- se almacena como una instantánea inmutable;
- recibe una huella SHA-256 calculada en el servidor;
- se verifica en el servidor antes de permitir exportación;
- los informes históricos solo se consideran verificables si además están ligados a un intento Cumple con la misma evidencia y porcentaje;
- es de uso exclusivo de Coordinador/Administrador.

El estudiante recibe su resultado y correcciones en la interfaz de PlagGuard, no el informe institucional completo.

## Alertas

Las alertas funcionan dentro de PlagGuard:

- contador en la campana;
- listado de alertas pendientes;
- banner visible para la alerta prioritaria;
- actualización automática durante la sesión;
- actualización al volver a enfocar la aplicación;
- alertas de Supletorio ligadas al periodo y al estudiante.

Los avisos de espera de Supletorio se resuelven cuando el Administrador habilita el proceso correspondiente.

## Preparar Supabase

En un proyecto nuevo, ejecuta **una sola vez y en este orden**:

1. `supabase/schema.sql`
2. `supabase/phase2.sql`
3. `supabase/phase3.sql`
4. `supabase/phase4.sql`
5. `supabase/phase5.sql`
6. `supabase/phase6.sql`
7. `supabase/phase7.sql`
8. `supabase/phase8.sql`
9. `supabase/phase9.sql`
10. `supabase/phase10.sql`
11. `supabase/phase11.sql`
12. `supabase/phase12.sql`
13. `supabase/phase13.sql`
14. `supabase/phase14.sql`
15. `supabase/phase15.sql`

Las fases 10 y 12 contienen renombrados de funciones y deben tratarse como migraciones secuenciales, no como scripts para ejecutar repetidamente.

Después asigna al menos una cuenta como Administrador. Por ejemplo:

```sql
update public.profiles
set role = 'admin'
where email = 'TU_CORREO';
```

## Edge Functions

Despliega las tres funciones:

```powershell
supabase functions deploy external-similarity
supabase functions deploy citation-integrity
supabase functions deploy ai-writing-indicators
```

Variables privadas de proveedores se configuran como secretos de Supabase/Edge Functions. Nunca deben almacenarse en Electron.

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

El workflow `.github/workflows/ci.yml` ejecuta instalación, typecheck/build y `deno check` de las tres Edge Functions en cada push a `main` y en cada pull request.

## Importante antes de producción

El código del repositorio y las migraciones deben mantenerse sincronizados. Un cambio en `main` que dependa de una fase nueva de Supabase no queda operativo en una instalación existente hasta aplicar esa migración y, cuando corresponda, desplegar nuevamente las Edge Functions.

La huella SHA-256 del archivo original se calcula actualmente en el cliente antes de la carga. Para una cadena de custodia de nivel forense, queda como endurecimiento futuro verificar también los bytes del archivo en un entorno de servidor controlado.
