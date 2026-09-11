# Validation: Beamer Presenter 1.1.0

## Completed

All four JavaScript modules passed `node --check`. The existing Python launcher/cache scripts passed bytecode compilation. The pure countdown suite passed **20 tests**, covering valid and invalid durations, deadline-based timing, pause/resume, independent display state, expiry, reset, long-format output, message validation, revisions, and immutable state updates.

A Chromium 144.0.7559.96 DOM harness completed **23 UI/integration checks** with no uncaught application errors:

- Private defaults; countdown-only analog startup; late audience initialization.
- Custom duration; independence from elapsed timer; pause/resume; display changes and hiding.
- Audience C/H shortcuts and actual BroadcastChannel synchronization between windows.
- All four digital corners in both windows, fitted within the test slide bounds.
- Navigation with the timer visible and restoration of the PDF after analog mode.
- Actual short-duration expiry at zero; reset; invalid input; a 90-minute configuration.
- Blanking, focused-button keyboard activation, and reopening the audience mid-countdown.
- Drag resizing, divider keyboard controls, double-click reset, and stale-render cancellation at the end of the deck.
- Positive element sizes and no horizontal page overflow at 1440, 1024, 800, 640, and 390 pixels wide.

Rendered screenshots were visually inspected for the presenter dock, narrow-screen layout, enlarged next preview, and full-screen analog display. The shipped four-page sample PDF was rasterized with PyMuPDF for the test fixtures.

## Test boundaries

The execution environment blocks normal browser URL navigation and external downloads. Browser checks therefore inlined the local application into a DOM test page. The application's actual UI, countdown code, preview-render adapter, and BroadcastChannel transport were exercised. Only the external PDF.js dependency was replaced by an explicitly labelled raster fixture for PDF-related checks.

This is **not** a fresh verification of the real PDF.js engine or the native browser PDF viewer's visual output. The native fallback's selection/UI path was exercised separately, but its PDF pixels were not validated. The PDF.js version is unchanged from version 1.0.0.

No physical projector, display-extension workflow, browser fullscreen permission behavior, Firefox, Safari, or mobile touch hardware was tested. Divider code tolerates unavailable browser storage; real reload-persistence is implemented with localStorage but was not verified in the opaque-origin DOM harness.

## Local acceptance check before teaching

Start the extracted app through the normal launcher. Load an actual Beamer PDF and verify the renderer label shows PDF.js. Drag the divider, navigate through an overlay, and confirm the next preview. Open the audience window on the extended display and enter fullscreen there. Run a short countdown in all desired display modes; check expiry, blanking, hide/restore, and that the original PDF page returns. For an exam, prevent computer sleep and keep the presenter dashboard open.

## Optional automated test

Node.js is only needed for this developer check, not for running the app:

```bash
node --test tests/countdown.test.mjs
```
