import type { AppSettingsDto } from '$shared/types';

const BASE = '/api/v1/settings';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  const text = await res.text();
  return JSON.parse(text);
}

export const settingsApi = {
  get: () => request<AppSettingsDto>(BASE),
  update: (data: AppSettingsDto) =>
    request<AppSettingsDto>(BASE, { method: 'PUT', body: JSON.stringify(data) }),
};
