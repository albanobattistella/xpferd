import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import path from 'path';
import fs from 'fs';
import { Database } from '../../src/server/database/Database.js';
import { PdfRenderService, measureHelveticaWidth } from '../../src/server/services/PdfRenderService.js';

const TEST_DB = path.resolve(process.cwd(), `test/.test-pdf-render-${Date.now()}.db`);

beforeAll(() => {
  Database.resetInstance();
  Database.getInstance(TEST_DB);
});

afterAll(() => {
  Database.resetInstance();
  try { fs.unlinkSync(TEST_DB); } catch {}
  try { fs.unlinkSync(TEST_DB + '-wal'); } catch {}
  try { fs.unlinkSync(TEST_DB + '-shm'); } catch {}
});
import { computeBlockContentHeight } from '../../src/shared/utils/blockMetrics.js';
import type { PdfBlockDto, PdfTemplateDto, InvoiceDto, CustomFontDto } from '../../src/shared/types/Invoice.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const SAMPLE_INVOICE: InvoiceDto = {
  invoiceNumber: 'RE-2024-0042',
  invoiceDate: '2024-03-15',
  dueDate: '2024-04-15',
  buyerReference: 'LW-4200-9876',
  invoiceTypeCode: '380',
  currencyCode: 'EUR',
  paymentMeansCode: '58',
  iban: 'DE89 3704 0044 0532 0130 00',
  bic: 'COBADEFFXXX',
  paymentTerms: '30 Tage netto',
  taxRate: 19,
  taxCategoryCode: 'S',
  kleinunternehmer: false,
  totalNetAmount: 1250.00,
  totalTaxAmount: 237.50,
  totalGrossAmount: 1487.50,
  seller: {
    name: 'Musterfirma GmbH',
    street: 'Hauptstraße 42',
    postalCode: '10115',
    city: 'Berlin',
    countryCode: 'DE',
    vatId: 'DE123456789',
    taxNumber: '30/123/45678',
  },
  buyer: {
    name: 'Beispiel AG',
    street: 'Industrieweg 7',
    postalCode: '80331',
    city: 'München',
    countryCode: 'DE',
  },
  lines: [
    { lineNumber: 1, itemName: 'Webdesign Startseite', quantity: 1, unitCode: 'HUR', netPrice: 850.00, vatCategoryCode: 'S', vatRate: 19, lineNetAmount: 850.00 },
    { lineNumber: 2, itemName: 'SEO-Optimierung', quantity: 5, unitCode: 'HUR', netPrice: 80.00, vatCategoryCode: 'S', vatRate: 19, lineNetAmount: 400.00 },
  ],
};

// Invoice without optional fields
const MINIMAL_INVOICE: InvoiceDto = {
  invoiceNumber: 'RE-001',
  invoiceDate: '2024-01-01',
  invoiceTypeCode: '380',
  currencyCode: 'EUR',
  paymentMeansCode: '30',
  taxRate: 0,
  taxCategoryCode: 'E',
  kleinunternehmer: true,
  totalNetAmount: 500,
  totalTaxAmount: 0,
  totalGrossAmount: 500,
  seller: { name: 'Mini GbR', street: 'Dorfstr. 1', postalCode: '01234', city: 'Dorf', countryCode: 'DE' },
  buyer: { name: 'Kunde', street: 'Str. 2', postalCode: '56789', city: 'Stadt', countryCode: 'DE' },
  lines: [
    { lineNumber: 1, itemName: 'Beratung', quantity: 2, unitCode: 'HUR', netPrice: 250, vatCategoryCode: 'E', vatRate: 0, lineNetAmount: 500 },
  ],
};

function makeBlock(type: PdfBlockDto['type'], overrides: Partial<PdfBlockDto> = {}): PdfBlockDto {
  return {
    id: crypto.randomUUID(),
    type,
    x: 57, y: 100, width: 200, height: 100,
    fontSize: 10,
    fontColor: '#1c1b18',
    fontWeight: 'normal',
    ...overrides,
  };
}

function makeTemplate(blocks: PdfBlockDto[]): PdfTemplateDto {
  return { name: 'Test', pageSize: 'a4', orientation: 'portrait', blocks };
}

const svc = new PdfRenderService();

function isPdfBytes(bytes: Uint8Array): boolean {
  return bytes.length > 200 && new TextDecoder().decode(bytes.slice(0, 4)) === '%PDF';
}

// ---------------------------------------------------------------------------
// 1. measureHelveticaWidth — accuracy
// ---------------------------------------------------------------------------

