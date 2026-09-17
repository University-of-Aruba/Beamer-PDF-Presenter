"""Check portable source and logo selection without a Windows runtime or network."""

from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import launch_windows
from tools import build_windows_package as builder


class PackageSourceTests(unittest.TestCase):
    """Verify that a new package contains complete code and a safe logo catalog."""

    def setUp(self) -> None:
        """Create a source fixture and an empty package destination."""
        self.temporary = tempfile.TemporaryDirectory(prefix="presenter-package-source-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / "source"
        self.destination = Path(self.temporary.name) / "package"
        self.root.mkdir()
        self.destination.mkdir()
        for name in builder.SOURCE_FILES:
            source = self.root / name
            source.parent.mkdir(parents=True, exist_ok=True)
            source.write_bytes(f"source fixture {name}".encode("utf-8"))
        self.patch = mock.patch.object(builder, "APP_ROOT", self.root)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def make_symlink(self, path: Path, target: Path) -> None:
        """Create a symlink, skipping only when the platform disallows it.

        Args:
            path: New link path inside the fixture.
            target: Existing file or directory to reference.
        """
        try:
            path.symlink_to(target, target_is_directory=target.is_dir())
        except (OSError, NotImplementedError):
            self.skipTest("This platform does not permit fixture symlinks.")

    def test_required_feature_modules_and_default_brand_are_copied(self) -> None:
        """Include browser imports, sample narration and the default logo provenance."""
        builder.copy_source(self.destination)
        for name in (
            "pdf-library.mjs", "pdf-activation.mjs", "laser-pointer.mjs", "branding.mjs",
            "narration.mjs", "narration-player.mjs", "narration-controls.mjs", "narration-audience.mjs", "preview-render.mjs", "page-render-cache.mjs", "sample-beamer.txt",
            "logos/sisstem.png", "logos/README.md", "logos/SOURCES.md",
        ):
            self.assertEqual((self.destination / name).read_bytes(), (self.root / name).read_bytes())
        self.assertEqual(
            json.loads((self.destination / "logos/catalog.json").read_text()),
            {"filenames": ["sisstem.png"]},
        )

    def test_custom_pngs_generate_a_catalog_from_only_copied_assets(self) -> None:
        """Include custom PNGs while excluding hidden, nested and unrelated files."""
        logos = self.root / "logos"
        (logos / "faculty_of_arts.PNG").write_bytes(b"custom PNG content")
        (logos / "école.png").write_bytes(b"another PNG")
        (logos / ".secret.png").write_bytes(b"hidden")
        (logos / "---.png").write_bytes(b"empty name")
        (logos / "notes.txt").write_text("unrelated")
        (logos / "nested.png").mkdir()
        (logos / "nested.png" / "child.png").write_bytes(b"nested")
        (logos / "catalog.json").write_text('{"filenames":["../outside.png","stale.png"]}')
        builder.copy_source(self.destination)
        self.assertEqual(
            json.loads((self.destination / "logos/catalog.json").read_text()),
            {"filenames": ["faculty_of_arts.PNG", "sisstem.png", "école.png"]},
        )
        self.assertEqual(
            {entry.name for entry in (self.destination / "logos").iterdir()},
            {"faculty_of_arts.PNG", "sisstem.png", "école.png", "README.md", "SOURCES.md", "catalog.json"},
        )

    def test_missing_required_module_fails_before_copying_source(self) -> None:
        """Reject an incomplete browser module set before creating package contents."""
        (self.root / "branding.mjs").unlink()
        with self.assertRaisesRegex(ValueError, "missing"):
            builder.copy_source(self.destination)
        self.assertEqual(list(self.destination.iterdir()), [])

    def test_unsafe_source_paths_are_rejected(self) -> None:
        """Reject traversal, absolute paths and Windows aliases in source entries."""
        for name in ("../outside.txt", "/outside.txt", "logos\\outside.png", "CON.png", "COM¹.png"):
            with self.subTest(name=name), mock.patch.object(builder, "SOURCE_FILES", (*builder.SOURCE_FILES, name)):
                with self.assertRaisesRegex(ValueError, "Unsafe archive path"):
                    builder.copy_source(self.destination)
        self.assertEqual(list(self.destination.iterdir()), [])

    def test_required_file_symlinks_are_rejected(self) -> None:
        """Prevent required files from referencing content outside the application."""
        outside = Path(self.temporary.name) / "outside.mjs"
        outside.write_text("outside content")
        module = self.root / "branding.mjs"
        module.unlink()
        self.make_symlink(module, outside)
        with self.assertRaisesRegex(ValueError, "symlink"):
            builder.copy_source(self.destination)

    def test_logo_directory_symlinks_are_rejected(self) -> None:
        """Reject an aliased logo directory even if its files remain inside the source."""
        logos = self.root / "logos"
        moved = self.root / "other-logos"
        logos.rename(moved)
        self.make_symlink(logos, moved)
        with self.assertRaisesRegex(ValueError, "symlink"):
            builder.copy_source(self.destination)

    def test_custom_logo_symlinks_are_rejected(self) -> None:
        """Refuse linked custom logos instead of packaging the link target."""
        self.make_symlink(self.root / "logos/linked.png", self.root / "logos/sisstem.png")
        with self.assertRaisesRegex(ValueError, "symlink"):
            builder.copy_source(self.destination)

    def test_source_root_symlinks_are_rejected(self) -> None:
        """Keep the declared source root from being an alias to another tree."""
        alias = Path(self.temporary.name) / "source-alias"
        self.make_symlink(alias, self.root)
        with mock.patch.object(builder, "APP_ROOT", alias), self.assertRaisesRegex(ValueError, "root is a symlink"):
            builder.copy_source(self.destination)

    def test_destination_symlinks_are_rejected_before_any_writes(self) -> None:
        """Prevent source copying through an aliased package destination."""
        alias = Path(self.temporary.name) / "package-alias"
        self.make_symlink(alias, self.destination)
        with self.assertRaisesRegex(ValueError, "destination must be an empty directory"):
            builder.copy_source(alias)
        self.assertEqual(list(self.destination.iterdir()), [])

    def test_logo_names_cannot_collide_on_windows(self) -> None:
        """Reject case variants even when testing on a case-insensitive host volume."""
        lower = self.root / "logos/faculty.png"
        upper = self.root / "logos/FACULTY.png"
        lower.write_bytes(b"first")
        upper.write_bytes(b"second")
        with mock.patch.object(Path, "iterdir", return_value=iter([lower, upper])):
            with self.assertRaisesRegex(ValueError, "conflict on Windows"):
                builder.logo_source_names()

    def test_custom_logos_can_be_added_without_weakening_packaged_file_checks(self) -> None:
        """Allow later logo additions while keeping inventoried logo hashes protected."""
        builder.copy_source(self.destination)
        required = launch_windows.REQUIRED_FILES | {
            "runtime/python/python314._pth", "runtime/python/python314.zip",
            "runtime/python/python314.dll", "vendor/pdfjs/cmaps/test.bcmap",
            "vendor/pdfjs/standard_fonts/test.pfb", "vendor/pdfjs/wasm/test.wasm",
        }
        for name in required:
            path = self.destination / name
            if not path.exists():
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"runtime fixture")
        files = {
            path.relative_to(self.destination).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in self.destination.rglob("*") if path.is_file()
        }
        (self.destination / "package-manifest.json").write_text(json.dumps({"schema_version": 1, "files": files}))
        self.assertEqual(launch_windows.verify_package(self.destination), len(files))
        (self.destination / "logos/new_faculty.png").write_bytes(b"new user logo")
        self.assertEqual(launch_windows.verify_package(self.destination), len(files))
        (self.destination / "logos/sisstem.png").write_bytes(b"changed packaged logo")
        with self.assertRaisesRegex(launch_windows.PackageError, "incomplete or changed"):
            launch_windows.verify_package(self.destination)


