import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash, webcrypto } from "node:crypto";
import { parseNarration, validateNarrationPdf, buildNarrationPlan } from "../narration.mjs";

const header = "[format: math1-narration-v1]\n[pdf: My_Deck.pdf]\n[pdf-pages: 6]";
const deck = body => `${header}\n${body}`;
const oneSlide = body => deck(`[slide: 1 | Introduction]\n[pages: 1-6]\n${body}`);

function syntaxError(text, expected, line) {
  assert.throws(() => parseNarration(text), error => {
    assert.ok(error instanceof SyntaxError);
    assert.match(error.message, expected);
    assert.match(error.message, /Narration line \d+:/);
    if (line !== undefined) assert.equal(error.line, line);
    return true;
  });
}

test("the unchanged sample sidecar parses and identifies its supplied PDF", async () => {
  const text = await readFile(new URL("../sample-beamer.txt", import.meta.url), "utf8");
  const pdf = await readFile(new URL("../sample-beamer.pdf", import.meta.url));
  const doc = parseNarration(text);
  assert.equal(doc.format, "math1-narration-v1");
  assert.equal(doc.pdf, "sample-beamer.pdf");
  assert.equal(doc.pdfPages, 4);
  assert.equal(doc.pdfSha256, createHash("sha256").update(pdf).digest("hex"));
  assert.deepEqual(doc.slides.map(slide => [slide.number, slide.startPage, slide.endPage]), [[1, 1, 1], [2, 2, 3], [3, 4, 4]]);
  assert.equal(await validateNarrationPdf(doc, { filename: "sample-beamer.pdf", pageCount: 4, bytes: pdf }, webcrypto), true);
  const plan = buildNarrationPlan(doc, 3);
  assert.equal(plan[0].page, 3);
  assert.equal(plan[1].type, "caption");
  assert.equal(plan[1].speak, false);
  assert.match(plan[1].text, /second bullet/);
  assert.ok(!plan.some(event => event.text?.startsWith("Here we have three points")));
  assert.ok(plan.some(event => event.type === "page" && event.page === 4));
  assert.ok(plan.some(event => event.type === "wait" && /Try blanking/.test(event.text)));
});

test("all table directives parse into metadata and timed, navigational, and manual events", () => {
  const hash = "Ab".repeat(32);
  const doc = parseNarration(`${header}\n[pdf-sha256: ${hash}]\n[source: main.tex | sha256=${hash}]\n[slide: 3 | A Limit from the Unit Circle]\n[pages: 2-6]\n[optional: true]\nFirst paragraph.\n\n[reveal: 2 | Look now at triangle O A P.]\n[cue: Look now at the marked inputs.]\n[pause: brief]\n[wait: Try the exercise. Continue when ready.]`);
  assert.equal(doc.pdfSha256, hash.toLowerCase());
  assert.deepEqual(doc.source, { file: "main.tex", sha256: hash.toLowerCase() });
  const slide = doc.slides[0];
  assert.equal(slide.optional, true);
  assert.equal(slide.silent, false);
  assert.equal(slide.line, 6);
  assert.deepEqual(slide.events.map(event => [event.type, event.page]), [["speech", 2], ["reveal", 3], ["cue", 3], ["pause", 3], ["wait", 3]]);
  assert.equal(slide.events[1].overlay, 2);
  assert.equal(slide.events[3].durationMs, 1500);
  assert.equal(slide.events[4].durationMs, undefined);
});

test("UTF-8, mathematical notation, brackets, and literal HTML are data", () => {
  const paragraph = "E límite di f(x) = α² + √x.\n[0, 1] is an interval; \\[x \\to 0\\].\n<script>alert('literal')</script>";
  const doc = parseNarration(`\uFEFF${oneSlide(paragraph).replaceAll("\n", "\r\n")}`);
  assert.equal(doc.slides[0].events[0].text, paragraph);
  assert.equal(doc.slides[0].events.length, 1);
});

test("paragraph boundaries and source lines are retained", () => {
  const events = parseNarration(oneSlide("One line.\nAnother line.\n\nSecond paragraph.")).slides[0].events;
  assert.deepEqual(events.map(event => [event.text, event.line]), [["One line.\nAnother line.", 6], ["Second paragraph.", 9]]);
});

test("format is required on the first line with the supported version", () => {
  for (const invalid of ["", `\n${oneSlide("Hello")}`, oneSlide("Hello").replace("math1-narration-v1", "math1-narration-v2")]) {
    syntaxError(invalid, /first line/, 1);
  }
  assert.throws(() => parseNarration(null), TypeError);
});

