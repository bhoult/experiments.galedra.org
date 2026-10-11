import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/core/store.js';
import { importLimits, MAX_IMPORT_BYTES, MAX_IMPORT_BATCH_BYTES, STORAGE_RESERVE_BYTES } from '../src/core/utils.js';

/**
 * A localStorage stand-in with a real quota: it counts key + value characters and throws
 * the way browsers do when the total would pass the limit. Keys are exposed as own
 * properties, because `Store.usage()` enumerates localStorage exactly like a browser does.
 */
function quotaStorage(limit) {
  const data = new Map();
  const total = () => {
    let n = 0;
    for (const [k, v] of data) n += k.length + v.length;
    return n;
  };
  const target = {};
  const api = {
    setItem(k, v) {
      const value = String(v);
      if (total() + k.length + value.length > limit) throw new Error('QuotaExceededError: exceeded quota');
      data.set(k, value);
      target[k] = value;
    },
    getItem(k) { return data.has(k) ? data.get(k) : null; },
    removeItem(k) { data.delete(k); delete target[k]; },
  };
  return new Proxy(target, {
    get: (t, p) => (p in api ? api[p] : t[p]),
    ownKeys: (t) => Reflect.ownKeys(t),
  });
}

const withStorage = (storage, fn) => {
  const had = 'localStorage' in globalThis;
  const previous = globalThis.localStorage;
  globalThis.localStorage = storage;
  try { return fn(); } finally {
    if (had) globalThis.localStorage = previous; else delete globalThis.localStorage;
  }
};

test('capacity() measures the quota a browser would actually allow', () => {
  const LIMIT = 6 * 1024 * 1024;
  withStorage(quotaStorage(LIMIT), () => {
    const store = new Store('quota-test');
    assert.equal(store.available, true);

    const cap = store.capacity();
    assert.ok(cap > 4 * 1024 * 1024, `the probe should find most of a 6 MB quota, got ${cap}`);
    assert.ok(cap <= LIMIT, `the probe must not claim more than the quota (${cap} > ${LIMIT})`);

    const free = store.headroom();
    assert.ok(free > 3 * 1024 * 1024 && free <= cap, `free space must sit inside the capacity, got ${free}`);

    // Usage moves; the measured ceiling does not.
    assert.equal(store.save('blob', 'y'.repeat(2 * 1024 * 1024)), true);
    const after = store.headroom();
    assert.ok(after < free - 1024 * 1024, `writing 2 MB must shrink the free space (${free} → ${after})`);
    assert.equal(store.capacity(), cap, 'the measured ceiling is cached, not re-probed');
  });
});

test('a tiny quota is measured as tiny, so imports are refused honestly', () => {
  const LIMIT = 400 * 1024;
  withStorage(quotaStorage(LIMIT), () => {
    const store = new Store('tiny-quota');
    const cap = store.capacity();
    assert.ok(cap <= LIMIT, `capacity must not exceed the quota (${cap} > ${LIMIT})`);
    assert.ok(cap < 2 * 1024 * 1024, `a 400 KB quota must not be reported as megabytes (${cap})`);
    const limits = importLimits(store);
    assert.ok(limits.batch < MAX_IMPORT_BATCH_BYTES, 'the import budget must shrink to what fits');
    assert.ok(limits.perFile < MAX_IMPORT_BYTES, 'the per-file limit must shrink too');
  });
});

test('in-memory storage reports unbounded headroom instead of a fake quota', () => {
  const had = 'localStorage' in globalThis;
  const previous = globalThis.localStorage;
  delete globalThis.localStorage;
  try {
    const store = new Store('no-storage');
    assert.equal(store.available, false, 'with no localStorage this Store is in-memory');
    assert.equal(store.capacity(), Infinity);
    assert.equal(store.headroom(), Infinity);
    const limits = importLimits(store);
    assert.deepEqual(limits, { perFile: MAX_IMPORT_BYTES, batch: MAX_IMPORT_BATCH_BYTES, free: Infinity },
      'with no measurable quota the documented constants apply');
  } finally {
    if (had) globalThis.localStorage = previous;
  }
});

test('a quota refusal throws away the stale ceiling and the next answer is measured again', () => {
  const LIMIT = 6 * 1024 * 1024;
  withStorage(quotaStorage(LIMIT), () => {
    const store = new Store('reprobe');
    const first = store.capacity();
    assert.ok(first > 4 * 1024 * 1024, `the first probe should find most of a 6 MB quota, got ${first}`);

    /* Another app on the same origin eats most of the quota. `usage()` cannot see it —
       it is not our namespace — and the cached ceiling cannot either. This is the case
       that made the measured number a lie. */
    localStorage.setItem('someone-elses-app', 'x'.repeat(4 * 1024 * 1024));
    assert.equal(store.capacity(), first, 'until something proves it wrong, the ceiling is cached');
    assert.ok(store.headroom() > 4 * 1024 * 1024, 'so the free space it reports is a lie');

    assert.equal(store.save('mine', 'z'.repeat(3 * 1024 * 1024)), false, 'and the write that believed it is refused');
    assert.equal(store.reprobes, 1, 'a quota-shaped refusal invalidates the measurement');

    const free = store.headroom();
    assert.ok(free < 2.5 * 1024 * 1024, `the re-probe must report the space that is really free, got ${free}`);
    assert.ok(free > 1024 * 1024, `…and it must still be a real measurement, not zero (${free})`);
    assert.ok(importLimits(store).batch < 2.5 * 1024 * 1024, 'imports shrink to the space that is really free');

    /* Rate limited: a full disk that keeps being pushed at must not re-probe per write. */
    assert.equal(store.save('again', 'z'.repeat(3 * 1024 * 1024)), false);
    assert.equal(store.reprobes, 1, 'the re-probe is rate-limited, not per failed write');
  });
});

test('a failure that is not about the quota leaves the measurement alone', () => {
  withStorage(quotaStorage(4 * 1024 * 1024), () => {
    const store = new Store('not-quota');
    const cap = store.capacity();
    const circular = {};
    circular.self = circular;
    assert.equal(store.save('bad', circular), false, 'a value that cannot be serialised fails for a different reason');
    assert.equal(store.failures, 1);
    assert.equal(store.reprobes, 0, 'a serialisation error says nothing about the quota');
    assert.equal(store.capacity(), cap);
  });
});

test('importLimits: constants are ceilings, measured headroom is the real limit', () => {
  const fake = (free) => ({ headroom: () => free });

  assert.deepEqual(importLimits(null), { perFile: MAX_IMPORT_BYTES, batch: MAX_IMPORT_BATCH_BYTES, free: Infinity });
  assert.deepEqual(importLimits({}), { perFile: MAX_IMPORT_BYTES, batch: MAX_IMPORT_BATCH_BYTES, free: Infinity });

  const roomy = importLimits(fake(200 * 1024 * 1024));
  assert.equal(roomy.perFile, MAX_IMPORT_BYTES, 'a huge quota must not raise the documented limits');
  assert.equal(roomy.batch, MAX_IMPORT_BATCH_BYTES);

  const tight = importLimits(fake(1024 * 1024));
  assert.equal(tight.perFile, 1024 * 1024 - STORAGE_RESERVE_BYTES, 'the limit must leave room for the OS own keys');
  assert.equal(tight.batch, 1024 * 1024 - STORAGE_RESERVE_BYTES);

  const full = importLimits(fake(30 * 1024));
  assert.equal(full.batch, 0, 'less free than the reserve means nothing can be imported');
});
