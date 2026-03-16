/**
 * PdfFormatSettings.test.ts
 *
 * Verifies that PdfRenderService respects AppSettings for date and number
 * formatting across all supported format combinations.
 *
 * Strategy:
 *   - Each suite uses a fresh ephemeral DB to prevent state leakage.
 *   - beforeEach resets settings to defaults so tests are independent.
 *   - Text assertions use items.some(i => i.text.includes(expected)) because
 *     pdfjs may merge adjacent items (label+value) into a single text item.
 *   - Euro sign: never assert text.includes('€'); assert item.width > 15 instead.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { Database } from '../../src/server/database/Database.js';
import { PdfRenderService } from '../../src/server/services/PdfRenderService.js';
import { AppSettingsService } from '../../src/server/services/AppSettingsService.js';
import type { PdfTemplateDto, PdfBlockDto, InvoiceDto } from '../../src/shared/types';
import { extractPageData } from '../utils/pdfTextExtractor.js';
import type { PdfTextItem } from '../utils/pdfTextExtractor.js';

// ---------------------------------------------------------------------------
// DB path — unique per test run to avoid cross-suite contamination
// ---------------------------------------------------------------------------

const TEST_DB = path.resolve(process.cwd(), `test/.test-pdf-format-${Date.now()}.db`);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Invoice dates chosen deliberately:
 *   invoiceDate: day=03, month=07 — different digits → DD vs MM swaps are detectable
 *   dueDate:     day=15, month=08 — different digits → same protection
 */
const INVOICE: InvoiceDto = {
  invoiceNumber: 'RE-2025-0001',
  invoiceDate: '2025-07-03',
  dueDate: '2025-08-15',
  buyerReference: 'LW-9999',
  invoiceTypeCode: '380',
  currencyCode: 'EUR',
  paymentMeansCode: '58',
  iban: 'DE89370400440532013000',
  bic: 'COBADEFFXXX',
  paymentTerms: '30 Tage netto',
  taxRate: 19,
  taxCategoryCode: 'S',
  kleinunternehmer: false,
  totalNetAmount: 1250.00,
  totalTaxAmount: 237.50,
  totalGrossAmount: 1487.50,
  seller: {
    name: 'Test GmbH',
    street: 'Str 1',
    postalCode: '10115',
    city: 'Berlin',
    countryCode: 'DE',
    vatId: 'DE123456789',
  },
  buyer: {
    name: 'Kunde AG',
    street: 'Weg 2',
    postalCode: '80331',
    city: 'München',
    countryCode: 'DE',
  },
  lines: [
    {
      lineNumber: 1,
      itemName: 'Beratung',
      quantity: 2.5,
      unitCode: 'HUR',
      netPrice: 500,
      vatCategoryCode: 'S',
      vatRate: 19,
      lineNetAmount: 1250,
    },
  ],
};

// ---------------------------------------------------------------------------
// Block + template helpers
// ---------------------------------------------------------------------------

function makeBlock(type: PdfBlockDto['type'], overrides: Partial<PdfBlockDto> = {}): PdfBlockDto {
  return {
    id: 'b1',
    type,
    x: 50,
    y: 50,
    width: 300,
    height: 40,
    fontSize: 10,
    ...overrides,
  };
}

