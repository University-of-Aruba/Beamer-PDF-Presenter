/** Pure countdown state, shared by the presenter, audience, and unit tests. */
export const MAX_DURATION_MS = 24 * 60 * 60 * 1000;
export const DISPLAY_MODES = Object.freeze(["hidden", "corner", "analog"]);
export const CORNERS = Object.freeze(["top-left", "top-right", "bottom-left", "bottom-right"]);

/** Convert whole-minute and whole-second fields into a validated duration. */
export function parseDuration(minutes, seconds = 0) {
  const m = Number(minutes);
  const s = Number(seconds);
  if (!Number.isInteger(m) || !Number.isInteger(s) || m < 0 || s < 0 || s > 59) {
    throw new RangeError("Use whole minutes and seconds (seconds must be between 0 and 59).");
  }
  const duration = (m * 60 + s) * 1000;
  if (duration < 1000 || duration > MAX_DURATION_MS) {
    throw new RangeError("Set a duration from 1 second to 1,440 minutes (24 hours).");
  }
  return duration;
}

/** Create a paused, private countdown. Active countdowns are not saved to disk. */
export function createCountdown(durationMs = 5 * 60 * 1000) {
  if (!Number.isInteger(durationMs) || durationMs < 1000 || durationMs > MAX_DURATION_MS) {
    throw new RangeError("Invalid countdown duration.");
  }
  return {
    durationMs, remainingMs: durationMs, endsAt: null,
    phase: "ready", mode: "hidden", corner: "top-right", revision: 0,
  };
}

/** Use a shared absolute deadline, not the number of browser timer callbacks. */
export function remainingTime(state, now = Date.now()) {
  const value = state.phase === "running" ? state.endsAt - now : state.remainingMs;
  return Math.max(0, Math.min(state.durationMs, value));
}

/** Derive expiry locally, even when the presenter tab is inactive. */
export function countdownPhase(state, now = Date.now()) {
  return remainingTime(state, now) <= 0 ? "finished" : state.phase;
}

/** Apply an explicit countdown action and return a new, revisioned state. */
export function updateCountdown(state, action, now = Date.now()) {
  let next = { ...state, revision: state.revision + 1 };
  const remaining = remainingTime(state, now);
  switch (action.type) {
    case "set-duration":
      next = { ...next, ...createCountdown(action.durationMs), mode: state.mode,
        corner: state.corner, revision: next.revision };
      break;
    case "toggle":
      if (remaining <= 0) return state;
      next.remainingMs = remaining;
      next.phase = state.phase === "running" ? "paused" : "running";
      next.endsAt = next.phase === "running" ? now + remaining : null;
      break;
    case "reset":
      next.remainingMs = state.durationMs;
      next.endsAt = null;
      next.phase = "ready";
      break;
    case "finish":
      if (state.phase !== "running" || remaining > 0) return state;
      next.remainingMs = 0;
      next.endsAt = null;
      next.phase = "finished";
      break;
    case "mode":
      if (!DISPLAY_MODES.includes(action.mode)) throw new RangeError("Invalid display mode.");
      next.mode = action.mode;
      break;
    case "corner":
      if (!CORNERS.includes(action.corner)) throw new RangeError("Invalid timer corner.");
      next.corner = action.corner;
      break;
    default:
      throw new RangeError(`Unknown countdown action: ${action.type}`);
  }
  return next;
}

/** Validate incoming window messages without trusting arbitrary payload fields. */
export function isCountdownState(value) {
  return Boolean(value && Number.isInteger(value.durationMs)
    && value.durationMs >= 1000 && value.durationMs <= MAX_DURATION_MS
    && Number.isFinite(value.remainingMs) && value.remainingMs >= 0
    && value.remainingMs <= value.durationMs
    && ["ready", "running", "paused", "finished"].includes(value.phase)
    && (value.phase === "running" ? Number.isFinite(value.endsAt) : value.endsAt === null)
    && DISPLAY_MODES.includes(value.mode) && CORNERS.includes(value.corner)
    && Number.isSafeInteger(value.revision) && value.revision >= 0);
}

/** Format time remaining, rounding up so 00:00 is shown only at expiry. */
export function formatCountdown(milliseconds) {
  const total = Math.ceil(Math.max(0, milliseconds) / 1000);
  const parts = [Math.floor(total / 60) % 60, total % 60];
  if (total >= 3600) parts.unshift(Math.floor(total / 3600));
  return parts.map((part) => String(part).padStart(2, "0")).join(":");
}
