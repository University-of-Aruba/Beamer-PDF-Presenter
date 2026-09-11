import { countdownPhase, formatCountdown, remainingTime } from "./countdown.mjs";
import { brandDetails, DEFAULT_BRAND_FILENAME, wrapBrandName } from "./branding.mjs";

const SVG_NS = "http://www.w3.org/2000/svg";
const STATUS = { ready: "Ready", running: "Time remaining", paused: "Paused", finished: "Time is up" };

/** Create an SVG node using controlled attributes and plain text only. */
function svgNode(tag, attributes, text = "") {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  if (text) node.textContent = text;
  return node;
}

/** Independent visual layer; rendering a PDF never removes this timer. */
export class TimerDisplay {
  constructor(stage, surface) {
    this.stage = stage;
    this.surface = surface;
    this.state = null;
    this.hasDeck = false;
    this.layer = document.createElement("div");
    this.layer.className = "countdown-layer";
    this.layer.hidden = true;
    this.layer.setAttribute("aria-live", "off");
    this.frame = document.createElement("div");
    this.frame.className = "timer-overlay-frame";
    this.badge = document.createElement("div");
    this.badge.className = "countdown-badge";
    this.badge.setAttribute("role", "timer");
    this.digital = document.createElement("strong");
    this.digital.className = "countdown-digits";
    this.badgeStatus = document.createElement("span");
    this.badgeStatus.className = "countdown-badge-status";
    this.badge.append(this.digital, this.badgeStatus);
    this.frame.append(this.badge);
    this.analog = document.createElement("div");
    this.analog.className = "analog-screen";
    this.analog.setAttribute("role", "timer");
    this.buildAnalog();
    this.layer.append(this.frame, this.analog);
    stage.append(this.layer);
    this.resizeObserver = new ResizeObserver(() => this.fit());
    this.resizeObserver.observe(stage);
    this.mutationObserver = new MutationObserver(() => this.fit());
    this.mutationObserver.observe(surface, { attributes: true, attributeFilter: ["data-pdf-aspect"] });
  }

  buildAnalog() {
    const svg = svgNode("svg", { viewBox: "0 0 400 580", "aria-hidden": "true", class: "analog-clock" });
    this.analogSVG = svg;
    svg.append(svgNode("text", { x: 200, y: 19, class: "analog-title" }, "COUNTDOWN"));
    svg.append(svgNode("circle", { cx: 200, cy: 190, r: 150, class: "analog-face" }));
    this.sector = svgNode("path", { class: "analog-sector" });
    svg.append(this.sector);
    svg.append(svgNode("circle", { cx: 200, cy: 190, r: 148, class: "analog-track" }));
    this.ring = svgNode("circle", { cx: 200, cy: 190, r: 148, class: "analog-ring", transform: "rotate(-90 200 190)" });
    svg.append(this.ring);
    for (let i = 0; i < 60; i++) {
      const angle = i * Math.PI / 30;
      const inner = i % 5 === 0 ? 128 : 136;
      svg.append(svgNode("line", {
        x1: 200 + Math.sin(angle) * inner, y1: 190 - Math.cos(angle) * inner,
        x2: 200 + Math.sin(angle) * 142, y2: 190 - Math.cos(angle) * 142,
        class: i % 5 === 0 ? "analog-tick major" : "analog-tick",
      }));
    }
    this.dialLabels = [];
    for (const [x, y] of [[200, 85], [300, 195], [200, 300], [100, 195]]) {
      const label = svgNode("text", { x, y, class: "analog-label" });
      this.dialLabels.push(label);
      svg.append(label);
    }
    this.units = svgNode("text", { x: 200, y: 244, class: "analog-units" });
    this.hand = svgNode("line", { x1: 200, y1: 205, x2: 200, y2: 104, class: "analog-hand" });
    svg.append(this.units, this.hand, svgNode("circle", { cx: 200, cy: 190, r: 6, class: "analog-pin" }));
    this.analogDigits = svgNode("text", { x: 200, y: 397, class: "analog-digits" });
    this.analogStatus = svgNode("text", { x: 200, y: 431, class: "analog-status" });
    this.analogTotal = svgNode("text", { x: 200, y: 456, class: "analog-total" });
    svg.append(this.analogDigits, this.analogStatus, this.analogTotal);
    // Keep the brand inside the timer layer, so it scales and hides with the display.
    this.brandMark = svgNode("image", {
      x: 135, y: 478, width: 130, height: 70,
      preserveAspectRatio: "xMidYMid meet", class: "analog-brand-mark",
    });
    this.brandMark.addEventListener("error", () => this.brandMark.setAttribute("visibility", "hidden"));
    this.brandLabel = svgNode("text", { x: 200, y: 569, class: "analog-brand-label" });
    svg.append(this.brandMark, this.brandLabel);
    this.analog.append(svg);
    this.setBrand(DEFAULT_BRAND_FILENAME);
  }

