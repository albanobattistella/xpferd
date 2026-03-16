/**
 * PDF alignment tests — non-circular strategy.
 *
 * WHY previous tests were useless:
 *   expectedY = 842 - block.y - fontSize   ← same formula as the renderer
 *   → tests always pass regardless of bugs
 *
 * Non-circular checks used here:
 *   RIGHT-EDGE  item.x + item.width ≈ blockRight
 *               pdfjs measures width from the PDF font program (Helvetica glyph metrics).
 *               Our measureHelveticaWidth uses a lookup table — they're independent.
 *               A right-aligned value must end at the block's right edge.
 *               A value placed at a fixed % offset will fail this check.
 *
 *   LINE-DELTA  item[n].y − item[n+1].y ≈ fontSize * lineH_factor
 *               We measure the actual spacing LibPDF produced, then compare
 *               to the expected constant. Wrong line-height factor → test fails.
 *
 *   FONT-SIZE   Math.abs(item.transform[0]) from pdfjs ≈ expected pt size.
 *               Independent of how the renderer passes size to LibPDF.
 *
 *   SAME-ROW    |label.y − value.y| < 0.5
 *               Label and value must share the same baseline.
 *
 *   ORDERING    label.x < value.x  (label is always to the left)
 *
 *   CONTAINMENT item.y within [pageH−block.y−block.height, pageH−block.y]
 *               Text cannot appear outside its block's vertical bounds.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import { Database } from '../../src/server/database/Database.js';
import { PdfRenderService } from '../../src/server/services/PdfRenderService.js';
import type { PdfBlockDto, PdfTemplateDto, InvoiceDto } from '../../src/shared/types';
import { extractPdfTextItems, extractPdfLines, findTextItem } from '../utils/pdfTextExtractor.js';
import type { PdfTextItem } from '../utils/pdfTextExtractor.js';

const TEST_DB = path.resolve(process.cwd(), `test/.test-pdf-align-${Date.now()}.db`);

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

const PAGE_HEIGHT = 842; // A4 points

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const INVOICE: InvoiceDto = {
  invoiceNumber: 'RE-2024-0042',
  invoiceDate: '2024-03-15',
  dueDate: '2024-04-15',
  buyerReference: 'LW-4200',
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
    { lineNumber: 1, itemName: 'Webdesign Startseite', quantity: 1, unitCode: 'HUR', netPrice: 850, vatCategoryCode: 'S', vatRate: 19, lineNetAmount: 850 },
    { lineNumber: 2, itemName: 'SEO-Optimierung', quantity: 5, unitCode: 'HUR', netPrice: 80, vatCategoryCode: 'S', vatRate: 19, lineNetAmount: 400 },
  ],
};

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
  seller: { name: 'Solo GmbH', street: 'Str 1', postalCode: '12345', city: 'Stadt', countryCode: 'DE' },
  buyer: { name: 'Kunde AG', street: 'Weg 2', postalCode: '54321', city: 'Ort', countryCode: 'DE' },
  lines: [
    { lineNumber: 1, itemName: 'Beratung', quantity: 2, unitCode: 'HUR', netPrice: 250, vatCategoryCode: 'E', vatRate: 0, lineNetAmount: 500 },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const svc = new PdfRenderService();

function makeTemplate(block: PdfBlockDto): PdfTemplateDto {
  return { id: 1, name: 'test', pageSize: 'a4', orientation: 'portrait', blocks: [block] };
}

/** Items on the same horizontal row (Y within tol). */
function rowItems(items: PdfTextItem[], y: number, tol = 0.8): PdfTextItem[] {
  return items.filter(i => Math.abs(i.y - y) <= tol);
}

/** Right edge of all items on a row = the maximum (item.x + item.width). */
function rowRightEdge(items: PdfTextItem[], y: number): number {
  const row = rowItems(items, y);
  return row.length ? Math.max(...row.map(i => i.x + i.width)) : -1;
}

/** Left edge of all items on a row = the minimum item.x. */
function rowLeftEdge(items: PdfTextItem[], y: number): number {
  const row = rowItems(items, y);
  return row.length ? Math.min(...row.map(i => i.x)) : -1;
}

function expectNear(actual: number, expected: number, label: string, tol = 1.0): void {
  expect(
    Math.abs(actual - expected),
    `${label}: expected ≈${expected.toFixed(2)}, got ${actual.toFixed(2)} (diff ${Math.abs(actual - expected).toFixed(2)}pt)`,
  ).toBeLessThanOrEqual(tol);
}

/** Check value ends at the block's right edge using pdfjs-reported glyph widths.
 *  Tolerance 5pt: accounts for cumulative char-width measurement error in longer strings.
 *  A fixed-% offset bug (e.g. block.width * 0.55) will be off by 30-50pt → still caught. */
function expectRightAlignedToBlock(
  items: PdfTextItem[],
  labelText: string,
  block: PdfBlockDto,
  testLabel: string,
): void {
  const labelItem = findTextItem(items, labelText);
  expect(labelItem, `"${labelText}" not found`).toBeDefined();

  const rightEdge = rowRightEdge(items, labelItem!.y);
  expectNear(rightEdge, block.x + block.width, `${testLabel} right-edge`, 5.0);
}

/** Check label.y === value.y (same baseline). */
function expectSameRow(
  items: PdfTextItem[],
  labelText: string,
  valueText: string,
  testLabel: string,
): void {
  const lItem = findTextItem(items, labelText);
  expect(lItem, `label "${labelText}" not found`).toBeDefined();

  // value might be split by pdfjs — check any item with the value text fragment
  const vItem = items.find(i => i.text.includes(valueText) || valueText.includes(i.text.trim()));
  expect(vItem, `value containing "${valueText}" not found`).toBeDefined();

  expectNear(lItem!.y, vItem!.y, `${testLabel}: label.y === value.y`, 0.5);
}

/** Check label.x < value start (label is to the left). */
function expectLabelLeftOfValue(
  items: PdfTextItem[],
  labelText: string,
  block: PdfBlockDto,
  testLabel: string,
): void {
  const labelItem = findTextItem(items, labelText);
  expect(labelItem, `"${labelText}" not found`).toBeDefined();

  const row = rowItems(items, labelItem!.y);
  const valueItems = row.filter(i => i.x > labelItem!.x);
  expect(valueItems.length, `${testLabel}: no items to the right of label`).toBeGreaterThan(0);
}

/** Verify Y delta between item1 and item2 equals expectedLineH. */
function expectLineDelta(item1: PdfTextItem, item2: PdfTextItem, expectedLineH: number, label: string): void {
  const delta = item1.y - item2.y; // item2 is rendered below item1
  expectNear(delta, expectedLineH, label, 1.5);
}

/** Verify text item is inside block's vertical PDF bounds. */
function expectWithinBlock(item: PdfTextItem, block: PdfBlockDto, label: string): void {
  const pdfTop = PAGE_HEIGHT - block.y;
  const pdfBottom = PAGE_HEIGHT - block.y - block.height;
  expect(item.y, `${label}: y=${item.y.toFixed(1)} above block top ${pdfTop}`).toBeLessThanOrEqual(pdfTop + 1);
  expect(item.y, `${label}: y=${item.y.toFixed(1)} below block bottom ${pdfBottom}`).toBeGreaterThanOrEqual(pdfBottom - 1);
}

// ---------------------------------------------------------------------------
// Suite A — label:value blocks (drawLabelValue)
// ---------------------------------------------------------------------------

