import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import { Database } from '../../src/server/database/Database.js';
import { PartyService } from '../../src/server/services/PartyService.js';
import type { PartyDto } from '../../src/shared/types';

const TEST_DB = path.resolve(process.cwd(), `test/.test-party-${Date.now()}.db`);

function makeSeller(overrides: Partial<PartyDto> = {}): PartyDto {
  return {
    type: 'seller',
    name: 'Muster GmbH',
    street: 'Hauptstraße 1',
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
    name: 'Käufer AG',
    street: 'Kaufstraße 2',
    city: 'München',
    postalCode: '80331',
    countryCode: 'DE',
    email: 'buyer@example.de',
    ...overrides,
  };
}

describe('PartyService', () => {
  let service: PartyService;

  beforeAll(() => {
    Database.resetInstance();
    Database.getInstance(TEST_DB);
    service = new PartyService();
  });

  afterAll(() => {
    Database.resetInstance();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    if (fs.existsSync(TEST_DB + '-wal')) fs.unlinkSync(TEST_DB + '-wal');
    if (fs.existsSync(TEST_DB + '-shm')) fs.unlinkSync(TEST_DB + '-shm');
  });

  describe('listAll()', () => {
    it('returns empty array when no parties exist', () => {
      const result = service.listAll();
      expect(result).toEqual([]);
    });
  });

  describe('create()', () => {
    it('creates a seller party and returns it with an id', () => {
      const seller = service.create(makeSeller());
      expect(seller.id).toBeTypeOf('number');
      expect(seller.type).toBe('seller');
      expect(seller.name).toBe('Muster GmbH');
      expect(seller.street).toBe('Hauptstraße 1');
      expect(seller.city).toBe('Berlin');
      expect(seller.postalCode).toBe('10115');
      expect(seller.countryCode).toBe('DE');
      expect(seller.vatId).toBe('DE123456789');
      expect(seller.contactName).toBe('Max Mustermann');
      expect(seller.contactPhone).toBe('+49 30 12345678');
      expect(seller.contactEmail).toBe('seller@example.de');
    });

    it('creates a buyer party and returns it with an id', () => {
      const buyer = service.create(makeBuyer());
      expect(buyer.id).toBeTypeOf('number');
      expect(buyer.type).toBe('buyer');
      expect(buyer.name).toBe('Käufer AG');
      expect(buyer.email).toBe('buyer@example.de');
    });

    it('creates a party with optional fields omitted', () => {
      const minimal = service.create(makeSeller({ vatId: undefined, taxNumber: undefined }));
      expect(minimal.id).toBeTypeOf('number');
      expect(minimal.vatId).toBeUndefined();
      expect(minimal.taxNumber).toBeUndefined();
    });

    it('assigns different ids to different parties', () => {
      const a = service.create(makeSeller({ name: 'Firma A' }));
      const b = service.create(makeSeller({ name: 'Firma B' }));
      expect(a.id).not.toBe(b.id);
    });
  });

  describe('listAll()', () => {
    it('returns all parties after creation', () => {
      const all = service.listAll();
      expect(all.length).toBeGreaterThanOrEqual(2);
    });

    it('filters by type seller', () => {
      const sellers = service.listAll('seller');
      expect(sellers.every(p => p.type === 'seller')).toBe(true);
    });

    it('filters by type buyer', () => {
      const buyers = service.listAll('buyer');
      expect(buyers.every(p => p.type === 'buyer')).toBe(true);
    });

    it('seller and buyer lists are disjoint by type', () => {
      const sellers = service.listAll('seller');
      const buyers = service.listAll('buyer');
      const allIds = new Set([...sellers.map(p => p.id), ...buyers.map(p => p.id)]);
      const combined = service.listAll();
      expect(allIds.size).toBe(combined.length);
    });
  });

  describe('getById()', () => {
    it('returns the correct party by id', () => {
      const created = service.create(makeSeller({ name: 'Lookup GmbH' }));
      const found = service.getById(created.id!);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.name).toBe('Lookup GmbH');
    });

    it('returns null for a non-existent id', () => {
      const result = service.getById(999999);
      expect(result).toBeNull();
    });
  });

  describe('update()', () => {
    it('updates a party and returns the updated data', () => {
      const created = service.create(makeSeller({ name: 'Vor Update GmbH' }));
      const updated = service.update(created.id!, makeSeller({ name: 'Nach Update GmbH', vatId: 'DE987654321' }));
      expect(updated).not.toBeNull();
      expect(updated!.id).toBe(created.id);
      expect(updated!.name).toBe('Nach Update GmbH');
      expect(updated!.vatId).toBe('DE987654321');
    });

    it('persists the update when re-fetched', () => {
      const created = service.create(makeSeller({ name: 'Persistenz Test' }));
      service.update(created.id!, makeSeller({ name: 'Persistiert' }));
      const fetched = service.getById(created.id!);
      expect(fetched!.name).toBe('Persistiert');
    });

    it('can update party type from seller to buyer', () => {
      const created = service.create(makeSeller({ name: 'Typ Wechsel' }));
      const updated = service.update(created.id!, makeBuyer({ name: 'Typ Wechsel' }));
      expect(updated!.type).toBe('buyer');
    });

    it('returns null when updating a non-existent id', () => {
      const result = service.update(999999, makeSeller());
      expect(result).toBeNull();
    });
  });

  describe('delete()', () => {
    it('deletes an existing party and returns true', () => {
      const created = service.create(makeSeller({ name: 'Zu löschen GmbH' }));
      const deleted = service.delete(created.id!);
      expect(deleted).toBe(true);
    });

    it('party is no longer findable after deletion', () => {
      const created = service.create(makeSeller({ name: 'Gelöscht GmbH' }));
      service.delete(created.id!);
      const found = service.getById(created.id!);
      expect(found).toBeNull();
    });

    it('returns false for a non-existent id', () => {
      const result = service.delete(999999);
      expect(result).toBe(false);
    });

    it('does not affect other parties when one is deleted', () => {
      const keep = service.create(makeSeller({ name: 'Bleibt GmbH' }));
      const remove = service.create(makeSeller({ name: 'Weg GmbH' }));
      service.delete(remove.id!);
      const found = service.getById(keep.id!);
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Bleibt GmbH');
    });
  });
});
