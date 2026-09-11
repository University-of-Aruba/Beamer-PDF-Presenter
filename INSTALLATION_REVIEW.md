# Installation review

Reviewed the imported Beamer Presenter 1.1.0 source at local commit `2cb43bc` on 2026-09-06 (America/Aruba). The original review below is preserved; the later offline implementation follows the user's preference for a portable Windows package.

## Offline follow-up

The Windows Intel/AMD x64 bundle now includes the unmodified official Python 3.14.7 embeddable runtime and the complete pinned PDF.js 6.3.289 resources. A double-click launcher uses only that runtime, checks a per-file SHA-256 inventory and starts a loopback-only server. No interpreter installation, CDN, package manager or elevation is requested. The preparation tool stages and verifies a whole PDF.js archive before replacing its cache; the previous cache is preserved for recovery.

The app checks both renderer module and worker, uses local character maps, fonts, image decoders and colour profiles, and has no external runtime URLs. The local server restricts browser resource connections to local data and keeps executable/runtime files outside HTTP access. Packaging creates a clean explicit-file ZIP with dependency provenance, licenses and startup instructions.

Offline use is now the selected route. The hosted route below remains an alternative only if institutional policy blocks portable executables. No hosting or policy bypass was performed. See `OFFLINE_VALIDATION.md` for package, browser and platform evidence; actual managed-Windows execution remains a laptop acceptance check.

## Decision

Simplify distribution for organization-managed computers. The current launchers need an existing, permitted Python installation. An institution-approved static HTTPS address with the pinned PDF.js files included is the preferred option for staff who cannot install software. The app already consists of static files and processes selected PDFs in the browser.

No distribution can guarantee operation under every organization's policy. Browser capabilities, allowed software, pop-ups, fullscreen, network access and extended displays remain local acceptance conditions.

| Route | Requirements on the presenting computer | Assessment |
| --- | --- | --- |
| Approved static HTTPS address | Approved compatible browser and network access to the app | Recommended primary route; removes Python and local server setup from the user's computer. Deployment requires a separately selected and authorized host. |
| Current local folder | Approved Python 3, browser, permission to run a loopback server; complete PDF.js assets for offline PDF use | No elevation is requested by these scripts, and the default port is unprivileged. This is not a self-contained installation. |
| Future portable package | Approved OS-specific executable/runtime and compatible browser | Could avoid a separate Python installation, but needs packaging, platform testing and possibly signing/IT approval. It cannot bypass application-control policies. |

## Findings and bounded follow-up

1. **Python availability is assumed.** `start-windows.bat`, `start-macos.command` and `start-linux.sh` invoke Python directly. They do not check that a usable interpreter exists or explain recovery from a missing or blocked executable. Future launcher work should diagnose prerequisites and give an approved web-address alternative, without automatically installing software or requesting elevation. Windows does not include a system-supported Python installation by default; the current [Python Windows documentation](https://docs.python.org/3/using/windows.html) describes installation and embedded-runtime options.

2. **The imported folder does not include PDF.js.** Only `vendor/pdfjs/README.md` is present. `app.mjs` prefers local assets, then jsDelivr, then a native PDF viewer with reduced page-count and positioning guarantees. A managed network or offline classroom may block the CDN. Distribute the complete pinned runtime, worker and license together, with checksums and a tested representative Beamer PDF. The [PDF.js setup documentation](https://mozilla.github.io/pdf.js/getting_started/) describes the library/worker pair and HTTP serving requirement.

3. **The cache helper can leave a partial set.** `tools/cache_pdfjs.py` replaces each file separately. A module without its worker can be selected by `loadPdfJsRuntime`, then fail during document loading. Future packaging should validate a complete set before publishing it; a cache-helper repair should stage and validate the set before replacement. No dependency files were downloaded or changed during this review.

4. **Browser permissions still matter.** The audience window needs a successful pop-up, and fullscreen needs a browser-supported user interaction. The [Window.open documentation](https://developer.mozilla.org/en-US/docs/Web/API/Window/open) describes popup blocking and its `null` result. Application code already reports a blocked audience window; it cannot override browser policy.

5. **Previous test evidence was limited.** The imported `VALIDATION.md` explicitly describes a raster fixture replacing PDF.js. It does not establish real PDF.js behavior, projector readiness, native fullscreen or organization-managed Windows operation. New evidence is recorded separately in `LOCAL_VALIDATION.md`.

6. **Serve a clean application artifact.** The imported `serve.py` exposed files under the entire checkout. Adding local Git made `.git` a new private path there. This change adds a narrow server guard for hidden paths, resolved paths outside the app root and directory listings. For future hosting, publish only the static application files, logo assets and vetted PDF.js set; exclude `.git`, tests, review records and scripts. The Python helper remains a local-use server, not a production hosting service.

## Acceptance before organization-wide use

On an actual managed standard-user account, open the chosen distribution route with no elevation, render a representative Beamer PDF using real PDF.js, navigate overlays and the next preview, then open the audience window on an extended display. Check fullscreen, logo visibility, timer start/pause/reset/expiry, blanking, hide/restore and the four digital corners. For an offline package, repeat after a restart with networking disabled and confirm there are no external runtime requests. Keep sleep settings and browser policy under organizational control.

The recommendation does not select a hosting provider, change institutional policy, install a runtime, add a remote, or publish this application.