test("PDF identity metadata is required before any slides", () => {
  syntaxError("[format: math1-narration-v1]\n[slide: 1 | Missing metadata]\n[pages: 1-1]", /pdf and pdf-pages/, 2);
  syntaxError("[format: math1-narration-v1]\n[pdf: My_Deck.pdf]", /pdf and pdf-pages/);
  syntaxError(header, /At least one slide/);
});

test("PDF names must be filenames, never paths or URLs", () => {
  for (const filename of ["/tmp/My_Deck.pdf", "../My_Deck.pdf", "C:\\My_Deck.pdf", "https://example.test/deck.pdf", "deck.txt", "a\u0000.pdf"]) {
    syntaxError(oneSlide("Hello").replace("My_Deck.pdf", filename), /PDF filename/, 2);
  }
  assert.equal(parseNarration(oneSlide("Hello").replace("My_Deck.pdf", "Papiamento é.PDF")).pdf, "Papiamento é.PDF");
});

test("PDF page totals must be positive safe integers", () => {
  for (const value of ["0", "-1", "1.5", "NaN", "9007199254740992"]) {
    syntaxError(oneSlide("Hello").replace("[pdf-pages: 6]", `[pdf-pages: ${value}]`), /positive integer/, 3);
  }
});

test("global and slide metadata cannot be duplicated", () => {
  for (const entry of ["[format: math1-narration-v1]", "[pdf: Other.pdf]", "[pdf-pages: 6]"]) {
    syntaxError(`${header}\n${entry}\n[slide: 1 | Intro]\n[pages: 1-1]`, /Duplicate/, 4);
  }
  for (const entry of ["[pdf-sha256: " + "a".repeat(64) + "]", "[source: main.tex | sha256=" + "b".repeat(64) + "]"]) {
    syntaxError(`${header}\n${entry}\n${entry}\n[slide: 1 | Intro]\n[pages: 1-1]`, /Duplicate/, 5);
  }
  for (const entry of ["[pages: 1-1]", "[optional: false]", "[narration: none]"]) {
    const pages = entry.startsWith("[pages:") ? "" : "[pages: 1-1]\n";
    syntaxError(deck(`[slide: 1 | Intro]\n${pages}${entry}\n${entry}`), /Duplicate/);
  }
});

test("metadata after spoken text or an action is rejected", () => {
  syntaxError(oneSlide("Hello.\n[optional: true]"), /precede the slide body/, 7);
  syntaxError(oneSlide("[wait: Continue]\n[narration: none]"), /precede the slide body/, 7);
  syntaxError(oneSlide("[pdf-sha256: " + "a".repeat(64) + "]"), /precede every slide/, 6);
});

test("slide headings need unique positive numbers and titles", () => {
  for (const heading of ["[slide: 0 | Intro]", "[slide: -1 | Intro]", "[slide: 1]", "[slide: 1 | ]"]) {
    syntaxError(deck(`${heading}\n[pages: 1-1]`), /positive integer|number \| title/, 4);
  }
  syntaxError(deck("[slide: 1 | Intro]\n[pages: 1-1]\nHello\n[slide: 1 | Duplicate]\n[pages: 2-3]"), /Duplicate slide number/, 7);
});

