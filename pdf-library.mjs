/** Session-only PDF folder discovery and page memory. No file contents are read during discovery. */

const filenameCollator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
let folderSequence = 0;

/** Return whether a filename has the PDF extension, regardless of its case. */
export function isPdfName(name) {
  return typeof name === "string" && /\.pdf$/i.test(name);
}

/** Sort filenames naturally, with a deterministic tie-break for names differing only in case. */
export function comparePdfNames(left, right) {
  return filenameCollator.compare(left, right) || (left < right ? -1 : left > right ? 1 : 0);
}

function makeEntries(descriptors) {
  const folderId = `pdf-folder-${++folderSequence}`;
  const names = new Set();
  return Object.freeze(descriptors
    .sort((left, right) => comparePdfNames(left.name, right.name))
    .map((descriptor) => {
      if (names.has(descriptor.name)) {
        throw new Error(`The selected folder contains duplicate filenames: ${descriptor.name}`);
      }
      names.add(descriptor.name);
      return Object.freeze({
        ...descriptor,
        id: `${folderId}/${encodeURIComponent(descriptor.name)}`,
      });
    }));
}

/**
 * List immediate PDFs in an explicitly permitted FileSystemDirectoryHandle.
 *
 * Returns {name, entries}. Every entry has an opaque session ID, filename,
 * lazy getFile() function, and original handle for optional isSameEntry checks.
 * Subdirectories are ignored. Permission and enumeration failures propagate;
 * callers should retain the previously selected library until this completes.
 */
export async function readPdfDirectory(directoryHandle) {
  if (directoryHandle?.kind !== "directory" || typeof directoryHandle.entries !== "function") {
    throw new TypeError("A permitted PDF folder is required.");
  }
  const descriptors = [];
  for await (const [name, handle] of directoryHandle.entries()) {
    if (handle?.kind === "file" && isPdfName(name)) {
      if (typeof handle.getFile !== "function") {
        throw new TypeError(`The PDF file cannot be opened: ${name}`);
      }
      descriptors.push({ name, handle, getFile: () => handle.getFile() });
    }
  }
  return { name: directoryHandle.name || "PDF folder", entries: makeEntries(descriptors) };
}

/**
 * Build a folder library from a directory input's FileList without reading PDFs.
 *
 * webkitRelativePath must identify one selected root. Only root/filename.pdf
 * entries are retained; nested PDFs are ignored. Captured File objects remain
 * usable for this session. A normal file input cannot establish folder access.
 */
export function pdfEntriesFromFileList(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return { name: "", entries: Object.freeze([]) };

  let rootName = null;
  const descriptors = [];
  for (const file of files) {
    const parts = typeof file.webkitRelativePath === "string"
      ? file.webkitRelativePath.split("/")
      : [];
    if (parts.length < 2 || parts.some((part) => !part || part === "." || part === "..")) {
      throw new TypeError("Choose a folder to grant access to its PDF files.");
    }
    if (rootName !== null && rootName !== parts[0]) {
      throw new TypeError("Choose one PDF folder at a time.");
    }
    rootName = parts[0];
    if (parts.length === 2 && isPdfName(parts[1])) {
      descriptors.push({ name: parts[1], getFile: async () => file });
    }
  }
  return { name: rootName, entries: makeEntries(descriptors) };
}

/**
 * Track the selected entry and last page within one explicitly selected folder.
 *
 * replace() starts a new folder session and clears saved pages. deactivate()
 * keeps the library and pages but unselects it for an unrelated single-file or
 * demo load. Membership uses opaque entry IDs, never a filename comparison.
 */
export class PdfLibrarySession {
  #folderName = "";
  #entries = Object.freeze([]);
  #byId = new Map();
  #pages = new Map();
  #activeId = null;

  get folderName() { return this.#folderName; }
  get entries() { return this.#entries; }
  get activeId() { return this.#activeId; }

  /** Install a completed folder listing atomically, clearing prior page memory. */
  replace(folderName, entries) {
    const byId = new Map();
    const nextEntries = Array.from(entries);
    for (const entry of nextEntries) {
      if (!entry || typeof entry.id !== "string" || !entry.id
          || !isPdfName(entry.name) || typeof entry.getFile !== "function") {
        throw new TypeError("Each PDF entry needs an ID, filename, and file reader.");
      }
      if (byId.has(entry.id)) throw new TypeError("PDF entry IDs must be unique.");
      byId.set(entry.id, entry);
    }
    this.#folderName = String(folderName || "");
    this.#entries = Object.freeze(nextEntries);
    this.#byId = byId;
    this.#pages.clear();
    this.#activeId = null;
  }

  /** Remove the folder listing, selected entry, and all saved pages. */
  clear() { this.replace("", []); }

  /** Return the known entry, or null for an ID outside the current folder. */
  entryFor(id) { return this.#byId.get(id) || null; }

  /** Select a known entry and return its last page (one on its first visit). */
  activate(id) {
    const page = this.pageFor(id);
    this.#activeId = id;
    return page;
  }

  /** Unselect the library when loading a file whose membership is unproven. */
  deactivate() { this.#activeId = null; }

  /** Save a positive integer page for the active entry; return false if none is active. */
  rememberPage(page) {
    if (!Number.isSafeInteger(page) || page < 1) throw new RangeError("A page must be a positive integer.");
    if (this.#activeId === null) return false;
    this.#pages.set(this.#activeId, page);
    return true;
  }

  /** Return a known entry's saved page; reject IDs from other folder sessions. */
  pageFor(id) {
    if (!this.#byId.has(id)) throw new RangeError("The PDF is not in the selected folder.");
    return this.#pages.get(id) || 1;
  }
}
