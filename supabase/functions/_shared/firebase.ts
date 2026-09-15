export type UnknownRecord = Record<string, unknown>;

const STUDENT_COLLECTIONS = ['Estudiante', 'Estudiantes'];

function firebaseConfig(): { projectId: string; apiKey: string } {
  const projectId = (Deno.env.get('FIREBASE_PROJECT_ID') || '').trim();
  const apiKey = (Deno.env.get('FIREBASE_API_KEY') || '').trim();
  if (!projectId || !apiKey) {
    throw new Error('Firebase UTET no está configurado en los secretos del servidor.');
  }
  return { projectId, apiKey };
}

export function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function unwrapValue(value: UnknownRecord | undefined): unknown {
  if (!value) return null;
  if ('stringValue' in value) return String(value.stringValue ?? '');
  if ('booleanValue' in value) return Boolean(value.booleanValue);
  if ('integerValue' in value) return Number(value.integerValue ?? 0);
  if ('doubleValue' in value) return Number(value.doubleValue ?? 0);
  if ('timestampValue' in value) return String(value.timestampValue ?? '');
  if ('referenceValue' in value) return String(value.referenceValue ?? '');
  if ('nullValue' in value) return null;
  if ('mapValue' in value) {
    const fields = (value.mapValue as UnknownRecord | undefined)?.fields as UnknownRecord | undefined;
    return unwrapFields(fields);
  }
  if ('arrayValue' in value) {
    const values = ((value.arrayValue as UnknownRecord | undefined)?.values as UnknownRecord[] | undefined) ?? [];
    return values.map((item) => unwrapValue(item));
  }
  return null;
}

function unwrapFields(fields: UnknownRecord | undefined): UnknownRecord {
  const result: UnknownRecord = {};
  for (const [key, raw] of Object.entries(fields ?? {})) {
    result[key] = unwrapValue(raw as UnknownRecord);
  }
  return result;
}

export function flatten(record: unknown, prefix = ''): Array<{ path: string; value: unknown }> {
  if (Array.isArray(record)) {
    return record.flatMap((value, index) => flatten(value, prefix ? `${prefix}.${index}` : String(index)));
  }
  if (record && typeof record === 'object') {
    return Object.entries(record as UnknownRecord).flatMap(([key, value]) =>
      flatten(value, prefix ? `${prefix}.${key}` : key)
    );
  }
  return [{ path: prefix.toLowerCase(), value: record }];
}

function containsExactValue(record: UnknownRecord, expected: string): boolean {
  return flatten(record).some(({ value }) => clean(value) === expected);
}

export async function firestoreDocument(collection: string, documentId: string): Promise<UnknownRecord | null> {
  const { projectId, apiKey } = firebaseConfig();
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${encodeURIComponent(collection)}/${encodeURIComponent(documentId)}?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (response.status === 404) return null;
  if (!response.ok) {
    console.error('Firestore GET', collection, response.status);
    return null;
  }
  const payload = await response.json();
  return unwrapFields(payload.fields);
}

async function queryByField(collection: string, field: string, value: string): Promise<UnknownRecord | null> {
  const { projectId, apiKey } = firebaseConfig();
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:runQuery?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(12_000),
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: collection }],
        where: {
          fieldFilter: {
            field: { fieldPath: field },
            op: 'EQUAL',
            value: { stringValue: value },
          },
        },
        limit: 3,
      },
    }),
  });
  if (!response.ok) return null;
  const payload = await response.json();
  const row = Array.isArray(payload) ? payload.find((item) => item?.document?.fields) : null;
  return row?.document?.fields ? unwrapFields(row.document.fields) : null;
}

async function listCollectionForCedula(collection: string, cedula: string): Promise<UnknownRecord | null> {
  const { projectId, apiKey } = firebaseConfig();
  let pageToken = '';
  for (let page = 0; page < 6; page += 1) {
    const url = new URL(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${encodeURIComponent(collection)}`);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) return null;
    const payload = await response.json();
    for (const document of payload.documents ?? []) {
      const row = unwrapFields(document.fields);
      if (containsExactValue(row, cedula)) {
        row.__documentId = clean(document.name).split('/').pop() ?? '';
        return row;
      }
    }
    pageToken = clean(payload.nextPageToken);
    if (!pageToken) break;
  }
  return null;
}

export async function findStudent(cedula: string): Promise<UnknownRecord | null> {
  for (const collection of STUDENT_COLLECTIONS) {
    const direct = await firestoreDocument(collection, cedula);
    if (direct) return direct;
  }

  for (const collection of STUDENT_COLLECTIONS) {
    const results = await Promise.all(['cedula', 'id', 'firebaseDocumentId'].map((field) => queryByField(collection, field, cedula)));
    const found = results.find(Boolean);
    if (found) return found;
  }

  for (const collection of STUDENT_COLLECTIONS) {
    const scanned = await listCollectionForCedula(collection, cedula);
    if (scanned) return scanned;
  }
  return null;
}

export async function findMatricula(cedula: string): Promise<UnknownRecord | null> {
  const direct = await firestoreDocument('matriculas', cedula);
  if (direct) return direct;

  const fields = ['cedula', 'cedulaEstudiante', 'estudianteCedula', 'identificacion', 'numeroDocumento', 'studentCedula', 'idEstudiante', 'estudianteId'];
  const queried = await Promise.all(fields.map((field) => queryByField('matriculas', field, cedula)));
  const active = queried.find((row) => row && row.eliminado !== true && row.activo !== false);
  if (active) return active;
  return await listCollectionForCedula('matriculas', cedula);
}

export function resolveModality(...records: Array<UnknownRecord | null>): string {
  for (const record of records) {
    if (!record) continue;
    const match = flatten(record).find(({ path, value }) => /modalidad|modality/.test(path) && typeof value === 'string' && clean(value));
    if (match) return clean(match.value);
  }
  return '';
}

export function fallbackModality(careerCode: string): string {
  if (/-P-/i.test(careerCode)) return 'Presencial';
  if (/-L-/i.test(careerCode)) return 'Online';
  return 'Institucional';
}
