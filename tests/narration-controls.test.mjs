import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { NarrationControls } from "../narration-controls.mjs";
import { NarrationAudience } from "../narration-audience.mjs";

/** Minimal DOM behavior needed by the real presenter controls, including selects. */
class Element {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.listeners = new Map();
    this.options = [];
    this.dataset = {};
    this.textContent = "";
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.open = false;
    this.files = [];
    this.clickCount = 0;
  }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  dispatch(type) {
    for (const callback of this.listeners.get(type) || []) callback({ target: this, type });
  }
  click() {
    if (this.disabled) return;
    this.clickCount += 1;
    this.dispatch("click");
  }
  append(option) {
    this.options.push(option);
    if (this.options.length === 1) this.value = option.value;
  }
  replaceChildren() { this.options = []; this.value = ""; }
}

const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
Object.defineProperty(globalThis, "document", {
  configurable: true, value: { createElement: tagName => new Element(tagName) },
});
after(() => {
  if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
  else delete globalThis.document;
});

const offlineEnglish = { voiceURI: "os:english", name: "Offline English", lang: "en-US", localService: true, default: true };
const offlineDutch = { voiceURI: "os:dutch", name: "Offline Dutch", lang: "nl-NL", localService: true };
const onlineVoice = { voiceURI: "cloud:english", name: "Online English", lang: "en-US", localService: false };
const voiceKey = voice => JSON.stringify([voice.voiceURI, voice.name, voice.lang]);
const scriptText = (body = "Hello class.", filename = "Lecture.pdf", extraMetadata = "") =>
  `[format: math1-narration-v1]\n[pdf: ${filename}]\n[pdf-pages: 3]\n${extraMetadata}[slide: 1 | Introduction]\n[pages: 1-3]\n${body}`;
const textFile = (text, name = "Lecture.txt") => ({ name, size: Buffer.byteLength(text), text: async () => text });
const pdfFile = (name = "Lecture.pdf", bytes = new TextEncoder().encode("PDF bytes")) => ({ name, arrayBuffer: async () => bytes });
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt += 1) await flush();
  assert.ok(predicate(), "The expected asynchronous control state was not reached.");
}

