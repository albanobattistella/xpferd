/**
 * FreeTextBlock.test.ts
 *
 * Tests the complete lifecycle of a free-text block:
 *   1. Service layer — create / update / retrieve with free-text block
 *   2. Font size change — update() persists the new fontSize
 *   3. PDF render — content appears at expected position after save
 *   4. API integration — full HTTP flow: POST → PUT (fontSize) → GET → render
 *
 * Each describe block is self-contained with its own ephemeral DB.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { Database } from '../../src/server/database/Database.js';
import { PdfTemplateService } from '../../src/server/services/PdfTemplateService.js';
import { PdfRenderService } from '../../src/server/services/PdfRenderService.js';
import { createApp } from '../../src/server/app.js';
import { extractPageData } from '../utils/pdfTextExtractor.js';
import type { PdfBlockDto, PdfTemplateDto } from '../../src/shared/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PAGE_HEIGHT = 842; // A4 portrait

function near(actual: number, expected: number, label: string, tol = 1.0): void {
  expect(Math.abs(actual - expected), `${label}: ${actual} ≠ ${expected}`).toBeLessThanOrEqual(tol);
}

function makeFreeTextBlock(overrides: Partial<PdfBlockDto> = {}): PdfBlockDto {
  return {
    id: crypto.randomUUID(),
    type: 'free-text',
    x: 57,
    y: 100,
    width: 300,
    height: 80,
    fontSize: 10,
    fontColor: '#1c1b18',
    fontWeight: 'normal',
    content: 'Vielen Dank für Ihren Auftrag.',
    ...overrides,
  };
}

function makeTemplate(block: PdfBlockDto, name = 'Freitext-Vorlage'): PdfTemplateDto {
  return {
    name,
    pageSize: 'a4',
    orientation: 'portrait',
    blocks: [block],
  };
}

// ---------------------------------------------------------------------------
// 1. PdfTemplateService — service-level CRUD with free-text block
// ---------------------------------------------------------------------------

describe('PdfTemplateService — free-text block CRUD', () => {
  const DB = path.resolve(process.cwd(), `test/.test-freetext-svc-${Date.now()}.db`);
  let svc: PdfTemplateService;

  beforeAll(() => {
    Database.resetInstance();
    Database.getInstance(DB);
    svc = new PdfTemplateService();
  });

  afterAll(() => {
    Database.resetInstance();
    for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  });

  it('create() persists a template containing a free-text block', () => {
    const block = makeFreeTextBlock();
    const created = svc.create(makeTemplate(block));
    expect(created.id).toBeTypeOf('number');
    expect(created.name).toBe('Freitext-Vorlage');
    expect(created.blocks).toHaveLength(1);
    expect(created.blocks[0].type).toBe('free-text');
    expect(created.blocks[0].content).toBe('Vielen Dank für Ihren Auftrag.');
  });

  it('getById() returns the saved free-text block content', () => {
    const block = makeFreeTextBlock({ content: 'Erste Zeile\nZweite Zeile' });
    const created = svc.create(makeTemplate(block, 'Mehrzeilig'));
    const fetched = svc.getById(created.id!);
    expect(fetched).not.toBeNull();
    expect(fetched!.blocks[0].content).toBe('Erste Zeile\nZweite Zeile');
  });

  it('getById() round-trips fontSize, fontWeight, and fontColor', () => {
    const block = makeFreeTextBlock({ fontSize: 14, fontWeight: 'bold', fontColor: '#cc0000' });
    const created = svc.create(makeTemplate(block, 'Styled'));
    const fetched = svc.getById(created.id!);
    expect(fetched!.blocks[0].fontSize).toBe(14);
    expect(fetched!.blocks[0].fontWeight).toBe('bold');
    expect(fetched!.blocks[0].fontColor).toBe('#cc0000');
  });

  it('listAll() includes newly created template', () => {
    const before = svc.listAll().length;
    svc.create(makeTemplate(makeFreeTextBlock({ content: 'Neu' }), 'Neuer Eintrag'));
    expect(svc.listAll().length).toBe(before + 1);
  });

  it('delete() removes the template', () => {
    const created = svc.create(makeTemplate(makeFreeTextBlock(), 'Zu löschen'));
    expect(svc.delete(created.id!)).toBe(true);
    expect(svc.getById(created.id!)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Font size change — update() persists new fontSize
// ---------------------------------------------------------------------------

describe('PdfTemplateService — free-text font size change via update()', () => {
  const DB = path.resolve(process.cwd(), `test/.test-freetext-fs-${Date.now()}.db`);
  let svc: PdfTemplateService;

  beforeAll(() => {
    Database.resetInstance();
    Database.getInstance(DB);
    svc = new PdfTemplateService();
  });

  afterAll(() => {
    Database.resetInstance();
    for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  });

  it('update() changes fontSize from 10 to 18 and persists it', () => {
    const block = makeFreeTextBlock({ fontSize: 10 });
    const created = svc.create(makeTemplate(block));

    const updatedBlock: PdfBlockDto = { ...block, fontSize: 18 };
    const updated = svc.update(created.id!, makeTemplate(updatedBlock));
    expect(updated).not.toBeNull();
    expect(updated!.blocks[0].fontSize).toBe(18);
  });

  it('getById() after update() returns the new fontSize', () => {
    const block = makeFreeTextBlock({ fontSize: 10 });
    const created = svc.create(makeTemplate(block));

    const updatedBlock: PdfBlockDto = { ...block, fontSize: 16 };
    svc.update(created.id!, makeTemplate(updatedBlock));

    const reloaded = svc.getById(created.id!);
    expect(reloaded!.blocks[0].fontSize).toBe(16);
  });

  it('update() changes fontSize and preserves content', () => {
    const originalContent = 'Text der erhalten bleiben soll.';
    const block = makeFreeTextBlock({ fontSize: 10, content: originalContent });
    const created = svc.create(makeTemplate(block));

    const updatedBlock: PdfBlockDto = { ...block, fontSize: 12 };
    svc.update(created.id!, makeTemplate(updatedBlock));

    const reloaded = svc.getById(created.id!);
    expect(reloaded!.blocks[0].content).toBe(originalContent);
    expect(reloaded!.blocks[0].fontSize).toBe(12);
  });

  it('update() returns null for non-existent template id', () => {
    const block = makeFreeTextBlock({ fontSize: 14 });
    expect(svc.update(999999, makeTemplate(block))).toBeNull();
  });

  it('sequential font size changes are all persisted', () => {
    const block = makeFreeTextBlock({ fontSize: 8 });
    const created = svc.create(makeTemplate(block));
    const id = created.id!;

    for (const fs of [10, 12, 14, 16]) {
      svc.update(id, makeTemplate({ ...block, fontSize: fs }));
      const r = svc.getById(id);
      expect(r!.blocks[0].fontSize, `after setting fontSize to ${fs}`).toBe(fs);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. PDF render — text content appears at correct position
// ---------------------------------------------------------------------------

describe('PdfRenderService — free-text block renders saved content', () => {
  const renderSvc = new PdfRenderService();

  it('single-line content appears in PDF at block.x', async () => {
    const block = makeFreeTextBlock({ content: 'Testzweck Freitext', x: 57, y: 100, fontSize: 10 });
    const tpl = makeTemplate(block);
    const bytes = await renderSvc.render(tpl, MINIMAL_INVOICE);

    const { textItems } = await extractPageData(bytes);
    const item = textItems.find(i => i.text.includes('Testzweck'));
    expect(item, 'text item not found in PDF').toBeDefined();
    near(item!.x, block.x, 'text x = block.x', 1.5);
  });

  it('multi-line content: each line appears in PDF', async () => {
    const block = makeFreeTextBlock({
      content: 'Zeile Eins\nZeile Zwei\nZeile Drei',
      x: 80, y: 150, width: 300, height: 60, fontSize: 10,
    });
    const tpl = makeTemplate(block);
    const bytes = await renderSvc.render(tpl, MINIMAL_INVOICE);

    const { textItems } = await extractPageData(bytes);
    expect(textItems.find(i => i.text.includes('Eins')), 'line 1 not found').toBeDefined();
    expect(textItems.find(i => i.text.includes('Zwei')), 'line 2 not found').toBeDefined();
    expect(textItems.find(i => i.text.includes('Drei')), 'line 3 not found').toBeDefined();
  });

  it('fontSize 10 → item.fontSize ≈ 10 in PDF', async () => {
    const block = makeFreeTextBlock({ content: 'Größentest', fontSize: 10 });
    const bytes = await renderSvc.render(makeTemplate(block), MINIMAL_INVOICE);
    const { textItems } = await extractPageData(bytes);
    const item = textItems.find(i => i.text.includes('Größentest'));
    expect(item).toBeDefined();
    near(item!.fontSize, 10, 'fontSize 10', 0.5);
  });

  it('fontSize 18 → item.fontSize ≈ 18 in PDF', async () => {
    const block = makeFreeTextBlock({ content: 'Großschrift', fontSize: 18, height: 40 });
    const bytes = await renderSvc.render(makeTemplate(block), MINIMAL_INVOICE);
    const { textItems } = await extractPageData(bytes);
    const item = textItems.find(i => i.text.includes('Großschrift'));
    expect(item).toBeDefined();
    near(item!.fontSize, 18, 'fontSize 18', 0.5);
  });

  it('changed fontSize is reflected in rendered PDF after update', async () => {
    const DB = path.resolve(process.cwd(), `test/.test-freetext-pdf-${Date.now()}.db`);
    Database.resetInstance();
    Database.getInstance(DB);
    const svc = new PdfTemplateService();

    try {
      const block = makeFreeTextBlock({ content: 'Fontgröße geändert', fontSize: 10 });
      const created = svc.create(makeTemplate(block));

      // Change fontSize via update
      svc.update(created.id!, makeTemplate({ ...block, fontSize: 20 }));

      const saved = svc.getById(created.id!)!;
      const bytes = await renderSvc.render(saved, MINIMAL_INVOICE);
      const { textItems } = await extractPageData(bytes);

      const item = textItems.find(i => i.text.includes('Fontgröße'));
      expect(item, 'text not found in PDF after fontSize update').toBeDefined();
      near(item!.fontSize, 20, 'updated fontSize in PDF', 0.5);
    } finally {
      Database.resetInstance();
      for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      }
    }
  });

  it('empty content renders as valid PDF (no crash)', async () => {
    const block = makeFreeTextBlock({ content: '', height: 40 });
    const bytes = await renderSvc.render(makeTemplate(block), MINIMAL_INVOICE);
    expect(bytes.length).toBeGreaterThan(200);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('%PDF');
  });
});

// ---------------------------------------------------------------------------
// 4. API integration — full HTTP lifecycle
// ---------------------------------------------------------------------------

const DB_API = path.resolve(process.cwd(), `test/.test-freetext-api-${Date.now()}.db`);
let server: http.Server;
let baseUrl: string;

async function api(method: string, urlPath: string, body?: unknown): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = res.status === 204
    ? null
    : res.headers.get('content-type')?.includes('json')
      ? JSON.parse(text)
      : text;
  return { status: res.status, data };
}

function apiTemplate(content: string, fontSize: number): PdfTemplateDto {
  return {
    name: 'API-Freitext-Test',
    pageSize: 'a4',
    orientation: 'portrait',
    blocks: [
      {
        id: 'block-1',
        type: 'free-text',
        x: 57,
        y: 100,
        width: 300,
        height: 80,
        fontSize,
        fontColor: '#1c1b18',
        fontWeight: 'normal',
        content,
      },
    ],
  };
}

describe('API — free-text block: create, update fontSize, save, retrieve', () => {
  beforeAll(async () => {
    Database.resetInstance();
    Database.getInstance(DB_API);
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
    for (const f of [DB_API, `${DB_API}-wal`, `${DB_API}-shm`]) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  });

  let templateId: number;

  it('POST /api/v1/pdf-templates creates template with free-text block', async () => {
    const body = apiTemplate('Willkommen bei XRechnung.', 10);
    const { status, data } = await api('POST', '/api/v1/pdf-templates', body);
    expect(status).toBe(201);
    const d = data as PdfTemplateDto;
    expect(d.id).toBeTypeOf('number');
    expect(d.name).toBe('API-Freitext-Test');
    expect(d.blocks).toHaveLength(1);
    expect(d.blocks[0].type).toBe('free-text');
    expect(d.blocks[0].content).toBe('Willkommen bei XRechnung.');
    expect(d.blocks[0].fontSize).toBe(10);
    templateId = d.id!;
  });

  it('GET /api/v1/pdf-templates/:id returns the saved free-text block', async () => {
    const { status, data } = await api('GET', `/api/v1/pdf-templates/${templateId}`);
    expect(status).toBe(200);
    const d = data as PdfTemplateDto;
    expect(d.blocks[0].type).toBe('free-text');
    expect(d.blocks[0].content).toBe('Willkommen bei XRechnung.');
  });

  it('PUT /api/v1/pdf-templates/:id updates the font size', async () => {
    const body = apiTemplate('Willkommen bei XRechnung.', 16);
    const { status, data } = await api('PUT', `/api/v1/pdf-templates/${templateId}`, body);
    expect(status).toBe(200);
    const d = data as PdfTemplateDto;
    expect(d.blocks[0].fontSize).toBe(16);
  });

  it('GET /api/v1/pdf-templates/:id after PUT returns updated fontSize', async () => {
    const { status, data } = await api('GET', `/api/v1/pdf-templates/${templateId}`);
    expect(status).toBe(200);
    const d = data as PdfTemplateDto;
    expect(d.blocks[0].fontSize).toBe(16);
    // Content must be unchanged
    expect(d.blocks[0].content).toBe('Willkommen bei XRechnung.');
  });

  it('PUT /api/v1/pdf-templates/:id updates the text content', async () => {
    const body = apiTemplate('Geänderter Freitext.', 16);
    const { status, data } = await api('PUT', `/api/v1/pdf-templates/${templateId}`, body);
    expect(status).toBe(200);
    const d = data as PdfTemplateDto;
    expect(d.blocks[0].content).toBe('Geänderter Freitext.');
  });

  it('GET after content update returns new content', async () => {
    const { status, data } = await api('GET', `/api/v1/pdf-templates/${templateId}`);
    expect(status).toBe(200);
    const d = data as PdfTemplateDto;
    expect(d.blocks[0].content).toBe('Geänderter Freitext.');
  });

  it('POST with invalid block type returns 400', async () => {
    const body = {
      name: 'Ungültig',
      pageSize: 'a4',
      orientation: 'portrait',
      blocks: [{ id: 'b1', type: 'invalid-type', x: 0, y: 0, width: 100, height: 50 }],
    };
    const { status } = await api('POST', '/api/v1/pdf-templates', body);
    expect(status).toBe(400);
  });

  it('POST with fontSize below minimum (< 4) returns 400', async () => {
    const body = apiTemplate('Test', 2); // fontSize: 2 < min 4
    const { status } = await api('POST', '/api/v1/pdf-templates', body);
    expect(status).toBe(400);
  });

  it('GET /api/v1/pdf-templates/:id returns 404 for non-existent template', async () => {
    const { status } = await api('GET', '/api/v1/pdf-templates/999999');
    expect(status).toBe(404);
  });

  it('PUT /api/v1/pdf-templates/:id returns 404 for non-existent template', async () => {
    const body = apiTemplate('Test', 10);
    const { status } = await api('PUT', '/api/v1/pdf-templates/999999', body);
    expect(status).toBe(404);
  });

  it('DELETE /api/v1/pdf-templates/:id removes the template', async () => {
    const { status } = await api('DELETE', `/api/v1/pdf-templates/${templateId}`);
    expect(status).toBe(204);
    const { status: s2 } = await api('GET', `/api/v1/pdf-templates/${templateId}`);
    expect(s2).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// 5. Free-text alignment — left / center / right
// ---------------------------------------------------------------------------

describe('free-text alignment', () => {
  /**
   * LibPDF's `alignment` option only activates for multiline text.
   * We force multiline by using an explicit newline in the content
   * so both lines are rendered with the requested alignment.
   * We assert on the SECOND line to avoid the first-line anchor at block.x.
   *
   * Strategy per alignment:
   *   left   — item.x ≈ block.x  (default, no padding)
   *   center — item.x is clearly right of block.x AND
   *            center of item (x + width/2) ≈ block.x + block.width/2
   *   right  — item right edge (x + width) ≈ block.x + block.width
   */
  const renderSvc = new PdfRenderService();
  const BLOCK_X = 57;
  const BLOCK_WIDTH = 200;

  function makeAlignBlock(textAlign: 'left' | 'center' | 'right', content: string): PdfBlockDto {
    return {
      id: crypto.randomUUID(),
      type: 'free-text',
      x: BLOCK_X,
      y: 100,
      width: BLOCK_WIDTH,
      height: 80,
      fontSize: 12,
      fontColor: '#1c1b18',
      fontWeight: 'normal',
      textAlign,
      content,
    };
  }

  /** Find the item for a line's text content, tolerating pdfjs token splits. */
  function findLine(items: { text: string; x: number; y: number; width: number }[], fragment: string) {
    return items.find(i => i.text.includes(fragment) || fragment.includes(i.text.trim()));
  }

  it('left-aligned text starts near block.x', async () => {
    // Two lines so LibPDF's multiline alignment mode is active
    const block = makeAlignBlock('left', 'Links\nAusrichtung');
    const bytes = await renderSvc.render(makeTemplate(block), MINIMAL_INVOICE);
    const { textItems } = await extractPageData(bytes);

    // Both lines should start at block.x (no padding defaults to 0)
    const line1 = findLine(textItems, 'Links');
    const line2 = findLine(textItems, 'Ausrichtung');
    expect(line1, 'line 1 not found').toBeDefined();
    expect(line2, 'line 2 not found').toBeDefined();
    near(line1!.x, BLOCK_X, 'left line1 x = block.x', 2.0);
    near(line2!.x, BLOCK_X, 'left line2 x = block.x', 2.0);
  });

  it('center-aligned text is positioned roughly in the middle', async () => {
    // "Mitte" + "Text" — force multiline so LibPDF applies center alignment
    const block = makeAlignBlock('center', 'Mitte\nText');
    const bytes = await renderSvc.render(makeTemplate(block), MINIMAL_INVOICE);
    const { textItems } = await extractPageData(bytes);

    // Find the second line "Text" — shorter word makes centering more pronounced
    const item = findLine(textItems, 'Text');
    expect(item, '"Text" line not found in PDF').toBeDefined();

    // Center-aligned: item must start to the right of block.x
    expect(item!.x, 'center-aligned text must start right of block.x').toBeGreaterThan(BLOCK_X + 2);

    // The midpoint of the item should be near the block's horizontal center
    const itemMidX = item!.x + item!.width / 2;
    const blockMidX = BLOCK_X + BLOCK_WIDTH / 2;
    near(itemMidX, blockMidX, 'center midpoint', 10.0);
  });

  it('right-aligned text ends near block.x + block.width', async () => {
    // "Rechts" + "End" — force multiline for LibPDF alignment activation
    const block = makeAlignBlock('right', 'Rechts\nEnd');
    const bytes = await renderSvc.render(makeTemplate(block), MINIMAL_INVOICE);
    const { textItems } = await extractPageData(bytes);

    // Right edge of right-aligned line should match block right boundary
    const blockRight = BLOCK_X + BLOCK_WIDTH;

    // Check both lines — at least one must have its right edge near blockRight
    const line1 = findLine(textItems, 'Rechts');
    const line2 = findLine(textItems, 'End');
    expect(line1 ?? line2, 'at least one right-aligned line not found').toBeDefined();

    // Each found line: its right edge (x + width) ≈ blockRight
    for (const item of [line1, line2]) {
      if (!item) continue;
      const rightEdge = item.x + item.width;
      // Right-aligned text must be strictly right of center and end within 6pt of block right
      expect(item.x, `right-aligned item must start right of block midpoint`).toBeGreaterThan(BLOCK_X + BLOCK_WIDTH * 0.3);
      near(rightEdge, blockRight, `right-aligned right edge (${item.text})`, 6.0);
    }
  });
});

// ---------------------------------------------------------------------------
// Minimal invoice fixture (no optional fields, used in render tests)
// ---------------------------------------------------------------------------

const MINIMAL_INVOICE = {
  invoiceNumber: 'FT-001',
  invoiceDate: '2024-01-01',
  invoiceTypeCode: '380',
  currencyCode: 'EUR',
  paymentMeansCode: '30',
  taxRate: 0,
  taxCategoryCode: 'E',
  kleinunternehmer: true,
  totalNetAmount: 100,
  totalTaxAmount: 0,
  totalGrossAmount: 100,
  seller: { name: 'FT GmbH', street: 'Str. 1', postalCode: '10115', city: 'Berlin', countryCode: 'DE' },
  buyer: { name: 'Kunde', street: 'Str. 2', postalCode: '80331', city: 'München', countryCode: 'DE' },
  lines: [
    { lineNumber: 1, itemName: 'Beratung', quantity: 1, unitCode: 'HUR', netPrice: 100, vatCategoryCode: 'E', vatRate: 0, lineNetAmount: 100 },
  ],
} as const;
