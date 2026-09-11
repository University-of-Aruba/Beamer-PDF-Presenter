import assert from "node:assert/strict";
import test from "node:test";
import { bindPdfActivation } from "../pdf-activation.mjs";

class Button extends EventTarget {
  constructor(ownerDocument = {}) {
    super();
    this.ownerDocument = ownerDocument;
    this.disabled = false;
    this.ariaDisabled = null;
  }
  getAttribute(name) { return name === "aria-disabled" ? this.ariaDisabled : null; }
}

function fire(button, type, fields = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  for (const [name, value] of Object.entries({ timeStamp: 1000, ...fields })) {
    Object.defineProperty(event, name, { value });
  }
  button.dispatchEvent(event);
  return event;
}

function pointer(button, type, timeStamp, fields = {}) {
  return fire(button, type, { pointerType: "touch", pointerId: 1, isPrimary: true,
    clientX: 30, clientY: 40, timeStamp, ...fields });
}

function tap(button, timeStamp, fields = {}) {
  pointer(button, "pointerdown", timeStamp, fields);
  const up = pointer(button, "pointerup", timeStamp + 30, fields);
  pointer(button, "pointerleave", timeStamp + 31, fields);
  return up;
}

function fixture(ownerDocument) {
  const button = new Button(ownerDocument);
  const activations = [];
  const cleanup = bindPdfActivation(button, event => activations.push(event.type));
  return { button, activations, cleanup };
}

test("single clicks stay inert and a primary desktop double-click opens exactly once", () => {
  const { button, activations } = fixture();
  const single = fire(button, "click", { button: 0, detail: 1 });
  fire(button, "click", { button: 0, detail: 2 });
  assert.deepEqual(activations, []);
  assert.equal(single.defaultPrevented, false);
  const double = fire(button, "dblclick", { button: 0 });
  assert.deepEqual(activations, ["dblclick"]);
  assert.equal(double.defaultPrevented, true);
  fire(button, "dblclick", { button: 2 });
  assert.equal(activations.length, 1);
});

test("two nearby touch taps activate once and synthetic clicks or double-clicks do not reopen", () => {
  const { button, activations } = fixture();
  tap(button, 100);
  assert.deepEqual(activations, []);
  const second = tap(button, 400, { clientX: 40, clientY: 42 });
  assert.deepEqual(activations, ["pointerup"]);
  assert.equal(second.defaultPrevented, true);
  fire(button, "click", { button: 0, timeStamp: 435 });
  fire(button, "dblclick", { button: 0, timeStamp: 440 });
  fire(button, "dblclick", { button: 0, timeStamp: 1400,
    sourceCapabilities: { firesTouchEvents: true } });
  assert.equal(activations.length, 1);
  fire(button, "dblclick", { button: 0, timeStamp: 1500 });
  assert.deepEqual(activations, ["pointerup", "dblclick"]);
});

test("expired or distant tap pairs cannot open a PDF", () => {
  const { button, activations } = fixture();
  tap(button, 100);
  tap(button, 551);
  assert.deepEqual(activations, []);
  tap(button, 750, { clientX: 55 });
  assert.deepEqual(activations, []);
  tap(button, 900, { clientX: 55 });
  assert.deepEqual(activations, ["pointerup"]);
});

test("a tap on a different PDF interrupts the pair, even when the first button is tapped again", () => {
  const document = {};
  const first = fixture(document);
  const second = fixture(document);
  tap(first.button, 100);
  tap(second.button, 200);
  tap(first.button, 300);
  assert.deepEqual(first.activations, []);
  assert.deepEqual(second.activations, []);
  tap(first.button, 400);
  assert.deepEqual(first.activations, ["pointerup"]);
});

test("scroll movement, pointer cancellation, and leaving the row each invalidate a tap pair", () => {
  for (const invalidation of ["pointermove", "pointercancel", "pointerleave"]) {
    const { button, activations } = fixture();
    tap(button, 100);
    pointer(button, "pointerdown", 200);
    pointer(button, invalidation, 210, { clientY: 70 });
    pointer(button, "pointerup", 220);
    tap(button, 300);
    assert.deepEqual(activations, [], invalidation);
  }
});

test("dragging out and back, long presses, and multi-touch never count as a second tap", () => {
  const { button, activations } = fixture();
  tap(button, 100);
  pointer(button, "pointerdown", 200);
  pointer(button, "pointermove", 210, { clientX: 100 });
  pointer(button, "pointermove", 220);
  pointer(button, "pointerup", 230);
  assert.deepEqual(activations, []);
  pointer(button, "pointerdown", 300);
  pointer(button, "pointerup", 800);
  tap(button, 850);
  assert.deepEqual(activations, []);
  pointer(button, "pointerdown", 900);
  pointer(button, "pointerdown", 910, { pointerId: 2, isPrimary: false });
  pointer(button, "pointerup", 920);
  pointer(button, "pointerup", 930, { pointerId: 2, isPrimary: false });
  tap(button, 1000);
  assert.deepEqual(activations, []);
});

