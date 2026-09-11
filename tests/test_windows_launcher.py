"""Verify portable extraction checks before any presentation server executes."""

from __future__ import annotations

import contextlib
import hashlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import launch_windows


class PortableLauncherTests(unittest.TestCase):
    """Exercise complete, incomplete, corrupted, and unsafe package fixtures."""

    def setUp(self) -> None:
        """Create a complete miniature package in a folder with spaces and accents."""
        self.temporary = tempfile.TemporaryDirectory(prefix="beamer-portable-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / "SISSTEM presentación"
        self.root.mkdir()
        names = set(launch_windows.REQUIRED_FILES) | {
            "runtime/python/python314._pth",
            "runtime/python/python314.zip",
            "runtime/python/python314.dll",
            "vendor/pdfjs/cmaps/fixture.bcmap",
            "vendor/pdfjs/standard_fonts/fixture.pfb",
            "vendor/pdfjs/wasm/fixture.wasm",
        }
        self.files = {}
        for name in sorted(names):
            content = f"test fixture for {name}".encode("utf-8")
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
            self.files[name] = hashlib.sha256(content).hexdigest()
        self.write_manifest()

    def write_manifest(self) -> None:
        """Write the current fixture inventory in the portable manifest format."""
        (self.root / launch_windows.MANIFEST_NAME).write_text(
            json.dumps({"schema_version": 1, "files": self.files}), encoding="utf-8"
        )

    def test_complete_package_with_spaces_and_non_ascii_path(self) -> None:
        """Accept all checksums from an extracted folder with a typical user path."""
        self.assertEqual(launch_windows.verify_package(self.root), len(self.files))

    def test_missing_and_changed_files_are_rejected(self) -> None:
        """Detect partial extraction and same-size corruption before server execution."""
        path = self.root / "vendor/pdfjs/pdf.min.mjs"
        content = path.read_bytes()
        path.write_bytes(b"x" * len(content))
        with self.assertRaisesRegex(launch_windows.PackageError, "incomplete or changed"):
            launch_windows.verify_package(self.root)
        path.unlink()
        with self.assertRaisesRegex(launch_windows.PackageError, "required file is missing"):
            launch_windows.verify_package(self.root)

    def test_missing_manifest_or_required_inventory_is_rejected(self) -> None:
        """Reject a source checkout or an inventory omitting launch/runtime/PDF files."""
        (self.root / launch_windows.MANIFEST_NAME).unlink()
        with self.assertRaisesRegex(launch_windows.PackageError, "manifest is missing"):
            launch_windows.verify_package(self.root)
        original = self.files.copy()
        for name in (
            "serve.py",
            "runtime/python/python314.zip",
            "vendor/pdfjs/cmaps/fixture.bcmap",
        ):
            with self.subTest(name=name):
                self.files = {key: value for key, value in original.items() if key != name}
                self.write_manifest()
                with self.assertRaises(launch_windows.PackageError):
                    launch_windows.verify_package(self.root)

    def test_manifest_format_and_duplicate_keys_are_rejected(self) -> None:
        """Reject malformed JSON, duplicate entries, and unsupported schema versions."""
        path = self.root / launch_windows.MANIFEST_NAME
        for content in (
            "{",
            '[]',
            '{"schema_version":true,"files":{}}',
            '{"schema_version":2,"files":{}}',
            '{"schema_version":1,"files":{},"files":{}}',
        ):
            with self.subTest(content=content):
                path.write_text(content, encoding="utf-8")
                with self.assertRaises(launch_windows.PackageError):
                    launch_windows.verify_package(self.root)

    def test_unsafe_windows_manifest_paths_are_rejected(self) -> None:
        """Refuse traversal, alternate streams, absolute paths, and device aliases."""
        for name in (
            "../outside.txt", "/absolute.txt", "C:/outside.txt", "folder\\file.txt",
            "folder/../file.txt", "folder//file.txt", "folder/./file.txt",
            "file.txt:stream", "folder/NUL.txt", "COM1", "file.txt ", "folder./file.txt",
        ):
            with self.subTest(name=name):
                with self.assertRaisesRegex(launch_windows.PackageError, "unsafe file name"):
                    launch_windows.checked_path(self.root, name)

    def test_symlink_component_is_rejected(self) -> None:
        """Refuse a manifest file replaced by a link even when the target hash matches."""
        path = self.root / "serve.py"
        target = Path(self.temporary.name) / "outside.py"
        target.write_bytes(path.read_bytes())
        path.unlink()
        try:
            path.symlink_to(target)
        except (OSError, NotImplementedError):
            self.skipTest("Symbolic links are not available on this filesystem.")
        with self.assertRaisesRegex(launch_windows.PackageError, "symbolic link"):
            launch_windows.verify_package(self.root)

    def test_case_collisions_and_invalid_checksums_are_rejected(self) -> None:
        """Prevent ambiguous extraction names and malformed expected digests."""
        self.files["index.html"] = "invalid"
        self.write_manifest()
        with self.assertRaisesRegex(launch_windows.PackageError, "invalid checksum"):
            launch_windows.verify_package(self.root)
        self.files["index.html"] = hashlib.sha256((self.root / "index.html").read_bytes()).hexdigest()
        self.files["INDEX.html"] = self.files["index.html"]
        (self.root / "INDEX.html").write_bytes((self.root / "index.html").read_bytes())
        self.write_manifest()
        with self.assertRaisesRegex(launch_windows.PackageError, "conflicting Windows"):
            launch_windows.verify_package(self.root)

    def test_check_only_never_starts_server(self) -> None:
        """Finish a portable preflight without server, browser, or persistent effects."""
        with (
            mock.patch.object(launch_windows, "APP_ROOT", self.root),
            mock.patch.object(launch_windows.runpy, "run_path") as run_path,
            contextlib.redirect_stdout(io.StringIO()),
        ):
            self.assertEqual(launch_windows.main(["--check"]), 0)
        run_path.assert_not_called()

    def test_invalid_package_does_not_execute_server(self) -> None:
        """Display extraction recovery and refuse execution when verification fails."""
        (self.root / "serve.py").write_bytes(b"changed script")
        output = io.StringIO()
        with (
            mock.patch.object(launch_windows, "APP_ROOT", self.root),
            mock.patch.object(launch_windows.runpy, "run_path") as run_path,
            contextlib.redirect_stdout(io.StringIO()),
            contextlib.redirect_stderr(output),
        ):
            self.assertEqual(launch_windows.main([]), 1)
        run_path.assert_not_called()
        self.assertIn("Extract all again", output.getvalue())

    def test_verified_launch_is_loopback_only_without_local_imports(self) -> None:
        """Execute the verified script by path with a fixed local host and optional browser flag."""
        with (
            mock.patch.object(launch_windows, "APP_ROOT", self.root),
            mock.patch.object(launch_windows.runpy, "run_path") as run_path,
            mock.patch.object(launch_windows.sys, "argv", ["launch_windows.py"]),
            mock.patch.object(launch_windows.sys, "dont_write_bytecode", False),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            self.assertEqual(launch_windows.main(["--no-browser"]), 0)
            self.assertEqual(
                launch_windows.sys.argv,
                [str(self.root / "serve.py"), "--host", "127.0.0.1", "--no-browser"],
            )
            self.assertTrue(launch_windows.sys.dont_write_bytecode)
        run_path.assert_called_once_with(str(self.root / "serve.py"), run_name="__main__")


if __name__ == "__main__":
    unittest.main()
