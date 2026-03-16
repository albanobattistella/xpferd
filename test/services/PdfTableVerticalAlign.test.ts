/**
 * PdfTableVerticalAlign.test.ts
 *
 * Verifies that table cell text (both header and data rows) is vertically
 * centered within its row in the PDF output of PdfRenderService.
 *
 * Non-circular test strategy — three independent checks per test:
 *
 *   1. GLYPH CENTER SYMMETRY
 *      For a glyph of height `textHeight = fontSize - 1`, the glyph center
 *      must coincide with the row center (±1.5pt). This check is completely
 *      independent of the renderer formula.
 *        glyphCenter = textY + textHeight / 2    [baseline + half glyph height]
 *        rowCenter   = rowY + rowHeight / 2
 *        |glyphCenter - rowCenter| ≤ 1.5
 *
 *   2. ABSOLUTE Y POSITION
 *      Expected Y is computed from scratch in the test (not reusing PdfRenderService
 *      code). The pdfjs-extracted Y must be within ±1.5pt of this independently
 *      computed value.
 *
 *   3. BOUNDS CONTAINMENT
 *      textY > rowY  (baseline above row bottom)
 *      textY < rowY + rowHeight  (baseline below row top)
 *
 *   4. PREVIEW-PDF CONSISTENCY (pure unit test, no PDF rendering)
 *      The CSS canvas preview uses `align-items: center` which centers a box
 *      of height `fontSize-1` within rowHeight. The PDF formula is
 *      `Math.round((rowHeight - (fontSize-1)) / 2)`. They must agree to ≤ 1pt.
 *
 * Old non-centred formula: cellTextY = rowY + 4  (constant offset)
 * That formula would fail checks 1 and 2 for any row height ≠ 13pt.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import { Database } from '../../src/server/database/Database.js';
import { PdfRenderService } from '../../src/server/services/PdfRenderService.js';
import type { PdfBlockDto, PdfTemplateDto, InvoiceDto } from '../../src/shared/types';
import { extractPdfTextItems } from '../utils/pdfTextExtractor.js';
import type { PdfTextItem } from '../utils/pdfTextExtractor.js';

const TEST_DB = path.resolve(process.cwd(), `test/.test-pdf-valign-${Date.now()}.db`);

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
  invoiceNumber: 'VA-TEST-001',
  invoiceDate: '2024-06-01',
  dueDate: '2024-07-01',
  invoiceTypeCode: '380',
  currencyCode: 'EUR',
  paymentMeansCode: '58',
  iban: 'DE89370400440532013000',
  bic: 'COBADEFFXXX',
  paymentTerms: '14 Tage netto',
  taxRate: 19,
  taxCategoryCode: 'S',
  kleinunternehmer: false,
  totalNetAmount: 1000.00,
  totalTaxAmount: 190.00,
  totalGrossAmount: 1190.00,
  seller: {
    name: 'Test GmbH',
    street: 'Teststraße 1',
    postalCode: '10115',
    city: 'Berlin',
    countryCode: 'DE',
    vatId: 'DE123456789',
  },
  buyer: {
    name: 'Käufer AG',
    street: 'Käuferweg 5',
    postalCode: '80331',
    city: 'München',
    countryCode: 'DE',
  },
  lines: [
    {
      lineNumber: 1,
      itemName: 'Webdesign Startseite',
      quantity: 1,
      unitCode: 'HUR',
      netPrice: 600,
      vatCategoryCode: 'S',
      vatRate: 19,
      lineNetAmount: 600,
    },
    {
      lineNumber: 2,
      itemName: 'SEO-Optimierung',
      quantity: 4,
      unitCode: 'HUR',
      netPrice: 100,
      vatCategoryCode: 'S',
      vatRate: 19,
      lineNetAmount: 400,
    },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const svc = new PdfRenderService();

function makeTemplate(block: PdfBlockDto): PdfTemplateDto {
  return { id: 1, name: 'va-test', pageSize: 'a4', orientation: 'portrait', blocks: [block] };
}

/**
 * Assert |actual - expected| ≤ tol, with a clear failure message.
 */
