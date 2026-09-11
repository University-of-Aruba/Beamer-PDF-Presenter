# Offline PDF.js assets

The portable Windows package includes these assets. No setup command or
internet connection is needed on the presentation laptop. The renderer and
worker use Mozilla's `legacy` compatibility build from the same pinned
distribution. Both keep their existing application-facing filenames.

For maintainers, prepare the version pinned in `dependencies.lock.json` from
an existing npm distribution archive:

```bash
python3 tools/cache_pdfjs.py --archive .tmp/downloads/pdfjs-dist-6.3.289.tgz
```

Omitting `--archive` downloads the exact locked HTTPS archive during package
preparation. The helper verifies the complete SHA-512 integrity before copying
any archive assets. The application itself does not run this helper.

Included files:

- `pdf.min.mjs`, from `package/legacy/build/pdf.min.mjs`
- `pdf.worker.min.mjs`, from `package/legacy/build/pdf.worker.min.mjs`
- `LICENSE`
- `package.json`
- `cmaps/`, `standard_fonts/`, `wasm/`, and `iccs/`, including their licenses
- `assets-manifest.json`, recording the version, `legacy` build, original
  renderer/worker archive paths, archive origin and integrity, and a SHA-256
  digest for every installed dependency file

Preparation rejects unsafe archive entries, incomplete resources, and unknown
or modified files in an existing cache. A complete staged cache replaces the
previous directory only after validation; the prior cache remains under
`.tmp/pdfjs-backups/`. This README is preserved during replacement.

The helper can replace a verified earlier modern-build cache whose receipt
does not contain build metadata. The old cache and receipt remain in its backup;
the replacement receipt explicitly identifies the compatibility build.

Mozilla's [browser support documentation](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions#which-browsersenvironments-are-supported)
describes the legacy build as translated and polyfilled for older browsers.
It still has minimum browser requirements; it does not support every browser
or remove organizational security restrictions. Application validation records
identify the browser checks actually performed.
