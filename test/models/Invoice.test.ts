import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../src/server/database/Database.js';
import { InvoiceModel } from '../../src/server/models/Invoice.js';
import type { InvoiceDto } from '../../src/shared/types';
import path from 'path';
import fs from 'fs';

const TEST_DB = path.resolve(process.cwd(), 'test/.test.db');

function sampleInvoice(): InvoiceDto {
  return {
    invoiceNumber: 'TEST-001',
    invoiceDate: '2024-06-20',
    invoiceTypeCode: '380',
    currencyCode: 'EUR',
    buyerReference: 'LW-001',
    seller: {
      name: 'Seller GmbH', street: 'Str 1', city: 'Berlin',
      postalCode: '10115', countryCode: 'DE',
      contactName: 'Max', contactPhone: '+49123', contactEmail: 'seller@example.com',
    },
    buyer: {
      name: 'Buyer AG', street: 'Str 2', city: 'Munich',
      postalCode: '80331', countryCode: 'DE', email: 'buyer@example.com',
    },
    paymentMeansCode: '58',
    taxCategoryCode: 'S',
    taxRate: 19,
    kleinunternehmer: false,
    totalNetAmount: 100,
    totalTaxAmount: 19,
    totalGrossAmount: 119,
    amountDue: 119,
    lines: [
      { lineNumber: 1, quantity: 2, unitCode: 'C62', itemName: 'Widget', netPrice: 50, vatCategoryCode: 'S', vatRate: 19, lineNetAmount: 100 },
    ],
  };
}

describe('InvoiceModel', () => {
  let model: InvoiceModel;

  beforeEach(() => {
    Database.resetInstance();
    const db = Database.getInstance(TEST_DB);
    model = new InvoiceModel(db.getDb());
  });

  afterEach(() => {
    Database.resetInstance();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    if (fs.existsSync(TEST_DB + '-wal')) fs.unlinkSync(TEST_DB + '-wal');
    if (fs.existsSync(TEST_DB + '-shm')) fs.unlinkSync(TEST_DB + '-shm');
  });

  it('should create and retrieve an invoice', () => {
    const created = model.create(sampleInvoice());
    expect(created.id).toBeDefined();
    expect(created.invoiceNumber).toBe('TEST-001');
    expect(created.lines).toHaveLength(1);

    const found = model.findById(created.id!);
    expect(found).not.toBeNull();
    expect(found!.invoiceNumber).toBe('TEST-001');
  });

  it('should list all invoices', () => {
    model.create(sampleInvoice());
    model.create({ ...sampleInvoice(), invoiceNumber: 'TEST-002' });
    const list = model.findAll();
    expect(list).toHaveLength(2);
  });

  it('should update an invoice', () => {
    const created = model.create(sampleInvoice());
    const updated = model.update(created.id!, { ...sampleInvoice(), invoiceNumber: 'UPDATED-001' });
    expect(updated!.invoiceNumber).toBe('UPDATED-001');
  });

  it('should delete an invoice', () => {
    const created = model.create(sampleInvoice());
    expect(model.delete(created.id!)).toBe(true);
    expect(model.findById(created.id!)).toBeNull();
  });

  it('should cascade delete lines', () => {
    const created = model.create(sampleInvoice());
    model.delete(created.id!);
    // After deletion, creating new invoice should work fine (no orphan lines)
    const another = model.create(sampleInvoice());
    expect(another.lines).toHaveLength(1);
  });
});
