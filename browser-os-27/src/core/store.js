export const NS = 'browseros-27'; // experiments.galedra.org: one storage namespace per copy, since both share this origin

/**
 * Namespaced localStorage wrapper with an in-memory fallback.
 *
 * `save()` reports whether the write actually landed somewhere durable. When localStorage
 * rejects a write (quota exceeded, private-mode restrictions) the value is kept in memory
 * so the session keeps working, but the failure is surfaced on the event bus so the shell
 * can warn the user instead of silently losing everything on reload.
 */
export class Store {
  /* Measured ceiling in characters, or null until something asks for it. */
  #capacity = null;
  #capacityInvalidatedAt = 0;

  /** How often a quota refusal may throw away the cached ceiling (see #invalidateCapacity). */
  static PROBE_COOLDOWN_MS = 30_000;

  constructor(namespace = NS, bus = null) {
    this.ns = namespace;
    this.bus = bus;
    this.available = (() => {
      try {
        localStorage.setItem(`${namespace}.probe`, '1');
        localStorage.removeItem(`${namespace}.probe`);
        return true;
      } catch {
        return false;
      }
    })();
    this.memory = new Map();
    this.failures = 0;
    this.reprobes = 0;
    this.lastError = null;
    /* 'quota' | 'serialisation' | 'unavailable' | 'unknown' — see #classifyWrite. */
    this.lastErrorKind = null;
  }

  key(name) {
    return `${this.ns}.${name}`;
  }

  load(name, fallback = null) {
    try {
      // Memory wins when it holds a value: that is the copy that could not be persisted.
      if (this.memory.has(name)) return JSON.parse(this.memory.get(name));
      if (!this.available) return fallback;
      const raw = localStorage.getItem(this.key(name));
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  /** @returns {boolean} true when the value was stored durably. */
  save(name, value) {
    let raw;
    try {
      raw = JSON.stringify(value);
    } catch (err) {
      /* Nothing to do with the browser here: the value itself cannot be stored. */
      return this.#failed(name, err, 'serialisation');
    }
    if (this.available) {
      try {
        localStorage.setItem(this.key(name), raw);
        this.memory.delete(name);
        return true;
      } catch (err) {
        this.memory.set(name, raw);
        return this.#failed(name, err, this.#classifyWrite(err, raw));
      }
    }
    this.memory.set(name, raw);
    return true;
  }

  #failed(name, err, kind = 'unknown') {
    this.failures++;
    this.lastError = String(err?.message || err);
    this.lastErrorKind = kind;
    /* The measured ceiling is a snapshot of a quota that other code on this origin can
       consume at any time. A quota refusal is direct evidence the snapshot is wrong, so
       throw it away and let the next `headroom()` re-probe — rate-limited, because
       re-probing on every failed write is a probe storm with the same answer. */
    if (kind === 'quota') this.#invalidateCapacity();
    this.bus?.emit('store:error', { key: name, error: this.lastError, kind: this.lastErrorKind, failures: this.failures });
    return false;
  }

  /**
   * What kind of failure this is, so `df` and the warning can name a cause instead of
   * quoting a browser's wording (every engine words quota errors differently).
   *
   * Ordered by how sure the evidence is: the error's own identity first, then the
   * measurement — a write that fits inside the space we just measured is not the quota
   * talking, it is storage being refused outright — and only then the message text.
   */
  #classifyWrite(err, raw) {
    const name = String(err?.name || '').toLowerCase();
    if (err?.code === 22 || err?.code === 1014 || name.includes('quota')) return 'quota';
    const text = `${name} ${String(err?.message || '').toLowerCase()}`;
    if (text.includes('quota') || text.includes('exceed')) return 'quota';
    /* The measured ceiling is evidence too: a write that fits inside the space we just
       measured is not the quota talking, it is storage refusing writes altogether.
       If nothing has measured it yet, measure it *now* — this is the one moment where the
       difference between "the quota is full" and "writes are refused outright" changes what
       the user is told, and it happens once per failure, not per keystroke. */
    const cap = this.#capacity == null ? this.capacity() : this.#capacity;
    if (Number.isFinite(cap) && this.usage() + String(raw).length <= cap) return 'unavailable';
    return 'unknown';
  }

  #invalidateCapacity() {
    if (this.#capacity == null) return; // nothing cached to distrust
    const now = Date.now();
    if (now - this.#capacityInvalidatedAt < Store.PROBE_COOLDOWN_MS) return;
    this.#capacityInvalidatedAt = now;
    this.#capacity = null;
    this.reprobes++;
  }

  /** Bytes currently held under this namespace (used by Settings and `df`). */
  usage() {
    let n = 0;
    if (this.available) {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith(`${this.ns}.`)) n += (localStorage.getItem(k)?.length ?? 0);
      }
    }
    for (const [name, raw] of this.memory) {
      n += `${this.ns}.${name}`.length + String(raw).length;
    }
    return n;
  }

  remove(name) {
    this.memory.delete(name);
    if (!this.available) return;
    try { localStorage.removeItem(this.key(name)); } catch { /* ignore */ }
  }

  clearAll() {
    this.memory.clear();
    this.#capacity = null;
    this.reprobes = 0;
    this.#capacityInvalidatedAt = 0;
    if (!this.available) return;
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith(`${this.ns}.`)) localStorage.removeItem(k);
    }
  }

  /* ---------- measured storage headroom ---------- */

  /**
   * localStorage has no portable quota API, so measure the ceiling by probing: write
   * progressively larger payloads until one is refused, then binary-search the boundary
   * within a coarse tolerance. Runs lazily (only when something asks) and is cached.
   *
   * Units are characters, the same unit `usage()` counts in — browsers quota
   * localStorage by UTF-16 code units, and comparing the two in the same unit is what
   * makes `headroom()` usable for deciding whether an import will fit.
   *
   * @returns {number} measured capacity, or Infinity when storage is in-memory only
   * (there is no quota to measure, and pretending there is one would refuse writes
   * that would in fact succeed).
   */
  capacity() {
    if (!this.available) return Infinity;
    if (this.#capacity == null) this.#capacity = this.#measureCapacity();
    return this.#capacity;
  }

  /** Characters this namespace could still write before the quota refuses it. */
  headroom() {
    const cap = this.capacity();
    return cap === Infinity ? Infinity : Math.max(0, cap - this.usage());
  }

  #measureCapacity() {
    const key = `${this.ns}.quota-probe`;
    const used = this.usage();
    const fits = (n) => {
      try {
        localStorage.setItem(key, 'x'.repeat(n));
        return true;
      } catch {
        return false;
      } finally {
        try { localStorage.removeItem(key); } catch { /* ignore */ }
      }
    };

    /* Deliberate ceiling: probing past this costs multi-megabyte writes and tells us
       nothing we would act on — the import limits are far smaller anyway. */
    const MAX_PROBE = 32 * 1024 * 1024;

    let hi = 0;
    let step = 256 * 1024;
    for (;;) {
      const next = Math.min(hi + step, MAX_PROBE);
      if (next === hi) break; // already at the probe ceiling
      if (!fits(next)) break;
      hi = next;
      step *= 2;
    }
    if (hi >= MAX_PROBE) return used + hi;

    let lo = hi;
    let limit = Math.min(hi + step, MAX_PROBE);
    while (limit - lo > Math.max(64 * 1024, limit / 16)) {
      const mid = Math.floor((lo + limit) / 2);
      if (fits(mid)) lo = mid; else limit = mid;
    }
    this.capacityKnown = true;
    return used + lo;
  }
}
