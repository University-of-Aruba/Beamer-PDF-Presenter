import { test } from "node:test";
import assert from "node:assert/strict";
import { NarrationAudience } from "../narration-audience.mjs";

function fixture(options = {}) {
  const sent = [];
  const timers = new Map();
  let timerSequence = 0;
  const state = { connected: true, pdfUrl: "blob:first", currentPage: 2 };
  const audience = new NarrationAudience({
    send: message => sent.push(message),
    isConnected: () => state.connected,
    getContext: () => ({ pdfUrl: state.pdfUrl, currentPage: state.currentPage }),
    setTimeout: (callback, ms) => { const id = ++timerSequence; timers.set(id, { callback, ms }); return id; },
    clearTimeout: id => timers.delete(id),
    ...options,
  });
  const ack = (message = sent.at(-1), overrides = {}) => ({ ...message, type: "audience-page-rendered", ok: true, ...overrides });
  return { audience, sent, timers, state, ack };
}

function observe(promise) {
  return promise.then(() => ({ ok: true }), error => ({ ok: false, error: error.message }));
}

test("narration waits for the exact audience page and clears its timeout on success", async () => {
  const f = fixture();
  let completed = false;
  const done = f.audience.request(2).then(() => { completed = true; });
  await Promise.resolve();
  assert.equal(completed, false);
  assert.deepEqual(f.sent[0], { type: "goto", pdfUrl: "blob:first", currentPage: 2, narrationRequest: 1 });
  assert.equal([...f.timers.values()][0].ms, 10000);
  assert.equal(f.audience.receive(f.ack()), true);
  await done;
  assert.equal(completed, true);
  assert.equal(f.timers.size, 0);
  assert.equal(f.audience.resend(), false);
  assert.equal(f.audience.receive(f.ack()), false);
});

test("manual cancellation prevents a delayed audience-loaded event from resending the old page", async () => {
  const f = fixture();
  const done = observe(f.audience.request(2));
  const oldMessage = f.sent[0];
  f.audience.cancel();
  f.state.currentPage = 1;
  assert.equal(f.audience.resend(), false);
  assert.deepEqual(f.sent, [oldMessage]);
  assert.equal(f.audience.receive(f.ack(oldMessage)), false);
  assert.match((await done).error, /cancelled/);
  assert.equal(f.timers.size, 0);
});

test("live page or document changes invalidate retries even without explicit cancellation", async () => {
  for (const update of [{ currentPage: 1 }, { pdfUrl: "blob:replacement" }, { connected: false }]) {
    const f = fixture();
    const done = observe(f.audience.request(2));
    Object.assign(f.state, update);
    assert.equal(f.audience.resend(), false);
    assert.equal(f.sent.length, 1);
    assert.equal((await done).ok, false);
    assert.equal(f.timers.size, 0);
  }
});

test("an otherwise matching acknowledgement cannot complete after the current context changes", async () => {
  for (const update of [{ currentPage: 3 }, { pdfUrl: "blob:replacement" }, { connected: false }]) {
    const f = fixture();
    const done = observe(f.audience.request(2));
    Object.assign(f.state, update);
    assert.equal(f.audience.receive(f.ack()), false);
    assert.equal((await done).ok, false);
    assert.equal(f.timers.size, 0);
  }
});

test("wrong request IDs, pages, PDFs, and message types are ignored", async () => {
  const f = fixture();
  const done = observe(f.audience.request(2));
  for (const update of [{ narrationRequest: 999 }, { currentPage: 1 }, { pdfUrl: "blob:other" }, { type: "audience-loaded" }]) {
    assert.equal(f.audience.receive(f.ack(undefined, update)), false);
  }
  assert.equal(f.audience.receive(null), false);
  assert.equal(f.timers.size, 1);
  assert.equal(f.audience.receive(f.ack()), true);
  assert.equal((await done).ok, true);
});

test("replacement requests reject previous promises and use monotonically increasing IDs", async () => {
  const f = fixture();
  const first = observe(f.audience.request(2));
  const firstMessage = f.sent[0];
  f.state.currentPage = 3;
  const second = observe(f.audience.request(3));
  assert.equal((await first).ok, false);
  assert.equal(f.sent[1].narrationRequest, 2);
  assert.equal(f.timers.size, 1);
  assert.equal(f.audience.receive(f.ack(firstMessage)), false);
  assert.equal(f.audience.receive(f.ack()), true);
  assert.equal((await second).ok, true);
  f.state.currentPage = 4;
  const third = observe(f.audience.request(4));
  assert.equal(f.sent[2].narrationRequest, 3);
  f.audience.cancel();
  await third;
});