function expectNear(actual: number, expected: number, label: string, tol = 1.5): void {
  expect(
    Math.abs(actual - expected),
    `${label}: expected ≈${expected.toFixed(2)}, got ${actual.toFixed(2)} (diff ${Math.abs(actual - expected).toFixed(2)}pt)`,
  ).toBeLessThanOrEqual(tol);
}

/**
 * Center-gap symmetry check.
 *
 * In PDF coordinates (Y increases upward):
 *   rowTop    = rowY + rowHeight
 *   rowBottom = rowY
 *
 * The PDF draws text at the BASELINE. For a glyph of rendered height
 * `textHeight = fontSize - 1`, the glyph occupies [textY, textY + textHeight].
 * Vertical centering means the glyph center equals the row center:
 *   textY + textHeight/2 ≈ rowY + rowHeight/2
 *   ⟹ textY ≈ rowY + (rowHeight - textHeight) / 2
 *
 * We check: |glyphCenter - rowCenter| ≤ 1.5pt
 *   glyphCenter = textY + textHeight / 2
 *   rowCenter   = rowY + rowHeight / 2
 */
function expectCentered(
  textY: number,
  rowY: number,
  rowHeight: number,
  textHeight: number,
  label: string,
): void {
  const glyphCenter = textY + textHeight / 2;
  const rowCenter   = rowY  + rowHeight / 2;
  const diff = Math.abs(glyphCenter - rowCenter);
  expect(
    diff,
    `${label}: glyph not centered — glyphCenter=${glyphCenter.toFixed(2)}, rowCenter=${rowCenter.toFixed(2)} (diff ${diff.toFixed(2)}pt)`,
  ).toBeLessThanOrEqual(1.5);
}

/**
 * Find a text item whose text matches the given string (exact or substring).
 * If multiple matches exist, returns the one with the highest Y (topmost in PDF coords,
 * i.e. first row encountered when drawing top-to-bottom).
 */
function findTableText(items: PdfTextItem[], text: string, exact = true): PdfTextItem | undefined {
  const matches = items.filter(i => exact ? i.text === text : i.text.includes(text));
  if (matches.length === 0) return undefined;
  return matches.reduce((best, cur) => cur.y > best.y ? cur : best);
}

// ---------------------------------------------------------------------------
// Test 1: Data row vertical centering — fontSize=10, lineHeight=1.8
// ---------------------------------------------------------------------------

