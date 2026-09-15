# PlagGuard · ITSQMET

Aplicación institucional de integridad académica para gestionar entregas, versiones, intentos, similitud, revisión académica y trazabilidad del ITSQMET.

## Estado actual

**PlagGuard 1.0**

- Electron + React + TypeScript + Vite.
- Supabase Auth, PostgreSQL, RLS y Storage privado.
- Roles: `student`, `coordinator` y `admin`.
- Accesos separados: `#/student`, `#/coordinator` y `#/admin`.
- Estudiante: cédula + PIN institucional de 6 dígitos.
- Administrador: cédula + PIN administrativo.
- Coordinador: correo institucional + contraseña generable desde Administración.
- PDF y DOCX de hasta 25 MB.
- Versiones inmutables y huella SHA-256 del archivo.
- Similitud institucional contra el repositorio final ITSQMET.
- Búsqueda externa con OpenAlex, CORE, Semantic Scholar, Crossref y Brave opcional.
- Revisión de citas, referencias y APA 7.
- Señales estilométricas de escritura asistida para revisión humana; no se presentan como prueba de autoría por IA.
- Revisión global multi-modelo con consenso, credenciales cifradas y habilitación institucional explícita.
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

Cada intento queda ligado a una versión concreta del archivo y conserva estudiante, periodo, versión, proceso, número de intento, porcentaje consolidado, Cumple/No cumple, ejecutor, fecha, observación y procedencia de los análisis utilizados.

La primera versión que obtiene **Cumple** cierra el proceso. Los intentos anteriores permanecen en el historial institucional. Si se agotan los tres intentos Ordinarios sin Cumple, el sistema muestra **Pasa a Supletorio** y genera alertas internas. Los intentos adicionales se habilitan cuando el Administrador abre el Supletorio del periodo.

## Roles y acceso

### Estudiante

El estudiante ingresa por `#/student` con su cédula y un PIN institucional de 6 dígitos. El PIN es emitido o restablecido por Administración y se almacena únicamente como hash PBKDF2 en servidor. Cinco intentos fallidos consecutivos bloquean temporalmente la credencial.

Puede cargar su trabajo, subir nuevas versiones mientras tenga intentos disponibles, ejecutar el análisis completo, ver el porcentaje y estado, y recibir correcciones de similitud, citas, APA 7 y señales de escritura asistida. No accede al historial institucional completo ni al informe oficial.

Cuando una coincidencia proviene del repositorio interno, el estudiante no recibe el nombre, propietario ni texto completo de la obra institucional utilizada como fuente.

### Coordinador

El Coordinador ingresa por `#/coordinator` con correo institucional y contraseña. Administración puede generar o restablecer una clave temporal después de asignar el rol Coordinador. Puede cargar trabajos en nombre de estudiantes, subir nuevas versiones, ejecutar intentos, consultar historial completo, revisar evidencias y generar/exportar el informe oficial cuando corresponde. Aunque el Coordinador cargue el archivo, el estudiante permanece como propietario.

### Administrador

El Administrador ingresa por `#/admin` con cédula y PIN. Puede abrir/cerrar Ordinario y Supletorio, administrar roles, consultar el padrón institucional, emitir/restablecer PIN de estudiantes, generar accesos de Coordinador y configurar/probar los modelos IA.

Los periodos, carrera y modalidad provienen de Firebase UTET. PlagGuard conserva una copia operativa y controla el estado de los procesos, pero no debe convertirse en una segunda fuente manual de la información académica institucional.

## Flujo del estudiante

```text
Administrador emite PIN de acceso
                    ↓
Estudiante ingresa con cédula + PIN
                    ↓
Firebase UTET vincula periodo + carrera + modalidad
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
Registro del intento institucional
                    ↓
Revisión académica multi-modelo (si está habilitada)
                    ↓
          ≤20 %             >20 %
          Cumple           No cumple
             ↓                 ↓
     proceso cerrado     correcciones +
                         nueva versión
```

La revisión IA no puede modificar el porcentaje oficial de similitud. Si los proveedores IA fallan o la revisión externa está deshabilitada, el intento antiplagio ya registrado se conserva.

## Privacidad de la revisión IA externa

La revisión multi-modelo es una capa adicional y **no se activa implícitamente**. El servidor exige `AI_EXTERNAL_REVIEW_ENABLED=true`. Antes de habilitarla debe existir aprobación institucional sobre el tratamiento de contenido académico con proveedores externos.

