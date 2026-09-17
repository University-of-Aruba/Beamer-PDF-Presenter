import assert from "node:assert/strict";
import test from "node:test";
import { isPdfName, readPdfDirectory, pdfEntriesFromFileList, PdfLibrarySession } from "../pdf-library.mjs";

function file(name, relativePath = `Lectures/${name}`) {
  return { name, webkitRelativePath: relativePath };
}

function directory(name, items) {
  return {
    kind: "directory", name,
    async *entries() { yield* items; },
  };
}

test("extension filtering accepts mixed case and rejects PDF-like suffixes", () => {
  for (const name of ["lecture.pdf", "LECTURE.PDF", "test.PdF"]) assert.equal(isPdfName(name), true);
  for (const name of ["pdf", "lecture.pdf.txt", "lecturepdf", "lecture.pdf ", null]) {
    assert.equal(isPdfName(name), false);
  }
});

test("native discovery is lazy, immediate-only, and naturally sorted", async () => {
  let reads = 0;
  const handle = (name) => ({ kind: "file", name, async getFile() { reads += 1; return file(name); } });
  const first = handle("Lecture 2.PDF");
  const result = await readPdfDirectory(directory("Lectures", [
    ["Lecture 10.pdf", handle("Lecture 10.pdf")],
    ["notes.txt", handle("notes.txt")],
    ["Lecture 2.PDF", first],
    ["Archive.pdf", { kind: "directory", entries() { throw new Error("Must not recurse"); } }],
    ["lecture 1.pdf", handle("lecture 1.pdf")],
  ]));
  assert.equal(result.name, "Lectures");
  assert.deepEqual(result.entries.map((entry) => entry.name), ["lecture 1.pdf", "Lecture 2.PDF", "Lecture 10.pdf"]);
  assert.equal(reads, 0);
  assert.equal(result.entries[1].handle, first);
  assert.equal((await result.entries[1].getFile()).name, "Lecture 2.PDF");
  assert.equal(reads, 1);
});

test("directory permission and read failures are surfaced without a partial result", async () => {
  const denied = {
    kind: "directory", name: "Private",
    async *entries() { yield ["one.pdf", { kind: "file", getFile() {} }]; throw new Error("Permission denied"); },
  };
  await assert.rejects(readPdfDirectory(denied), /Permission denied/);
  await assert.rejects(readPdfDirectory({ kind: "file" }), /permitted PDF folder/);
  const missing = { kind: "file", async getFile() { throw new Error("File removed"); } };
  const result = await readPdfDirectory(directory("Lectures", [["gone.pdf", missing]]));
  await assert.rejects(result.entries[0].getFile(), /File removed/);
});

test("fallback excludes nested PDFs and unrelated files while retaining exact File objects", async () => {
  const selected = file("Lecture 2.PDF");
  const result = pdfEntriesFromFileList([
    file("nested.pdf", "Lectures/Archive/nested.pdf"),
    file("Lecture 10.pdf"), file("notes.txt"), selected,
  ]);
  assert.equal(result.name, "Lectures");
  assert.deepEqual(result.entries.map((entry) => entry.name), ["Lecture 2.PDF", "Lecture 10.pdf"]);
  assert.equal(await result.entries[0].getFile(), selected);
});

test("fallback does not invent folder access from ordinary files or combine roots", () => {
  assert.throws(() => pdfEntriesFromFileList([file("one.pdf", "")]), /Choose a folder/);
  assert.throws(() => pdfEntriesFromFileList([file("one.pdf", "A/one.pdf"), file("two.pdf", "B/two.pdf")]), /one PDF folder/);
  assert.throws(() => pdfEntriesFromFileList([file("one.pdf", "A/../one.pdf")]), /Choose a folder/);
});

test("empty selections and folders containing no immediate PDFs produce empty libraries", async () => {
  assert.deepEqual(pdfEntriesFromFileList([]), { name: "", entries: [] });
  assert.deepEqual(pdfEntriesFromFileList([file("notes.txt"), file("nested.pdf", "Lectures/Archive/nested.pdf")]), { name: "Lectures", entries: [] });
  assert.deepEqual(await readPdfDirectory(directory("Empty", [])), { name: "Empty", entries: [] });
});

