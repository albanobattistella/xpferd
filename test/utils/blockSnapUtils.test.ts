/**
 * blockSnapUtils.test.ts
 *
 * Tests for the block-to-block snapping utility.
 *
 * Issue: column alignment CSS — `text-align` is silently ignored on flex containers.
 *   The canvas preview uses `display: flex` on `.preview-table-cell`, so horizontal
 *   alignment must use `justify-content`, not `text-align`.
 *
 * Issue: vertical snap gap — when two blocks snap top-to-bottom (or bottom-to-top),
 *   there should be exactly one line-height gap between them so content doesn't
 *   collide after snapping.
 */

import { describe, it, expect } from 'vitest';
import { snapBlockToOthers, alignToJustify, snapEdgeToBlockBounds } from '../../src/shared/utils/blockSnapUtils.js';
import type { SnapBlock } from '../../src/shared/utils/blockSnapUtils.js';

// ---------------------------------------------------------------------------
// alignToJustify — documents that text-align is wrong for flex cells
// ---------------------------------------------------------------------------

describe('alignToJustify — canvas preview uses display:flex, must use justify-content', () => {
  // Bug: preview-table-cell has `display: flex; align-items: flex-end`.
  // text-align is IGNORED for flex containers — justify-content must be used.
  // This test verifies the mapping from column alignment values to CSS justify-content.

  it('left → flex-start', () => {
    expect(alignToJustify('left')).toBe('flex-start');
  });

  it('center → center', () => {
    expect(alignToJustify('center')).toBe('center');
  });

  it('right → flex-end', () => {
    expect(alignToJustify('right')).toBe('flex-end');
  });
});

// ---------------------------------------------------------------------------
// snapBlockToOthers — vertical snapping with one line-height gap
// ---------------------------------------------------------------------------

const THRESHOLD = 8;
const LINE_GAP = 14; // fontSize=10 * lineHeight=1.4

function blk(id: string, x: number, y: number, w: number, h: number): SnapBlock {
  return { id, x, y, width: w, height: h };
}

