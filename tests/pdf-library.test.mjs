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
