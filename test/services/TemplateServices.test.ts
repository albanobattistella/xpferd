import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import { Database } from '../../src/server/database/Database.js';
import { InvoiceNumberTemplateService } from '../../src/server/services/InvoiceNumberTemplateService.js';
import { PaymentTemplateService } from '../../src/server/services/PaymentTemplateService.js';
import { LineItemTemplateService } from '../../src/server/services/LineItemTemplateService.js';
import { InvoiceTemplateService } from '../../src/server/services/InvoiceTemplateService.js';
import type {
  InvoiceNumberTemplateDto,
  PaymentTemplateDto,
  LineItemTemplateDto,
  InvoiceTemplateDto,
} from '../../src/shared/types';

const TEST_DB = path.resolve(process.cwd(), `test/.test-templates-${Date.now()}.db`);

beforeAll(() => {
  Database.resetInstance();
  Database.getInstance(TEST_DB);
});

afterAll(() => {
  Database.resetInstance();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  if (fs.existsSync(TEST_DB + '-wal')) fs.unlinkSync(TEST_DB + '-wal');
  if (fs.existsSync(TEST_DB + '-shm')) fs.unlinkSync(TEST_DB + '-shm');
});

// ---------------------------------------------------------------------------
// InvoiceNumberTemplateService
// ---------------------------------------------------------------------------
describe('InvoiceNumberTemplateService', () => {
  let service: InvoiceNumberTemplateService;

  beforeAll(() => {
    service = new InvoiceNumberTemplateService();
  });

  function makeTemplate(overrides: Partial<InvoiceNumberTemplateDto> = {}): InvoiceNumberTemplateDto {
    return {
      name: 'Standardvorlage',
      prefix: 'RE-',
      digits: 4,
      nextNumber: 1,
      ...overrides,
    };
  }

  it('listAll() returns empty array initially', () => {
    expect(service.listAll()).toEqual([]);
  });

  it('create() returns template with assigned id', () => {
    const t = service.create(makeTemplate());
    expect(t.id).toBeTypeOf('number');
    expect(t.name).toBe('Standardvorlage');
    expect(t.prefix).toBe('RE-');
    expect(t.digits).toBe(4);
    expect(t.nextNumber).toBe(1);
  });

  it('listAll() returns all created templates', () => {
    service.create(makeTemplate({ name: 'Zweite Vorlage', prefix: 'AR-' }));
    const all = service.listAll();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it('getById() returns the correct template', () => {
    const created = service.create(makeTemplate({ name: 'Abruf Test' }));
    const found = service.getById(created.id!);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.name).toBe('Abruf Test');
  });

  it('getById() returns null for non-existent id', () => {
    expect(service.getById(999999)).toBeNull();
  });

  it('update() updates and returns new data', () => {
    const created = service.create(makeTemplate({ name: 'Vor Änderung', prefix: 'X-', digits: 3, nextNumber: 5 }));
    const updated = service.update(created.id!, makeTemplate({ name: 'Nach Änderung', prefix: 'Y-', digits: 5, nextNumber: 10 }));
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('Nach Änderung');
    expect(updated!.prefix).toBe('Y-');
    expect(updated!.digits).toBe(5);
    expect(updated!.nextNumber).toBe(10);
  });

  it('update() returns null for non-existent id', () => {
    expect(service.update(999999, makeTemplate())).toBeNull();
  });

  it('delete() returns true for existing template', () => {
    const created = service.create(makeTemplate({ name: 'Zu löschen' }));
    expect(service.delete(created.id!)).toBe(true);
  });

  it('delete() removes the template', () => {
    const created = service.create(makeTemplate({ name: 'Gelöscht' }));
    service.delete(created.id!);
    expect(service.getById(created.id!)).toBeNull();
  });

  it('delete() returns false for non-existent id', () => {
    expect(service.delete(999999)).toBe(false);
  });

  describe('generateNext()', () => {
    it('generates a formatted invoice number on first call', () => {
      const created = service.create(makeTemplate({ prefix: 'INV-', digits: 4, nextNumber: 1 }));
      const result = service.generateNext(created.id!);
      expect(result).not.toBeNull();
      expect(result!.invoiceNumber).toBe('INV-0001');
    });

    it('increments nextNumber after each call', () => {
      const created = service.create(makeTemplate({ prefix: 'SQ-', digits: 3, nextNumber: 5 }));
      const first = service.generateNext(created.id!);
      const second = service.generateNext(created.id!);
      expect(first!.invoiceNumber).toBe('SQ-005');
      expect(second!.invoiceNumber).toBe('SQ-006');
    });

    it('pads number to full digit width', () => {
      const created = service.create(makeTemplate({ prefix: 'PAD-', digits: 6, nextNumber: 42 }));
      const result = service.generateNext(created.id!);
      expect(result!.invoiceNumber).toBe('PAD-000042');
    });

    it('persists the incremented nextNumber in the DB', () => {
      const created = service.create(makeTemplate({ prefix: 'DB-', digits: 4, nextNumber: 1 }));
      service.generateNext(created.id!);
      const reloaded = service.getById(created.id!);
      expect(reloaded!.nextNumber).toBe(2);
    });

    it('returns null for a non-existent id', () => {
      expect(service.generateNext(999999)).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// PaymentTemplateService
// ---------------------------------------------------------------------------
describe('PaymentTemplateService', () => {
  let service: PaymentTemplateService;

  beforeAll(() => {
    service = new PaymentTemplateService();
  });

  function makeTemplate(overrides: Partial<PaymentTemplateDto> = {}): PaymentTemplateDto {
    return {
      name: 'SEPA Überweisung',
      paymentMeansCode: '58',
      iban: 'DE89370400440532013000',
      bic: 'COBADEFFXXX',
      paymentTerms: 'Zahlbar innerhalb 14 Tagen',
      ...overrides,
    };
  }

  it('listAll() returns empty array initially', () => {
    expect(service.listAll()).toEqual([]);
  });

  it('create() returns template with assigned id', () => {
    const t = service.create(makeTemplate());
    expect(t.id).toBeTypeOf('number');
    expect(t.name).toBe('SEPA Überweisung');
    expect(t.paymentMeansCode).toBe('58');
    expect(t.iban).toBe('DE89370400440532013000');
    expect(t.bic).toBe('COBADEFFXXX');
    expect(t.paymentTerms).toBe('Zahlbar innerhalb 14 Tagen');
  });

  it('create() allows optional fields to be omitted', () => {
    const t = service.create(makeTemplate({ iban: undefined, bic: undefined, paymentTerms: undefined }));
    expect(t.id).toBeTypeOf('number');
    expect(t.iban).toBeUndefined();
    expect(t.bic).toBeUndefined();
    expect(t.paymentTerms).toBeUndefined();
  });

  it('listAll() returns all created templates', () => {
    service.create(makeTemplate({ name: 'Zweite Vorlage', paymentMeansCode: '30' }));
    const all = service.listAll();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it('getById() returns the correct template', () => {
    const created = service.create(makeTemplate({ name: 'Abruf Test' }));
    const found = service.getById(created.id!);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.name).toBe('Abruf Test');
  });

  it('getById() returns null for non-existent id', () => {
    expect(service.getById(999999)).toBeNull();
  });

  it('update() updates and returns new data', () => {
    const created = service.create(makeTemplate({ name: 'Vor Änderung' }));
    const updated = service.update(created.id!, makeTemplate({ name: 'Nach Änderung', paymentMeansCode: '31', iban: 'DE02100500000054540402' }));
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('Nach Änderung');
    expect(updated!.paymentMeansCode).toBe('31');
    expect(updated!.iban).toBe('DE02100500000054540402');
  });

  it('update() returns null for non-existent id', () => {
    expect(service.update(999999, makeTemplate())).toBeNull();
  });

  it('delete() returns true for existing template', () => {
    const created = service.create(makeTemplate({ name: 'Zu löschen' }));
    expect(service.delete(created.id!)).toBe(true);
  });

  it('delete() removes the template', () => {
    const created = service.create(makeTemplate({ name: 'Gelöscht' }));
    service.delete(created.id!);
    expect(service.getById(created.id!)).toBeNull();
  });

  it('delete() returns false for non-existent id', () => {
    expect(service.delete(999999)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// LineItemTemplateService
// ---------------------------------------------------------------------------
describe('LineItemTemplateService', () => {
  let service: LineItemTemplateService;

  beforeAll(() => {
    service = new LineItemTemplateService();
  });

  function makeTemplate(overrides: Partial<LineItemTemplateDto> = {}): LineItemTemplateDto {
    return {
      name: 'Beratungsleistung',
      unitCode: 'HUR',
      netPrice: 150.0,
      vatCategoryCode: 'S',
      vatRate: 19,
      ...overrides,
    };
  }

  it('listAll() returns empty array initially', () => {
    expect(service.listAll()).toEqual([]);
  });

  it('create() returns template with assigned id', () => {
    const t = service.create(makeTemplate());
    expect(t.id).toBeTypeOf('number');
    expect(t.name).toBe('Beratungsleistung');
    expect(t.unitCode).toBe('HUR');
    expect(t.netPrice).toBe(150.0);
    expect(t.vatCategoryCode).toBe('S');
    expect(t.vatRate).toBe(19);
  });

  it('listAll() returns all created templates', () => {
    service.create(makeTemplate({ name: 'Produkt A', unitCode: 'C62', netPrice: 49.99 }));
    const all = service.listAll();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it('getById() returns the correct template', () => {
    const created = service.create(makeTemplate({ name: 'Abruf Test' }));
    const found = service.getById(created.id!);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.name).toBe('Abruf Test');
  });

  it('getById() returns null for non-existent id', () => {
    expect(service.getById(999999)).toBeNull();
  });

  it('update() updates and returns new data', () => {
    const created = service.create(makeTemplate({ name: 'Vor Änderung', netPrice: 100 }));
    const updated = service.update(created.id!, makeTemplate({ name: 'Nach Änderung', netPrice: 200, vatRate: 7 }));
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('Nach Änderung');
    expect(updated!.netPrice).toBe(200);
    expect(updated!.vatRate).toBe(7);
  });

  it('update() returns null for non-existent id', () => {
    expect(service.update(999999, makeTemplate())).toBeNull();
  });

  it('delete() returns true for existing template', () => {
    const created = service.create(makeTemplate({ name: 'Zu löschen' }));
    expect(service.delete(created.id!)).toBe(true);
  });

  it('delete() removes the template', () => {
    const created = service.create(makeTemplate({ name: 'Gelöscht' }));
    service.delete(created.id!);
    expect(service.getById(created.id!)).toBeNull();
  });

  it('delete() returns false for non-existent id', () => {
    expect(service.delete(999999)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// InvoiceTemplateService
// ---------------------------------------------------------------------------
describe('InvoiceTemplateService', () => {
  let service: InvoiceTemplateService;

  beforeAll(() => {
    service = new InvoiceTemplateService();
  });

  function makeTemplate(overrides: Partial<InvoiceTemplateDto> = {}): InvoiceTemplateDto {
    return {
      name: 'Standardrechnung',
      data: JSON.stringify({ invoiceNumber: 'TMPL-001', currencyCode: 'EUR' }),
      ...overrides,
    };
  }

  it('listAll() returns empty array initially', () => {
    expect(service.listAll()).toEqual([]);
  });

  it('create() returns template with assigned id', () => {
    const t = service.create(makeTemplate());
    expect(t.id).toBeTypeOf('number');
    expect(t.name).toBe('Standardrechnung');
    expect(t.data).toBe(JSON.stringify({ invoiceNumber: 'TMPL-001', currencyCode: 'EUR' }));
  });

  it('listAll() returns all created templates', () => {
    service.create(makeTemplate({ name: 'Dienstleistungsrechnung', data: '{"type":"service"}' }));
    const all = service.listAll();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it('getById() returns the correct template', () => {
    const created = service.create(makeTemplate({ name: 'Abruf Test' }));
    const found = service.getById(created.id!);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.name).toBe('Abruf Test');
  });

  it('getById() returns null for non-existent id', () => {
    expect(service.getById(999999)).toBeNull();
  });

  it('update() updates name and data and returns new values', () => {
    const created = service.create(makeTemplate({ name: 'Vor Änderung', data: '{"v":1}' }));
    const updated = service.update(created.id!, makeTemplate({ name: 'Nach Änderung', data: '{"v":2}' }));
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('Nach Änderung');
    expect(updated!.data).toBe('{"v":2}');
  });

  it('update() persists the change when re-fetched', () => {
    const created = service.create(makeTemplate({ name: 'Persistenz', data: '{"old":true}' }));
    service.update(created.id!, makeTemplate({ name: 'Persistiert', data: '{"new":true}' }));
    const reloaded = service.getById(created.id!);
    expect(reloaded!.data).toBe('{"new":true}');
  });

  it('update() returns null for non-existent id', () => {
    expect(service.update(999999, makeTemplate())).toBeNull();
  });

  it('delete() returns true for existing template', () => {
    const created = service.create(makeTemplate({ name: 'Zu löschen' }));
    expect(service.delete(created.id!)).toBe(true);
  });

  it('delete() removes the template', () => {
    const created = service.create(makeTemplate({ name: 'Gelöscht' }));
    service.delete(created.id!);
    expect(service.getById(created.id!)).toBeNull();
  });

  it('delete() returns false for non-existent id', () => {
    expect(service.delete(999999)).toBe(false);
  });
});
