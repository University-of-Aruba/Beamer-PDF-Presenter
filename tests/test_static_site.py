"""Verify the public site inventory, link configuration, and failure boundaries."""

from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from tools import build_static_site as site
from tools import build_windows_package as package


class StaticSiteTests(unittest.TestCase):
    """Build isolated public sites using a complete, integrity-checked PDF cache."""

    def setUp(self) -> None:
        """Create public inputs, private decoys, and a valid dependency receipt."""
        self.temporary = tempfile.TemporaryDirectory(prefix="presenter-static-test-")
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.root = self.base / "source"
        self.output = self.base / "published"
        self.root.mkdir()
        for name in site.WEB_FILES:
            self.write_source(name, f"public fixture: {name}".encode())
        self.write_source("index.html", b'<!doctype html><head><meta charset="utf-8"></head><body>Presenter</body>')
        self.write_source("web/index.html", b'<a href="{{SOURCE_URL}}">Source</a><a href="{{DOWNLOAD_URL}}">Download</a>{{LOCAL_BUILD_NOTE}}')
        self.write_source("web/welcome.css", b"body { color: white; }")
        self.write_source("logos/sisstem.png", b"SISSTEM logo fixture")
        self.write_source("logos/faculty_of_arts_and_science.png", b"Faculty logo fixture")
        for name in (
            ".git/config", ".github/workflows/ci.yml", ".tmp/private.pdf",
            "runtime/python/python.exe", "serve.py", "launch_windows.py",
            "tools/maintainer.py", "tests/test_private.py", "personal-lecture.pdf",
            "logos/.private.png", "logos/nested/private.png", "logos/notes.txt",
        ):
            self.write_source(name, b"PRIVATE DECOY MUST NOT BE PUBLISHED")
        lock = {"version": "6.3.289", "url": "https://example.invalid/pdfjs.tgz", "integrity": "sha512-fixture"}
        self.write_source("dependencies.lock.json", json.dumps({"pdfjs": lock}).encode())
        self.cache_files = {
            "pdf.min.mjs": b"renderer", "pdf.worker.min.mjs": b"worker",
            "LICENSE": b"Apache dependency license", "package.json": b'{}',
            "cmaps/example.bcmap": b"cmap", "cmaps/LICENSE": b"cmap license",
            "standard_fonts/example.pfb": b"font", "standard_fonts/LICENSE_FOXIT": b"font license",
            "wasm/example.wasm": b"wasm", "wasm/LICENSE_OPENJPEG": b"wasm license",
            "iccs/example.icc": b"icc", "iccs/LICENSE": b"icc license",
        }
        for name, data in self.cache_files.items():
            self.write_source(f"vendor/pdfjs/{name}", data)
        self.receipt = {
            "version": lock["version"],
            "origin": {name: lock[name] for name in ("url", "integrity")},
            "build": "legacy",
            "runtime_sources": {
                "pdf.min.mjs": "package/legacy/build/pdf.min.mjs",
                "pdf.worker.min.mjs": "package/legacy/build/pdf.worker.min.mjs",
            },
            "files": {name: hashlib.sha256(data).hexdigest() for name, data in self.cache_files.items()},
        }
        self.write_receipt()
        for module in (site, package):
            patch = mock.patch.object(module, "APP_ROOT", self.root)
            patch.start()
            self.addCleanup(patch.stop)

    def write_source(self, name: str, data: bytes) -> Path:
        """Write one fixture file inside the source directory.

        Args:
            name: Source-relative POSIX filename.
            data: Exact fixture content.

        Returns:
            The written path.
        """
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return path

    def write_receipt(self) -> None:
        """Write the mutable cache receipt used to exercise rejection paths."""
        self.write_source("vendor/pdfjs/assets-manifest.json", json.dumps(self.receipt).encode())

    def make_symlink(self, path: Path, target: Path) -> None:
        """Create a fixture alias, skipping platforms without link permission.

        Args:
            path: New symbolic link path.
            target: Existing file or directory referenced by the link.
        """
        try:
            path.symlink_to(target, target_is_directory=target.is_dir())
        except (OSError, NotImplementedError):
            self.skipTest("This platform does not permit fixture symlinks.")

    def test_public_inventory_has_app_licenses_logos_and_verified_manifest(self) -> None:
        """Publish complete browser inputs and license sources without private files."""
        result = site.build_site(self.output)
        manifest = json.loads((self.output / "site-manifest.json").read_text())
        files = manifest["files"]
        self.assertEqual(manifest["schema_version"], 1)
        self.assertEqual(result["manifest_files"], len(files))
        actual = {path.relative_to(self.output).as_posix() for path in self.output.rglob("*") if path.is_file()}
        self.assertEqual(actual, set(files) | {"site-manifest.json"})
        for name, digest in files.items():
            self.assertEqual(hashlib.sha256((self.output / name).read_bytes()).hexdigest(), digest)
            self.assertNotIn(b"PRIVATE DECOY", (self.output / name).read_bytes())
        for name in (
            "app.mjs", "countdown.mjs", "timer-view.mjs", "splitter.mjs",
            "pdf-library.mjs", "pdf-activation.mjs", "laser-pointer.mjs", "branding.mjs",
            "LICENSE.txt", "NOTICE", "THIRD_PARTY_NOTICES.md",
            "LICENSES/original-beamer-presenter-MIT.txt", "LICENSES/core-js-3.50.0-MIT.txt",
            "LICENSES/quickjs-MIT.txt", "LICENSES/pdf-js-quickjs-MIT.txt",
            "LICENSES/liberation-fonts-1.07.4.tar.gz", "LICENSES/provenance.json",
            "logos/faculty_of_arts_and_science.png", "logos/sisstem.png", "logos/SOURCES.md",
        ):
            self.assertEqual((self.output / "presenter" / name).read_bytes(), (self.root / name).read_bytes())
        self.assertTrue((self.output / ".nojekyll").is_file())
        self.assertEqual(
            json.loads((self.output / "presenter/logos/catalog.json").read_text()),
            {"filenames": ["faculty_of_arts_and_science.png", "sisstem.png"]},
        )
        for name, data in self.cache_files.items():
            self.assertEqual((self.output / "presenter/vendor/pdfjs" / name).read_bytes(), data)
        self.assertIn('http-equiv="Content-Security-Policy"', (self.output / "presenter/index.html").read_text())

    def test_local_links_do_not_invent_a_github_owner(self) -> None:
        """Keep local source/download links on the startup instructions."""
        site.build_site(self.output)
        landing = (self.output / "index.html").read_text()
        self.assertEqual(landing.count('href="#offline"'), 2)
        self.assertNotIn("https://github.com/", landing)
        self.assertIn("Local preview", landing)
        self.assertNotIn("{{", landing)

    def test_repository_links_use_the_explicit_owner_and_project(self) -> None:
        """Generate the supplied repository and latest-release URLs."""
        site.build_site(self.output, "example-owner/Beamer.PDF-Presenter")
        landing = (self.output / "index.html").read_text()
        self.assertIn('href="https://github.com/example-owner/Beamer.PDF-Presenter"', landing)
        self.assertIn('href="https://github.com/example-owner/Beamer.PDF-Presenter/releases/latest"', landing)
        self.assertNotIn("Local preview", landing)
        self.assertNotIn("{{", landing)

    def test_invalid_repository_names_fail_without_output(self) -> None:
        """Reject malformed identities and URL dot segments before publication."""
        for repository in ("owner", "owner/repo/extra", "owner/repo?x=1", "bad owner/repo", "owner/<script>", "owner/.", "owner/.."):
            with self.subTest(repository=repository):
                with self.assertRaises(ValueError):
                    site.build_site(self.output, repository)
                self.assertFalse(self.output.exists())

    def test_existing_output_is_preserved(self) -> None:
        """Refuse to replace an earlier published build even if source input changed."""
        site.build_site(self.output)
        original = {path.relative_to(self.output): path.read_bytes() for path in self.output.rglob("*") if path.is_file()}
        self.write_source("app.mjs", b"changed application")
        with self.assertRaises(FileExistsError):
            site.build_site(self.output)
        self.assertEqual(original, {path.relative_to(self.output): path.read_bytes() for path in self.output.rglob("*") if path.is_file()})

    def test_protected_output_locations_are_rejected(self) -> None:
        """Prevent generated pages from being placed in source or Git control folders."""
        for folder in ("vendor", "logos", "LICENSES", "web", ".git", "assets"):
            with self.subTest(folder=folder):
                destination = self.root / folder / "generated-site"
                with self.assertRaises(ValueError):
                    site.build_site(destination)
                self.assertFalse(destination.exists())

    def test_unsafe_or_duplicate_source_inventory_is_rejected(self) -> None:
        """Refuse traversal and case-colliding public file lists."""
        for extra in ("../private.txt", "APP.MJS"):
            with self.subTest(extra=extra), mock.patch.object(site, "WEB_FILES", (*site.WEB_FILES, extra)):
                with self.assertRaises(ValueError):
                    site.build_site(self.output)
                self.assertFalse(self.output.exists())

    def test_required_source_symlink_is_rejected(self) -> None:
        """Prevent the public inventory from following a source file alias."""
        module = self.root / "app.mjs"
        moved = self.base / "outside.mjs"
        module.rename(moved)
        self.make_symlink(module, moved)
        with self.assertRaises(ValueError):
            site.build_site(self.output)
        self.assertFalse(self.output.exists())

    def test_output_symlink_does_not_modify_its_target(self) -> None:
        """Preserve another directory when it is aliased as the destination."""
        target = self.base / "outside"
        target.mkdir()
        self.make_symlink(self.output, target)
        with self.assertRaises(FileExistsError):
            site.build_site(self.output)
        self.assertEqual(list(target.iterdir()), [])

    def test_invalid_pdf_receipt_leaves_no_partial_publication(self) -> None:
        """Refuse dependency provenance that does not match the locked build."""
        self.receipt["version"] = "0.0.0"
        self.write_receipt()
        with self.assertRaises(ValueError):
            site.build_site(self.output)
        self.assertFalse(self.output.exists())
        self.assertEqual(list(self.base.glob("public-site-*")), [])

    def test_changed_cached_file_leaves_no_partial_publication(self) -> None:
        """Reject a damaged cached worker while keeping the output unpublished."""
        self.write_source("vendor/pdfjs/pdf.worker.min.mjs", b"modified worker")
        with self.assertRaises(ValueError):
            site.build_site(self.output)
        self.assertFalse(self.output.exists())

    def test_symlinked_receipt_is_rejected(self) -> None:
        """Reject a cache manifest aliased outside the declared dependency tree."""
        receipt = self.root / "vendor/pdfjs/assets-manifest.json"
        moved = self.base / "outside-receipt.json"
        receipt.rename(moved)
        self.make_symlink(receipt, moved)
        with self.assertRaises(ValueError):
            site.build_site(self.output)
        self.assertFalse(self.output.exists())


if __name__ == "__main__":
    unittest.main()
