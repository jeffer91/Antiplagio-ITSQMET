export type FirestoreRecord = Record<string, unknown>;

let cachedToken: { value: string; expiresAt: number } | null = null;

function config(): { projectId: string; clientEmail: string; privateKey: string } {
  const projectId = (Deno.env.get('FIREBASE_PROJECT_ID') || '').trim();
  const clientEmail = (Deno.env.get('FIREBASE_CLIENT_EMAIL') || '').trim();
  const privateKey = (Deno.env.get('FIREBASE_PRIVATE_KEY') || '').replace(/\\n/g, '\n').trim();
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Firebase Admin no está configurado. Define FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL y FIREBASE_PRIVATE_KEY.');
  }
  return { projectId, clientEmail, privateKey };
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function utf8Base64Url(value: string): string {
  return base64Url(new TextEncoder().encode(value));
}

function pemBytes(pem: string): ArrayBuffer {
  const clean = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function accessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - 60_000 > now) return cachedToken.value;

  const { clientEmail, privateKey } = config();
  const issuedAt = Math.floor(now / 1000);
  const header = utf8Base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = utf8Base64Url(JSON.stringify({
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: issuedAt,
    exp: issuedAt + 3600,
  }));
  const unsigned = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemBytes(privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${base64Url(new Uint8Array(signature))}`;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Firebase Admin OAuth HTTP ${response.status}`);
  const result = await response.json() as { access_token?: string; expires_in?: number };
  if (!result.access_token) throw new Error('Firebase Admin no devolvió un access token.');
  cachedToken = {
    value: result.access_token,
    expiresAt: now + Math.max(300, Number(result.expires_in || 3600)) * 1000,
  };
  return cachedToken.value;
}

function decodeValue(value: FirestoreRecord | undefined): unknown {
  if (!value) return null;
  if ('stringValue' in value) return String(value.stringValue ?? '');
  if ('booleanValue' in value) return Boolean(value.booleanValue);
  if ('integerValue' in value) return Number(value.integerValue ?? 0);
  if ('doubleValue' in value) return Number(value.doubleValue ?? 0);
  if ('timestampValue' in value) return String(value.timestampValue ?? '');
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) {
    const rows = ((value.arrayValue as FirestoreRecord | undefined)?.values as FirestoreRecord[] | undefined) ?? [];
    return rows.map((row) => decodeValue(row));
  }
  if ('mapValue' in value) {
    const fields = (value.mapValue as FirestoreRecord | undefined)?.fields as FirestoreRecord | undefined;
    return decodeFields(fields);
  }
  return null;
}

function decodeFields(fields: FirestoreRecord | undefined): FirestoreRecord {
  const output: FirestoreRecord = {};
  for (const [key, value] of Object.entries(fields ?? {})) output[key] = decodeValue(value as FirestoreRecord);
  return output;
}

function encodeValue(value: unknown): FirestoreRecord {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (typeof value === 'object') return { mapValue: { fields: encodeFields(value as FirestoreRecord) } };
  return { stringValue: String(value) };
}

function encodeFields(record: FirestoreRecord): FirestoreRecord {
  const fields: FirestoreRecord = {};
  for (const [key, value] of Object.entries(record)) fields[key] = encodeValue(value);
  return fields;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const { projectId } = config();
  const token = await accessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${path}`;
  return await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    signal: init.signal ?? AbortSignal.timeout(20_000),
  });
}

export async function firestoreAdminGet(collection: string, id: string): Promise<FirestoreRecord | null> {
  const response = await request(`${encodeURIComponent(collection)}/${encodeURIComponent(id)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Firestore GET ${collection}/${id}: HTTP ${response.status}`);
  const payload = await response.json() as { fields?: FirestoreRecord };
  return { id, ...decodeFields(payload.fields) };
}

export async function firestoreAdminList(collection: string): Promise<FirestoreRecord[]> {
  const rows: FirestoreRecord[] = [];
  let pageToken = '';
  do {
    const suffix = new URLSearchParams({ pageSize: '300' });
    if (pageToken) suffix.set('pageToken', pageToken);
    const response = await request(`${encodeURIComponent(collection)}?${suffix.toString()}`);
    if (response.status === 404) return [];
    if (!response.ok) throw new Error(`Firestore LIST ${collection}: HTTP ${response.status}`);
    const payload = await response.json() as { documents?: Array<{ name?: string; fields?: FirestoreRecord }>; nextPageToken?: string };
    for (const document of payload.documents ?? []) {
      const id = String(document.name ?? '').split('/').pop() || '';
      rows.push({ id, ...decodeFields(document.fields) });
    }
    pageToken = String(payload.nextPageToken ?? '');
  } while (pageToken);
  return rows;
}

export async function firestoreAdminPut(collection: string, id: string, data: FirestoreRecord): Promise<FirestoreRecord> {
  const response = await request(`${encodeURIComponent(collection)}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: encodeFields(data) }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Firestore WRITE ${collection}/${id}: HTTP ${response.status} ${detail}`);
  }
  const payload = await response.json() as { fields?: FirestoreRecord };
  return { id, ...decodeFields(payload.fields) };
}

export async function firestoreAdminDelete(collection: string, id: string): Promise<void> {
  const response = await request(`${encodeURIComponent(collection)}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (response.status === 404) return;
  if (!response.ok) throw new Error(`Firestore DELETE ${collection}/${id}: HTTP ${response.status}`);
}
