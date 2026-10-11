import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VirtualFS } from '../src/core/fs.js';
import { EventBus } from '../src/core/eventbus.js';
import { Store } from '../src/core/store.js';

const make = () => {
  const bus = new EventBus();
  const store = new Store('browseros-test');
  const fs = new VirtualFS(bus, store);
  return { bus, store, fs };
};

test('default tree exists', () => {
  const { fs } = make();
  assert.equal(fs.getNode('/').type, 'dir');
  assert.equal(fs.stat('~/Desktop/welcome.txt').type, 'file');
  assert.match(fs.read('/etc/motd'), /Browser OS/);
});

test('resolve handles ~, .. and .', () => {
  const { fs } = make();
  assert.equal(fs.resolve('~'), '/home/user');
  assert.equal(fs.resolve('~/..'), '/home');
  assert.equal(fs.resolve('~/../..'), '/');
  assert.equal(fs.resolve('Documents/../Documents/notes.md', '/home/user'), '/home/user/Documents/notes.md');
  assert.equal(fs.resolve('/a/../../b'), '/b');
});

test('write, read, list, rm round-trip', () => {
  const { fs } = make();
  fs.write('~/Documents/report.txt', 'hello');
  assert.equal(fs.read('~/Documents/report.txt'), 'hello');
  assert.equal(fs.stat('~/Documents/report.txt').size, 5);
  const names = fs.list('~/Documents').map((e) => e.name);
  assert.ok(names.includes('report.txt') && names.includes('notes.md'));
  fs.rm('~/Documents/report.txt');
  assert.equal(fs.exists('~/Documents/report.txt'), false);
});

test('mkdir is recursive and rm -r clears trees', () => {
  const { fs } = make();
  fs.mkdir('~/a/b/c');
  assert.equal(fs.stat('~/a/b/c').type, 'dir');
  fs.write('~/a/b/c/file.txt', 'x');
  assert.throws(() => fs.rm('~/a'), /not empty/);
  fs.rm('~/a', '/home/user', true);
  assert.equal(fs.exists('~/a'), false);
});

test('append and uniqueName', () => {
  const { fs } = make();
  fs.write('~/log.txt', 'one\n');
  fs.append('~/log.txt', 'two\n');
  assert.equal(fs.read('~/log.txt'), 'one\ntwo\n');
  assert.equal(fs.uniqueName('/home/user', 'log.txt'), 'log-2.txt');
  assert.equal(fs.uniqueName('/home/user', 'nope.txt'), 'nope.txt');
});

test('mv renames and moves; copy duplicates', () => {
  const { fs } = make();
  fs.write('~/a.txt', 'data');
  fs.mv('~/a.txt', '~/b.txt');
  assert.equal(fs.exists('~/a.txt'), false);
  assert.equal(fs.read('~/b.txt'), 'data');
  fs.copy('~/b.txt', '~/Documents');
  assert.equal(fs.read('~/Documents/b.txt'), 'data');
  fs.mkdir('~/tree/sub');
  fs.write('~/tree/sub/deep.txt', 'deep');
  fs.copy('~/tree', '~/copy-of-tree');
  assert.equal(fs.read('~/copy-of-tree/sub/deep.txt'), 'deep');
  assert.throws(() => fs.mv('~/tree', '~/tree/sub'), /into itself/);
});

test('fs:change events fire', () => {
  const { bus, fs } = make();
  const seen = [];
  bus.on('fs:change', ({ path }) => seen.push(path));
  fs.write('~/x.txt', '1');
  fs.rm('~/x.txt');
  assert.deepEqual(seen, ['/home/user/x.txt', '/home/user/x.txt']);
});