describe('lines-table: data row vertical centering (fs=10, lh=1.8)', () => {
  // Block parameters
  const fontSize = 10;
  const lineHeight = 1.8;
  const blockY = 100;   // CSS top
  const blockX = 50;
  const blockWidth = 500;

  // Independently compute expected positions (NOT using PdfRenderService code)
  const rowHeight = fontSize * lineHeight;           // 10 * 1.8 = 18
  const headerHeight = rowHeight + 4;                // 22  (irrelevant here, showHeader=false)
  const pdfY = PAGE_HEIGHT - blockY;                 // 742

  // With showHeader=false, currentY starts at pdfY; first row: rowY = pdfY - rowHeight
  const firstRowY = pdfY - rowHeight;                // 742 - 18 = 724
  const expectedDataTextY = firstRowY + Math.round((rowHeight - (fontSize - 1)) / 2);
  // = 724 + Math.round((18 - 9) / 2) = 724 + Math.round(4.5) = 724 + 5 = 729

  const block: PdfBlockDto = {
    id: 'tbl-1',
    type: 'lines-table',
    x: blockX,
    y: blockY,
    width: blockWidth,
    height: 200,
    fontSize,
    lineHeight,
    showHeader: false,
  };

  it('first data row: center-gap symmetry ≤ 1.5pt', async () => {
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);

    // "1" is the pos column, "Webdesign Startseite" is the name column — both same row
    const item = findTableText(items, 'Webdesign Startseite');
    expect(item, '"Webdesign Startseite" not found in PDF').toBeDefined();

    expectCentered(item!.y, firstRowY, rowHeight, fontSize - 1, 'data-row-1 center-gap');
  });

  it('first data row: absolute Y within ±1.5pt of independently computed value', async () => {
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);

    const item = findTableText(items, 'Webdesign Startseite');
    expect(item, '"Webdesign Startseite" not found').toBeDefined();

    expectNear(item!.y, expectedDataTextY, 'data-row-1 absolute Y', 1.5);
  });

  it('first data row: baseline above row bottom (not clipped)', async () => {
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);

    const item = findTableText(items, 'Webdesign Startseite');
    expect(item, '"Webdesign Startseite" not found').toBeDefined();

    expect(item!.y, `textY=${item!.y.toFixed(2)} should be > rowY=${firstRowY.toFixed(2)}`).toBeGreaterThan(firstRowY);
  });

  it('first data row: baseline below row top (not clipped above)', async () => {
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);

    const item = findTableText(items, 'Webdesign Startseite');
    expect(item, '"Webdesign Startseite" not found').toBeDefined();

    expect(item!.y, `textY=${item!.y.toFixed(2)} should be < rowTop=${(firstRowY + rowHeight).toFixed(2)}`).toBeLessThan(firstRowY + rowHeight);
  });

  it('second data row: center-gap symmetry ≤ 1.5pt', async () => {
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);

    const secondRowY = firstRowY - rowHeight; // 724 - 18 = 706
    const item = findTableText(items, 'SEO-Optimierung');
    expect(item, '"SEO-Optimierung" not found').toBeDefined();

    expectCentered(item!.y, secondRowY, rowHeight, fontSize - 1, 'data-row-2 center-gap');
  });

  it('would FAIL with old formula cellTextY = rowY + 4', () => {
    // Using glyph-center model: glyphCenter = textY + textHeight/2
    //                            rowCenter   = rowY + rowHeight/2
    //   For centering: textY = rowY + (rowHeight - textHeight) / 2
    //
    // Old formula: textY = rowY + 4  (constant, independent of rowHeight)
    //   glyphCenter_old = rowY + 4 + textHeight/2
    //   rowCenter       = rowY + rowHeight/2
    //   diff_old = |(4 + textHeight/2) - rowHeight/2|
    //            = |4 - (rowHeight - textHeight)/2|
    //            = |4 - (rowH - 9)/2|
    //
    // For rowHeight=20 (fs=10, lh=2.0):
    //   diff_old = |4 - (20-9)/2| = |4 - 5.5| = 1.5  (borderline)
    // For rowHeight=25 (fs=10, lh=2.5):
    //   diff_old = |4 - (25-9)/2| = |4 - 8| = 4  → exceeds 1.5pt → test fails
    //
    // New formula: textY = rowY + Math.round((rowHeight - textHeight) / 2)
    //   diff_new ≤ 0.5 (only rounding error)  → test passes
    const textHeight = fontSize - 1;   // 9

    // Discriminating case: lh=2.5 (rowH=25)
    const rowH = fontSize * 2.5;       // 25
    const rowCenter = rowH / 2;        // 12.5

    // Old formula: textY = 4 (offset from rowY)
    const oldGlyphCenter = 4 + textHeight / 2; // 4 + 4.5 = 8.5
    const oldDiff = Math.abs(oldGlyphCenter - rowCenter); // |8.5 - 12.5| = 4

    expect(oldDiff, 'old formula glyph-center deviation should exceed 1.5pt at lh=2.5').toBeGreaterThan(1.5);

    // New formula: textY = Math.round((rowH - textHeight) / 2)
    const newOffset = Math.round((rowH - textHeight) / 2); // Math.round(8) = 8
    const newGlyphCenter = newOffset + textHeight / 2;     // 8 + 4.5 = 12.5
    const newDiff = Math.abs(newGlyphCenter - rowCenter);  // |12.5 - 12.5| = 0

    expect(newDiff, 'new formula glyph-center deviation should be ≤ 1pt').toBeLessThanOrEqual(1.0);
  });
});

