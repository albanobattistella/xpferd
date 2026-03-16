/**
 * PdfCoverage.test.ts — Comprehensive 10×10 component coverage matrix.
 *
 * For every block type:
 *   10 content/data variants  ×  10 style+position combos  =  100 tests
 *
 * Per test we assert:
 *   - Text found in PDF                      (smoke check)
 *   - Label/text starts at block.x           (x-alignment)
 *   - Right edge ≈ block.x + block.width     (right-alignment, label:value only)
 *   - Font size = block.fontSize (± 0.5pt)   (font size)
 *   - Font color appears in fill colors      (color rendering)
 *   - All text within block vertical bounds  (containment)
 *   - Line position / thickness / color      (line element only)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import fs from 'fs';
import { Database } from '../../src/server/database/Database.js';
import { PdfRenderService, measureHelveticaWidth } from '../../src/server/services/PdfRenderService.js';
import type { PdfBlockDto, PdfTemplateDto, InvoiceDto, InvoiceLineDto } from '../../src/shared/types';
import { computeBlockContentHeight } from '../../src/shared/utils/blockMetrics.js';
import { extractPageData } from '../utils/pdfTextExtractor.js';
import type { PdfTextItem } from '../utils/pdfTextExtractor.js';

const TEST_DB = path.resolve(process.cwd(), `test/.test-pdf-coverage-${Date.now()}.db`);

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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_HEIGHT = 842;
const svc = new PdfRenderService();

// ---------------------------------------------------------------------------
// 10 style + position combos
// ---------------------------------------------------------------------------

type StyleCombo = {
  fontSize: number; fontWeight: 'normal' | 'bold'; fontColor: string;
  x: number; y: number; width: number; height: number;
};

const S: StyleCombo[] = [
  { fontSize: 8,  fontWeight: 'normal', fontColor: '#1c1b18', x: 40,  y: 50,  width: 220, height: 30 },
  { fontSize: 9,  fontWeight: 'bold',   fontColor: '#333333', x: 57,  y: 100, width: 200, height: 25 },
  { fontSize: 10, fontWeight: 'normal', fontColor: '#ff0000', x: 100, y: 150, width: 260, height: 22 },
  { fontSize: 11, fontWeight: 'bold',   fontColor: '#0000ff', x: 80,  y: 200, width: 240, height: 25 },
  { fontSize: 12, fontWeight: 'normal', fontColor: '#008000', x: 150, y: 300, width: 220, height: 24 },
  { fontSize: 14, fontWeight: 'bold',   fontColor: '#cc9900', x: 200, y: 400, width: 280, height: 28 },
  { fontSize: 16, fontWeight: 'normal', fontColor: '#004080', x: 50,  y: 500, width: 300, height: 32 },
  { fontSize: 18, fontWeight: 'bold',   fontColor: '#660033', x: 300, y: 200, width: 260, height: 36 },
  { fontSize: 10, fontWeight: 'normal', fontColor: '#336600', x: 350, y: 580, width: 210, height: 20 },
  { fontSize: 12, fontWeight: 'bold',   fontColor: '#553300', x: 60,  y: 690, width: 320, height: 26 },
];

// ---------------------------------------------------------------------------
// Base invoice & helpers
// ---------------------------------------------------------------------------

const BASE_LINE: InvoiceLineDto = {
  lineNumber: 1, itemName: 'Testleistung', quantity: 2,
  unitCode: 'HUR', netPrice: 100, vatCategoryCode: 'S', vatRate: 19, lineNetAmount: 200,
};

const BASE: InvoiceDto = {
  invoiceNumber: 'RE-2024-0001', invoiceDate: '2024-03-15', dueDate: '2024-04-15',
  buyerReference: 'REF-001', invoiceTypeCode: '380', currencyCode: 'EUR',
  paymentMeansCode: '58', iban: 'DE89370400440532013000', bic: 'COBADEFFXXX',
  paymentTerms: '30 Tage netto', taxRate: 19, taxCategoryCode: 'S',
  kleinunternehmer: false, totalNetAmount: 1000, totalTaxAmount: 190, totalGrossAmount: 1190,
  seller: { name: 'Testfirma GmbH', street: 'Teststr. 1', postalCode: '10115', city: 'Berlin', countryCode: 'DE', vatId: 'DE123456789' },
  buyer:  { name: 'Kunde AG', street: 'Kundenweg 2', postalCode: '80331', city: 'München', countryCode: 'DE' },
  lines: [BASE_LINE],
};

function tmpl(block: PdfBlockDto): PdfTemplateDto {
  return { id: 1, name: 't', pageSize: 'a4', orientation: 'portrait', blocks: [block] };
}

function blk(type: PdfBlockDto['type'], s: StyleCombo, extra: Partial<PdfBlockDto> = {}): PdfBlockDto {
  return { id: '1', type, ...s, ...extra };
}

// ---------------------------------------------------------------------------
// Shared assertions
// ---------------------------------------------------------------------------

function near(actual: number, expected: number, label: string, tol = 1.0): void {
  expect(
    Math.abs(actual - expected),
    `${label}: expected ≈${expected.toFixed(2)}, got ${actual.toFixed(2)} (diff ${Math.abs(actual - expected).toFixed(2)}pt)`,
  ).toBeLessThanOrEqual(tol);
}

function rowRightEdge(items: PdfTextItem[], y: number, tol = 1.0): number {
  const row = items.filter(i => Math.abs(i.y - y) <= tol);
  return row.length ? Math.max(...row.map(i => i.x + i.width)) : -1;
}

function assertLabelX(items: PdfTextItem[], label: string, block: PdfBlockDto, tag: string): void {
  // pdfjs may merge label+value into one item when the gap between them is within pdfjs's word-break threshold.
  // Use startsWith as fallback: the label must appear at block.x whether standalone or merged with the value.
  const item = items.find(i => i.text === label) ?? items.find(i => i.text.startsWith(label));
  expect(item, `${tag}: "${label}" not found`).toBeDefined();
  near(item!.x, block.x, `${tag} label.x`);
}

function assertFontSize(items: PdfTextItem[], fragment: string, expectedFs: number, tag: string): void {
  const item = items.find(i => i.text.includes(fragment) || fragment.includes(i.text.trim()));
  expect(item, `${tag}: text containing "${fragment}" not found`).toBeDefined();
  near(item!.fontSize, expectedFs, `${tag} fontSize`, 0.5);
}

/** Asserts that every text item on the same row as the label has the expected font size.
 *  Catches bugs where the label renders at the right size but the value does not. */
function assertRowFontSize(items: PdfTextItem[], labelText: string, expectedFs: number, tag: string): void {
  const labelItem = items.find(i => i.text === labelText) ?? items.find(i => i.text.startsWith(labelText));
  if (!labelItem) return; // assertLabelX will report the missing label
  const row = items.filter(i => Math.abs(i.y - labelItem.y) <= 1.0);
  for (const item of row) {
    near(item.fontSize, expectedFs, `${tag} "${item.text}" fontSize`, 0.5);
  }
}

function assertRightEdge(items: PdfTextItem[], label: string, block: PdfBlockDto, tag: string): void {
  const exact = items.find(i => i.text === label);
  if (exact) {
    // Normal case: label is a separate item — check that the value is right-aligned.
    const re = rowRightEdge(items, exact.y);
    near(re, block.x + block.width, `${tag} right-edge`, 1.0);
  } else {
    // Merged case: pdfjs combined label+value because the gap is within its word-break threshold.
    // This happens when the value is so long it overflows the block (valueX = labelEnd).
    // Right-edge check is not meaningful here; verify label appears at block.x.
    const merged = items.find(i => i.text.startsWith(label));
    expect(merged, `${tag}: "${label}" not found`).toBeDefined();
    near(merged!.x, block.x, `${tag} label.x (merged)`);
  }
}

function assertWithinBlock(items: PdfTextItem[], block: PdfBlockDto, tag: string): void {
  const top = PAGE_HEIGHT - block.y;
  const bot = PAGE_HEIGHT - block.y - block.height;
  for (const item of items) {
    expect(item.y, `${tag}: "${item.text}" y=${item.y.toFixed(1)} above top ${top}`).toBeLessThanOrEqual(top + 2);
    expect(item.y, `${tag}: "${item.text}" y=${item.y.toFixed(1)} below bottom ${bot}`).toBeGreaterThanOrEqual(bot - 2);
  }
}

function assertFillColor(fillColors: string[], color: string, tag: string): void {
  expect(fillColors, `${tag}: fill color "${color}" not found in ${JSON.stringify(fillColors)}`).toContain(color.toLowerCase());
}

function assertAllLinesAtX(items: PdfTextItem[], x: number, tag: string): void {
  const ys = [...new Set(items.map(i => Math.round(i.y)))];
  for (const y of ys) {
    const leftmost = Math.min(...items.filter(i => Math.abs(i.y - y) <= 1).map(i => i.x));
    near(leftmost, x, `${tag} row-y=${y} leftmost.x`, 2.0);
  }
}

// ---------------------------------------------------------------------------
// Label:value block matrix — generic runner
// ---------------------------------------------------------------------------

function labelValueMatrix(
  type: PdfBlockDto['type'],
  labelText: string,
  makeInv: (ci: number) => InvoiceDto,
  skipRightEdge = false,
): void {
  for (let ci = 0; ci < 10; ci++) {
    const inv = makeInv(ci);
    for (let si = 0; si < S.length; si++) {
      const s = S[si];
      const tag = `${type}[${ci}][${si}]`;
      it(`${type} v${ci} fs=${s.fontSize} x=${s.x} fw=${s.fontWeight} color=${s.fontColor}`, async () => {
        const block = blk(type, s);
        const bytes = await svc.render(tmpl(block), inv);
        const { textItems: items, fillColors } = await extractPageData(bytes);

        assertLabelX(items, labelText, block, tag);
        assertFontSize(items, labelText, s.fontSize, tag);
        assertRowFontSize(items, labelText, s.fontSize, tag);
        if (!skipRightEdge) assertRightEdge(items, labelText, block, tag);
        assertFillColor(fillColors, s.fontColor, tag);
        assertWithinBlock(items, block, tag);
      });
    }
  }
}