class PackagePdfCacheTests(unittest.TestCase):
    """Check compatibility-build provenance before copying cached PDF assets."""

    def setUp(self) -> None:
        """Create a complete fixture cache with matching origin and file hashes."""
        self.temporary = tempfile.TemporaryDirectory(prefix="presenter-package-pdf-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / "source"
        self.cache = self.root / "vendor/pdfjs"
        self.destination = Path(self.temporary.name) / "package"
        self.cache.mkdir(parents=True)
        self.destination.mkdir()
        self.lock = {
            "version": "6.3.289", "url": "https://example.invalid/pdfjs-dist.tgz",
            "integrity": "fixture-archive-integrity",
        }
        self.contents = {
            "pdf.min.mjs": b"legacy renderer fixture",
            "pdf.worker.min.mjs": b"legacy worker fixture",
            "LICENSE": b"PDF.js license fixture",
            "package.json": b'{"name":"pdfjs-dist","version":"6.3.289"}',
            "cmaps/sample.bcmap": b"character map fixture",
            "standard_fonts/sample.pfb": b"font fixture",
            "wasm/sample.wasm": b"WebAssembly fixture",
            "iccs/sample.icc": b"color profile fixture",
        }
        self.receipt = {
            "schema_version": 1,
            "version": self.lock["version"],
            "build": "legacy",
            "runtime_sources": {
                "pdf.min.mjs": "package/legacy/build/pdf.min.mjs",
                "pdf.worker.min.mjs": "package/legacy/build/pdf.worker.min.mjs",
            },
            "origin": {key: self.lock[key] for key in ("url", "integrity")},
            "files": {},
        }
        self.write_cache()
        self.patch = mock.patch.object(builder, "APP_ROOT", self.root)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def write_cache(self) -> None:
        """Write fixture files and a receipt with their actual SHA-256 hashes."""
        for name, data in self.contents.items():
            source = self.cache / name
            source.parent.mkdir(parents=True, exist_ok=True)
            source.write_bytes(data)
        self.receipt["files"] = {
            name: hashlib.sha256(data).hexdigest() for name, data in self.contents.items()
        }
        (self.cache / "assets-manifest.json").write_text(
            json.dumps(self.receipt), encoding="utf-8"
        )

    def test_legacy_pair_copies_exact_bytes_hashes_and_provenance(self) -> None:
        """Accept the complete legacy pair and copy only receipt-owned files."""
        (self.cache / "unrelated.txt").write_bytes(b"do not package")
        self.assertEqual(builder.copy_pdfjs(self.destination, self.lock), len(self.contents))
        copied = self.destination / "vendor/pdfjs"
        self.assertEqual(
            {path.relative_to(copied).as_posix() for path in copied.rglob("*") if path.is_file()},
            set(self.contents) | {"assets-manifest.json"},
        )
        self.assertEqual(
            (copied / "assets-manifest.json").read_bytes(),
            (self.cache / "assets-manifest.json").read_bytes(),
        )
        for name, data in self.contents.items():
            self.assertEqual((copied / name).read_bytes(), data)
            self.assertEqual(
                hashlib.sha256((copied / name).read_bytes()).hexdigest(),
                self.receipt["files"][name],
            )

    def test_hashed_modern_cache_is_rejected_before_copying(self) -> None:
        """Reject previous and explicit modern receipts despite valid file hashes."""
        self.contents["pdf.min.mjs"] = b"modern renderer fixture"
        self.contents["pdf.worker.min.mjs"] = b"modern worker fixture"
        for declared_build in (None, "modern"):
            with self.subTest(build=declared_build):
                if declared_build is None:
                    self.receipt.pop("build", None)
                    self.receipt.pop("runtime_sources", None)
                else:
                    self.receipt["build"] = declared_build
                    self.receipt["runtime_sources"] = {
                        "pdf.min.mjs": "package/build/pdf.min.mjs",
                        "pdf.worker.min.mjs": "package/build/pdf.worker.min.mjs",
                    }
                self.write_cache()
                with self.assertRaisesRegex(ValueError, "matched legacy compatibility build"):
                    builder.copy_pdfjs(self.destination, self.lock)
                self.assertEqual(list(self.destination.iterdir()), [])

    def test_hashed_mixed_pair_is_rejected_before_copying(self) -> None:
        """Reject either modern member even when the receipt labels it legacy."""
        original_sources = dict(self.receipt["runtime_sources"])
        original_contents = dict(self.contents)
        for name in ("pdf.min.mjs", "pdf.worker.min.mjs"):
            with self.subTest(modern_member=name):
                self.receipt["runtime_sources"] = dict(original_sources)
                self.receipt["runtime_sources"][name] = f"package/build/{name}"
                self.contents = dict(original_contents)
                self.contents[name] = b"modern member fixture"
                self.write_cache()
                with self.assertRaisesRegex(ValueError, "matched legacy compatibility build"):
                    builder.copy_pdfjs(self.destination, self.lock)
                self.assertEqual(list(self.destination.iterdir()), [])

    def test_legacy_metadata_does_not_bypass_runtime_hash_check(self) -> None:
        """Reject changed renderer bytes even with accepted compatibility metadata."""
        (self.cache / "pdf.min.mjs").write_bytes(b"changed after receipt was written")
        with self.assertRaisesRegex(ValueError, "file is changed: pdf.min.mjs"):
            builder.copy_pdfjs(self.destination, self.lock)
        self.assertEqual(list(self.destination.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