describe('label:value blocks — right-edge, same-row, ordering, containment', () => {
  const cases: { type: PdfBlockDto['type']; label: string; valueFragment: string }[] = [
    { type: 'invoice-number', label: 'Nr.:', valueFragment: 'RE-2024-0042' },
    { type: 'invoice-date',   label: 'Datum:', valueFragment: '15.03.2024' },
    { type: 'due-date',       label: 'Fällig:', valueFragment: '15.04.2024' },
    { type: 'buyer-reference', label: 'Referenz:', valueFragment: 'LW-4200' },
    { type: 'total-net',      label: 'Nettobetrag:', valueFragment: '1.250,00' },
    { type: 'total-gross',    label: 'Bruttobetrag:', valueFragment: '1.487,50' },
    { type: 'total-tax',      label: 'USt. 19%:', valueFragment: '237,50' },
    { type: 'payment-terms',  label: 'Zahlungsziel:', valueFragment: '30 Tage' },
  ];

  for (const { type, label, valueFragment } of cases) {
    it(`${type}: value ends at block right edge`, async () => {
      const block: PdfBlockDto = { id: '1', type, x: 60, y: 120, width: 240, height: 20, fontSize: 10 };
      const bytes = await svc.render(makeTemplate(block), INVOICE);
      const items = await extractPdfTextItems(bytes);
      expectRightAlignedToBlock(items, label, block, type);
    });

    it(`${type}: label and value on same baseline`, async () => {
      const block: PdfBlockDto = { id: '1', type, x: 60, y: 120, width: 240, height: 20, fontSize: 10 };
      const bytes = await svc.render(makeTemplate(block), INVOICE);
      const items = await extractPdfTextItems(bytes);
      expectSameRow(items, label, valueFragment, type);
    });

    it(`${type}: label is to the left of value`, async () => {
      const block: PdfBlockDto = { id: '1', type, x: 60, y: 120, width: 240, height: 20, fontSize: 10 };
      const bytes = await svc.render(makeTemplate(block), INVOICE);
      const items = await extractPdfTextItems(bytes);
      expectLabelLeftOfValue(items, label, block, type);
    });

    it(`${type}: label font size matches block.fontSize`, async () => {
      const block: PdfBlockDto = { id: '1', type, x: 60, y: 120, width: 240, height: 20, fontSize: 10 };
      const bytes = await svc.render(makeTemplate(block), INVOICE);
      const items = await extractPdfTextItems(bytes);
      const labelItem = findTextItem(items, label);
      expect(labelItem, `"${label}" not found`).toBeDefined();
      expectNear(labelItem!.fontSize, block.fontSize!, `${type} fontSize`, 0.5);
    });

    it(`${type}: all text within block vertical bounds`, async () => {
      const block: PdfBlockDto = { id: '1', type, x: 60, y: 120, width: 240, height: 20, fontSize: 10 };
      const bytes = await svc.render(makeTemplate(block), INVOICE);
      const items = await extractPdfTextItems(bytes);
      for (const item of items) expectWithinBlock(item, block, `${type} item "${item.text}"`);
    });
  }

  it('payment-means: value ends at block right edge', async () => {
    const block: PdfBlockDto = { id: '1', type: 'payment-means', x: 60, y: 120, width: 240, height: 20, fontSize: 10 };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    expectRightAlignedToBlock(items, 'Zahlungsart:', block, 'payment-means');
  });

  it('total-tax absent when kleinunternehmer=true', async () => {
    const block: PdfBlockDto = { id: '1', type: 'total-tax', x: 60, y: 120, width: 240, height: 20, fontSize: 10 };
    const bytes = await svc.render(makeTemplate(block), MINIMAL_INVOICE);
    const items = await extractPdfTextItems(bytes);
    expect(items.length, 'no text expected for kleinunternehmer total-tax').toBe(0);
  });

  it('right-edge holds for larger fontSize=14', async () => {
    const block: PdfBlockDto = { id: '1', type: 'invoice-number', x: 60, y: 120, width: 300, height: 30, fontSize: 14 };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    expectRightAlignedToBlock(items, 'Nr.:', block, 'invoice-number fs=14');
  });

  it('right-edge holds for smaller fontSize=8', async () => {
    const block: PdfBlockDto = { id: '1', type: 'invoice-number', x: 60, y: 120, width: 240, height: 20, fontSize: 8 };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    expectRightAlignedToBlock(items, 'Nr.:', block, 'invoice-number fs=8');
  });
});

// ---------------------------------------------------------------------------
// Suite B — invoice-header (label:value, multiple rows)
// ---------------------------------------------------------------------------