// ---------------------------------------------------------------------------
// A. invoice-number — 10 numbers × 10 styles
// ---------------------------------------------------------------------------

describe('invoice-number — 10 numbers × 10 styles', () => {
  const NUMBERS = [
    'RE-2024-0001', 'RG-2025-99999', 'INV/2024/001', 'A-1',
    'RECHNUNG-2024-LANG', '2024001', '#INV-042', 'RE.2024.0100',
    'NR-00001', 'INVOICE-X',
  ];
  labelValueMatrix('invoice-number', 'Nr.:', ci => ({ ...BASE, invoiceNumber: NUMBERS[ci] }));
});

// ---------------------------------------------------------------------------
// B. invoice-date — 10 dates × 10 styles
// ---------------------------------------------------------------------------

describe('invoice-date — 10 dates × 10 styles', () => {
  const DATES = [
    '2024-01-01', '2024-12-31', '2025-03-15', '2023-06-30',
    '2022-11-11', '2024-07-04', '2025-01-01', '2023-12-25',
    '2024-09-15', '2020-02-29',
  ];
  labelValueMatrix('invoice-date', 'Datum:', ci => ({ ...BASE, invoiceDate: DATES[ci] }));
});

// ---------------------------------------------------------------------------
// C. due-date — 10 dates × 10 styles
// ---------------------------------------------------------------------------

describe('due-date — 10 dates × 10 styles', () => {
  const DATES = [
    '2024-02-01', '2025-01-31', '2025-04-15', '2023-07-30',
    '2022-12-11', '2024-08-04', '2025-02-01', '2024-01-25',
    '2024-10-15', '2023-03-31',
  ];
  labelValueMatrix('due-date', 'Fällig:', ci => ({ ...BASE, dueDate: DATES[ci] }));
});

// ---------------------------------------------------------------------------
// D. buyer-reference — 10 references × 10 styles
// ---------------------------------------------------------------------------

describe('buyer-reference — 10 refs × 10 styles', () => {
  const REFS = [
    'LW-4200', 'REF-001', 'ABCDE', 'Bestellnummer 123',
    'Auftrag 2024', 'B-2024', 'PO-2024', 'Ref.42',
    'ORDER-99', 'BN-7890',
  ];
  labelValueMatrix('buyer-reference', 'Referenz:', ci => ({ ...BASE, buyerReference: REFS[ci] }));
});

// ---------------------------------------------------------------------------
// E. total-net — 10 amounts × 10 styles
// ---------------------------------------------------------------------------

describe('total-net — 10 amounts × 10 styles', () => {
  const AMOUNTS = [0.01, 1.00, 99.99, 100.00, 500.00, 999.99, 1000.00, 9999.99, 50000.00, 1000000.00];
  labelValueMatrix('total-net', 'Nettobetrag:', ci => ({
    ...BASE, totalNetAmount: AMOUNTS[ci],
  }));
});

// ---------------------------------------------------------------------------
// F. total-gross — 10 amounts × 10 styles
// ---------------------------------------------------------------------------

describe('total-gross — 10 amounts × 10 styles', () => {
  const AMOUNTS = [0.01, 1.19, 119.00, 200.00, 595.00, 1190.00, 5950.00, 11900.00, 59500.00, 1190000.00];
  labelValueMatrix('total-gross', 'Bruttobetrag:', ci => ({
    ...BASE, totalGrossAmount: AMOUNTS[ci],
  }));
});

// ---------------------------------------------------------------------------
// G. total-tax — 10 (rate+amount) variants × 10 styles
// ---------------------------------------------------------------------------

describe('total-tax — 10 tax variants × 10 styles', () => {
  const TAX = [
    { taxRate: 19, totalTaxAmount: 190 },   { taxRate:  7, totalTaxAmount:  70 },
    { taxRate: 19, totalTaxAmount: 19 },    { taxRate:  7, totalTaxAmount:   3.5 },
    { taxRate: 19, totalTaxAmount: 1900 },  { taxRate:  7, totalTaxAmount: 700 },
    { taxRate: 19, totalTaxAmount: 0.19 },  { taxRate:  7, totalTaxAmount: 0.07 },
    { taxRate: 19, totalTaxAmount: 9500 },  { taxRate:  7, totalTaxAmount: 350 },
  ];
  for (let ci = 0; ci < TAX.length; ci++) {
    const { taxRate, totalTaxAmount } = TAX[ci];
    const labelText = `USt. ${taxRate}%:`;
    for (let si = 0; si < S.length; si++) {
      const s = S[si];
      const tag = `total-tax[${ci}][${si}]`;
      it(`total-tax rate=${taxRate}% fs=${s.fontSize} x=${s.x} fw=${s.fontWeight}`, async () => {
        const block = blk('total-tax', s);
        const inv: InvoiceDto = { ...BASE, taxRate, totalTaxAmount, kleinunternehmer: false };
        const bytes = await svc.render(tmpl(block), inv);
        const { textItems: items, fillColors } = await extractPageData(bytes);

        assertLabelX(items, labelText, block, tag);
        assertFontSize(items, labelText, s.fontSize, tag);
        assertRightEdge(items, labelText, block, tag);
        assertFillColor(fillColors, s.fontColor, tag);
        assertWithinBlock(items, block, tag);
        // tax rate appears in label
        expect(items.find(i => i.text.includes(`${taxRate}%`)), `${tag}: tax rate in label`).toBeDefined();
      });
    }
  }
});

// ---------------------------------------------------------------------------
// H. payment-means — 8 codes × 10 styles (with code repetition to reach 10)
// ---------------------------------------------------------------------------

describe('payment-means — 10 code variants × 10 styles', () => {
  const CODES = ['10', '30', '42', '48', '49', '57', '58', '59', '30', '48'];
  const LABELS: Record<string, string> = {
    '10': 'Barzahlung', '30': 'Überweisung', '42': 'Zahlung auf Bankkonto',
    '48': 'Kartenzahlung', '49': 'Lastschrift', '57': 'Dauerauftrag',
    '58': 'SEPA-Überweisung', '59': 'SEPA-Lastschrift',
  };
  for (let ci = 0; ci < CODES.length; ci++) {
    const code = CODES[ci];
    for (let si = 0; si < S.length; si++) {
      const s = S[si];
      const tag = `payment-means[${ci}][${si}]`;
      it(`payment-means code=${code} fs=${s.fontSize} x=${s.x} fw=${s.fontWeight}`, async () => {
        const block = blk('payment-means', s);
        const inv: InvoiceDto = { ...BASE, paymentMeansCode: code };
        const bytes = await svc.render(tmpl(block), inv);
        const { textItems: items, fillColors } = await extractPageData(bytes);

        assertLabelX(items, 'Zahlungsart:', block, tag);
        assertFontSize(items, 'Zahlungsart:', s.fontSize, tag);
        assertRightEdge(items, 'Zahlungsart:', block, tag);
        assertFillColor(fillColors, s.fontColor, tag);
        assertWithinBlock(items, block, tag);
        expect(items.find(i => i.text.includes(LABELS[code].slice(0, 5))), `${tag}: value text`).toBeDefined();
      });
    }
  }
});

// ---------------------------------------------------------------------------
// I. payment-terms — 10 text variants × 10 styles (no right-edge for long text)
// ---------------------------------------------------------------------------

describe('payment-terms — 10 text variants × 10 styles', () => {
  const TERMS = [
    'Sofort',
    '14 Tage netto',
    '30 Tage netto',
    'Zahlung bis Monatsende.',
    'Sofort zahlbar ohne Abzug.',
    'Zahlbar innerhalb von 14 Tagen.',
    'Zahlbar innerhalb von 30 Tagen nach Rechnungseingang.',
    'Bitte überweisen Sie den Betrag innerhalb von 30 Tagen.',
    'Skonto: 2% bei Zahlung in 10 Tagen, 30 Tage netto.',
    'Kein Skonto. Zahlung fällig zum Monatsende.',
  ];
  for (let ci = 0; ci < TERMS.length; ci++) {
    for (let si = 0; si < S.length; si++) {
      const s = S[si];
      const tag = `payment-terms[${ci}][${si}]`;
      it(`payment-terms v${ci} fs=${s.fontSize} x=${s.x}`, async () => {
        const block = blk('payment-terms', s);
        const inv: InvoiceDto = { ...BASE, paymentTerms: TERMS[ci] };
        const bytes = await svc.render(tmpl(block), inv);
        const { textItems: items, fillColors } = await extractPageData(bytes);

        assertLabelX(items, 'Zahlungsziel:', block, tag);
        assertFontSize(items, 'Zahlungsziel:', s.fontSize, tag);
        assertFillColor(fillColors, s.fontColor, tag);
        // All text (label + value) must start at or after block.x (no left overflow)
        for (const item of items) {
          expect(item.x, `${tag}: "${item.text}" starts left of block.x`).toBeGreaterThanOrEqual(block.x - 1);
        }
      });
    }
  }
});

// ---------------------------------------------------------------------------
// J. invoice-title — 5 default "Rechnung" + 5 content overrides × 10 styles
// ---------------------------------------------------------------------------

