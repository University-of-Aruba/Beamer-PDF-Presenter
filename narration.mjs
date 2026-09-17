/** Parse the local, line-oriented math1-narration-v1 sidecar format. */

const FORMAT = "math1-narration-v1";
const SHA256 = /^[a-f\d]{64}$/i;
const GLOBAL_KEYS = new Set(["format", "pdf", "pdf-pages", "pdf-sha256", "source"]);
const SLIDE_KEYS = new Set(["pages", "optional", "narration"]);
const PAUSES = Object.freeze({ brief: 1500, think: 5000, long: 10000 });

function fail(line, message) {
  const error = new SyntaxError(`Narration line ${line}: ${message}`);
  error.line = line;
  throw error;
}

function positiveInteger(value, line, name) {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) {
    fail(line, `${name} must be a positive integer.`);
  }
  return Number(value);
}

function checksum(value, line, name) {
  if (!SHA256.test(value)) fail(line, `${name} must contain exactly 64 hexadecimal characters.`);
  return value.toLowerCase();
}

function pauseMilliseconds(value, line) {
  if (Object.hasOwn(PAUSES, value)) return PAUSES[value];
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)s?$/.test(value)) {
    fail(line, 'Use pause "brief", "think", "long", or a positive number of seconds.');
  }
  const seconds = Number(value.replace(/s$/, ""));
  if (!(seconds > 0 && seconds <= 3600)) fail(line, "A pause must be greater than 0 and at most 3600 seconds.");
  return seconds * 1000;
}

/**
 * Parse narration without evaluating markup or interpreting mathematical text.
 *
 * Directives occupy their own lines. Paragraph line breaks remain intact. Every
 * parsed event and slide retains its one-based source line for error reporting.
 * Throws a line-numbered SyntaxError for malformed or contradictory input.
 */