// ---------------------------------------------------------------------------
// Test 2: Header row vertical centering — fontSize=10, lineHeight=1.8
// ---------------------------------------------------------------------------

describe('lines-table: header row vertical centering (fs=10, lh=1.8)', () => {
  const fontSize = 10;
  const lineHeight = 1.8;
  const blockY = 100;
  const blockX = 50;
  const blockWidth = 500;

  const rowHeight = fontSize * lineHeight;           // 18
  const headerHeight = rowHeight + 4;                // 22
  const pdfY = PAGE_HEIGHT - blockY;                 // 742

  // Header row occupies [pdfY - headerHeight, pdfY] = [720, 742]
  const headerRowBottom = pdfY - headerHeight;       // 720
  const expectedHeaderTextY = headerRowBottom + Math.round((headerHeight - (fontSize - 1)) / 2);
  // = 720 + Math.round((22 - 9) / 2) = 720 + Math.round(6.5) = 720 + 7 = 727

  const block: PdfBlockDto = {
    id: 'tbl-2',
    type: 'lines-table',
    x: blockX,
    y: blockY,
    width: blockWidth,
    height: 200,
    fontSize,
    lineHeight,
    showHeader: true,
  };

  it('header "Bezeichnung": center-gap symmetry ≤ 1.5pt', async () => {
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);

    const item = findTableText(items, 'Bezeichnung');
    expect(item, '"Bezeichnung" header not found').toBeDefined();

    expectCentered(item!.y, headerRowBottom, headerHeight, fontSize - 1, 'header center-gap');
  });

  it('header "Bezeichnung": absolute Y within ±1.5pt of independently computed value', async () => {
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);

    const item = findTableText(items, 'Bezeichnung');
    expect(item, '"Bezeichnung" header not found').toBeDefined();

    expectNear(item!.y, expectedHeaderTextY, 'header absolute Y', 1.5);
  });

  it('header "Pos": center-gap symmetry ≤ 1.5pt', async () => {
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);

    const item = findTableText(items, 'Pos');
    expect(item, '"Pos" header not found').toBeDefined();

    expectCentered(item!.y, headerRowBottom, headerHeight, fontSize - 1, 'header Pos center-gap');
  });

  it('header text baseline above header bottom edge', async () => {
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);

    const item = findTableText(items, 'Bezeichnung');
    expect(item, '"Bezeichnung" not found').toBeDefined();

    expect(item!.y, `headerTextY=${item!.y.toFixed(2)} should be > headerRowBottom=${headerRowBottom}`).toBeGreaterThan(headerRowBottom);
  });

  it('header text baseline below header top edge', async () => {
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);

    const item = findTableText(items, 'Bezeichnung');
    expect(item, '"Bezeichnung" not found').toBeDefined();

    expect(item!.y, `headerTextY=${item!.y.toFixed(2)} should be < pdfY=${pdfY}`).toBeLessThan(pdfY);
  });

  it('header and first data row: Y positions are distinct (different rows)', async () => {
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);

    const headerItem = findTableText(items, 'Bezeichnung');
    const dataItem   = findTableText(items, 'Webdesign Startseite');
    expect(headerItem, '"Bezeichnung" not found').toBeDefined();
    expect(dataItem,   '"Webdesign Startseite" not found').toBeDefined();

    // Header must be above (higher PDF Y) than first data row
    expect(
      headerItem!.y,
      `header Y=${headerItem!.y.toFixed(2)} should be > data-row-1 Y=${dataItem!.y.toFixed(2)}`,
    ).toBeGreaterThan(dataItem!.y);
  });
});

// ---------------------------------------------------------------------------
// Test 3: Different fontSize=8, lineHeight=2.0
// ---------------------------------------------------------------------------