test('tree renders nested output', () => {
  const { fs } = make();
  fs.mkdir('~/Documents/sub');
  fs.write('~/Documents/sub/inner.txt', '');
  const out = fs.tree('~/Documents');
  assert.match(out, /Documents\//);
  assert.match(out, /sub\//);
  assert.match(out, /inner\.txt/);
});

test('reset restores factory files', () => {
  const { fs } = make();
  fs.rm('~', '/home', true);
  assert.equal(fs.exists('~/Desktop/welcome.txt'), false);
  fs.reset();
  assert.equal(fs.exists('~/Desktop/welcome.txt'), true);
});

test('store falls back to memory when localStorage is missing', () => {
  const store = new Store('browseros-test');
  store.save('k', { a: 1 });
  assert.deepEqual(store.load('k'), { a: 1 });
  store.remove('k');
  assert.equal(store.load('k', null), null);
});

/* ---------- additions from polish iteration 01 ---------- */

/** Minimal localStorage stand-in so quota failures can be exercised in Node. */
function fakeLocalStorage(throwOnKey) {
  const data = {};
  return {
    setItem(k, v) {
      if (k === throwOnKey) throw new Error('QuotaExceededError: storage is full');
      data[k] = String(v);
    },
    getItem(k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    removeItem(k) { delete data[k]; },
  };
}

test('list() reports how many entries a directory holds', () => {
  const { fs } = make();
  fs.mkdir('~/stuff/deep');
  fs.write('~/stuff/a.txt', 'a');
  const byName = Object.fromEntries(fs.list('/home/user').map((e) => [e.name, e]));
  assert.equal(byName.stuff.children, 2);
  assert.equal(byName.Documents.children, 1);
  assert.equal(byName.Pictures.children, 0);
  assert.equal(byName['Desktop'].type, 'dir');
});

test('write refuses to create a nameless file at /', () => {
  const { fs } = make();
  assert.throws(() => fs.write('/', 'nope'), /cannot write to \//);
  assert.throws(() => fs.write('~/../..', 'nope'), /cannot write to \//);
  assert.throws(() => fs.write('~/Documents', 'nope'), /is a directory/);
});

test('mv understands a trailing slash and refuses to bury a directory under a file', () => {
  const { fs } = make();
  fs.write('~/a.txt', 'data');
  fs.mv('~/a.txt', 'newdir/');
  assert.equal(fs.read('~/newdir/a.txt'), 'data');
  assert.equal(fs.exists('~/a.txt'), false);

  fs.write('~/blocker.txt', 'x');
  assert.throws(() => fs.mv('~/newdir', '~/blocker.txt'), /onto a file/);
  assert.equal(fs.exists('~/blocker.txt'), true);
  assert.equal(fs.exists('~/newdir'), true);

  fs.mkdir('~/other');
  assert.throws(() => fs.mv('~/a.txt', '~/other/'), /no such file/);
});

test('counts() is cached and invalidated by mutations', () => {
  const { fs } = make();
  const before = fs.counts();
  assert.equal(before, fs.counts(), 'second call should return the cached snapshot');
  assert.ok(before.files >= 4);
  fs.write('~/extra.txt', '12345');
  const after = fs.counts();
  assert.equal(after.files, before.files + 1);
  assert.equal(after.bytes, before.bytes + 5);
  fs.reset();
  assert.deepEqual(fs.counts().files, fs.counts().files);
  assert.ok(fs.counts().files < after.files);
});

test('a failed localStorage write is reported and kept readable for the session', () => {
  const hadLocalStorage = 'localStorage' in globalThis;
  const previous = globalThis.localStorage;
  globalThis.localStorage = fakeLocalStorage('browseros-test.fs');
  try {
    const bus = new EventBus();
    const seen = [];
    bus.on('store:error', (e) => seen.push(e));
    const store = new Store('browseros-test', bus);

    assert.equal(store.available, true);
    assert.equal(store.save('fs', { huge: 'png' }), false);
    assert.equal(store.failures, 1);
    assert.match(store.lastError, /QuotaExceededError/);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].key, 'fs');

    // The session keeps working: the value that could not be persisted is still readable.
    assert.deepEqual(store.load('fs'), { huge: 'png' });
    assert.ok(store.usage() > 0);

    // Other keys are unaffected.
    assert.equal(store.save('layout', []), true);
    assert.deepEqual(store.load('layout'), []);
  } finally {
    if (hadLocalStorage) globalThis.localStorage = previous;
    else delete globalThis.localStorage;
  }
});

test('fs keeps working when storage is full and still reports usage', async () => {
  const hadLocalStorage = 'localStorage' in globalThis;
  const previous = globalThis.localStorage;
  globalThis.localStorage = fakeLocalStorage('browseros-test.fs');
  try {
    const bus = new EventBus();
    const errors = [];
    bus.on('store:error', (e) => errors.push(e));
    const store = new Store('browseros-test', bus);
    const fs = new VirtualFS(bus, store);
    fs.write('~/note.txt', 'still works');
    assert.equal(fs.read('~/note.txt'), 'still works');
    await new Promise((r) => setTimeout(r, 320)); // fs persistence is debounced
    assert.equal(store.failures, 1);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].key, 'fs');
    // Reads keep serving the in-memory copy for the rest of the session.
    assert.match(JSON.stringify(store.load('fs')), /still works/);
  } finally {
    if (hadLocalStorage) globalThis.localStorage = previous;
    else delete globalThis.localStorage;
  }
});

test('terminal-style path helpers are safe on odd input', () => {
  const { fs } = make();
  assert.equal(fs.resolve(''), '/home/user');
  assert.equal(fs.resolve('   '), '/home/user');
  assert.equal(fs.resolve('~/Documents/'), '/home/user/Documents');
  assert.equal(fs.display('/home/user/Documents/notes.md'), '~/Documents/notes.md');
  assert.equal(fs.display('/etc/motd'), '/etc/motd');
});

/** localStorage that fails on any key ending in `name`, and behaves normally otherwise. */
function failingStorage(name, failWith) {
  const data = {};
  return {
    setItem(k, v) {
      if (k.endsWith(name)) throw failWith;
      data[k] = String(v);
    },
    getItem(k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    removeItem(k) { delete data[k]; },
  };
}

test('a storage failure is classified by cause, not by the wording a browser happens to use', () => {
  const had = 'localStorage' in globalThis;
  const previous = globalThis.localStorage;
  try {
    const classify = (name, failWith, probeFirst = true) => {
      globalThis.localStorage = failingStorage(name, failWith);
      const bus = new EventBus();
      const seen = [];
      bus.on('store:error', (e) => seen.push(e));
      const store = new Store('browseros-test.tax', bus);
      if (probeFirst) store.headroom(); // a classification may use the measured ceiling
      store.save(name, { small: 1 });
      return { kind: store.lastErrorKind, event: seen[0] };
    };

    // Chrome/Safari wording, Firefox wording, and a bare error code all mean the same thing.
    for (const err of [
      new Error('QuotaExceededError: Failed to execute \'setItem\''),
      Object.assign(new Error('Setting the value exceeded the quota'), { name: 'QuotaExceededError' }),
      Object.assign(new Error('NS_ERROR_DOM_QUOTA_REACHED'), { code: 1014 }),
    ]) {
      const { kind, event } = classify('fs', err);
      assert.equal(kind, 'quota', `not classified as quota: ${err.message}`);
      assert.equal(event.kind, 'quota', 'the bus event must carry the cause too');
    }

    /* A write that fits inside the space we just measured is not the quota talking: this
       is storage refusing writes altogether (private mode, blocked third-party storage). */
    const blocked = classify('blocked', new Error('SecurityError: The operation is insecure.'));
    assert.equal(blocked.kind, 'unavailable');

    /* Nothing has probed the quota yet — early in a session, or in an app that never asks
       for free space. The classification needs that measurement, so it takes it, instead
       of falling back to "cause unknown" for the first failure of the day. */
    const cold = classify('blocked', new Error('SecurityError: The operation is insecure.'), false);
    assert.equal(cold.kind, 'unavailable', 'a refused write must not be called unknown just because nothing measured the quota first');

    /* The error's own identity still decides first: a quota refusal is never reclassified
       by a measurement, probed or not. */
    assert.equal(classify('fs', new Error('QuotaExceededError: no room'), false).kind, 'quota');

    // Nothing to do with the browser: the value itself cannot be stored.
    globalThis.localStorage = failingStorage('unused', new Error('nope'));
    const store = new Store('browseros-test.tax2', new EventBus());
    const circular = {}; circular.self = circular;
    assert.equal(store.save('loop', circular), false);
    assert.equal(store.lastErrorKind, 'serialisation');
  } finally {
    if (had) globalThis.localStorage = previous;
    else delete globalThis.localStorage;
  }
});