function fixture(t, { autoEnd = false, voices = [offlineEnglish, onlineVoice, offlineDutch],
  navigate, onCancel } = {}) {
  const ids = ["play", "stop", "open", "input", "status", "text", "voice", "rate", "optional", "refresh", "settings", "voice-help"];
  const elements = Object.fromEntries(ids.map(id => [id, new Element(id === "voice" || id === "rate" ? "select" : "div")]));
  elements.rate.value = "1";
  elements.optional.checked = true;
  const root = { querySelector: selector => {
    const element = elements[selector.replace(/^#narration-/, "")];
    assert.ok(element, `Unknown control ${selector}`);
    return element;
  } };
  const state = { available: false, visible: true, page: 1, voices, utterances: [], pages: [], cancels: 0, navigationCancels: 0 };
  const synthesis = new Element();
  synthesis.getVoices = () => state.voices;
  synthesis.speak = utterance => {
    state.utterances.push(utterance);
    if (autoEnd) queueMicrotask(() => utterance.onend());
  };
  synthesis.cancel = () => { state.cancels += 1; };
  class Utterance { constructor(text) { this.text = text; } }
  const controls = new NarrationControls(root, {
    getPage: () => state.page,
    isAvailable: () => state.available,
    isVisible: () => state.visible,
    navigate: async page => { state.page = page; state.pages.push(page); return navigate?.(page); },
    onCancel: () => { state.navigationCancels += 1; onCancel?.(); },
    synthesis, Utterance,
  });
  t.after(() => controls.destroy());
  return { controls, elements, state, synthesis,
    bind: (pdf = pdfFile(), pageCount = 3, reader = null) => {
      state.available = true;
      controls.bind(pdf, pageCount, reader);
    },
    pick: async file => {
      elements.open.click();
      elements.input.files = [file];
      elements.input.dispatch("change");
      await waitFor(() => !controls.busy);
    },
  };
}

function noPlayback(state) {
  assert.deepEqual(state.pages, []);
  assert.deepEqual(state.utterances, []);
}

test("controls stay disabled until a PDF is available", t => {
  const { elements, controls, state } = fixture(t);
  assert.equal(elements.play.disabled, true);
  assert.equal(elements.open.disabled, true);
  assert.equal(elements.stop.disabled, true);
  assert.match(elements.status.textContent, /Open a PDF/);
  controls.toggle();
  noPlayback(state);
});

test("a folder-bound companion is read lazily only when Auto-play is requested", async t => {
  const { controls, bind, state, elements } = fixture(t);
  let reads = 0;
  bind(pdfFile(), 3, async () => { reads += 1; return textFile(scriptText()); });
  assert.equal(reads, 0);
  assert.match(elements.status.textContent, /matching .txt/);
  noPlayback(state);
  await controls.toggle(); await flush();
  assert.equal(reads, 1);
  assert.deepEqual(state.pages, [1]);
  assert.equal(state.utterances[0].text, "Hello class.");
  assert.equal(state.utterances[0].voice, offlineEnglish);
});

test("a single PDF gives explicit companion-file instructions without guessing a local path", async t => {
  const { controls, bind, elements, state } = fixture(t);
  bind();
  await controls.toggle();
  assert.match(elements.status.textContent, /Open narration/);
  assert.equal(elements.status.dataset.error, "true");
  noPlayback(state);
});

test("Open narration validates and shows a matching file before any playback", async t => {
  const { controls, bind, pick, elements, state } = fixture(t);
  bind();
  await pick(textFile(scriptText("A readable paragraph.\n[wait: Try the exercise.]")));
  assert.equal(controls.script.pdf, "Lecture.pdf");
  assert.match(elements.status.textContent, /Ready.*Lecture.txt/);
  assert.match(elements.text.textContent, /A readable paragraph/);
  assert.match(elements.text.textContent, /Try the exercise/);
  assert.equal(elements.input.value, "");
  noPlayback(state);
  await controls.toggle(); await flush();
  assert.equal(state.utterances[0].text, "A readable paragraph.");
});

test("a stale open-file dialog cannot attach a script to a subsequently opened PDF", async t => {
  const { controls, bind, elements, state } = fixture(t);
  bind(pdfFile("First.pdf"));
  elements.open.click();
  bind(pdfFile("Second.pdf"));
  elements.input.files = [textFile(scriptText("Wrong attachment.", "First.pdf"), "First.txt")];
  elements.input.dispatch("change"); await flush();
  assert.equal(controls.script, null);
  assert.equal(controls.binding.file.name, "Second.pdf");
  noPlayback(state);
});

test("missing folder narration gives visible feedback and leaves the presentation unchanged", async t => {
  const { controls, bind, elements, state } = fixture(t);
  bind(pdfFile(), 3, async () => null);
  await controls.toggle(); await flush();
  assert.match(elements.status.textContent, /No matching narration file/);
  assert.equal(elements.status.dataset.error, "true");
  assert.equal(controls.busy, false);
  noPlayback(state);
});

for (const [name, text, pattern] of [
  ["unsupported format", scriptText().replace("math1-narration-v1", "other-format"), /first line/],
  ["PDF filename mismatch", scriptText("Text.", "Different.pdf"), /Different.pdf.*Lecture.pdf/],
  ["PDF page-count mismatch", scriptText().replace("[pdf-pages: 3]", "[pdf-pages: 4]"), /expects 4 PDF pages/],
  ["unknown directive", scriptText("[unexpected: command]"), /Unknown directive/],
  ["checksum mismatch", scriptText("Text.", "Lecture.pdf", `[pdf-sha256: ${"a".repeat(64)}]\n`), /checksum does not match/],
]) {
  test(`invalid explicit script is rejected without playback: ${name}`, async t => {
    const { bind, controls, elements, state } = fixture(t);
    bind();
    await controls.loadScript(async () => textFile(text), true);
    assert.equal(controls.script, null);
    assert.match(elements.status.textContent, pattern);
    assert.equal(elements.status.dataset.error, "true");
    noPlayback(state);
  });
}

test("oversized scripts are rejected before reading their contents", async t => {
  const { bind, controls, elements, state } = fixture(t);
  bind();
  let reads = 0;
  await controls.loadScript(async () => ({ name: "Huge.txt", size: 2 * 1024 * 1024 + 1,
    text: () => { reads += 1; return scriptText(); } }), true);
  assert.equal(reads, 0);
  assert.match(elements.status.textContent, /exceeds 2 MB/);
  noPlayback(state);
});

test("Stop while a companion reader is pending ignores its eventual result", async t => {
  const pending = deferred();
  const { bind, controls, elements, state } = fixture(t);
  bind(pdfFile(), 3, () => pending.promise);
  const playback = controls.toggle();
  assert.equal(controls.busy, true);
  assert.equal(elements.stop.disabled, false);
  elements.stop.click();
  pending.resolve(textFile(scriptText()));
  await playback; await flush();
  assert.equal(controls.script, null);
  assert.equal(controls.busy, false);
  assert.match(elements.status.textContent, /Stopped/);
  noPlayback(state);
});

test("Stop while script text is pending ignores both completion and parse failure", async t => {
  for (const result of [scriptText(), "Invalid old text"]) {
    const pending = deferred();
    const { bind, controls, elements, state } = fixture(t);
    bind();
    const read = controls.loadScript(async () => ({ name: "Delayed.txt", size: 200, text: () => pending.promise }), true);
    await flush();
    controls.stop();
    pending.resolve(result);
    await read;
    assert.equal(controls.script, null);
    assert.match(elements.status.textContent, /Stopped/);
    assert.equal(elements.status.dataset.error, "false");
    noPlayback(state);
  }
});

test("Stop while SHA-256 verification is pending ignores its eventual digest", async t => {
  const digest = deferred();
  let digestCalls = 0;
  t.mock.method(globalThis.crypto.subtle, "digest", () => { digestCalls += 1; return digest.promise; });
  const expected = "ab".repeat(32);
  const { bind, controls, elements, state } = fixture(t);
  bind();
  const read = controls.loadScript(async () => textFile(scriptText("Text.", "Lecture.pdf", `[pdf-sha256: ${expected}]\n`)), true);
  await waitFor(() => digestCalls === 1);
  controls.stop();
  digest.resolve(Uint8Array.from({ length: 32 }, () => 0xab).buffer);
  await read;
  assert.equal(controls.script, null);
  assert.match(elements.status.textContent, /Stopped/);
  noPlayback(state);
});

test("changed PDF invalidates an old companion read even when filenames match", async t => {
  const pending = deferred();
  const { bind, controls, elements, state } = fixture(t);
  const oldPdf = pdfFile(), newPdf = pdfFile();
  assert.notEqual(oldPdf, newPdf);
  bind(oldPdf, 3, () => pending.promise);
  const read = controls.toggle();
  bind(newPdf);
  pending.resolve(textFile(scriptText("Old narration.")));
  await read; await flush();
  assert.equal(controls.binding.file, newPdf);
  assert.equal(controls.script, null);
  assert.match(elements.status.textContent, /Choose Open narration/);
  noPlayback(state);
});

test("changed PDF invalidates an old pending PDF-byte read", async t => {
  const bytes = deferred();
  const expected = createHash("sha256").update("old PDF").digest("hex");
  const { bind, controls, elements, state } = fixture(t);
  bind({ name: "Lecture.pdf", arrayBuffer: () => bytes.promise });
  const read = controls.loadScript(async () => textFile(scriptText("Old text.", "Lecture.pdf", `[pdf-sha256: ${expected}]\n`)), true);
  await flush();
  bind(pdfFile("New.pdf"));
  bytes.resolve(new TextEncoder().encode("old PDF"));
  await read;
  assert.equal(controls.script, null);
  assert.equal(controls.binding.file.name, "New.pdf");
  assert.match(elements.status.textContent, /Choose Open narration/);
  noPlayback(state);
});

test("a newer script load wins over an earlier pending read", async t => {
  const pending = deferred();
  const { bind, controls, elements, state } = fixture(t);
  bind();
  const oldRead = controls.loadScript(() => pending.promise);
  await controls.loadScript(async () => textFile(scriptText("New selected text."), "New.txt"));
  pending.resolve(textFile(scriptText("Old discarded text."), "Old.txt"));
  await oldRead;
  assert.match(elements.status.textContent, /New.txt/);
  assert.match(elements.text.textContent, /New selected text/);
  assert.doesNotMatch(elements.text.textContent, /Old discarded text/);
  noPlayback(state);
});

test("voice selector exposes only local voices and preserves choice after voiceschanged", async t => {
  const { elements, state, synthesis } = fixture(t);
  assert.deepEqual(elements.voice.options.map(option => option.textContent), ["Offline English (en-US)", "Offline Dutch (nl-NL)"]);
  assert.equal(elements.voice.value, voiceKey(offlineEnglish));
  elements.voice.value = voiceKey(offlineDutch);
  state.voices = [onlineVoice, { ...offlineDutch }, { ...offlineEnglish }];
  synthesis.dispatch("voiceschanged");
  assert.equal(elements.voice.value, voiceKey(offlineDutch));
  assert.equal(elements.voice.disabled, false);
  assert.match(elements["voice-help"].textContent, /local voices only/);
});

test("remote-only voices allow script reading but block speaking with visible guidance", async t => {
  const { bind, controls, elements, state } = fixture(t, { voices: [onlineVoice] });
  bind();
  assert.equal(elements.voice.options.length, 0);
  assert.equal(elements.voice.disabled, true);
  assert.match(elements["voice-help"].textContent, /No local voice/);
  await controls.loadScript(async () => textFile(scriptText("Readable without audio.")));
  assert.match(elements.text.textContent, /Readable without audio/);
  await controls.toggle(); await flush();
  assert.match(elements.status.textContent, /No installed local voice/);
  assert.equal(elements.status.dataset.error, "true");
  assert.equal(elements.settings.open, true);
  noPlayback(state);
});

test("refresh voices enables a voice installed after an initially empty list", async t => {
  const { bind, controls, elements, state } = fixture(t, { voices: [] });
  bind();
  await controls.loadScript(async () => textFile(scriptText()));
  await controls.toggle();
  assert.equal(elements.voice.disabled, true);
  state.voices = [offlineDutch];
  elements.refresh.click();
  assert.equal(elements.voice.disabled, false);
  assert.equal(elements.voice.value, voiceKey(offlineDutch));
  await controls.toggle(); await flush();
  assert.equal(state.utterances[0].voice, offlineDutch);
});

test("the real sample binds by checksum and starts at the current physical overlay", async t => {
  const text = await readFile(new URL("../sample-beamer.txt", import.meta.url), "utf8");
  const bytes = await readFile(new URL("../sample-beamer.pdf", import.meta.url));
  const { bind, controls, state } = fixture(t);
  state.page = 3;
  bind(pdfFile("sample-beamer.pdf", bytes), 4, async () => textFile(text, "sample-beamer.txt"));
  await controls.toggle(); await flush();
  assert.deepEqual(state.pages, [3]);
  assert.match(state.utterances[0].text, /^No, we can stay with the same slide/);
  assert.doesNotMatch(state.utterances.map(utterance => utterance.text).join(" "), /Here we have three points|Look now at the second bullet/);
});

test("wait instructions are visible with Continue and no automatic advancement", async t => {
  const { bind, controls, elements, state } = fixture(t, { autoEnd: true });
  bind(pdfFile(), 3, async () => textFile(scriptText("Before.\n[wait: Try the exercise. Continue when ready.]\nAfter.")));
  await controls.toggle(); await flush();
  assert.equal(controls.player.snapshot.phase, "waiting");
  assert.equal(elements.play.textContent, "Continue");
  assert.match(elements.status.textContent, /Waiting/);
  assert.equal(elements.text.textContent, "Try the exercise. Continue when ready.");
  assert.equal(elements.settings.open, true, "The wait instruction must be visible rather than concealed inside closed details.");
  assert.deepEqual(state.utterances.map(utterance => utterance.text), ["Before."]);
  await controls.toggle(); await flush();
  assert.deepEqual(state.utterances.map(utterance => utterance.text), ["Before.", "After."]);
  assert.equal(controls.player.snapshot.phase, "finished");
});

test("Continue while audience is hidden keeps playback paused and displays the reason", async t => {
  const { bind, controls, elements, state } = fixture(t);
  bind(pdfFile(), 3, async () => textFile(scriptText("First sentence. Second sentence.")));
  await controls.toggle(); await flush();
  controls.pause();
  assert.equal(controls.player.snapshot.phase, "paused");
  state.visible = false;
  await controls.toggle(); await flush();
  assert.equal(controls.player.snapshot.phase, "paused");
  assert.match(elements.status.textContent, /Restore the audience screen/);
  assert.equal(elements.status.dataset.error, "true");
  assert.equal(state.utterances.length, 1);
  state.visible = true;
  await controls.toggle(); await flush();
  assert.equal(controls.player.snapshot.phase, "running");
  assert.equal(elements.status.dataset.error, "false");
  assert.equal(state.utterances[1].text, "First sentence. Second sentence.");
});

test("changing narration settings stops speech and starts again only on explicit Auto-play", async t => {
  const { bind, controls, elements, state } = fixture(t);
  bind(pdfFile(), 3, async () => textFile(scriptText("First.")));
  await controls.toggle(); await flush();
  elements.rate.value = "1.25";
  elements.rate.dispatch("change");
  assert.equal(controls.player.snapshot.phase, "idle");
  assert.equal(state.cancels, 1);
  assert.match(elements.status.textContent, /Settings changed/);
  assert.equal(state.utterances.length, 1);
  await controls.toggle(); await flush();
  assert.equal(state.utterances[1].rate, 1.25);
});

test("destroy cancels speech and unregisters voice updates", async t => {
  const { bind, controls, state, synthesis } = fixture(t);
  bind(pdfFile(), 3, async () => textFile(scriptText()));
  await controls.toggle(); await flush();
  controls.destroy();
  assert.equal(state.cancels, 1);
  assert.equal(synthesis.listeners.get("voiceschanged").size, 0);
  assert.equal(controls.player.snapshot.phase, "idle");
});


/** Deferred render acknowledgments used to exercise the real cancellation hook. */
function pendingNavigation({ rejectOnCancel = true } = {}) {
  const requests = [];
  let active = null;
  return {
    requests,
    navigate: page => {
      active = { ...deferred(), page, cancelled: false };
      requests.push(active);
      return active.promise;
    },
    onCancel: () => {
      if (active) {
        active.cancelled = true;
        if (rejectOnCancel) active.reject(new Error("Rendering was cancelled."));
        active = null;
      }
    },
  };
}

test("Pause cancels pending rendering; Continue awaits a fresh navigation before speaking", async t => {
  const navigation = pendingNavigation({ rejectOnCancel: false });
  const { bind, controls, state } = fixture(t, navigation);
  bind(pdfFile(), 3, async () => textFile(scriptText("After rendering.")));
  await controls.toggle(); await flush();
  assert.equal(navigation.requests.length, 1);
  assert.equal(state.utterances.length, 0);
  const before = state.navigationCancels;
  controls.pause();
  assert.equal(state.navigationCancels, before + 1);
  assert.equal(navigation.requests[0].cancelled, true);
  await flush();
  assert.equal(controls.player.snapshot.phase, "paused");
  assert.equal(controls.player.snapshot.error, null);
  await controls.toggle(); await flush();
  assert.equal(navigation.requests.length, 2);
  navigation.requests[0].resolve(true);
  await flush();
  assert.equal(state.utterances.length, 0);
  assert.equal(controls.player.snapshot.phase, "running");
  navigation.requests[1].resolve(true);
  await flush();
  assert.deepEqual(state.utterances.map(utterance => utterance.text), ["After rendering."]);
});

test("Stop cancels pending rendering and a fresh Play cannot revive the canceled request", async t => {
  const navigation = pendingNavigation({ rejectOnCancel: false });
  const { bind, controls, elements, state } = fixture(t, navigation);
  bind(pdfFile(), 3, async () => textFile(scriptText("Fresh narration.")));
  await controls.toggle(); await flush();
  const before = state.navigationCancels;
  elements.stop.click();
  assert.equal(state.navigationCancels, before + 1);
  assert.equal(navigation.requests[0].cancelled, true);
  await flush();
  assert.equal(controls.player.snapshot.phase, "idle");
  assert.equal(controls.player.snapshot.error, null);
  await controls.toggle(); await flush();
  assert.equal(navigation.requests.length, 2);
  navigation.requests[0].resolve(true);
  await flush();
  assert.equal(state.utterances.length, 0);
  navigation.requests[1].resolve(true);
  await flush();
  assert.equal(state.utterances[0].text, "Fresh narration.");
});

test("replacing the PDF cancels old rendering and keeps its narration out of the new plan", async t => {
  const navigation = pendingNavigation();
  const { bind, controls, state } = fixture(t, navigation);
  bind(pdfFile(), 3, async () => textFile(scriptText("Old document.")));
  await controls.toggle(); await flush();
  const before = state.navigationCancels;
  bind(pdfFile("New.pdf"), 3, async () => textFile(scriptText("New document.", "New.pdf"), "New.txt"));
  assert.equal(state.navigationCancels, before + 1);
  assert.equal(navigation.requests[0].cancelled, true);
  assert.equal(controls.script, null);
  await flush();
  assert.equal(controls.player.snapshot.phase, "idle");
  await controls.toggle(); await flush();
  assert.equal(navigation.requests.length, 2);
  navigation.requests[0].resolve(true);
  await flush();
  assert.equal(state.utterances.length, 0);
  navigation.requests[1].resolve(true);
  await flush();
  assert.deepEqual(state.utterances.map(utterance => utterance.text), ["New document."]);
  assert.equal(controls.script.pdf, "New.pdf");
});

test("render failure invokes cancellation and does not restart on a late success", async t => {
  const navigation = pendingNavigation();
  const { bind, controls, elements, state } = fixture(t, navigation);
  bind(pdfFile(), 3, async () => textFile(scriptText("Must not run.")));
  await controls.toggle(); await flush();
  const before = state.navigationCancels;
  navigation.requests[0].reject(new Error("Audience rendering failed."));
  await flush();
  assert.equal(state.navigationCancels, before + 1);
  assert.equal(navigation.requests[0].cancelled, true);
  assert.equal(controls.player.snapshot.phase, "error");
  assert.match(elements.status.textContent, /Audience rendering failed/);
  navigation.requests[0].resolve(true);
  await flush();
  assert.equal(state.utterances.length, 0);
  assert.equal(controls.player.snapshot.phase, "error");
});


test("actual audience coordinator drops canceled acknowledgments and resends across Continue and Play", async t => {
  const sent = [];
  const context = { pdfUrl: "blob:lecture", currentPage: 1 };
  const timers = new Map();
  let timerId = 0;
  const audience = new NarrationAudience({
    send: message => sent.push(message),
    isConnected: () => true,
    getContext: () => context,
    setTimeout: callback => { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
  });
  const { bind, controls, state } = fixture(t, {
    navigate: page => { context.currentPage = page; return audience.request(page); },
    onCancel: () => audience.cancel(),
  });
  const acknowledge = message => audience.receive({ ...message, type: "audience-page-rendered", ok: true });
  bind(pdfFile(), 3, async () => textFile(scriptText("After audience rendering.")));
  await controls.toggle(); await flush();
  const first = sent[0];
  assert.equal(timers.size, 1);
  assert.equal(state.utterances.length, 0);
  controls.pause(); await flush();
  assert.equal(audience.pending, null);
  assert.equal(timers.size, 0);
  assert.equal(audience.resend(), false);
  assert.equal(acknowledge(first), false);
  await controls.toggle(); await flush();
  const continued = sent[1];
  assert.notEqual(continued.narrationRequest, first.narrationRequest);
  assert.equal(acknowledge(first), false);
  await flush();
  assert.equal(state.utterances.length, 0);
  assert.equal(acknowledge(continued), true);
  await flush();
  assert.equal(state.utterances.length, 1);
  controls.stop();
  await controls.toggle(); await flush();
  const stopped = sent[2];
  controls.stop(); await flush();
  assert.equal(audience.pending, null);
  assert.equal(audience.resend(), false);
  await controls.toggle(); await flush();
  const restarted = sent[3];
  assert.equal(acknowledge(stopped), false);
  await flush();
  assert.equal(state.utterances.length, 1);
  assert.equal(acknowledge(restarted), true);
  await flush();
  assert.equal(state.utterances.length, 2);
  assert.equal(timers.size, 0);
});