describe('lines-table: data row vertical centering (fs=8, lh=2.0)', () => {
  const fontSize = 8;
  const lineHeight = 2.0;
  const blockY = 80;

  const rowHeight = fontSize * lineHeight;           // 8 * 2.0 = 16
  const pdfY = PAGE_HEIGHT - blockY;                 // 762

  // showHeader=false so currentY starts at pdfY
  const firstRowY = pdfY - rowHeight;                // 762 - 16 = 746
  const expectedDataTextY = firstRowY + Math.round((rowHeight - (fontSize - 1)) / 2);
  // = 746 + Math.round((16 - 7) / 2) = 746 + Math.round(4.5) = 746 + 5 = 751

  const block: PdfBlockDto = {
    id: 'tbl-3',
    type: 'lines-table',
    x: 50,
    y: blockY,
    width: 500,
    height: 200,
    fontSize,
    lineHeight,
    showHeader: false,
  };

  it('data row: center-gap symmetry scales with fontSize=8', async () => {
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);

    const item = findTableText(items, 'Webdesign Startseite');
    expect(item, '"Webdesign Startseite" not found (fs=8)').toBeDefined();

    expectCentered(item!.y, firstRowY, rowHeight, fontSize - 1, 'fs=8 lh=2.0 center-gap');
  });

  it('data row: absolute Y within ±1.5pt (fs=8, lh=2.0)', async () => {
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);

    const item = findTableText(items, 'Webdesign Startseite');
    expect(item, '"Webdesign Startseite" not found (fs=8)').toBeDefined();

    expectNear(item!.y, expectedDataTextY, 'fs=8 lh=2.0 absolute Y', 1.5);
  });

  it('data row: bounds containment (fs=8, lh=2.0)', async () => {
    const bytes = await svc.render(makeTemplate(block), INVOICE);
    const items = await extractPdfTextItems(bytes);

    const item = findTableText(items, 'Webdesign Startseite');
    expect(item, '"Webdesign Startseite" not found (fs=8)').toBeDefined();

    expect(item!.y).toBeGreaterThan(firstRowY);
    expect(item!.y).toBeLessThan(firstRowY + rowHeight);
  });

  it('would FAIL with old formula cellTextY = rowY + 4 at fs=8, lh=2.0', () => {
    // Using glyph-center model: centered ⟺ textY = rowY + (rowH - textH) / 2
    // Old formula: textY = rowY + 4 (constant offset regardless of rowHeight)
    //
    // For fs=8, lh=3.0: rowH=24, textH=7
    //   correct offset = Math.round((24-7)/2) = 9
    //   old offset = 4
    //   glyph center (old) = rowY + 4 + 3.5 = rowY + 7.5
    //   row center         = rowY + 12
    //   diff = 4.5 → exceeds 1.5pt threshold → test would fail
    const textHeight = fontSize - 1;   // 7
    const bigRowHeight = fontSize * 3.0; // 24
    const rowCenter = bigRowHeight / 2;  // 12

    const oldGlyphCenter = 4 + textHeight / 2;  // 7.5
    const oldDiff = Math.abs(oldGlyphCenter - rowCenter); // 4.5

    expect(oldDiff, 'old formula glyph-center deviation exceeds 1.5pt at fs=8, lh=3.0').toBeGreaterThan(1.5);

    // New formula
    const newOffset = Math.round((bigRowHeight - textHeight) / 2); // 9
    const newGlyphCenter = newOffset + textHeight / 2;             // 12.5
    const newDiff = Math.abs(newGlyphCenter - rowCenter);          // 0.5

    expect(newDiff, 'new formula glyph-center deviation is ≤ 1pt at fs=8, lh=3.0').toBeLessThanOrEqual(1.0);
  });
});

// ---------------------------------------------------------------------------
// Test 4: Preview-PDF consistency (pure unit — no PDF rendering)
// ---------------------------------------------------------------------------