test("a loading audience can retry the same request without extending its deadline", async () => {
  const f = fixture();
  const done = observe(f.audience.request(2));
  const originalTimer = [...f.timers.keys()][0];
  assert.equal(f.audience.resend(), true);
  assert.equal(f.sent.length, 2);
  assert.equal(f.sent[0], f.sent[1]);
  assert.deepEqual([...f.timers.keys()], [originalTimer]);
  f.audience.receive(f.ack());
  assert.equal((await done).ok, true);
});

test("timeout rejects instead of advancing and releases the pending request", async () => {
  const f = fixture();
  const done = observe(f.audience.request(2));
  [...f.timers.values()][0].callback();
  assert.match((await done).error, /timed out after 10 seconds/);
  assert.equal(f.timers.size, 0);
  assert.equal(f.audience.resend(), false);
  assert.equal(f.audience.receive(f.ack()), false);
});

test("a stale timeout callback cannot cancel a replacement request", async () => {
  const f = fixture();
  const first = observe(f.audience.request(2));
  const staleTimeout = [...f.timers.values()][0].callback;
  const second = observe(f.audience.request(2));
  await first;
  staleTimeout();
  assert.equal(f.timers.size, 1);
  f.audience.receive(f.ack());
  assert.equal((await second).ok, true);
});

test("disconnected requests resolve without messages or timers and cancel any previous pending request", async () => {
  const f = fixture();
  const first = observe(f.audience.request(2));
  f.state.connected = false;
  await f.audience.request(2);
  assert.equal((await first).ok, false);
  assert.equal(f.sent.length, 1);
  assert.equal(f.timers.size, 0);
  assert.equal(f.audience.resend(), false);
});

test("failure or malformed success acknowledgements never advance narration", async () => {
  for (const ok of [false, undefined, "true", 1]) {
    const f = fixture();
    const done = observe(f.audience.request(2));
    assert.equal(f.audience.receive(f.ack(undefined, { ok })), true);
    assert.match((await done).error, /could not be rendered/);
    assert.equal(f.timers.size, 0);
  }
});

test("a send failure rejects and clears the timeout", async () => {
  const f = fixture({ send: () => { throw new Error("Connection failed"); } });
  const done = await observe(f.audience.request(2));
  assert.equal(done.error, "Connection failed");
  assert.equal(f.timers.size, 0);
  assert.equal(f.audience.resend(), false);
});

test("a resend failure rejects and clears the timeout", async () => {
  const f = fixture();
  const done = observe(f.audience.request(2));
  f.audience.send = () => { throw new Error("Retry failed"); };
  assert.equal(f.audience.resend(), false);
  assert.equal((await done).error, "Retry failed");
  assert.equal(f.timers.size, 0);
});

test("synchronous acknowledgements during send still clear all pending state", async () => {
  const f = fixture();
  f.audience.send = message => f.audience.receive(f.ack(message));
  await f.audience.request(2);
  assert.equal(f.timers.size, 0);
  assert.equal(f.audience.resend(), false);
});

test("requests for a stale or invalid current page never send", async () => {
  for (const page of [1, 0, -1, "2", 2.5]) {
    const f = fixture();
    const done = await observe(f.audience.request(page));
    assert.match(done.error, /no longer the current PDF page/);
    assert.equal(f.sent.length, 0);
    assert.equal(f.timers.size, 0);
  }
});

test("cancel is idempotent and preserves a supplied error reason", async () => {
  const f = fixture();
  const done = observe(f.audience.request(2));
  f.audience.cancel(new Error("Audience window closed"));
  f.audience.cancel();
  assert.equal((await done).error, "Audience window closed");
  assert.equal(f.timers.size, 0);
});

test("context lookup failures reject and clear any active timer", async () => {
  const f = fixture();
  const done = observe(f.audience.request(2));
  f.audience.getContext = () => { throw new Error("Context unavailable"); };
  assert.equal(f.audience.resend(), false);
  assert.equal((await done).error, "Context unavailable");
  assert.equal(f.timers.size, 0);
  assert.equal((await observe(f.audience.request(2))).error, "Context unavailable");
});
