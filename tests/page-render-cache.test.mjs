import { test } from "node:test";
import assert from "node:assert/strict";
import { PageRenderCache } from "../page-render-cache.mjs";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

function raster() {
  const work = deferred();
  const state = { starts: 0, cancelled: 0, controls: null };
  const load = controls => {
    state.starts += 1;
    state.controls = controls;
    controls.onCancel(() => { state.cancelled += 1; });
    return work.promise;
  };
  return { ...work, state, load };
}

test("navigation reuses a next-page preparation that is still rasterizing", async () => {
  const cache = new PageRenderCache();
  const work = raster();
  const prepared = cache.get("page:3,size:1280x720,ratio:2", work.load);
  await Promise.resolve();
  const navigation = cache.get("page:3,size:1280x720,ratio:2", () => assert.fail("Must reuse preparation"));
  assert.equal(navigation, prepared);
  assert.equal(work.state.starts, 1);
  assert.equal(work.state.cancelled, 0);
  const canvas = { page: 3 };
  work.resolve(canvas);
  assert.equal(await navigation, canvas);
});

test("a completed page is reused without rasterization or cancellation", async () => {
  const cache = new PageRenderCache();
  const work = raster();
  const prepared = cache.get("page:3,size:1280x720,ratio:2", work.load);
  work.resolve({ page: 3 });
  const canvas = await prepared;
  assert.equal(await cache.get("page:3,size:1280x720,ratio:2", () => assert.fail()), canvas);
  assert.equal(work.state.starts, 1);
  assert.equal(work.state.cancelled, 0);
});

test("page and render geometry changes use separate preparation", async () => {
  const cache = new PageRenderCache();
  const keys = ["page:2,size:1280x720,ratio:1", "page:3,size:1280x720,ratio:1",
    "page:3,size:1400x800,ratio:1", "page:3,size:1400x800,ratio:2"];
  for (const key of keys) {
    assert.equal(await cache.get(key, () => key), key);
    assert.ok(cache.entries.size <= 2);
  }
});

test("eviction cancels the least recently requested raster and ignores its late result", async () => {
  const cache = new PageRenderCache();
  const old = raster();
  const oldResult = cache.get("old", old.load);
  const current = raster();
  const currentResult = cache.get("current", current.load);
  await Promise.resolve();
  const next = cache.get("next", () => ({ page: "next" }));
  assert.equal(cache.entries.size, 2);
  assert.equal(old.state.cancelled, 1);
  assert.equal(current.state.cancelled, 0);
  assert.equal(old.state.controls.isActive(), false);
  old.resolve({ page: "old" });
  current.resolve({ page: "current" });
  assert.equal(await oldResult, null);
  assert.equal((await currentResult).page, "current");
  assert.equal((await next).page, "next");
});

test("reusing current preparation keeps it through eviction of the previous page", async () => {
  const cache = new PageRenderCache();
  const first = await cache.get("current", () => ({ page: "current" }));
  await cache.get("previous", () => ({ page: "previous" }));
  assert.equal(await cache.get("current", () => assert.fail()), first);
  await cache.get("next", () => ({ page: "next" }));
  assert.deepEqual([...cache.entries.keys()], ["current", "next"]);
});

test("document replacement clears preparation and prevents old results being reused", async () => {
  const cache = new PageRenderCache();
  const old = raster();
  const oldResult = cache.get("page:1,size:1280x720,ratio:2", old.load);
  await Promise.resolve();
  cache.clear();
  assert.equal(cache.entries.size, 0);
  assert.equal(old.state.cancelled, 1);
  const replacement = cache.get("page:1,size:1280x720,ratio:2", () => ({ document: "replacement" }));
  old.resolve({ document: "old" });
  assert.equal(await oldResult, null);
  assert.equal((await replacement).document, "replacement");
});

test("an evicted old failure cannot remove a same-key replacement", async () => {
  const cache = new PageRenderCache(1);
  const old = raster();
  const oldResult = cache.get("page", old.load);
  await Promise.resolve();
  cache.clear();
  const replacement = cache.get("page", () => ({ document: "replacement" }));
  old.reject(new Error("Old raster failed after cancellation"));
  assert.equal(await oldResult, null);
  assert.equal((await replacement).document, "replacement");
  assert.equal(await cache.get("page", () => assert.fail()), await replacement);
});

test("failed preparation is evicted so visible navigation can retry and report a new failure", async () => {
  const cache = new PageRenderCache();
  await assert.rejects(cache.get("next", () => { throw new Error("Prepare failed"); }), /Prepare failed/);
  assert.equal(cache.entries.size, 0);
  await assert.rejects(cache.get("next", () => Promise.reject(new Error("Visible render failed"))), /Visible render failed/);
  assert.equal(cache.entries.size, 0);
  assert.equal(await cache.get("next", () => "retry succeeded"), "retry succeeded");
});

test("clearing before preparation starts never invokes the raster loader", async () => {
  const cache = new PageRenderCache();
  const work = cache.get("next", () => assert.fail("Cancelled work must not start"));
  cache.clear();
  assert.equal(await work, null);
});

test("cancellation registered after asynchronous setup still cancels an evicted task", async () => {
  const cache = new PageRenderCache();
  const setup = deferred();
  let cancelled = 0;
  const work = cache.get("next", async controls => {
    await setup.promise;
    controls.onCancel(() => { cancelled += 1; });
    return "late canvas";
  });
  await Promise.resolve();
  cache.clear();
  setup.resolve();
  assert.equal(await work, null);
  assert.equal(cancelled, 1);
});

test("throwing cancellation cannot prevent other prepared pages from being cleared", async () => {
  const cache = new PageRenderCache();
  const work = deferred();
  const first = cache.get("first", controls => {
    controls.onCancel(() => { throw new Error("Already finished"); });
    return work.promise;
  });
  const second = raster();
  const secondResult = cache.get("second", second.load);
  await Promise.resolve();
  cache.clear();
  assert.equal(second.state.cancelled, 1);
  work.resolve("first");
  second.resolve("second");
  assert.equal(await first, null);
  assert.equal(await secondResult, null);
});

test("cache limits must be positive integers", () => {
  for (const limit of [0, -1, 1.5, Infinity, NaN]) assert.throws(() => new PageRenderCache(limit), RangeError);
});
