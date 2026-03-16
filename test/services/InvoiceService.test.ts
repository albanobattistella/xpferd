import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../src/server/database/Database.js';
import { InvoiceService } from '../../src/server/services/InvoiceService.js';
import type { InvoiceDto } from '../../src/shared/types';
import path from 'path';
import fs from 'fs';

const TEST_DB = path.resolve(process.cwd(), 'test/.test-svc.db');

function sampleInvoice(): InvoiceDto {
  return {
    invoiceNumber: 'SVC-001',
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
    lines: [
      { lineNumber: 1, quantity: 3, unitCode: 'HUR', itemName: 'Consulting', netPrice: 100, vatCategoryCode: 'S', vatRate: 19, lineNetAmount: 0 },
      { lineNumber: 2, quantity: 5, unitCode: 'C62', itemName: 'Parts', netPrice: 20, vatCategoryCode: 'S', vatRate: 19, lineNetAmount: 0 },
    ],
  };
}

function kleinunternehmerInvoice(): InvoiceDto {
  return {
    ...sampleInvoice(),
    invoiceNumber: 'KU-001',
    kleinunternehmer: true,
    taxCategoryCode: 'S',
    taxRate: 19,
  };
}

describe('InvoiceService', () => {
  let service: InvoiceService;

  beforeEach(() => {
    Database.resetInstance();
    Database.getInstance(TEST_DB);
    service = new InvoiceService();
  });

  afterEach(() => {
    Database.resetInstance();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    if (fs.existsSync(TEST_DB + '-wal')) fs.unlinkSync(TEST_DB + '-wal');
    if (fs.existsSync(TEST_DB + '-shm')) fs.unlinkSync(TEST_DB + '-shm');
  });

  it('should calculate totals on create', () => {
    const created = service.create(sampleInvoice());
    // Line 1: 3 * 100 = 300, Line 2: 5 * 20 = 100 → Net = 400
    expect(created.totalNetAmount).toBe(400);
    expect(created.totalTaxAmount).toBe(76); // 400 * 0.19
    expect(created.totalGrossAmount).toBe(476);
    expect(created.amountDue).toBe(476);
    expect(created.lines[0].lineNetAmount).toBe(300);
    expect(created.lines[1].lineNetAmount).toBe(100);
  });

  it('should set tax to 0 for Kleinunternehmer', () => {
    const created = service.create(kleinunternehmerInvoice());
    expect(created.kleinunternehmer).toBe(true);
    expect(created.taxCategoryCode).toBe('E');
    expect(created.taxRate).toBe(0);
    expect(created.totalTaxAmount).toBe(0);
    expect(created.totalNetAmount).toBe(400);
    expect(created.totalGrossAmount).toBe(400); // no tax
    expect(created.lines[0].vatCategoryCode).toBe('E');
    expect(created.lines[0].vatRate).toBe(0);
  });

  it('should duplicate an invoice', () => {
    const created = service.create(sampleInvoice());
    const dup = service.duplicate(created.id!);
    expect(dup).not.toBeNull();
    expect(dup!.id).not.toBe(created.id);
    expect(dup!.invoiceNumber).toBe('SVC-001-COPY');
    expect(dup!.lines).toHaveLength(2);
  });
});
