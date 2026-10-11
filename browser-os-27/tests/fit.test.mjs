import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortestFit } from '../src/core/utils.js';

/**
 * The rule `watchToolbarOverflow` depends on, tested without a browser: given a list of
 * things a toolbar is allowed to give up, in the order it is allowed to give them up, it
 * must find the *shortest prefix* the bar actually needs — no more, and no less.
 *
 * `widthAfter(k)` below plays the part of a real bar: hiding more of it can only make it
 * narrower, which is what makes the search valid.
 */

const bar = (widths, client) => {
  const total = widths.reduce((a, b) => a + b, 0);
  return (k) => total - widths.slice(0, k).reduce((a, b) => a + b, 0) <= client;
};

test('shortestFit: a bar that already fits gives up nothing', () => {
  const fitsAt = bar([40, 40, 40], 200);
  assert.deepEqual(shortestFit(3, fitsAt), { cuts: 0, fits: true });
});

test('shortestFit: it stops at the first amount that fits, not at the end of the list', () => {
  /* 40px of bar, 120px of controls in the declared order 50, 40, 30: 80px has to go.
     Two items is enough; a watcher that cut "until the bar fits, then kept going" would
     return three. */
  const fitsAt = bar([50, 40, 30], 40);
  assert.deepEqual(shortestFit(3, fitsAt), { cuts: 2, fits: true });
});

test('shortestFit: when even giving up everything is not enough, it gives up everything', () => {
  /* A 120px bar with only 10px of room: even an empty bar is too wide, because the part
     that is not in the ladder (the fixed controls at either end) is what does not fit. */
  const fitsAt = wobblingBar(10, 120, 70, 30, 20);
  assert.deepEqual(shortestFit(3, fitsAt), { cuts: 3, fits: false });
});

test('shortestFit: an empty list is nothing to give up', () => {
  assert.deepEqual(shortestFit(0, () => false), { cuts: 0, fits: false });
});

/* Files' breadcrumb is the one fold that *adds* something when it starts: the `…` that
   admits a segment is missing is wider than the shortest segment it replaces. The search
   is still valid because the marker appears once and stays — past the first cut, hiding
   more is still strictly less width. This is that shape, written out. */
test('shortestFit: a fold marker that costs width at the first cut still resolves', () => {
  const segments = [30, 45, 45, 45];
  const marker = 34;
  const widthAfter = (k) => {
    const gone = segments.slice(0, k).reduce((a, b) => a + b, 0);
    return 300 - gone + (k > 0 ? marker : 0);
  };
  const client = 260;
  /* k=0 → 300, k=1 → 304 (the marker costs more than the 30px segment): still no fit.
     k=2 → 259 fits. The answer is 2, and it is the smallest answer. */
  assert.deepEqual(shortestFit(4, (k) => widthAfter(k) <= client), { cuts: 2, fits: true });
});

/* The shape a *growable* control makes. Hiding a control can free up space that a flexible
   neighbour then expands into, so "hide more, get a narrower bar" stops being true. Here
   giving up the whole list is worse than giving up the first item — and the old search
   answered "give up everything" because the last prefix did not fit. */
const wobblingBar = (client, ...widthAfter) => (k) => widthAfter[k] <= client;

test('shortestFit: a bar that gets wider at the deeper cut keeps the cut that worked', () => {
  /* two things may be given up. k=1 fits, k=2 (giving up both) does not — the bar grew. */
  const fitsAt = wobblingBar(300, 320, 280, 340);
  assert.deepEqual(shortestFit(2, fitsAt), { cuts: 1, fits: true });
});

test('shortestFit: an answer that does not actually fit is repaired, not shipped', () => {
  /* The binary search is only as good as its assumption. When the assumption is broken the
     answer must still be checked: nothing may stay hidden that the bar did not need hidden,
     and the level it lands on must be one the bar really fits at. */
  const fitsAt = wobblingBar(300, 400, 300, 380, 360);
  assert.equal(shortestFit(3, fitsAt).cuts, 1);
  assert.ok(fitsAt(shortestFit(3, fitsAt).cuts), 'the chosen prefix must be one that fits');
});

test('shortestFit: a wobble in the middle of the list is walked back over and then searched', () => {
  /* k=3 fits, k=4 (the whole list) does not. The walk back lands on 3; the scan the broken
     assumption authorises then finds that 1 was enough all along. */
  const fitsAt = wobblingBar(300, 400, 300, 380, 300, 400);
  assert.deepEqual(shortestFit(4, fitsAt), { cuts: 1, fits: true });
});

test('shortestFit: what it deliberately cannot see', () => {
  /* A prefix that fits, followed by prefixes that do not, is invisible to any search that
     never probes it: here 1 fits and 2..8 do not, and the answer is 9. Finding 1 costs a
     probe of 1 — a linear scan — which is exactly what a bar made of fixed-width controls
     must not be made to pay. This is the accepted trade, written down as a test so it is a
     decision and not an oversight. */
  const fitsAt = wobblingBar(300, 400, 200, 400, 400, 400, 400, 400, 400, 400, 200, 200, 200, 200, 200, 200, 200, 200);
  assert.equal(shortestFit(16, fitsAt).cuts, 9);
});

test('shortestFit: a monotone bar is never made to scan', () => {
  /* The verification has to stay cheap for the bars that behave. A monotone predicate is
     never contradicted by its own probes, so no scan is ever paid for. */
  let probes = 0;
  const fitsAt = (k) => { probes++; return bar(new Array(200).fill(1), 100)(k); };
  assert.equal(shortestFit(200, fitsAt).cuts, 100);
  assert.ok(probes <= 12, `200 items must not cost ${probes} layout reads`);
});

test('shortestFit: a long list costs a handful of probes, not one per item', () => {
  /* The guard against somebody putting a 200-item group in a toolbar: the number of layout
     reads must not grow with the list. */
  let probes = 0;
  const fitsAt = (k) => { probes++; return bar(new Array(1000).fill(1), 500)(k); };
  const { cuts: k } = shortestFit(1000, fitsAt);
  assert.equal(k, 500);
  assert.ok(probes <= 14, `1000 items must not cost ${probes} layout reads`);
});

/* A47. `cuts` is a fact about the declaration; `fits` is a fact about the layout. A caller
   that reports only the first describes a ladder it walked, not a bar that worked — which is
   how "collapsed=7" at a window's minimum width got read as a description of the layout. */
test('shortestFit: running out of things to give up is its own answer, not a number that looks like success', () => {
  /* Monotone, so nothing about the search is unusual — and still no prefix fits, because
     90px of the bar is not in the ladder at all. `cuts: 3` alone reads like a bar that
     solved its problem; `fits: false` is the part a caller has to report. */
  const fitsAt = wobblingBar(40, 130, 90, 60, 50);
  const r = shortestFit(3, fitsAt);
  assert.equal(r.cuts, 3);
  assert.equal(r.fits, false, 'giving up everything did not make it fit, and the answer has to say so');
});

test('shortestFit: a bar that gave up everything and still does not fit is not repaired into a fit', () => {
  /* The wobble case, but with no prefix that fits at all: the repair must not invent one. */
  const fitsAt = wobblingBar(300, 400, 380, 370, 360, 350);
  assert.deepEqual(shortestFit(4, fitsAt), { cuts: 4, fits: false });
});