test("Enter and Space activate once per press, prevent native clicks, and stop slide shortcuts", () => {
  for (const key of ["Enter", " ", "Spacebar"]) {
    const { button, activations } = fixture();
    const down = fire(button, "keydown", { key });
    assert.equal(down.defaultPrevented, true);
    assert.equal(down.cancelBubble, true);
    fire(button, "keydown", { key, repeat: true });
    fire(button, "keydown", { key });
    fire(button, "click", { detail: 0, isTrusted: true });
    assert.deepEqual(activations, ["keydown"]);
    const up = fire(button, "keyup", { key });
    assert.equal(up.defaultPrevented, true);
    assert.equal(up.cancelBubble, true);
    fire(button, "click", { detail: 0, isTrusted: true, timeStamp: 1001 });
    assert.deepEqual(activations, ["keydown"]);
    fire(button, "keydown", { key });
    assert.deepEqual(activations, ["keydown", "keydown"]);
  }
});

test("trusted assistive button clicks activate without enabling single pointer or scripted clicks", () => {
  const { button, activations } = fixture();
  // Node permits a trust flag stand-in; web content cannot mark real DOM events trusted.
  fire(button, "click", { detail: 0, isTrusted: false });
  fire(button, "click", { detail: 1, isTrusted: true, pointerType: "mouse" });
  fire(button, "click", { detail: 0, isTrusted: true, pointerType: "touch" });
  assert.deepEqual(activations, []);
  const semantic = fire(button, "click", { detail: 0, isTrusted: true });
  assert.deepEqual(activations, ["click"]);
  assert.equal(semantic.defaultPrevented, true);
  assert.equal(semantic.cancelBubble, true);
  fire(button, "keydown", { key: "Enter", timeStamp: 1200 });
  fire(button, "keyup", { key: "Enter", timeStamp: 1210 });
  fire(button, "click", { detail: 0, isTrusted: true, timeStamp: 1211 });
  assert.deepEqual(activations, ["click", "keydown"]);
  fire(button, "click", { detail: 0, isTrusted: true, timeStamp: 1400 });
  assert.deepEqual(activations, ["click", "keydown", "click"]);
});

test("semantic click handling suppresses touch duplicates and respects disabled rows and cleanup", () => {
  const { button, activations, cleanup } = fixture();
  tap(button, 100);
  fire(button, "click", { detail: 0, isTrusted: true, timeStamp: 131 });
  assert.deepEqual(activations, []);
  tap(button, 200);
  fire(button, "click", { detail: 0, isTrusted: true, timeStamp: 231 });
  assert.deepEqual(activations, ["pointerup"]);
  fire(button, "click", { detail: 0, isTrusted: true, timeStamp: 1100,
    sourceCapabilities: { firesTouchEvents: true } });
  button.disabled = true;
  fire(button, "click", { detail: 0, isTrusted: true, timeStamp: 1200 });
  button.disabled = false;
  button.ariaDisabled = "true";
  fire(button, "click", { detail: 0, isTrusted: true, timeStamp: 1300 });
  button.ariaDisabled = null;
  cleanup();
  fire(button, "click", { detail: 0, isTrusted: true, timeStamp: 1400 });
  assert.deepEqual(activations, ["pointerup"]);
});

test("modified keys, composition, unrelated keys, and disabled rows never activate", () => {
  const { button, activations } = fixture();
  for (const modifier of ["altKey", "ctrlKey", "metaKey", "isComposing"]) {
    fire(button, "keydown", { key: "Enter", [modifier]: true });
  }
  assert.equal(fire(button, "keydown", { key: "ArrowDown" }).defaultPrevented, false);
  for (const state of ["disabled", "ariaDisabled"]) {
    button[state] = state === "disabled" ? true : "true";
    fire(button, "dblclick", { button: 0 });
    fire(button, "keydown", { key: "Enter" });
    tap(button, 100);
    tap(button, 200);
    button[state] = state === "disabled" ? false : null;
  }
  assert.deepEqual(activations, []);
});

test("blur clears pending input and cleanup removes every activation listener", () => {
  const { button, activations, cleanup } = fixture();
  tap(button, 100);
  fire(button, "blur");
  tap(button, 200);
  assert.deepEqual(activations, []);
  fire(button, "keydown", { key: "Enter" });
  fire(button, "blur");
  fire(button, "keydown", { key: "Enter" });
  assert.deepEqual(activations, ["keydown", "keydown"]);
  cleanup();
  cleanup();
  fire(button, "dblclick", { button: 0, timeStamp: 2000 });
  fire(button, "keydown", { key: " " });
  tap(button, 3000);
  tap(button, 3100);
  assert.equal(activations.length, 2);
});
