import { test } from "node:test";
import assert from "node:assert/strict";
import { fittedCanvasRect, normalizedPoint, projectedPoint, isLaserPoint,
  LaserOverlay, PresenterPointer } from "../laser-pointer.mjs";

test("coordinates map the PDF bounds instead of its letterboxed preview panel", () => {
  const rect = fittedCanvasRect({ left: 50, top: 20, width: 800, height: 600 }, 1600, 900);
  assert.deepEqual(rect, { left: 50, top: 95, width: 800, height: 450 });
  assert.deepEqual(normalizedPoint(250, 432.5, rect), { x: 0.25, y: 0.75 });
  assert.equal(normalizedPoint(250, 90, rect), null);
  assert.equal(normalizedPoint(250, 546, rect), null);
});

test("portrait PDF positions survive a differently sized audience display", () => {
  const presenter = fittedCanvasRect({ left: 10, top: 20, width: 800, height: 600 }, 600, 900);
  const audience = fittedCanvasRect({ left: 0, top: 0, width: 1920, height: 1080 }, 600, 900);
  assert.deepEqual(presenter, { left: 210, top: 20, width: 400, height: 600 });
  const point = normalizedPoint(310, 470, presenter);
  assert.deepEqual(projectedPoint(point, audience), { x: 780, y: 810 });
  assert.deepEqual(normalizedPoint(780, 810, audience), point);
});

test("all four PDF corners are included, while coordinates just outside are rejected", () => {
  const rect = { left: 20, top: 30, width: 400, height: 200 };
  for (const x of [0, 1]) for (const y of [0, 1]) {
    assert.deepEqual(normalizedPoint(20 + 400 * x, 30 + 200 * y, rect), { x, y });
  }
  for (const [x, y] of [[19.99, 30], [420.01, 30], [20, 29.99], [20, 230.01]]) {
    assert.equal(normalizedPoint(x, y, rect), null);
  }
});

test("malformed points, dimensions and nonfinite data never reach the overlay", () => {
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  for (const point of [null, {}, { x: NaN, y: 0 }, { x: 0, y: Infinity },
    { x: "0.5", y: 0 }, { x: -0.001, y: 0 }, { x: 0, y: 1.001 }]) {
    assert.equal(isLaserPoint(point), false);
    assert.equal(projectedPoint(point, rect), null);
  }
  for (const value of [0, -1, NaN, Infinity]) {
    assert.equal(fittedCanvasRect({ ...rect, width: value }, 100, 100), null);
    assert.equal(fittedCanvasRect(rect, 100, value), null);
    assert.equal(normalizedPoint(0, 0, { ...rect, height: value }), null);
  }
  assert.equal(normalizedPoint(Infinity, 0, rect), null);
  assert.equal(normalizedPoint(0, NaN, rect), null);
});

class FakeElement extends EventTarget {
  constructor(ownerDocument, rect = { left: 0, top: 0, width: 800, height: 600 }) {
    super();
    this.ownerDocument = ownerDocument;
    this.rect = rect;
    this.style = {};
    this.children = [];
    this.hidden = false;
    this.clientLeft = 0;
    this.clientTop = 0;
  }
  setAttribute() {}
  append(element) { this.children.push(element); element.parent = this; }
  remove() { this.parent.children = this.parent.children.filter(element => element !== this); }
  querySelector() { return this.canvas; }
  getBoundingClientRect() { return this.rect; }
}

function fixture() {
  const doc = new EventTarget();
  doc.hidden = false;
  doc.defaultView = new EventTarget();
  doc.defaultView.getComputedStyle = element => element.style;
  doc.createElement = () => new FakeElement(doc);
  const stage = new FakeElement(doc);
  const surface = new FakeElement(doc);
  const canvas = new FakeElement(doc, { left: 80, top: 120, width: 640, height: 360 });
  canvas.width = 1280;
  canvas.height = 720;
  surface.canvas = canvas;
  stage.append(surface);
  return { doc, stage, surface, canvas };
}

function move(stage, x = 400, y = 300, pointerType = "mouse") {
  const event = new Event("pointermove");
  Object.assign(event, { clientX: x, clientY: y, pointerType });
  stage.dispatchEvent(event);
}

