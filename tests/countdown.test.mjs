import { test } from "node:test";
import assert from "node:assert/strict";
import { createCountdown, updateCountdown, remainingTime, countdownPhase,
  formatCountdown, parseDuration, isCountdownState, MAX_DURATION_MS } from "../countdown.mjs";

const baseTime = 1_800_000_000_000;
test("default is a ready, private five-minute countdown", () => {
  const state = createCountdown();
  assert.equal(state.durationMs, 300_000);
  assert.equal(state.phase, "ready");
  assert.equal(state.mode, "hidden");
  assert.equal(isCountdownState(state), true);
});
test("parse minutes and seconds including long exams", () => {
  assert.equal(parseDuration("1", "30"), 90_000);
  assert.equal(parseDuration("90", "0"), 5_400_000);
  assert.equal(parseDuration("1440", "0"), MAX_DURATION_MS);
  assert.equal(parseDuration("0", "1"), 1000);
});
for (const [m, s] of [[0, 0], [-1, 5], [1, 60], [1, -1], [1.5, 0], [0, 0.5], [1440, 1], ["bad", 1], [Infinity, 0]]) {
  test(`invalid duration ${m}:${s} is rejected`, () => assert.throws(() => parseDuration(m, s), RangeError));
}
test("deadline advances without any interval callbacks", () => {
  const started = updateCountdown(createCountdown(), { type: "toggle" }, baseTime);
  assert.equal(started.endsAt, baseTime + 300_000);
  assert.equal(remainingTime(started, baseTime + 245_000), 55_000);
  assert.equal(remainingTime(started, baseTime + 400_000), 0);
  assert.equal(countdownPhase(started, baseTime + 400_000), "finished");
});
test("pause freezes the exact remaining milliseconds; resume preserves them", () => {
  let state = updateCountdown(createCountdown(), { type: "toggle" }, baseTime);
  state = updateCountdown(state, { type: "toggle" }, baseTime + 1234);
  assert.equal(state.phase, "paused");
  assert.equal(state.remainingMs, 298766);
  assert.equal(remainingTime(state, baseTime + 50000), 298766);
  state = updateCountdown(state, { type: "toggle" }, baseTime + 50000);
  assert.equal(state.endsAt, baseTime + 50000 + 298766);
});
test("display and corner changes do not reset a running timer", () => {
  let state = updateCountdown(createCountdown(), { type: "toggle" }, baseTime);
  const deadline = state.endsAt;
  for (const mode of ["corner", "analog", "hidden"]) state = updateCountdown(state, { type: "mode", mode }, baseTime + 1000);
  state = updateCountdown(state, { type: "corner", corner: "bottom-left" }, baseTime + 1000);
  assert.equal(state.endsAt, deadline);
  assert.equal(state.phase, "running");
  assert.equal(state.corner, "bottom-left");
});
test("reset and set-duration pause while preserving display settings", () => {
  let state = updateCountdown(createCountdown(), { type: "mode", mode: "analog" });
  state = updateCountdown(state, { type: "toggle" }, baseTime);
  state = updateCountdown(state, { type: "reset" }, baseTime + 1000);
  assert.equal(state.phase, "ready");
  assert.equal(state.remainingMs, 300_000);
  state = updateCountdown(state, { type: "set-duration", durationMs: 90_000 });
  assert.equal(state.mode, "analog");
  assert.equal(state.remainingMs, 90_000);
  assert.equal(state.phase, "ready");
});
test("completion is clamped, silent and cannot restart until reset", () => {
  let state = updateCountdown(createCountdown(1000), { type: "toggle" }, baseTime);
  state = updateCountdown(state, { type: "finish" }, baseTime + 1000);
  assert.equal(state.phase, "finished");
  assert.equal(state.remainingMs, 0);
  assert.equal(updateCountdown(state, { type: "toggle" }), state);
  assert.equal(updateCountdown(state, { type: "finish" }), state);
});
test("early completion is a no-op", () => {
  const state = updateCountdown(createCountdown(), { type: "toggle" }, baseTime);
  assert.equal(updateCountdown(state, { type: "finish" }, baseTime + 10), state);
});
test("format uses ceil and supports hours", () => {
  assert.equal(formatCountdown(1), "00:01");
  assert.equal(formatCountdown(60000), "01:00");
  assert.equal(formatCountdown(59999), "01:00");
  assert.equal(formatCountdown(0), "00:00");
  assert.equal(formatCountdown(-100), "00:00");
  assert.equal(formatCountdown(5400000), "01:30:00");
  assert.equal(formatCountdown(MAX_DURATION_MS), "24:00:00");
});
test("messages reject invalid types, durations and corners", () => {
  const state = createCountdown();
  for (const payload of [null, {}, { ...state, durationMs: NaN }, { ...state, remainingMs: Infinity },
    { ...state, corner: "middle" }, { ...state, mode: "bad" }, { ...state, phase: "running", endsAt: null },
    { ...state, revision: -1 }, { ...state, revision: 1.2 }]) {
    assert.equal(isCountdownState(payload), false);
  }
});
test("actions never mutate previously broadcast snapshots", () => {
  const state = createCountdown();
  const snapshot = structuredClone(state);
  const started = updateCountdown(state, { type: "toggle" }, baseTime);
  assert.deepEqual(state, snapshot);
  assert.equal(started.revision, state.revision + 1);
});