export function parseNarration(text) {
  if (typeof text !== "string") throw new TypeError("Narration must be text.");
  const lines = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  if (lines[0].trim() !== `[format: ${FORMAT}]`) {
    fail(1, `The first line must be [format: ${FORMAT}].`);
  }
  const doc = { format: FORMAT, pdf: null, pdfPages: null, pdfSha256: null, source: null, slides: [] };
  const globalSeen = new Set(["format"]);
  const slideNumbers = new Set();
  let slide = null;
  let slideSeen = new Set();
  let bodyStarted = false;
  let page = null;
  let paragraph = [];
  let paragraphLine = 0;

  function needSlide(line) {
    if (!slide) fail(line, "Start a slide with [slide: number | title] first.");
  }

  function needPages(line) {
    needSlide(line);
    if (!slideSeen.has("pages")) fail(line, "Set [pages: first-last] before the slide body.");
  }

  function flushParagraph() {
    if (!paragraph.length) return;
    needPages(paragraphLine);
    bodyStarted = true;
    slide.events.push({ type: "speech", page, text: paragraph.join("\n"), line: paragraphLine });
    paragraph = [];
  }

  function finishSlide() {
    if (!slide) return;
    if (!slideSeen.has("pages")) fail(slide.line, `Slide ${slide.number} is missing its pages range.`);
    if (slide.silent) {
      const speech = slide.events.find(event => event.type === "speech");
      if (speech) fail(speech.line, "A [narration: none] slide cannot contain spoken paragraphs.");
    }
  }

  for (let index = 1; index < lines.length; index += 1) {
    const line = index + 1;
    const value = lines[index].trim();
    if (!value) { flushParagraph(); continue; }
    const directive = value.match(/^\[([A-Za-z][A-Za-z\d-]*)\s*:\s*(.*)\]$/);
    if (!directive) {
      // Ordinary intervals such as [0, 1] and literal math remain plain text.
      if (/^\[[A-Za-z][A-Za-z\d-]*\s*:/.test(value)
          || /^\[(?:format|pdf|pdf-pages|pdf-sha256|source|slide|pages|reveal|cue|pause|wait|optional|narration)(?:\s|\])/.test(value)) {
        fail(line, "Malformed directive; use [command: value] on its own line.");
      }
      needPages(line);
      if (!paragraph.length) paragraphLine = line;
      paragraph.push(lines[index].trim());
      continue;
    }
    flushParagraph();
    const [, key, raw] = directive;
    const argument = raw.trim();
    if (!argument) fail(line, `${key} requires a value.`);

    if (GLOBAL_KEYS.has(key)) {
      if (globalSeen.has(key)) fail(line, `Duplicate ${key} metadata.`);
      if (slide) fail(line, `${key} metadata must precede every slide.`);
      globalSeen.add(key);
      if (key === "pdf") {
        if (/[\\/:\u0000-\u001F\u007F]/.test(argument) || !/\.pdf$/i.test(argument)) {
          fail(line, "pdf must be a PDF filename without a folder path or URL.");
        }
        doc.pdf = argument;
      } else if (key === "pdf-pages") {
        doc.pdfPages = positiveInteger(argument, line, "pdf-pages");
      } else if (key === "pdf-sha256") {
        doc.pdfSha256 = checksum(argument, line, "pdf-sha256");
      } else if (key === "source") {
        const parts = argument.match(/^([^|\u0000-\u001F\u007F]+?)\s*\|\s*sha256\s*=\s*([^|]+)$/);
        if (!parts || !parts[1].trim()) fail(line, "Use [source: filename | sha256=<SHA-256>].");
        doc.source = { file: parts[1].trim(), sha256: checksum(parts[2].trim(), line, "source sha256") };
      }
      continue;
    }

    if (key === "slide") {
      if (!doc.pdf || !doc.pdfPages) fail(line, "pdf and pdf-pages metadata are required before slides.");
      finishSlide();
      const parts = argument.match(/^(\d+)\s*\|\s*(.+)$/);
      if (!parts || !parts[2].trim()) fail(line, "Use [slide: number | title].");
      const number = positiveInteger(parts[1], line, "slide number");
      if (slideNumbers.has(number)) fail(line, `Duplicate slide number ${number}.`);
      slideNumbers.add(number);
      slide = { number, title: parts[2].trim(), startPage: null, endPage: null, optional: false, silent: false, events: [], line };
      slideSeen = new Set();
      bodyStarted = false;
      page = null;
      doc.slides.push(slide);
      continue;
    }

    if (SLIDE_KEYS.has(key)) {
      needSlide(line);
      if (slideSeen.has(key)) fail(line, `Duplicate ${key} metadata for slide ${slide.number}.`);
      if (bodyStarted) fail(line, `${key} metadata must precede the slide body.`);
      slideSeen.add(key);
      if (key === "pages") {
        const range = argument.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
        if (!range) fail(line, "Use an inclusive pages range, such as [pages: 5-10].");
        const start = positiveInteger(range[1], line, "First page");
        const end = positiveInteger(range[2] || range[1], line, "Last page");
        if (end < start || end > doc.pdfPages) fail(line, `Pages must be ordered and within 1-${doc.pdfPages}.`);
        const previous = doc.slides.at(-2);
        if (previous && start <= previous.endPage) fail(line, "Slide page ranges must be ordered and must not overlap.");
        slide.startPage = start;
        slide.endPage = end;
        page = start;
      } else if (key === "optional") {
        if (argument !== "true" && argument !== "false") fail(line, "optional must be true or false.");
        slide.optional = argument === "true";
      } else {
        if (argument !== "none") fail(line, "The supported narration value is none.");
        slide.silent = true;
      }
      continue;
    }

    if (!["reveal", "cue", "pause", "wait"].includes(key)) fail(line, `Unknown directive "${key}".`);
    needPages(line);
    bodyStarted = true;
    if (key === "reveal") {
      const parts = argument.match(/^(\d+)(?:\s*\|\s*(.*))?$/);
      if (!parts) fail(line, "Use [reveal: overlay | caption].");
      const overlay = positiveInteger(parts[1], line, "Reveal overlay");
      const revealedPage = slide.startPage + overlay - 1;
      if (revealedPage > slide.endPage) fail(line, `Reveal ${overlay} is outside this slide's page range.`);
      page = revealedPage;
      slide.events.push({ type: "reveal", page, overlay, text: (parts[2] || "").trim(), line });
    } else if (key === "pause") {
      slide.events.push({ type: "pause", page, durationMs: pauseMilliseconds(argument, line), line });
    } else {
      slide.events.push({ type: key, page, text: argument, line });
    }
  }
  flushParagraph();
  finishSlide();
  if (!doc.pdf || !doc.pdfPages) fail(lines.length, "pdf and pdf-pages metadata are required.");
  if (!doc.slides.length) fail(lines.length, "At least one slide is required.");
  return doc;
}

/** Check the opened PDF's identity before any narration or navigation begins. */
export async function validateNarrationPdf(doc, { filename, pageCount, bytes }, cryptoImpl = globalThis.crypto) {
  if (doc.pdf !== filename) throw new Error(`Narration expects "${doc.pdf}", but the opened PDF is "${filename}".`);
  if (doc.pdfPages !== pageCount) throw new Error(`Narration expects ${doc.pdfPages} PDF pages, but the opened PDF has ${pageCount}.`);
  if (!doc.pdfSha256) return true;
  if (!cryptoImpl?.subtle || typeof cryptoImpl.subtle.digest !== "function") {
    throw new Error("SHA-256 verification is unavailable in this browser. Open the app on localhost or HTTPS.");
  }
  if (!(bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(bytes)) {
    throw new Error("The opened PDF's bytes are required for SHA-256 verification.");
  }
  let digest;
  try {
    digest = await cryptoImpl.subtle.digest("SHA-256", bytes);
  } catch {
    throw new Error("SHA-256 verification failed. Reload the PDF and try again.");
  }
  const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  if (actual !== doc.pdfSha256) throw new Error("Narration PDF checksum does not match the opened PDF. Select the matching narration file.");
  return true;
}

/**
 * Build playback from the current physical overlay through the remaining deck.
 *
 * Earlier overlay events in the initial logical slide are omitted. If that
 * overlay has no events, playback begins with the next later reveal. Subsequent
 * scripted reveals, including intentional revisits, preserve their order.
 * Reveal captions are always silent. Cues on silent slides use speak:false.
 */
export function buildNarrationPlan(doc, currentPage, { includeOptional = true } = {}) {
  if (!Number.isSafeInteger(currentPage) || currentPage < 1 || currentPage > doc.pdfPages) {
    throw new RangeError("The current PDF page is outside the narration document.");
  }
  const first = doc.slides.findIndex(slide => currentPage >= slide.startPage && currentPage <= slide.endPage);
  if (first < 0) throw new Error(`PDF page ${currentPage} has no narration slide. Select a covered page to start auto-play.`);
  const plan = [];
  for (let index = first; index < doc.slides.length; index += 1) {
    const slide = doc.slides[index];
    if (slide.optional && !includeOptional) continue;
    const initialPage = index === first ? currentPage : slide.startPage;
    const metadata = { slideNumber: slide.number, title: slide.title };
    let displayedPage = initialPage;
    plan.push({ ...metadata, type: "page", page: initialPage, line: slide.line });
    let start = 0;
    if (index === first && currentPage > slide.startPage) {
      start = slide.events.findIndex(event => event.page === currentPage);
      if (start < 0) start = slide.events.findIndex(event => event.page > currentPage);
      if (start < 0) start = slide.events.length;
    }
    const remaining = slide.events.slice(start);
    for (const event of remaining) {
      if (event.type === "reveal") {
        if (displayedPage !== event.page) {
          plan.push({ ...metadata, type: "page", page: event.page, line: event.line });
          displayedPage = event.page;
        }
        if (event.text) plan.push({ ...metadata, type: "caption", page: event.page, text: event.text, line: event.line, speak: false });
      } else {
        plan.push({ ...metadata, ...event, ...(event.type === "cue" ? { speak: !slide.silent } : {}) });
      }
    }
    if (slide.silent && !remaining.some(event => ["reveal", "pause", "wait"].includes(event.type))) {
      plan.push({ ...metadata, type: "wait", page: displayedPage, line: slide.line, text: "This slide has no narration. Continue when ready." });
    }
  }
  return plan;
}
