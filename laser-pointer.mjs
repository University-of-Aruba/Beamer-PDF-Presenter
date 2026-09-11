/** Geometry and overlays for a laser pointer shared by PDF presentation windows. */

function validRect(rect) {
  return Boolean(rect && [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite)
    && rect.width > 0 && rect.height > 0);
}

/** Return the PDF pixel bounds when object-fit: contain letterboxes a canvas. */
export function fittedCanvasRect(rect, canvasWidth, canvasHeight) {
  if (!validRect(rect) || !Number.isFinite(canvasWidth) || !Number.isFinite(canvasHeight)
      || canvasWidth <= 0 || canvasHeight <= 0) return null;
  const scale = Math.min(rect.width / canvasWidth, rect.height / canvasHeight);
  const width = canvasWidth * scale;
  const height = canvasHeight * scale;
  return { left: rect.left + (rect.width - width) / 2,
    top: rect.top + (rect.height - height) / 2, width, height };
}

/** Translate client coordinates to a point on the PDF, rejecting letterbox space. */
export function normalizedPoint(clientX, clientY, rect) {
  if (!validRect(rect) || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  return isLaserPoint({ x, y }) ? { x, y } : null;
}

/** Check the normalized point received from another presentation window. */
export function isLaserPoint(point) {
  return Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y)
    && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1);
}

/** Translate a normalized PDF point into client coordinates at any display size. */
export function projectedPoint(point, rect) {
  if (!isLaserPoint(point) || !validRect(rect)) return null;
  return { x: rect.left + point.x * rect.width, y: rect.top + point.y * rect.height };
}

function canvasGeometry(surface) {
  const canvas = surface.querySelector("canvas");
  if (!canvas || canvas.hidden || surface.ownerDocument.hidden) return null;
  const style = surface.ownerDocument.defaultView?.getComputedStyle(canvas);
  if (style?.visibility === "hidden" || style?.display === "none") return null;
  const rect = fittedCanvasRect(canvas.getBoundingClientRect(), canvas.width, canvas.height);
  return rect ? { canvas, rect } : null;
}

function watchGeometry(stage, surface, refresh, reset) {
  const view = surface.ownerDocument.defaultView;
  const resize = view?.ResizeObserver ? new view.ResizeObserver(refresh) : null;
  resize?.observe(stage);
  resize?.observe(surface);
  const mutation = view?.MutationObserver ? new view.MutationObserver(reset) : null;
  mutation?.observe(surface, { childList: true });
  view?.addEventListener("resize", refresh);
  return () => {
    resize?.disconnect();
    mutation?.disconnect();
    view?.removeEventListener("resize", refresh);
  };
}

/** A noninteractive overlay beside the slide surface, surviving canvas redraws. */
export class LaserOverlay {
  constructor(stage, surface, { observe = true } = {}) {
    this.stage = stage;
    this.surface = surface;
    this.point = null;
    this.canvas = null;
    this.layer = surface.ownerDocument.createElement("div");
    this.layer.className = "pdf-laser-layer";
    this.layer.setAttribute("aria-hidden", "true");
    Object.assign(this.layer.style, { position: "absolute", inset: "0", pointerEvents: "none",
      overflow: "hidden", zIndex: "6" });
    this.dot = surface.ownerDocument.createElement("span");
    this.dot.className = "pdf-laser-dot";
    Object.assign(this.dot.style, { position: "absolute", display: "block", width: "14px",
      height: "14px", borderRadius: "50%", background: "#ff2020", border: "2px solid #ffe8e8",
      boxShadow: "0 0 4px #c40000, 0 0 14px #ff2020", transform: "translate(-50%, -50%)",
      pointerEvents: "none" });
    this.layer.append(this.dot);
    this.layer.hidden = true;
    stage.append(this.layer);
    this.stopWatching = observe
      ? watchGeometry(stage, surface, () => this.refresh(), () => this.hide()) : () => {};
    this.onVisibility = () => { if (surface.ownerDocument.hidden) this.hide(); };
    surface.ownerDocument.addEventListener("visibilitychange", this.onVisibility);
  }

  show(point) {
    const geometry = canvasGeometry(this.surface);
    const projected = geometry && projectedPoint(point, geometry.rect);
    const stageRect = this.stage.getBoundingClientRect();
    if (!projected || !validRect(stageRect)) {
      this.hide();
      return false;
    }
    this.point = { x: point.x, y: point.y };
    this.canvas = geometry.canvas;
    this.dot.style.left = `${projected.x - stageRect.left - this.stage.clientLeft}px`;
    this.dot.style.top = `${projected.y - stageRect.top - this.stage.clientTop}px`;
    this.layer.hidden = false;
    return true;
  }

  refresh() {
    if (!this.point) return;
    if (this.surface.querySelector("canvas") !== this.canvas) {
      this.hide();
      return;
    }
    this.show(this.point);
  }

  hide() {
    this.point = null;
    this.canvas = null;
    this.layer.hidden = true;
  }

  destroy() {
    this.hide();
    this.stopWatching();
    this.surface.ownerDocument.removeEventListener("visibilitychange", this.onVisibility);
    this.layer.remove();
  }
}

/** Track only the current preview; the caller owns deck/page identity and transport. */
export class PresenterPointer {
  constructor(stage, surface, onMove, { isAvailable = () => true } = {}) {
    this.stage = stage;
    this.surface = surface;
    this.onMove = onMove;
    this.isAvailable = isAvailable;
    this.enabled = false;
    this.clientPoint = null;
    this.lastPoint = null;
    this.overlay = new LaserOverlay(stage, surface, { observe: false });
    this.onPointerMove = event => {
      if (event.pointerType === "touch") return this.reset();
      this.clientPoint = { x: event.clientX, y: event.clientY };
      this.refresh();
    };
    this.onExit = () => this.reset();
    this.onVisibility = () => { if (surface.ownerDocument.hidden) this.reset(); };
    stage.addEventListener("pointermove", this.onPointerMove);
    stage.addEventListener("pointerleave", this.onExit);
    stage.addEventListener("pointercancel", this.onExit);
    surface.ownerDocument.defaultView?.addEventListener("blur", this.onExit);
    surface.ownerDocument.addEventListener("visibilitychange", this.onVisibility);
    this.stopWatching = watchGeometry(stage, surface, () => this.refresh(), () => this.reset());
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    // Toggling never revives the previous slide's last position.
    this.reset();
  }

  refresh() {
    if (!this.enabled || !this.clientPoint || !this.isAvailable()) {
      this.reset();
      return;
    }
    const geometry = canvasGeometry(this.surface);
    if (!geometry) {
      this.reset();
      return;
    }
    const point = normalizedPoint(this.clientPoint.x, this.clientPoint.y, geometry.rect);
    if (!point || !this.overlay.show(point)) {
      this.overlay.hide();
      this.publish(null);
      return;
    }
    this.publish(point);
  }

  publish(point) {
    if (point?.x === this.lastPoint?.x && point?.y === this.lastPoint?.y) return;
    this.lastPoint = point;
    this.onMove(point);
  }

  reset() {
    this.clientPoint = null;
    this.overlay.hide();
    this.publish(null);
  }

  destroy() {
    this.reset();
    this.stopWatching();
    this.stage.removeEventListener("pointermove", this.onPointerMove);
    this.stage.removeEventListener("pointerleave", this.onExit);
    this.stage.removeEventListener("pointercancel", this.onExit);
    this.surface.ownerDocument.defaultView?.removeEventListener("blur", this.onExit);
    this.surface.ownerDocument.removeEventListener("visibilitychange", this.onVisibility);
    this.overlay.destroy();
  }
}