test("same names in successive folder selections have distinct entry identities", () => {
  const first = pdfEntriesFromFileList([file("lecture.pdf", "A/lecture.pdf")]);
  const second = pdfEntriesFromFileList([file("lecture.pdf", "B/lecture.pdf")]);
  const again = pdfEntriesFromFileList([file("lecture.pdf", "A/lecture.pdf")]);
  assert.equal(new Set([first.entries[0].id, second.entries[0].id, again.entries[0].id]).size, 3);
});

test("saved pages follow entries through switching without selecting unrelated single files", () => {
  const folder = pdfEntriesFromFileList([file("one.pdf"), file("two.pdf")]);
  const session = new PdfLibrarySession();
  assert.equal(session.activeId, null);
  assert.deepEqual(session.entries, []);
  session.replace(folder.name, folder.entries);
  const [one, two] = session.entries;
  assert.equal(session.activate(one.id), 1);
  session.rememberPage(7);
  assert.equal(session.activate(two.id), 1);
  session.rememberPage(3);
  assert.equal(session.activate(one.id), 7);
  session.deactivate();
  assert.equal(session.rememberPage(24), false);
  assert.equal(session.pageFor(one.id), 7);
  assert.equal(session.pageFor(two.id), 3);
  assert.equal(session.entryFor("unknown"), null);
  assert.throws(() => session.activate("unknown"), /not in the selected folder/);
  assert.equal(session.activeId, null);
});

test("replacing a folder clears its page memory and rejects stale entry IDs", () => {
  const session = new PdfLibrarySession();
  const first = pdfEntriesFromFileList([file("same.pdf", "A/same.pdf")]);
  session.replace(first.name, first.entries);
  session.activate(first.entries[0].id);
  session.rememberPage(8);
  const second = pdfEntriesFromFileList([file("same.pdf", "B/same.pdf")]);
  session.replace(second.name, second.entries);
  assert.equal(session.folderName, "B");
  assert.equal(session.activeId, null);
  assert.equal(session.activate(second.entries[0].id), 1);
  assert.throws(() => session.pageFor(first.entries[0].id), /not in the selected folder/);
  session.clear();
  assert.equal(session.folderName, "");
  assert.deepEqual(session.entries, []);
  assert.equal(session.activeId, null);
});

test("invalid replacement and invalid page numbers do not corrupt the active session", () => {
  const session = new PdfLibrarySession();
  const folder = pdfEntriesFromFileList([file("one.pdf")]);
  session.replace(folder.name, folder.entries);
  session.activate(folder.entries[0].id);
  session.rememberPage(4);
  assert.throws(() => session.replace("Bad", [folder.entries[0], folder.entries[0]]), /unique/);
  assert.equal(session.folderName, "Lectures");
  assert.equal(session.pageFor(folder.entries[0].id), 4);
  for (const page of [0, -1, 1.5, Infinity, NaN, "2"]) {
    assert.throws(() => session.rememberPage(page), /positive integer/);
  }
  assert.equal(session.pageFor(folder.entries[0].id), 4);
});

test("untrusted filenames remain literal data and duplicate names are rejected", async () => {
  const literal = '<img src=x onerror=alert(1)>.pdf';
  const result = pdfEntriesFromFileList([file(literal)]);
  assert.equal(result.entries[0].name, literal);
  assert.equal(result.entries[0].id.includes("<"), false);
  assert.equal((await result.entries[0].getFile()).name, literal);
  assert.throws(() => pdfEntriesFromFileList([file("one.pdf"), file("one.pdf")]), /duplicate filenames/);
});


