# Local SISSTEM adaptation validation

Date: 2026-09-06, America/Aruba. Imported baseline: `2cb43bc` (Beamer Presenter 1.1.0). These results apply to the SISSTEM branding and local-server guard committed with this record. The original `VALIDATION.md` remains unchanged as upstream history.

## Passed

- `node --test tests/countdown.test.mjs`: 20 tests, zero failures. Countdown logic was not modified after this run.
- `node --check` for `app.mjs`, `countdown.mjs`, `timer-view.mjs` and `splitter.mjs`: all four passed on the final source.
- Python `ast.parse` of `serve.py`, `tools/cache_pdfjs.py` and `tests/test_serve.py`: all passed.
- `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p test_serve.py -v`: five tests, zero failures or skips on macOS/Python 3.14. The finite server fixture exercised 42 actual GET/HEAD requests. HTML, modules, PDF, SVG, indexes and visible internal symlinks remained accessible; hidden and encoded dot paths, traversal, outside/hidden symlink targets, unsafe index symlinks and directory listings were denied. The test server shut down after execution. The test worker ran this command with approved loopback socket access because the sandbox blocked binding.
- `git diff --check`: passed.
- Original and copied logo SHA-256 match: `14f9b8ca2f0f41347129da408760827af3c10d561cb40691c5459518318526d9`.

## Browser evidence

The actual application was served by `python3 serve.py --no-browser --port 8766` on loopback and inspected through the Codex in-app browser. The imported baseline was first inspected on port 8765. A fresh origin avoided stale conditional-cache results from the imported files' future modification dates. No PDF raster fixture replaced PDF.js in these checks.

Seventeen recorded checks passed:

- A 90-minute countdown synchronized to an audience page; pause synchronized, blanking covered the entire audience output, and hiding removed the analog display.
- The actual sample loaded with `Renderer: PDF.js 6.3.289 (CDN)`. Navigation reached page 2 of 4, with page 3 in the next preview. Returning from analog mode restored audience PDF page 2.
- All four digital corners synchronized and remained inside their fitted timer frames in presenter and audience views.
- An actual two-second countdown finished at `00:00`; Reset returned both windows to ready.
- Presenter layouts were checked at actual viewports 1440×900, 1024×768, 760×900 and 390×844. In each case the measured viewport matched the requested dimensions, document width did not overflow, and the original 600×600 header logo loaded.

The normal audience-opening button reported `Audience connected`. Its popup was not enumerated by the browser tool, so a tool-visible audience page was opened using the exact session URL recorded by the local server. It received live state through the app's existing communication path. This establishes actual cross-window synchronization; it is not a physical second-monitor check.

Screenshots were inspected for the header logo, analog logo, timer readability and spacing, restored sample-PDF previews, the fully black blanked audience, and the narrow layout. The first branding screenshot was taken before the logo decoded and was replaced by a fully loaded capture. At 390 pixels, the original two-preview layout makes the analog preview small; the larger control-dock readout remains available.

The audience Fullscreen button changed to Exit fullscreen and the browser viewport grew to 1920×1080, then returned through Exit fullscreen. The browser tool's read-only DOM snapshot did not expose a non-null `fullscreenElement`, so native fullscreen is recorded as observed UI behavior rather than an independently attested platform guarantee.

Local evidence files, excluded from Git as generated inspection output:

- `.tmp/validation/browser-checks.json`
- `.tmp/validation/baseline-presenter.png`
- `.tmp/validation/sisstem-presenter.png`
- `.tmp/validation/sisstem-audience.png`
- `.tmp/validation/blanked-audience.png`
- `.tmp/validation/sisstem-narrow.png`

## Review and limits

An independent read-only reviewer examined the source diff, HTTP tests, asset provenance and rendered audience screenshot. No blocking defects or material risks were found. This supports the executable and browser evidence; it does not replace them.

Not run: Windows or Linux execution, a managed standard-user account, physical projector/extended-display hardware, Safari/Firefox, offline restart with a bundled PDF.js runtime, deployment, packaging or signing. These remain prerequisites for broader compatibility claims. The exact logo is reused, but the palette is derived from that asset rather than an official SISSTEM brand guide.

`VERSION` remains `1.1.0`; no dependency version, hosted service or runtime configuration was changed. A patch release (1.1.1) is the suggested next release class for this compatible visual and file-exposure correction, subject to release authorization. The original import commit preserves a rollback reference. The work is local only, with no Git remote or publication.
