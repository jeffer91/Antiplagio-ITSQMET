import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const failures = [];

function read(path) {
  return readFileSync(join(root, path), 'utf8');
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function walk(dir, files = []) {
  for (const name of readdirSync(join(root, dir))) {
    if (name === 'node_modules' || name === 'dist' || name === 'dist-electron' || name === '.git') continue;
    const absolute = join(root, dir, name);
    const info = statSync(absolute);
    if (info.isDirectory()) walk(relative(root, absolute), files);
    else files.push(relative(root, absolute));
  }
  return files;
}

const app = read('src/App.tsx');
const auth = read('src/auth/AuthContext.tsx');
const studentLogin = read('supabase/functions/student-cedula-login/index.ts');
const documents = read('src/lib/documents.ts');
const browserHtml = read('index.html');
const edgeEnv = read('supabase/functions/.env.example');

assert(app.includes("#/coordinator") || app.includes("surface === 'coordinator'"), 'Falta la ruta funcional del Coordinador.');
assert(auth.includes('signInStudent: (cedula: string, pin: string)'), 'El acceso estudiantil debe exigir cédula + PIN.');
assert(studentLogin.includes('student_pin_credentials'), 'La Edge Function de estudiante no está validando student_pin_credentials.');
assert(browserHtml.includes('rel="icon"') && browserHtml.includes('./favicon.svg'), 'El favicon no está conectado de forma portable.');
assert(edgeEnv.includes('FIREBASE_PROJECT_ID=') && edgeEnv.includes('FIREBASE_API_KEY='), 'Faltan secretos Firebase documentados para Edge Functions.');
assert(edgeEnv.includes('AI_CREDENTIALS_MASTER_KEY='), 'Falta documentar AI_CREDENTIALS_MASTER_KEY.');

const listSelectStart = documents.indexOf(".from('document_versions')");
const listSelectEnd = documents.indexOf(".in('document_id', ids)", listSelectStart);
const listSelect = listSelectStart >= 0 && listSelectEnd > listSelectStart
  ? documents.slice(listSelectStart, listSelectEnd)
  : '';
assert(listSelect && !listSelect.includes('extracted_text') && !listSelect.includes('extracted_pages'), 'El listado de documentos vuelve a descargar el texto completo.');

const secretPatterns = [
  { regex: /AIza[0-9A-Za-z_-]{20,}/g, label: 'Posible Firebase API key hardcodeada' },
  { regex: /sk-[A-Za-z0-9_-]{20,}/g, label: 'Posible API key hardcodeada' },
  { regex: /VITE_[A-Z0-9_]*SERVICE_ROLE/g, label: 'service_role expuesto como VITE_*' },
];

for (const path of walk('.')) {
  if (!/\.(ts|tsx|js|mjs|json|md|sql|yml|yaml|example|html)$/.test(path)) continue;
  const content = read(path);
  for (const { regex, label } of secretPatterns) {
    regex.lastIndex = 0;
    if (regex.test(content)) failures.push(`${label}: ${path}`);
  }
}

if (failures.length) {
  console.error('\nSecurity audit failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Security audit passed.');
