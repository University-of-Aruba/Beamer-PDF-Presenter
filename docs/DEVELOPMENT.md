# Development and builds

[Back to the project](../README.md)

The runtime is plain HTML, CSS and JavaScript. There is no npm install step,
application database or cloud backend. Python 3.14 and Node.js 24 are used by
CI; the portable Windows download includes its own locked Python runtime.

## Run from source

From the project folder, prepare PDF.js once, then start the local server:

```bash
python3 tools/cache_pdfjs.py
python3 serve.py
```

On Windows, use `py -3` in place of `python3`. These commands require an
existing Python installation and internet for initial dependency preparation.
Open the localhost address printed by the server. Do not open index.html as a
file. Stop the server with Ctrl+C. No Node.js installation is needed to run the
presenter itself.

PDF.js 6.3.289 and the Python 3.14.7 Windows x64 archive are pinned by origin
and integrity in `dependencies.lock.json`. The PDF.js helper can reuse a
locked local tarball with `--archive PATH`. It selects the matching legacy
renderer and worker, verifies the full archive and keeps any previous cache
for recovery. Never mix renderer and worker versions or modern/legacy files.

## Run checks

In Bash (including Git Bash on Windows):

```bash
node --test tests/*.test.mjs
python3 -m unittest discover -s tests -p 'test_*.py'
```

The tests cover narration parsing and playback cancellation, timers, PDF selection,
laser geometry, brands, server file
boundaries, dependency integrity and distribution builders. Use an actual
browser to check current/next canvases, the audience window, deliberate file
opening and a real PDF. Physical-projector and managed-laptop checks remain
separate from unit tests. For narration, use **Load demo** and **Auto-play**
with an installed local voice. Check a reveal in the audience window, then
confirm that the exercise waits for Continue. Also check a mismatched script,
manual navigation during speech and playback without a network connection.
Voice availability and audible output require a check on the intended computer.
CI also checks Ubuntu and Windows, and verifies the
Windows ZIP using its bundled Windows executable.

## Build the Windows download

For a Windows test build after pushing source, follow the
[Actions artifact procedure](GITHUB_SETUP.md#test-a-pushed-revision-on-windows).
A local build uses these commands:

```bash
python3 tools/download_windows_runtime.py --output .tmp/python-embed.zip
python3 tools/cache_pdfjs.py
python3 tools/build_windows_package.py --python-archive .tmp/python-embed.zip --output output/Beamer-PDF-Presenter-1.2.0-Windows-x64-Offline.zip
```

Use the current VERSION in the output filename. Existing outputs are never
overwritten. The builder reads the real Git revision and records whether the
working source has uncommitted changes. A release build should come from a
reviewed, committed revision. The ZIP includes the runtime, app modules, logos,
license notices and Liberation font source; its checksum appears beside it.
No personal course PDFs, Git history or local build caches are included.

Extract into a fresh folder. On Windows, run:

```bat
runtime\python\python.exe launch_windows.py --check
```

This validates the complete manifest without starting a server. Then perform
the normal browser/projector startup check. On other platforms,
`python3 -I launch_windows.py --check` checks files but cannot verify native
Windows execution.

## Build the Pages site

```bash
python3 tools/cache_pdfjs.py
python3 tools/build_static_site.py --output output/site
python3 -m http.server 8012 --bind 127.0.0.1 --directory output/site
```

Open `http://localhost:8012/`. The welcome page is at the site root and the
presenter at `presenter/`. In GitHub Actions, GITHUB_REPOSITORY supplies the
actual repository identity for links. For a local preview of published links,
pass `--repository OWNER/REPOSITORY` with the intended real identity. Without
it, the local preview labels download links as unconfigured.

The builder copies an explicit public inventory, generates the static logo
catalog and includes required license/source files. The source tree, Python
runtime, private package metadata, tests and build scripts are excluded. It
adds a restrictive content policy in HTML; GitHub Pages does not provide the
custom HTTP headers used by serve.py. Serve only the output directory.

There is no service worker or guaranteed offline browser cache. The demo
needs internet when loading resources; use the Windows package for offline
classes. The static site cannot discover logo changes dynamically: rebuild it
after adding PNGs. PDFs selected by a lecturer stay in the browser.

## Versions, licensing and assets

VERSION is the canonical version, currently **1.2.0**. This minor release adds
backward-compatible narration and auto-play functionality. The reveal-caption
and rendering-delay fixes are included in the same release. Existing PDF
presentation workflows remain supported. Update VERSION, displayed version
labels and release notes together when preparing future releases.

Keep third-party licenses, source archive and checksums in LICENSES. Review
upstream provenance before changing dependencies. Do not replace fonts merely
to change a license: PDF.js relies on their glyph ordering. See the documented
font build-provenance limitation in LICENSES/README.md.

Faculty logos are independent artwork, not covered by Apache 2.0. Preserve
`logos/SOURCES.md`; use official artwork and ensure authority for public brand
use. Extra PNGs are supported under new filenames. The Windows package rejects
changes to inventoried files; it accepts additional logo files.
