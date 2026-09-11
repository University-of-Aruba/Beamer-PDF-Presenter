/** Deliberate PDF activation without turning a single click or tap into a slide change. */

const TAP_INTERVAL_MS = 450;
const TAP_DISTANCE_PX = 24;
const TOUCH_MOUSE_SUPPRESSION_MS = 800;
const KEYBOARD_CLICK_SUPPRESSION_MS = 100;
const touchSessions = new WeakMap();

function touchSession(button) {
  const scope = button.ownerDocument || button;
  if (!touchSessions.has(scope)) touchSessions.set(scope, { lastTap: null, mouseAfter: -Infinity });
  return touchSessions.get(scope);
}

function distance(left, right) {
  return Math.hypot(left.clientX - right.clientX, left.clientY - right.clientY);
}

function isActivationKey(event) {
  return event.key === "Enter" || event.key === " " || event.key === "Spacebar";
}

/**
 * Bind double-click, double-tap, Enter/Space, and trusted semantic button activation.
 * Single pointer clicks retain native focus without invoking onActivate(event).
 * Touch pairs must occur on the same button within 450 ms and 24 CSS pixels;
 * scrolling, cancellation, long presses, and extra fingers invalidate the pair.
 * Return a cleanup function to remove all listeners before discarding the row.
 */
export function bindPdfActivation(button, onActivate) {
  const session = touchSession(button);
  const heldKeys = new Set();
  let gesture = null;
  let keyboardClickAfter = -Infinity;
  const enabled = () => !button.disabled && button.getAttribute("aria-disabled") !== "true";
  const resetTouch = () => { gesture = null; session.lastTap = null; };
  const consume = event => { event.preventDefault(); event.stopPropagation(); };

  function onSemanticClick(event) {
    // Assistive technologies may activate a native button without pointer or
    // keyboard events. Those trusted clicks have no physical click count.
    if (event.detail !== 0) return;
    consume(event);
    if (!enabled() || !event.isTrusted || event.pointerType
        || event.sourceCapabilities?.firesTouchEvents || heldKeys.size
        || event.timeStamp <= session.mouseAfter || event.timeStamp <= keyboardClickAfter) return;
    resetTouch();
    onActivate(event);
  }

  function onDoubleClick(event) {
    consume(event);
    if (!enabled() || event.button !== 0 || event.sourceCapabilities?.firesTouchEvents
        || event.timeStamp <= session.mouseAfter) return;
    resetTouch();
    onActivate(event);
  }

  function onPointerDown(event) {
    if (event.pointerType !== "touch") {
      resetTouch();
      return;
    }
    session.mouseAfter = event.timeStamp + TOUCH_MOUSE_SUPPRESSION_MS;
    if (!enabled() || event.isPrimary === false || gesture
        || ![event.clientX, event.clientY, event.timeStamp].every(Number.isFinite)) {
      resetTouch();
      return;
    }
    if (session.lastTap?.button !== button) session.lastTap = null;
    gesture = { pointerId: event.pointerId, clientX: event.clientX,
      clientY: event.clientY, timeStamp: event.timeStamp };
  }

  function onPointerMove(event) {
    if (event.pointerType === "touch" && gesture?.pointerId === event.pointerId
        && distance(gesture, event) > TAP_DISTANCE_PX) resetTouch();
  }

  function onPointerLeave() {
    // Non-hover touch pointers leave automatically after pointerup. Keep that
    // completed tap; only leaving while a finger is down cancels the gesture.
    if (gesture) resetTouch();
  }

  function onPointerUp(event) {
    if (event.pointerType !== "touch") return;
    session.mouseAfter = event.timeStamp + TOUCH_MOUSE_SUPPRESSION_MS;
    const started = gesture;
    gesture = null;
    const elapsed = started && event.timeStamp - started.timeStamp;
    if (!enabled() || !started || started.pointerId !== event.pointerId
        || elapsed < 0 || elapsed > TAP_INTERVAL_MS
        || ![event.clientX, event.clientY, event.timeStamp].every(Number.isFinite)
        || distance(started, event) > TAP_DISTANCE_PX) {
      session.lastTap = null;
      return;
    }
    const previous = session.lastTap;
    const interval = previous && event.timeStamp - previous.timeStamp;
    if (previous?.button === button && interval >= 0 && interval <= TAP_INTERVAL_MS
        && distance(previous, event) <= TAP_DISTANCE_PX) {
      session.lastTap = null;
      consume(event);
      onActivate(event);
    } else {
      session.lastTap = { button, clientX: event.clientX, clientY: event.clientY,
        timeStamp: event.timeStamp };
    }
  }

  function onKeyDown(event) {
    if (!isActivationKey(event)) return;
    consume(event);
    resetTouch();
    keyboardClickAfter = event.timeStamp + KEYBOARD_CLICK_SUPPRESSION_MS;
    if (!enabled() || event.repeat || heldKeys.has(event.key)
        || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
    heldKeys.add(event.key);
    onActivate(event);
  }

  function onKeyUp(event) {
    if (!isActivationKey(event)) return;
    consume(event);
    heldKeys.delete(event.key);
    keyboardClickAfter = event.timeStamp + KEYBOARD_CLICK_SUPPRESSION_MS;
  }

  function onBlur() {
    heldKeys.clear();
    resetTouch();
  }

  const listeners = { click: onSemanticClick, dblclick: onDoubleClick, pointerdown: onPointerDown,
    pointermove: onPointerMove, pointerup: onPointerUp, pointercancel: resetTouch,
    pointerleave: onPointerLeave, keydown: onKeyDown, keyup: onKeyUp, blur: onBlur };
  for (const [type, listener] of Object.entries(listeners)) button.addEventListener(type, listener);
  return () => {
    for (const [type, listener] of Object.entries(listeners)) button.removeEventListener(type, listener);
    heldKeys.clear();
    gesture = null;
    if (session.lastTap?.button === button) session.lastTap = null;
  };
}
