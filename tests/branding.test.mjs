import { test } from "node:test";
import assert from "node:assert/strict";
import { brandDetails, normalizeBrandFilename, parseBrandCatalog, loadBrandCatalog, wrapBrandName } from "../branding.mjs";
import { TimerDisplay } from "../timer-view.mjs";

test("logo filenames provide readable uppercase names and local encoded URLs", () => {
  assert.deepEqual(brandDetails("sisstem.png"), { filename: "sisstem.png", name: "SISSTEM", src: "logos/sisstem.png" });
  for (const filename of ["faculty_of_arts_and_science.png", "faculty-of-arts-and-science.PNG"]) {
    assert.equal(brandDetails(filename).name, "FACULTY OF ARTS AND SCIENCE");
  }
  assert.equal(brandDetails("école des arts.png").src, "logos/%C3%A9cole%20des%20arts.png");
});

test("unbranded mode contains no image URL", () => {
  assert.deepEqual(brandDetails(null), { filename: null, name: "BEAMER PDF PRESENTER", src: null });
});

test("paths, URLs, hidden files, empty labels and Windows device aliases are rejected", () => {
  for (const filename of ["../faculty.png", "logos/a.png", "C:\\logo.png", "https://site/a.png", ".secret.png", "brand.svg", "brand.png?x", "brand.png ", "---.png", "CON.png", "aux.extra.png", "x\n.png", "x".repeat(181) + ".png", 23, {}]) {
    assert.equal(normalizeBrandFilename(filename), null, String(filename));
    assert.equal(brandDetails(filename).src, null, String(filename));
  }
});

test("catalog discards unsafe names and duplicates without accepting caller supplied URLs", () => {
  assert.deepEqual(parseBrandCatalog({ filenames: ["z.png", "../x.png", "a.png", "z.png", { filename: "b.png", src: "https://remote.test" }] }).map(item => item.filename), ["a.png", "z.png"]);
  assert.deepEqual(parseBrandCatalog({ filenames: [] }), []);
  assert.throws(() => parseBrandCatalog({ files: [] }), TypeError);
});

test("catalog uses server discovery when available", async () => {
  const calls = [];
  const result = await loadBrandCatalog(async (path, options) => {
    calls.push({ path, options });
    return { ok: true, json: async () => ({ filenames: ["new_faculty.png"] }) };
  });
  assert.equal(result[0].name, "NEW FACULTY");
  assert.deepEqual(calls.map(call => call.path), ["api/brands"]);
  assert.equal(calls[0].options.redirect, "error");
});

test("static hosting can use its local catalog when the server endpoint is absent", async () => {
  const calls = [];
  const result = await loadBrandCatalog(async path => {
    calls.push(path);
    return { ok: path.endsWith(".json"), json: async () => ({ filenames: ["arts.png"] }) };
  });
  assert.equal(result[0].filename, "arts.png");
  assert.deepEqual(calls, ["api/brands", "logos/catalog.json"]);
});

test("unavailable catalogs retain the bundled default without external requests", async () => {
  const calls = [];
  const result = await loadBrandCatalog(async path => { calls.push(path); throw new Error("offline"); });
  assert.equal(result[0].filename, "sisstem.png");
  assert.deepEqual(calls, ["api/brands", "logos/catalog.json"]);
});

test("long faculty names fit at most three lines while preserving all words", () => {
  const name = "FACULTY OF ARTS AND SCIENCE WITH DEPARTMENT OF ADVANCED MATHEMATICAL AND PHYSICAL STUDIES";
  const lines = wrapBrandName(name);
  assert.ok(lines.length > 1 && lines.length <= 3);
  assert.equal(lines.join(" "), name);
  const longWord = "A".repeat(170);
  assert.equal(wrapBrandName(longWord).join(""), longWord);
  assert.ok(wrapBrandName(longWord).length <= 3);
});

test("timer brand changes preserve countdown state and scale long labels without clipping", () => {
  function node() {
    return {
      attributes: {}, children: [], textContent: "",
      setAttribute(name, value) { this.attributes[name] = String(value); },
      removeAttribute(name) { delete this.attributes[name]; },
      replaceChildren() { this.children = []; },
      append(child) { this.children.push(child); },
    };
  }
  const previousDocument = globalThis.document;
  globalThis.document = { createElementNS: node };
  try {
    const running = { phase: "running", endsAt: 1_800_000_020_000 };
    const display = { brandMark: node(), brandLabel: node(), analogSVG: node(), state: running };
    TimerDisplay.prototype.setBrand.call(display, "sisstem.png");
    assert.equal(display.brandMark.attributes.href, "logos/sisstem.png");
    assert.equal(display.analogSVG.attributes.viewBox, "0 0 400 580");
    assert.equal(display.brandLabel.children[0].textContent, "SISSTEM");
    TimerDisplay.prototype.setBrand.call(display, `${"A".repeat(170)}.png`);
    assert.equal(display.brandLabel.children.length, 3);
    assert.equal(display.brandLabel.children.map(child => child.textContent).join(""), "A".repeat(170));
    assert.ok(display.brandLabel.children.every(child => child.attributes.textLength === "344"));
    assert.equal(display.analogSVG.attributes.viewBox, "0 0 400 624");
    TimerDisplay.prototype.setBrand.call(display, "https://remote.test/logo.png");
    assert.equal(display.brandMark.attributes.href, undefined);
    assert.equal(display.brandMark.attributes.visibility, "hidden");
    assert.equal(display.brandLabel.children[0].textContent, "BEAMER PDF PRESENTER");
    assert.equal(display.state, running);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