test("native sidecars match exact stems with case-insensitive extensions and stay lazy", async () => {
  const reads = [];
  const pdf = file("Lecture 2.PDF");
  const narration = file("Lecture 2.TxT");
  const handle = (value) => ({ kind: "file", async getFile() { reads.push(value.name); return value; } });
  const result = await readPdfDirectory(directory("Lectures", [
    [pdf.name, handle(pdf)],
    [narration.name, handle(narration)],
    ["lecture 2.txt", handle(file("lecture 2.txt"))],
    ["Lecture 2.pdf.txt", handle(file("Lecture 2.pdf.txt"))],
    ["Lecture 2.txt.backup", handle(file("Lecture 2.txt.backup"))],
    ["Archive", { kind: "directory", entries() { throw new Error("Must not recurse"); } }],
    ["Lecture 3.pdf", handle(file("Lecture 3.pdf"))],
    ["Lecture 3.txt", { kind: "directory", getFile() { throw new Error("Not a file"); } }],
  ]));
  assert.deepEqual(result.entries.map((entry) => entry.name), ["Lecture 2.PDF", "Lecture 3.pdf"]);
  assert.deepEqual(reads, []);
  assert.equal(await result.entries[0].getFile(), pdf);
  assert.deepEqual(reads, [pdf.name]);
  assert.equal(await result.entries[0].getNarrationFile(), narration);
  assert.deepEqual(reads, [pdf.name, narration.name]);
  assert.equal(await result.entries[1].getNarrationFile(), null);
  assert.deepEqual(reads, [pdf.name, narration.name]);
});

test("native ambiguous or unreadable narration does not prevent a PDF from opening", async () => {
  const pdf = file("Lecture.pdf");
  let reads = 0;
  const textHandle = { kind: "file", async getFile() { reads += 1; throw new Error("Permission denied"); } };
  const result = await readPdfDirectory(directory("Lectures", [
    [pdf.name, { kind: "file", async getFile() { return pdf; } }],
    ["Lecture.txt", textHandle],
    ["Lecture.TXT", textHandle],
  ]));
  assert.equal(await result.entries[0].getFile(), pdf);
  await assert.rejects(result.entries[0].getNarrationFile(), /Multiple narration files match Lecture\.pdf/);
  assert.equal(reads, 0);
  const unreadable = await readPdfDirectory(directory("Lectures", [
    [pdf.name, { kind: "file", async getFile() { return pdf; } }], ["Lecture.txt", textHandle],
  ]));
  assert.equal(await unreadable.entries[0].getFile(), pdf);
  await assert.rejects(unreadable.entries[0].getNarrationFile(), /Permission denied/);
  assert.equal(reads, 1);
});

test("fallback sidecars retain exact files without reading their text or nested siblings", async () => {
  let reads = 0;
  const pdf = file("deck.PDF");
  const narration = { ...file("deck.TXT"), text() { reads += 1; throw new Error("Not needed for discovery"); } };
  const result = pdfEntriesFromFileList([
    pdf, narration, file("deck.txt", "Lectures/Archive/deck.txt"),
    file("Deck.txt"), file("deck.pdf.txt"), file("deck.txt.backup"),
    file("other.pdf"), file("other.txt", "Lectures/Archive/other.txt"),
  ]);
  assert.deepEqual(result.entries.map((entry) => entry.name), ["deck.PDF", "other.pdf"]);
  assert.equal(reads, 0);
  assert.equal(await result.entries[0].getFile(), pdf);
  assert.equal(await result.entries[0].getNarrationFile(), narration);
  assert.equal(await result.entries[1].getNarrationFile(), null);
  assert.equal(reads, 0);
});

test("fallback ambiguity is reported only when narration is requested", async () => {
  const pdf = file("deck.pdf");
  const folder = pdfEntriesFromFileList([pdf, file("deck.txt"), file("deck.TXT")]);
  assert.equal(folder.entries.length, 1);
  assert.equal(await folder.entries[0].getFile(), pdf);
  await assert.rejects(folder.entries[0].getNarrationFile(), /Multiple narration files match deck\.pdf.*deck\.txt, deck\.TXT/);
});

test("captured narration readers cannot switch to a later folder's matching filename", async () => {
  const firstNarration = file("same.txt", "A/same.txt");
  const secondNarration = file("same.txt", "B/same.txt");
  const first = pdfEntriesFromFileList([file("same.pdf", "A/same.pdf"), firstNarration]);
  const second = pdfEntriesFromFileList([file("same.pdf", "B/same.pdf"), secondNarration]);
  const session = new PdfLibrarySession();
  session.replace(first.name, first.entries);
  const originalEntry = session.entries[0];
  session.replace(second.name, second.entries);
  assert.equal(await originalEntry.getNarrationFile(), firstNarration);
  assert.equal(await session.entries[0].getNarrationFile(), secondNarration);
  session.clear();
  assert.equal(await originalEntry.getNarrationFile(), firstNarration);
});
