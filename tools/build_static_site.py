#!/usr/bin/env python3
"""Build the public welcome page and PDF demo from an explicit file inventory."""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import shutil
import tempfile
from pathlib import Path

if __package__:
    from . import build_windows_package as package
else:
    import build_windows_package as package

APP_ROOT = Path(__file__).resolve().parents[1]
WEB_FILES = (
    "index.html", "styles.css", "app.mjs", "countdown.mjs", "timer-view.mjs",
    "pdf-library.mjs", "pdf-activation.mjs", "laser-pointer.mjs", "branding.mjs",
    "narration.mjs", "narration-player.mjs", "narration-controls.mjs", "narration-audience.mjs", "preview-render.mjs", "page-render-cache.mjs",
    "sample-beamer.txt", "docs/NARRATION.md", "splitter.mjs", "sample-beamer.pdf", "VERSION",
    "logos/README.md", "logos/SOURCES.md", *package.LICENSE_FILES,
)
CONTENT_POLICY = (
    "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; "
    "worker-src 'self' blob:; connect-src 'self' blob: data:; "
    "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
    "font-src 'self' data: blob:; frame-src 'none'; object-src 'none'; "
    "base-uri 'none'; form-action 'none'"
)


def build_site(output: Path, repository: str | None = None) -> dict:
    """Create a new standalone static site without exposing the source checkout.

    Args:
        output: New directory, outside the canonical source and dependency paths.
        repository: Optional GitHub owner/repository for release and source links.

    Returns:
        Public output path and manifest file count.

    Raises:
        ValueError: Source paths, repository identity or dependency receipt are invalid.
        FileExistsError: The output already exists; previous builds are preserved.
    """
    if output.exists() or output.is_symlink():
        raise FileExistsError(f"Choose a new output directory: {output}")
    if repository and not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9_.-]+", repository):
        raise ValueError("Repository must have the form GitHub-owner/repository")
    if repository and repository.split("/")[1] in {".", ".."}:
        raise ValueError("Repository must name an actual repository, not a dot segment")
    resolved = output.resolve()
    if resolved.is_relative_to(APP_ROOT.resolve()):
        relative = resolved.relative_to(APP_ROOT.resolve())
        if not relative.parts or relative.parts[0] not in {"output", ".tmp"}:
            raise ValueError("Build inside output/ or .tmp/, not source or Git-control directories")
    for protected in (APP_ROOT, APP_ROOT / "vendor", APP_ROOT / "logos", APP_ROOT / "LICENSES", APP_ROOT / "web"):
        if resolved == protected.resolve() or (protected != APP_ROOT and resolved.is_relative_to(protected.resolve())):
            raise ValueError("The public output cannot replace a source or dependency directory")
    logos = package.logo_source_names()
    names = [*WEB_FILES, *logos]
    if len(names) != len(set(name.casefold() for name in names)):
        raise ValueError("Public source paths must be unique")
    sources = {name: package.checked_source_file(name) for name in names}
    landing = package.checked_source_file("web/index.html").read_text(encoding="utf-8")
    css = package.checked_source_file("web/welcome.css")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="public-site-", dir=output.parent) as temporary:
        site = Path(temporary) / "site"
        app = site / "presenter"
        app.mkdir(parents=True)
        for name, source in sources.items():
            target = app / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        (app / "logos/catalog.json").write_text(
            json.dumps({"filenames": [Path(name).name for name in logos]}, indent=2) + "\n", encoding="utf-8"
        )
        lock = json.loads((APP_ROOT / "dependencies.lock.json").read_text(encoding="utf-8"))
        package.copy_pdfjs(app, lock["pdfjs"])
        index = (app / "index.html").read_text(encoding="utf-8")
        meta = '<meta http-equiv="Content-Security-Policy" content="' + html.escape(CONTENT_POLICY, quote=True) + '">'
        index = index.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n  ' + meta, 1)
        (app / "index.html").write_text(index, encoding="utf-8")
        source_url = f"https://github.com/{repository}" if repository else "#offline"
        download_url = source_url + "/releases/latest" if repository else "#offline"
        landing = landing.replace("{{SOURCE_URL}}", html.escape(source_url, quote=True))
        landing = landing.replace("{{DOWNLOAD_URL}}", html.escape(download_url, quote=True))
        landing = landing.replace("{{LOCAL_BUILD_NOTE}}", "" if repository else
            '<p class="note">Local preview: a maintainer adds the GitHub repository when building the published download links.</p>')
        (site / "index.html").write_text(landing, encoding="utf-8")
        shutil.copyfile(css, site / "welcome.css")
        (site / ".nojekyll").write_text("", encoding="utf-8")
        files = {p.relative_to(site).as_posix(): package.sha256(p) for p in sorted(site.rglob("*")) if p.is_file()}
        (site / "site-manifest.json").write_text(json.dumps({"schema_version": 1, "files": files}, indent=2) + "\n", encoding="utf-8")
        site.rename(output)
    return {"path": str(output.resolve()), "manifest_files": len(files)}


def main() -> int:
    """Read the output path and optional repository from CLI or GitHub Actions.

    Returns:
        Zero after a complete public file set is built.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--repository", default=os.environ.get("GITHUB_REPOSITORY"))
    args = parser.parse_args()
    print(json.dumps(build_site(args.output, args.repository), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
