import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoneRect, snapTarget, resizeRect, moveRect, nearestQuarter, spawnOrigin, ZONES, zoneLabel, KEEP_VISIBLE, TITLEBAR_KEEP } from '../src/core/geometry.js';

const AREA = { w: 1000, h: 600 };

test('zoneRect produces halves, quarters and maximise that tile the screen exactly', () => {
  const max = zoneRect(AREA, 'max');
  assert.deepEqual(max, { x: 0, y: 0, w: 1000, h: 600 });

  const left = zoneRect(AREA, 'left');
  const right = zoneRect(AREA, 'right');
  assert.equal(left.w, 500);
  assert.equal(right.x, 500);
  assert.equal(left.w + right.w, AREA.w, 'left + right must cover the screen');

  const quarters = ['tl', 'tr', 'bl', 'br'].map((z) => zoneRect(AREA, z));
  const area = quarters.reduce((sum, q) => sum + q.w * q.h, 0);
  assert.equal(area, AREA.w * AREA.h, 'the four quarters must cover the screen');
  assert.equal(new Set(quarters.map((q) => `${q.x},${q.y}`)).size, 4, 'quarters must not overlap');
  assert.equal(zoneRect(AREA, 'nonsense'), null);
});

test('the top and bottom halves tile the screen too', () => {
  const top = zoneRect(AREA, 'top');
  const bottom = zoneRect(AREA, 'bottom');
  assert.deepEqual(top, { x: 0, y: 0, w: 1000, h: 300 });
  assert.deepEqual(bottom, { x: 0, y: 300, w: 1000, h: 300 });
  assert.equal(top.h + bottom.h, AREA.h);
});

test('the zone menu and the geometry describe exactly the same zones', () => {
  /* The window menu builds itself from ZONES and the drag preview labels itself from
     zoneLabel(); if either named a zone zoneRect does not implement, a menu entry would
     silently do nothing. */
  for (const z of ZONES) {
    const rect = zoneRect(AREA, z.zone);
    assert.ok(rect, `ZONES advertises "${z.zone}", which zoneRect does not implement`);
    assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= AREA.w && rect.y + rect.h <= AREA.h,
      `"${z.zone}" must stay inside the desktop`);
    assert.ok(z.label && z.label.length > 3, `"${z.zone}" needs a label a person can read`);
    assert.equal(zoneLabel(z.zone), z.label);
  }
  assert.equal(new Set(ZONES.map((z) => z.zone)).size, ZONES.length, 'no duplicate zones');
  assert.equal(zoneLabel('nonsense'), 'Snap', 'an unknown zone must still say something honest');
});

test('snapTarget picks corners before edges, and nothing in the middle', () => {
  assert.equal(snapTarget(AREA, 5, 5).key, 'tl');
  assert.equal(snapTarget(AREA, 995, 5).key, 'tr');
  assert.equal(snapTarget(AREA, 5, 595).key, 'bl');
  assert.equal(snapTarget(AREA, 995, 595).key, 'br');
  assert.equal(snapTarget(AREA, 500, 4).key, 'max');
  assert.equal(snapTarget(AREA, 4, 300).key, 'left');
  assert.equal(snapTarget(AREA, 999, 300).key, 'right');
  assert.equal(snapTarget(AREA, 500, 300), null);
  // The edge band is exactly SNAP_EDGE wide.
  assert.equal(snapTarget(AREA, 20, 300), null);
  assert.equal(snapTarget(AREA, 14, 300).key, 'left');
});

test('resizeRect respects minimum sizes from every handle', () => {
  const start = { x: 100, y: 100, w: 400, h: 300 };
  const limits = { minWidth: 200, minHeight: 150, area: AREA };

  // Dragging the east edge left shrinks the width but keeps the origin.
  assert.deepEqual(resizeRect(start, 'e', -50, 0, limits), { x: 100, y: 100, w: 350, h: 300 });
  // It cannot shrink past the minimum.
  assert.equal(resizeRect(start, 'e', -1000, 0, limits).w, 200);
  // Dragging the west edge moves the origin by exactly the amount the width changes.
  const west = resizeRect(start, 'w', 60, 0, limits);
  assert.deepEqual(west, { x: 160, y: 100, w: 340, h: 300 });
  assert.equal(west.x + west.w, start.x + start.w, 'the east edge must not move');
  // The north handle keeps the bottom edge fixed.
  const north = resizeRect(start, 'n', 0, 40, limits);
  assert.equal(north.y + north.h, start.y + start.h);
  // Growth is capped by the desktop area.
  const east = resizeRect(start, 'e', 900, 0, limits);
  assert.equal(east.w, AREA.w - start.x);
  const south = resizeRect(start, 's', 0, 900, limits);
  assert.equal(south.h, AREA.h - start.y);
});

test('moveRect keeps the title bar reachable and part of the window on screen', () => {
  const rect = { x: 100, y: 100, w: 400, h: 300 };
  assert.deepEqual(moveRect(rect, 10, -10, AREA), { x: 110, y: 90, w: 400, h: 300 });

  const pushedUp = moveRect(rect, 0, -5000, AREA);
  assert.equal(pushedUp.y, 0, 'a window cannot be dragged above the desktop');

  const pushedDown = moveRect(rect, 0, 5000, AREA);
  assert.equal(pushedDown.y, AREA.h - TITLEBAR_KEEP, 'the title bar must stay reachable');

  const pushedLeft = moveRect(rect, -5000, 0, AREA);
  assert.equal(pushedLeft.x, -rect.w + KEEP_VISIBLE, 'at least 80px must stay visible');

  const pushedRight = moveRect(rect, 5000, 0, AREA);
  assert.equal(pushedRight.x, AREA.w - KEEP_VISIBLE);
});

test('nearestQuarter reports the quarter a window is sitting in', () => {
  assert.equal(nearestQuarter({ x: 0, y: 0, w: 100, h: 100 }, AREA), 'tl');
  assert.equal(nearestQuarter({ x: 900, y: 0, w: 100, h: 100 }, AREA), 'tr');
  assert.equal(nearestQuarter({ x: 0, y: 500, w: 100, h: 100 }, AREA), 'bl');
  assert.equal(nearestQuarter({ x: 900, y: 500, w: 100, h: 100 }, AREA), 'br');
  assert.equal(nearestQuarter({ x: 300, y: 100, w: 200, h: 200 }, AREA), 'tl', 'the centre decides, not the top-left corner');
});

test('spawnOrigin keeps new windows clear of the desktop icon grid', () => {
  const free = spawnOrigin(AREA, 640, 420, 0, 0);
  assert.deepEqual(free, { x: 48, y: 12 });

  const tall = { w: 1000, h: 800 };
  const belowIcons = spawnOrigin(tall, 640, 420, 200, 0);
  assert.equal(belowIcons.y, 212, 'new windows should land below the icons when there is room');
  assert.ok(belowIcons.y + 420 <= tall.h);

  // Cascading windows step down-right but never leave the desktop.
  const last = spawnOrigin(tall, 640, 420, 200, 6);
  assert.ok(last.x + 640 <= tall.w && last.y + 420 <= tall.h);
  assert.equal(last.x, 48 + 6 * 26);

  // When the window would not fit below the icons, fall back to the top margin.
  const cramped = spawnOrigin({ w: 1000, h: 400 }, 640, 380, 200, 0);
  assert.equal(cramped.y, 12);
});
