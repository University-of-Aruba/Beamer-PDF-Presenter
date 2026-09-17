# Third-party notices

Beamer PDF Presenter application code is distributed under the
[Apache License, Version 2.0](LICENSE.txt). Dependencies, imported code and
institutional branding retain the terms described below. The complete portable
package is a collection of separately licensed components.

## Imported application

The application incorporates modified Beamer Presenter 1.1.0 code originally
distributed under the MIT License, Copyright (c) 2026. Its original notice is
retained verbatim in
[LICENSES/original-beamer-presenter-MIT.txt](LICENSES/original-beamer-presenter-MIT.txt).
The [NOTICE](NOTICE) records this origin. The MIT notice must continue to
accompany copies or substantial portions of the imported software.

## PDF.js and its resources

The runtime uses Mozilla PDF.js **6.3.289**, including the `legacy` compatibility
renderer and matching worker. Maintainer preparation obtains the exact archive
recorded in `dependencies.lock.json`. The prepared `vendor/pdfjs/` directory
contains its resource licenses and an integrity manifest.

| Component | License or terms | Retained material |
| --- | --- | --- |
| PDF.js, Mozilla Foundation contributors | Apache 2.0 | `vendor/pdfjs/LICENSE` |
| core-js 3.50.0 polyfills in the compatibility build | MIT | `LICENSES/core-js-3.50.0-MIT.txt` |
| Adobe character maps | BSD-style redistribution and attribution terms | `vendor/pdfjs/cmaps/LICENSE` |
| Foxit/PDFium standard fonts | BSD-style redistribution and attribution terms | `vendor/pdfjs/standard_fonts/LICENSE_FOXIT` |
| Liberation Sans 1.07.4 fonts | GPL version 2 with the Liberation font exception | `vendor/pdfjs/standard_fonts/LICENSE_LIBERATION` and the complete source archive described below |
| JBIG2 decoder and Mozilla integration | PDFium BSD-style and Apache 2.0 notices | `vendor/pdfjs/wasm/LICENSE_JBIG2` and `LICENSE_PDFJS_JBIG2` |
| OpenJPEG decoder and Mozilla integration | BSD 2-Clause and Apache 2.0 notices | `vendor/pdfjs/wasm/LICENSE_OPENJPEG` and `LICENSE_PDFJS_OPENJPEG` |
| qcms and Mozilla integration | MIT and Apache 2.0 notices | `vendor/pdfjs/wasm/LICENSE_QCMS` and `LICENSE_PDFJS_QCMS` |
| ICC profile | CC0 1.0 Universal | `vendor/pdfjs/iccs/LICENSE` |
| QuickJS engine and Mozilla wrapper | MIT | `LICENSES/quickjs-MIT.txt` and `LICENSES/pdf-js-quickjs-MIT.txt` |

PDF.js upstream: [mozilla/pdf.js](https://github.com/mozilla/pdf.js).
The npm distribution's top-level Apache license does not replace the separate
resource licenses. The compatibility build embeds core-js, so its MIT notice is
included even though the npm archive does not contain a separate core-js license
file. The QuickJS notices likewise accompany the unmodified `quickjs-eval.js`
and `quickjs-eval.wasm` resources supplied by PDF.js.

### Liberation font source

The four `LiberationSans-*.ttf` resources identify themselves as version
**1.07.4**, matching
[PDF.js's version-specific font documentation](https://github.com/mozilla/pdf.js/blob/v6.3.289/external/standard_fonts/README.md).
This release uses GPL version 2 with the Liberation font exception; the SIL Open
Font License used by newer Liberation releases does not apply to these files.

The complete upstream 1.07.4 source release is distributed alongside the fonts as
[LICENSES/liberation-fonts-1.07.4.tar.gz](LICENSES/liberation-fonts-1.07.4.tar.gz).
It contains the SFD source files, build scripts, README and original licenses.
Their version metadata and a read-only comparison support this source selection:
all 668 Unicode-mapped glyphs in each face have identical decoded outlines,
hinting and glyph IDs in the PDF.js and upstream binaries. Additional unmapped
Cyrillic alternate glyphs in the upstream fonts are present in the source archive.
The original font build was not reproduced. Binary identity is not itself the
GPL version 2 source requirement; the preferred source and build scripts are
included. [LICENSES/provenance.json](LICENSES/provenance.json) records the evidence.
Both offline Windows packages and static site distributions retain this archive.
The font files and source keep their own license; they are not relicensed under
Apache 2.0.

Official font project:
[Liberation 1.7 fonts](https://github.com/liberationfonts/liberation-1.7-fonts).
Official source archive:
[Liberation fonts 1.07.4](https://releases.pagure.org/liberation-fonts/liberation-fonts-1.07.4.tar.gz).
The source archive hash and provenance are recorded in
[LICENSES/provenance.json](LICENSES/provenance.json).

## Python in the Windows package

The portable Windows package includes the unmodified official Python **3.14.7**
embeddable distribution for Windows x64 and its dependent DLLs. The complete
upstream `runtime/python/LICENSE.txt` is retained. It contains the Python
Software Foundation License Version 2, historical Python notices, and notices
for bundled components including bzip2, libffi, Zstandard and Microsoft
Distributable Code. The archive origin and SHA-256 are pinned in
`dependencies.lock.json`.

The Microsoft restrictions in that upstream license apply to the Microsoft
Distributable Code, including its use on supported Microsoft platforms and
preservation of its notices. They do not change the license of the presenter
application. The Apache 2.0 license does not relicense the Python distribution
or its dependent binaries. Python is not included in the static site.

Official references:
[Python 3.14.7 release](https://www.python.org/downloads/release/python-3147/)
and [Python license documentation](https://docs.python.org/3.14/license.html).

## Institutional names and logos

The SISSTEM, University of Aruba, faculty and program names and logo assets remain
subject to their owners' copyright, trademark and permission terms. The software
license does not grant rights to use or redistribute those names or marks, and
their inclusion does not imply institutional endorsement.

Asset provenance is recorded in `logos/SOURCES.md`. Use institution-specific assets only under the applicable
owner's permission; a generic presenter can operate without them. Adding an
asset to the logo selector does not license it under Apache 2.0.