Como defensa adicional, el servidor elimina del texto enviado patrones de correo electrónico, teléfono y números de identificación expresamente rotulados, no envía el nombre original del archivo y solo permite endpoints HTTPS de proveedores autorizados. Estas medidas reducen exposición accidental, pero no sustituyen la política institucional de tratamiento de datos.

## Repositorio institucional

El corpus institucional no contiene cargas intermedias. Solo incorpora la **versión final que obtuvo Cumple**. La comparación institucional se ejecuta en PostgreSQL para evitar entregar el corpus completo al equipo del estudiante.

## Informe oficial

El informe oficial solo puede generarse para una versión que obtuvo **Cumple**, exige los módulos de análisis correspondientes, utiliza los identificadores registrados en el intento, conserva el mismo porcentaje consolidado, se almacena como instantánea inmutable, recibe huella SHA-256 de servidor y se verifica antes de exportarse. Es de uso exclusivo de Coordinador/Administrador.

## Alertas

Las alertas incluyen contador, listado de pendientes, banner prioritario, actualización periódica y actualización al recuperar el foco. Las alertas de espera de Supletorio se resuelven cuando Administración habilita el proceso.

## Preparar Supabase

En un proyecto nuevo, ejecuta **una sola vez y en este orden** los scripts existentes:

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
phase30.sql
```

No existe `phase17.sql`; no debe inventarse ni saltarse el orden de los archivos que sí existen. Las fases con renombrados o cambios de funciones deben tratarse como migraciones secuenciales, no como scripts para ejecutar repetidamente.

## Edge Functions

Despliega las funciones utilizadas por la instalación actual:

```powershell
supabase functions deploy student-cedula-login
supabase functions deploy student-access-admin
supabase functions deploy staff-access-admin
supabase functions deploy admin-pin-login
supabase functions deploy sync-firebase-periods
supabase functions deploy external-similarity
supabase functions deploy citation-integrity
supabase functions deploy ai-writing-indicators
supabase functions deploy article-review
supabase functions deploy ai-admin
```

`bootstrap-admin` y `bootstrap-admin-pin` permanecen deshabilitadas en código y no forman parte del flujo operativo normal.

## Secretos de Edge Functions

Configura los valores de `supabase/functions/.env.example` como secretos del proyecto. En especial:

```env
FIREBASE_PROJECT_ID=
FIREBASE_API_KEY=
AI_CREDENTIALS_MASTER_KEY=
AI_EXTERNAL_REVIEW_ENABLED=false
```

`AI_CREDENTIALS_MASTER_KEY` debe tener al menos 32 caracteres, ser aleatoria e independiente de `SUPABASE_SERVICE_ROLE_KEY`. Ya no existe respaldo criptográfico usando `service_role`. Las credenciales de modelos IA se cifran y nunca se leen directamente desde el navegador.

Cambia `AI_EXTERNAL_REVIEW_ENABLED` a `true` solamente después de aprobar institucionalmente el uso de los proveedores externos. Los endpoints personalizados quedan restringidos por base de datos y por las Edge Functions a HTTPS y a Google Gemini, Groq, OpenRouter, Cohere y Cloudflare.

## Variables del renderer

```env
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REEMPLAZAR
```

Nunca coloques `service_role`, claves Firebase privadas ni claves de proveedores en `VITE_*`.

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
npm run audit:security
npm run typecheck
npm run build
```

El CI ejecuta la auditoría de regresiones de seguridad, el typecheck/build y `deno check` de todas las Edge Functions operativas.

## Importante antes de producción

El código, las migraciones y las Edge Functions deben mantenerse sincronizados. Un cambio de frontend que dependa de `phase30.sql` no queda operativo hasta aplicar la migración, configurar los secretos y desplegar las Edge Functions correspondientes.

Antes de habilitar el módulo multi-modelo, aplica `phase29.sql` y `phase30.sql`, configura `AI_CREDENTIALS_MASTER_KEY`, carga las claves de proveedor desde Administración, prueba cada modelo y define explícitamente `AI_EXTERNAL_REVIEW_ENABLED=true` solo cuando proceda. No guardes claves API en GitHub.

La huella SHA-256 del archivo original se calcula actualmente en el cliente antes de la carga. Para una cadena de custodia de nivel forense, queda como endurecimiento futuro verificar también los bytes del archivo en un entorno de servidor controlado.
