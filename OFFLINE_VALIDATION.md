# Offline Windows package validation

Checks performed on 6–7 September 2026 for the SISSTEM offline Windows x64
package, developed from local commit `302bf4b`. Application version remains
1.1.0. Each delivery records its exact source commit and worktree state in
`BUILD-INFO.json`; the ZIP has a companion SHA-256 checksum.

## Passed

- `node --check app.mjs` and `node --test tests/countdown.test.mjs`: syntax
  check and 20 countdown tests passed.
- `python3 -m unittest discover -s tests -p test_windows_launcher.py`: 10
  tests passed, including extraction errors, changed files, paths containing
  spaces and accents, unsafe Windows names, symlinks, duplicate manifest
  entries, isolated server launch arguments and verification without startup.
- `python3 -m unittest discover -s tests -p test_pdf_cache.py`: 9 tests passed,
  including archive integrity, required assets and licenses, unsafe archive
  paths, preservation of existing content and replacement rollback.
- `python3 -m unittest discover -s tests -p test_serve.py`: 6 tests passed
  with local socket permission. GET and HEAD checks cover static assets,
  hidden files, traversal, outside-root symlinks, private runtime and metadata
  paths, and the content security policy. The independent review environment
  could not bind a socket; the permitted integration run completed these tests.
- Python syntax/docstring inspection and `git diff --check` passed.
- Official Python 3.14.7 Windows AMD64 archive matched its published SHA-256:
  `d297e5ff019966817ad8502465176139f2d3d840fa4ed84b13bed399a6ab1f15`.
  Its 37 files were preserved, including the isolated path configuration,
  standard library, native modules and VC runtime DLLs. The executable's PE
  machine type is AMD64 (`0x8664`).
- PDF.js 6.3.289 matched the npm registry SHA-512 integrity recorded in
  `dependencies.lock.json`. The cache contains 204 verified files, including
  all character maps, standard fonts, WebAssembly decoders, ICC profiles and
  corresponding upstream licenses.
- The package builder read back every ZIP member and compared its checksum.
  The pilot ZIP contained 260 manifest-covered files plus the manifest itself.
  Fresh extraction into a path containing spaces passed
  `python3 -I launch_windows.py --check` for all 260 files.
- The extracted application's launcher and server ran with macOS Python in
  isolated mode. In the in-app Chromium browser, the four-page demo rendered
  with `PDF.js 6.3.289 (offline)` and current/next navigation worked. A local
  36-page Mathematics 1 PDF also loaded and navigated with that renderer.
  The course PDF is a test input and is excluded from the delivery.
- The audience window displayed the SISSTEM analog timer and logo, then
  restored the selected course PDF page when the timer was hidden. Screenshots
  of the demo and timer are retained locally in `.tmp/offline-validation/`.
  Presenter and audience warning/error console queries were empty.
- The application has no external renderer URL. Browser integration ran under
  the server's content security policy restricting runtime connections and
  resources to the local application, blobs and data URLs. The PDF renderer
  and supporting resources came from the extracted package.
- A separate read-only reviewer found no blocking source defects. Review
  covered Windows quoting and isolated imports, bundled resources and
  licenses, package integrity, privacy, fallback behavior and documentation.

## Limits

The 45 automated tests and browser integration establish local application
and packaging behavior. They do not establish native Windows execution.
No Windows runner was available to execute `python.exe` or the batch file.
The work laptop's application-control policy, default browser, physical
projector and native Windows fullscreen behavior require a first-start check
on that laptop. No security-control bypass is prescribed.

The host was not physically disconnected from the network. Local resource
use was established through the packaged paths, renderer behavior, source
inspection and enforced content policy. Missing-worker browser recovery was
not exercised interactively; incomplete-package rejection and missing-worker
cache rejection have automated coverage.

The SHA-256 inventory detects extraction errors and accidental changes; it
is not a digital signature. The package is an offline SISSTEM adaptation of
version 1.1.0, not a newly numbered upstream release.
