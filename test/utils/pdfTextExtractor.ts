/**
 * Extracts text items and path/line elements from PDFs using pdfjs-dist.
 *
 * PDF coordinate system: origin bottom-left, y increases upward.
 * transform[4] = x, transform[5] = y (baseline), Math.abs(transform[0]) = fontSize
 */

import { getDocument, GlobalWorkerOptions, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createRequire } from 'module';

const _require = createRequire(import.meta.url);
const workerPath = _require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
// @ts-expect-error — workerSrc accepts a string URL
GlobalWorkerOptions.workerSrc = new URL('file://' + workerPath).href;

// ---------------------------------------------------------------------------
// Text items
// ---------------------------------------------------------------------------

export interface PdfTextItem {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  width: number;
  /** Font name as reported by pdfjs, e.g. 'Helvetica', 'Helvetica-Bold' */
  fontName: string;
}

export async function extractPdfTextItems(pdfBytes: Uint8Array): Promise<PdfTextItem[]> {
  // Copy buffer — pdfjs transfers the ArrayBuffer to its worker; a second call on the same bytes would fail
  const doc = await getDocument({ data: pdfBytes.slice(), disableFontFace: true, verbosity: 0 }).promise;
  const page = await doc.getPage(1);
  const content = await page.getTextContent();

  const items: PdfTextItem[] = [];
  for (const item of content.items) {
    if (!('str' in item) || !item.str.trim()) continue;
    const [a, , , , x, y] = item.transform as number[];
    items.push({
      text: item.str,
      x,
      y,
      fontSize: Math.abs(a),
      width: item.width ?? 0,
      fontName: (item as unknown as { fontName: string }).fontName ?? '',
    });
  }
  return items;
}

export function findTextItem(items: PdfTextItem[], text: string, exact = true): PdfTextItem | undefined {
  return items.find(i => exact ? i.text === text : i.text.includes(text));
}

export function findTextItems(items: PdfTextItem[], text: string, exact = true): PdfTextItem[] {
  return items.filter(i => exact ? i.text === text : i.text.includes(text));
}

// ---------------------------------------------------------------------------
// Combined page data extraction (single getDocument call for performance)
// ---------------------------------------------------------------------------

export interface PdfPageData {
  textItems: PdfTextItem[];
  lineSegments: PdfLineSegment[];
  /** Unique fill colors (text, shape fills) as lowercase hex strings, e.g. '#ff0000' */
  fillColors: string[];
}

/**
 * Extracts text items, line segments, AND fill colors in a single pdfjs pass.
 * Use this in performance-sensitive test loops to avoid redundant getDocument calls.
 *
 * setFillRGBColor (OPS=59) args in pdfjs v5: ["#rrggbb"] (same hex format as setStrokeRGBColor)
 */
export async function extractPageData(pdfBytes: Uint8Array): Promise<PdfPageData> {
  const doc = await getDocument({ data: pdfBytes.slice(), disableFontFace: true, verbosity: 0 }).promise;
  const page = await doc.getPage(1);

  const [content, opList] = await Promise.all([page.getTextContent(), page.getOperatorList()]);

  // --- Text items ---
  const textItems: PdfTextItem[] = [];
  for (const item of content.items) {
    if (!('str' in item) || !item.str.trim()) continue;
    const [a, , , , x, y] = item.transform as number[];
    textItems.push({
      text: item.str,
      x,
      y,
      fontSize: Math.abs(a),
      width: item.width ?? 0,
      fontName: (item as unknown as { fontName: string }).fontName ?? '',
    });
  }

  // --- Lines and fill colors from operator list ---
  const lineSegments: PdfLineSegment[] = [];
  const fillColorSet = new Set<string>();
  let currentThickness = 1;
  let currentStrokeColor = { r: 0, g: 0, b: 0 };

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i] as unknown[];

    if (fn === OPS.setLineWidth) {
      currentThickness = Math.round((args[0] as number) * 100) / 100;

    } else if (fn === OPS.setStrokeRGBColor) {
      const hex = args[0] as string;
      if (typeof hex === 'string' && hex.startsWith('#') && hex.length === 7) {
        currentStrokeColor = {
          r: Math.round(parseInt(hex.slice(1, 3), 16) / 255 * 1000) / 1000,
          g: Math.round(parseInt(hex.slice(3, 5), 16) / 255 * 1000) / 1000,
          b: Math.round(parseInt(hex.slice(5, 7), 16) / 255 * 1000) / 1000,
        };
      }

    } else if (fn === OPS.setFillRGBColor) {
      // args = ["#rrggbb"] hex string in pdfjs v5 (same format as setStrokeRGBColor)
      const hex = args[0] as string;
      if (typeof hex === 'string') fillColorSet.add(hex.toLowerCase());

    } else if (fn === OPS.constructPath) {
      const rawArr = (args[1] as unknown[])[0] as ArrayLike<number>;
      const coords = Array.from(rawArr);
      if (coords.length === 6 && coords[0] === 0 && coords[3] === 1) {
        lineSegments.push({
          x1: Math.round(coords[1] * 100) / 100,
          y1: Math.round(coords[2] * 100) / 100,
          x2: Math.round(coords[4] * 100) / 100,
          y2: Math.round(coords[5] * 100) / 100,
          thickness: currentThickness,
          color: { ...currentStrokeColor },
        });
      }
    }
  }

  return { textItems, lineSegments, fillColors: [...fillColorSet] };
}

