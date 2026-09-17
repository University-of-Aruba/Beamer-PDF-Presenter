import { createCountdown, updateCountdown, remainingTime, countdownPhase,
  formatCountdown, parseDuration, isCountdownState } from "./countdown.mjs";
import { TimerDisplay } from "./timer-view.mjs";
import { initialiseSplitter } from "./splitter.mjs";
import { PresenterPointer, LaserOverlay, isLaserPoint } from "./laser-pointer.mjs";
import { DEFAULT_BRAND_FILENAME, brandDetails, loadBrandCatalog } from "./branding.mjs";
import { PdfLibrarySession, pdfEntriesFromFileList } from "./pdf-library.mjs";
import { bindPdfActivation } from "./pdf-activation.mjs";
import { NarrationControls } from "./narration-controls.mjs";
import { NarrationAudience } from "./narration-audience.mjs";
import { settlePreviewRenders } from "./preview-render.mjs";
import { PageRenderCache } from "./page-render-cache.mjs";

const PDFJS_VERSION = "6.3.289";
const MAX_RENDER_PIXEL_RATIO = 2;
const PDFJS_RUNTIME_TIMEOUT_MS = 4500;
const PDF_DOCUMENT_TIMEOUT_MS = 10000;

const urlParams = new URLSearchParams(window.location.search);
const appMode = urlParams.get("mode") === "audience" ? "audience" : "presenter";
const sessionId = urlParams.get("session") || createSessionId();

let pdfJsRuntimePromise = null;

function createSessionId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function clamp(value, minimum, maximum = Number.POSITIVE_INFINITY) {
  return Math.min(Math.max(value, minimum), maximum);
}

function formatError(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error || "Unknown error");
}

function withTimeout(promise, timeoutMs, label) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    window.clearTimeout(timeoutId);
  });
}

function isEditableTarget(target) {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target?.isContentEditable;
}

function createMessage(className, title, detail = "") {
  const wrapper = document.createElement("div");
  wrapper.className = className;

  if (title) {
    const strong = document.createElement("strong");
    strong.textContent = title;
    wrapper.append(strong);
  }

  if (detail) {
    const span = document.createElement("span");
    span.textContent = detail;
    wrapper.append(span);
  }
  return wrapper;
}

function showSurfaceMessage(surface, title, detail = "", className = "empty-state") {
  surface.replaceChildren(createMessage(className, title, detail));
}

function showEndCard(surface, text = "End of deck") {
  const card = document.createElement("div");
  card.className = "end-card";
  const strong = document.createElement("strong");
  strong.textContent = text;
  card.append(strong);
  surface.replaceChildren(card);
}

async function loadPdfJsRuntime() {
  if (pdfJsRuntimePromise) {
    return pdfJsRuntimePromise;
  }

  pdfJsRuntimePromise = (async () => {
    const localBase = new URL("./vendor/pdfjs/", import.meta.url);
    const runtime = {
      label: `PDF.js ${PDFJS_VERSION} (offline compatibility build)`,
      moduleUrl: new URL("pdf.min.mjs?build=legacy", localBase).href,
      workerUrl: new URL("pdf.worker.min.mjs?build=legacy", localBase).href,
      cMapUrl: new URL("cmaps/", localBase).href,
      iccUrl: new URL("iccs/", localBase).href,
      standardFontDataUrl: new URL("standard_fonts/", localBase).href,
      wasmUrl: new URL("wasm/", localBase).href,
    };

    try {
      // Check both files before importing; an incomplete extraction must never
      // trigger an external download. Abort stalled local checks as well.
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), PDFJS_RUNTIME_TIMEOUT_MS);
      try {
        const receiptResponse = await fetch(new URL("assets-manifest.json", localBase), {
          cache: "no-store", redirect: "error", signal: controller.signal,
        });
        if (!receiptResponse.ok) throw new Error("The offline PDF.js receipt is unavailable.");
        const receipt = await receiptResponse.json();
        if (receipt.version !== PDFJS_VERSION || receipt.build !== "legacy"
            || receipt.runtime_sources?.["pdf.min.mjs"] !== "package/legacy/build/pdf.min.mjs"
            || receipt.runtime_sources?.["pdf.worker.min.mjs"] !== "package/legacy/build/pdf.worker.min.mjs") {
          throw new Error("The offline PDF.js compatibility files must be refreshed together.");
        }
        await Promise.all([runtime.moduleUrl, runtime.workerUrl].map(async (url) => {
          const response = await fetch(url, {
            method: "HEAD",
            cache: "no-store",
            redirect: "error",
            signal: controller.signal,
          });
          if (!response.ok) {
            throw new Error(`${new URL(url).pathname.split("/").at(-1)} is unavailable (${response.status}).`);
          }
        }));
      } finally {
        window.clearTimeout(timeoutId);
        controller.abort();
      }

      const pdfjs = await withTimeout(
        import(runtime.moduleUrl),
        PDFJS_RUNTIME_TIMEOUT_MS,
        runtime.label,
      );
      if (pdfjs.version !== PDFJS_VERSION) {
        throw new Error(`Expected PDF.js ${PDFJS_VERSION}, found ${pdfjs.version || "an unknown version"}.`);
      }
      pdfjs.GlobalWorkerOptions.workerSrc = runtime.workerUrl;
      return { pdfjs, ...runtime };
    } catch (error) {
      throw new Error("Offline PDF.js could not be loaded. Check that the complete package was extracted "
        + `and use an up-to-date approved browser. ${formatError(error)}`);
    }
  })();

  try {
    return await pdfJsRuntimePromise;
  } catch (error) {
    // A later retry can succeed after the complete local package is restored.
    pdfJsRuntimePromise = null;
    throw error;
  }
}

class PdfJsRenderer {
  constructor() {
    this.kind = "pdfjs";
    this.label = "PDF.js";
    this.loadingTask = null;
    this.document = null;
    this.renderIds = new WeakMap();
    this.surfaceCaches = new WeakMap();
    this.renderCaches = new Set();
  }

  async load(pdfUrl) {
    const runtime = await loadPdfJsRuntime();
    this.label = runtime.label;
    this.pdfUrl = pdfUrl;
    this.loadingTask = runtime.pdfjs.getDocument({
      url: pdfUrl,
      cMapUrl: runtime.cMapUrl,
      cMapPacked: true,
      iccUrl: runtime.iccUrl,
      standardFontDataUrl: runtime.standardFontDataUrl,
      wasmUrl: runtime.wasmUrl,
      useSystemFonts: true,
      isEvalSupported: false,
    });
    this.document = await withTimeout(
      this.loadingTask.promise,
      PDF_DOCUMENT_TIMEOUT_MS,
      "PDF.js document loading",
    );
    return this.document.numPages;
  }