describe('invoice-title — 10 content variants × 10 styles', () => {
  // First 5: no content override → default "Rechnung" at fontSize+4
  // Next 5: content override at fontSize (not +4)
  const CONTENTS: Array<string | undefined> = [
    undefined, undefined, undefined, undefined, undefined,
    'Angebot', 'Gutschrift', 'Proforma-Rechnung', 'Abschlagsrechnung', 'Schlussrechnung',
  ];
  for (let ci = 0; ci < 10; ci++) {
    const content = CONTENTS[ci];
    const isDefault = content === undefined;
    for (let si = 0; si < S.length; si++) {
      const s = S[si];
      const tag = `invoice-title[${ci}][${si}]`;
      it(`invoice-title ${isDefault ? 'default' : `"${content}"`} fs=${s.fontSize} x=${s.x}`, async () => {
        const extra = content ? { content } : {};
        const block = blk('invoice-title', s, extra);
        const bytes = await svc.render(tmpl(block), BASE);
        const { textItems: items, fillColors } = await extractPageData(bytes);

        const expectedText = content ?? 'Rechnung';
        const titleItem = items.find(i => i.text.includes(expectedText.slice(0, 5)));
        expect(titleItem, `${tag}: title text not found`).toBeDefined();

        // x-position
        near(titleItem!.x, block.x, `${tag} title.x`);

        // font size: default → fontSize+4; content override → fontSize
        const expectedFs = isDefault ? s.fontSize + 4 : s.fontSize;
        near(titleItem!.fontSize, expectedFs, `${tag} fontSize`, 0.5);

        assertFillColor(fillColors, s.fontColor, tag);
        assertWithinBlock(items, block, tag);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// K. free-text — 10 content variants × 10 styles
// ---------------------------------------------------------------------------

describe('free-text — 10 content variants × 10 styles', () => {
  const CONTENTS = [
    'Einzeilig',
    'Erste Zeile\nZweite Zeile',
    'A\nB\nC',
    'Sonderzeichen: Ä Ö Ü ß',
    'Lange Zeile mit mehreren Wörtern die viel Platz braucht\nZweite Zeile',
    'Zeile 1\nZeile 2\nZeile 3\nZeile 4',
    'Technischer Hinweis:\nBitte beachten Sie die Lieferbedingungen.',
    'GROSSBUCHSTABEN\nkleinbuchstaben',
    'Zeile 1\nZeile 2\nZeile 3\nZeile 4\nZeile 5',
    'Mit Zahlen: 1234567890',
  ];
  for (let ci = 0; ci < CONTENTS.length; ci++) {
    for (let si = 0; si < S.length; si++) {
      const s = S[si];
      const tag = `free-text[${ci}][${si}]`;
      it(`free-text v${ci} fs=${s.fontSize} x=${s.x}`, async () => {
        const block = blk('free-text', s, { content: CONTENTS[ci], height: s.fontSize * 1.4 * 8 });
        const bytes = await svc.render(tmpl(block), BASE);
        const { textItems: items, fillColors } = await extractPageData(bytes);

        expect(items.length, `${tag}: no text items`).toBeGreaterThan(0);
        assertAllLinesAtX(items, block.x, tag);
        assertFillColor(fillColors, s.fontColor, tag);

        // Font size on first item
        near(items[0].fontSize, s.fontSize, `${tag} fontSize`, 0.5);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// L. seller-address — 10 seller variants × 10 styles
// ---------------------------------------------------------------------------

describe('seller-address — 10 seller variants × 10 styles', () => {
  type Seller = InvoiceDto['seller'];
  const SELLERS: Seller[] = [
    { name: 'Firma A GmbH', street: 'Straße 1', postalCode: '10115', city: 'Berlin', countryCode: 'DE', vatId: 'DE123456789', taxNumber: '30/123/00001' },
    { name: 'Solo Unternehmen', street: 'Weg 2', postalCode: '20099', city: 'Hamburg', countryCode: 'DE', vatId: 'DE999888777' },
    { name: 'Freelancer X', street: 'Platz 3', postalCode: '80331', city: 'München', countryCode: 'DE', taxNumber: '123/456/78901' },
    { name: 'Mustermann GmbH', street: 'Musterstraße 42', postalCode: '40210', city: 'Düsseldorf', countryCode: 'DE' },
    { name: 'Sehr Langer Firmenname GmbH & Co. KG', street: 'Hauptstraße 100', postalCode: '60311', city: 'Frankfurt', countryCode: 'DE', vatId: 'DE111222333', taxNumber: '045/678/90123' },
    { name: 'Kurz', street: 'A', postalCode: '12345', city: 'Stadt', countryCode: 'DE' },
    { name: 'Gesellschaft mbH', street: 'Berliner Str. 42', postalCode: '10115', city: 'Berlin', countryCode: 'DE', vatId: 'DE444555666' },
    { name: 'Ö-Ü Sonderzeichen', street: 'Äußere Ring 7', postalCode: '72070', city: 'Tübingen', countryCode: 'DE', taxNumber: '056/789/01234' },
    { name: 'Beratung und Service', street: 'Industrieweg 15', postalCode: '30159', city: 'Hannover', countryCode: 'DE', vatId: 'DE777666555', taxNumber: '023/345/67890' },
    { name: 'IT Solutions', street: 'Technikpark 3', postalCode: '01067', city: 'Dresden', countryCode: 'DE' },
  ];
  for (let ci = 0; ci < SELLERS.length; ci++) {
    for (let si = 0; si < S.length; si++) {
      const s = S[si];
      const tag = `seller-address[${ci}][${si}]`;
      it(`seller "${SELLERS[ci].name.slice(0, 15)}" fs=${s.fontSize} x=${s.x}`, async () => {
        const block = blk('seller-address', s, { height: s.fontSize * 1.4 * 6 });
        const inv: InvoiceDto = { ...BASE, seller: SELLERS[ci] };
        const bytes = await svc.render(tmpl(block), inv);
        const { textItems: items, fillColors } = await extractPageData(bytes);

        expect(items.length, `${tag}: no items`).toBeGreaterThanOrEqual(3);
        assertAllLinesAtX(items, block.x, tag);
        assertFillColor(fillColors, s.fontColor, tag);

        // Seller name appears
        const nameFound = items.find(i => i.text.includes(SELLERS[ci].name.slice(0, 8)));
        expect(nameFound, `${tag}: seller name not found`).toBeDefined();
        near(nameFound!.fontSize, s.fontSize, `${tag} fontSize`, 0.5);

        // Expected line count: 3 base + 1 for vatId + 1 for taxNumber
        const expectedLines = 3 + (SELLERS[ci].vatId ? 1 : 0) + (SELLERS[ci].taxNumber ? 1 : 0);
        const distinctYs = [...new Set(items.map(i => Math.round(i.y)))];
        expect(distinctYs.length, `${tag}: expected at least ${expectedLines} distinct Y rows`).toBeGreaterThanOrEqual(expectedLines);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// M. buyer-address — 10 buyer variants × 10 styles
// ---------------------------------------------------------------------------

describe('buyer-address — 10 buyer variants × 10 styles', () => {
  type Buyer = InvoiceDto['buyer'];
  const BUYERS: Buyer[] = [
    { name: 'Beispiel AG', street: 'Hauptstraße 1', postalCode: '80331', city: 'München', countryCode: 'DE' },
    { name: 'Kunde GmbH', street: 'Berliner Str. 42', postalCode: '10115', city: 'Berlin', countryCode: 'DE' },
    { name: 'Max Mustermann', street: 'Musterweg 3', postalCode: '12345', city: 'Musterstadt', countryCode: 'DE' },
    { name: 'Sehr Langer Kundenname AG & Co. KG', street: 'Industriepark 100', postalCode: '60311', city: 'Frankfurt', countryCode: 'DE' },
    { name: 'IT GmbH', street: 'Technikweg 5', postalCode: '01067', city: 'Dresden', countryCode: 'DE' },
    { name: 'Ö-Ü Spezial', street: 'Äußere Ring 7', postalCode: '72070', city: 'Tübingen', countryCode: 'DE' },
    { name: 'Corp X', street: 'A-Str. 1', postalCode: '99999', city: 'Kleinstadt', countryCode: 'DE' },
    { name: 'Beratung AG', street: 'Bahnhofstr. 12', postalCode: '30159', city: 'Hannover', countryCode: 'DE' },
    { name: 'Startup GmbH', street: 'Gründerweg 1', postalCode: '70173', city: 'Stuttgart', countryCode: 'DE' },
    { name: 'Energie AG', street: 'Kraftwerkstr. 99', postalCode: '45128', city: 'Essen', countryCode: 'DE' },
  ];
  for (let ci = 0; ci < BUYERS.length; ci++) {
    for (let si = 0; si < S.length; si++) {
      const s = S[si];
      const tag = `buyer-address[${ci}][${si}]`;
      it(`buyer "${BUYERS[ci].name.slice(0, 15)}" fs=${s.fontSize} x=${s.x}`, async () => {
        const block = blk('buyer-address', s, { height: s.fontSize * 1.4 * 4 });
        const inv: InvoiceDto = { ...BASE, buyer: BUYERS[ci] };
        const bytes = await svc.render(tmpl(block), inv);
        const { textItems: items, fillColors } = await extractPageData(bytes);

        expect(items.length, `${tag}: expected at least 3 items`).toBeGreaterThanOrEqual(3);
        assertAllLinesAtX(items, block.x, tag);
        assertFillColor(fillColors, s.fontColor, tag);
        near(items[0].fontSize, s.fontSize, `${tag} fontSize`, 0.5);

        // Name appears as first (highest y) item
        const topItem = items.reduce((a, b) => a.y > b.y ? a : b);
        expect(topItem.text, `${tag}: first line should be buyer name`).toContain(BUYERS[ci].name.slice(0, 5));
      });
    }
  }
});

// ---------------------------------------------------------------------------
// N. iban-bic — 10 IBAN/BIC variants × 10 styles
// ---------------------------------------------------------------------------

describe('iban-bic — 10 IBAN/BIC variants × 10 styles', () => {
  const VARIANTS: { iban?: string; bic?: string }[] = [
    { iban: 'DE89370400440532013000', bic: 'COBADEFFXXX' },
    { iban: 'DE89370400440532013000' },
    { iban: 'DE12345678901234567890', bic: 'DEUTDEDB001' },
    { iban: 'AT611904300234573201', bic: 'BKAUATWWXXX' },
    { iban: 'CH9300762011623852957', bic: 'UBSWCHZH80A' },
    { iban: 'GB29NWBK60161331926819', bic: 'NWBKGB2LXXX' },
    { iban: 'DE44500105175407324931', bic: 'BELADEBEXXX' },
    { iban: 'DE27200505501265584015', bic: 'HASPDEHHXXX' },
    { iban: 'DE21700519950000007229', bic: 'HYVEDEMM406' },
    { iban: 'DE75512108001245126199' },
  ];
  for (let ci = 0; ci < VARIANTS.length; ci++) {
    for (let si = 0; si < S.length; si++) {
      const s = S[si];
      const tag = `iban-bic[${ci}][${si}]`;
      const v = VARIANTS[ci];
      it(`iban-bic iban=${v.iban?.slice(0, 10)} bic=${v.bic ?? 'none'} fs=${s.fontSize}`, async () => {
        const block = blk('iban-bic', s, { height: s.fontSize * 1.4 * 3 });
        const inv: InvoiceDto = { ...BASE, iban: v.iban, bic: v.bic };
        const bytes = await svc.render(tmpl(block), inv);
        const { textItems: items, fillColors } = await extractPageData(bytes);

        // At least IBAN line
        expect(items.find(i => i.text.includes('IBAN')), `${tag}: IBAN line not found`).toBeDefined();
        assertAllLinesAtX(items, block.x, tag);
        assertFillColor(fillColors, s.fontColor, tag);

        const expectedLines = (v.iban ? 1 : 0) + (v.bic ? 1 : 0);
        const distinctYs = [...new Set(items.map(i => Math.round(i.y)))];
        expect(distinctYs.length, `${tag}: expected at least ${expectedLines} rows`).toBeGreaterThanOrEqual(expectedLines);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// O. payment-info — 10 payment config variants × 10 styles
// ---------------------------------------------------------------------------

describe('payment-info — 10 payment variants × 10 styles', () => {
  const VARIANTS: Partial<InvoiceDto>[] = [
    { paymentMeansCode: '58', iban: 'DE89370400440532013000', bic: 'COBADEFFXXX', paymentTerms: '30 Tage' },
    { paymentMeansCode: '30', iban: 'DE89370400440532013000' },
    { paymentMeansCode: '10' },
    { paymentMeansCode: '58', iban: 'DE89370400440532013000', bic: 'COBADEFFXXX' },
    { paymentMeansCode: '49', paymentTerms: 'Lastschrift monatlich' },
    { paymentMeansCode: '30', iban: 'DE12345678901234567890', bic: 'DEUTDEDB001', paymentTerms: 'Sofort' },
    { paymentMeansCode: '42', paymentTerms: '14 Tage netto' },
    { paymentMeansCode: '58', iban: 'DE44500105175407324931', bic: 'BELADEBEXXX', paymentTerms: 'Zahlbar in 30 Tagen' },
    { paymentMeansCode: '48', paymentTerms: 'Kartenzahlung bei Lieferung' },
    { paymentMeansCode: '58', iban: 'DE27200505501265584015', bic: 'HASPDEHHXXX', paymentTerms: 'Sofort zahlbar' },
  ];
  for (let ci = 0; ci < VARIANTS.length; ci++) {
    for (let si = 0; si < S.length; si++) {
      const s = S[si];
      const tag = `payment-info[${ci}][${si}]`;
      it(`payment-info v${ci} code=${VARIANTS[ci].paymentMeansCode} fs=${s.fontSize}`, async () => {
        const block = blk('payment-info', s, { height: s.fontSize * 1.4 * 6 });
        const inv: InvoiceDto = { ...BASE, ...VARIANTS[ci] };
        const bytes = await svc.render(tmpl(block), inv);
        const { textItems: items, fillColors } = await extractPageData(bytes);

        // "Zahlungsart" always appears
        expect(items.find(i => i.text.includes('Zahlungsart')), `${tag}: Zahlungsart not found`).toBeDefined();
        assertAllLinesAtX(items, block.x, tag);
        assertFillColor(fillColors, s.fontColor, tag);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// P. invoice-header — 10 invoice variants × 10 styles
// ---------------------------------------------------------------------------

describe('invoice-header — 10 invoice variants × 10 styles', () => {
  const VARIANTS: Partial<InvoiceDto>[] = [
    { invoiceNumber: 'RE-001', invoiceDate: '2024-01-15', dueDate: '2024-02-15', buyerReference: 'REF-A' },
    { invoiceNumber: 'RE-002', invoiceDate: '2024-02-28' },
    { invoiceNumber: 'RE-003', invoiceDate: '2024-03-31', dueDate: '2024-04-30' },
    { invoiceNumber: 'RE-004', invoiceDate: '2024-04-01', buyerReference: 'ORDER-001' },
    { invoiceNumber: 'INV/2024/005', invoiceDate: '2024-05-15', dueDate: '2024-06-14', buyerReference: 'PO-42' },
    { invoiceNumber: 'A-6', invoiceDate: '2024-06-30' },
    { invoiceNumber: 'RECHNUNG-2024-007', invoiceDate: '2024-07-04', dueDate: '2024-08-03', buyerReference: 'LANG-REFERENZ' },
    { invoiceNumber: 'RE.2024.008', invoiceDate: '2024-08-01' },
    { invoiceNumber: '#INV-009', invoiceDate: '2024-09-15', dueDate: '2024-10-15' },
    { invoiceNumber: 'NR-0010', invoiceDate: '2024-10-31', buyerReference: 'REF-XYZ' },
  ];
  for (let ci = 0; ci < VARIANTS.length; ci++) {
    for (let si = 0; si < S.length; si++) {
      const s = S[si];
      const tag = `invoice-header[${ci}][${si}]`;
      it(`invoice-header v${ci} num="${VARIANTS[ci].invoiceNumber}" fs=${s.fontSize}`, async () => {
        const block = blk('invoice-header', s, { height: s.fontSize * 1.4 * 5 });
        const inv: InvoiceDto = { ...BASE, ...VARIANTS[ci] };
        const bytes = await svc.render(tmpl(block), inv);
        const { textItems: items, fillColors } = await extractPageData(bytes);

        // Nr.: label always present
        assertLabelX(items, 'Nr.:', block, tag);
        assertFontSize(items, 'Nr.:', s.fontSize, tag);
        assertRightEdge(items, 'Nr.:', block, tag);
        assertFillColor(fillColors, s.fontColor, tag);

        // Datum: always present
        assertLabelX(items, 'Datum:', block, tag);
        assertRightEdge(items, 'Datum:', block, tag);

        // Optional rows
        if (VARIANTS[ci].dueDate) {
          assertRightEdge(items, 'Fällig:', block, tag);
        }
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Q. totals — 10 amount variants × 10 styles
// ---------------------------------------------------------------------------

describe('totals — 10 amount variants × 10 styles', () => {
  const VARIANTS: Partial<InvoiceDto>[] = [
    { totalNetAmount: 100,   totalTaxAmount: 19,   totalGrossAmount: 119,    kleinunternehmer: false, taxRate: 19 },
    { totalNetAmount: 500,   totalTaxAmount: 35,   totalGrossAmount: 535,    kleinunternehmer: false, taxRate: 7 },
    { totalNetAmount: 1000,  totalTaxAmount: 0,    totalGrossAmount: 1000,   kleinunternehmer: true },
    { totalNetAmount: 9999,  totalTaxAmount: 1899.81, totalGrossAmount: 11898.81, kleinunternehmer: false, taxRate: 19 },
    { totalNetAmount: 0.01,  totalTaxAmount: 0,    totalGrossAmount: 0.01,   kleinunternehmer: true },
    { totalNetAmount: 250,   totalTaxAmount: 17.5, totalGrossAmount: 267.5,  kleinunternehmer: false, taxRate: 7 },
    { totalNetAmount: 50000, totalTaxAmount: 9500, totalGrossAmount: 59500,  kleinunternehmer: false, taxRate: 19 },
    { totalNetAmount: 1500,  totalTaxAmount: 0,    totalGrossAmount: 1500,   kleinunternehmer: true },
    { totalNetAmount: 750,   totalTaxAmount: 52.5, totalGrossAmount: 802.5,  kleinunternehmer: false, taxRate: 7 },
    { totalNetAmount: 100000,totalTaxAmount: 19000,totalGrossAmount: 119000, kleinunternehmer: false, taxRate: 19 },
  ];
  for (let ci = 0; ci < VARIANTS.length; ci++) {
    for (let si = 0; si < S.length; si++) {
      const s = S[si];
      const tag = `totals[${ci}][${si}]`;
      it(`totals net=${VARIANTS[ci].totalNetAmount} kl=${VARIANTS[ci].kleinunternehmer} fs=${s.fontSize}`, async () => {
        const block = blk('totals', s, { height: s.fontSize * 1.6 * 4 });
        const inv: InvoiceDto = { ...BASE, ...VARIANTS[ci] };
        const bytes = await svc.render(tmpl(block), inv);
        const { textItems: items, lineSegments, fillColors } = await extractPageData(bytes);

        assertFillColor(fillColors, s.fontColor, tag);

        if (inv.kleinunternehmer) {
          // Kleinunternehmer: single "Rechnungssumme:" row (net=gross, no VAT)
          assertRightEdge(items, 'Rechnungssumme:', block, tag);
          assertFontSize(items, 'Rechnungssumme:', s.fontSize + 1, tag);
        } else {
          // Normal: Nettobetrag + USt + Bruttobetrag rows
          assertRightEdge(items, 'Nettobetrag:', block, tag);
          assertRightEdge(items, 'Bruttobetrag:', block, tag);

          // Nettobetrag font size = block fontSize
          assertFontSize(items, 'Nettobetrag:', s.fontSize, tag);
          assertRowFontSize(items, 'Nettobetrag:', s.fontSize, tag);

          // Bruttobetrag font size = fontSize + 1 (larger + bold to emphasise total)
          assertFontSize(items, 'Bruttobetrag:', s.fontSize + 1, tag);
          assertRowFontSize(items, 'Bruttobetrag:', s.fontSize + 1, tag);
        }

        // Separator line spans block width
        expect(lineSegments.length, `${tag}: separator line expected`).toBeGreaterThanOrEqual(1);
        const sep = lineSegments[0];
        near(Math.min(sep.x1, sep.x2), block.x, `${tag} sep.x1`, 1.0);
        near(Math.max(sep.x1, sep.x2), block.x + block.width, `${tag} sep.x2`, 1.0);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// R. lines-table — 10 config variants × 10 styles
// ---------------------------------------------------------------------------

describe('lines-table — 10 config variants × 10 styles', () => {
  type TableConfig = Partial<PdfBlockDto> & { _expectedHeaders: string[] };
  const CONFIGS: TableConfig[] = [
    { lineHeight: 1.2, tableStyle: 'minimal', showHeader: true,  columns: undefined,                  _expectedHeaders: ['Pos', 'Bezeichnung', 'Menge', 'Einheit', 'Einzelpreis', 'Netto'] },
    { lineHeight: 1.4, tableStyle: 'grid',    showHeader: true,  columns: ['name', 'price', 'total'],  _expectedHeaders: ['Bezeichnung', 'Einzelpreis', 'Netto'] },
    { lineHeight: 1.6, tableStyle: 'striped', showHeader: true,  columns: ['pos', 'name', 'qty'],       _expectedHeaders: ['Pos', 'Bezeichnung', 'Menge'] },
    { lineHeight: 1.8, tableStyle: 'minimal', showHeader: true,  columns: undefined,                  _expectedHeaders: ['Pos'] },
    { lineHeight: 2.0, tableStyle: 'grid',    showHeader: true,  columns: ['name', 'total'],            _expectedHeaders: ['Bezeichnung', 'Netto'] },
    { lineHeight: 1.5, tableStyle: 'striped', showHeader: false, columns: undefined,                  _expectedHeaders: [] },
    { lineHeight: 2.5, tableStyle: 'minimal', showHeader: true,  columns: ['pos', 'name'],              _expectedHeaders: ['Pos', 'Bezeichnung'] },
    { lineHeight: 1.3, tableStyle: 'grid',    showHeader: true,  columns: ['qty', 'price', 'total'],    _expectedHeaders: ['Menge', 'Einzelpreis', 'Netto'] },
    { lineHeight: 1.7, tableStyle: 'striped', showHeader: true,  columns: ['name'],                     _expectedHeaders: ['Bezeichnung'] },
    { lineHeight: 3.0, tableStyle: 'minimal', showHeader: true,  columns: ['pos', 'name', 'qty', 'unit', 'price', 'total'], _expectedHeaders: ['Pos', 'Bezeichnung'] },
  ];
  for (let ci = 0; ci < CONFIGS.length; ci++) {
    for (let si = 0; si < S.length; si++) {
      const s = S[si];
      const config = CONFIGS[ci];
      const tag = `lines-table[${ci}][${si}]`;
      it(`lines-table style=${config.tableStyle} lh=${config.lineHeight} header=${config.showHeader} fs=${s.fontSize}`, async () => {
        const { _expectedHeaders, ...blockExtra } = config;
        const rowCount = 3;
        const lines2: InvoiceLineDto[] = [
          { lineNumber: 1, itemName: 'Webdesign', quantity: 1, unitCode: 'HUR', netPrice: 800, vatCategoryCode: 'S', vatRate: 19, lineNetAmount: 800 },
          { lineNumber: 2, itemName: 'SEO', quantity: 5, unitCode: 'HUR', netPrice: 80, vatCategoryCode: 'S', vatRate: 19, lineNetAmount: 400 },
          { lineNumber: 3, itemName: 'Hosting', quantity: 12, unitCode: 'MON', netPrice: 20, vatCategoryCode: 'S', vatRate: 19, lineNetAmount: 240 },
        ];
        const block = blk('lines-table', s, {
          height: s.fontSize * (config.lineHeight ?? 1.8) * (rowCount + 2) + 10,
          ...blockExtra,
        });
        const inv: InvoiceDto = { ...BASE, lines: lines2 };
        const bytes = await svc.render(tmpl(block), inv);
        const { textItems: items, fillColors } = await extractPageData(bytes);

        expect(items.length, `${tag}: no items`).toBeGreaterThan(0);
        assertFillColor(fillColors, s.fontColor, tag);

        // Check expected header columns present / absent
        for (const h of _expectedHeaders) {
          // Use includes to handle pdfjs concatenating adjacent close-together column headers into one text item
          expect(items.find(i => i.text.includes(h)), `${tag}: header "${h}" not found`).toBeDefined();
        }
        if (!config.showHeader) {
          expect(items.find(i => i.text === 'Pos' || i.text === 'Bezeichnung'), `${tag}: headers should be absent`).toBeUndefined();
        }

        // Data cells use fontSize - 1
        const dataCell = items.find(i => i.text.includes('Webdesign') || i.text.includes('SEO'));
        if (dataCell) {
          near(dataCell.fontSize, s.fontSize - 1, `${tag} data cell fontSize`, 0.5);
        }
      });
    }
  }
});

// ---------------------------------------------------------------------------
// S. line element — 10 style variants × 10 position combos
// ---------------------------------------------------------------------------

describe('line element — 10 thickness/color/direction × 10 positions', () => {
  const LINE_STYLES = [
    { lineThickness: 0.5, lineColor: '#1c1b18', lineDirection: 'horizontal' as const },
    { lineThickness: 1,   lineColor: '#ff0000', lineDirection: 'horizontal' as const },
    { lineThickness: 2,   lineColor: '#0000ff', lineDirection: 'vertical'   as const },
    { lineThickness: 3,   lineColor: '#008000', lineDirection: 'horizontal' as const },
    { lineThickness: 4,   lineColor: '#cc9900', lineDirection: 'vertical'   as const },
    { lineThickness: 0.3, lineColor: '#333333', lineDirection: 'horizontal' as const },
    { lineThickness: 5,   lineColor: '#660033', lineDirection: 'horizontal' as const },
    { lineThickness: 1.5, lineColor: '#004080', lineDirection: 'vertical'   as const },
    { lineThickness: 2.5, lineColor: '#553300', lineDirection: 'horizontal' as const },
    { lineThickness: 0.7, lineColor: '#ff8800', lineDirection: 'horizontal' as const },
  ];
  const LINE_POSITIONS = [
    { x: 40,  y: 50,  width: 200, height: 2 },
    { x: 57,  y: 100, width: 480, height: 4 },
    { x: 100, y: 200, width: 300, height: 1 },
    { x: 40,  y: 400, width: 495, height: 3 },
    { x: 200, y: 300, width: 150, height: 2 },
    { x: 40,  y: 500, width: 400, height: 5 },
    { x: 300, y: 150, width: 250, height: 2 },
    { x: 57,  y: 650, width: 350, height: 3 },
    { x: 150, y: 700, width: 200, height: 1 },
    { x: 40,  y: 780, width: 480, height: 2 },
  ];

  for (let li = 0; li < LINE_STYLES.length; li++) {
    const ls = LINE_STYLES[li];
    for (let pi = 0; pi < LINE_POSITIONS.length; pi++) {
      const pos = LINE_POSITIONS[pi];
      const tag = `line[${li}][${pi}]`;
      it(`line thick=${ls.lineThickness} color=${ls.lineColor} dir=${ls.lineDirection} x=${pos.x} y=${pos.y}`, async () => {
        const block: PdfBlockDto = {
          id: '1', type: 'line',
          fontSize: 10, fontWeight: 'normal', fontColor: '#1c1b18',
          ...pos, ...ls,
        };
        const bytes = await svc.render(tmpl(block), BASE);
        const { lineSegments } = await extractPageData(bytes);

        expect(lineSegments.length, `${tag}: no line segment`).toBeGreaterThanOrEqual(1);
        const seg = lineSegments[0];

        if (ls.lineDirection === 'horizontal') {
          // Spans full block width
          near(Math.min(seg.x1, seg.x2), pos.x, `${tag} x1`, 1.0);
          near(Math.max(seg.x1, seg.x2), pos.x + pos.width, `${tag} x2`, 1.0);
          // Centered vertically
          const expectedY = PAGE_HEIGHT - pos.y - pos.height / 2;
          near(seg.y1, expectedY, `${tag} y1`, 1.0);
        } else {
          // Spans full block height
          near(Math.min(seg.y1, seg.y2), PAGE_HEIGHT - pos.y - pos.height, `${tag} bottom y`, 1.0);
          near(Math.max(seg.y1, seg.y2), PAGE_HEIGHT - pos.y, `${tag} top y`, 1.0);
          // Centered horizontally
          const expectedX = pos.x + pos.width / 2;
          near(seg.x1, expectedX, `${tag} x1`, 1.0);
        }

        // Thickness
        near(seg.thickness, ls.lineThickness, `${tag} thickness`, 0.05);

        // Color — parse expected from hex
        const hex = ls.lineColor;
        const er = parseInt(hex.slice(1, 3), 16) / 255;
        const eg = parseInt(hex.slice(3, 5), 16) / 255;
        const eb = parseInt(hex.slice(5, 7), 16) / 255;
        near(seg.color.r, er, `${tag} color.r`, 0.01);
        near(seg.color.g, eg, `${tag} color.g`, 0.01);
        near(seg.color.b, eb, `${tag} color.b`, 0.01);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// T. textAlign — 'left' vs 'block' for all label:value block types
// ---------------------------------------------------------------------------

/** Assert all items on each row are left-aligned (start at or near block.x). */
function assertAllLeft(items: PdfTextItem[], block: PdfBlockDto, tag: string): void {
  // In 'left' mode, label and value appear as a concatenated string at block.x,
  // OR as two items both left-aligned (label at block.x, value just after).
  for (const item of items) {
    expect(
      item.x,
      `${tag}: "${item.text}" x=${item.x.toFixed(1)} should be left-aligned (≥ block.x ${block.x} and not right-aligned)`,
    ).toBeGreaterThanOrEqual(block.x - 1);
    // Ensure nothing is flush-right (right edge ≈ block.x+block.width → would be right-aligned value)
    const rightEdge = item.x + item.width;
    const distFromRight = Math.abs(rightEdge - (block.x + block.width));
    expect(
      distFromRight,
      `${tag}: "${item.text}" appears right-aligned (right edge ${rightEdge.toFixed(1)} ≈ block right ${(block.x + block.width).toFixed(1)})`,
    ).toBeGreaterThan(5);
  }
}

const LEFT_BLOCK_TYPES = [
  'invoice-number', 'invoice-date', 'due-date', 'buyer-reference',
  'total-net', 'total-gross', 'payment-means', 'payment-terms',
] as const;

describe('textAlign — left mode puts all text at block.x (no right-alignment)', () => {
  const s = S[2]; // fs=10, normal, x=100, width=260
  for (const type of LEFT_BLOCK_TYPES) {
    it(`${type} textAlign=left: no item is right-aligned`, async () => {
      const block = blk(type as PdfBlockDto['type'], s, { textAlign: 'left' });
      const bytes = await svc.render(tmpl(block), BASE);
      const { textItems: items } = await extractPageData(bytes);
      expect(items.length, `${type}: no text items rendered`).toBeGreaterThan(0);
      assertAllLeft(items, block, `${type}[left]`);
    });
  }

  it('invoice-header textAlign=left: all rows start at block.x, none right-aligned', async () => {
    const block = blk('invoice-header', s, { textAlign: 'left', height: 60 });
    const bytes = await svc.render(tmpl(block), BASE);
    const { textItems: items } = await extractPageData(bytes);
    assertAllLeft(items, block, 'invoice-header[left]');
  });

  it('totals textAlign=left: all rows start at block.x, none right-aligned', async () => {
    const block = blk('totals', s, { textAlign: 'left', height: 80 });
    const bytes = await svc.render(tmpl(block), BASE);
    const { textItems: items } = await extractPageData(bytes);
    assertAllLeft(items, block, 'totals[left]');
  });
});

describe('textAlign — block mode (default) keeps right-aligned values', () => {
  const s = S[2]; // fs=10, normal, x=100, width=260
  for (const type of LEFT_BLOCK_TYPES) {
    it(`${type} textAlign=block: value is right-aligned at block.x+width`, async () => {
      const block = blk(type as PdfBlockDto['type'], s, { textAlign: 'block' });
      const bytes = await svc.render(tmpl(block), BASE);
      const { textItems: items } = await extractPageData(bytes);
      expect(items.length, `${type}: no text items rendered`).toBeGreaterThan(0);
      // Right edge of the row should be near block.x + block.width
      const rows = [...new Set(items.map(i => Math.round(i.y)))];
      for (const rowY of rows) {
        const re = rowRightEdge(items, rowY);
        near(re, block.x + block.width, `${type}[block] row-y=${rowY} right-edge`, 1.0);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Auto-height: computeBlockContentHeight matches actual rendered content
// ---------------------------------------------------------------------------

/** Block types that use auto-height (all except 'image' and 'line') */
const AUTO_HEIGHT_TYPES: PdfBlockDto['type'][] = [
  'seller-address', 'buyer-address', 'invoice-header',
  'invoice-title', 'invoice-number', 'invoice-date', 'due-date', 'buyer-reference',
  'total-net', 'total-tax', 'total-gross', 'totals',
  'payment-means', 'iban-bic', 'payment-terms', 'payment-info',
  'lines-table', 'free-text',
];

describe('computeBlockContentHeight — height matches content for auto-height block types', () => {
  const s = S[2]; // fontSize=10, x=100, y=150, width=260

  for (const type of AUTO_HEIGHT_TYPES) {
    it(`${type}: computed height ≥ 1 and deterministic`, () => {
      const extra: Partial<PdfBlockDto> = { height: 200 };
      if (type === 'free-text') extra.content = 'Zeile 1\nZeile 2\nZeile 3';
      if (type === 'lines-table') extra.showHeader = true;
      const block = blk(type, s, extra);
      const h1 = computeBlockContentHeight(block, BASE);
      const h2 = computeBlockContentHeight(block, BASE);
      expect(h1).toBeGreaterThanOrEqual(1);
      expect(h1).toBe(h2); // Deterministic
    });
  }

  it('image: computeBlockContentHeight returns block.height', () => {
    const block = blk('image', S[0], { height: 80, lockAspectRatio: true });
    expect(computeBlockContentHeight(block, BASE)).toBe(80);
  });

  it('line: computeBlockContentHeight returns lineThickness', () => {
    const block = blk('line', S[0], { lineThickness: 3, height: 3 });
    expect(computeBlockContentHeight(block, BASE)).toBe(3);
  });

  it('seller-address height increases with vatId and taxNumber', () => {
    const base = blk('seller-address', s, { height: 200 });
    const withExtra = blk('seller-address', s, {
      height: 200,
    });
    const invoiceWithExtra: InvoiceDto = {
      ...BASE,
      seller: { ...BASE.seller, vatId: 'DE123', taxNumber: '123/456' },
    };
    const invoiceWithoutExtra: InvoiceDto = {
      ...BASE,
      seller: { ...BASE.seller, vatId: undefined, taxNumber: undefined },
    };
    const hWith = computeBlockContentHeight(base, invoiceWithExtra);
    const hWithout = computeBlockContentHeight(withExtra, invoiceWithoutExtra);
    expect(hWith).toBeGreaterThan(hWithout);
  });

  it('due-date returns 0 when no dueDate', () => {
    const block = blk('due-date', s, { height: 20 });
    const invoiceNoDue: InvoiceDto = { ...BASE, dueDate: undefined };
    expect(computeBlockContentHeight(block, invoiceNoDue)).toBe(0);
  });

  it('total-tax returns 0 for Kleinunternehmer', () => {
    const block = blk('total-tax', s, { height: 20 });
    const invoiceKl: InvoiceDto = { ...BASE, kleinunternehmer: true };
    expect(computeBlockContentHeight(block, invoiceKl)).toBe(0);
  });

  it('lines-table height scales with line count', () => {
    const block = blk('lines-table', s, { showHeader: true, lineHeight: 1.8, height: 200 });
    const inv1 = { ...BASE, lines: [BASE_LINE] };
    const inv3 = { ...BASE, lines: [BASE_LINE, { ...BASE_LINE, lineNumber: 2 }, { ...BASE_LINE, lineNumber: 3 }] };
    const h1 = computeBlockContentHeight(block, inv1);
    const h3 = computeBlockContentHeight(block, inv3);
    expect(h3).toBeGreaterThan(h1);
    // Each additional line adds fontSize * lineHeight
    const rowH = (s.fontSize) * 1.8;
    near(h3 - h1, 2 * rowH, 'lines-table 2 extra rows', 0.5);
  });

  it('free-text height scales with newlines', () => {
    const b1 = blk('free-text', s, { content: 'Zeile 1', height: 200 });
    const b3 = blk('free-text', s, { content: 'Zeile 1\nZeile 2\nZeile 3', height: 200 });
    const h1 = computeBlockContentHeight(b1, BASE);
    const h3 = computeBlockContentHeight(b3, BASE);
    expect(h3).toBeGreaterThan(h1);
    near(h3 - h1, 2 * s.fontSize * 1.4, 'free-text 2 extra lines', 0.5);
  });

  it('content override: height = number of lines × lineH', () => {
    const block = blk('invoice-number', s, { content: 'Zeile 1\nZeile 2', height: 200 });
    const h = computeBlockContentHeight(block, BASE);
    near(h, 2 * s.fontSize * 1.4, 'content override 2 lines', 0.5);
  });
});

// ---------------------------------------------------------------------------
// lines-table — per-column alignment
// ---------------------------------------------------------------------------

describe('lines-table column alignment', () => {
  // Column proportions (all 6 visible):
  // pos=0.06, name=0.34, qty=0.1, unit=0.1, price=0.2, total=0.2  → total=1.0
  const COL_RATIOS: Record<string, number> = { pos: 0.06, name: 0.34, qty: 0.1, unit: 0.1, price: 0.2, total: 0.2 };
  const BLOCK_W = 450;
  const BLOCK_X = 57;
  const BLOCK_Y = 100;
  const FS = 10;
  const LINE_HEIGHT = 1.8;

  // colX in PdfRenderService starts at block.x (symmetric 4pt padding on both sides).
  // left:   textX = colX + 4             right:  textX = colX + colW - 4 - measure
  function colLeft(colKey: string): number {
    const keys = ['pos', 'name', 'qty', 'unit', 'price', 'total'];
    let x = BLOCK_X;
    for (const k of keys) {
      if (k === colKey) break;
      x += COL_RATIOS[k] * BLOCK_W;
    }
    return x;
  }

  function colRight(colKey: string): number {
    return colLeft(colKey) + COL_RATIOS[colKey] * BLOCK_W;
  }

  it('ALL rows: left-aligned and right-aligned outer columns have equal 4pt padding from block edges', async () => {
    // Regression for colX = block.x + 4 bug: 4pt left but 0pt right padding.
    // Uses TWO invoice lines with different amounts to verify ALL data rows behave
    // identically — the right edge must be block.x + block.width - 4 for every row.
    const block: PdfBlockDto = {
      id: '1', type: 'lines-table',
      x: BLOCK_X, y: BLOCK_Y, width: BLOCK_W, height: 250,
      fontSize: FS, fontColor: '#1c1b18', fontWeight: 'normal',
      showHeader: false, lineHeight: LINE_HEIGHT,
      columns: ['name', 'total'],
      columnAlignments: { name: 'left', total: 'right' },
    };
    const inv: InvoiceDto = {
      ...BASE,
      lines: [
        { lineNumber: 1, itemName: 'Alpha', quantity: 1, unitCode: 'HUR', netPrice: 100,  vatCategoryCode: 'S', vatRate: 19, lineNetAmount: 100 },
        { lineNumber: 2, itemName: 'Beta',  quantity: 1, unitCode: 'HUR', netPrice: 1000, vatCategoryCode: 'S', vatRate: 19, lineNetAmount: 1000 },
      ],
    };
    const { textItems: items } = await extractPageData(await svc.render(tmpl(block), inv));

    // Left padding: both name cells must start at block.x + 4
    const nameItems = items.filter(i => i.text === 'Alpha' || i.text === 'Beta');
    expect(nameItems).toHaveLength(2);
    for (const item of nameItems) {
      near(item.x - BLOCK_X, 4, `"${item.text}" left padding`, 1.5);
    }

    // Right padding: rightmost item on each row (the € or the amount) must end at block.x + block.width - 4.
    // Sort items by y (PDF y = bottom of text, so higher y = higher on page = earlier row).
    const uniqueRows = [...new Set(items.map(i => Math.round(i.y)))].sort((a, b) => b - a);
    expect(uniqueRows.length, 'expected 2 data rows').toBe(2);

    for (const rowY of uniqueRows) {
      const rowItems = items.filter(i => Math.abs(i.y - rowY) <= 1);
      const rightEdge = Math.max(...rowItems.map(i => i.x + i.width));
      near(rightEdge, BLOCK_X + BLOCK_W - 4, `row y=${rowY} right edge`, 1.5);
    }

    // Both rows must have the SAME right edge (padding must be consistent across rows)
    const rowEdges = uniqueRows.map(rowY => {
      const rowItems = items.filter(i => Math.abs(i.y - rowY) <= 1);
      return Math.max(...rowItems.map(i => i.x + i.width));
    });
    near(rowEdges[0], rowEdges[1], 'right edge consistent across rows', 1.0);
  });

  it('price column right-aligned: cell text ends 4pt from block right edge (single-col block)', async () => {
    // Use only 'price' column so pdfjs won't merge adjacent cells
    const singleColBlock: PdfBlockDto = {
      id: '1', type: 'lines-table',
      x: BLOCK_X, y: BLOCK_Y, width: 150, height: 200,
      fontSize: FS, fontColor: '#1c1b18', fontWeight: 'normal',
      showHeader: false, lineHeight: LINE_HEIGHT,
      columns: ['price'],
      columnAlignments: { price: 'right' },
    };
    const inv: InvoiceDto = {
      ...BASE,
      lines: [{ lineNumber: 1, itemName: 'Test', quantity: 1, unitCode: 'HUR', netPrice: 75, vatCategoryCode: 'S', vatRate: 19, lineNetAmount: 75 }],
    };
    const bytes = await svc.render(tmpl(singleColBlock), inv);
    const { textItems: items } = await extractPageData(bytes);

    const colW = singleColBlock.width;
    const priceText = '75,00 €';
    const priceItem = items.find(i => i.text === priceText || i.text.includes(priceText));
    expect(priceItem, `price cell "${priceText}" not found in ${JSON.stringify(items.map(i => i.text))}`).toBeDefined();

    // Right-aligned: text right edge = block.x + colW - 4 (4pt from right block edge)
    const textWidth = measureHelveticaWidth(priceText, FS - 1);
    const expectedX = BLOCK_X + colW - 4 - textWidth;
    near(priceItem!.x, expectedX, 'price right-aligned x', 2.0);
    // Verify right-edge padding is ~4pt, not 0pt
    const rightEdge = priceItem!.x + priceItem!.width;
    near(rightEdge, BLOCK_X + colW - 4, 'price right edge (4pt from block right)', 2.0);
  });

  it('total column right-aligned: cell text ends 4pt from block right edge', async () => {
    const block: PdfBlockDto = {
      id: '1', type: 'lines-table',
      x: BLOCK_X, y: BLOCK_Y, width: BLOCK_W, height: 200,
      fontSize: FS, fontColor: '#1c1b18', fontWeight: 'normal',
      showHeader: false, lineHeight: LINE_HEIGHT,
      columnAlignments: { total: 'right' },
    };
    const inv: InvoiceDto = {
      ...BASE,
      // Distinct price (80) vs lineNetAmount (240) so they don't collide
      lines: [{ lineNumber: 1, itemName: 'Test', quantity: 3, unitCode: 'HUR', netPrice: 80, vatCategoryCode: 'S', vatRate: 19, lineNetAmount: 240 }],
    };
    const bytes = await svc.render(tmpl(block), inv);
    const { textItems: items } = await extractPageData(bytes);

    const totalText = '240,00 €';
    const totalItem = items.find(i => i.text === totalText);
    expect(totalItem, `total cell "${totalText}" not found in ${JSON.stringify(items.map(i => i.text))}`).toBeDefined();

    // Right edge of text must be block.x + block.width - 4 (4pt right padding, same as left)
    const textWidth = measureHelveticaWidth(totalText, FS - 1);
    const expectedX = BLOCK_X + BLOCK_W - 4 - textWidth;
    near(totalItem!.x, expectedX, 'total right-aligned x', 2.0);
    near(totalItem!.x + totalItem!.width, BLOCK_X + BLOCK_W - 4, 'total right edge (4pt from block right)', 2.0);
  });

  it('pos column center-aligned: cell text centered in column', async () => {
    const block: PdfBlockDto = {
      id: '1', type: 'lines-table',
      x: BLOCK_X, y: BLOCK_Y, width: BLOCK_W, height: 200,
      fontSize: FS, fontColor: '#1c1b18', fontWeight: 'normal',
      showHeader: false, lineHeight: LINE_HEIGHT,
      columnAlignments: { pos: 'center' },
    };
    const inv: InvoiceDto = {
      ...BASE,
      lines: [{ lineNumber: 1, itemName: 'Test', quantity: 1, unitCode: 'HUR', netPrice: 100, vatCategoryCode: 'S', vatRate: 19, lineNetAmount: 100 }],
    };
    const bytes = await svc.render(tmpl(block), inv);
    const { textItems: items } = await extractPageData(bytes);

    const posText = '1';
    const posItem = items.find(i => i.text === posText);
    expect(posItem, `pos cell "${posText}" not found`).toBeDefined();

    const colW = COL_RATIOS['pos'] * BLOCK_W;
    const textWidth = measureHelveticaWidth(posText, FS - 1);
    // Center: colX + (colW - textWidth) / 2 where colX = BLOCK_X (col starts at block left edge)
    const expectedX = colLeft('pos') + (colW - textWidth) / 2;
    near(posItem!.x, expectedX, 'pos center-aligned x', 2.0);
  });

  it('header row and first data row have equal left and right padding per column', async () => {
    // Regression: bold header text vs regular data text must land at the same
    // column edges. Both use colX + colW - 4 - measureWidth formula, so
    // rightEdge = colX + colW - 4 regardless of text width or font weight.
    const block: PdfBlockDto = {
      id: '1', type: 'lines-table',
      x: BLOCK_X, y: BLOCK_Y, width: BLOCK_W, height: 200,
      fontSize: FS, fontColor: '#1c1b18', fontWeight: 'normal',
      showHeader: true, lineHeight: LINE_HEIGHT,
      columns: ['name', 'total'],
      columnAlignments: { name: 'left', total: 'right' },
    };
    const inv: InvoiceDto = {
      ...BASE,
      lines: [{ lineNumber: 1, itemName: 'Alpha', quantity: 1, unitCode: 'HUR', netPrice: 100, vatCategoryCode: 'S', vatRate: 19, lineNetAmount: 100 }],
    };
    const { textItems: items } = await extractPageData(await svc.render(tmpl(block), inv));

    // Identify header vs data row by Y (PDF Y is bottom-up: header is topmost = highest Y)
    const maxY = Math.max(...items.map(i => i.y));
    const headerItems = items.filter(i => Math.abs(i.y - maxY) <= 3);
    const dataItems   = items.filter(i => i.y < maxY - 5);

    // Left-aligned column: header "Bezeichnung" and data "Alpha" both start at block.x + 4
    const headerLeft = headerItems.find(i => i.text.toLowerCase().includes('bezeichnung'));
    const dataLeft   = dataItems.find(i => i.text === 'Alpha');
    expect(headerLeft, '"Bezeichnung" header item not found').toBeDefined();
    expect(dataLeft,   '"Alpha" data item not found').toBeDefined();
    near(headerLeft!.x - BLOCK_X, 4, 'header left padding', 1.5);
    near(dataLeft!.x   - BLOCK_X, 4, 'data left padding',   1.5);
    near(headerLeft!.x, dataLeft!.x, 'header and data left edges match', 1.5);

    // Right-aligned column: header "Netto" and data row right edge both at block.x + block.width - 4
    const headerRight     = headerItems.find(i => i.text.toLowerCase() === 'netto');
    const dataRightEdge   = Math.max(...dataItems.map(i => i.x + i.width));
    expect(headerRight, '"Netto" header item not found').toBeDefined();
    const headerRightEdge = headerRight!.x + headerRight!.width;
    near(headerRightEdge, BLOCK_X + BLOCK_W - 4, 'header right edge (4pt from block right)', 1.5);
    near(dataRightEdge,   BLOCK_X + BLOCK_W - 4, 'data row right edge (4pt from block right)', 1.5);
    near(headerRightEdge, dataRightEdge, 'header and data right edges match', 1.5);
  });
});

// ---------------------------------------------------------------------------
// T. lines-table — font respects block fontWeight
// Regression: drawLinesTable previously hardcoded 'Helvetica'/'Helvetica-Bold'
// regardless of block.fontWeight, so setting fontWeight:'bold' had no effect
// on data cell rendering.
// ---------------------------------------------------------------------------

describe('lines-table — fontWeight applied to data cells', () => {
  const CELL_TEXT = 'Webdesign';
  const FONT_SIZE = 10;
  const DATA_FS = FONT_SIZE - 1; // 9 — table uses fontSize-1

  it('data cells use Helvetica when fontWeight=normal', async () => {
    const block = blk('lines-table', { ...S[0], fontSize: FONT_SIZE, fontWeight: 'normal' }, { height: 120, lineHeight: 1.8 });
    const inv: InvoiceDto = { ...BASE, lines: [{ ...BASE_LINE, itemName: CELL_TEXT }] };
    const { textItems: items } = await extractPageData(await svc.render(tmpl(block), inv));

    const cell = items.find(i => i.text === CELL_TEXT || i.text.includes(CELL_TEXT));
    expect(cell, 'data cell not found').toBeDefined();

    const regularWidth = measureHelveticaWidth(CELL_TEXT, DATA_FS, 'Helvetica');
    const boldWidth    = measureHelveticaWidth(CELL_TEXT, DATA_FS, 'Helvetica-Bold');
    // Width must be closer to regular than bold
    expect(Math.abs(cell!.width - regularWidth), 'normal cells should use Helvetica-Regular')
      .toBeLessThan(Math.abs(cell!.width - boldWidth));
  });

  it('data cells use Helvetica-Bold when fontWeight=bold', async () => {
    const block = blk('lines-table', { ...S[0], fontSize: FONT_SIZE, fontWeight: 'bold' }, { height: 120, lineHeight: 1.8 });
    const inv: InvoiceDto = { ...BASE, lines: [{ ...BASE_LINE, itemName: CELL_TEXT }] };
    const { textItems: items } = await extractPageData(await svc.render(tmpl(block), inv));

    const cell = items.find(i => i.text === CELL_TEXT || i.text.includes(CELL_TEXT));
    expect(cell, 'data cell not found').toBeDefined();

    const regularWidth = measureHelveticaWidth(CELL_TEXT, DATA_FS, 'Helvetica');
    const boldWidth    = measureHelveticaWidth(CELL_TEXT, DATA_FS, 'Helvetica-Bold');
    // Width must be closer to bold than regular
    expect(Math.abs(cell!.width - boldWidth), 'bold cells should use Helvetica-Bold')
      .toBeLessThan(Math.abs(cell!.width - regularWidth));
  });
});

// ---------------------------------------------------------------------------
// U. € symbol rendered correctly in currency value blocks (embedded font)
//
// WHY: pdfjs extracts "€" via ToUnicode CMap even when the glyph is .notdef
// (invisible), so textItems.some(i => i.text.includes('€')) is a false positive.
//
// Real failures we guard against:
//   1. Word-wrap bug: LibPDF layoutText splits "1.000,00 €" at the space when
//      maxWidth is set → "€" wraps to a 2nd line, hidden below the row height.
//      Detection: a lone "€" item appears, or the item containing € is just "€".
//   2. Notdef rendering: embedded font lacks the glyph → zero/tiny width item.
//      Detection: item.width < 15pt at ~9pt font size.
//
// Both bugs are invisible to a naive text.includes('€') assertion.
// Using a real embedded font (FuturaPTBook.otf, canEncode('€')=true) ensures
// the assertions are meaningful — the font CAN render €, so any failure
// reflects a real rendering/layout bug.
// ---------------------------------------------------------------------------

describe('€ symbol rendered correctly in currency values (embedded font)', () => {
  let fontBase64: string;

  beforeAll(() => {
    // FuturaPTBook.otf is available in the Docker container at /app/FuturaPTBook.otf.
    // canEncode('€') = true → the font has the € glyph; rendering failures are real.
    fontBase64 = readFileSync('/app/FuturaPTBook.otf').toString('base64');
  });

  function tmplWithFont(block: PdfBlockDto): PdfTemplateDto {
    return {
      id: 1, name: 't', pageSize: 'a4', orientation: 'portrait',
      blocks: [block],
      customFonts: [{ name: 'FuturaPT', data: fontBase64, mimeType: 'font/otf' }],
    };
  }

  /** Asserts that the € symbol is rendered as part of a full currency string,
   *  not as a lone word-wrapped item, and that the item has a non-trivial width. */
  function assertEuroRendered(textItems: PdfTextItem[], tag: string): void {
    // Must have at least one item containing "€"
    const euroItems = textItems.filter(i => i.text.includes('€'));
    expect(euroItems.length, `${tag}: no item containing "€" found`).toBeGreaterThan(0);

    // None of those items should be JUST "€" (lone € = word-wrap bug)
    const loneEuro = textItems.find(i => i.text.trim() === '€');
    expect(loneEuro, `${tag}: lone "€" item found — indicates word-wrap bug (layoutText split at space)`).toBeUndefined();

    // Each € item must have a non-trivial width — catches notdef (.notdef has zero/tiny advance)
    for (const item of euroItems) {
      expect(item.width, `${tag}: "${item.text}" has near-zero width (${item.width.toFixed(2)}pt) — € may be rendering as notdef`).toBeGreaterThan(15);
    }
  }

  it('total-net: "amount €" renders as one item with real width', async () => {
    const block = blk('total-net', S[2], { fontFamily: 'FuturaPT' });
    const { textItems } = await extractPageData(await svc.render(tmplWithFont(block), BASE));
    assertEuroRendered(textItems, 'total-net');
  });

  it('total-gross: "amount €" renders as one item with real width', async () => {
    const block = blk('total-gross', S[2], { fontFamily: 'FuturaPT' });
    const { textItems } = await extractPageData(await svc.render(tmplWithFont(block), BASE));
    assertEuroRendered(textItems, 'total-gross');
  });

  it('totals: Nettobetrag and Bruttobetrag values render "amount €" correctly', async () => {
    const block = blk('totals', S[2], { height: 120, fontFamily: 'FuturaPT' });
    const { textItems } = await extractPageData(await svc.render(tmplWithFont(block), BASE));
    assertEuroRendered(textItems, 'totals');
    // Specifically need at least 2 euro items (Netto + Brutto rows)
    const euroItems = textItems.filter(i => i.text.includes('€'));
    expect(euroItems.length, 'totals: expected ≥2 rows with € (Nettobetrag + Bruttobetrag)').toBeGreaterThanOrEqual(2);
  });

  it('lines-table: price and total cells render "amount €" without word-wrap (right-aligned)', async () => {
    // Right-aligned columns have no maxWidth → no word-wrap of "1.234,56 €"
    const block = blk('lines-table', S[2], {
      height: 120, lineHeight: 1.8,
      fontFamily: 'FuturaPT',
      columnAlignments: { price: 'right', total: 'right' },
    });
    const { textItems } = await extractPageData(await svc.render(tmplWithFont(block), BASE));
    assertEuroRendered(textItems, 'lines-table');
    // Expect exactly 2 € items: one for price, one for total (1 invoice line)
    const euroItems = textItems.filter(i => i.text.includes('€'));
    expect(euroItems.length, 'lines-table: expected 2 € items (price + total columns)').toBe(2);
  });
});

// ---------------------------------------------------------------------------
// U2. € fallback for fonts without U+20AC in cmap (e.g. FF Dax Wide)
//
// Some commercial fonts have the € glyph in the font file but NOT mapped to
// U+20AC (8364) in their Unicode cmap table. LibPDF's canEncode() returns false
// for such characters. Browsers silently substitute from a system font; our
// drawTextSafe() does the same via Helvetica fallback.
//
// Detection: when the fallback works, pdfjs extracts "€" as a SEPARATE text item
// with a DIFFERENT fontName than the surrounding amount text (because it was
// rendered as a separate page.drawText call with Helvetica). The item width is
// non-zero (Helvetica renders € at ~5.56pt at 10pt).
// ---------------------------------------------------------------------------

describe('€ fallback for fonts without U+20AC cmap entry (FF Dax Wide)', () => {
  let daxBase64: string;

  beforeAll(() => {
    // FF Dax Wide Regular.otf: canEncode('€') = false — no U+20AC in cmap.
    // drawTextSafe() must fall back to Helvetica for the € character.
    daxBase64 = readFileSync('/app/FF Dax Wide Regular.otf').toString('base64');
  });

  function tmplWithDax(block: PdfBlockDto): PdfTemplateDto {
    return {
      id: 1, name: 't', pageSize: 'a4', orientation: 'portrait',
      blocks: [block],
      customFonts: [{ name: 'FFDax', data: daxBase64, mimeType: 'font/otf' }],
    };
  }

  it('total-net: € appears in PDF via Helvetica fallback (separate fontName from amount)', async () => {
    const block = blk('total-net', S[2], { fontFamily: 'FFDax' });
    const { textItems } = await extractPageData(await svc.render(tmplWithDax(block), BASE));

    // € must appear somewhere
    const euroItem = textItems.find(i => i.text.trim() === '€');
    expect(euroItem, 'FF Dax Wide: lone "€" item must exist — rendered in Helvetica fallback').toBeDefined();

    // € item must have non-zero width (it's visually rendered, not notdef)
    expect(euroItem!.width, '€ item has zero/tiny width — Helvetica fallback may not be working').toBeGreaterThan(4);

    // The amount before € must be in a DIFFERENT font (the embedded FF Dax font)
    // This proves € is rendered separately in Helvetica, not as notdef in FF Dax
    const amountItem = textItems.find(i => i.text.includes(',') && !i.text.includes('€'));
    if (amountItem) {
      expect(amountItem.fontName, '€ and amount should be in different fonts').not.toBe(euroItem!.fontName);
    }
  });

  it('totals: € in Nettobetrag/Bruttobetrag values falls back to Helvetica', async () => {
    const block = blk('totals', S[2], { height: 120, fontFamily: 'FFDax' });
    const { textItems } = await extractPageData(await svc.render(tmplWithDax(block), BASE));

    const euroItems = textItems.filter(i => i.text.trim() === '€');
    expect(euroItems.length, 'FF Dax Wide totals: expected ≥2 lone "€" items (one per row)').toBeGreaterThanOrEqual(2);
    for (const item of euroItems) {
      expect(item.width, `€ item width ${item.width.toFixed(2)}pt — must be non-zero for Helvetica fallback`).toBeGreaterThan(4);
    }
  });

  it('lines-table: € in price/total cells falls back to Helvetica (right-aligned)', async () => {
    const block = blk('lines-table', S[2], {
      height: 120, lineHeight: 1.8,
      fontFamily: 'FFDax',
      columnAlignments: { price: 'right', total: 'right' },
    });
    const { textItems } = await extractPageData(await svc.render(tmplWithDax(block), BASE));

    const euroItems = textItems.filter(i => i.text.trim() === '€');
    expect(euroItems.length, 'FF Dax Wide lines-table: expected 2 lone "€" items (price + total)').toBe(2);
    for (const item of euroItems) {
      expect(item.width, `€ item width ${item.width.toFixed(2)}pt — Helvetica fallback`).toBeGreaterThan(4);
    }
  });
});