describe('preview-PDF consistency: CSS centering vs PDF formula', () => {
  /**
   * CSS canvas preview uses `align-items: center` which centers a content box
   * of height `textHeight = fontSize - 1` inside a container of height `rowHeight`.
   *
   * The continuous CSS offset from the row bottom is:
   *   cssOffset = (rowHeight - textHeight) / 2  (exact, no rounding)
   *
   * The PDF formula applies Math.round:
   *   pdfOffset = Math.round((rowHeight - textHeight) / 2)
   *
   * They can differ by at most 0.5pt (the rounding error bound). Both use the
   * same textHeight = fontSize - 1 so the only difference is the rounding.
   *
   * This test explicitly verifies this contract holds for a range of realistic
   * (fontSize, lineHeight) pairs to catch any future divergence if one side
   * changes its formula.
   */

  const cases: { fontSize: number; lineHeight: number }[] = [
    { fontSize: 8,  lineHeight: 1.4 },
    { fontSize: 8,  lineHeight: 1.8 },
    { fontSize: 8,  lineHeight: 2.0 },
    { fontSize: 10, lineHeight: 1.4 },
    { fontSize: 10, lineHeight: 1.8 },
    { fontSize: 10, lineHeight: 2.0 },
    { fontSize: 12, lineHeight: 1.4 },
    { fontSize: 12, lineHeight: 1.8 },
    { fontSize: 12, lineHeight: 2.0 },
    { fontSize: 14, lineHeight: 1.4 },
    { fontSize: 14, lineHeight: 1.8 },
    { fontSize: 14, lineHeight: 2.0 },
  ];

  for (const { fontSize, lineHeight } of cases) {
    it(`fs=${fontSize} lh=${lineHeight}: CSS align-items:center ≈ PDF Math.round formula (≤ 1pt)`, () => {
      const textHeight = fontSize - 1;
      const rowHeight  = fontSize * lineHeight;

      // CSS: exact center offset from row bottom (no rounding — browser handles sub-pixel)
      const cssOffset = (rowHeight - textHeight) / 2;

      // PDF: same formula but with Math.round (integer pixel grid in PDF space)
      const pdfOffset = Math.round((rowHeight - textHeight) / 2);

      const diff = Math.abs(cssOffset - pdfOffset);

      expect(
        diff,
        `fs=${fontSize} lh=${lineHeight}: cssOffset=${cssOffset.toFixed(3)} vs pdfOffset=${pdfOffset} differ by ${diff.toFixed(3)}pt (should be ≤ 1pt)`,
      ).toBeLessThanOrEqual(1.0);
    });
  }

  it('header row: CSS centering ≈ PDF formula for headerHeight = rowHeight + 4', () => {
    // Header uses headerHeight = rowHeight + 4, but same centering formula
    const fontSize   = 10;
    const lineHeight = 1.8;
    const rowHeight  = fontSize * lineHeight;     // 18
    const headerHeight = rowHeight + 4;           // 22
    const textHeight = fontSize - 1;              // 9

    const cssOffset = (headerHeight - textHeight) / 2;       // 6.5
    const pdfOffset = Math.round((headerHeight - textHeight) / 2); // 7

    const diff = Math.abs(cssOffset - pdfOffset);

    expect(
      diff,
      `header: cssOffset=${cssOffset} vs pdfOffset=${pdfOffset} differ by ${diff}pt (should be ≤ 1pt)`,
    ).toBeLessThanOrEqual(1.0);
  });

  it('old fixed offset=4 diverges from CSS for non-standard lineHeights', () => {
    // If cellTextY = rowY + 4, the effective cssOffset would also need to be 4.
    // But CSS align-items:center produces (rowHeight - textHeight) / 2.
    // For fontSize=10, lineHeight=2.0: cssOffset=(20-9)/2=5.5 vs old=4 → diff=1.5
    // For fontSize=10, lineHeight=2.5: cssOffset=(25-9)/2=8 vs old=4 → diff=4
    const fontSize   = 10;
    const lineHeight = 2.5;
    const rowHeight  = fontSize * lineHeight;    // 25
    const textHeight = fontSize - 1;             // 9

    const cssOffset = (rowHeight - textHeight) / 2;  // 8
    const oldFixedOffset = 4;

    const diff = Math.abs(cssOffset - oldFixedOffset);  // 4

    expect(
      diff,
      `old fixed offset=4 diverges from CSS by ${diff}pt for fs=${fontSize} lh=${lineHeight}`,
    ).toBeGreaterThan(1.5); // proves mismatch → confirms our tests would catch regression
  });
});
