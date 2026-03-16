import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { Database } from '../../src/server/database/Database.js';
import { createApp } from '../../src/server/app.js';
import { fmtDate, fmtNumber } from '../../src/shared/constants/format.js';

const TEST_DB = path.resolve(process.cwd(), `test/.test-settings-${Date.now()}.db`);
let server: http.Server;
let baseUrl: string;

async function api(
  method: string,
  apiPath: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${baseUrl}${apiPath}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data =
    res.status === 204
      ? null
      : res.headers.get('content-type')?.includes('json')
        ? JSON.parse(text)
        : text;
  return { status: res.status, data };
}

describe('AppSettings API', () => {
  beforeAll(async () => {
    Database.resetInstance();
    Database.getInstance(TEST_DB);
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address() as { port: number };
        baseUrl = `http://localhost:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    Database.resetInstance();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    if (fs.existsSync(TEST_DB + '-wal')) fs.unlinkSync(TEST_DB + '-wal');
    if (fs.existsSync(TEST_DB + '-shm')) fs.unlinkSync(TEST_DB + '-shm');
  });

  it('GET /api/v1/settings — returns defaults on first access', async () => {
    const { status, data } = await api('GET', '/api/v1/settings');
    expect(status).toBe(200);
    expect(data).toEqual({
      locale: 'de-DE',
      dateFormat: 'DD.MM.YYYY',
      numberFormat: 'de-DE',
    });
  });

  it('PUT /api/v1/settings — update dateFormat', async () => {
    const body = { locale: 'de-DE', dateFormat: 'YYYY-MM-DD', numberFormat: 'de-DE' };
    const { status, data } = await api('PUT', '/api/v1/settings', body);
    expect(status).toBe(200);
    expect(data).toEqual(body);
  });

  it('PUT /api/v1/settings — update numberFormat, GET reflects change', async () => {
    const body = { locale: 'de-DE', dateFormat: 'DD.MM.YYYY', numberFormat: 'en-US' };
    const put = await api('PUT', '/api/v1/settings', body);
    expect(put.status).toBe(200);

    const { status, data } = await api('GET', '/api/v1/settings');
    expect(status).toBe(200);
    expect(data).toEqual(body);
  });

  it('PUT /api/v1/settings — update all fields, GET reflects all changes', async () => {
    const body = { locale: 'de-DE', dateFormat: 'MM/DD/YYYY', numberFormat: 'en-US' };
    const put = await api('PUT', '/api/v1/settings', body);
    expect(put.status).toBe(200);
    expect(put.data).toEqual(body);

    const { status, data } = await api('GET', '/api/v1/settings');
    expect(status).toBe(200);
    expect(data).toEqual(body);
  });

  it('PUT /api/v1/settings — invalid dateFormat returns 400', async () => {
    const { status, data } = await api('PUT', '/api/v1/settings', {
      locale: 'de-DE',
      dateFormat: 'INVALID',
      numberFormat: 'de-DE',
    });
    expect(status).toBe(400);
    expect((data as { error: string }).error).toBe('Validation failed');
  });

  it('PUT /api/v1/settings — invalid numberFormat returns 400', async () => {
    const { status, data } = await api('PUT', '/api/v1/settings', {
      locale: 'de-DE',
      dateFormat: 'DD.MM.YYYY',
      numberFormat: 'fr-FR',
    });
    expect(status).toBe(400);
    expect((data as { error: string }).error).toBe('Validation failed');
  });

  it('PUT /api/v1/settings — invalid locale returns 400', async () => {
    const { status, data } = await api('PUT', '/api/v1/settings', {
      locale: 'fr-FR',
      dateFormat: 'DD.MM.YYYY',
      numberFormat: 'de-DE',
    });
    expect(status).toBe(400);
    expect((data as { error: string }).error).toBe('Validation failed');
  });

  it('GET after multiple PUTs — returns last PUT value', async () => {
    const first = { locale: 'de-DE', dateFormat: 'DD/MM/YYYY', numberFormat: 'de-DE' };
    const second = { locale: 'de-DE', dateFormat: 'DD-MM-YYYY', numberFormat: 'en-US' };

    await api('PUT', '/api/v1/settings', first);
    await api('PUT', '/api/v1/settings', second);

    const { status, data } = await api('GET', '/api/v1/settings');
    expect(status).toBe(200);
    expect(data).toEqual(second);
  });
});

describe('fmtDate utility', () => {
  it('DD.MM.YYYY — formats 2026-03-16', () => {
    expect(fmtDate('2026-03-16', 'DD.MM.YYYY')).toBe('16.03.2026');
  });

  it('DD/MM/YYYY — formats 2026-03-16', () => {
    expect(fmtDate('2026-03-16', 'DD/MM/YYYY')).toBe('16/03/2026');
  });

  it('YYYY-MM-DD — formats 2026-03-16', () => {
    expect(fmtDate('2026-03-16', 'YYYY-MM-DD')).toBe('2026-03-16');
  });

  it('MM/DD/YYYY — formats 2026-03-16', () => {
    expect(fmtDate('2026-03-16', 'MM/DD/YYYY')).toBe('03/16/2026');
  });

  it('DD-MM-YYYY — formats 2026-03-16', () => {
    expect(fmtDate('2026-03-16', 'DD-MM-YYYY')).toBe('16-03-2026');
  });

  it('empty string input returns empty string', () => {
    expect(fmtDate('', 'DD.MM.YYYY')).toBe('');
  });

  it('default format (no second arg) returns DD.MM.YYYY', () => {
    expect(fmtDate('2026-03-16')).toBe('16.03.2026');
  });

  it('leading zeros — single-digit day and month', () => {
    expect(fmtDate('2026-01-05', 'DD.MM.YYYY')).toBe('05.01.2026');
  });
});

describe('fmtNumber utility', () => {
  it('de-DE locale — 1234.56 formatted with period thousands and comma decimal', () => {
    const result = fmtNumber(1234.56, 'de-DE');
    expect(result).toContain('1.234');
    expect(result).toContain(',56');
  });

  it('en-US locale — 1234.56 formatted with comma thousands and period decimal', () => {
    const result = fmtNumber(1234.56, 'en-US');
    expect(result).toContain('1,234');
    expect(result).toContain('.56');
  });

  it('default locale (no second arg) behaves like de-DE', () => {
    const withDefault = fmtNumber(1234.56);
    const withDeDE = fmtNumber(1234.56, 'de-DE');
    expect(withDefault).toBe(withDeDE);
  });

  it('zero value formats correctly', () => {
    expect(fmtNumber(0, 'de-DE')).toBe('0,00');
  });

  it('large number formats with thousands separator', () => {
    const result = fmtNumber(1000000.0, 'de-DE');
    expect(result).toContain('1.000.000');
  });
});