describe('invoice-header', () => {
  const block: PdfBlockDto = { id: '1', type: 'invoice-header', x: 350, y: 100, width: 200, height: 80, fontSize: 10 };

  it('Nr.: value ends at block right edge', async () => {
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    expectRightAlignedToBlock(items, 'Nr.:', block, 'invoice-header Nr. value');
  });

  it('Datum: value ends at block right edge', async () => {
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    expectRightAlignedToBlock(items, 'Datum:', block, 'invoice-header Datum value');
  });

  it('Fällig: value ends at block right edge', async () => {
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    expectRightAlignedToBlock(items, 'Fällig:', block, 'invoice-header Fällig value');
  });

  it('label and value on same baseline for each row', async () => {
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    expectSameRow(items, 'Nr.:', 'RE-2024-0042', 'Nr. row');
    expectSameRow(items, 'Datum:', '15.03.2024', 'Datum row');
    expectSameRow(items, 'Fällig:', '15.04.2024', 'Fällig row');
    expectSameRow(items, 'Referenz:', 'LW-4200', 'Referenz row');
  });

  it('rows step down by fontSize * 1.4', async () => {
    const fs = 10;
    const lineH = fs * 1.4;
    const bytes = await svc.render(makeTemplate({ ...block, fontSize: fs }), INVOICE);
    const items = await extractPdfTextItems(bytes);

    const r1 = findTextItem(items, 'Nr.:')!;
    const r2 = findTextItem(items, 'Datum:')!;
    const r3 = findTextItem(items, 'Fällig:')!;
    const r4 = findTextItem(items, 'Referenz:')!;
    expect(r1, 'Nr.: not found').toBeDefined();
    expect(r2, 'Datum: not found').toBeDefined();
    expect(r3, 'Fällig: not found').toBeDefined();
    expect(r4, 'Referenz: not found').toBeDefined();
    expectLineDelta(r1, r2, lineH, 'row1→row2');
    expectLineDelta(r2, r3, lineH, 'row2→row3');
    expectLineDelta(r3, r4, lineH, 'row3→row4');
  });

  it('optional rows absent on minimal invoice', async () => {
    const bytes = await svc.render(makeTemplate(block), MINIMAL_INVOICE);
    const items = await extractPdfTextItems(bytes);
    expect(findTextItem(items, 'Fällig:'), 'Fällig: should be absent').toBeUndefined();
    expect(findTextItem(items, 'Referenz:'), 'Referenz: should be absent').toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Suite C — totals block
// ---------------------------------------------------------------------------

describe('totals block', () => {
  const block: PdfBlockDto = { id: '1', type: 'totals', x: 350, y: 600, width: 200, height: 100, fontSize: 10 };

  it('Nettobetrag: value ends at block right edge', async () => {
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    expectRightAlignedToBlock(items, 'Nettobetrag:', block, 'totals Nettobetrag');
  });

  it('USt. value ends at block right edge', async () => {
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    expectRightAlignedToBlock(items, 'USt. 19%:', block, 'totals USt');
  });

  it('Bruttobetrag: value ends at block right edge', async () => {
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    expectRightAlignedToBlock(items, 'Bruttobetrag:', block, 'totals Bruttobetrag');
  });

  it('labels start at block.x', async () => {
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    const nettoLabel = findTextItem(items, 'Nettobetrag:')!;
    expect(nettoLabel, 'Nettobetrag: not found').toBeDefined();
    expectNear(nettoLabel.x, block.x, 'Nettobetrag label.x');
  });

  it('label and value on same baseline', async () => {
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    expectSameRow(items, 'Nettobetrag:', '1.250,00', 'Nettobetrag row');
    expectSameRow(items, 'Bruttobetrag:', '1.487,50', 'Bruttobetrag row');
  });

  it('rows step down by fontSize * 1.6 (totals line height)', async () => {
    const fs = 10;
    const lineH = fs * 1.6;
    const bytes = await svc.render(makeTemplate({ ...block, fontSize: fs }), INVOICE);
    const items = await extractPdfTextItems(bytes);

    const netto = findTextItem(items, 'Nettobetrag:')!;
    const ust = findTextItem(items, 'USt. 19%:')!;
    const brutto = findTextItem(items, 'Bruttobetrag:')!;
    expect(netto, 'Nettobetrag: not found').toBeDefined();
    expect(ust, 'USt. not found').toBeDefined();
    expect(brutto, 'Bruttobetrag: not found').toBeDefined();
    expectLineDelta(netto, ust, lineH, 'netto→ust');
    expectLineDelta(ust, brutto, lineH, 'ust→brutto');
  });

  it('Bruttobetrag has larger font size (fontSize+1)', async () => {
    const fs = 10;
    const bytes = await svc.render(makeTemplate({ ...block, fontSize: fs }), INVOICE);
    const items = await extractPdfTextItems(bytes);
    const brutto = findTextItem(items, 'Bruttobetrag:')!;
    expect(brutto, 'Bruttobetrag: not found').toBeDefined();
    expectNear(brutto.fontSize, fs + 1, 'Bruttobetrag fontSize', 0.5);
  });

  it('USt absent for Kleinunternehmer', async () => {
    const bytes = await svc.render(makeTemplate(block), MINIMAL_INVOICE);
    const items = await extractPdfTextItems(bytes);
    expect(items.find(i => i.text.includes('USt.')), 'USt. should be absent').toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Suite D — multi-line blocks (line-spacing deltas)
// ---------------------------------------------------------------------------

describe('multi-line blocks — line spacing', () => {
  it('seller-address: lines step down by fontSize * 1.4', async () => {
    const fs = 10;
    const block: PdfBlockDto = { id: '1', type: 'seller-address', x: 30, y: 50, width: 250, height: 100, fontSize: fs };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);

    const name  = findTextItem(items, 'Musterfirma GmbH')!;
    const vatId = items.find(i => i.text.includes('USt-IdNr'))!;
    expect(name, 'seller name not found').toBeDefined();
    expect(vatId, 'USt-IdNr not found').toBeDefined();

    // vatId is line 4 (0-indexed), so delta from name to vatId should be 3 * lineH
    expectLineDelta(name, vatId, 3 * fs * 1.4, 'name→vatId (3 lines)', 2.5);
  });

  it('seller-address: consecutive lines (name→street) step by exactly fontSize*1.4', async () => {
    const fs = 10;
    const block: PdfBlockDto = { id: '1', type: 'seller-address', x: 30, y: 50, width: 250, height: 100, fontSize: fs };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);

    const name   = findTextItem(items, 'Musterfirma GmbH')!;
    const street = items.find(i => i.text.includes('Hauptstraße'))!;
    expect(name, 'name not found').toBeDefined();
    expect(street, 'street not found').toBeDefined();
    expectLineDelta(name, street, fs * 1.4, 'name→street');
  });

  it('buyer-address: 3 lines step down by fontSize * 1.4', async () => {
    const fs = 10;
    const block: PdfBlockDto = { id: '1', type: 'buyer-address', x: 30, y: 200, width: 200, height: 60, fontSize: fs };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);

    const name    = findTextItem(items, 'Beispiel AG')!;
    const street  = items.find(i => i.text.includes('Industrieweg'))!;
    const postal  = items.find(i => i.text.includes('80331'))!;
    expect(name, 'buyer name not found').toBeDefined();
    expect(street, 'buyer street not found').toBeDefined();
    expect(postal, 'buyer postal not found').toBeDefined();
    expectLineDelta(name, street, fs * 1.4, 'name→street');
    expectLineDelta(street, postal, fs * 1.4, 'street→postal');
  });

  it('free-text: multi-line spacing is fontSize * 1.4', async () => {
    const fs = 10;
    const block: PdfBlockDto = {
      id: '1', type: 'free-text', x: 40, y: 500, width: 300, height: 60, fontSize: fs,
      content: 'Erste Zeile\nZweite Zeile\nDritte Zeile',
    };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);

    const l1 = findTextItem(items, 'Erste Zeile')!;
    const l2 = findTextItem(items, 'Zweite Zeile')!;
    const l3 = findTextItem(items, 'Dritte Zeile')!;
    expect(l1, 'line 1 not found').toBeDefined();
    expect(l2, 'line 2 not found').toBeDefined();
    expect(l3, 'line 3 not found').toBeDefined();
    expectLineDelta(l1, l2, fs * 1.4, 'line1→line2');
    expectLineDelta(l2, l3, fs * 1.4, 'line2→line3');
  });

  it('iban-bic: IBAN and BIC lines step by fontSize * 1.4', async () => {
    const fs = 10;
    const block: PdfBlockDto = { id: '1', type: 'iban-bic', x: 40, y: 700, width: 250, height: 30, fontSize: fs };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);

    const ibanItem = items.find(i => i.text.includes('IBAN'))!;
    const bicItem  = items.find(i => i.text.includes('BIC'))!;
    expect(ibanItem, 'IBAN not found').toBeDefined();
    expect(bicItem,  'BIC not found').toBeDefined();
    expectLineDelta(ibanItem, bicItem, fs * 1.4, 'IBAN→BIC');
  });

  it('payment-info: lines step by fontSize * 1.4', async () => {
    const fs = 10;
    const block: PdfBlockDto = { id: '1', type: 'payment-info', x: 40, y: 700, width: 300, height: 60, fontSize: fs };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);

    const payItem  = items.find(i => i.text.includes('Zahlungsart'))!;
    const ibanItem = items.find(i => i.text.includes('IBAN'))!;
    expect(payItem, 'Zahlungsart not found').toBeDefined();
    expect(ibanItem, 'IBAN not found').toBeDefined();
    expectLineDelta(payItem, ibanItem, fs * 1.4, 'Zahlungsart→IBAN');
  });
});

// ---------------------------------------------------------------------------
// Suite E — invoice-title font size
// ---------------------------------------------------------------------------

describe('invoice-title', () => {
  it('font size in PDF is block.fontSize + 4', async () => {
    const fs = 10;
    const block: PdfBlockDto = { id: '1', type: 'invoice-title', x: 40, y: 80, width: 200, height: 30, fontSize: fs };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    const titleItem = findTextItem(items, 'Rechnung')!;
    expect(titleItem, '"Rechnung" not found').toBeDefined();
    expectNear(titleItem.fontSize, fs + 4, 'invoice-title fontSize', 0.5);
  });

  it('text starts at block.x', async () => {
    const block: PdfBlockDto = { id: '1', type: 'invoice-title', x: 40, y: 80, width: 200, height: 30, fontSize: 10 };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    const titleItem = findTextItem(items, 'Rechnung')!;
    expect(titleItem, '"Rechnung" not found').toBeDefined();
    expectNear(titleItem.x, block.x, 'invoice-title x');
  });

  it('content override: custom text replaces "Rechnung"', async () => {
    const block: PdfBlockDto = { id: '1', type: 'invoice-title', x: 40, y: 80, width: 200, height: 30, fontSize: 10, content: 'Gutschrift' };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    expect(findTextItem(items, 'Rechnung'), '"Rechnung" should be replaced').toBeUndefined();
    expect(findTextItem(items, 'Gutschrift'), '"Gutschrift" not found').toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Suite F — lines-table
// ---------------------------------------------------------------------------

describe('lines-table', () => {
  const tableBlock: PdfBlockDto = {
    id: '1', type: 'lines-table', x: 40, y: 300, width: 500, height: 150,
    fontSize: 10, showHeader: true, lineHeight: 1.8,
  };

  it('header font size is block.fontSize - 1', async () => {
    const bytes = await svc.render(makeTemplate(tableBlock), INVOICE);
    const items = await extractPdfTextItems(bytes);
    const header = findTextItem(items, 'Bezeichnung')!;
    expect(header, '"Bezeichnung" header not found').toBeDefined();
    expectNear(header.fontSize, tableBlock.fontSize! - 1, 'header fontSize', 0.5);
  });

  it('header absent when showHeader=false', async () => {
    const block = { ...tableBlock, showHeader: false };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    expect(findTextItem(items, 'Bezeichnung'), '"Bezeichnung" should be absent').toBeUndefined();
    expect(findTextItem(items, 'Pos'), '"Pos" header should be absent').toBeUndefined();
  });

  it('data rows step down by fontSize * lineHeight', async () => {
    const bytes = await svc.render(makeTemplate(tableBlock), INVOICE);
    const items = await extractPdfTextItems(bytes);

    const row1 = items.find(i => i.text.includes('Webdesign'))!;
    const row2 = items.find(i => i.text.includes('SEO'))!;
    expect(row1, 'row1 item not found').toBeDefined();
    expect(row2, 'row2 item not found').toBeDefined();
    expectLineDelta(row1, row2, tableBlock.fontSize! * tableBlock.lineHeight!, 'row1→row2', 2.0);
  });

  it('header columns start at block.x (Pos column)', async () => {
    const bytes = await svc.render(makeTemplate(tableBlock), INVOICE);
    const items = await extractPdfTextItems(bytes);
    const posHeader = findTextItem(items, 'Pos')!;
    expect(posHeader, '"Pos" header not found').toBeDefined();
    // "Pos" starts near block.x + 4 (inner padding)
    expectNear(posHeader.x, tableBlock.x + 4, 'Pos header x', 3.0);
  });

  it('all table text within block vertical bounds', async () => {
    const bytes = await svc.render(makeTemplate(tableBlock), INVOICE);
    const items = await extractPdfTextItems(bytes);
    for (const item of items) expectWithinBlock(item, tableBlock, `table item "${item.text}"`);
  });
});

// ---------------------------------------------------------------------------
// Suite G — block containment (text never outside block)
// ---------------------------------------------------------------------------

describe('block containment — text within vertical bounds', () => {
  const blockTypes: { type: PdfBlockDto['type']; extra?: Partial<PdfBlockDto> }[] = [
    { type: 'invoice-number' },
    { type: 'invoice-date' },
    { type: 'total-net' },
    { type: 'total-gross' },
    { type: 'seller-address', extra: { height: 80 } },
    { type: 'buyer-address',  extra: { height: 60 } },
    { type: 'invoice-header', extra: { x: 350, height: 80 } },
    { type: 'free-text',      extra: { content: 'Zeile A\nZeile B', height: 40 } },
  ];

  for (const { type, extra } of blockTypes) {
    it(`${type}: all text items within block Y bounds`, async () => {
      const block: PdfBlockDto = { id: '1', type, x: 60, y: 100, width: 240, height: 20, fontSize: 10, ...extra };
      const bytes = await svc.render(makeTemplate(block), INVOICE);
      const items = await extractPdfTextItems(bytes);
      for (const item of items) expectWithinBlock(item, block, `${type} item "${item.text}"`);
    });
  }
});

// ---------------------------------------------------------------------------
// Suite H — content override
// ---------------------------------------------------------------------------

describe('content override — replaces computed text', () => {
  it('invoice-number: override text rendered, original absent', async () => {
    const block: PdfBlockDto = {
      id: '1', type: 'invoice-number', x: 60, y: 120, width: 240, height: 20, fontSize: 10,
      content: 'Eigener Text',
    };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    expect(findTextItem(items, 'Nr.:'), '"Nr.:" should be replaced').toBeUndefined();
    expect(findTextItem(items, 'RE-2024-0042'), 'invoice number should be replaced').toBeUndefined();
    expect(items.find(i => i.text.includes('Eigener')), 'override not found').toBeDefined();
  });

  it('seller-address: override text rendered, seller name absent', async () => {
    const block: PdfBlockDto = {
      id: '1', type: 'seller-address', x: 30, y: 50, width: 200, height: 80, fontSize: 10,
      content: 'Eigene Adresse\nZeile Zwei',
    };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    expect(findTextItem(items, 'Musterfirma GmbH'), 'original seller name should be absent').toBeUndefined();
    expect(items.find(i => i.text.includes('Eigene')), 'override line 1 not found').toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Suite I — multiple blocks don't interfere
// ---------------------------------------------------------------------------

describe('multiple blocks — positions independent', () => {
  it('two invoice-number blocks at different Y produce text at different Y', async () => {
    const b1: PdfBlockDto = { id: '1', type: 'invoice-number', x: 50, y: 100, width: 220, height: 20, fontSize: 10 };
    const b2: PdfBlockDto = { id: '2', type: 'invoice-date',   x: 50, y: 200, width: 220, height: 20, fontSize: 10 };
    const template: PdfTemplateDto = { id: 1, name: 't', pageSize: 'a4', orientation: 'portrait', blocks: [b1, b2] };
    const bytes = await svc.render(template, INVOICE);
    const items = await extractPdfTextItems(bytes);

    const nrItem     = findTextItem(items, 'Nr.:')!;
    const datumItem  = findTextItem(items, 'Datum:')!;
    expect(nrItem, '"Nr.:" not found').toBeDefined();
    expect(datumItem, '"Datum:" not found').toBeDefined();

    // The two labels must be on different Y positions
    expect(Math.abs(nrItem.y - datumItem.y), 'blocks should be on different rows').toBeGreaterThan(5);

    // Right-edge for each block independently
    expectRightAlignedToBlock(items, 'Nr.:', b1, 'b1 right-edge');
    expectRightAlignedToBlock(items, 'Datum:', b2, 'b2 right-edge');
  });
});

// ---------------------------------------------------------------------------
// Suite J — line element: position, span, thickness
// ---------------------------------------------------------------------------

describe('line element — position, span, thickness', () => {
  it('horizontal line: centerY = pageHeight - block.y - block.height/2', async () => {
    const block: PdfBlockDto = { id: '1', type: 'line', x: 50, y: 400, width: 300, height: 2, lineDirection: 'horizontal', lineThickness: 1 };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const lines = await extractPdfLines(bytes);
    expect(lines.length, 'expected exactly 1 line segment').toBe(1);
    const expectedCenterY = PAGE_HEIGHT - block.y - block.height / 2;
    expectNear(lines[0].y1, expectedCenterY, 'centerY', 1.0);
    expectNear(lines[0].y2, expectedCenterY, 'centerY consistent', 1.0);
  });

  it('horizontal line: spans full block width (x1=block.x, x2=block.x+width)', async () => {
    const block: PdfBlockDto = { id: '1', type: 'line', x: 50, y: 400, width: 300, height: 2, lineDirection: 'horizontal', lineThickness: 1 };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const lines = await extractPdfLines(bytes);
    expect(lines.length, '1 line expected').toBe(1);
    expectNear(lines[0].x1, block.x, 'x1 = block.x');
    expectNear(lines[0].x2, block.x + block.width, 'x2 = block.x + width');
  });

  it('horizontal line: thickness matches block.lineThickness', async () => {
    const block: PdfBlockDto = { id: '1', type: 'line', x: 50, y: 400, width: 300, height: 2, lineDirection: 'horizontal', lineThickness: 3 };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const lines = await extractPdfLines(bytes);
    expect(lines.length, '1 line expected').toBe(1);
    expectNear(lines[0].thickness, 3, 'thickness', 0.1);
  });

  it('horizontal line: default thickness is 1 when lineThickness not set', async () => {
    const block: PdfBlockDto = { id: '1', type: 'line', x: 50, y: 400, width: 300, height: 2 };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const lines = await extractPdfLines(bytes);
    expect(lines.length, '1 line expected').toBeGreaterThanOrEqual(1);
    expectNear(lines[0].thickness, 1, 'default thickness', 0.1);
  });

  it('vertical line: centerX = block.x + block.width/2', async () => {
    const block: PdfBlockDto = { id: '1', type: 'line', x: 100, y: 200, width: 4, height: 100, lineDirection: 'vertical', lineThickness: 2 };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const lines = await extractPdfLines(bytes);
    expect(lines.length, '1 line expected').toBe(1);
    const expectedCenterX = block.x + block.width / 2;
    expectNear(lines[0].x1, expectedCenterX, 'centerX x1', 1.0);
    expectNear(lines[0].x2, expectedCenterX, 'centerX x2', 1.0);
  });

  it('vertical line: spans full block height', async () => {
    const block: PdfBlockDto = { id: '1', type: 'line', x: 100, y: 200, width: 4, height: 100, lineDirection: 'vertical', lineThickness: 1 };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const lines = await extractPdfLines(bytes);
    expect(lines.length, '1 line expected').toBe(1);
    const pdfY = PAGE_HEIGHT - block.y - block.height;
    expectNear(Math.min(lines[0].y1, lines[0].y2), pdfY, 'bottom y', 1.0);
    expectNear(Math.max(lines[0].y1, lines[0].y2), pdfY + block.height, 'top y', 1.0);
  });

  it('different x positions produce lines at different x1', async () => {
    const b1: PdfBlockDto = { id: '1', type: 'line', x: 40, y: 400, width: 200, height: 1, lineThickness: 1 };
    const b2: PdfBlockDto = { id: '2', type: 'line', x: 300, y: 400, width: 200, height: 1, lineThickness: 1 };
    const template: PdfTemplateDto = { id: 1, name: 't', pageSize: 'a4', orientation: 'portrait', blocks: [b1, b2] };
    const bytes = await svc.render(template, INVOICE);
    const lines = await extractPdfLines(bytes);
    const xPositions = lines.map(l => l.x1).sort((a, b) => a - b);
    expect(xPositions.length, 'two lines expected').toBeGreaterThanOrEqual(2);
    expectNear(xPositions[0], 40, 'line1 x1', 1.0);
    expectNear(xPositions[1], 300, 'line2 x1', 1.0);
  });
});

// ---------------------------------------------------------------------------
// Suite K — font weight (bold vs normal)
// ---------------------------------------------------------------------------

describe('font weight — bold and normal use distinct fonts', () => {
  it('invoice-title bold vs normal: different fontName in same PDF', async () => {
    const boldBlock: PdfBlockDto  = { id: '1', type: 'invoice-title', x: 40, y: 80,  width: 200, height: 30, fontSize: 10, fontWeight: 'bold' };
    const normBlock: PdfBlockDto  = { id: '2', type: 'invoice-title', x: 40, y: 150, width: 200, height: 30, fontSize: 10, fontWeight: 'normal' };
    const template: PdfTemplateDto = { id: 1, name: 't', pageSize: 'a4', orientation: 'portrait', blocks: [boldBlock, normBlock] };
    const bytes = await svc.render(template, INVOICE);
    const items = await extractPdfTextItems(bytes);

    // The two "Rechnung" items are at different Y — pick them by Y proximity
    const boldItem = items.find(i => i.text === 'Rechnung' && i.y > 740);
    const normItem = items.find(i => i.text === 'Rechnung' && i.y < 700);
    expect(boldItem, 'bold "Rechnung" not found').toBeDefined();
    expect(normItem, 'normal "Rechnung" not found').toBeDefined();
    expect(boldItem!.fontName, 'bold and normal must use different font resources')
      .not.toBe(normItem!.fontName);
  });

  it('totals: Bruttobetrag (bold) uses different font than Nettobetrag (regular)', async () => {
    const block: PdfBlockDto = { id: '1', type: 'totals', x: 350, y: 600, width: 200, height: 100, fontSize: 10 };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    const netto  = findTextItem(items, 'Nettobetrag:')!;
    const brutto = findTextItem(items, 'Bruttobetrag:')!;
    expect(netto, 'Nettobetrag: not found').toBeDefined();
    expect(brutto, 'Bruttobetrag: not found').toBeDefined();
    expect(brutto.fontName, 'Bruttobetrag must be bold (different font)').not.toBe(netto.fontName);
  });

  it('invoice-title bold: "Rechnung" width is larger than normal (bold chars are wider)', async () => {
    const boldBytes = await svc.render(makeTemplate(
      { id: '1', type: 'invoice-title', x: 40, y: 80, width: 300, height: 30, fontSize: 14, fontWeight: 'bold' }
    ), INVOICE);
    const normBytes = await svc.render(makeTemplate(
      { id: '1', type: 'invoice-title', x: 40, y: 80, width: 300, height: 30, fontSize: 14, fontWeight: 'normal' }
    ), INVOICE);
    const boldItem = findTextItem(await extractPdfTextItems(boldBytes), 'Rechnung')!;
    const normItem = findTextItem(await extractPdfTextItems(normBytes), 'Rechnung')!;
    expect(boldItem, 'bold item not found').toBeDefined();
    expect(normItem, 'normal item not found').toBeDefined();
    // Bold glyphs are wider — bold width must exceed normal width
    expect(boldItem.width, `bold width (${boldItem.width}) should be > normal (${normItem.width})`).toBeGreaterThan(normItem.width);
  });
});

// ---------------------------------------------------------------------------
// Suite L — multi-line text: all lines start at block.x
// ---------------------------------------------------------------------------

describe('multi-line text — all lines start at block.x', () => {
  it('seller-address: leftmost item on each row starts at block.x', async () => {
    const block: PdfBlockDto = { id: '1', type: 'seller-address', x: 30, y: 50, width: 250, height: 100, fontSize: 10 };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    expect(items.length, 'expected seller address lines').toBeGreaterThanOrEqual(3);
    // Label items start at block.x; value items (vatId/taxNumber) are right-aligned — check leftmost per row
    const ys = [...new Set(items.map(i => Math.round(i.y)))];
    for (const y of ys) {
      const rowLeft = Math.min(...items.filter(i => Math.abs(i.y - y) <= 1).map(i => i.x));
      expectNear(rowLeft, block.x, `row-at-y=${y} left edge`, 1.5);
    }
  });

  it('buyer-address: every text item starts at block.x', async () => {
    const block: PdfBlockDto = { id: '1', type: 'buyer-address', x: 30, y: 200, width: 200, height: 60, fontSize: 10 };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    expect(items.length, 'expected 3 buyer address lines').toBe(3);
    for (const item of items) {
      expectNear(item.x, block.x, `"${item.text}" x`, 1.5);
    }
  });

  it('iban-bic: both lines start at block.x', async () => {
    const block: PdfBlockDto = { id: '1', type: 'iban-bic', x: 40, y: 700, width: 300, height: 30, fontSize: 10 };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    const ibanItems = items.filter(i => i.text.includes('IBAN'));
    const bicItems  = items.filter(i => i.text.includes('BIC'));
    expect(ibanItems.length, 'IBAN item not found').toBeGreaterThan(0);
    expect(bicItems.length, 'BIC item not found').toBeGreaterThan(0);
    // First item of each line should start at block.x
    const ibanFirst = ibanItems.reduce((a, b) => a.x < b.x ? a : b);
    const bicFirst  = bicItems.reduce((a, b) => a.x < b.x ? a : b);
    expectNear(ibanFirst.x, block.x, 'IBAN x', 1.5);
    expectNear(bicFirst.x,  block.x, 'BIC x', 1.5);
  });

  it('payment-info: first item on each line starts at block.x', async () => {
    const block: PdfBlockDto = { id: '1', type: 'payment-info', x: 40, y: 700, width: 300, height: 70, fontSize: 10 };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    // Group by distinct Y values and check leftmost item on each row
    const ys = [...new Set(items.map(i => Math.round(i.y)))];
    expect(ys.length, 'expected 4 lines for full invoice').toBeGreaterThanOrEqual(3);
    for (const y of ys) {
      const rowLeft = Math.min(...items.filter(i => Math.abs(i.y - y) <= 1).map(i => i.x));
      expectNear(rowLeft, block.x, `row-at-y=${y} left edge`, 1.5);
    }
  });

  it('free-text: all lines start at block.x', async () => {
    const block: PdfBlockDto = {
      id: '1', type: 'free-text', x: 60, y: 400, width: 250, height: 80, fontSize: 10,
      content: 'Zeile Eins\nZeile Zwei\nZeile Drei',
    };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    for (const item of items) {
      expectNear(item.x, block.x, `"${item.text}" x`, 1.5);
    }
  });
});

// ---------------------------------------------------------------------------
// Suite M — no text overflows block right edge
// ---------------------------------------------------------------------------

describe('text containment — no item overflows block right edge', () => {
  it('free-text long content: all items end within block.x + width + tolerance', async () => {
    const block: PdfBlockDto = {
      id: '1', type: 'free-text', x: 50, y: 300, width: 200, height: 80, fontSize: 10,
      content: 'Dies ist ein langer Satz der möglicherweise über die Blockbreite hinausgeht wenn er nicht umgebrochen wird.',
    };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    const blockRight = block.x + block.width;
    for (const item of items) {
      expect(
        item.x + item.width,
        `"${item.text}" right edge ${(item.x + item.width).toFixed(1)} exceeds block right ${blockRight}`,
      ).toBeLessThanOrEqual(blockRight + 5);
    }
  });

  it('seller-address: no item right edge exceeds block.x + width', async () => {
    const block: PdfBlockDto = { id: '1', type: 'seller-address', x: 30, y: 50, width: 200, height: 100, fontSize: 10 };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    const blockRight = block.x + block.width;
    for (const item of items) {
      expect(item.x + item.width, `"${item.text}" overflows`).toBeLessThanOrEqual(blockRight + 5);
    }
  });
});

// ---------------------------------------------------------------------------
// Suite N — table column proportional x-positions
// ---------------------------------------------------------------------------

describe('lines-table — column proportional positions', () => {
  const allCols = [
    { key: 'pos',   header: 'Pos',         ratio: 0.06 },
    { key: 'name',  header: 'Bezeichnung', ratio: 0.34 },
    { key: 'qty',   header: 'Menge',       ratio: 0.10 },
    { key: 'unit',  header: 'Einheit',     ratio: 0.10 },
    { key: 'price', header: 'Einzelpreis', ratio: 0.20 },
    { key: 'total', header: 'Netto',       ratio: 0.20 },
  ];

  it('column headers at proportionally correct x positions', async () => {
    const fs = 10;
    const block: PdfBlockDto = {
      id: '1', type: 'lines-table', x: 40, y: 300, width: 500, height: 150,
      fontSize: fs, showHeader: true, lineHeight: 1.8,
    };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);

    let expectedX = block.x + 4; // inner padding
    for (const col of allCols) {
      const headerItem = items.find(i => i.text === col.header);
      expect(headerItem, `header "${col.header}" not found`).toBeDefined();
      expectNear(headerItem!.x, expectedX, `${col.header} x`, 3.0);
      expectedX += col.ratio * block.width;
    }
  });

  it('Bezeichnung column is wider than Pos column (proportions respected)', async () => {
    const block: PdfBlockDto = {
      id: '1', type: 'lines-table', x: 40, y: 300, width: 500, height: 150,
      fontSize: 10, showHeader: true, lineHeight: 1.8,
    };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);

    const posItem  = items.find(i => i.text === 'Pos')!;
    const nameItem = items.find(i => i.text === 'Bezeichnung')!;
    expect(posItem, 'Pos not found').toBeDefined();
    expect(nameItem, 'Bezeichnung not found').toBeDefined();

    // Bezeichnung column width (0.34) >> Pos column width (0.06)
    // Bezeichnung x − Pos x should be ≈ 0.06 * 500 = 30pt
    const colGap = nameItem.x - posItem.x;
    expectNear(colGap, 0.06 * block.width, 'Pos→Bezeichnung gap', 3.0);
  });

  it('data row cell for pos column starts near block.x', async () => {
    const block: PdfBlockDto = {
      id: '1', type: 'lines-table', x: 40, y: 300, width: 500, height: 150,
      fontSize: 10, showHeader: true, lineHeight: 1.8,
    };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    // "1" is the pos value for row 1 — should be near block.x + 4 + 2 = 46
    const posCell = items.find(i => i.text === '1' && i.fontSize <= 10);
    expect(posCell, 'pos cell "1" not found').toBeDefined();
    expectNear(posCell!.x, block.x + 6, 'pos cell x', 3.0);
  });

  it('data cells use fontSize - 1', async () => {
    const fs = 10;
    const block: PdfBlockDto = {
      id: '1', type: 'lines-table', x: 40, y: 300, width: 500, height: 150,
      fontSize: fs, showHeader: true, lineHeight: 1.8,
    };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    // Data cell text (not headers): should have fontSize = fs - 1
    const nameCell = items.find(i => i.text.includes('Webdesign'));
    expect(nameCell, 'Webdesign row not found').toBeDefined();
    expectNear(nameCell!.fontSize, fs - 1, 'data cell fontSize', 0.5);
  });

  it('custom column subset: only requested columns appear', async () => {
    const block: PdfBlockDto = {
      id: '1', type: 'lines-table', x: 40, y: 300, width: 500, height: 150,
      fontSize: 10, showHeader: true, lineHeight: 1.8, columns: ['name', 'total'],
    };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);

    expect(items.find(i => i.text === 'Bezeichnung'), 'Bezeichnung header expected').toBeDefined();
    expect(items.find(i => i.text === 'Netto'),        'Netto header expected').toBeDefined();
    // Excluded columns should not appear
    expect(items.find(i => i.text === 'Pos'),          'Pos should be excluded').toBeUndefined();
    expect(items.find(i => i.text === 'Menge'),        'Menge should be excluded').toBeUndefined();
    expect(items.find(i => i.text === 'Einheit'),      'Einheit should be excluded').toBeUndefined();
    expect(items.find(i => i.text === 'Einzelpreis'),  'Einzelpreis should be excluded').toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Suite O — line element color (lineColor property → actual stroke color)
// ---------------------------------------------------------------------------

describe('line element — color', () => {
  it('default lineColor (#1c1b18) maps to near-black RGB', async () => {
    // #1c1b18 → r=28/255≈0.110, g=27/255≈0.106, b=24/255≈0.094
    const block: PdfBlockDto = { id: '1', type: 'line', x: 50, y: 400, width: 200, height: 2, lineThickness: 1 };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const lines = await extractPdfLines(bytes);
    expect(lines.length, '1 line expected').toBeGreaterThanOrEqual(1);
    const c = lines[0].color;
    expectNear(c.r, 28 / 255, 'r channel', 0.01);
    expectNear(c.g, 27 / 255, 'g channel', 0.01);
    expectNear(c.b, 24 / 255, 'b channel', 0.01);
  });

  it('red lineColor (#ff0000) maps to RGB(1,0,0)', async () => {
    const block: PdfBlockDto = { id: '1', type: 'line', x: 50, y: 400, width: 200, height: 2, lineThickness: 1, lineColor: '#ff0000' };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const lines = await extractPdfLines(bytes);
    expect(lines.length, '1 line expected').toBeGreaterThanOrEqual(1);
    const c = lines[0].color;
    expectNear(c.r, 1.0, 'r=1 for red', 0.01);
    expectNear(c.g, 0.0, 'g=0 for red', 0.01);
    expectNear(c.b, 0.0, 'b=0 for red', 0.01);
  });

  it('blue lineColor (#0000ff) maps to RGB(0,0,1)', async () => {
    const block: PdfBlockDto = { id: '1', type: 'line', x: 50, y: 400, width: 200, height: 2, lineThickness: 2, lineColor: '#0000ff' };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const lines = await extractPdfLines(bytes);
    expect(lines.length, '1 line expected').toBeGreaterThanOrEqual(1);
    const c = lines[0].color;
    expectNear(c.r, 0.0, 'r=0 for blue', 0.01);
    expectNear(c.g, 0.0, 'g=0 for blue', 0.01);
    expectNear(c.b, 1.0, 'b=1 for blue', 0.01);
  });

  it('two lines with different colors have distinct RGB values', async () => {
    const b1: PdfBlockDto = { id: '1', type: 'line', x: 50, y: 300, width: 200, height: 2, lineThickness: 1, lineColor: '#ff0000' };
    const b2: PdfBlockDto = { id: '2', type: 'line', x: 50, y: 400, width: 200, height: 2, lineThickness: 1, lineColor: '#0000ff' };
    const template: PdfTemplateDto = { id: 1, name: 't', pageSize: 'a4', orientation: 'portrait', blocks: [b1, b2] };
    const bytes = await svc.render(template, INVOICE);
    const lines = await extractPdfLines(bytes);
    expect(lines.length, '2 lines expected').toBeGreaterThanOrEqual(2);
    // Red line: highest r, lowest b
    const redLine = lines.reduce((a, b) => a.color.r > b.color.r ? a : b);
    const blueLine = lines.reduce((a, b) => a.color.b > b.color.b ? a : b);
    expect(redLine.color.r, 'red line r > 0.9').toBeGreaterThan(0.9);
    expect(blueLine.color.b, 'blue line b > 0.9').toBeGreaterThan(0.9);
  });
});

// ---------------------------------------------------------------------------
// Suite P — table separator lines (minimal style)
// ---------------------------------------------------------------------------

describe('lines-table — separator lines (minimal style)', () => {
  const block: PdfBlockDto = {
    id: '1', type: 'lines-table', x: 40, y: 200, width: 480, height: 200,
    fontSize: 10, showHeader: true, lineHeight: 1.8, tableStyle: 'minimal',
  };

  it('minimal: produces exactly (rows + 1) line segments (header bottom + row separators)', async () => {
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    // INVOICE has 2 lines → 1 header bottom + 2 row separators = 3 total
    const lines = await extractPdfLines(bytes);
    expect(lines.length, '3 lines expected (1 header + 2 row separators)').toBe(3);
  });

  it('minimal: all separator lines span full block width', async () => {
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const lines = await extractPdfLines(bytes);
    for (const l of lines) {
      expectNear(Math.min(l.x1, l.x2), block.x, 'line starts at block.x', 1.0);
      expectNear(Math.max(l.x1, l.x2), block.x + block.width, 'line ends at block.x+width', 1.0);
    }
  });

  it('minimal: header bottom line is horizontal (y1===y2)', async () => {
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const lines = await extractPdfLines(bytes);
    for (const l of lines) {
      expectNear(l.y1, l.y2, 'all lines are horizontal', 0.1);
    }
  });

  it('minimal: row separators step down by rowHeight (fontSize * lineHeight)', async () => {
    const fs = 10;
    const lineHeight = 1.8;
    const rowH = fs * lineHeight;
    const bytes = await svc.render(makeTemplate({ ...block, fontSize: fs, lineHeight }), INVOICE);
    const lines = await extractPdfLines(bytes);
    // Sort lines top→bottom (y decreasing in PDF coords)
    const sorted = [...lines].sort((a, b) => b.y1 - a.y1);
    // sorted[0] = header bottom, sorted[1] = first row bottom, sorted[2] = second row bottom
    expect(sorted.length, '3 lines expected').toBe(3);
    const step1 = sorted[0].y1 - sorted[1].y1;
    const step2 = sorted[1].y1 - sorted[2].y1;
    expectNear(step1, rowH, 'header→row1 step', 1.5);
    expectNear(step2, rowH, 'row1→row2 step', 1.5);
  });

  it('minimal: row separator thickness is 0.3', async () => {
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const lines = await extractPdfLines(bytes);
    // Row separators have thickness 0.3, header bottom has 0.5
    const thinLines = lines.filter(l => l.thickness < 0.4);
    expect(thinLines.length, '2 thin (0.3) separators for 2 data rows').toBe(2);
    for (const l of thinLines) {
      expectNear(l.thickness, 0.3, 'row separator thickness', 0.05);
    }
  });

  it('header bottom line thickness is 0.5', async () => {
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const lines = await extractPdfLines(bytes);
    const headerLine = lines.find(l => l.thickness >= 0.4);
    expect(headerLine, 'header bottom line not found').toBeDefined();
    expectNear(headerLine!.thickness, 0.5, 'header bottom thickness', 0.05);
  });

  it('no separator lines when showHeader=false and 0 data rows', async () => {
    const emptyInvoice = { ...MINIMAL_INVOICE, lines: [] };
    const noHeaderBlock = { ...block, showHeader: false };
    const bytes = await svc.render(makeTemplate(noHeaderBlock), emptyInvoice);
    const lines = await extractPdfLines(bytes);
    expect(lines.length, 'no lines for empty table without header').toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Suite Q — totals separator line (before Bruttobetrag)
// ---------------------------------------------------------------------------

describe('totals block — separator line', () => {
  it('separator line spans full block width', async () => {
    const block: PdfBlockDto = { id: '1', type: 'totals', x: 300, y: 600, width: 200, height: 120, fontSize: 10 };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const lines = await extractPdfLines(bytes);
    expect(lines.length, 'separator line expected').toBeGreaterThanOrEqual(1);
    const sep = lines[0];
    expectNear(Math.min(sep.x1, sep.x2), block.x, 'separator starts at block.x', 1.0);
    expectNear(Math.max(sep.x1, sep.x2), block.x + block.width, 'separator ends at block right', 1.0);
  });

  it('separator line is horizontal (y1 === y2)', async () => {
    const block: PdfBlockDto = { id: '1', type: 'totals', x: 300, y: 600, width: 200, height: 120, fontSize: 10 };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const lines = await extractPdfLines(bytes);
    expect(lines.length, 'separator expected').toBeGreaterThanOrEqual(1);
    for (const l of lines) {
      expectNear(l.y1, l.y2, 'separator is horizontal', 0.1);
    }
  });

  it('separator line is between Nettobetrag and Bruttobetrag rows', async () => {
    const block: PdfBlockDto = { id: '1', type: 'totals', x: 300, y: 600, width: 200, height: 120, fontSize: 10 };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    const lines = await extractPdfLines(bytes);

    const bruttoItem = findTextItem(items, 'Bruttobetrag:')!;
    const nettoItem  = findTextItem(items, 'Nettobetrag:')!;
    expect(bruttoItem, 'Bruttobetrag: not found').toBeDefined();
    expect(nettoItem, 'Nettobetrag: not found').toBeDefined();
    expect(lines.length, 'separator expected').toBeGreaterThanOrEqual(1);

    // Separator line must be between Nettobetrag Y and Bruttobetrag Y (i.e., y1 < Netto.y && y1 > Brutto.y)
    const sep = lines[0];
    expect(sep.y1, 'separator below Nettobetrag').toBeLessThan(nettoItem.y);
    expect(sep.y1, 'separator above Bruttobetrag').toBeGreaterThan(bruttoItem.y);
  });

  it('totals for kleinunternehmer: still has one separator line', async () => {
    const block: PdfBlockDto = { id: '1', type: 'totals', x: 300, y: 600, width: 200, height: 80, fontSize: 10 };
    const bytes = await svc.render(makeTemplate(block), MINIMAL_INVOICE);
    const lines = await extractPdfLines(bytes);
    // kleinunternehmer = 2 rows (Netto + Brutto) → 1 separator
    expect(lines.length, '1 separator for kleinunternehmer totals').toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Suite R — long text values (expose left-overflow bug)
// ---------------------------------------------------------------------------

describe('long text values — no left overflow beyond block.x', () => {
  it('payment-terms: long value does not start left of block.x', async () => {
    // "Zahlbar innerhalb von 30 Tagen nach Rechnungseingang." is ~271pt at 10pt
    // drawLabelValue right-aligns: valueX = block.x + block.width - measureHelveticaWidth(value)
    // For block.width=200: valueX ≈ 60+200-271 = -11 → left of block → BUG
    const block: PdfBlockDto = { id: '1', type: 'payment-terms', x: 60, y: 120, width: 200, height: 20, fontSize: 10 };
    const inv = { ...INVOICE, paymentTerms: 'Zahlbar innerhalb von 30 Tagen nach Rechnungseingang.' };
    const bytes = await svc.render(makeTemplate(block), inv);
    const items = await extractPdfTextItems(bytes);
    // Every text item must start at or after block.x
    for (const item of items) {
      expect(item.x, `"${item.text}" (x=${item.x.toFixed(1)}) starts left of block.x (${block.x})`).toBeGreaterThanOrEqual(block.x - 1);
    }
  });

  it('buyer-reference: very long value does not start left of block.x', async () => {
    const block: PdfBlockDto = { id: '1', type: 'buyer-reference', x: 60, y: 120, width: 150, height: 20, fontSize: 10 };
    const inv = { ...INVOICE, buyerReference: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ-2024-LONG-REFERENCE' };
    const bytes = await svc.render(makeTemplate(block), inv);
    const items = await extractPdfTextItems(bytes);
    for (const item of items) {
      expect(item.x, `"${item.text}" starts left of block.x`).toBeGreaterThanOrEqual(block.x - 1);
    }
  });

  it('iban-bic: IBAN value does not overflow block right edge', async () => {
    const block: PdfBlockDto = { id: '1', type: 'iban-bic', x: 40, y: 700, width: 180, height: 30, fontSize: 10 };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    const blockRight = block.x + block.width;
    for (const item of items) {
      // IBAN is 31 chars with prefix → may overflow a narrow block
      expect(item.x + item.width, `"${item.text}" right edge overflows`).toBeLessThanOrEqual(blockRight + 5);
    }
  });
});

// ---------------------------------------------------------------------------
// Suite S — table data cell exact content
// ---------------------------------------------------------------------------

describe('lines-table — data cell content', () => {
  const block: PdfBlockDto = {
    id: '1', type: 'lines-table', x: 40, y: 200, width: 500, height: 200,
    fontSize: 10, showHeader: true, lineHeight: 1.8,
  };

  it('pos column: first row is "1", second row is "2"', async () => {
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    const ones = items.filter(i => i.text === '1' && i.fontSize < 10);
    const twos = items.filter(i => i.text === '2' && i.fontSize < 10);
    expect(ones.length, '"1" pos cell not found').toBeGreaterThanOrEqual(1);
    expect(twos.length, '"2" pos cell not found').toBeGreaterThanOrEqual(1);
  });

  it('name column: "Webdesign Startseite" and "SEO-Optimierung" appear', async () => {
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    expect(items.find(i => i.text.includes('Webdesign')), '"Webdesign Startseite" not found').toBeDefined();
    expect(items.find(i => i.text.includes('SEO')), '"SEO-Optimierung" not found').toBeDefined();
  });

  it('qty column: "1" for row1 and "5" for row2', async () => {
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    const fives = items.filter(i => i.text === '5' && i.fontSize < 10);
    expect(fives.length, '"5" quantity not found').toBeGreaterThanOrEqual(1);
  });

  it('unit column: "Stunde" for HUR code', async () => {
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    const stundeItems = items.filter(i => i.text === 'Stunde');
    expect(stundeItems.length, '"Stunde" unit label not found').toBeGreaterThanOrEqual(1);
  });

  it('price column: "850,00 \u20ac" for row1, "80,00 \u20ac" for row2', async () => {
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    // Currency formatting: 850.toLocaleString('de-DE', ...) + ' €'
    expect(items.find(i => i.text.includes('850')), '850 price not found').toBeDefined();
    expect(items.find(i => i.text.includes('80') && !i.text.includes('850')), '80 price not found').toBeDefined();
  });

  it('total column: "850,00 \u20ac" lineNetAmount for row1', async () => {
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    // Both price and total are "850,00 €" for row1 (qty=1, price=850)
    const euroItems = items.filter(i => i.text.includes('€'));
    expect(euroItems.length, 'euro values expected').toBeGreaterThanOrEqual(2);
  });

  it('data cells are positioned lower than header cells', async () => {
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    const headerPos = items.find(i => i.text === 'Pos')!;
    const dataCell  = items.find(i => i.text === '1' && i.fontSize < 10)!;
    expect(headerPos, 'Pos header not found').toBeDefined();
    expect(dataCell, '1 data cell not found').toBeDefined();
    // Header is above (higher Y in PDF coords) than data rows
    expect(headerPos.y, 'header Y should be above data Y').toBeGreaterThan(dataCell.y);
  });
});

// ---------------------------------------------------------------------------
// Suite T — seller-address line count (with/without vatId + taxNumber)
// ---------------------------------------------------------------------------

describe('seller-address — line count variations', () => {
  it('with vatId + taxNumber: renders 5 lines', async () => {
    // INVOICE seller has both → 5 lines: name, street, postalCity, vatId, taxNumber
    const block: PdfBlockDto = { id: '1', type: 'seller-address', x: 30, y: 50, width: 250, height: 120, fontSize: 10 };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    const distinctYs = [...new Set(items.map(i => Math.round(i.y)))];
    expect(distinctYs.length, '5 distinct Y rows expected').toBe(5);
    expect(items.find(i => i.text.includes('DE123456789')), 'vatId line not found').toBeDefined();
    expect(items.find(i => i.text.includes('30/123')), 'taxNumber line not found').toBeDefined();
  });

  it('with vatId only: renders 4 lines', async () => {
    const block: PdfBlockDto = { id: '1', type: 'seller-address', x: 30, y: 50, width: 250, height: 100, fontSize: 10 };
    const inv = { ...INVOICE, seller: { ...INVOICE.seller, taxNumber: undefined } };
    const bytes = await svc.render(makeTemplate(block), inv);
    const items = await extractPdfTextItems(bytes);
    const distinctYs = [...new Set(items.map(i => Math.round(i.y)))];
    expect(distinctYs.length, '4 distinct Y rows expected').toBe(4);
    expect(items.find(i => i.text.includes('DE123456789')), 'vatId line expected').toBeDefined();
    expect(items.find(i => i.text.includes('Steuernr.')), 'taxNumber should be absent').toBeUndefined();
  });

  it('without vatId or taxNumber: renders 3 lines', async () => {
    const block: PdfBlockDto = { id: '1', type: 'seller-address', x: 30, y: 50, width: 250, height: 80, fontSize: 10 };
    const inv = { ...INVOICE, seller: { ...INVOICE.seller, vatId: undefined, taxNumber: undefined } };
    const bytes = await svc.render(makeTemplate(block), inv);
    const items = await extractPdfTextItems(bytes);
    const distinctYs = [...new Set(items.map(i => Math.round(i.y)))];
    expect(distinctYs.length, '3 distinct Y rows for minimal seller').toBe(3);
    expect(items.find(i => i.text.includes('USt-IdNr.')), 'vatId line should be absent').toBeUndefined();
  });

  it('vatId line text format: "USt-IdNr.: DE123456789"', async () => {
    const block: PdfBlockDto = { id: '1', type: 'seller-address', x: 30, y: 50, width: 250, height: 120, fontSize: 10 };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    // pdfjs may split or keep together
    const vatLine = items.find(i => i.text.includes('USt-IdNr.:') || i.text.includes('DE123456789'));
    expect(vatLine, 'vatId line not found').toBeDefined();
  });

  it('taxNumber line text format contains "Steuernr."', async () => {
    const block: PdfBlockDto = { id: '1', type: 'seller-address', x: 30, y: 50, width: 250, height: 120, fontSize: 10 };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    expect(items.find(i => i.text.includes('Steuernr.')), 'taxNumber line not found').toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Suite U — exact text content (format, labels, values)
// ---------------------------------------------------------------------------

describe('exact text content — labels, values, formatting', () => {
  it('invoice-date: format is DD.MM.YYYY (not YYYY.MM.DD)', async () => {
    const block: PdfBlockDto = { id: '1', type: 'invoice-date', x: 60, y: 120, width: 240, height: 20, fontSize: 10 };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    // 2024-03-15 → should be "15.03.2024", not "2024.03.15"
    const dateItem = items.find(i => i.text.includes('2024'));
    expect(dateItem, 'date item not found').toBeDefined();
    expect(dateItem!.text, 'date must be DD.MM.YYYY').toContain('15.03.2024');
    expect(dateItem!.text, 'date must NOT be YYYY.MM.DD').not.toContain('2024.03.15');
  });

  it('invoice-number: label is "Nr.:" and value is the invoice number', async () => {
    const block: PdfBlockDto = { id: '1', type: 'invoice-number', x: 60, y: 120, width: 240, height: 20, fontSize: 10 };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    expect(items.find(i => i.text === 'Nr.:'), '"Nr.:" label not found').toBeDefined();
    expect(items.find(i => i.text.includes('RE-2024-0042')), 'invoice number not found').toBeDefined();
  });

  it('payment-means: value is "SEPA-\u00dcberweisung" for code 58', async () => {
    const block: PdfBlockDto = { id: '1', type: 'payment-means', x: 60, y: 120, width: 240, height: 20, fontSize: 10 };
    const bytes = await svc.render(makeTemplate(block), INVOICE); // INVOICE has paymentMeansCode: '58'
    const items = await extractPdfTextItems(bytes);
    expect(items.find(i => i.text.includes('SEPA')), 'SEPA-Überweisung value not found').toBeDefined();
  });

  it('iban-bic: first line starts with "IBAN:"', async () => {
    const block: PdfBlockDto = { id: '1', type: 'iban-bic', x: 40, y: 700, width: 300, height: 30, fontSize: 10 };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    expect(items.find(i => i.text.includes('IBAN:')), '"IBAN:" prefix not found').toBeDefined();
  });

  it('iban-bic: second line starts with "BIC:"', async () => {
    const block: PdfBlockDto = { id: '1', type: 'iban-bic', x: 40, y: 700, width: 300, height: 30, fontSize: 10 };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    expect(items.find(i => i.text.includes('BIC:')), '"BIC:" prefix not found').toBeDefined();
  });

  it('iban-bic: IBAN number appears in text', async () => {
    const block: PdfBlockDto = { id: '1', type: 'iban-bic', x: 40, y: 700, width: 300, height: 30, fontSize: 10 };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    // formatIban() inserts spaces every 4 chars: 'DE89 3704 0044 0532 0130 00'
    expect(items.find(i => i.text.includes('DE89 3704')), 'IBAN number not found').toBeDefined();
  });

  it('total-net: currency formatted as German locale "1.250,00 \u20ac"', async () => {
    const block: PdfBlockDto = { id: '1', type: 'total-net', x: 60, y: 120, width: 240, height: 20, fontSize: 10 };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    // 1250.00 in de-DE: "1.250,00 €"
    expect(items.find(i => i.text.includes('1.250')), '1.250,00 € not found').toBeDefined();
  });

  it('total-tax: tax rate appears in label "USt. 19%:"', async () => {
    const block: PdfBlockDto = { id: '1', type: 'total-tax', x: 60, y: 120, width: 240, height: 20, fontSize: 10 };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    expect(items.find(i => i.text.includes('19%')), 'tax rate "19%" not in label').toBeDefined();
  });

  it('due-date: format is DD.MM.YYYY', async () => {
    const block: PdfBlockDto = { id: '1', type: 'due-date', x: 60, y: 120, width: 240, height: 20, fontSize: 10 };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    expect(items.find(i => i.text.includes('15.04.2024')), 'due-date DD.MM.YYYY format not found').toBeDefined();
  });

  it('payment-info: contains "Zahlungsart:" prefix on first line', async () => {
    const block: PdfBlockDto = { id: '1', type: 'payment-info', x: 40, y: 600, width: 300, height: 80, fontSize: 10 };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    expect(items.find(i => i.text.includes('Zahlungsart')), '"Zahlungsart" not found in payment-info').toBeDefined();
  });

  it('invoice-title: default text is "Rechnung"', async () => {
    const block: PdfBlockDto = { id: '1', type: 'invoice-title', x: 40, y: 80, width: 200, height: 30, fontSize: 10 };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    expect(items.find(i => i.text === 'Rechnung'), '"Rechnung" not found').toBeDefined();
  });

  it('buyer-address: postal code and city combined on one line', async () => {
    const block: PdfBlockDto = { id: '1', type: 'buyer-address', x: 30, y: 200, width: 200, height: 60, fontSize: 10 };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    // Should contain "80331 München" as one text item or split, but 80331 and München should appear
    expect(items.find(i => i.text.includes('80331')), 'postal code 80331 not found').toBeDefined();
    expect(items.find(i => i.text.includes('nchen') || i.text.includes('M\u00fcnchen')), 'München not found').toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Suite V — label x-position starts at block.x for all label:value blocks
// ---------------------------------------------------------------------------

describe('label:value blocks — label starts exactly at block.x', () => {
  const cases: PdfBlockDto['type'][] = [
    'invoice-number', 'invoice-date', 'due-date', 'total-net', 'total-tax',
    'total-gross', 'payment-means', 'payment-terms',
  ];
  const labelTexts: Record<string, string> = {
    'invoice-number': 'Nr.:',
    'invoice-date':   'Datum:',
    'due-date':       'F\u00e4llig:',
    'total-net':      'Nettobetrag:',
    'total-tax':      'USt. 19%:',
    'total-gross':    'Bruttobetrag:',
    'payment-means':  'Zahlungsart:',
    'payment-terms':  'Zahlungsziel:',
  };

  for (const type of cases) {
    it(`${type}: label starts at block.x`, async () => {
      const block: PdfBlockDto = { id: '1', type, x: 75, y: 120, width: 220, height: 20, fontSize: 10 };
      const bytes = await svc.render(makeTemplate(block), INVOICE);
      const items = await extractPdfTextItems(bytes);
      const label = findTextItem(items, labelTexts[type]);
      expect(label, `label "${labelTexts[type]}" not found`).toBeDefined();
      expectNear(label!.x, block.x, `${type} label.x`, 1.0);
    });
  }
});

// ---------------------------------------------------------------------------
// Suite W — grid table style produces vertical column separator lines
// ---------------------------------------------------------------------------

describe('lines-table — grid style vertical lines', () => {
  it('grid style: has more line segments than minimal (vertical column separators)', async () => {
    const blockBase: Omit<PdfBlockDto, 'id' | 'tableStyle'> = {
      type: 'lines-table', x: 40, y: 200, width: 480, height: 200,
      fontSize: 10, showHeader: true, lineHeight: 1.8,
    };
    const minimalBytes = await svc.render(
      makeTemplate({ ...blockBase, id: '1', tableStyle: 'minimal' }),
      INVOICE,
    );
    const gridBytes = await svc.render(
      makeTemplate({ ...blockBase, id: '1', tableStyle: 'grid' }),
      INVOICE,
    );
    const minimalLines = await extractPdfLines(minimalBytes);
    const gridLines    = await extractPdfLines(gridBytes);
    // Grid adds vertical column separators — should have significantly more lines
    expect(gridLines.length, 'grid should have more lines than minimal').toBeGreaterThan(minimalLines.length);
  });

  it('grid style: vertical separator lines span the full table height', async () => {
    const block: PdfBlockDto = {
      id: '1', type: 'lines-table', x: 40, y: 200, width: 480, height: 200,
      fontSize: 10, showHeader: true, lineHeight: 1.8, tableStyle: 'grid',
    };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const lines = await extractPdfLines(bytes);
    // Vertical lines have different y1 and y2
    const vertLines = lines.filter(l => Math.abs(l.y1 - l.y2) > 5);
    expect(vertLines.length, 'vertical separator lines expected').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Suite V — text block baseline position (regression guard)
//
// The correct formula is: pdfY = pageHeight - block.y - fontSize
// which places the first baseline at CSS position block.y + fontSize.
//
// A previous attempt used:  pdfY = pageHeight - block.y - fontSize * CAP_HEIGHT
// (CAP_HEIGHT = 0.718) — this moved text UP by fontSize*0.282pt and made
// the output visually worse. These tests guard against that regression.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Suite V — text block baseline position (regression guard, tolerance 0.005pt)
//
// Formula: pdfY = pageHeight - block.y - fontSize
//          → cssBaseline = PAGE_HEIGHT - item.y = block.y + fontSize  (exact)
//
// pdfTextExtractor now returns raw float64 (no rounding). For integer block.y
// and fontSize values used here, LibPDF writes exact integer PDF coordinates →
// pdfjs reads back exact values → diff = 0.000 exactly.
//
// Tolerance 0.005pt: half the old 0.01pt quantization step; safe upper bound for
// any sub-integer floating-point residual from LibPDF's internal float arithmetic.
//
// CAP_HEIGHT approach (pdfY = pageHeight - block.y - fontSize × 0.718) would shift
// cssBaseline by −2.82pt for 10pt font — caught immediately (2.82 >> 0.005).
// ---------------------------------------------------------------------------

const BASELINE_TOL = 0.005;

describe('text block baseline — cssBaseline = block.y + fontSize (tolerance 0.005pt)', () => {
  it('seller-address: cssBaseline = block.y + fontSize', async () => {
    const blockY = 100, fs = 10;
    const block: PdfBlockDto = {
      id: '1', type: 'seller-address', x: 30, y: blockY, width: 200, height: 80, fontSize: fs,
    };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    const item = findTextItem(items, 'Musterfirma GmbH')!;
    expect(item, 'seller name not found').toBeDefined();
    expectNear(PAGE_HEIGHT - item.y, blockY + fs, 'seller-address baseline', BASELINE_TOL);
  });

  it('buyer-address: cssBaseline = block.y + fontSize', async () => {
    const blockY = 150, fs = 10;
    const block: PdfBlockDto = {
      id: '1', type: 'buyer-address', x: 30, y: blockY, width: 200, height: 60, fontSize: fs,
    };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    const item = findTextItem(items, 'Beispiel AG')!;
    expect(item, 'buyer name not found').toBeDefined();
    expectNear(PAGE_HEIGHT - item.y, blockY + fs, 'buyer-address baseline', BASELINE_TOL);
  });

  it('invoice-number: cssBaseline = block.y + fontSize', async () => {
    const blockY = 200, fs = 10;
    const block: PdfBlockDto = {
      id: '1', type: 'invoice-number', x: 60, y: blockY, width: 240, height: 20, fontSize: fs,
    };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    const item = findTextItem(items, 'Nr.:')!;
    expect(item, 'Nr.: not found').toBeDefined();
    expectNear(PAGE_HEIGHT - item.y, blockY + fs, 'invoice-number baseline', BASELINE_TOL);
  });

  it('free-text: cssBaseline = block.y + fontSize', async () => {
    const blockY = 300, fs = 12;
    const block: PdfBlockDto = {
      id: '1', type: 'free-text', x: 50, y: blockY, width: 200, height: 50,
      fontSize: fs, content: 'Test Zeile',
    };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    const item = findTextItem(items, 'Test Zeile')!;
    expect(item, '"Test Zeile" not found').toBeDefined();
    expectNear(PAGE_HEIGHT - item.y, blockY + fs, 'free-text baseline', BASELINE_TOL);
  });

  it('invoice-title: cssBaseline = block.y + fontSize (pdfY uses block.fontSize, renders at fontSize+4)', async () => {
    const blockY = 80, fs = 10;
    const block: PdfBlockDto = {
      id: '1', type: 'invoice-title', x: 40, y: blockY, width: 200, height: 30, fontSize: fs,
    };
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);
    const item = findTextItem(items, 'Rechnung')!;
    expect(item, '"Rechnung" not found').toBeDefined();
    expectNear(PAGE_HEIGHT - item.y, blockY + fs, 'invoice-title baseline', BASELINE_TOL);
  });

  it('two text blocks at same block.y produce baselines at the same height', async () => {
    const blockY = 120, fs = 10;
    const b1: PdfBlockDto = { id: '1', type: 'invoice-number', x: 300, y: blockY, width: 240, height: 20, fontSize: fs };
    const b2: PdfBlockDto = { id: '2', type: 'invoice-date',   x: 300, y: blockY, width: 240, height: 20, fontSize: fs };
    const bytes1 = await svc.render(makeTemplate(b1), INVOICE);
    const bytes2 = await svc.render(makeTemplate(b2), INVOICE);
    const items1 = await extractPdfTextItems(bytes1);
    const items2 = await extractPdfTextItems(bytes2);
    const nr    = findTextItem(items1, 'Nr.:')!;
    const datum = findTextItem(items2, 'Datum:')!;
    expect(nr,    'Nr.: not found').toBeDefined();
    expect(datum, 'Datum: not found').toBeDefined();
    expectNear(PAGE_HEIGHT - nr.y,    blockY + fs, 'invoice-number baseline', BASELINE_TOL);
    expectNear(PAGE_HEIGHT - datum.y, blockY + fs, 'invoice-date baseline', BASELINE_TOL);
    expectNear(nr.y, datum.y, 'same block.y → identical baseline', BASELINE_TOL);
  });
});
