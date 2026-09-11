# GitHub distribution preparation

Local validation on 2026-09-09, based on `39e8970` plus the existing uncommitted
PDF-library, laser, branding and deliberate-opening changes. Those prior
changes were preserved. Application version remains 1.1.0; the combined
unreleased functionality warrants a future minor release.

## Prepared

- Beamer PDF Presenter title in app, browser titles, generic brand, console and
  portable package folder. The existing repository directory is retained.
- A lecturer-first README, three-step offline Windows guide, separate user,
  developer and GitHub-maintainer documentation, and a dark welcome page
  informed by existing University of Aruba repository conventions.
- Ubuntu/Windows CI and downloadable Windows workflow artifacts. A separate
  manual Pages workflow builds a public allowlist and deploys only that site.
  Actions are pinned to verified official commit IDs with per-job permissions;
  no custom secret, account, remote URL or automatic release is configured.
- Official PNGs for all four UA faculties plus AFY, OGM and Social Work and
  Development, alongside the supplied SISSTEM mark. `logos/SOURCES.md` records
  source pages, dimensions, exact hashes and separate institutional rights.
- Apache 2.0 for the app, verbatim original MIT notice, complete dependency
  notices and the upstream Liberation 1.07.4 font source archive in both
  distribution inventories. Software licensing does not grant logo rights.

## Passed

- `node --test tests/*.test.mjs`: 60 passed.
- `python3 -m unittest discover -s tests -p 'test_*.py'`: 68 passed.
- All application JavaScript syntax and Python AST/function-docstring checks.
- Workflow YAML parsing, trigger/matrix/permission/pin checks, and embedded
  Python compilation. No actionlint executable was available.
- Real official Python runtime download and SHA-256 verification through the
  new helper; real pinned PDF.js download and cache preparation, 204 assets.
- Static builder tests: public inventory, complete licenses/font source, logo
  catalog, relative links, manifest hashes, failed-build cleanup and path/
  symlink rejection. Runtime tests cover integrity failures, safe reuse,
  atomic publication and concurrent destination preservation.
- Chromium/macOS at 1280 x 720: welcome-page links and layout without
  horizontal overflow; app startup under a Pages-style `/site/presenter/`
  path; two PDF.js preview canvases and no embedded reader. The audience
  window worked from the same prefix.
- All four faculty selections synchronized their names and PNG paths to the
  audience analog timer. The longest faculty name fitted the timer. Hiding
  the timer restored the PDF audience canvas. The static catalog fallback
  worked without a Python application backend.
- Independent read-only review found and verified repairs to interrupted
  runtime downloads, a mismatched workflow label, unsafe build paths and
  misleading unbranded-distribution guidance. No unresolved blocking defect.
- Six imported license/source hashes match provenance. The original MIT text
  matches the import. A read-only font comparison matched all 668 Unicode
  glyphs per face for outlines, hinting and glyph IDs; the original font build
  was not reproduced. Full evidence and differences are in LICENSES.
- New public documentation links resolve, and a scoped credential-pattern
  scan found no suspected credentials. Local source was hash-checked against
  the initial snapshot before installation.

## Not run or intentionally not performed

- GitHub-hosted Actions, actual Pages deployment and native Windows execution
  are configured for the maintainer's first upload, not claimed as locally run.
- Firefox, physical projector, touchscreen and assistive-technology checks
  were not run for this distribution pass. Browser validation used Chromium.
- The official small faculty icons were retained unchanged. Most are about
  126 pixels and may soften when enlarged; FEF is 1193 pixels. No larger
  official originals or open artwork license were established.
- No Git remote, commit, push, tag, GitHub Release or Google Drive update was
  created. Original release files are retained. The maintainer must publish a
  reviewed Windows release and enable/run Pages before sharing download links.

## Installed build readback

- `output/Beamer-PDF-Presenter-1.1.0-Windows-x64-Offline.zip`: 18,289,976 bytes,
  283 manifest-covered files, including 37 Python and 204 PDF.js assets.
  SHA-256: `006d0a42b1b94c6cf4feea04935c234eea587740e3132d43f1b91d45376c68e7`.
- Fresh extraction passed `python3 -I launch_windows.py --check` for all 283
  files. Copied application, logo and license/source bytes match installed
  source. This is a local candidate build, not a published GitHub release.
- `output/github-pages-demo/`: all 243 manifest hashes passed. Its public
  inventory excludes Git, runtime, backend scripts, tests, build tools and
  private dependency-lock metadata. Required notices and font source are
  present, and the generated catalog includes all eight supplied logo choices.
- Installed source matches the tested staging copy; all untouched initial
  files are byte-identical. `git diff --check` passed. Git warns that the
  Windows batch launcher will normalize to CRLF under the new .gitattributes
  on its next checkout; this is the intended Windows line-ending policy.
- The original September 7 ZIP retains its SHA-256
  `95e1148d7a8c5c56cd4300c3c46d3a87a238e6794cc1f387836d0d3860a111fb`.
  Previous modified source files are retained under
  `.tmp/github-prep-before-xn4euu66/` for local recovery.
- HEAD remains `39e8970cb496a9c190c9bae153a823281f325389`, no remote is set,
  and VERSION remains 1.1.0. The new and pre-existing changes are uncommitted.