  raster(surface, pageNumber) {
    if (!this.document) return Promise.reject(new Error("PDF document is not loaded."));
    const loadedDocument = this.document;
    const pdfUrl = this.pdfUrl;
    const width = Math.max(surface.clientWidth - 2, 1);
    const height = Math.max(surface.clientHeight - 2, 1);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_RENDER_PIXEL_RATIO);
    let cache = this.surfaceCaches.get(surface);
    if (!cache) {
      // One displayed page and one prepared page at this surface's resolution.
      cache = new PageRenderCache(2);
      this.surfaceCaches.set(surface, cache);
      this.renderCaches.add(cache);
    }
    const key = `${pageNumber}:${width}:${height}:${pixelRatio}`;
    return cache.get(key, async controls => {
      const page = await loadedDocument.getPage(pageNumber);
      if (!controls.isActive() || this.document !== loadedDocument) return null;
      const baseViewport = page.getViewport({ scale: 1 });
      const cssScale = Math.max(Math.min(width / baseViewport.width, height / baseViewport.height), 0.01);
      const renderViewport = page.getViewport({ scale: cssScale * pixelRatio });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(Math.floor(renderViewport.width), 1);
      canvas.height = Math.max(Math.floor(renderViewport.height), 1);
      canvas.style.width = `${renderViewport.width / pixelRatio}px`;
      canvas.style.height = `${renderViewport.height / pixelRatio}px`;
      canvas.setAttribute("aria-label", `PDF page ${pageNumber}`);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Canvas rendering is unavailable in this browser.");
      const renderTask = page.render({
        canvasContext: context,
        viewport: renderViewport,
        background: "rgb(255,255,255)",
      });
      controls.onCancel(() => renderTask.cancel());
      await renderTask.promise;
      return { canvas, aspect: baseViewport.width / baseViewport.height, loadedDocument, pdfUrl };
    });
  }

  async render(surface, pageNumber) {
    const renderId = (this.renderIds.get(surface) || 0) + 1;
    this.renderIds.set(surface, renderId);
    const result = await this.raster(surface, pageNumber);
    if (result && this.document === result.loadedDocument && this.renderIds.get(surface) === renderId) {
      surface.dataset.pdfAspect = String(result.aspect);
      surface.dataset.renderedPage = String(pageNumber);
      surface.dataset.renderedDocument = result.pdfUrl;
      if (surface.firstElementChild !== result.canvas) surface.replaceChildren(result.canvas);
    }
  }

  prepare(surface, pageNumber) {
    if (!this.document || pageNumber > this.document.numPages) return;
    // A failed preparation is removed from the cache. Visible navigation retries
    // it through render(), where its failure can be reported to the lecturer.
    this.raster(surface, pageNumber).catch(() => {});
  }

  cancel(surface) {
    this.renderIds.set(surface, (this.renderIds.get(surface) || 0) + 1);
    this.surfaceCaches.get(surface)?.clear();
  }

  async destroy() {
    this.document = null;
    for (const cache of this.renderCaches) cache.clear();
    this.renderCaches.clear();
    this.surfaceCaches = new WeakMap();
    if (this.loadingTask?.destroy) {
      try {
        await this.loadingTask.destroy();
      } catch {
        // Teardown should not block loading another deck.
      }
    }
    this.document = null;
    this.loadingTask = null;
  }
}

async function createRenderer(pdfUrl) {
  const renderer = new PdfJsRenderer();
  try {
    const pageCount = await renderer.load(pdfUrl);
    return { renderer, pageCount };
  } catch (error) {
    await renderer.destroy();
    // Browser PDF embeds expose toolbars and cannot reliably show one slide.
    // Keep the active deck until a replacement loads through PDF.js.
    throw error;
  }
}

class PresentationBus {
  constructor(id) {
    this.id = id;
    this.handlers = new Set();
    this.broadcastChannel = null;

    if ("BroadcastChannel" in window) {
      this.broadcastChannel = new BroadcastChannel(`beamer-presenter:${id}`);
      this.broadcastChannel.addEventListener("message", (event) => {
        this.dispatch(event.data);
      });
    }

    window.addEventListener("message", (event) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      this.dispatch(event.data);
    });
  }

  dispatch(message) {
    if (!message || message.sessionId !== this.id) {
      return;
    }
    for (const handler of this.handlers) {
      handler(message);
    }
  }

  subscribe(handler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  send(message, fallbackWindow = null) {
    const payload = {
      ...message,
      sessionId: this.id,
      sentAt: Date.now(),
    };

    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage(payload);
      return;
    }

    if (fallbackWindow && !fallbackWindow.closed) {
      fallbackWindow.postMessage(payload, window.location.origin);
    }
  }

  close() {
    this.broadcastChannel?.close();
    this.handlers.clear();
  }
}

const bus = new PresentationBus(sessionId);

if (appMode === "audience") {
  initialiseAudience();
} else {
  initialisePresenter();
}

