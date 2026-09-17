/** Keep a bounded set of raster tasks, including preparation already in flight. */
export class PageRenderCache {
  constructor(limit = 2) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("A positive cache limit is required.");
    this.limit = limit;
    this.entries = new Map();
  }

  /** Reuse matching work; loaders register cancellation before awaiting a raster task. */
  get(key, load) {
    const existing = this.entries.get(key);
    if (existing) {
      this.entries.delete(key);
      this.entries.set(key, existing);
      return existing.promise;
    }
    const entry = { cancelled: false, cancel: null, promise: null };
    const controls = {
      isActive: () => !entry.cancelled && this.entries.get(key) === entry,
      onCancel: callback => {
        if (entry.cancelled) this.cancelSafely(callback);
        else entry.cancel = callback;
      },
    };
    entry.promise = Promise.resolve().then(() => controls.isActive() ? load(controls) : null)
      .then(value => controls.isActive() ? value : null, error => {
        if (this.entries.get(key) === entry) this.entries.delete(key);
        // A replaced background task cannot fail the replacement navigation.
        if (entry.cancelled) return null;
        throw error;
      }).finally(() => { entry.cancel = null; });
    this.entries.set(key, entry);
    while (this.entries.size > this.limit) {
      const oldestKey = this.entries.keys().next().value;
      const oldest = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      this.discard(oldest);
    }
    return entry.promise;
  }

  /** Release cached pages and cancel preparation after a document or surface changes. */
  clear() {
    const entries = [...this.entries.values()];
    this.entries.clear();
    for (const entry of entries) this.discard(entry);
  }

  discard(entry) {
    entry.cancelled = true;
    const cancel = entry.cancel;
    entry.cancel = null;
    if (cancel) this.cancelSafely(cancel);
  }

  cancelSafely(callback) {
    try { callback(); } catch { /* An already-finished render needs no cancellation. */ }
  }
}