test("slides require pages before their body", () => {
  syntaxError(deck("[slide: 1 | Intro]"), /missing its pages range/, 4);
  for (const body of ["Hello.", "[cue: Look here]", "[pause: brief]", "[wait: Continue]", "[reveal: 2]"]) {
    syntaxError(deck(`[slide: 1 | Intro]\n${body}`), /Set \[pages/, 5);
  }
  syntaxError(deck("[pages: 1-1]"), /Start a slide/, 4);
});

test("page ranges must be valid, in bounds, ordered, and non-overlapping", () => {
  for (const range of ["0-1", "2-1", "1-7", "1.5-2", "1-to-3", "-1-2"]) {
    syntaxError(deck(`[slide: 1 | Intro]\n[pages: ${range}]`), /positive integer|Pages must|inclusive pages/, 5);
  }
  for (const range of ["2-4", "1-1"]) {
    syntaxError(deck(`[slide: 1 | First]\n[pages: 2-3]\nHello\n[slide: 2 | Second]\n[pages: ${range}]`), /ordered and must not overlap/, 8);
  }
  assert.equal(parseNarration(deck("[slide: 1 | One]\n[pages: 2]")).slides[0].endPage, 2);
});

test("unknown and malformed directives produce useful line errors", () => {
  for (const entry of ["[dance: now]", "[WAIT: Continue]"]) syntaxError(oneSlide(entry), /Unknown directive/, 6);
  for (const entry of ["[pause brief]", "[pause: brief", "[pause: brief] extra", "[cue]", "[wait:]"]) {
    syntaxError(oneSlide(entry), /Malformed directive|requires a value/, 6);
  }
});

test("optional values are strict booleans and narration only accepts none", () => {
  for (const value of ["yes", "1", "TRUE"]) syntaxError(oneSlide(`[optional: ${value}]`), /true or false/, 6);
  for (const value of ["false", "silent", "auto"]) syntaxError(oneSlide(`[narration: ${value}]`), /supported narration value is none/, 6);
  assert.equal(parseNarration(oneSlide("[optional: false]")).slides[0].optional, false);
});

test("PDF and provenance checksums use exactly 64 hexadecimal digits", () => {
  for (const hash of ["a".repeat(63), "g".repeat(64), "a".repeat(65)]) {
    syntaxError(`${header}\n[pdf-sha256: ${hash}]\n[slide: 1 | Intro]\n[pages: 1-1]`, /64 hexadecimal/, 4);
    syntaxError(`${header}\n[source: main.tex | sha256=${hash}]\n[slide: 1 | Intro]\n[pages: 1-1]`, /64 hexadecimal/, 4);
  }
  syntaxError(`${header}\n[source: main.tex]\n[slide: 1 | Intro]\n[pages: 1-1]`, /Use \[source/, 4);
});

test("all pause labels and positive decimal seconds convert to milliseconds", () => {
  const events = parseNarration(oneSlide(["brief", "think", "long", "2", "2.5s", ".5", "3600"].map(value => `[pause: ${value}]`).join("\n"))).slides[0].events;
  assert.deepEqual(events.map(event => event.durationMs), [1500, 5000, 10000, 2000, 2500, 500, 3600000]);
  for (const value of ["short", "0", "-1", "3600.1", "Infinity", "2 seconds", "1e3"]) syntaxError(oneSlide(`[pause: ${value}]`), /pause/, 6);
});

test("reveals select absolute pages within their logical slide", () => {
  const doc = parseNarration(deck("[slide: 2 | Overlay]\n[pages: 3-6]\nIntro\n[reveal: 2 | Next]\nMore\n[reveal: 4]"));
  assert.deepEqual(doc.slides[0].events.map(event => event.page), [3, 4, 4, 6]);
  for (const value of ["0", "-1", "5", "1.5"]) {
    syntaxError(deck(`[slide: 2 | Overlay]\n[pages: 3-6]\n[reveal: ${value}]`), /positive integer|outside|Use \[reveal/, 6);
  }
});

test("cues preserve the selected page and do not become page-navigation events", () => {
  const doc = parseNarration(oneSlide("[cue: Look at α.]\n[pause: brief]\n[reveal: 2 | Now β.]"));
  const plan = buildNarrationPlan(doc, 1);
  assert.deepEqual(plan.map(event => [event.type, event.page]), [["page", 1], ["cue", 1], ["pause", 1], ["page", 2], ["caption", 2]]);
  assert.equal(plan[1].speak, true);
  assert.equal(plan[4].speak, false);
  assert.ok(plan.every(event => event.slideNumber === 1 && event.title === "Introduction" && Number.isInteger(event.line)));
});

test("starting on a current overlay omits earlier overlay speech and pauses", () => {
  const doc = parseNarration(oneSlide("First.\n[pause: long]\n[reveal: 2 | Second cue.]\nSecond.\n[reveal: 3 | Third cue.]\nThird."));
  const plan = buildNarrationPlan(doc, 2);
  assert.deepEqual(plan.map(event => event.text).filter(Boolean), ["Second cue.", "Second.", "Third cue.", "Third."]);
  assert.deepEqual(plan.filter(event => event.type === "page").map(event => event.page), [2, 3]);
  assert.ok(!plan.some(event => event.type === "pause"));
});

test("starting on an unrevealed overlay waits for the next later scripted page", () => {
  const doc = parseNarration(oneSlide("First.\n[reveal: 4 | Fourth.]\nFour."));
  assert.deepEqual(buildNarrationPlan(doc, 2).filter(event => event.type === "page").map(event => event.page), [2, 4]);
  assert.deepEqual(buildNarrationPlan(doc, 6).map(event => event.type), ["page"]);
});

test("a repeated current overlay begins at its first occurrence and keeps later revisits", () => {
  const doc = parseNarration(oneSlide("First.\n[reveal: 2 | Second.]\nSecond text.\n[reveal: 1 | Return.]\nFirst revisited.\n[reveal: 2 | Second again.]"));
  const plan = buildNarrationPlan(doc, 2);
  assert.deepEqual(plan.filter(event => event.type === "page").map(event => event.page), [2, 1, 2]);
  assert.ok(!plan.some(event => event.text === "First."));
  assert.ok(plan.some(event => event.text === "First revisited."));
});

test("an exact current-page segment wins over an earlier higher-page reveal", () => {
  const doc = parseNarration(oneSlide("First.\n[reveal: 4 | Four.]\nFour text.\n[reveal: 2 | Two.]\nTwo text."));
  const plan = buildNarrationPlan(doc, 2);
  assert.deepEqual(plan.map(event => event.text).filter(Boolean), ["Two.", "Two text."]);
});

test("subsequent slides advance automatically and optional slides are included by default", () => {
  const doc = parseNarration(deck("[slide: 1 | First]\n[pages: 1-2]\nFirst.\n[slide: 2 | Optional]\n[pages: 3-4]\n[optional: true]\nOptional.\n[slide: 3 | Last]\n[pages: 5-6]\nLast."));
  assert.deepEqual(buildNarrationPlan(doc, 1).filter(event => event.type === "page").map(event => event.page), [1, 3, 5]);
  assert.deepEqual(buildNarrationPlan(doc, 1, { includeOptional: false }).filter(event => event.type === "page").map(event => event.page), [1, 5]);
  assert.deepEqual(buildNarrationPlan(doc, 3, { includeOptional: false }).map(event => event.slideNumber), [3, 3]);
});

test("silent slides have no speech and hold until Continue by default", () => {
  const doc = parseNarration(oneSlide("[narration: none]"));
  const plan = buildNarrationPlan(doc, 2);
  assert.deepEqual(plan.map(event => event.type), ["page", "wait"]);
  assert.equal(plan[1].page, 2);
  assert.match(plan[1].text, /Continue when ready/);
  syntaxError(oneSlide("[narration: none]\nContradictory speech."), /cannot contain spoken paragraphs/, 7);
});

test("silent slide cues remain unspoken and explicit pacing actions are preserved", () => {
  const doc = parseNarration(oneSlide("[narration: none]\n[cue: Look here.]\n[pause: 2]\n[reveal: 2 | Look there.]\n[wait: Continue.]"));
  const plan = buildNarrationPlan(doc, 1);
  assert.deepEqual(plan.map(event => event.type), ["page", "cue", "pause", "page", "caption", "wait"]);
  assert.ok(plan.filter(event => event.type === "cue").every(event => event.speak === false));
  assert.equal(plan.filter(event => event.type === "wait").length, 1);
  const cueOnly = parseNarration(oneSlide("[narration: none]\n[cue: Read this instruction.]"));
  assert.deepEqual(buildNarrationPlan(cueOnly, 1).map(event => event.type), ["page", "cue", "wait"]);
});

test("uncovered or out-of-bounds current pages cannot start playback", () => {
  const doc = parseNarration(deck("[slide: 1 | Partial]\n[pages: 2-3]\nHello."));
  assert.throws(() => buildNarrationPlan(doc, 1), /has no narration slide/);
  for (const page of [0, -1, 7, 1.5, "2"]) assert.throws(() => buildNarrationPlan(doc, page), /outside/);
});

test("filename and page count must match even without a checksum", async () => {
  const doc = parseNarration(oneSlide("Hello."));
  await assert.rejects(validateNarrationPdf(doc, { filename: "Other.pdf", pageCount: 6 }), /expects "My_Deck.pdf"/);
  await assert.rejects(validateNarrationPdf(doc, { filename: "My_Deck.pdf", pageCount: 5 }), /expects 6 PDF pages/);
  assert.equal(await validateNarrationPdf(doc, { filename: "My_Deck.pdf", pageCount: 6 }, null), true);
});

test("optional SHA-256 checks verify the exact bytes, including typed array slices", async () => {
  const bytes = new TextEncoder().encode("exact PDF contents");
  const hash = createHash("sha256").update(bytes).digest("hex");
  const doc = parseNarration(`${header}\n[pdf-sha256: ${hash}]\n[slide: 1 | Intro]\n[pages: 1-6]\nHello.`);
  const padded = new Uint8Array(bytes.length + 4);
  padded.set(bytes, 2);
  assert.equal(await validateNarrationPdf(doc, { filename: doc.pdf, pageCount: 6, bytes: padded.subarray(2, 2 + bytes.length) }, webcrypto), true);
  await assert.rejects(validateNarrationPdf(doc, { filename: doc.pdf, pageCount: 6, bytes: padded }, webcrypto), /checksum does not match/);
  await assert.rejects(validateNarrationPdf(doc, { filename: doc.pdf, pageCount: 6, bytes }, null), /unavailable/);
  await assert.rejects(validateNarrationPdf(doc, { filename: doc.pdf, pageCount: 6, bytes: "not bytes" }, webcrypto), /bytes are required/);
  await assert.rejects(validateNarrationPdf(doc, { filename: doc.pdf, pageCount: 6, bytes }, { subtle: { digest: async () => { throw new Error("disabled"); } } }), /verification failed/);
});
