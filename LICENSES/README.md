# License materials

The application license is [Apache 2.0](../LICENSE.txt). The imported Beamer
Presenter 1.1.0 MIT notice is preserved without changes in
[original-beamer-presenter-MIT.txt](original-beamer-presenter-MIT.txt).

These additional materials accompany the separately licensed runtime resources:

- [core-js-3.50.0-MIT.txt](core-js-3.50.0-MIT.txt): the polyfills embedded in
  the PDF.js 6.3.289 compatibility renderer and worker.
- [quickjs-MIT.txt](quickjs-MIT.txt) and
  [pdf-js-quickjs-MIT.txt](pdf-js-quickjs-MIT.txt): the QuickJS engine and
  Mozilla wrapper distributed as `vendor/pdfjs/wasm/quickjs-eval.*`.
- [liberation-fonts-1.07.4.tar.gz](liberation-fonts-1.07.4.tar.gz): the
  complete, unmodified upstream source archive for version 1.07.4, the
  release identified by PDF.js for its four Liberation Sans font files. It includes the editable
  SFD sources, build scripts, README, copyright notices and GPL version 2
  text with the Liberation font exception. No source from this archive is
  executed by the presenter or its packaging process.

The font source archive is included with both the Windows package and the static
site. Retain it, this folder, the root license and notices, the PDF.js resource
licenses, and the Python license when redistributing the corresponding files.
The font license applies separately from the application's Apache 2.0 license.

For font development, the upstream archive's README and Makefile describe its
FontForge build. PDF.js identifies its four Liberation Sans font binaries as
the upstream 1.07.4 release, and their embedded version metadata agrees.
A read-only comparison of all 668 Unicode-mapped glyphs in each face found
identical character coverage, glyph IDs, decoded outlines and hinting programs.
Every PDF.js glyph shape is present in the official upstream font binaries.
The upstream binaries contain additional unmapped Cyrillic alternate glyphs;
their editable definitions are also present in the included source archive.

The original font build was not reproduced. This is a validation limit, not
a requirement for byte-identical redistribution: GPL version 2 requires the
preferred source form and the associated build/install scripts. Those upstream
1.07.4 materials are included. The PDF.js font files remain unchanged because
internal rendering tables depend on their glyph order.

[provenance.json](provenance.json) records exact public source URLs, revisions,
file sizes, SHA-256 hashes and the font comparison. It inventories the imported
license texts and source archive; it does not change their licenses.

See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) for the complete runtime
inventory and the distinct treatment of institutional names and logos.
