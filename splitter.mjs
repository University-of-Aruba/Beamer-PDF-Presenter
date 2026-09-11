/** Keyboard-accessible, pointer-draggable preview divider. */
export function initialiseSplitter(layout, separator, onChange = () => {}) {
  const defaultRatio = 0.6;
  const storageKey = "beamer-presenter:preview-split";
  const min = 0.15;
  const max = 0.85;
  let ratio = defaultRatio;
  let dragStart = null;
  let activePointer = null;
  try {
    const stored = localStorage.getItem(storageKey);
    const parsed = stored === null ? NaN : Number(stored);
    if (Number.isFinite(parsed)) ratio = parsed;
  } catch { /* Storage may be unavailable in a private/restricted browser. */ }

  function apply(value, save = false) {
    ratio = Math.max(min, Math.min(max, value));
    layout.style.gridTemplateColumns = `minmax(0, ${ratio}fr) 20px minmax(0, ${1 - ratio}fr)`;
    const percentage = Math.round(ratio * 100);
    separator.setAttribute("aria-valuenow", String(percentage));
    separator.setAttribute("aria-valuetext", `Current page ${percentage}%, next page ${100 - percentage}%`);
    if (save) {
      try { localStorage.setItem(storageKey, String(ratio)); } catch { /* Optional preference. */ }
    }
    onChange();
  }

  function stopDrag(cancel = false) {
    if (activePointer === null) return;
    const pointer = activePointer;
    activePointer = null;
    document.body.classList.remove("resizing-previews");
    if (separator.hasPointerCapture(pointer)) separator.releasePointerCapture(pointer);
    apply(cancel ? dragStart : ratio, true);
    dragStart = null;
  }

  separator.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || activePointer !== null) return;
    event.preventDefault();
    dragStart = ratio;
    activePointer = event.pointerId;
    separator.focus();
    separator.setPointerCapture(event.pointerId);
    document.body.classList.add("resizing-previews");
  });
  separator.addEventListener("pointermove", (event) => {
    if (event.pointerId !== activePointer) return;
    const bounds = layout.getBoundingClientRect();
    const handleWidth = separator.getBoundingClientRect().width;
    apply((event.clientX - bounds.left - handleWidth / 2) / Math.max(bounds.width - handleWidth, 1));
  });
  separator.addEventListener("pointerup", () => stopDrag());
  separator.addEventListener("pointercancel", () => stopDrag(true));
  separator.addEventListener("lostpointercapture", () => stopDrag());
  window.addEventListener("blur", () => stopDrag());
  separator.addEventListener("dblclick", () => apply(defaultRatio, true));
  separator.addEventListener("keydown", (event) => {
    // Divider navigation must never advance PDF pages.
    event.stopPropagation();
    const step = event.shiftKey ? 0.1 : 0.02;
    let next;
    switch (event.key) {
      case "ArrowLeft": next = ratio - step; break;
      case "ArrowRight": next = ratio + step; break;
      case "Home": next = min; break;
      case "End": next = max; break;
      case "Enter": next = defaultRatio; break;
      case "Escape": stopDrag(true); return;
      default: return;
    }
    event.preventDefault();
    apply(next, true);
  });
  apply(ratio);
}
