/**
 * blockSnapUtils.ts — Pure block snapping utilities (canvas preview)
 *
 * Extracted from PdfBuilderPage.svelte so the logic can be unit-tested.
 */

export interface SnapBlock {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Per-block line gap for cross-edge Y snapping (fontSize × lineHeight). */
  lineGap?: number;
}

export interface SnapResult {
  x: number;
  y: number;
  snappedIds: Set<string>;
}

/**
 * Snaps `moving` block to edges of `others`.
 *
 * Uses "best match wins" per axis: the single closest snap candidate for X
 * and Y is applied. Only the final winner block per axis is added to
 * `snappedIds` — intermediate candidates that were later superseded are not.
 *
 * Y axis — only 5 meaningful pairs are checked:
 *   Same-edge (flush):  top↔top, bottom↔bottom, centerY↔centerY
 *   Cross-edge (gap):   myTop↔otherBottom (+targetGap), myBottom↔otherTop (−lineGap)
 *
 * Cross-edge pairs use the *target* block's lineGap (other.lineGap ?? lineGap)
 * when the moving block goes below the target (myTop→otherBottom), so the gap
 * matches the upper block's text spacing. Moving above a target uses `lineGap`
 * (the moving block's own line height).
 *
 * Mixed center-to-edge pairs (myTop↔otherCenterY, myCenterY↔otherTop, etc.)
 * are intentionally omitted — they cause blocks to overlap because no
 * line-gap offset is applied for them.
 *
 * X axis — all 9 pairs (3 edges × 3 edges), no gap.
 *
 * @param moving        Block being dragged (use display height, not stored height)
 * @param others        All other blocks with their display heights and optional lineGaps
 * @param snapThreshold Distance (pts) within which an edge snaps
 * @param lineGap       Moving block's own line gap (fontSize × 1.4), used as fallback
 */
export function snapBlockToOthers(
  moving: SnapBlock,
  others: SnapBlock[],
  snapThreshold: number,
  lineGap: number,
): SnapResult {
  let bestYDist = snapThreshold; // strict less-than — threshold is exclusive
  let bestXDist = snapThreshold;
  let snapY: number | null = null;
  let snapX: number | null = null;
  let bestYId: string | null = null;
  let bestXId: string | null = null;

  const myTop     = moving.y;
  const myBottom  = moving.y + moving.height;
  const myCenterY = moving.y + moving.height / 2;

  const myLeft    = moving.x;
  const myRight   = moving.x + moving.width;
  const myCenterX = moving.x + moving.width / 2;

  for (const other of others) {
    if (other.id === moving.id) continue;

    const otherTop     = other.y;
    const otherBottom  = other.y + other.height;
    const otherCenterY = other.y + other.height / 2;

    // Line gap to use when moving block snaps below this block:
    // use the target block's own spacing so the gap matches its text rhythm.
    const targetGap = other.lineGap ?? lineGap;

    // ---- Y axis: 5 meaningful pairs only ----
    //
    // Same-edge (flush): detect and snap to the same edge.
    //   myTop → otherTop, myBottom → otherBottom, myCenterY → otherCenterY
    //
    // Cross-edge: detect near the *flush* edge (where the user drags), snap to gapped position.
    //   myTop near otherBottom  → snap myTop to otherBottom + targetGap
    //   myBottom near otherTop  → snap myBottom to otherTop − lineGap
    //
    // This means the snap activates when the user drags to be visually adjacent (flush),
    // then jumps to the correct one-line-gap spacing. Using [detectionEdge, detectionTarget, snapTarget].
    const yChecks: Array<[detectionEdge: number, detectionTarget: number, snapTarget: number]> = [
      [myTop,     otherTop,    otherTop],
      [myBottom,  otherBottom, otherBottom],
      [myCenterY, otherCenterY, otherCenterY],
      [myTop,     otherBottom, otherBottom + targetGap],
      [myBottom,  otherTop,    otherTop - lineGap],
    ];

    for (const [detectionEdge, detectionTarget, snapTarget] of yChecks) {
      const dist = Math.abs(detectionEdge - detectionTarget);
      if (dist < bestYDist) {
        bestYDist = dist;
        snapY = snapTarget - (detectionEdge - myTop);
        bestYId = other.id;
      }
    }

    // ---- X axis: all 9 pairs, no gap ----
    const otherLeft    = other.x;
    const otherRight   = other.x + other.width;
    const otherCenterX = other.x + other.width / 2;

    for (const myVal of [myLeft, myCenterX, myRight]) {
      for (const otherVal of [otherLeft, otherCenterX, otherRight]) {
        const dist = Math.abs(myVal - otherVal);
        if (dist < bestXDist) {
          bestXDist = dist;
          snapX = otherVal - (myVal - myLeft);
          bestXId = other.id;
        }
      }
    }
  }

  // Only add the final winner per axis — not intermediate superseded candidates.
  const snapped = new Set<string>();
  if (bestYId !== null) snapped.add(bestYId);
  if (bestXId !== null) snapped.add(bestXId);

  return {
    x: snapX ?? moving.x,
    y: snapY ?? moving.y,
    snappedIds: snapped,
  };
}

export interface EdgeSnapResult {
  /** Snapped position (equals original edge if no snap occurred). */
  value: number;
  /** ID of the block that was snapped to, or null. */
  snappedId: string | null;
}

/**
 * Snaps a single 1-D edge to the nearest left or right bound of nearby blocks.
 *
 * Used during horizontal resize to snap the moving E or W edge to other blocks'
 * left (x) or right (x + width) edges. Best-match-wins: only the closest
 * candidate within threshold is applied.
 *
 * The caller is responsible for excluding the block being resized from `others`.
 *
 * @param edge      Current absolute position of the moving edge (pts)
 * @param others    Other blocks — only `id`, `x`, `width` are used
 * @param threshold Maximum distance for snapping (pts, exclusive)
 */
export function snapEdgeToBlockBounds(
  edge: number,
  others: ReadonlyArray<{ id: string; x: number; width: number }>,
  threshold: number,
): EdgeSnapResult {
  let bestDist = threshold; // strict less-than — threshold is exclusive
  let bestValue = edge;
  let bestId: string | null = null;

  for (const other of others) {
    for (const target of [other.x, other.x + other.width]) {
      const dist = Math.abs(edge - target);
      if (dist < bestDist) {
        bestDist = dist;
        bestValue = target;
        bestId = other.id;
      }
    }
  }

  return { value: bestValue, snappedId: bestId };
}

/**
 * Maps a column alignment value to the CSS `justify-content` property value.
 *
 * Note: `.preview-table-cell` uses `display: flex` for vertical alignment
 * (`align-items: flex-end`). Inside a flex container, `text-align` is silently
 * ignored for horizontal positioning — `justify-content` must be used instead.
 */
export function alignToJustify(
  align: 'left' | 'center' | 'right',
): 'flex-start' | 'center' | 'flex-end' {
  if (align === 'right') return 'flex-end';
  if (align === 'center') return 'center';
  return 'flex-start';
}