function initialisePresenter() {
  const presenterApp = document.getElementById("presenter-app");
  presenterApp.hidden = false;

  const elements = {
    deckName: document.getElementById("deck-name"),
    connectionStatus: document.getElementById("connection-status"),
    connectionLabel: document.getElementById("connection-label"),
    openPdfButton: document.getElementById("open-pdf-button"),
    openAudienceButton: document.getElementById("open-audience-button"),
    currentSurface: document.getElementById("current-slide"),
    nextSurface: document.getElementById("next-slide"),
    currentBadge: document.getElementById("current-page-badge"),
    nextBadge: document.getElementById("next-page-badge"),
    previousButton: document.getElementById("previous-button"),
    nextButton: document.getElementById("next-button"),
    pageInput: document.getElementById("page-input"),
    pageTotal: document.getElementById("page-total"),
    blankButton: document.getElementById("blank-button"),
    blankButtonLabel: document.getElementById("blank-button-label"),
    timerButton: document.getElementById("timer-button"),
    timerButtonLabel: document.getElementById("timer-button-label"),
    resetTimerButton: document.getElementById("reset-timer-button"),
    loadDemoButton: document.getElementById("load-demo-button"),
    rendererLabel: document.getElementById("renderer-label"),
    loadError: document.getElementById("pdf-load-error"),
    helpButton: document.getElementById("help-button"),
    shortcutHelp: document.getElementById("shortcut-help"),
    clock: document.getElementById("clock"),
    timer: document.getElementById("timer"),
    laserButton: document.getElementById("laser-button"),
    brandSelect: document.getElementById("brand-select"),
    refreshBrands: document.getElementById("refresh-brands-button"),
    brandMark: document.getElementById("brand-mark"),
    brandLabel: document.getElementById("brand-label"),
    brandIcon: document.getElementById("brand-icon"),
    fileInput: document.getElementById("pdf-file-input"),
    folderInput: document.getElementById("pdf-folder-input"),
    chooseFolder: document.getElementById("choose-folder-button"),
    folderName: document.getElementById("pdf-folder-name"),
    libraryStatus: document.getElementById("pdf-library-status"),
    libraryList: document.getElementById("pdf-library-list"),
    dropOverlay: document.getElementById("drop-overlay"),
    toast: document.getElementById("toast"),
    previewLayout: document.getElementById("preview-layout"),
    splitter: document.getElementById("preview-splitter"),
    currentStage: document.getElementById("current-stage"),
    currentHeading: document.getElementById("current-heading"),
    currentEyebrow: document.getElementById("current-eyebrow"),
    currentBlankedHint: document.getElementById("current-blanked-hint"),
    countdownForm: document.getElementById("countdown-duration-form"),
    countdownMinutes: document.getElementById("countdown-minutes"),
    countdownSeconds: document.getElementById("countdown-seconds"),
    countdownToggle: document.getElementById("countdown-toggle-button"),
    countdownReset: document.getElementById("countdown-reset-button"),
    countdownDisplay: document.getElementById("countdown-display"),
    countdownCorner: document.getElementById("countdown-corner"),
    countdownHide: document.getElementById("countdown-hide-button"),
    countdownReadout: document.getElementById("countdown-readout"),
    countdownStatus: document.getElementById("countdown-status"),
    countdownFeedback: document.getElementById("countdown-feedback"),
  };

  const state = {
    renderer: null,
    rendererKind: null,
    pdfUrl: null,
    fileName: null,
    loading: false,
    laserEnabled: false,
    laserSequence: 0,
    documentRevision: 0,
    brandFilename: DEFAULT_BRAND_FILENAME,
    totalPages: null,
    currentPage: 1,
    blanked: false,
    audienceWindow: null,
    audienceLastSeenAt: 0,
    loadGeneration: 0,
    renderGeneration: 0,
    toastTimeout: null,
    countdown: createCountdown(),
  };
  const countdownView = new TimerDisplay(elements.currentStage, elements.currentSurface);

  const pointer = new PresenterPointer(elements.currentStage, elements.currentSurface, (point) => {
    sendToAudience({ type: "laser", point, sequence: ++state.laserSequence,
      pdfUrl: state.pdfUrl, currentPage: state.currentPage });
  }, { isAvailable: () => !state.loading && state.rendererKind === "pdfjs" && !state.blanked
    && state.countdown.mode !== "analog" && elements.currentSurface.dataset.renderedPage === String(state.currentPage)
    && elements.currentSurface.dataset.renderedDocument === state.pdfUrl });
  let brandCatalog = [brandDetails(DEFAULT_BRAND_FILENAME)];
  let brandRefreshGeneration = 0;
  function applyBrand(filename, save = true) {
    const brand = brandDetails(filename);
    state.brandFilename = brand.filename;
    elements.brandSelect.value = brand.filename || "";
    elements.brandLabel.textContent = brand.filename ? brand.name : "";
    elements.brandMark.hidden = !brand.src;
    if (brand.src) {
      elements.brandMark.src = brand.src;
      elements.brandIcon.href = brand.src;
    } else {
      elements.brandMark.removeAttribute("src");
      elements.brandIcon.removeAttribute("href");
    }
    countdownView.setBrand(brand.filename);
    if (save) {
      try { localStorage.setItem("pdf-presenter:brand", brand.filename || ""); } catch { /* Optional preference. */ }
    }
    sendToAudience({ type: "brand", filename: brand.filename });
  }
  async function refreshBrands(initial = false) {
    const generation = ++brandRefreshGeneration;
    const catalog = await loadBrandCatalog();
    if (generation !== brandRefreshGeneration) return;
    brandCatalog = catalog;
    let selected = state.brandFilename;
    if (initial) {
      try {
        const saved = localStorage.getItem("pdf-presenter:brand");
        if (saved !== null) selected = saved || null;
      } catch { /* Optional preference. */ }
    }
    elements.brandSelect.replaceChildren();
    for (const brand of [brandDetails(null), ...brandCatalog]) {
      const option = document.createElement("option");
      option.value = brand.filename || "";
      option.textContent = brand.filename ? brand.name : "BEAMER PDF PRESENTER · no logo";
      elements.brandSelect.append(option);
    }
    if (selected && !brandCatalog.some(brand => brand.filename === selected)) selected = null;
    applyBrand(selected, false);
  }
  elements.brandMark.addEventListener("error", () => { elements.brandMark.hidden = true; });
  elements.brandSelect.addEventListener("change", () => applyBrand(elements.brandSelect.value || null));
  elements.refreshBrands.addEventListener("click", () => refreshBrands());
  refreshBrands(true);
  const narrationAudience = new NarrationAudience({
    send: sendToAudience,
    isConnected: () => Boolean(getAudiencePeer()),
    getContext: () => ({ pdfUrl: state.pdfUrl, currentPage: state.currentPage }),
  });
  const narration = new NarrationControls(presenterApp, {
    onCancel: () => narrationAudience.cancel(),
    getPage: () => state.currentPage,
    isAvailable: () => Boolean(state.renderer) && !state.loading,
    isVisible: () => !state.blanked && state.countdown.mode !== "analog",
    navigate: async page => {
      const results = await Promise.all([goToPage(page, false, true), narrationAudience.request(page)]);
      if (!results[0]) throw new Error("The current page could not finish rendering. Press Auto-play to retry.");
    },
  });
  const library = new PdfLibrarySession();
  let folderSelectionGeneration = 0;
  const timerState = {
    running: false,
    accumulatedMs: 0,
    startedAt: null,
  };

  let resizeFrame = null;
  let dragDepth = 0;

  function getAudiencePeer() {
    return state.audienceWindow && !state.audienceWindow.closed
      ? state.audienceWindow
      : null;
  }

  function sendToAudience(message) {
    bus.send(message, getAudiencePeer());
  }

  function showToast(message, type = "info", durationMs = 4200) {
    window.clearTimeout(state.toastTimeout);
    elements.toast.textContent = message;
    elements.toast.classList.toggle("error", type === "error");
    elements.toast.hidden = false;
    state.toastTimeout = window.setTimeout(() => {
      elements.toast.hidden = true;
    }, durationMs);
  }

  function setConnectionStatus(mode, label) {
    elements.connectionStatus.classList.toggle("connected", mode === "connected");
    elements.connectionStatus.classList.toggle("waiting", mode === "waiting");
    elements.connectionLabel.textContent = label;
  }

  function refreshConnectionStatus() {
    const peer = getAudiencePeer();
    if (!peer) {
      setConnectionStatus("closed", "Audience closed");
      return;
    }

    const isRecent = Date.now() - state.audienceLastSeenAt < 5500;
    if (isRecent) {
      setConnectionStatus("connected", "Audience connected");
    } else {
      setConnectionStatus("waiting", "Audience opening…");
    }
  }

  function refreshControlState() {
    const hasDeck = Boolean(state.renderer) && !state.loading;
    const atFirstPage = state.currentPage <= 1;
    const atLastPage = state.totalPages !== null && state.currentPage >= state.totalPages;
    const totalLabel = state.totalPages ?? "?";

    elements.currentBadge.textContent = hasDeck ? `${state.currentPage} / ${totalLabel}` : "- / -";
    elements.nextBadge.textContent = hasDeck && !atLastPage ? String(state.currentPage + 1) : "-";
    elements.previousButton.disabled = !hasDeck || atFirstPage;
    elements.nextButton.disabled = !hasDeck || atLastPage;
    elements.pageInput.disabled = !hasDeck;
    elements.pageInput.value = String(state.currentPage);
    elements.pageInput.max = state.totalPages === null ? "" : String(state.totalPages);
    elements.pageTotal.textContent = `of ${totalLabel}`;
    const analog = state.countdown.mode === "analog";
    elements.blankButton.disabled = !hasDeck && !analog && !state.blanked;
    elements.blankButtonLabel.textContent = state.blanked ? "Restore screen" : "Blank screen";
    elements.currentBlankedHint.hidden = !state.blanked;
    elements.currentHeading.textContent = analog ? "Analog countdown" : "Current page";
    elements.currentEyebrow.textContent = analog && hasDeck ? `On screen · page ${state.currentPage} preserved` : "On screen";
    countdownView.setState(state.countdown, hasDeck);
    refreshLibrarySelection();
    elements.laserButton.disabled = !state.laserEnabled && (!hasDeck || state.rendererKind !== "pdfjs" || analog);
    elements.laserButton.setAttribute("aria-pressed", String(state.laserEnabled));
    elements.laserButton.title = state.rendererKind === "native" ? "The laser pointer requires the bundled PDF.js renderer."
      : "Toggle the laser pointer, then move over the current slide (L).";
    pointer.refresh();
    narration.render();
  }

  async function renderPresenterSurfaces({ waitForNext = true } = {}) {
    if (!state.renderer) {
      refreshControlState();
      return false;
    }

    const generation = ++state.renderGeneration;
    const renderer = state.renderer;
    const page = state.currentPage;
    const pdfUrl = state.pdfUrl;
    refreshControlState();

    const current = renderer.render(elements.currentSurface, page);
    let next = null;
    const hasNextPage = state.totalPages === null || page < state.totalPages;
    if (hasNextPage) {
      next = renderer.render(elements.nextSurface, page + 1);
    } else {
      renderer.cancel?.(elements.nextSurface);
      showEndCard(elements.nextSurface);
    }

    const ready = await settlePreviewRenders(current, next, {
      waitForNext,
      isCurrent: () => generation === state.renderGeneration && renderer === state.renderer
        && page === state.currentPage && pdfUrl === state.pdfUrl,
      isCurrentRendered: () => elements.currentSurface.dataset.renderedPage === String(page)
        && elements.currentSurface.dataset.renderedDocument === pdfUrl,
      onError: error => showToast(`A page could not be rendered: ${formatError(error)}`, "error", 7000),
    });
    if (ready && hasNextPage) renderer.prepare(elements.currentSurface, page + 1);
    return ready;
  }

  function scheduleSurfaceRender() {
    if (!state.renderer || state.rendererKind !== "pdfjs") return;
    window.clearTimeout(resizeFrame);
    // The existing canvas remains visible while dragging; redraw at settled size.
    resizeFrame = window.setTimeout(() => {
      resizeFrame = null;
      renderPresenterSurfaces();
    }, 90);
  }

  function refreshLibrarySelection() {
    for (const button of elements.libraryList.children) {
      const current = button.dataset.entryId === library.activeId;
      button.setAttribute("aria-current", String(current));
      const page = library.pageFor(button.dataset.entryId);
      button.querySelector(".pdf-library-item-page").textContent = current
        ? `Current · page ${state.currentPage}` : page > 1 ? `Resume page ${page}` : "Open PDF";
    }
  }

  let libraryCleanups = [];

  function setLoadError(message = "") {
    elements.loadError.textContent = message;
    elements.loadError.hidden = !message;
  }

  function renderLibrary() {
    elements.folderName.textContent = library.folderName || "";
    elements.folderName.hidden = !library.folderName;
    elements.libraryStatus.textContent = library.entries.length
      ? `${library.entries.length} PDFs · Double-click or double-tap to open. Keyboard: Enter or Space.`
      : library.folderName ? "No PDFs directly in this folder. Choose another folder."
        : "Open a PDF folder to list its PDFs. Nothing opens until a filename is activated.";
    for (const cleanup of libraryCleanups) cleanup();
    libraryCleanups = [];
    elements.libraryList.replaceChildren();
    for (const entry of library.entries) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pdf-library-item";
      button.dataset.entryId = entry.id;
      const name = document.createElement("span");
      name.className = "pdf-library-item-name";
      name.textContent = entry.name;
      const page = document.createElement("span");
      page.className = "pdf-library-item-page";
      button.append(name, page);
      libraryCleanups.push(bindPdfActivation(button, () => openLibraryEntry(entry)));
      elements.libraryList.append(button);
    }
    refreshLibrarySelection();
  }

  async function openLibraryEntry(entry) {
    narration.stop();
    const generation = ++state.loadGeneration;
    pointer.reset();
    state.loading = true;
    refreshControlState();
    try {
      const file = await entry.getFile();
      if (generation !== state.loadGeneration || !library.entryFor(entry.id)) return;
      await loadPdfFile(file, { generation, entryId: entry.id, getNarrationFile: entry.getNarrationFile });
    } catch (error) {
      if (generation === state.loadGeneration) {
        state.loading = false;
        elements.deckName.textContent = state.fileName || "No PDF loaded";
        elements.rendererLabel.textContent = state.renderer ? `Renderer: ${state.renderer.label}` : "Renderer: not loaded";
        refreshControlState();
        setLoadError(`This PDF is unavailable: ${formatError(error)}`);
      }
    }
  }

  async function installFolder(folder, selectionGeneration) {
    if (selectionGeneration !== folderSelectionGeneration) return;
    ++state.loadGeneration;
    state.loading = false;
    library.replace(folder.name, folder.entries);
    renderLibrary();
    elements.deckName.textContent = state.fileName || "No PDF loaded";
    elements.rendererLabel.textContent = state.renderer ? `Renderer: ${state.renderer.label}` : "Renderer: not loaded";
    setLoadError();
    refreshControlState();
    // A completed load may still be awaiting old-renderer teardown. Finish
    // displaying the active state when this folder selection cancels its tail.
    await renderPresenterSurfaces();
  }

  function chooseFolder() {
    // The standard directory input also works in browsers without native
    // File System Access pickers. Its files are consumed locally, not uploaded.
    elements.folderInput.click();
  }

  function choosePdf() {
    elements.fileInput.click();
  }

  async function loadPdfFile(file, { generation = ++state.loadGeneration, entryId = null, getNarrationFile = null } = {}) {
    if (generation !== state.loadGeneration) return;
    if (!file || !(file.type === "application/pdf" || file.name?.toLowerCase().endsWith(".pdf"))) {
      showToast("Select a PDF file.", "error");
      return;
    }
    narration.stop();
    pointer.reset();
    state.loading = true;
    refreshControlState();
    setLoadError();
    elements.deckName.textContent = `Loading ${file.name}…`;
    elements.rendererLabel.textContent = "Renderer: loading…";
    let newUrl = null;
    let rendererResult = null;
    try {
      const arrayBuffer = await file.arrayBuffer();
      if (generation !== state.loadGeneration) return;
      newUrl = URL.createObjectURL(new Blob([arrayBuffer], { type: "application/pdf" }));
      rendererResult = await createRenderer(newUrl);
      if (generation !== state.loadGeneration) {
        await rendererResult.renderer.destroy();
        URL.revokeObjectURL(newUrl);
        return;
      }
      const oldUrl = state.pdfUrl;
      const oldRenderer = state.renderer;
      library.rememberPage(state.currentPage);
      const initialPage = entryId ? library.activate(entryId) : 1;
      if (!entryId) { library.clear(); renderLibrary(); }
      state.renderer = rendererResult.renderer;
      state.rendererKind = rendererResult.renderer.kind;
      state.pdfUrl = newUrl;
      state.fileName = file.name;
      state.documentRevision = generation;
      state.totalPages = rendererResult.pageCount;
      state.currentPage = clamp(initialPage, 1, state.totalPages ?? Number.POSITIVE_INFINITY);
      library.rememberPage(state.currentPage);
      state.blanked = false;
      state.loading = false;
      elements.deckName.textContent = file.name;
      elements.rendererLabel.textContent = `Renderer: ${rendererResult.renderer.label}`;
      document.title = `${file.name} · Beamer PDF Presenter`;
      narration.bind(file, state.totalPages, getNarrationFile);
      // Announce the new deck immediately; later navigation must not be overwritten
      // by a delayed completion of an older render.
      sendFullAudienceState();
      await oldRenderer?.destroy();
      if (oldUrl) window.setTimeout(() => URL.revokeObjectURL(oldUrl), 5000);
      if (generation !== state.loadGeneration) return;
      await renderPresenterSurfaces();
      if (generation !== state.loadGeneration) return;
      showToast(`Loaded ${file.name} (${state.totalPages} pages).`);
    } catch (error) {
      if (newUrl && newUrl !== state.pdfUrl) URL.revokeObjectURL(newUrl);
      if (generation === state.loadGeneration) setLoadError(`Could not open ${file.name}. ${formatError(error)}`
        + (state.renderer ? " The current presentation is unchanged." : ""));
    } finally {
      if (generation === state.loadGeneration) {
        state.loading = false;
        elements.deckName.textContent = state.fileName || "No PDF loaded";
        elements.rendererLabel.textContent = state.renderer ? `Renderer: ${state.renderer.label}` : "Renderer: not loaded";
        refreshControlState();
      }
    }
  }

  async function loadDemo() {
    narration.stop();
    const generation = ++state.loadGeneration;
    try {
      elements.loadDemoButton.disabled = true;
      const response = await fetch("./sample-beamer.pdf", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const file = new File([blob], "sample-beamer.pdf", { type: "application/pdf" });
      await loadPdfFile(file, { generation, getNarrationFile: async () => {
        const textResponse = await fetch("./sample-beamer.txt", { cache: "no-store" });
        if (!textResponse.ok) throw new Error("The sample narration file is missing from this copy of the app.");
        return new File([await textResponse.blob()], "sample-beamer.txt", { type: "text/plain" });
      } });
    } catch (error) {
      if (generation === state.loadGeneration) {
        state.loading = false;
        refreshControlState();
        showToast(`The demo could not be loaded: ${formatError(error)}`, "error");
      }
    } finally {
      elements.loadDemoButton.disabled = false;
    }
  }

  function sendFullAudienceState() {
    sendToAudience({
      type: "load",
      documentRevision: state.documentRevision,
      brandFilename: state.brandFilename,
      pdfUrl: state.pdfUrl,
      fileName: state.fileName,
      totalPages: state.totalPages,
      currentPage: state.currentPage,
      blanked: state.blanked,
      preferredRenderer: state.rendererKind || "pdfjs",
      countdown: state.countdown,
    });
  }

  function goToPage(requestedPage, announce = true, fromNarration = false) {
    if (!fromNarration) narration.stop();
    if (!state.renderer || state.loading) {
      return;
    }

    const parsed = Number.parseInt(String(requestedPage), 10);
    if (!Number.isFinite(parsed)) {
      refreshControlState();
      return;
    }

    const maximum = state.totalPages ?? Number.POSITIVE_INFINITY;
    const nextPage = clamp(parsed, 1, maximum);
    if (nextPage === state.currentPage) {
      refreshControlState();
      return fromNarration ? renderPresenterSurfaces({ waitForNext: false }) : true;
    }

    pointer.reset();
    state.currentPage = nextPage;
    library.rememberPage(nextPage);
    const rendered = renderPresenterSurfaces({ waitForNext: !fromNarration });
    if (announce) {
      sendToAudience({ type: "goto", pdfUrl: state.pdfUrl, currentPage: state.currentPage });
    }
    return rendered;
  }

  function toggleBlank(announce = true) {
    if (!state.renderer && state.countdown.mode !== "analog" && !state.blanked) {
      return;
    }
    pointer.reset();
    state.blanked = !state.blanked;
    if (state.blanked) narration.pause();
    refreshControlState();
    if (announce) {
      sendToAudience({ type: "blank", blanked: state.blanked });
    }
  }

  function openAudienceWindow() {
    const existing = getAudiencePeer();
    if (existing) {
      existing.focus();
      sendFullAudienceState();
      return;
    }

    const audienceUrl = new URL(window.location.href);
    audienceUrl.search = "";
    audienceUrl.searchParams.set("mode", "audience");
    audienceUrl.searchParams.set("session", sessionId);

    state.audienceLastSeenAt = 0;
    state.audienceWindow = window.open(
      audienceUrl.href,
      `beamer-audience-${sessionId}`,
      "popup=yes,width=1280,height=720,menubar=no,toolbar=no,location=no,status=no",
    );

    if (!state.audienceWindow) {
      showToast("The audience window was blocked. Allow pop-ups for this page, then try again.", "error", 8000);
      return;
    }

    refreshConnectionStatus();
    state.audienceWindow.focus();
  }

  function updateClock() {
    elements.clock.textContent = new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date());
  }

  function currentElapsedMs() {
    if (!timerState.running || timerState.startedAt === null) {
      return timerState.accumulatedMs;
    }
    return timerState.accumulatedMs + (performance.now() - timerState.startedAt);
  }

  function formatElapsed(milliseconds) {
    const totalSeconds = Math.max(Math.floor(milliseconds / 1000), 0);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
    }
    return [minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
  }

  function updateTimerDisplay() {
    elements.timer.textContent = formatElapsed(currentElapsedMs());
    elements.timerButtonLabel.textContent = timerState.running ? "Pause elapsed" : "Start elapsed";
  }

  function toggleTimer() {
    if (timerState.running) {
      timerState.accumulatedMs = currentElapsedMs();
      timerState.startedAt = null;
      timerState.running = false;
    } else {
      timerState.startedAt = performance.now();
      timerState.running = true;
    }
    updateTimerDisplay();
  }

  function resetTimer() {
    timerState.accumulatedMs = 0;
    timerState.startedAt = timerState.running ? performance.now() : null;
    updateTimerDisplay();
  }

  function countdownFeedback(message, error = false) {
    elements.countdownFeedback.textContent = message;
    elements.countdownFeedback.classList.toggle("error", error);
  }

  function updateCountdownUI() {
    const phase = countdownPhase(state.countdown);
    const text = formatCountdown(remainingTime(state.countdown));
    elements.countdownReadout.textContent = text;
    elements.countdownReadout.dataset.phase = phase;
    elements.countdownReadout.setAttribute("aria-label", `Countdown: ${text}`);
    elements.countdownToggle.textContent = phase === "running" ? "Pause countdown" : phase === "paused" ? "Resume countdown" : "Start countdown";
    elements.countdownToggle.disabled = phase === "finished";
    elements.countdownDisplay.value = state.countdown.mode;
    elements.countdownCorner.value = state.countdown.corner;
    elements.countdownCorner.disabled = state.countdown.mode !== "corner";
    elements.countdownHide.disabled = state.countdown.mode === "hidden";
    const statuses = { ready: "Ready", running: "Running", paused: "Paused", finished: "Time is up" };
    const displays = { hidden: "presenter only", corner: "on slide", analog: "analog on screen" };
    const status = `${statuses[phase]} · ${displays[state.countdown.mode]}`;
    // Do not flood screen readers with a live announcement every second.
    if (elements.countdownStatus.textContent !== status) elements.countdownStatus.textContent = status;
    elements.countdownStatus.dataset.phase = phase;
    countdownView.tick();
  }

  function changeCountdown(action) {
    const updated = updateCountdown(state.countdown, action);
    if (updated === state.countdown) return;
    pointer.reset();
    state.countdown = updated;
    refreshControlState();
    updateCountdownUI();
    sendToAudience({ type: "countdown", countdown: state.countdown });
  }

  function setCountdownDuration() {
    try {
      const durationMs = parseDuration(elements.countdownMinutes.value, elements.countdownSeconds.value);
      changeCountdown({ type: "set-duration", durationMs });
      elements.countdownMinutes.removeAttribute("aria-invalid");
      elements.countdownSeconds.removeAttribute("aria-invalid");
      countdownFeedback(`Duration set to ${formatCountdown(durationMs)}. Press Start countdown when ready.`);
    } catch (error) {
      elements.countdownMinutes.setAttribute("aria-invalid", "true");
      elements.countdownSeconds.setAttribute("aria-invalid", "true");
      countdownFeedback(formatError(error), true);
    }
  }

  function toggleCountdown() {
    changeCountdown({ type: "toggle" });
  }

  function hideCountdown() {
    changeCountdown({ type: "mode", mode: "hidden" });
    countdownFeedback("Countdown hidden from the audience. It continues running unless paused.");
  }

  function tickCountdown() {
    if (state.countdown.phase === "running" && remainingTime(state.countdown) <= 0) {
      changeCountdown({ type: "finish" });
      countdownFeedback("Time is up. Reset prepares another round; Hide timer returns to the PDF.");
    }
    updateCountdownUI();
  }

  function handleControlAction(action) {
    switch (action) {
      case "next":
        goToPage(state.currentPage + 1);
        break;
      case "previous":
        goToPage(state.currentPage - 1);
        break;
      case "first":
        goToPage(1);
        break;
      case "last":
        if (state.totalPages !== null) {
          goToPage(state.totalPages);
        }
        break;
      case "blank":
        toggleBlank();
        break;
      case "countdown-toggle":
        toggleCountdown();
        break;
      case "countdown-hide":
        hideCountdown();
        break;
      default:
        break;
    }
  }

  bus.subscribe((message) => {
    switch (message.type) {
      case "audience-ready":
      case "audience-heartbeat":
        state.audienceLastSeenAt = Date.now();
        refreshConnectionStatus();
        if (message.type === "audience-ready") {
          sendFullAudienceState();
        }
        break;
      case "audience-loaded":
        narrationAudience.resend();
        state.audienceLastSeenAt = Date.now();
        refreshConnectionStatus();
        break;
      case "audience-page-rendered":
        narrationAudience.receive(message);
        break;
      case "audience-closing":
        narrationAudience.cancel();
        state.audienceLastSeenAt = 0;
        refreshConnectionStatus();
        break;
      case "control":
        state.audienceLastSeenAt = Date.now();
        handleControlAction(message.action);
        break;
      default:
        break;
    }
  });

  initialiseSplitter(elements.previewLayout, elements.splitter, scheduleSurfaceRender);
  elements.countdownForm.addEventListener("submit", (event) => {
    event.preventDefault();
    setCountdownDuration();
  });
  elements.countdownToggle.addEventListener("click", toggleCountdown);
  elements.countdownReset.addEventListener("click", () => {
    changeCountdown({ type: "reset" });
    countdownFeedback(`Reset to ${formatCountdown(state.countdown.durationMs)} and paused.`);
  });
  elements.countdownDisplay.addEventListener("change", () => {
    changeCountdown({ type: "mode", mode: elements.countdownDisplay.value });
    const mode = state.countdown.mode;
    if (mode === "analog") narration.pause();
    countdownFeedback(mode === "analog"
      ? "Analog countdown replaces the audience PDF. Hide timer restores the current page."
      : mode === "corner" && !state.renderer
        ? "Load a PDF to display the corner timer, or select Full-screen analog."
        : mode === "corner"
          ? "Digital countdown stays visible across page changes until hidden."
          : "Countdown is private. Hiding it does not pause it.");
  });
  elements.countdownCorner.addEventListener("change", () => changeCountdown({ type: "corner", corner: elements.countdownCorner.value }));
  elements.countdownHide.addEventListener("click", hideCountdown);

  function toggleLaser() {
    if (elements.laserButton.disabled) return;
    state.laserEnabled = !state.laserEnabled;
    pointer.setEnabled(state.laserEnabled);
    refreshControlState();
    if (state.laserEnabled) showToast("Laser on. Move over the current PDF preview to point on the audience slide.");
  }
  elements.laserButton.addEventListener("click", toggleLaser);
  elements.openPdfButton.addEventListener("click", choosePdf);
  elements.chooseFolder.addEventListener("click", chooseFolder);
  elements.folderInput.addEventListener("change", async () => {
    const files = [...(elements.folderInput.files || [])];
    elements.folderInput.value = "";
    try {
      const folder = files.length ? pdfEntriesFromFileList(files) : { name: "Selected folder", entries: [] };
      await installFolder(folder, ++folderSelectionGeneration);
    } catch (error) { showToast(`This folder could not be opened: ${formatError(error)}`, "error"); }
  });
  elements.fileInput.addEventListener("change", () => {
    const [file] = elements.fileInput.files || [];
    if (file) {
      loadPdfFile(file);
    }
    elements.fileInput.value = "";
  });
  elements.openAudienceButton.addEventListener("click", openAudienceWindow);
  elements.previousButton.addEventListener("click", () => goToPage(state.currentPage - 1));
  elements.nextButton.addEventListener("click", () => goToPage(state.currentPage + 1));
  elements.pageInput.addEventListener("change", () => goToPage(elements.pageInput.value));
  elements.pageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      goToPage(elements.pageInput.value);
      elements.pageInput.blur();
    }
  });
  elements.blankButton.addEventListener("click", () => toggleBlank());
  elements.timerButton.addEventListener("click", toggleTimer);
  elements.resetTimerButton.addEventListener("click", resetTimer);
  elements.loadDemoButton.addEventListener("click", loadDemo);
  elements.helpButton.addEventListener("click", () => {
    const willShow = elements.shortcutHelp.hidden;
    elements.shortcutHelp.hidden = !willShow;
    elements.helpButton.setAttribute("aria-expanded", String(willShow));
  });

  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey
        || isEditableTarget(event.target) || event.target?.closest?.('[role="separator"], #narration-text')
        || (["Enter", " "].includes(event.key) && event.target?.closest?.("button, a, summary"))) {
      return;
    }

    let action = null;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
      case "PageDown":
      case " ":
      case "Enter":
        action = "next";
        break;
      case "ArrowLeft":
      case "ArrowUp":
      case "PageUp":
      case "Backspace":
        action = "previous";
        break;
      case "Home":
        action = "first";
        break;
      case "End":
        action = "last";
        break;
      case "b":
      case "B":
        action = "blank";
        break;
      case "c":
      case "C":
        action = "countdown-toggle";
        break;
      case "h":
      case "H":
        action = "countdown-hide";
        break;
      case "l":
      case "L":
        toggleLaser();
        break;
      case "o":
      case "O":
        openAudienceWindow();
        break;
      case "t":
      case "T":
        toggleTimer();
        break;
      case "r":
      case "R":
        resetTimer();
        break;
      default:
        break;
    }

    if (action) {
      event.preventDefault();
      handleControlAction(action);
    }
  });

  const dragEvents = ["dragenter", "dragover", "dragleave", "drop"];
  for (const eventName of dragEvents) {
    window.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
  }

  window.addEventListener("dragenter", () => {
    dragDepth += 1;
    elements.dropOverlay.hidden = false;
  });
  window.addEventListener("dragleave", () => {
    dragDepth = Math.max(dragDepth - 1, 0);
    if (dragDepth === 0) {
      elements.dropOverlay.hidden = true;
    }
  });
  window.addEventListener("drop", (event) => {
    dragDepth = 0;
    elements.dropOverlay.hidden = true;
    const files = [...(event.dataTransfer?.files || [])];
    const pdfFile = files.find((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
    if (pdfFile) {
      loadPdfFile(pdfFile);
    } else {
      showToast("No PDF file was found in the drop.", "error");
    }
  });

  const surfaceResizeObserver = new ResizeObserver(scheduleSurfaceRender);
  surfaceResizeObserver.observe(elements.currentSurface);
  surfaceResizeObserver.observe(elements.nextSurface);

  window.addEventListener("beforeunload", () => {
    narration.destroy();
    pointer.destroy();
    countdownView.destroy();
    bus.close();
    state.renderer?.destroy();
    if (state.pdfUrl) {
      URL.revokeObjectURL(state.pdfUrl);
    }
    if (getAudiencePeer()) {
      state.audienceWindow.close();
    }
  });

  updateClock();
  updateTimerDisplay();
  refreshControlState();
  updateCountdownUI();
  refreshConnectionStatus();
  window.setInterval(updateClock, 500);
  window.setInterval(updateTimerDisplay, 250);
  window.setInterval(tickCountdown, 100);
  document.addEventListener("visibilitychange", tickCountdown);
  window.setInterval(refreshConnectionStatus, 1000);

  if (urlParams.get("demo") === "1") {
    loadDemo();
  }
}

function initialiseAudience() {
  const audienceApp = document.getElementById("audience-app");
  audienceApp.hidden = false;

  const elements = {
    surface: document.getElementById("audience-slide"),
    blank: document.getElementById("audience-blank"),
    indicator: document.getElementById("audience-page-indicator"),
    fullscreenButton: document.getElementById("audience-fullscreen-button"),
    hint: document.getElementById("audience-hint"),
    stage: document.getElementById("audience-stage"),
  };

  const state = {
    renderer: null,
    pdfUrl: null,
    totalPages: null,
    currentPage: 1,
    blanked: false,
    loadGeneration: 0,
    loaded: false,
    loading: false,
    documentRevision: 0,
    laserSequence: 0,
    pointerTimeout: null,
    renderFrame: null,
    countdown: createCountdown(),
  };
  const countdownView = new TimerDisplay(elements.stage, elements.surface);
  const laser = new LaserOverlay(elements.stage, elements.surface);
  let brandCatalog = null;
  let requestedBrand = DEFAULT_BRAND_FILENAME;
  function applyAudienceBrand(filename) {
    requestedBrand = filename;
    const allowed = filename === null || brandCatalog?.some(brand => brand.filename === filename);
    if (allowed) countdownView.setBrand(filename);
  }
  loadBrandCatalog().then(catalog => { brandCatalog = catalog; applyAudienceBrand(requestedBrand); });
  function applyLaser(message) {
    if (message.pdfUrl !== state.pdfUrl || message.currentPage !== state.currentPage
        || !Number.isSafeInteger(message.sequence) || message.sequence <= state.laserSequence) return;
    state.laserSequence = message.sequence;
    if (!state.loaded || state.blanked || state.countdown.mode === "analog"
        || state.renderer?.kind !== "pdfjs" || !isLaserPoint(message.point)
        || elements.surface.dataset.renderedPage !== String(state.currentPage)
        || elements.surface.dataset.renderedDocument !== state.pdfUrl) laser.hide();
    else laser.show(message.point);
  }

  function applyCountdown(incoming) {
    if (!isCountdownState(incoming) || incoming.revision < state.countdown.revision) return;
    if (incoming.mode !== state.countdown.mode) laser.hide();
    state.countdown = { ...incoming };
    countdownView.setState(state.countdown, state.loaded);
    updateIndicator();
  }

  function sendToPresenter(message) {
    bus.send(message, window.opener);
  }

  function markPointerActive() {
    audienceApp.classList.add("pointer-active");
    window.clearTimeout(state.pointerTimeout);
    state.pointerTimeout = window.setTimeout(() => {
      audienceApp.classList.remove("pointer-active");
    }, 2400);
  }

  function applyBlank(blanked) {
    laser.hide();
    state.blanked = Boolean(blanked);
    elements.blank.hidden = !state.blanked;
    audienceApp.classList.toggle("is-blanked", state.blanked);
  }

  function updateIndicator() {
    if (!state.loaded || state.countdown.mode === "analog") {
      elements.indicator.hidden = true;
      return;
    }
    elements.indicator.hidden = false;
    elements.indicator.textContent = `${state.currentPage} / ${state.totalPages ?? "?"}`;
  }

  async function renderAudiencePage() {
    if (!state.renderer || !state.loaded) {
      return;
    }
    updateIndicator();
    const page = state.currentPage;
    const pdfUrl = state.pdfUrl;
    try {
      const renderer = state.renderer;
      await renderer.render(elements.surface, page);
      const ready = renderer === state.renderer && page === state.currentPage && pdfUrl === state.pdfUrl
        && elements.surface.dataset.renderedPage === String(page)
        && elements.surface.dataset.renderedDocument === pdfUrl;
      if (ready && page < state.totalPages) renderer.prepare(elements.surface, page + 1);
      return ready;
    } catch (error) {
      if (page !== state.currentPage || pdfUrl !== state.pdfUrl) return false;
      showSurfaceMessage(
        elements.surface,
        "Page rendering failed",
        formatError(error),
        "render-error",
      );
      return false;
    }
  }

  function scheduleAudienceRender() {
    if (!state.renderer || state.renderer.kind !== "pdfjs") {
      return;
    }
    if (state.renderFrame !== null) {
      cancelAnimationFrame(state.renderFrame);
    }
    state.renderFrame = requestAnimationFrame(() => {
      state.renderFrame = null;
      renderAudiencePage();
    });
  }

  async function loadAudienceDeck(message) {
    if (!Number.isSafeInteger(message.documentRevision) || message.documentRevision < state.documentRevision) return;
    state.documentRevision = message.documentRevision;
    applyAudienceBrand(message.brandFilename);
    applyCountdown(message.countdown);
    applyBlank(message.blanked);
    if (!message.pdfUrl) return;
    // Refocusing/reopening a connected audience must not reload the same PDF.
    if ((state.loaded || state.loading) && state.pdfUrl === message.pdfUrl) {
      goToAudiencePage(message.currentPage);
      return;
    }

    laser.hide();
    const generation = ++state.loadGeneration;
    state.pdfUrl = message.pdfUrl;
    state.loading = true;
    state.loaded = false;
    state.currentPage = message.currentPage || 1;
    state.totalPages = message.totalPages ?? null;
    applyBlank(message.blanked);
    showSurfaceMessage(elements.surface, "Loading presentation", message.fileName || "PDF");

    const previousRenderer = state.renderer;
    let result;
    try {
      result = await createRenderer(message.pdfUrl);
    } catch (error) {
      if (generation !== state.loadGeneration) return;
      state.loading = false;
      showSurfaceMessage(elements.surface, "Presentation could not be loaded", formatError(error), "render-error");
      return;
    }

    if (generation !== state.loadGeneration) {
      await result.renderer.destroy();
      return;
    }

    state.renderer = result.renderer;
    state.pdfUrl = message.pdfUrl;
    state.totalPages = result.pageCount ?? state.totalPages;
    state.loaded = true;
    state.loading = false;
    countdownView.setState(state.countdown, true);
    await previousRenderer?.destroy();
    await renderAudiencePage();
    sendToPresenter({
      type: "audience-loaded",
      renderer: state.renderer.kind,
      totalPages: state.totalPages,
    });
  }

  async function goToAudiencePage(pageNumber, narrationRequest = null) {
    const parsed = Number.parseInt(String(pageNumber), 10);
    if (!Number.isFinite(parsed)) {
      return;
    }
    const maximum = state.totalPages ?? Number.POSITIVE_INFINITY;
    laser.hide();
    state.currentPage = clamp(parsed, 1, maximum);
    const pdfUrl = state.pdfUrl;
    const currentPage = state.currentPage;
    // A loading audience will receive this request again after audience-loaded.
    if (state.loading) return;
    const ok = await renderAudiencePage();
    if (Number.isSafeInteger(narrationRequest)) {
      sendToPresenter({ type: "audience-page-rendered", narrationRequest, pdfUrl, currentPage, ok: Boolean(ok) });
    }
  }

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen({ navigationUI: "hide" });
      } else {
        await document.exitFullscreen();
      }
    } catch (error) {
      console.warn("Fullscreen request failed:", error);
      markPointerActive();
    }
  }

  function updateFullscreenLabel() {
    elements.fullscreenButton.textContent = document.fullscreenElement ? "Exit fullscreen" : "Fullscreen";
  }

  function sendControl(action) {
    sendToPresenter({ type: "control", action });
  }

  bus.subscribe((message) => {
    switch (message.type) {
      case "load":
        loadAudienceDeck(message);
        break;
      case "countdown":
        applyCountdown(message.countdown);
        break;
      case "brand":
        applyAudienceBrand(message.filename);
        // A logo added while this window is open becomes available on selection.
        if (message.filename && !brandCatalog?.some(brand => brand.filename === message.filename)) {
          loadBrandCatalog().then(catalog => { brandCatalog = catalog; applyAudienceBrand(requestedBrand); });
        }
        break;
      case "laser":
        applyLaser(message);
        break;
      case "goto":
        if (message.pdfUrl === state.pdfUrl) goToAudiencePage(message.currentPage, message.narrationRequest);
        break;
      case "blank":
        applyBlank(message.blanked);
        break;
      default:
        break;
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey
        || isEditableTarget(event.target)
        || (["Enter", " "].includes(event.key) && event.target?.closest?.("button, a"))) return;
    let action = null;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
      case "PageDown":
      case " ":
      case "Enter":
        action = "next";
        break;
      case "ArrowLeft":
      case "ArrowUp":
      case "PageUp":
      case "Backspace":
        action = "previous";
        break;
      case "Home":
        action = "first";
        break;
      case "End":
        action = "last";
        break;
      case "b":
      case "B":
        action = "blank";
        break;
      case "c":
      case "C":
        action = "countdown-toggle";
        break;
      case "h":
      case "H":
        action = "countdown-hide";
        break;
      case "f":
      case "F":
        event.preventDefault();
        toggleFullscreen();
        return;
      default:
        break;
    }

    if (action) {
      event.preventDefault();
      sendControl(action);
    }
  });

  elements.fullscreenButton.addEventListener("click", toggleFullscreen);
  elements.stage.addEventListener("dblclick", toggleFullscreen);
  document.addEventListener("fullscreenchange", updateFullscreenLabel);
  window.addEventListener("mousemove", markPointerActive);
  window.addEventListener("pointerdown", markPointerActive);
  window.addEventListener("resize", scheduleAudienceRender);

  const resizeObserver = new ResizeObserver(scheduleAudienceRender);
  resizeObserver.observe(elements.surface);

  window.addEventListener("beforeunload", () => {
    sendToPresenter({ type: "audience-closing" });
    laser.destroy();
    countdownView.destroy();
    state.renderer?.destroy();
    bus.close();
  });

  countdownView.setState(state.countdown, false);
  window.setInterval(() => countdownView.tick(), 100);
  document.addEventListener("visibilitychange", () => countdownView.tick());
  markPointerActive();
  updateFullscreenLabel();
  sendToPresenter({ type: "audience-ready" });
  window.setInterval(() => {
    sendToPresenter({ type: "audience-heartbeat" });
  }, 2000);
}
