import type { PdfTemplateDto } from '$shared/types';

const BASE = '/api/v1/pdf-templates';

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
      if (body.details && Array.isArray(body.details) && body.details.length > 0) {
        const lines = body.details.map((d: any) => {
          const path = Array.isArray(d.path) && d.path.length > 0 ? d.path.join(' → ') : '';
          return path ? `${path}: ${d.message}` : d.message;
        });
        errorMsg = lines.join('\n');
      } else {
        errorMsg = body.error || errorMsg;
      }
    } catch {
      // response was not JSON
    }
    throw new Error(errorMsg);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Ungültige Serverantwort');
  }
}

export const pdfTemplateApi = {
  list: () => request<PdfTemplateDto[]>(BASE),

  get: (id: number) => request<PdfTemplateDto>(`${BASE}/${id}`),

  create: (data: PdfTemplateDto) =>
    request<PdfTemplateDto>(BASE, { method: 'POST', body: JSON.stringify(data) }),

  update: (id: number, data: PdfTemplateDto) =>
    request<PdfTemplateDto>(`${BASE}/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  delete: (id: number) =>
    request<void>(`${BASE}/${id}`, { method: 'DELETE' }),

  previewUrl: (id: number, invoiceId: number) =>
    `${BASE}/${id}/preview?invoiceId=${invoiceId}`,

  exportUrl: (id: number, invoiceId: number) =>
    `${BASE}/${id}/export?invoiceId=${invoiceId}`,

  previewDraft: async (template: PdfTemplateDto, invoiceId: number): Promise<Blob> => {
    const res = await fetch(`${BASE}/preview-draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template, invoiceId }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob();
  },

  exportZugferd: async (id: number, invoiceId: number): Promise<Blob> => {
    const res = await fetch(`${BASE}/${id}/export-zugferd?invoiceId=${invoiceId}`, {
      method: 'POST',
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let msg = `HTTP ${res.status}`;
      try { msg = JSON.parse(text).error || msg; } catch { /* */ }
      throw new Error(msg);
    }
    return res.blob();
  },
};