  /** Apply a safe logo filename without changing the countdown or its mode. */
  setBrand(filename) {
    const brand = brandDetails(filename);
    if (brand.src) {
      this.brandMark.setAttribute("visibility", "visible");
      this.brandMark.setAttribute("href", brand.src);
    } else {
      this.brandMark.setAttribute("visibility", "hidden");
      this.brandMark.removeAttribute("href");
    }
    this.brandLabel.replaceChildren();
    const lines = wrapBrandName(brand.name);
    this.analogSVG.setAttribute("viewBox", `0 0 400 ${580 + Math.max(0, lines.length - 1) * 22}`);
    for (const [index, line] of lines.entries()) {
      const attributes = { x: 200, dy: index ? 22 : 0 };
      // Keep unusually long names legible and wholly inside the timer's viewBox.
      if (Array.from(line).length >= 24) {
        attributes.textLength = 344;
        attributes.lengthAdjust = "spacingAndGlyphs";
      }
      this.brandLabel.append(svgNode("tspan", attributes, line));
    }
  }

  setState(state, hasDeck) {
    const previousDuration = this.state?.durationMs;
    this.state = state;
    this.hasDeck = hasDeck;
    const isAnalog = state.mode === "analog";
    this.layer.hidden = state.mode === "hidden" || (state.mode === "corner" && !hasDeck);
    this.analog.hidden = !isAnalog;
    this.frame.hidden = isAnalog;
    // Keep PDF layout and page position intact underneath the analog display.
    this.surface.classList.toggle("covered-by-timer", isAnalog);
    this.badge.dataset.corner = state.corner;
    if (state.durationMs !== previousDuration) {
      const seconds = state.durationMs / 1000;
      const inSeconds = seconds <= 120;
      const dialTotal = inSeconds ? seconds : seconds / 60;
      this.units.textContent = inSeconds ? "SECONDS" : "MINUTES";
      this.dialLabels.forEach((label, index) => {
        label.textContent = String(Number((dialTotal * index / 4).toFixed(2)));
      });
      this.analogTotal.textContent = `Total ${formatCountdown(state.durationMs)}`;
    }
    this.fit();
    this.tick();
  }

  fit() {
    const width = this.stage.clientWidth;
    const height = this.stage.clientHeight;
    const aspect = Number(this.surface.dataset.pdfAspect);
    let fittedWidth = width;
    let fittedHeight = height;
    if (aspect > 0) {
      fittedWidth = Math.min(Math.max(1, width - 2), Math.max(1, height - 2) * aspect);
      fittedHeight = fittedWidth / aspect;
    }
    this.frame.style.width = `${fittedWidth}px`;
    this.frame.style.height = `${fittedHeight}px`;
    // Size relative to the slide, so projector and private preview match.
    this.badge.style.fontSize = `${Math.max(9, Math.min(fittedWidth * 0.029, fittedHeight * 0.065))}px`;
    this.frame.style.setProperty("--timer-inset", `${Math.max(4, Math.min(fittedWidth, fittedHeight) * 0.018)}px`);
  }

  tick(now = Date.now()) {
    if (!this.state) return;
    const remaining = remainingTime(this.state, now);
    const phase = countdownPhase(this.state, now);
    const value = formatCountdown(remaining);
    const ratio = remaining / this.state.durationMs;
    this.layer.dataset.phase = phase;
    this.layer.dataset.urgency = remaining === 0 ? "finished" : ratio <= 0.1 ? "low" : ratio <= 0.2 ? "warning" : "normal";
    this.digital.textContent = value;
    this.badgeStatus.textContent = phase === "running" ? "" : STATUS[phase];
    this.badgeStatus.hidden = phase === "running";
    this.analogDigits.textContent = value;
    this.analogStatus.textContent = STATUS[phase];
    const description = `${STATUS[phase]}: ${value}`;
    this.badge.setAttribute("aria-label", description);
    this.analog.setAttribute("aria-label", description);
    this.hand.setAttribute("transform", `rotate(${ratio * 360} 200 190)`);
    const circumference = 2 * Math.PI * 148;
    this.ring.setAttribute("stroke-dasharray", `${ratio * circumference} ${circumference}`);
    if (ratio >= 0.999999) {
      this.sector.setAttribute("d", "M200 42 A148 148 0 1 1 200 338 A148 148 0 1 1 200 42Z");
    } else if (ratio <= 0) {
      this.sector.setAttribute("d", "");
    } else {
      const angle = ratio * 2 * Math.PI;
      const x = 200 + Math.sin(angle) * 148;
      const y = 190 - Math.cos(angle) * 148;
      this.sector.setAttribute("d", `M200 190 L200 42 A148 148 0 ${ratio > 0.5 ? 1 : 0} 1 ${x} ${y}Z`);
    }
  }

  destroy() {
    this.resizeObserver.disconnect();
    this.mutationObserver.disconnect();
    this.layer.remove();
  }
}