/** Returns unique fill colors used on page 1 as lowercase hex strings. */
export async function extractUsedFillColors(pdfBytes: Uint8Array): Promise<string[]> {
  const { fillColors } = await extractPageData(pdfBytes);
  return fillColors;
}

// ---------------------------------------------------------------------------
// Path / line elements (via operator list)
// ---------------------------------------------------------------------------

export interface PdfLineSegment {
  x1: number; y1: number;
  x2: number; y2: number;
  thickness: number;
  /** Stroke color as 0–1 floats (from setStrokeRGBColor before constructPath) */
  color: { r: number; g: number; b: number };
}

/**
 * Extracts all stroked straight-line segments from the first page.
 * Filters out rectangles; only reports moveTo+lineTo paths.
 */
/**
 * Extract stroked line segments from page 1.
 *
 * pdfjs v5 operator list format for a drawn line:
 *   save(10) → setStrokeRGBColor(58) → setLineWidth(2) → constructPath(91) → restore(11)
 *
 * constructPath args:
 *   args[0]  = internal size hint (ignored)
 *   args[1]  = Array containing ONE Float32Array with [op,x,y, op,x,y, ...]
 *              op 0 = moveTo, op 1 = lineTo
 *
 * There is NO separate stroke(19) operator — pdfjs synthesises constructPath
 * as a complete path-render operation.
 */
export async function extractPdfLines(pdfBytes: Uint8Array): Promise<PdfLineSegment[]> {
  const doc = await getDocument({ data: pdfBytes.slice(), disableFontFace: true, verbosity: 0 }).promise;
  const page = await doc.getPage(1);
  const opList = await page.getOperatorList();

  const lines: PdfLineSegment[] = [];
  let currentThickness = 1;
  let currentColor = { r: 0, g: 0, b: 0 };

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i] as unknown[];

    // OPS.setLineWidth = 2 in pdfjs v5
    if (fn === OPS.setLineWidth) {
      currentThickness = Math.round((args[0] as number) * 100) / 100;

    // OPS.setStrokeRGBColor = 58 — args = ["#rrggbb"] hex string (pdfjs v5 format)
    } else if (fn === OPS.setStrokeRGBColor) {
      const hex = args[0] as string;
      if (typeof hex === 'string' && hex.startsWith('#') && hex.length === 7) {
        currentColor = {
          r: Math.round(parseInt(hex.slice(1, 3), 16) / 255 * 1000) / 1000,
          g: Math.round(parseInt(hex.slice(3, 5), 16) / 255 * 1000) / 1000,
          b: Math.round(parseInt(hex.slice(5, 7), 16) / 255 * 1000) / 1000,
        };
      }

    } else if (fn === OPS.constructPath) {
      // args[1] is an Array containing ONE TypedArray
      const rawArr = (args[1] as unknown[])[0] as ArrayLike<number>;
      const coords = Array.from(rawArr);
      // A simple moveTo(0)+lineTo(1) segment: exactly 6 values [0,x1,y1, 1,x2,y2]
      if (coords.length === 6 && coords[0] === 0 && coords[3] === 1) {
        lines.push({
          x1: Math.round(coords[1] * 100) / 100,
          y1: Math.round(coords[2] * 100) / 100,
          x2: Math.round(coords[4] * 100) / 100,
          y2: Math.round(coords[5] * 100) / 100,
          thickness: currentThickness,
          color: { ...currentColor },
        });
      }
    }
  }

  return lines;
}