describe('snapBlockToOthers — vertical gap = one line height', () => {
  // Bug: top-to-bottom snap places blocks flush (gap=0), so text content of
  // adjacent blocks overlaps visually. Gap should equal one line height (lineGap).

  it('top-to-bottom snap: activates when myTop is near otherBottom (flush), jumps to gap position', () => {
    // Detection: |myTop - otherBottom| < threshold (user drags to be visually adjacent)
    // Snap target: otherBottom + lineGap (correct spacing)
    // target bottom = 80 (y=50, h=30). lineGap=14. snap target = 94.
    // moving.y = 76 → myTop=76, |76-80|=4 < 8 → snaps to y=94
    const target = blk('target', 100, 50, 200, 30);
    const moving = blk('moving', 100, 76, 200, 25);
    const result = snapBlockToOthers(moving, [target], THRESHOLD, LINE_GAP);

    expect(result.snappedIds.has('target'), 'should snap to target').toBe(true);
    expect(result.y).toBe(94); // target.y + target.h + lineGap = 50+30+14 = 94

    const gap = result.y - (target.y + target.height);
    expect(gap).toBe(LINE_GAP);
  });

  it('bottom-to-top snap: activates when myBottom is near otherTop (flush), jumps to gap position', () => {
    // Detection: |myBottom - otherTop| < threshold
    // Snap target: otherTop - lineGap
    // target top = 100 (y=100). lineGap=14. snap target for myBottom = 86.
    // moving.y=78, h=25 → myBottom=103. |103-100|=3 < 8 → snaps.
    // new y = (100-14) - (103-78) = 86 - 25 = 61
    const target = blk('target', 100, 100, 200, 30);
    const moving = blk('moving', 100, 78, 200, 25);
    const result = snapBlockToOthers(moving, [target], THRESHOLD, LINE_GAP);

    expect(result.snappedIds.has('target'), 'should snap to target').toBe(true);
    expect(result.y).toBe(61); // 86 - 25 = 61

    const gap = target.y - (result.y + moving.height);
    expect(gap).toBe(LINE_GAP);
  });

  it('top-to-top snap: no gap (same-edge alignment)', () => {
    // Moving top snaps to target top — no gap added, both tops align exactly.
    // target h=80 → otherBottom=130, otherCenterY=90 — all non-top pairs > 8 away from moving edges.
    const target = blk('target', 100, 50, 200, 80);
    const moving = blk('moving', 300, 55, 150, 25); // myTop=55, otherTop=50, diff=5 < 8
    const result = snapBlockToOthers(moving, [target], THRESHOLD, LINE_GAP);

    expect(result.snappedIds.has('target'), 'should snap').toBe(true);
    expect(result.y).toBe(50); // tops align exactly, no gap
  });

  it('bottom-to-bottom snap: no gap (same-edge alignment)', () => {
    // Moving bottom snaps to target bottom — no gap added.
    // target h=70 so otherBottom=120, otherCenterY=85.
    // moving y=100 h=25 → myBottom=125, myCenterY=112.5, myTop=100.
    // myBottom-otherBottom: |125-120|=5 < 8 → snap. All other pairs > 8 from this.
    // new y = 120 - (125 - 100) = 120 - 25 = 95
    const target = blk('target', 100, 50, 200, 70);
    const moving = blk('moving', 300, 100, 150, 25);
    const result = snapBlockToOthers(moving, [target], THRESHOLD, LINE_GAP);

    expect(result.snappedIds.has('target'), 'should snap').toBe(true);
    expect(result.y).toBe(95); // bottoms align exactly, no gap
  });

  it('no snap when distance exceeds threshold', () => {
    // target bottom=80, top=50. Detection edges: myTop vs otherBottom, myBottom vs otherTop, etc.
    // moving.y=114 → myTop=114, |114-80|=34 > 8. myBottom=139, |139-50|=89 > 8. All > 8.
    // moving x=500 keeps X pairs far from target (right=300) to avoid X snap.
    const target = blk('target', 100, 50, 200, 30);
    const moving = blk('moving', 500, 114, 200, 25);
    const result = snapBlockToOthers(moving, [target], THRESHOLD, LINE_GAP);

    expect(result.snappedIds.size).toBe(0);
    expect(result.y).toBe(114);
  });

  it('excludes self from snap targets', () => {
    const target = blk('self', 100, 50, 200, 30);
    const result = snapBlockToOthers(target, [target], THRESHOLD, LINE_GAP);
    expect(result.snappedIds.size).toBe(0);
  });
});

