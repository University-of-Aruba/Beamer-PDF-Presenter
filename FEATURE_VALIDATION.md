# PDF Presenter feature validation

Local work on 2026-09-09, based on `39e8970`. The source version remains
1.1.0; the additions are a candidate for a future 1.2.0 minor release. No
Google Drive upload, dependency update or release-version change is included.

## Implemented

- Left sidebar with wrapped PDF filenames, immediate-folder filtering,
  natural sorting, deliberate double-click/double-tap opening and page restoration
  for that session. Opening a folder never opens a PDF automatically.
  Browser folder selection is required because choosing one PDF does not
  grant access to neighbouring files. Folder access stays in the browser;
  the server receives neither selected PDF paths nor document bytes.
- Virtual laser control and L shortcut, normalized against the actual rendered
  PDF pixels, with document/page identity checks and clearing on page/deck
  changes, blanking, analog timer mode, preview exit and focus loss.
- PDF Presenter title and selectable PNG branding, with SISSTEM as default.
  Hyphens/underscores become spaces in uppercase display names. Header and
  audience timer update without resetting the countdown. Generic mode has no
  logo. The local catalog exposes only safe immediate PNG filenames.
- Offline packaging includes the new modules, default logo and generated
  catalog. Extra custom logos can be added under new filenames; inventoried
  files remain protected by the package checksums.

## Earlier feature-pass evidence

These checks predate the UI corrections below.

- `node --test tests/*.test.mjs`: 49 tests, covering countdown behavior,
  folder filtering/identity/page memory, pointer geometry/lifecycle, safe
  branding/catalog loading and timer label layout.
- `python3 -m unittest discover -s tests -p 'test_*.py'`: 39 tests, covering
  the HTTP catalog and existing file protections, offline cache integrity,
  launcher checks and packaging of safe custom logos/new modules.
- JavaScript syntax checks, Python AST/function-docstring inspection and
  source whitespace checks.
- Browser folder selection showed two immediate PDFs, including an uppercase
  extension, and excluded a text file and nested PDF. Switching away from
  page 2 and returning restored page 2 in presenter and audience windows.
- The laser appeared at the audience slide center, then at normalized
  coordinates approximately (0.25, 0.7506) for a presenter target (0.25, 0.75).
  Preview-divider resizing preserved coordinate mapping. Page change and
  blanking hid the dot; analog mode also suppressed it.
- Faculty-name and generic brand choices updated the audience while the
  countdown remained running. A newly added 32-character wide-letter name
  was discovered through Refresh logos and fitted inside the timer SVG.
  Temporary alternate-logo fixtures reused the existing PNG only for these
  checks; they are excluded from the project changes.
- The dashboard was inspected at actual viewports 1073 x 994 and 1280 x 720;
  neither had horizontal overflow, and the controls remained visible. The
  long filename wrapped into multiple lines. The audience was also checked
  at different dimensions. Presenter/audience warning and error logs were empty.
- Independent read-only review identified and verified repairs for delayed
  demo loads overriding later choices and pointer coordinates being sent
  before a newly selected document's canvas replaced the old one. No
  unresolved blocker remained in the reviewed integration.

- The local-only Windows package builder completed with 266 manifest-covered
  files. Fresh extraction passed `python3 -I launch_windows.py --check` for
  all 266 files; packaged application bytes matched the reviewed source.
  Only the supplied SISSTEM logo was included. The previous release ZIP's
  SHA-256 remained `95e1148d7a8c5c56cd4300c3c46d3a87a238e6794cc1f387836d0d3860a111fb`.
  The check build records the uncommitted working source as modified and is
  not a replacement release.

## Limits and local use

Browser checks used Chromium on macOS. This revision has not been executed
on the work Windows laptop or a physical projector; prior laptop success is
user-reported for the earlier release. Folder access is session-scoped and
must be selected again after reloading. No persistent PDF library is added.

The existing September 7 Windows ZIP and Drive delivery remain the previous
release. Source launchers use the updated local application. A subsequent
Windows delivery must be rebuilt from these sources and validated before upload.

## UI correction pass, 2026-09-09

The Open PDF and Open PDF folder buttons are adjacent. Folder selection only
populates the list; single clicks focus rows. Double-click, double-tap,
Enter/Space and trusted assistive-technology button activation open documents.
A folder selected during a pending load also finishes drawing the committed
PDF, so the preview cannot remain behind the audience window.

PDF.js is the only PDF renderer. The native iframe fallback and estimated
page count were removed. Failed replacement loads display a persistent error
while the active PDF remains available. The renderer and worker now use the
matched legacy members of the same integrity-pinned 6.3.289 archive, with
build/source receipt checks in the app and packaging. The previous verified
cache is retained for recovery. This is a compatibility change within the
existing dependency version, not evidence of the reported Firefox failure's
exact cause.

Passed:

- `node --test tests/*.test.mjs`: 60 tests, including deliberate pointer,
  touch, keyboard and semantic activation and duplicate suppression.
- `python3 -m unittest discover -s tests -p 'test_*.py'`: 44 tests,
  including safe modern-cache upgrade, matching legacy renderer/worker,
  package receipt rejection and hash integrity.
- JavaScript syntax and Python AST/docstring checks. Independent read-only
  review verified the folder/load race repair, both official legacy archive
  members and all 204 cached asset hashes, with no unresolved blocker.
- Chromium/macOS browser: folder selection listed exactly three immediate
  PDFs, excluded text/nested files, and kept both previews empty with no
  active row. A single click did not open a PDF. Double-click loaded the demo
  and the real 11-page Algebra Exponent Exercises with Solutions lecture.
- Presenter current/next previews and the audience used canvases with zero
  iframe/embed/object readers. A single click on another PDF kept presenter
  and audience on the existing page. Enter restored the demo's saved page 2.
- Reopening the folder preserved the presented PDF and page 2 while marking
  no row active. Invalid PDF loading preserved the lecture and displayed a
  persistent error. Removing the staged worker produced a clear missing-file
  error with zero embedded viewers; restoring it allowed a successful retry.
- Controls were visually adjacent; the long lecture filename wrapped across
  multiple lines. The captured presenter layout had no horizontal overflow.

Limits: Firefox (version unknown), native Windows startup, physical touch,
assistive-technology operation and a physical projector were not tested in
this pass. The user reported Firefox and a PDF.js renderer label alongside
embedded viewer controls; the exact original failure remains unconfirmed.
Browser checks verify the new canvas-only path and failure behavior.

These UI corrections have patch-level impact. The combined unreleased
feature set still warrants a future minor release; VERSION stays 1.1.0.
No commit, tag, release or Drive upload was performed.

Package and installed-source readback passed:

- A local-only validation ZIP built from the installed source contains 267
  manifest-covered files, including 37 Python and 204 PDF.js assets. Fresh
  extraction passed `python3 -I launch_windows.py --check` for all 267 files;
  packaged application bytes match the installed source.
- Validation ZIP: `/private/tmp/PDF-Presenter-ui-fixes-validation-20260909.zip`,
  15,277,980 bytes; SHA-256
  `1cdb217674baebd09b6fdebf4b1bff329d1de9d473ffb4d069b03949269276e1`.
- The installed files match the tested staging copy. All initial files outside
  this correction remain byte-identical. JavaScript syntax, 204 installed
  cache hashes and `git diff --check` passed. The prior release ZIP retains
  its original SHA-256 above.
- Before-edit source copies are retained under
  `.tmp/ui-fix-before-rk9xgnyr/`; the prior cache is retained under
  `.tmp/pdfjs-backups/`. These are local recovery material, not release files.