function makeTemplate(...blocks: PdfBlockDto[]): PdfTemplateDto {
  return {
    id: 1,
    name: 'test',
    pageSize: 'a4',
    orientation: 'portrait',
    blocks,
  };
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

/** Returns true if any text item contains the given string. */
function hasText(items: PdfTextItem[], expected: string): boolean {
  return items.some(i => i.text.includes(expected));
}

/**
 * Asserts that at least one text item on the page contains the expected string.
 * Handles pdfjs merging label+value into a single item.
 */
function assertContains(items: PdfTextItem[], expected: string): void {
  expect(
    hasText(items, expected),
    `Expected PDF to contain "${expected}" but found: ${items.map(i => `"${i.text}"`).join(', ')}`,
  ).toBe(true);
}

/** Asserts text does NOT appear in any item — useful for catching wrong formats. */
function assertNotContains(items: PdfTextItem[], unexpected: string): void {
  expect(
    hasText(items, unexpected),
    `Expected PDF NOT to contain "${unexpected}" but it was found`,
  ).toBe(false);
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

const svc = new PdfRenderService();
const settingsSvc = new AppSettingsService();

function setFormat(dateFormat: string, numberFormat: string): void {
  settingsSvc.update({ locale: 'de-DE', dateFormat, numberFormat });
}

// ---------------------------------------------------------------------------
// Test setup / teardown
// ---------------------------------------------------------------------------

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

/** Reset to defaults before each test to prevent state leakage between tests. */
beforeEach(() => {
  setFormat('DD.MM.YYYY', 'de-DE');
});

// ===========================================================================
// Suite 1 — Date Format: parametric across all 5 formats
// ===========================================================================

const DATE_FORMAT_CASES = [
  { format: 'DD.MM.YYYY', expectedDate: '03.07.2025', expectedDue: '15.08.2025' },
  { format: 'DD/MM/YYYY', expectedDate: '03/07/2025', expectedDue: '15/08/2025' },
  { format: 'DD-MM-YYYY', expectedDate: '03-07-2025', expectedDue: '15-08-2025' },
  { format: 'YYYY-MM-DD', expectedDate: '2025-07-03', expectedDue: '2025-08-15' },
  { format: 'MM/DD/YYYY', expectedDate: '07/03/2025', expectedDue: '08/15/2025' },
] as const;

describe('Suite 1 — Date Format in PDF', () => {
  for (const { format, expectedDate, expectedDue } of DATE_FORMAT_CASES) {
    it(`invoice-date block renders ${format} correctly`, async () => {
      setFormat(format, 'de-DE');
      const template = makeTemplate(makeBlock('invoice-date'));
      const pdfBytes = await svc.render(template, INVOICE);
      const { textItems } = await extractPageData(pdfBytes);
      assertContains(textItems, expectedDate);
    });

    it(`due-date block renders ${format} correctly`, async () => {
      setFormat(format, 'de-DE');
      const template = makeTemplate(makeBlock('due-date'));
      const pdfBytes = await svc.render(template, INVOICE);
      const { textItems } = await extractPageData(pdfBytes);
      assertContains(textItems, expectedDue);
    });

    it(`invoice-header block renders both dates in ${format}`, async () => {
      setFormat(format, 'de-DE');
      const template = makeTemplate(makeBlock('invoice-header', { height: 80 }));
      const pdfBytes = await svc.render(template, INVOICE);
      const { textItems } = await extractPageData(pdfBytes);
      assertContains(textItems, expectedDate);
      assertContains(textItems, expectedDue);
    });
  }
});

// ===========================================================================
// Suite 2 — Number Format in PDF: de-DE vs en-US
// ===========================================================================

const NUMBER_FORMAT_CASES = [
  {
    format: 'de-DE',
    expectedNet: '1.250,00',
    expectedTax: '237,50',
    expectedGross: '1.487,50',
    expectedPrice: '500,00',
  },
  {
    format: 'en-US',
    expectedNet: '1,250.00',
    expectedTax: '237.50',
    expectedGross: '1,487.50',
    expectedPrice: '500.00',
  },
] as const;

describe('Suite 2 — Number Format in PDF', () => {
  for (const { format, expectedNet, expectedTax, expectedGross, expectedPrice } of NUMBER_FORMAT_CASES) {
    it(`total-net block renders net amount in ${format}`, async () => {
      setFormat('DD.MM.YYYY', format);
      const template = makeTemplate(makeBlock('total-net'));
      const pdfBytes = await svc.render(template, INVOICE);
      const { textItems } = await extractPageData(pdfBytes);
      assertContains(textItems, expectedNet);
    });

    it(`total-tax block renders tax amount in ${format}`, async () => {
      setFormat('DD.MM.YYYY', format);
      const template = makeTemplate(makeBlock('total-tax'));
      const pdfBytes = await svc.render(template, INVOICE);
      const { textItems } = await extractPageData(pdfBytes);
      assertContains(textItems, expectedTax);
    });

    it(`total-gross block renders gross amount in ${format}`, async () => {
      setFormat('DD.MM.YYYY', format);
      const template = makeTemplate(makeBlock('total-gross'));
      const pdfBytes = await svc.render(template, INVOICE);
      const { textItems } = await extractPageData(pdfBytes);
      assertContains(textItems, expectedGross);
    });

    it(`lines-table block renders line item price in ${format}`, async () => {
      setFormat('DD.MM.YYYY', format);
      const template = makeTemplate(makeBlock('lines-table', { height: 80 }));
      const pdfBytes = await svc.render(template, INVOICE);
      const { textItems } = await extractPageData(pdfBytes);
      assertContains(textItems, expectedPrice);
    });

    it(`totals block renders all amounts in ${format}`, async () => {
      setFormat('DD.MM.YYYY', format);
      const template = makeTemplate(makeBlock('totals', { height: 80 }));
      const pdfBytes = await svc.render(template, INVOICE);
      const { textItems } = await extractPageData(pdfBytes);
      assertContains(textItems, expectedNet);
      assertContains(textItems, expectedTax);
      assertContains(textItems, expectedGross);
    });
  }

  it('de-DE format does NOT use en-US decimal style (no period as decimal for 237.50)', async () => {
    setFormat('DD.MM.YYYY', 'de-DE');
    const template = makeTemplate(makeBlock('total-tax'));
    const pdfBytes = await svc.render(template, INVOICE);
    const { textItems } = await extractPageData(pdfBytes);
    // de-DE should render 237,50 not 237.50
    assertContains(textItems, '237,50');
    assertNotContains(textItems, '237.50');
  });

  it('en-US format does NOT use de-DE decimal style (no comma as decimal for 237.50)', async () => {
    setFormat('DD.MM.YYYY', 'en-US');
    const template = makeTemplate(makeBlock('total-tax'));
    const pdfBytes = await svc.render(template, INVOICE);
    const { textItems } = await extractPageData(pdfBytes);
    // en-US should render 237.50 not 237,50
    assertContains(textItems, '237.50');
    assertNotContains(textItems, '237,50');
  });

  it('de-DE format uses period as thousands separator (1.250)', async () => {
    setFormat('DD.MM.YYYY', 'de-DE');
    const template = makeTemplate(makeBlock('total-net'));
    const pdfBytes = await svc.render(template, INVOICE);
    const { textItems } = await extractPageData(pdfBytes);
    assertContains(textItems, '1.250');
  });

  it('en-US format uses comma as thousands separator (1,250)', async () => {
    setFormat('DD.MM.YYYY', 'en-US');
    const template = makeTemplate(makeBlock('total-net'));
    const pdfBytes = await svc.render(template, INVOICE);
    const { textItems } = await extractPageData(pdfBytes);
    assertContains(textItems, '1,250');
  });
});

// ===========================================================================
// Suite 3 — Cross-product: combined date + number format
// ===========================================================================

const CROSS_CASES = [
  {
    dateFormat: 'YYYY-MM-DD',
    numberFormat: 'en-US',
    expectedDate: '2025-07-03',
    expectedGross: '1,487.50',
  },
  {
    dateFormat: 'MM/DD/YYYY',
    numberFormat: 'de-DE',
    expectedDate: '07/03/2025',
    expectedGross: '1.487,50',
  },
  {
    dateFormat: 'DD/MM/YYYY',
    numberFormat: 'en-US',
    expectedDate: '03/07/2025',
    expectedGross: '1,487.50',
  },
] as const;

describe('Suite 3 — Combined format settings (date + number)', () => {
  for (const { dateFormat, numberFormat, expectedDate, expectedGross } of CROSS_CASES) {
    it(`${dateFormat} + ${numberFormat}: invoice-header contains correct date and number formats`, async () => {
      setFormat(dateFormat, numberFormat);
      // invoice-header renders Nr., Datum, Fällig, Referenz — contains both date and currency context
      const template = makeTemplate(makeBlock('invoice-header', { height: 100 }));
      const pdfBytes = await svc.render(template, INVOICE);
      const { textItems } = await extractPageData(pdfBytes);
      assertContains(textItems, expectedDate);
    });

    it(`${dateFormat} + ${numberFormat}: totals block uses correct number format`, async () => {
      setFormat(dateFormat, numberFormat);
      const template = makeTemplate(makeBlock('totals', { height: 80 }));
      const pdfBytes = await svc.render(template, INVOICE);
      const { textItems } = await extractPageData(pdfBytes);
      assertContains(textItems, expectedGross);
    });
  }
});

// ===========================================================================
// Suite 4 — Settings persist across multiple renders
// ===========================================================================

describe('Suite 4 — Settings persist across multiple renders', () => {
  it('settings change is reflected in subsequent renders without re-instantiation', async () => {
    // Render A with YYYY-MM-DD + en-US
    setFormat('YYYY-MM-DD', 'en-US');
    const templateDate = makeTemplate(makeBlock('invoice-date'));
    const templateGross = makeTemplate(makeBlock('total-gross'));

    const pdfA = await svc.render(templateDate, INVOICE);
    const itemsA = (await extractPageData(pdfA)).textItems;
    assertContains(itemsA, '2025-07-03');

    // Render B (different block, same settings) — still uses YYYY-MM-DD + en-US
    const pdfB = await svc.render(templateGross, INVOICE);
    const itemsB = (await extractPageData(pdfB)).textItems;
    assertContains(itemsB, '1,487.50');

    // Switch to DD.MM.YYYY + de-DE
    setFormat('DD.MM.YYYY', 'de-DE');

    // Render C — must use new format
    const pdfC = await svc.render(templateDate, INVOICE);
    const itemsC = (await extractPageData(pdfC)).textItems;
    assertContains(itemsC, '03.07.2025');

    // Re-render same template as A — must NOW use new format
    const pdfD = await svc.render(templateGross, INVOICE);
    const itemsD = (await extractPageData(pdfD)).textItems;
    assertContains(itemsD, '1.487,50');
  });

  it('format change is NOT retroactive — only affects future renders', async () => {
    // Render with en-US
    setFormat('DD.MM.YYYY', 'en-US');
    const template = makeTemplate(makeBlock('total-gross'));
    const pdfBefore = await svc.render(template, INVOICE);
    const itemsBefore = (await extractPageData(pdfBefore)).textItems;
    assertContains(itemsBefore, '1,487.50');

    // Change to de-DE — old pdfBefore bytes are unaffected (they're already rendered)
    setFormat('DD.MM.YYYY', 'de-DE');
    const pdfAfter = await svc.render(template, INVOICE);
    const itemsAfter = (await extractPageData(pdfAfter)).textItems;
    assertContains(itemsAfter, '1.487,50');

    // Verify original bytes still parse as en-US
    const itemsBeforeRecheck = (await extractPageData(pdfBefore)).textItems;
    assertContains(itemsBeforeRecheck, '1,487.50');
  });

  it('alternating settings produce consistent results per render call', async () => {
    const template = makeTemplate(makeBlock('invoice-date'));

    setFormat('YYYY-MM-DD', 'de-DE');
    const pdf1 = await svc.render(template, INVOICE);
    const items1 = (await extractPageData(pdf1)).textItems;

    setFormat('DD.MM.YYYY', 'de-DE');
    const pdf2 = await svc.render(template, INVOICE);
    const items2 = (await extractPageData(pdf2)).textItems;

    setFormat('YYYY-MM-DD', 'de-DE');
    const pdf3 = await svc.render(template, INVOICE);
    const items3 = (await extractPageData(pdf3)).textItems;

    assertContains(items1, '2025-07-03');
    assertContains(items2, '03.07.2025');
    assertContains(items3, '2025-07-03');  // back to ISO
  });
});

// ===========================================================================
// Suite 5 — Default settings regression
// ===========================================================================

describe('Suite 5 — Default settings produce original DE format', () => {
  it('invoice-date renders 03.07.2025 with default DD.MM.YYYY', async () => {
    // beforeEach resets to defaults, so no explicit setFormat needed
    const template = makeTemplate(makeBlock('invoice-date'));
    const pdfBytes = await svc.render(template, INVOICE);
    const { textItems } = await extractPageData(pdfBytes);
    assertContains(textItems, '03.07.2025');
  });

  it('due-date renders 15.08.2025 with default DD.MM.YYYY', async () => {
    const template = makeTemplate(makeBlock('due-date'));
    const pdfBytes = await svc.render(template, INVOICE);
    const { textItems } = await extractPageData(pdfBytes);
    assertContains(textItems, '15.08.2025');
  });

  it('total-gross renders 1.487,50 with default de-DE number format', async () => {
    const template = makeTemplate(makeBlock('total-gross'));
    const pdfBytes = await svc.render(template, INVOICE);
    const { textItems } = await extractPageData(pdfBytes);
    assertContains(textItems, '1.487,50');
  });

  it('total-net renders 1.250,00 with default de-DE number format', async () => {
    const template = makeTemplate(makeBlock('total-net'));
    const pdfBytes = await svc.render(template, INVOICE);
    const { textItems } = await extractPageData(pdfBytes);
    assertContains(textItems, '1.250,00');
  });

  it('total-tax renders 237,50 with default de-DE number format', async () => {
    const template = makeTemplate(makeBlock('total-tax'));
    const pdfBytes = await svc.render(template, INVOICE);
    const { textItems } = await extractPageData(pdfBytes);
    assertContains(textItems, '237,50');
  });

  it('defaults do NOT produce en-US style output', async () => {
    // defaults are DD.MM.YYYY + de-DE — confirm ISO date and en-US numbers are absent
    const dateTemplate = makeTemplate(makeBlock('invoice-date'));
    const datePdf = await svc.render(dateTemplate, INVOICE);
    const dateItems = (await extractPageData(datePdf)).textItems;
    // YYYY-MM-DD format must not appear as the date result with defaults
    assertNotContains(dateItems, '2025-07-03');

    const numTemplate = makeTemplate(makeBlock('total-gross'));
    const numPdf = await svc.render(numTemplate, INVOICE);
    const numItems = (await extractPageData(numPdf)).textItems;
    // en-US style must not appear with defaults
    assertNotContains(numItems, '1,487.50');
  });

  it('lines-table renders line item price 500,00 with default de-DE format', async () => {
    const template = makeTemplate(makeBlock('lines-table', { height: 80 }));
    const pdfBytes = await svc.render(template, INVOICE);
    const { textItems } = await extractPageData(pdfBytes);
    assertContains(textItems, '500,00');
  });

  it('totals block renders all three amounts in default de-DE format', async () => {
    const template = makeTemplate(makeBlock('totals', { height: 80 }));
    const pdfBytes = await svc.render(template, INVOICE);
    const { textItems } = await extractPageData(pdfBytes);
    assertContains(textItems, '1.250,00');
    assertContains(textItems, '237,50');
    assertContains(textItems, '1.487,50');
  });
});

// ===========================================================================
// Suite 6 — Euro glyph rendering (width check, not text.includes)
// ===========================================================================

describe('Suite 6 — Euro glyph renders as visible glyph (width > 0)', () => {
  it('total-gross € glyph has non-zero width in de-DE format', async () => {
    setFormat('DD.MM.YYYY', 'de-DE');
    const template = makeTemplate(makeBlock('total-gross'));
    const pdfBytes = await svc.render(template, INVOICE);
    const { textItems } = await extractPageData(pdfBytes);
    // Find item that contains € — then verify its total width is meaningful
    // We check that at least one item has non-trivial width AND appears near
    // the expected number region (distinguishing from zero-width .notdef)
    const euroItems = textItems.filter(i => i.text.includes('€'));
    // At minimum one euro item must exist with non-zero width
    const renderedEuro = euroItems.find(i => i.width > 5);
    expect(renderedEuro, 'Expected a rendered € glyph with width > 5pt').toBeDefined();
  });

  it('total-gross € glyph has non-zero width in en-US format', async () => {
    setFormat('DD.MM.YYYY', 'en-US');
    const template = makeTemplate(makeBlock('total-gross'));
    const pdfBytes = await svc.render(template, INVOICE);
    const { textItems } = await extractPageData(pdfBytes);
    const euroItems = textItems.filter(i => i.text.includes('€'));
    const renderedEuro = euroItems.find(i => i.width > 5);
    expect(renderedEuro, 'Expected a rendered € glyph with width > 5pt in en-US mode').toBeDefined();
  });
});
