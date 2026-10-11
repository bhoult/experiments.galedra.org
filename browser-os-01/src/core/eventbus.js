export class EventBus {
  #handlers = new Map();

  on(event, fn) {
    if (!this.#handlers.has(event)) this.#handlers.set(event, new Set());
    this.#handlers.get(event).add(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    this.#handlers.get(event)?.delete(fn);
  }

  emit(event, payload) {
    const set = this.#handlers.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload, event);
      } catch (err) {
        console.error(`[bus] handler for "${event}" failed:`, err);
      }
    }
  }
}
