import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { Database } from '../../src/server/database/Database.js';
import { createApp } from '../../src/server/app.js';
import type { PartyDto } from '../../src/shared/types';

const TEST_DB = path.resolve(process.cwd(), `test/.test-party-api-${Date.now()}.db`);
let server: http.Server;
let baseUrl: string;

function makeSeller(overrides: Partial<PartyDto> = {}): PartyDto {
  return {
    type: 'seller',
    name: 'API Verkäufer GmbH',
    street: 'Verkäuferstraße 1',
    city: 'Berlin',
    postalCode: '10115',
    countryCode: 'DE',
    vatId: 'DE123456789',
    contactName: 'Max Mustermann',
    contactPhone: '+49 30 12345678',
    contactEmail: 'seller@example.de',
    ...overrides,
  };
}

function makeBuyer(overrides: Partial<PartyDto> = {}): PartyDto {
  return {
    type: 'buyer',
    name: 'API Käufer AG',
    street: 'Käuferstraße 2',
    city: 'München',
    postalCode: '80331',
    countryCode: 'DE',
    email: 'buyer@example.de',
    ...overrides,
  };
}

async function api(method: string, urlPath: string, body?: unknown): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = res.status === 204 ? null : (
    res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text
  );
  return { status: res.status, data };
}

