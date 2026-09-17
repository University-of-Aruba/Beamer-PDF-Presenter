import { test } from "node:test";
import assert from "node:assert/strict";
import { settlePreviewRenders } from "../preview-render.mjs";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

function fixture({ waitForNext = false, hasNext = true } = {}) {
  const current = deferred();
  const next = hasNext ? deferred() : null;
  const state = { current: true, rendered: false };
  const errors = [];
  let completed = false;
  const done = settlePreviewRenders(current.promise, next?.promise ?? null, {
    waitForNext,
    isCurrent: () => state.current,
    isCurrentRendered: () => state.rendered,
    onError: error => errors.push(error),
  }).then(result => { completed = true; return result; });
  return { current, next, state, errors, done, isCompleted: () => completed };
}

test("current-page readiness proceeds while a slow next-page preview is still pending", async () => {
  const f = fixture();
  f.state.rendered = true;
  f.current.resolve();
  assert.equal(await f.done, true);
  assert.deepEqual(f.errors, []);
  f.next.resolve();
});

test("a next-page failure is reported without blocking a successfully rendered current page", async () => {
  const f = fixture();
  const error = new Error("Next preview failed");
  f.next.reject(error);
  f.state.rendered = true;
  f.current.resolve();
  assert.equal(await f.done, true);
  assert.deepEqual(f.errors, [error]);
});

test("a late next-page failure remains handled after current-page readiness has returned", async () => {
  const f = fixture();
  f.state.rendered = true;
  f.current.resolve();
  assert.equal(await f.done, true);
  const error = new Error("Late next preview failure");
  f.next.reject(error);
  await Promise.resolve();
  assert.deepEqual(f.errors, [error]);
});

test("current-page failure prevents readiness even while the next preview is pending", async () => {
  const f = fixture();
  const error = new Error("Current page failed");
  f.current.reject(error);
  assert.equal(await f.done, false);
  assert.deepEqual(f.errors, [error]);
  f.next.resolve();
});

test("a cancelled render that resolves without displaying the requested page is not ready", async () => {
  const f = fixture();
  f.current.resolve();
  assert.equal(await f.done, false);
  f.next.resolve();
});

test("a superseded current render cannot report readiness or an obsolete error", async () => {
  for (const fail of [false, true]) {
    const f = fixture();
    f.state.current = false;
    f.state.rendered = true;
    if (fail) f.current.reject(new Error("Superseded current failure"));
    else f.current.resolve();
    f.next.reject(new Error("Superseded next failure"));
    assert.equal(await f.done, false);
    assert.deepEqual(f.errors, []);
  }
});

test("a late preview failure is ignored once another page or render has superseded it", async () => {
  const f = fixture();
  f.state.rendered = true;
  f.current.resolve();
  assert.equal(await f.done, true);
  f.state.current = false;
  f.next.reject(new Error("Stale preview failure"));
  await Promise.resolve();
  assert.deepEqual(f.errors, []);
});

test("ordinary presenter rendering still waits for both previews", async () => {
  const f = fixture({ waitForNext: true });
  f.state.rendered = true;
  f.current.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(f.isCompleted(), false);
  f.next.resolve();
  assert.equal(await f.done, true);
});

test("ordinary rendering rechecks stale state after the next preview settles", async () => {
  const f = fixture({ waitForNext: true });
  f.state.rendered = true;
  f.current.resolve();
  await Promise.resolve();
  f.state.current = false;
  f.next.resolve();
  assert.equal(await f.done, false);
});

test("two failed previews produce one error message for a render pass", async () => {
  const f = fixture({ waitForNext: true });
  f.current.reject(new Error("Current failure"));
  f.next.reject(new Error("Next failure"));
  assert.equal(await f.done, false);
  assert.equal(f.errors.length, 1);
});

test("the final page becomes ready without a next preview", async () => {
  const f = fixture({ waitForNext: true, hasNext: false });
  f.state.rendered = true;
  f.current.resolve();
  assert.equal(await f.done, true);
});