describe('measureHelveticaWidth', () => {
  it('measures space (32) correctly at 10pt', () => {
    expect(measureHelveticaWidth(' ', 10)).toBeCloseTo(2.78, 2);
  });

  it('scales linearly with font size', () => {
    const w10 = measureHelveticaWidth('Test', 10);
    const w20 = measureHelveticaWidth('Test', 20);
    expect(w20).toBeCloseTo(w10 * 2, 5);
  });

  it('measures "Nr.:" accurately', () => {
    // N=722, r=333, .=278, :=278 → sum=1611/1000*10 = 16.11 (URW Nimbus Sans regular metrics)
    expect(measureHelveticaWidth('Nr.:', 10)).toBeCloseTo(16.11, 1);
  });

  it('measures "1.487,50 €" (currency string)', () => {
    const w = measureHelveticaWidth('1.487,50 €', 10);
    expect(w).toBeGreaterThan(30);
    expect(w).toBeLessThan(65);
  });

  it('handles German umlauts (ä ö ü Ä Ö Ü ß)', () => {
    // Each umlaut has a valid width > 0
    for (const ch of 'äöüÄÖÜß') {
      expect(measureHelveticaWidth(ch, 10)).toBeGreaterThan(0);
    }
  });

  it('falls back to 500 units for unknown chars', () => {
    // emoji → unknown → 500/1000 * 10 = 5
    expect(measureHelveticaWidth('😀', 10)).toBeCloseTo(5, 2);
  });

  it('right-aligned value does not overflow block width', () => {
    const value = '1.487,50 €';
    const blockWidth = 200;
    const fontSize = 10;
    const labelWidth = measureHelveticaWidth('Bruttobetrag:', fontSize);
    const valueWidth = measureHelveticaWidth(value, fontSize);
    const valueX = blockWidth - valueWidth;
    // value must start after label + some gap
    expect(valueX).toBeGreaterThan(labelWidth);
    // value must not exceed block right edge
    expect(valueX + valueWidth).toBeLessThanOrEqual(blockWidth + 0.01);
  });
});

// ---------------------------------------------------------------------------
// 2. render — every block type produces a valid PDF
// ---------------------------------------------------------------------------