describe('Party API Integration', () => {
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

  // ---------------------------------------------------------------------------
  // GET /api/v1/parties
  // ---------------------------------------------------------------------------
  describe('GET /api/v1/parties', () => {
    it('returns 200 with empty array when no parties exist', async () => {
      const { status, data } = await api('GET', '/api/v1/parties');
      expect(status).toBe(200);
      expect(data).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/v1/parties
  // ---------------------------------------------------------------------------
  describe('POST /api/v1/parties', () => {
    it('creates a seller party and returns 201 with id', async () => {
      const { status, data } = await api('POST', '/api/v1/parties', makeSeller());
      expect(status).toBe(201);
      const party = data as PartyDto;
      expect(party.id).toBeTypeOf('number');
      expect(party.type).toBe('seller');
      expect(party.name).toBe('API Verkäufer GmbH');
      expect(party.contactName).toBe('Max Mustermann');
    });

    it('creates a buyer party and returns 201 with id', async () => {
      const { status, data } = await api('POST', '/api/v1/parties', makeBuyer());
      expect(status).toBe(201);
      const party = data as PartyDto;
      expect(party.id).toBeTypeOf('number');
      expect(party.type).toBe('buyer');
      expect(party.name).toBe('API Käufer AG');
      expect(party.email).toBe('buyer@example.de');
    });

    it('returns 400 when required fields are missing', async () => {
      const { status, data } = await api('POST', '/api/v1/parties', { bad: 'data' });
      expect(status).toBe(400);
      const body = data as { error: string; details: unknown[] };
      expect(body.error).toBe('Validation failed');
      expect(Array.isArray(body.details)).toBe(true);
    });

    it('returns 400 when seller is missing contactName', async () => {
      const { status, data } = await api('POST', '/api/v1/parties', makeSeller({ contactName: '' }));
      expect(status).toBe(400);
      const body = data as { details: Array<{ path: string[] }> };
      const paths = body.details.map((d) => d.path.join('.'));
      expect(paths.some((p) => p.includes('contactName'))).toBe(true);
    });

    it('returns 400 when seller is missing contactEmail', async () => {
      const { status, data } = await api('POST', '/api/v1/parties', makeSeller({ contactEmail: '' }));
      expect(status).toBe(400);
      const body = data as { details: Array<{ path: string[] }> };
      const paths = body.details.map((d) => d.path.join('.'));
      expect(paths.some((p) => p.includes('contactEmail'))).toBe(true);
    });

    it('returns 400 when buyer is missing email', async () => {
      const { status, data } = await api('POST', '/api/v1/parties', makeBuyer({ email: '' }));
      expect(status).toBe(400);
      const body = data as { details: Array<{ path: string[] }> };
      const paths = body.details.map((d) => d.path.join('.'));
      expect(paths.some((p) => p.includes('email'))).toBe(true);
    });

    it('returns 400 for an invalid German postal code', async () => {
      const { status } = await api('POST', '/api/v1/parties', makeBuyer({ postalCode: 'ABCDE' }));
      expect(status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/v1/parties (with data)
  // ---------------------------------------------------------------------------
  describe('GET /api/v1/parties (with data)', () => {
    it('returns all parties', async () => {
      const { data } = await api('GET', '/api/v1/parties');
      const parties = data as PartyDto[];
      expect(Array.isArray(parties)).toBe(true);
      expect(parties.length).toBeGreaterThanOrEqual(2);
    });

    it('filters by type=seller', async () => {
      const { status, data } = await api('GET', '/api/v1/parties?type=seller');
      expect(status).toBe(200);
      const sellers = data as PartyDto[];
      expect(sellers.every((p) => p.type === 'seller')).toBe(true);
    });

    it('filters by type=buyer', async () => {
      const { status, data } = await api('GET', '/api/v1/parties?type=buyer');
      expect(status).toBe(200);
      const buyers = data as PartyDto[];
      expect(buyers.every((p) => p.type === 'buyer')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/v1/parties/:id
  // ---------------------------------------------------------------------------
  describe('GET /api/v1/parties/:id', () => {
    it('returns 200 with the party data', async () => {
      const { data: created } = await api('POST', '/api/v1/parties', makeSeller({ name: 'Einzelabruf GmbH' }));
      const party = created as PartyDto;
      const { status, data } = await api('GET', `/api/v1/parties/${party.id}`);
      expect(status).toBe(200);
      const found = data as PartyDto;
      expect(found.id).toBe(party.id);
      expect(found.name).toBe('Einzelabruf GmbH');
    });

    it('returns 404 for a non-existent id', async () => {
      const { status } = await api('GET', '/api/v1/parties/999999');
      expect(status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // PUT /api/v1/parties/:id
  // ---------------------------------------------------------------------------
  describe('PUT /api/v1/parties/:id', () => {
    it('returns 200 with updated party data', async () => {
      const { data: created } = await api('POST', '/api/v1/parties', makeSeller({ name: 'Vor Update GmbH' }));
      const party = created as PartyDto;
      const { status, data } = await api('PUT', `/api/v1/parties/${party.id}`, makeSeller({ name: 'Nach Update GmbH', vatId: 'DE999999999' }));
      expect(status).toBe(200);
      const updated = data as PartyDto;
      expect(updated.id).toBe(party.id);
      expect(updated.name).toBe('Nach Update GmbH');
      expect(updated.vatId).toBe('DE999999999');
    });

    it('persists the update — GET after PUT returns new data', async () => {
      const { data: created } = await api('POST', '/api/v1/parties', makeSeller({ name: 'Persistenz GmbH' }));
      const party = created as PartyDto;
      await api('PUT', `/api/v1/parties/${party.id}`, makeSeller({ name: 'Persistiert GmbH' }));
      const { data: fetched } = await api('GET', `/api/v1/parties/${party.id}`);
      expect((fetched as PartyDto).name).toBe('Persistiert GmbH');
    });

    it('returns 404 for a non-existent id', async () => {
      const { status } = await api('PUT', '/api/v1/parties/999999', makeSeller());
      expect(status).toBe(404);
    });

    it('returns 400 for invalid update data', async () => {
      const { data: created } = await api('POST', '/api/v1/parties', makeSeller({ name: 'Update Validierung' }));
      const party = created as PartyDto;
      const { status } = await api('PUT', `/api/v1/parties/${party.id}`, { bad: 'data' });
      expect(status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE /api/v1/parties/:id
  // ---------------------------------------------------------------------------
  describe('DELETE /api/v1/parties/:id', () => {
    it('returns 204 and removes the party', async () => {
      const { data: created } = await api('POST', '/api/v1/parties', makeSeller({ name: 'Zu löschen GmbH' }));
      const party = created as PartyDto;
      const { status } = await api('DELETE', `/api/v1/parties/${party.id}`);
      expect(status).toBe(204);
    });

    it('party is no longer accessible after deletion', async () => {
      const { data: created } = await api('POST', '/api/v1/parties', makeSeller({ name: 'Gelöscht GmbH' }));
      const party = created as PartyDto;
      await api('DELETE', `/api/v1/parties/${party.id}`);
      const { status } = await api('GET', `/api/v1/parties/${party.id}`);
      expect(status).toBe(404);
    });

    it('returns 404 for a non-existent id', async () => {
      const { status } = await api('DELETE', '/api/v1/parties/999999');
      expect(status).toBe(404);
    });
  });
});
