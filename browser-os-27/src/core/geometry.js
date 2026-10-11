/**
 * Pure window-geometry maths for the window manager.
 *
 * Everything here is a plain function of plain numbers so it can be unit-tested in Node
 * without a DOM: snap targets, snap zones, resize from any of the eight handles, and
 * keyboard nudging.
 */

export const SNAP_EDGE = 14;
export const KEEP_VISIBLE = 80;   // a dragged window must keep at least this much on screen
export const TITLEBAR_KEEP = 28;  // a dragged window must keep this much title bar reachable

/**
 * Every zone a window can be tiled into, in the order a menu should show them.
 *
 * The geometry was already reachable by dragging a window to a screen edge or by
 * Alt+arrows, which meant it was discoverable only by accident. This list is the single
 * source the window menu and the drag preview both use, so what the menu offers and what
 * a drag does cannot disagree.
 */
export const ZONES = [
  { zone: 'left', label: 'Left half', glyph: '◧', hint: 'Alt+←' },
  { zone: 'right', label: 'Right half', glyph: '◨', hint: 'Alt+→' },
  { zone: 'top', label: 'Top half', glyph: '⬒' },
  { zone: 'bottom', label: 'Bottom half', glyph: '⬓' },
  { zone: 'tl', label: 'Top-left quarter', glyph: '◤' },
  { zone: 'tr', label: 'Top-right quarter', glyph: '◥' },
  { zone: 'bl', label: 'Bottom-left quarter', glyph: '◣' },
  { zone: 'br', label: 'Bottom-right quarter', glyph: '◢' },
  { zone: 'max', label: 'Full screen', glyph: '▣', hint: 'Alt+↑' },
];

export const zoneLabel = (key) => ZONES.find((z) => z.zone === key)?.label || 'Snap';

export function zoneRect(area, zone) {
  const w = Math.floor(area.w / 2);
  const h = Math.floor(area.h / 2);
  switch (zone) {
    case 'max': return { x: 0, y: 0, w: area.w, h: area.h };
    case 'left': return { x: 0, y: 0, w, h: area.h };
    case 'right': return { x: area.w - w, y: 0, w, h: area.h };
    case 'top': return { x: 0, y: 0, w: area.w, h };
    case 'bottom': return { x: 0, y: area.h - h, w: area.w, h };
    case 'tl': return { x: 0, y: 0, w, h };
    case 'tr': return { x: area.w - w, y: 0, w, h };
    case 'bl': return { x: 0, y: area.h - h, w, h };
    case 'br': return { x: area.w - w, y: area.h - h, w, h };
    default: return null;
  }
}

/** Which snap zone (if any) a dragged pointer is hovering, or null. */
export function snapTarget(area, px, py, edge = SNAP_EDGE) {
  const atLeft = px <= edge;
  const atRight = px >= area.w - edge;
  const atTop = py <= edge;
  const atBottom = py >= area.h - edge;

  if (atLeft && atTop) return { key: 'tl', ...zoneRect(area, 'tl') };
  if (atRight && atTop) return { key: 'tr', ...zoneRect(area, 'tr') };
  if (atLeft && atBottom) return { key: 'bl', ...zoneRect(area, 'bl') };
  if (atRight && atBottom) return { key: 'br', ...zoneRect(area, 'br') };
  if (atTop) return { key: 'max', maximize: true, ...zoneRect(area, 'max') };
  if (atLeft) return { key: 'left', ...zoneRect(area, 'left') };
  if (atRight) return { key: 'right', ...zoneRect(area, 'right') };
  return null;
}

/** Resize a window from one of the eight handles. `dir` is 'n'|'s'|'e'|'w' plus corners. */
export function resizeRect(start, dir, dx, dy, { minWidth, minHeight, area }) {
  let { x, y, w, h } = start;
  if (dir.includes('e')) w = Math.min(Math.max(start.w + dx, minWidth), area.w - x);
  if (dir.includes('s')) h = Math.min(Math.max(start.h + dy, minHeight), area.h - y);
  if (dir.includes('w')) {
    w = Math.min(Math.max(start.w - dx, minWidth), start.x + start.w);
    x = start.x + start.w - w;
  }
  if (dir.includes('n')) {
    h = Math.min(Math.max(start.h - dy, minHeight), start.y + start.h);
    y = start.y + start.h - h;
  }
  return { x, y, w, h };
}

/** Move a window by a delta while keeping it reachable (title bar on screen). */
export function moveRect(rect, dx, dy, area) {
  return {
    ...rect,
    x: Math.min(Math.max(rect.x + dx, -rect.w + KEEP_VISIBLE), Math.max(0, area.w - KEEP_VISIBLE)),
    y: Math.min(Math.max(rect.y + dy, 0), Math.max(0, area.h - TITLEBAR_KEEP)),
  };
}

/** The quarter of the screen a window's centre currently sits in ('tl' | 'tr' | 'bl' | 'br'). */
export function nearestQuarter(rect, area) {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  return `${cy < area.h / 2 ? 't' : 'b'}${cx < area.w / 2 ? 'l' : 'r'}`;
}

/**
 * Where a newly opened window should land: below the desktop icon grid when there is room,
 * cascading down-right from there so a stack of windows stays readable.
 */
export function spawnOrigin(area, width, height, iconBottom = 0, index = 0) {
  const offset = (index % 7) * 26;
  const margin = 12;
  const reserved = iconBottom > 0 && area.h - (iconBottom + margin) >= height ? iconBottom + margin : margin;
  return {
    x: Math.min(Math.max(48 + offset, 0), Math.max(0, area.w - width)),
    y: Math.min(Math.max(reserved + offset * 0.8, 0), Math.max(0, area.h - height)),
  };
}
