# Changelog

## Distribution preparation (unreleased)

- Rename the app and portable folder to Beamer PDF Presenter; lead documentation with classroom use across disciplines and a three-step Windows startup.
- Prepare validated CI, downloadable offline Windows build artifacts and a manual GitHub Pages demo with a welcome/download page.
- Add the four University of Aruba faculty marks and additional program marks from official sources, with catalog entries and attribution.
- Apply Apache 2.0 to the updated application; retain original MIT and dependency notices, including compatibility-build MIT notices and the Liberation font source archive.
- Preserve VERSION 1.1.0. No remote repository, commit, push, tag, Pages deployment or GitHub Release is created by this local preparation.

## Local PDF Presenter additions (unreleased)

- Add a left PDF-folder sidebar with immediate-PDF filtering, wrapped filenames and session page restoration. Browser folder selection supplies explicit access.
- Group Open PDF and Open PDF folder; selecting a folder does not open a PDF. Require a double-click, double-tap or explicit keyboard activation for listed files.
- Render slides only on PDF.js canvases, removing embedded browser readers and preserving the current presentation after a failed replacement load.
- Use the matched offline compatibility renderer and worker from the same pinned PDF.js 6.3.289 archive, with verified cache backups and package receipt checks.
- Add a virtual laser pointer mapped between the current preview and audience PDF, with document/page checks and blank/timer suspension.
- Generalize the visible application name to PDF Presenter and add selectable PNG branding from `logos/`. Names derive from filenames; branding changes preserve timer state.
- Keep rapid document switching ordered, including delayed demo loads, and extend offline packaging to the new modules and safe logo assets.

The existing Drive delivery is unchanged. These additive features merit a future minor release (1.2.0); VERSION remains 1.1.0 pending release approval.

## Local offline Windows bundle

- Include a pinned, unmodified Python 3.14.7 embeddable Windows x64 runtime and complete PDF.js 6.3.289 assets in a portable ZIP.
- Start through the bundled runtime with extraction/integrity checks and clear recovery messages.
- Remove runtime CDN requests; use local PDF character maps, fonts, WebAssembly decoders and colour profiles.
- Stage and verify the complete PDF.js cache before replacement, retaining the prior cache for recovery.
- Add deterministic package assembly, source/dependency provenance, license retention, ZIP readback and checksums.
- Restrict local HTTP resource connections and block access to bundled executables and private package metadata.

The app's `VERSION` remains 1.1.0. The Windows bundle records its exact source commit and per-file hashes; no public release or hosted service is implied.

## Local SISSTEM adaptation (unreleased)

- Preserve the imported 1.1.0 application in a local Git repository.
- Apply a dark SISSTEM teal/cream theme and the existing gear logo to the header, favicon and full-screen analog countdown.
- Prevent the local server from exposing hidden paths such as the new `.git` history, directory listings or resolved paths outside the application folder.
- Document managed-computer installation findings and separate new validation evidence from the imported record.

The application version remains 1.1.0. This local adaptation has not been deployed or published as a new release.

## 1.1.0

### Added

- Draggable preview splitter, with 15–85% limits, keyboard resizing, double-click reset, and a saved split preference when browser storage is available.
- Full-width bottom controls independent of the preview widths.
- Independent configurable exercise/exam countdown with minute/second inputs, start/pause/resume, reset, and durations up to 24 hours.
- Digital countdown overlay in any of the four slide corners.
- Full-screen analog countdown with a shrinking sector, hand, calibrated dial, precise digital time, and expiry indication.
- Countdown-only presentation without a PDF.
- Countdown state synchronization for newly opened/reloaded audience windows.
- C and H countdown shortcuts in presenter and audience windows.
- Countdown unit tests and a validation report.

### Changed

- Retained equal-height current/next preview panes even on small screens.
- Renamed elapsed timer controls to distinguish them from the new countdown.
- Rendered replacement PDF canvases off-DOM before displaying them, reducing resize flicker.
- Debounced preview redraws during drag operations.
- Preserved the PDF page beneath the analog display.

### Fixed

- Enter/Space on focused controls no longer accidentally advances the presentation.
- Cancelled stale next-page renders before displaying the end-of-deck card.
- Refocusing an audience window no longer reloads an already loaded copy of the same PDF.
- Blanking also works for a countdown-only presentation.

### Unchanged

- Local launchers, static-hosting model, PDF.js pin (6.3.289), and browser-native PDF fallback.

## 1.0.0

Initial presenter dashboard, current/next-page previews, audience window, private elapsed timer, page navigation, blanking, and optional PDF.js cache.