test("overlay projects into its own stage without modifying or intercepting the PDF", () => {
  const { stage, surface, canvas } = fixture();
  stage.rect.left = 10;
  stage.rect.top = 15;
  stage.clientLeft = 2;
  stage.clientTop = 2;
  const overlay = new LaserOverlay(stage, surface);
  assert.equal(overlay.show({ x: 0.25, y: 0.75 }), true);
  assert.equal(overlay.dot.style.left, "228px");
  assert.equal(overlay.dot.style.top, "373px");
  assert.equal(overlay.layer.style.pointerEvents, "none");
  assert.equal(surface.canvas, canvas);
  assert.equal(stage.children.length, 2);
  overlay.destroy();
  assert.equal(stage.children.length, 1);
});

test("audience resize reprojects the same PDF point and replaced or hidden canvases clear it", () => {
  const { surface, stage, canvas } = fixture();
  const overlay = new LaserOverlay(stage, surface);
  overlay.show({ x: 0.75, y: 0.25 });
  canvas.rect = { left: 0, top: 75, width: 800, height: 450 };
  overlay.refresh();
  assert.equal(overlay.dot.style.left, "600px");
  assert.equal(overlay.dot.style.top, "187.5px");
  canvas.style.visibility = "hidden";
  overlay.refresh();
  assert.equal(overlay.layer.hidden, true);
  canvas.style.visibility = "visible";
  overlay.show({ x: 0.5, y: 0.5 });
  surface.canvas = new FakeElement(surface.ownerDocument);
  overlay.refresh();
  assert.equal(overlay.point, null);
  assert.equal(overlay.layer.hidden, true);
  surface.canvas = null;
  assert.equal(overlay.show({ x: 0.5, y: 0.5 }), false);
  overlay.destroy();
});

test("presenter pointer starts disabled and ignores letterbox and unavailable slide states", () => {
  const { stage, surface } = fixture();
  const messages = [];
  let available = true;
  const pointer = new PresenterPointer(stage, surface, point => messages.push(point), {
    isAvailable: () => available,
  });
  move(stage);
  assert.deepEqual(messages, []);
  pointer.setEnabled(true);
  move(stage);
  assert.deepEqual(messages, [{ x: 0.5, y: 0.5 }]);
  move(stage); // Identical positions do not flood the audience channel.
  assert.equal(messages.length, 1);
  move(stage, 10, 300);
  assert.equal(messages.at(-1), null);
  move(stage);
  available = false;
  pointer.refresh();
  assert.equal(messages.at(-1), null);
  assert.equal(pointer.overlay.layer.hidden, true);
  available = true;
  pointer.refresh();
  assert.equal(pointer.overlay.layer.hidden, true);
  pointer.destroy();
});

test("leave, cancel, focus loss, document hiding, touch and disable all clear the pointer", () => {
  const { doc, stage, surface } = fixture();
  const messages = [];
  const pointer = new PresenterPointer(stage, surface, point => messages.push(point));
  pointer.setEnabled(true);
  const exits = [
    () => stage.dispatchEvent(new Event("pointerleave")),
    () => stage.dispatchEvent(new Event("pointercancel")),
    () => doc.defaultView.dispatchEvent(new Event("blur")),
    () => { doc.hidden = true; doc.dispatchEvent(new Event("visibilitychange")); },
    () => move(stage, 400, 300, "touch"),
    () => pointer.setEnabled(false),
  ];
  for (const exit of exits) {
    move(stage);
    assert.notEqual(messages.at(-1), null);
    exit();
    assert.equal(messages.at(-1), null);
    assert.equal(pointer.overlay.layer.hidden, true);
    doc.hidden = false;
  }
  pointer.setEnabled(true);
  pointer.refresh();
  assert.equal(pointer.overlay.layer.hidden, true);
  pointer.destroy();
  const count = messages.length;
  move(stage);
  assert.equal(messages.length, count);
});

test("splitter resizing recalculates presenter coordinates under the stationary cursor", () => {
  const { stage, surface, canvas } = fixture();
  const messages = [];
  const pointer = new PresenterPointer(stage, surface, point => messages.push(point));
  pointer.setEnabled(true);
  move(stage, 240, 210);
  assert.deepEqual(messages.at(-1), { x: 0.25, y: 0.25 });
  canvas.rect = { left: 0, top: 0, width: 320, height: 180 };
  pointer.refresh();
  assert.equal(messages.at(-1), null);
  pointer.destroy();
});
