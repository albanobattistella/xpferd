const BASE = '/api/v1/parties';

const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  street: 'Straße',
  city: 'Ort',
  postalCode: 'PLZ',
  countryCode: 'Land',
  contactName: 'Ansprechpartner',
  contactPhone: 'Telefon',
  contactEmail: 'E-Mail (Kontakt)',
  email: 'E-Mail',
};

export interface FieldErrors {
  [field: string]: string;
}

export class PartyValidationError extends Error {
  fieldErrors: FieldErrors;
  constructor(message: string, fieldErrors: FieldErrors) {
    super(message);
    this.fieldErrors = fieldErrors;
  }
}

function parseFieldErrors(details: any[]): FieldErrors {
  const errors: FieldErrors = {};
  if (!details) return errors;
  for (const d of details) {
    const path = d.path?.join('.') ?? '';
    if (path && !errors[path]) {
      errors[path] = d.message || `${FIELD_LABELS[path] || path} ist ungültig`;
    }
  }
  return errors;
}

function formatValidationErrors(details: any[]): string {
  if (!details || details.length === 0) return 'Validierung fehlgeschlagen';
  const seen = new Set<string>();
  const messages: string[] = [];
  for (const d of details) {
    const path = d.path?.join('.') ?? '';
    const label = FIELD_LABELS[path] ?? path;
    const msg = d.message || label;
    if (!seen.has(msg)) {
      seen.add(msg);
      messages.push(msg);
    }
  }
  return 'Fehlende/ungültige Felder: ' + messages.join(', ');
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let errorMsg = `HTTP ${res.status}`;
    try {
      const body = JSON.parse(text);
      if (body.details) {
        const fieldErrors = parseFieldErrors(body.details);
        const message = formatValidationErrors(body.details);
        throw new PartyValidationError(message, fieldErrors);
      }
      errorMsg = body.error || errorMsg;
    } catch (e) {
      if (e instanceof PartyValidationError) throw e;
      // response was not JSON
    }
    throw new Error(errorMsg);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Ungültige Serverantwort`);
  }
}

export const partyApi = {
  list: (type?: 'seller' | 'buyer') =>
    request<any[]>(type ? `${BASE}?type=${type}` : BASE),

  get: (id: number) => request<any>(`${BASE}/${id}`),

  create: (data: any) =>
    request<any>(BASE, { method: 'POST', body: JSON.stringify(data) }),

  update: (id: number, data: any) =>
    request<any>(`${BASE}/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  delete: (id: number) =>
    request<void>(`${BASE}/${id}`, { method: 'DELETE' }),
};
