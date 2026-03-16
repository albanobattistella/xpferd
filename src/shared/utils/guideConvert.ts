export const CM_TO_PTS = 28.346;

/**
 * Convert a cm value (signed) to stored pts position.
 * Vertical (V): positive = from left, negative = from right
 * Horizontal (H): positive = from bottom, negative = from top
 */
export function guideToPosition(
  cm: number,
  orientation: 'horizontal' | 'vertical',
  pageWidth: number,
  pageHeight: number,
): number {
  if (orientation === 'vertical') {
    return cm < 0 ? pageWidth - Math.abs(cm) * CM_TO_PTS : cm * CM_TO_PTS;
  } else {
    return cm < 0 ? Math.abs(cm) * CM_TO_PTS : pageHeight - cm * CM_TO_PTS;
  }
}

/**
 * Convert stored pts position to a signed cm value.
 * Uses page midpoint to determine "from other side" (returns negative).
 */
export function positionToGuide(
  pos: number,
  orientation: 'horizontal' | 'vertical',
  pageWidth: number,
  pageHeight: number,
): number {
  if (orientation === 'vertical') {
    // pos > half-width → closer to right edge → negative (from right)
    if (pos > pageWidth / 2) {
      return -((pageWidth - pos) / CM_TO_PTS);
    }
    return pos / CM_TO_PTS;
  } else {
    // pos < half-height → closer to top → negative (from top)
    if (pos < pageHeight / 2) {
      return -(pos / CM_TO_PTS);
    }
    return (pageHeight - pos) / CM_TO_PTS;
  }
}
