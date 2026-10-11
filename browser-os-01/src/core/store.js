export const NS = 'browseros-01'; // experiments.galedra.org: one storage namespace per copy, since both share this origin

/**
 * Namespaced localStorage wrapper with an in-memory fallback.
 *
 * `save()` reports whether the write actually landed somewhere durable. When localStorage
 * rejects a write (quota exceeded, private-mode restrictions) the value is kept in memory
 * so the session keeps working, but the failure is surfaced on the event bus so the shell
 * can warn the user instead of silently losing everything on reload.
 */
export class Store {
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
    this.lastError = null;
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
      return this.#failed(name, err);
    }
    if (this.available) {
      try {
        localStorage.setItem(this.key(name), raw);
        this.memory.delete(name);
        return true;
      } catch (err) {
        this.memory.set(name, raw);
        return this.#failed(name, err);
      }
    }
    this.memory.set(name, raw);
    return true;
  }

  #failed(name, err) {
    this.failures++;
    this.lastError = String(err?.message || err);
    this.bus?.emit('store:error', { key: name, error: this.lastError, failures: this.failures });
    return false;
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
    if (!this.available) return;
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith(`${this.ns}.`)) localStorage.removeItem(k);
    }
  }
}