describe('snapBlockToOthers — horizontal snapping (no gap)', () => {
  it('left-to-right snap: no gap (horizontal edges align)', () => {
    // target right = 300. moving.left = 295. diff = 5 < 8 → snaps to x=300
    const target = blk('target', 100, 50, 200, 30);
    const moving = blk('moving', 295, 50, 150, 30);
    const result = snapBlockToOthers(moving, [target], THRESHOLD, LINE_GAP);

    expect(result.snappedIds.has('target'), 'should snap').toBe(true);
    expect(result.x).toBe(300); // moving.left aligns with target.right, no gap
  });

  it('left-to-left snap: no gap', () => {
    const target = blk('target', 100, 50, 200, 30);
    const moving = blk('moving', 104, 100, 150, 30);
    const result = snapBlockToOthers(moving, [target], THRESHOLD, LINE_GAP);

    expect(result.snappedIds.has('target'), 'should snap').toBe(true);
    expect(result.x).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Bug fixes
// ---------------------------------------------------------------------------

describe('snapBlockToOthers — snappedIds contains only final winner, not intermediate candidates', () => {
  it('only the block that produced the closest Y snap is in snappedIds', () => {
    // A: bottom=80 → snapTarget for myTop = 80+14=94, dist=|88-94|=6
    // B: top=93    → snapTarget for myTop = 93,       dist=|88-93|=5  ← closer, wins
    // Both are far in X so no X snap occurs.
    // Expected: only B in snappedIds (A was superseded).
    const A = blk('A', 500, 50, 200, 30);  // far right, A.bottom=80
    const B = blk('B', 600, 93, 200, 30);  // far right, B.top=93
    const moving = blk('M', 0, 88, 50, 25);
    const result = snapBlockToOthers(moving, [A, B], THRESHOLD, LINE_GAP);

    expect(result.snappedIds.size).toBe(1);
    expect(result.snappedIds.has('B'), 'B is the closer Y target').toBe(true);
    expect(result.snappedIds.has('A'), 'A was superseded — should not be highlighted').toBe(false);
  });
});

describe('snapBlockToOthers — mixed center-to-edge Y pairs do not snap (prevents overlap)', () => {
  it('myCenterY does not snap flush to otherTop (would pull block into overlap)', () => {
    // A: y=50 h=30 (top=50, center=65, bottom=80).
    // Moving B: y=62 h=40 (top=62, centerY=82, bottom=102).
    // Old code: myTop(62)→otherCenterY(65) dist=3 would snap B's top to A's center → overlap.
    // New code: only 5 Y pairs, none of which is myTop→otherCenterY.
    //   myTop(62)→otherTop(50): dist=12>8. myBottom(102)→otherBottom(80): dist=22>8.
    //   myCenterY(82)→otherCenterY(65): dist=17>8. cross-pairs also far. No Y snap.
    // Blocks are far apart in X to avoid X snap interfering.
    const A = blk('A', 500, 50, 200, 30); // far right
    const moving = blk('B', 0, 62, 50, 40);  // far left
    const result = snapBlockToOthers(moving, [A], THRESHOLD, LINE_GAP);

    expect(result.snappedIds.size).toBe(0);
    expect(result.y).toBe(62); // stays put — no bogus center-to-edge snap
  });

  it('myTop does not snap flush to otherCenterY (mixed pair, removed)', () => {
    // A center at y=65. Moving top at y=68 (dist=3 from center).
    // Old code would snap myTop flush to otherCenterY → B overlaps A.
    // New code only checks 5 Y pairs — myTop→otherCenterY is not one of them.
    const A = blk('A', 500, 50, 200, 30); // far in X to avoid X snap; centerY=65
    const moving = blk('B', 0, 68, 50, 20); // myTop=68, dist=3 from A.centerY
    const result = snapBlockToOthers(moving, [A], THRESHOLD, LINE_GAP);

    // myTop(68)→otherBottom(80)+14=94: dist=26. myBottom(88)→otherTop(50)-14=36: dist=52.
    // myTop(68)→otherTop(50): dist=18. myBottom(88)→otherBottom(80): dist=8 (not <8). No snap.
    expect(result.snappedIds.size).toBe(0);
    expect(result.y).toBe(68);
  });
});

describe('snapBlockToOthers — per-block lineGap for cross-edge snapping', () => {
  it('top-to-bottom snap uses the target block lineGap, not moving block lineGap', () => {
    // Target block (A) has a larger font → larger lineGap=20.
    // Moving block has lineGap=14 (the parameter).
    // When myTop snaps near A.bottom, gap should be 20 (A's lineGap), not 14.
    const A: SnapBlock = { id: 'A', x: 100, y: 50, width: 200, height: 30, lineGap: 20 };
    // A.bottom = 80. Detection: |myTop - 80|. Snap target = 80 + 20 = 100.
    // moving.y=77 → myTop=77, |77-80|=3 < 8 → snaps to y=100.
    const moving = blk('M', 100, 77, 200, 25);
    const result = snapBlockToOthers(moving, [A], THRESHOLD, LINE_GAP /* =14 */);

    expect(result.snappedIds.has('A')).toBe(true);
    expect(result.y).toBe(100); // gap = 100-80 = 20 = A.lineGap
    const gap = result.y - (A.y + A.height);
    expect(gap).toBe(20);
  });

  it('bottom-to-top snap uses the moving block lineGap (parameter), not target lineGap', () => {
    // Target (A) has lineGap=20, but when moving block goes ABOVE it, the moving block's
    // lineGap=14 (parameter) determines spacing (moving block is the upper one).
    const A: SnapBlock = { id: 'A', x: 100, y: 100, width: 200, height: 30, lineGap: 20 };
    // A.top = 100. Detection: |myBottom - 100|. Snap target = 100 - 14 = 86.
    // moving: y=78, h=25 → myBottom=103. |103-100|=3 < 8 → snaps. newY=86-25=61.
    const moving = blk('M', 100, 78, 200, 25);
    const result = snapBlockToOthers(moving, [A], THRESHOLD, LINE_GAP /* =14 */);

    expect(result.snappedIds.has('A')).toBe(true);
    expect(result.y).toBe(61);
    const gap = A.y - (result.y + moving.height);
    expect(gap).toBe(14); // moving block's lineGap, not A's
  });
});

// ---------------------------------------------------------------------------
// snapEdgeToBlockBounds — horizontal resize edge snapping
// ---------------------------------------------------------------------------

describe('snapEdgeToBlockBounds — resize horizontal edge snapping', () => {
  const THRESHOLD = 8;
  const blocks = [
    { id: 'A', x: 100, width: 200 }, // left=100, right=300
    { id: 'B', x: 350, width: 150 }, // left=350, right=500
  ];

  it('snaps E edge to other block left bound when within threshold', () => {
    const { value, snappedId } = snapEdgeToBlockBounds(97, blocks, THRESHOLD);
    expect(value).toBe(100);
    expect(snappedId).toBe('A');
  });

  it('snaps E edge to other block right bound when within threshold', () => {
    const { value, snappedId } = snapEdgeToBlockBounds(303, blocks, THRESHOLD);
    expect(value).toBe(300);
    expect(snappedId).toBe('A');
  });

  it('snaps W edge to other block left bound when within threshold', () => {
    const { value, snappedId } = snapEdgeToBlockBounds(353, blocks, THRESHOLD);
    expect(value).toBe(350);
    expect(snappedId).toBe('B');
  });

  it('does not snap when all distances exceed threshold', () => {
    const { value, snappedId } = snapEdgeToBlockBounds(50, blocks, THRESHOLD);
    expect(value).toBe(50);
    expect(snappedId).toBeNull();
  });

  it('threshold is exclusive — exact threshold distance does not snap', () => {
    // dist = 8 exactly (100 - 92 = 8) — NOT < 8 → no snap
    const { value, snappedId } = snapEdgeToBlockBounds(92, blocks, THRESHOLD);
    expect(snappedId).toBeNull();
    expect(value).toBe(92);
  });

  it('best-match-wins: picks closer of two candidates within threshold', () => {
    // edge=299: dist to A.right(300)=1, dist to B.left(350)=51 → A wins
    const { value, snappedId } = snapEdgeToBlockBounds(299, blocks, THRESHOLD);
    expect(value).toBe(300);
    expect(snappedId).toBe('A');
  });

  it('picks B when B is closer than A', () => {
    // edge=347: dist to B.left(350)=3, dist to A.right(300)=47 → B wins
    const { value, snappedId } = snapEdgeToBlockBounds(347, blocks, THRESHOLD);
    expect(value).toBe(350);
    expect(snappedId).toBe('B');
  });

  it('returns original value when others list is empty', () => {
    const { value, snappedId } = snapEdgeToBlockBounds(200, [], THRESHOLD);
    expect(value).toBe(200);
    expect(snappedId).toBeNull();
  });

  it('snaps to exact match (distance 0)', () => {
    const { value, snappedId } = snapEdgeToBlockBounds(300, blocks, THRESHOLD);
    expect(value).toBe(300);
    expect(snappedId).toBe('A');
  });

  it('works with a single block having both bounds as candidates', () => {
    const single = [{ id: 'X', x: 200, width: 100 }]; // left=200, right=300
    // edge near left
    expect(snapEdgeToBlockBounds(203, single, THRESHOLD).value).toBe(200);
    // edge near right
    expect(snapEdgeToBlockBounds(296, single, THRESHOLD).value).toBe(300);
  });
});
