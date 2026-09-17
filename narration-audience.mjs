/** Wait for the connected audience to display the narrated page before speech. */
export class NarrationAudience {
  constructor({ send, isConnected, getContext,
    setTimeout = globalThis.setTimeout.bind(globalThis),
    clearTimeout = globalThis.clearTimeout.bind(globalThis), timeoutMs = 10000 }) {
    this.send = send;
    this.isConnected = isConnected;
    this.getContext = getContext;
    this.setTimer = setTimeout;
    this.clearTimer = clearTimeout;
    this.timeoutMs = timeoutMs;
    this.sequence = 0;
    this.pending = null;
  }

  /** Request the current page, resolving immediately when no audience is open. */
  request(page) {
    this.cancel("Narration navigation was replaced.");
    return new Promise((resolve, reject) => {
      let request = null;
      try {
        if (!this.isConnected()) { resolve(); return; }
        const context = this.getContext();
        if (!Number.isSafeInteger(page) || page < 1 || !context?.pdfUrl
            || context.currentPage !== page) {
          throw new Error("The narrated page is no longer the current PDF page.");
        }
        const message = Object.freeze({ type: "goto", pdfUrl: context.pdfUrl,
          currentPage: page, narrationRequest: ++this.sequence });
        request = { message, resolve, reject, timer: null };
        this.pending = request;
        request.timer = this.setTimer(() => {
          this.finish(request, new Error(`Audience page rendering timed out after ${this.timeoutMs / 1000} seconds.`));
        }, this.timeoutMs);
        if (this.pending !== request) {
          this.clearTimer(request.timer);
          return;
        }
        this.send(message);
      } catch (error) {
        if (request) this.finish(request, error);
        else reject(error);
      }
    });
  }

  /** Accept only an acknowledgement for this request and the still-current PDF. */
  receive(message) {
    const request = this.pending;
    if (!request || message?.type !== "audience-page-rendered"
        || message.narrationRequest !== request.message.narrationRequest
        || message.pdfUrl !== request.message.pdfUrl
        || message.currentPage !== request.message.currentPage) return false;
    if (!this.isCurrent(request)) return false;
    this.finish(request, message.ok === true ? null
      : new Error("The audience page could not be rendered. Check that window before restarting narration."));
    return true;
  }

  /** Retry after audience loading, without ever resending cancelled or stale work. */
  resend() {
    const request = this.pending;
    if (!request || !this.isCurrent(request)) return false;
    try {
      this.send(request.message);
      return true;
    } catch (error) {
      this.finish(request, error);
      return false;
    }
  }

  /** Cancel pending navigation immediately and release its timeout. */
  cancel(message = "Narration navigation was cancelled.") {
    if (this.pending) {
      this.finish(this.pending, message instanceof Error ? message : new Error(message));
    }
  }

  /** Check the live document and page before trusting or retrying a request. */
  isCurrent(request) {
    if (this.pending !== request) return false;
    try {
      const context = this.getContext();
      if (this.isConnected() && context?.pdfUrl === request.message.pdfUrl
          && context.currentPage === request.message.currentPage) return true;
      this.finish(request, new Error("Narration navigation was cancelled because the audience, PDF or current page changed."));
    } catch (error) {
      this.finish(request, error);
    }
    return false;
  }

  /** Settle a request once, clearing it before invoking promise callbacks. */
  finish(request, error = null) {
    if (this.pending !== request) return;
    this.pending = null;
    if (request.timer !== null) this.clearTimer(request.timer);
    request.timer = null;
    if (error) request.reject(error);
    else request.resolve();
  }
}