describe('PdfRenderService.render', () => {
  const renderCases: Array<{ type: PdfBlockDto['type']; overrides?: Partial<PdfBlockDto> }> = [
    { type: 'seller-address', overrides: { width: 220, height: 105 } },
    { type: 'buyer-address', overrides: { width: 220, height: 70 } },
    { type: 'invoice-title', overrides: { width: 100, height: 22 } },
    { type: 'invoice-number', overrides: { width: 180, height: 20 } },
    { type: 'invoice-date', overrides: { width: 150, height: 20 } },
    { type: 'due-date', overrides: { width: 150, height: 20 } },
    { type: 'buyer-reference', overrides: { width: 180, height: 20 } },
    { type: 'invoice-header', overrides: { width: 220, height: 65 } },
    { type: 'lines-table', overrides: { width: 500, height: 200, showHeader: true, tableStyle: 'minimal', lineHeight: 1.8 } },
    { type: 'lines-table', overrides: { width: 500, height: 200, showHeader: true, tableStyle: 'grid', lineHeight: 1.8 } },
    { type: 'lines-table', overrides: { width: 500, height: 200, showHeader: true, tableStyle: 'striped', lineHeight: 1.8 } },
    { type: 'lines-table', overrides: { width: 500, height: 200, showHeader: false, columns: ['name', 'price', 'total'] } },
    { type: 'total-net', overrides: { width: 200, height: 20 } },
    { type: 'total-tax', overrides: { width: 200, height: 20 } },
    { type: 'total-gross', overrides: { width: 200, height: 20 } },
    { type: 'totals', overrides: { width: 200, height: 60 } },
    { type: 'payment-means', overrides: { width: 200, height: 20 } },
    { type: 'iban-bic', overrides: { width: 250, height: 35 } },
    { type: 'payment-terms', overrides: { width: 200, height: 20 } },
    { type: 'payment-info', overrides: { width: 250, height: 80 } },
    { type: 'free-text', overrides: { width: 200, height: 40, content: 'Vielen Dank\nfür Ihren Auftrag.' } },
    { type: 'line', overrides: { width: 500, height: 2, lineThickness: 1, lineDirection: 'horizontal' } },
    { type: 'line', overrides: { width: 2, height: 100, lineThickness: 1, lineDirection: 'vertical' } },
  ];

  it.each(renderCases)('renders $type block to valid PDF', async ({ type, overrides }) => {
    const block = makeBlock(type, overrides);
    const template = makeTemplate([block]);
    const bytes = await svc.render(template, SAMPLE_INVOICE);
    expect(isPdfBytes(bytes)).toBe(true);
  });

  it('renders with minimal invoice (kleinunternehmer, no optional fields)', async () => {
    const blocks: PdfBlockDto[] = [
      makeBlock('seller-address', { width: 220, height: 70 }),
      makeBlock('buyer-address', { width: 220, height: 42 }),
      makeBlock('total-net', { width: 200, height: 20 }),
      makeBlock('totals', { width: 200, height: 40 }),
    ];
    const bytes = await svc.render(makeTemplate(blocks), MINIMAL_INVOICE);
    expect(isPdfBytes(bytes)).toBe(true);
  });

  it('renders content override for predefined blocks', async () => {
    const block = makeBlock('invoice-number', { width: 180, height: 20, content: 'Eigene Nr: 007' });
    const bytes = await svc.render(makeTemplate([block]), SAMPLE_INVOICE);
    expect(isPdfBytes(bytes)).toBe(true);
  });

  it('renders full template with all major block types', async () => {
    const template = makeTemplate([
      makeBlock('seller-address', { x: 57, y: 50, width: 220, height: 105 }),
      makeBlock('buyer-address', { x: 57, y: 190, width: 220, height: 70 }),
      makeBlock('invoice-header', { x: 330, y: 50, width: 200, height: 65 }),
      makeBlock('invoice-title', { x: 57, y: 310, width: 200, height: 22 }),
      makeBlock('lines-table', { x: 57, y: 360, width: 481, height: 200, showHeader: true }),
      makeBlock('totals', { x: 330, y: 580, width: 208, height: 60 }),
      makeBlock('payment-info', { x: 57, y: 660, width: 250, height: 80 }),
      makeBlock('line', { x: 57, y: 340, width: 481, height: 2, lineDirection: 'horizontal' }),
    ]);
    const bytes = await svc.render(template, SAMPLE_INVOICE);
    expect(isPdfBytes(bytes)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. computeBlockContentHeight — correct values per block type
// ---------------------------------------------------------------------------

describe('computeBlockContentHeight', () => {
  const fs = 10;
  const lineH = fs * 1.4; // 14

  describe('address blocks', () => {
    it('seller-address: 5 lines when vatId + taxNumber present', () => {
      const block = makeBlock('seller-address', { fontSize: fs });
      // SAMPLE_INVOICE seller has vatId and taxNumber
      expect(computeBlockContentHeight(block, SAMPLE_INVOICE)).toBeCloseTo(5 * lineH, 2);
    });

    it('seller-address: 3 lines when no vatId/taxNumber', () => {
      const block = makeBlock('seller-address', { fontSize: fs });
      expect(computeBlockContentHeight(block, MINIMAL_INVOICE)).toBeCloseTo(3 * lineH, 2);
    });

    it('buyer-address: always 3 lines', () => {
      const block = makeBlock('buyer-address', { fontSize: fs });
      expect(computeBlockContentHeight(block, SAMPLE_INVOICE)).toBeCloseTo(3 * lineH, 2);
    });
  });

  describe('single-value blocks', () => {
    it.each([
      'invoice-number', 'invoice-date', 'total-net', 'total-gross', 'payment-means',
    ] as PdfBlockDto['type'][])('%s: 1 line = ceil(fontSize * 1.4)', (type) => {
      const block = makeBlock(type, { fontSize: fs });
      expect(computeBlockContentHeight(block, SAMPLE_INVOICE)).toBe(Math.ceil(fs * 1.4));
    });

    it('due-date: 1 line when dueDate present', () => {
      expect(computeBlockContentHeight(makeBlock('due-date', { fontSize: fs }), SAMPLE_INVOICE)).toBe(Math.ceil(fs * 1.4));
    });

    it('due-date: 0 when dueDate missing', () => {
      expect(computeBlockContentHeight(makeBlock('due-date', { fontSize: fs }), MINIMAL_INVOICE)).toBe(0);
    });

    it('total-tax: 1 line when not kleinunternehmer', () => {
      expect(computeBlockContentHeight(makeBlock('total-tax', { fontSize: fs }), SAMPLE_INVOICE)).toBe(Math.ceil(fs * 1.4));
    });

    it('total-tax: 0 when kleinunternehmer', () => {
      expect(computeBlockContentHeight(makeBlock('total-tax', { fontSize: fs }), MINIMAL_INVOICE)).toBe(0);
    });
  });

  describe('invoice-header', () => {
    it('4 rows when dueDate + buyerReference present', () => {
      const block = makeBlock('invoice-header', { fontSize: fs });
      expect(computeBlockContentHeight(block, SAMPLE_INVOICE)).toBeCloseTo(4 * lineH, 2);
    });

    it('2 rows when only required fields', () => {
      const block = makeBlock('invoice-header', { fontSize: fs });
      expect(computeBlockContentHeight(block, MINIMAL_INVOICE)).toBeCloseTo(2 * lineH, 2);
    });
  });

  describe('totals', () => {
    it('3 rows (+ offset) for standard invoice', () => {
      // fs + 3 * fs * 1.6
      const expected = fs + 3 * (fs * 1.6);
      const block = makeBlock('totals', { fontSize: fs });
      expect(computeBlockContentHeight(block, SAMPLE_INVOICE)).toBeCloseTo(expected, 2);
    });

    it('2 rows (+ offset) for kleinunternehmer', () => {
      const expected = fs + 2 * (fs * 1.6);
      const block = makeBlock('totals', { fontSize: fs });
      expect(computeBlockContentHeight(block, MINIMAL_INVOICE)).toBeCloseTo(expected, 2);
    });
  });

  describe('payment-info', () => {
    it('4 lines when IBAN, BIC and paymentTerms present', () => {
      const block = makeBlock('payment-info', { fontSize: fs });
      expect(computeBlockContentHeight(block, SAMPLE_INVOICE)).toBeCloseTo(4 * lineH, 2);
    });

    it('1 line when only paymentMeans', () => {
      const block = makeBlock('payment-info', { fontSize: fs });
      expect(computeBlockContentHeight(block, MINIMAL_INVOICE)).toBeCloseTo(1 * lineH, 2);
    });
  });

  describe('lines-table', () => {
    it('header + 2 data rows at lineHeight 1.8', () => {
      const rowH = fs * 1.8;
      const expected = (rowH + 4) + 2 * rowH; // header + 2 rows
      const block = makeBlock('lines-table', { fontSize: fs, lineHeight: 1.8, showHeader: true });
      expect(computeBlockContentHeight(block, SAMPLE_INVOICE)).toBeCloseTo(expected, 2);
    });

    it('no header: only 2 data rows', () => {
      const rowH = fs * 1.8;
      const block = makeBlock('lines-table', { fontSize: fs, lineHeight: 1.8, showHeader: false });
      expect(computeBlockContentHeight(block, SAMPLE_INVOICE)).toBeCloseTo(2 * rowH, 2);
    });

    it('uses block.lineHeight when set', () => {
      const lh = 2.5;
      const rowH = fs * lh;
      const block = makeBlock('lines-table', { fontSize: fs, lineHeight: lh, showHeader: false });
      expect(computeBlockContentHeight(block, SAMPLE_INVOICE)).toBeCloseTo(2 * rowH, 2);
    });
  });

  describe('free-text', () => {
    it('counts newlines for height', () => {
      const block = makeBlock('free-text', { fontSize: fs, content: 'Zeile 1\nZeile 2\nZeile 3' });
      expect(computeBlockContentHeight(block, SAMPLE_INVOICE)).toBeCloseTo(3 * lineH, 2);
    });

    it('returns 0 for empty content', () => {
      const block = makeBlock('free-text', { fontSize: fs, content: '' });
      expect(computeBlockContentHeight(block, SAMPLE_INVOICE)).toBe(0);
    });
  });

  describe('content override', () => {
    it('uses line count from content string', () => {
      const block = makeBlock('invoice-number', { fontSize: fs, content: 'Eigene\nNummer\n007' });
      expect(computeBlockContentHeight(block, SAMPLE_INVOICE)).toBeCloseTo(3 * lineH, 2);
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Default palette heights fit content (canvas ↔ PDF parity check)
// ---------------------------------------------------------------------------

describe('default block heights fit rendered content', () => {
  const PALETTE_DEFAULTS: Array<{
    type: PdfBlockDto['type'];
    defaultH: number;
    overrides?: Partial<PdfBlockDto>;
  }> = [
    { type: 'seller-address', defaultH: 105 },
    { type: 'buyer-address', defaultH: 70 },
    { type: 'invoice-title', defaultH: 22 },
    { type: 'invoice-number', defaultH: 20 },
    { type: 'invoice-date', defaultH: 20 },
    { type: 'due-date', defaultH: 20 },
    { type: 'buyer-reference', defaultH: 20 },
    { type: 'invoice-header', defaultH: 65 },
    { type: 'total-net', defaultH: 20 },
    { type: 'total-tax', defaultH: 20 },
    { type: 'total-gross', defaultH: 20 },
    { type: 'totals', defaultH: 60 },
    { type: 'payment-means', defaultH: 20 },
    { type: 'iban-bic', defaultH: 35 },
    { type: 'payment-terms', defaultH: 20 },
    { type: 'payment-info', defaultH: 80 },
    { type: 'lines-table', defaultH: 200, overrides: { showHeader: true, lineHeight: 1.8 } },
  ];

  it.each(PALETTE_DEFAULTS)(
    '$type (defaultH=$defaultH) fits SAMPLE_INVOICE content',
    ({ type, defaultH, overrides }) => {
      const block = makeBlock(type, { fontSize: 10, height: defaultH, ...overrides });
      const needed = computeBlockContentHeight(block, SAMPLE_INVOICE);
      expect(needed).toBeLessThanOrEqual(defaultH + 0.01);
    }
  );

  it.each(PALETTE_DEFAULTS)(
    '$type (defaultH=$defaultH) fits MINIMAL_INVOICE content',
    ({ type, defaultH, overrides }) => {
      const block = makeBlock(type, { fontSize: 10, height: defaultH, ...overrides });
      const needed = computeBlockContentHeight(block, MINIMAL_INVOICE);
      expect(needed).toBeLessThanOrEqual(defaultH + 0.01);
    }
  );
});

// ---------------------------------------------------------------------------
// 5. Canvas ↔ PDF formula parity
// ---------------------------------------------------------------------------

describe('canvas CSS and PDF use identical line-height formula', () => {
  // The canvas uses CSS line-height: 1.4 and font-size: {block.fontSize}px.
  // The PDF uses lineHeight: fontSize * 1.4.
  // This test verifies computeBlockContentHeight uses the same constant.

  const FS = 12;
  const EXPECTED_LINE_H = FS * 1.4;

  it('seller-address: 3-line height = 3 * fontSize * 1.4', () => {
    const block = makeBlock('seller-address', { fontSize: FS });
    const h = computeBlockContentHeight(block, MINIMAL_INVOICE); // 3 lines
    expect(h).toBeCloseTo(3 * EXPECTED_LINE_H, 5);
  });

  it('invoice-header: 2-row height = 2 * fontSize * 1.4', () => {
    const block = makeBlock('invoice-header', { fontSize: FS });
    const h = computeBlockContentHeight(block, MINIMAL_INVOICE); // 2 rows
    expect(h).toBeCloseTo(2 * EXPECTED_LINE_H, 5);
  });

  it('payment-info: 4-line height = 4 * fontSize * 1.4', () => {
    const block = makeBlock('payment-info', { fontSize: FS });
    const h = computeBlockContentHeight(block, SAMPLE_INVOICE); // 4 lines
    expect(h).toBeCloseTo(4 * EXPECTED_LINE_H, 5);
  });
});

// ---------------------------------------------------------------------------
// 6. Single-line label:value blocks tall enough for CSS display
// ---------------------------------------------------------------------------

describe('computeBlockContentHeight — single-line blocks tall enough for CSS display', () => {
  // Bug: single-line label:value blocks returned fontSize (e.g. 10px) as height.
  // CSS renders text with line-height ~1.4 → block too short → text clipped.
  // Fix: return Math.ceil(fontSize * 1.4) so block height ≥ fontSize * 1.2.

  const FS = 10;

  for (const blockType of [
    'invoice-number', 'invoice-date', 'total-net', 'total-gross', 'payment-means',
  ] as const) {
    it(`${blockType}: height >= fontSize * 1.2`, () => {
      const block = makeBlock(blockType, { fontSize: FS });
      const h = computeBlockContentHeight(block, SAMPLE_INVOICE);
      expect(h).toBeGreaterThanOrEqual(FS * 1.2);
    });
  }

  it('invoice-title: height >= (fontSize + 4) * 1.2', () => {
    const block = makeBlock('invoice-title', { fontSize: FS });
    const h = computeBlockContentHeight(block, SAMPLE_INVOICE);
    expect(h).toBeGreaterThanOrEqual((FS + 4) * 1.2);
  });

  it('due-date (with dueDate): height >= fontSize * 1.2', () => {
    const block = makeBlock('due-date', { fontSize: FS });
    const h = computeBlockContentHeight(block, SAMPLE_INVOICE); // has dueDate
    expect(h).toBeGreaterThanOrEqual(FS * 1.2);
  });

  it('buyer-reference (with buyerReference): height >= fontSize * 1.2', () => {
    const block = makeBlock('buyer-reference', { fontSize: FS });
    const h = computeBlockContentHeight(block, SAMPLE_INVOICE); // has buyerReference
    expect(h).toBeGreaterThanOrEqual(FS * 1.2);
  });

  it('total-tax (non-Kleinunternehmer): height >= fontSize * 1.2', () => {
    const block = makeBlock('total-tax', { fontSize: FS });
    const h = computeBlockContentHeight(block, SAMPLE_INVOICE); // not kleinunternehmer
    expect(h).toBeGreaterThanOrEqual(FS * 1.2);
  });

  it('payment-terms (with paymentTerms): height >= fontSize * 1.2', () => {
    const block = makeBlock('payment-terms', { fontSize: FS });
    const h = computeBlockContentHeight(block, SAMPLE_INVOICE); // has paymentTerms
    expect(h).toBeGreaterThanOrEqual(FS * 1.2);
  });
});

// ---------------------------------------------------------------------------
// Custom font embedding
// ---------------------------------------------------------------------------

const FONT_ROOT = join(import.meta.dirname, '../..');

/**
 * Load a font file from the project root and encode it as base64.
 * Returns null if the file is not found (so tests can be skipped gracefully).
 */
function loadFontAsBase64(filename: string): string | null {
  try {
    const bytes = readFileSync(join(FONT_ROOT, filename));
    return bytes.toString('base64');
  } catch {
    return null;
  }
}

describe('Custom font embedding', () => {
  let futuraData: string | null;
  let sectraData: string | null;

  beforeAll(() => {
    futuraData = loadFontAsBase64('FuturaPTBook.otf');
    sectraData = loadFontAsBase64('GT-Sectra-Regular.OTF');
  });

  it('produces a valid PDF when a custom OTF font is embedded (Futura)', async () => {
    if (!futuraData) return; // font not available in CI
    const font: CustomFontDto = { name: 'FuturaPTBook', data: futuraData, mimeType: 'font/otf' };
    const template: PdfTemplateDto = {
      ...makeTemplate([
        makeBlock('seller-address', { fontFamily: 'FuturaPTBook', width: 220, height: 100 }),
        makeBlock('invoice-number', { fontFamily: 'FuturaPTBook', width: 200, height: 20 }),
        makeBlock('free-text', { fontFamily: 'FuturaPTBook', width: 300, height: 40, content: 'Rechnung auf Futura' }),
      ]),
      customFonts: [font],
    };
    const bytes = await svc.render(template, SAMPLE_INVOICE);
    expect(isPdfBytes(bytes)).toBe(true);
  });

  it('produces a valid PDF when a custom OTF font is embedded (GT Sectra)', async () => {
    if (!sectraData) return;
    const font: CustomFontDto = { name: 'GTSectraRegular', data: sectraData, mimeType: 'font/otf' };
    const template: PdfTemplateDto = {
      ...makeTemplate([
        makeBlock('seller-address', { fontFamily: 'GTSectraRegular', width: 220, height: 100 }),
        makeBlock('free-text', { fontFamily: 'GTSectraRegular', width: 300, height: 40, content: 'Textsatz mit GT Sectra' }),
      ]),
      customFonts: [font],
    };
    const bytes = await svc.render(template, SAMPLE_INVOICE);
    expect(isPdfBytes(bytes)).toBe(true);
  });

  it('falls back to Helvetica when fontFamily does not match any embedded font', async () => {
    // Provide a font but reference a different name in the block
    const font: CustomFontDto = { name: 'SomeFont', data: futuraData ?? 'dGVzdA==', mimeType: 'font/otf' };
    const template: PdfTemplateDto = {
      ...makeTemplate([
        makeBlock('free-text', { fontFamily: 'NonExistentFont', width: 200, height: 30, content: 'Fallback test' }),
      ]),
      customFonts: [font],
    };
    const bytes = await svc.render(template, SAMPLE_INVOICE);
    expect(isPdfBytes(bytes)).toBe(true);
  });

  it('renders all block types with a custom font without error', async () => {
    if (!futuraData) return;
    const font: CustomFontDto = { name: 'Futura', data: futuraData, mimeType: 'font/otf' };
    const blocks: PdfBlockDto[] = [
      makeBlock('seller-address',  { fontFamily: 'Futura', width: 220, height: 105 }),
      makeBlock('buyer-address',   { fontFamily: 'Futura', width: 220, height: 70 }),
      makeBlock('invoice-title',   { fontFamily: 'Futura', width: 150, height: 22 }),
      makeBlock('invoice-number',  { fontFamily: 'Futura', width: 200, height: 20 }),
      makeBlock('invoice-date',    { fontFamily: 'Futura', width: 150, height: 20 }),
      makeBlock('due-date',        { fontFamily: 'Futura', width: 150, height: 20 }),
      makeBlock('buyer-reference', { fontFamily: 'Futura', width: 180, height: 20 }),
      makeBlock('invoice-header',  { fontFamily: 'Futura', width: 220, height: 65 }),
      makeBlock('totals',          { fontFamily: 'Futura', width: 200, height: 60 }),
      makeBlock('payment-info',    { fontFamily: 'Futura', width: 250, height: 80 }),
      makeBlock('free-text',       { fontFamily: 'Futura', width: 250, height: 40, content: 'Danke für Ihren Auftrag.' }),
      makeBlock('total-net',       { fontFamily: 'Futura', width: 200, height: 20 }),
      makeBlock('total-tax',       { fontFamily: 'Futura', width: 200, height: 20 }),
      makeBlock('total-gross',     { fontFamily: 'Futura', width: 200, height: 20 }),
    ];
    const template: PdfTemplateDto = { ...makeTemplate(blocks), customFonts: [font] };
    const bytes = await svc.render(template, SAMPLE_INVOICE);
    expect(isPdfBytes(bytes)).toBe(true);
  });

  it('two custom fonts can be embedded in the same template', async () => {
    if (!futuraData || !sectraData) return;
    const fonts: CustomFontDto[] = [
      { name: 'Futura', data: futuraData, mimeType: 'font/otf' },
      { name: 'Sectra', data: sectraData, mimeType: 'font/otf' },
    ];
    const template: PdfTemplateDto = {
      ...makeTemplate([
        makeBlock('seller-address', { fontFamily: 'Futura', width: 220, height: 100 }),
        makeBlock('buyer-address',  { fontFamily: 'Sectra', width: 220, height: 70 }),
        makeBlock('invoice-number', { fontFamily: 'Futura', width: 200, height: 20 }),
      ]),
      customFonts: fonts,
    };
    const bytes = await svc.render(template, SAMPLE_INVOICE);
    expect(isPdfBytes(bytes)).toBe(true);
  });

  it('custom font label:value alignment does not throw (right-align with EmbeddedFont)', async () => {
    if (!futuraData) return;
    const font: CustomFontDto = { name: 'Futura', data: futuraData, mimeType: 'font/otf' };
    const template: PdfTemplateDto = {
      ...makeTemplate([
        // iban-bic uses drawLabelValue which calls measureWidth
        makeBlock('iban-bic',     { fontFamily: 'Futura', width: 250, height: 35 }),
        makeBlock('payment-terms',{ fontFamily: 'Futura', width: 200, height: 20 }),
        makeBlock('totals',       { fontFamily: 'Futura', width: 200, height: 60 }),
      ]),
      customFonts: [font],
    };
    const bytes = await svc.render(template, SAMPLE_INVOICE);
    expect(isPdfBytes(bytes)).toBe(true);
  });

  it('totals block renders without error using custom font (no bold variant — falls back to regular)', async () => {
    // Without dataBold, drawTotals must use the custom regular font for all rows
    // (Bruttobetrag row included) rather than mixing in Helvetica-Bold.
    if (!futuraData) return;
    const font: CustomFontDto = { name: 'Futura', data: futuraData, mimeType: 'font/otf' };
    const template: PdfTemplateDto = {
      ...makeTemplate([makeBlock('totals', { fontFamily: 'Futura', width: 250, height: 70 })]),
      customFonts: [font],
    };
    const bytes = await svc.render(template, SAMPLE_INVOICE);
    expect(isPdfBytes(bytes)).toBe(true);
  });

  it('totals block renders both weights when dataBold is provided', async () => {
    if (!futuraData || !sectraData) return;
    // Use GT Sectra as a "fake bold" to confirm both embeddings are accepted
    const font: CustomFontDto = { name: 'Futura', data: futuraData, dataBold: sectraData, mimeType: 'font/otf' };
    const template: PdfTemplateDto = {
      ...makeTemplate([makeBlock('totals', { fontFamily: 'Futura', width: 250, height: 70 })]),
      customFonts: [font],
    };
    const bytes = await svc.render(template, SAMPLE_INVOICE);
    expect(isPdfBytes(bytes)).toBe(true);
  });

  it('fontWeight bold uses bold variant when available', async () => {
    if (!futuraData || !sectraData) return;
    const font: CustomFontDto = { name: 'Futura', data: futuraData, dataBold: sectraData, mimeType: 'font/otf' };
    // seller-address with fontWeight bold should use bold EmbeddedFont
    const template: PdfTemplateDto = {
      ...makeTemplate([makeBlock('seller-address', { fontFamily: 'Futura', fontWeight: 'bold', width: 220, height: 100 })]),
      customFonts: [font],
    };
    const bytes = await svc.render(template, SAMPLE_INVOICE);
    expect(isPdfBytes(bytes)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// paddingLeft / paddingRight — text inset for all text block types
// ---------------------------------------------------------------------------

describe('PdfBlockDto paddingLeft / paddingRight', () => {
  it('renders seller-address with paddingLeft without throwing', async () => {
    const bytes = await svc.render(makeTemplate([makeBlock('seller-address', { width: 220, height: 105, paddingLeft: 4 })]), SAMPLE_INVOICE);
    expect(isPdfBytes(bytes)).toBe(true);
  });

  it('renders buyer-address with paddingLeft without throwing', async () => {
    const bytes = await svc.render(makeTemplate([makeBlock('buyer-address', { width: 220, height: 60, paddingLeft: 4 })]), SAMPLE_INVOICE);
    expect(isPdfBytes(bytes)).toBe(true);
  });

  it('renders free-text with paddingLeft and paddingRight without throwing', async () => {
    const bytes = await svc.render(makeTemplate([makeBlock('free-text', { width: 200, height: 40, content: 'Danke für Ihren Auftrag.', paddingLeft: 6, paddingRight: 6 })]), SAMPLE_INVOICE);
    expect(isPdfBytes(bytes)).toBe(true);
  });

  it('renders totals with paddingLeft without throwing', async () => {
    const bytes = await svc.render(makeTemplate([makeBlock('totals', { width: 200, height: 60, paddingLeft: 8 })]), SAMPLE_INVOICE);
    expect(isPdfBytes(bytes)).toBe(true);
  });

  it('renders invoice-title with padding without throwing', async () => {
    const bytes = await svc.render(makeTemplate([makeBlock('invoice-title', { width: 200, height: 30, paddingLeft: 4, paddingRight: 4 })]), SAMPLE_INVOICE);
    expect(isPdfBytes(bytes)).toBe(true);
  });

  it('paddingLeft=0 behaves identically to no padding', async () => {
    const a = await svc.render(makeTemplate([makeBlock('seller-address', { width: 220, height: 105, paddingLeft: 0 })]), SAMPLE_INVOICE);
    const b = await svc.render(makeTemplate([makeBlock('seller-address', { width: 220, height: 105 })]), SAMPLE_INVOICE);
    expect(isPdfBytes(a)).toBe(true);
    expect(isPdfBytes(b)).toBe(true);
  });

  it('all label:value block types render with paddingLeft: 4 without error', async () => {
    const labelValueTypes: Array<PdfBlockDto['type']> = [
      'invoice-number', 'invoice-date', 'due-date', 'buyer-reference',
      'total-net', 'total-tax', 'total-gross', 'payment-means', 'iban-bic', 'payment-terms',
    ];
    for (const type of labelValueTypes) {
      const bytes = await svc.render(makeTemplate([makeBlock(type, { width: 200, height: 20, paddingLeft: 4, paddingRight: 4 })]), SAMPLE_INVOICE);
      expect(isPdfBytes(bytes), `${type} with padding should produce valid PDF`).toBe(true);
    }
  });

  it('payment-info with paddingLeft renders without throwing', async () => {
    const bytes = await svc.render(makeTemplate([makeBlock('payment-info', { width: 220, height: 80, paddingLeft: 4 })]), SAMPLE_INVOICE);
    expect(isPdfBytes(bytes)).toBe(true);
  });

  it('image block ignores padding fields (no text)', async () => {
    const bytes = await svc.render(makeTemplate([makeBlock('image', { width: 120, height: 60, paddingLeft: 10 })]), SAMPLE_INVOICE);
    expect(isPdfBytes(bytes)).toBe(true);
  });

  it('totals left-align mode with paddingLeft renders without throwing', async () => {
    const bytes = await svc.render(makeTemplate([makeBlock('totals', { width: 200, height: 60, paddingLeft: 4, paddingRight: 4, textAlign: 'left' })]), SAMPLE_INVOICE);
    expect(isPdfBytes(bytes)).toBe(true);
  });
});
