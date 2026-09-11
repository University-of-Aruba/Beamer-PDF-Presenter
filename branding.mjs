/** Brand assets stay in the application logo folder; filenames are also labels. */
export const DEFAULT_BRAND_FILENAME = "sisstem.png";

/** Accept an immediate, visible PNG filename, never a path or remote URL. */
export function normalizeBrandFilename(value) {
  if (typeof value !== "string" || value.length > 180 || value !== value.trim()) return null;
  if (value.startsWith(".") || /[\\/:*?"<>|\u0000-\u001f\u007f]/u.test(value)) return null;
  if (!/\.png$/iu.test(value) || !value.slice(0, -4).replace(/[_-]+/gu, " ").trim()) return null;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(value)) return null;
  return value;
}

/** Resolve only a safe, local PNG; null provides the unbranded presenter. */
export function brandDetails(value) {
  const filename = normalizeBrandFilename(value);
  return {
    filename,
    name: filename ? filename.slice(0, -4).replace(/[_-]+/gu, " ").replace(/\s+/gu, " ").trim().toUpperCase() : "BEAMER PDF PRESENTER",
    src: filename ? `logos/${encodeURIComponent(filename)}` : null,
  };
}

/** Validate catalog entries independently of their transport and remove duplicates. */
export function parseBrandCatalog(value) {
  if (!value || !Array.isArray(value.filenames)) throw new TypeError("The logo catalog is unavailable.");
  const filenames = [...new Set(value.filenames.map(normalizeBrandFilename).filter(Boolean))];
  return filenames.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })).map(brandDetails);
}

/** Read the local server catalog, with a local JSON catalog for static hosting. */
export async function loadBrandCatalog(fetcher = globalThis.fetch) {
  for (const source of ["api/brands", "logos/catalog.json"]) {
    try {
      const response = await fetcher(source, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(4500) });
      if (!response.ok) continue;
      return parseBrandCatalog(await response.json());
    } catch {
      // The next local source can still describe a static or older installation.
    }
  }
  return [brandDetails(DEFAULT_BRAND_FILENAME)];
}

/** Wrap the full name into at most three lines, splitting exceptionally long words. */
export function wrapBrandName(name) {
  const words = String(name).trim().split(/\s+/u);
  let width = 32;
  for (;;) {
    const lines = [];
    let line = "";
    for (const word of words) {
      const parts = Array.from(word).reduce((result, character, index) => {
        if (index % width === 0) result.push("");
        result[result.length - 1] += character;
        return result;
      }, []);
      for (const part of parts) {
        if (line && Array.from(`${line} ${part}`).length > width) {
          lines.push(line);
          line = "";
        }
        line += `${line ? " " : ""}${part}`;
      }
    }
    if (line) lines.push(line);
    if (lines.length <= 3) return lines;
    width += 1;
  }
}
