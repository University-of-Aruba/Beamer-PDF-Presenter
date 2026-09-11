"""Check offline PDF.js archive integrity, safe extraction, and cache recovery."""

from __future__ import annotations

import base64
import hashlib
import io
import json
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from tools import cache_pdfjs


class PdfCacheTests(unittest.TestCase):
    """Exercise real tarballs and filesystem swaps in isolated directories."""

    def setUp(self) -> None:
        """Create a licensed distribution with distinct modern and legacy builds."""
        self.temporary = tempfile.TemporaryDirectory(prefix="pdfjs-cache-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.destination = self.root / "vendor" / "pdfjs"
        self.destination.mkdir(parents=True)
        (self.destination / "README.md").write_text("Preserve this project documentation.", encoding="utf-8")
        (self.destination / "pdf.min.mjs").write_bytes(b"old renderer")
        self.entries = {
            "package/build/pdf.min.mjs": b"/* modern */ export const version = '6.3.289';",
            "package/build/pdf.worker.min.mjs": b"/* modern */ export const WorkerMessageHandler = {};",
            "package/legacy/build/pdf.min.mjs": b"/* legacy */ export const version = '6.3.289';",
            "package/legacy/build/pdf.worker.min.mjs": b"/* legacy */ export const WorkerMessageHandler = {};",
            "package/LICENSE": b"Apache License",
            "package/package.json": json.dumps({"name": "pdfjs-dist", "version": "6.3.289"}).encode(),
            "package/cmaps/sample.bcmap": b"cmap bytes",
            "package/cmaps/LICENSE": b"cmap license",
            "package/standard_fonts/sample.pfb": b"font bytes",
            "package/standard_fonts/LICENSE_FOXIT": b"font license",
            "package/wasm/openjpeg.wasm": b"wasm bytes",
            "package/wasm/LICENSE_OPENJPEG": b"wasm license",
            "package/iccs/sample.icc": b"ICC bytes",
            "package/iccs/LICENSE": b"ICC license",
            "package/web/pdf_viewer.mjs": b"unused viewer asset",
        }
        self.archive = self.root / "pdfjs.tgz"
        self.lock = self.root / "dependencies.lock.json"

    def write_archive(self, special: tarfile.TarInfo | None = None) -> None:
        """Write fixture entries and a matching integrity lock.

        Args:
            special: Optional non-regular archive entry for rejection checks.
        """
        with tarfile.open(self.archive, "w:gz") as archive:
            for name, data in self.entries.items():
                entry = tarfile.TarInfo(name)
                entry.size = len(data)
                archive.addfile(entry, io.BytesIO(data))
            if special is not None:
                archive.addfile(special)
        integrity = base64.b64encode(hashlib.sha512(self.archive.read_bytes()).digest()).decode()
        self.lock.write_text(json.dumps({"pdfjs": {"version": "6.3.289", "url": "https://example.invalid/pdfjs.tgz", "integrity": f"sha512-{integrity}"}}), encoding="utf-8")

    def prepare(self) -> dict:
        """Install the fixture cache using only its local archive.

        Returns:
            The installed runtime manifest.
        """
        return cache_pdfjs.prepare_cache(self.archive, self.lock, self.destination, self.root / "backups")

    def assert_original_cache(self) -> None:
        """Assert that a rejected update preserved both original files."""
        self.assertEqual((self.destination / "pdf.min.mjs").read_bytes(), b"old renderer")
        self.assertEqual((self.destination / "README.md").read_text(), "Preserve this project documentation.")
        self.assertFalse((self.destination / "assets-manifest.json").exists())

    def test_valid_archive_manifest_backup_and_repeat(self) -> None:
        """Install every resource, verify readback, retain history, and repeat."""
        self.write_archive()
        manifest = self.prepare()
        self.assertEqual(manifest["version"], "6.3.289")
        self.assertEqual(manifest["build"], "legacy")
        self.assertEqual(manifest["runtime_sources"], {
            "pdf.min.mjs": "package/legacy/build/pdf.min.mjs",
            "pdf.worker.min.mjs": "package/legacy/build/pdf.worker.min.mjs",
        })
        self.assertEqual(manifest["origin"], {
            key: value for key, value in json.loads(self.lock.read_text())["pdfjs"].items()
            if key in {"url", "integrity"}
        })
        for target, source in manifest["runtime_sources"].items():
            self.assertEqual((self.destination / target).read_bytes(), self.entries[source])
        self.assertEqual(len(manifest["files"]), 12)
        self.assertFalse((self.destination / "web").exists())
        self.assertEqual(json.loads((self.destination / "assets-manifest.json").read_text()), manifest)
        for name, digest in manifest["files"].items():
            self.assertEqual(hashlib.sha256((self.destination / name).read_bytes()).hexdigest(), digest)
        previous = list((self.root / "backups").glob("*/previous"))
        self.assertEqual(len(previous), 1)
        self.assertEqual((previous[0] / "pdf.min.mjs").read_bytes(), b"old renderer")
        self.assertEqual((self.destination / "README.md").read_text(), "Preserve this project documentation.")
        self.assertEqual(self.prepare(), manifest)

    def test_digest_mismatch_preserves_cache(self) -> None:
        """Reject a changed archive before extraction or cache replacement."""
        self.write_archive()
        with self.archive.open("ab") as archive:
            archive.write(b"tampered")
        with self.assertRaisesRegex(ValueError, "SHA-512"):
            self.prepare()
        self.assert_original_cache()

    def test_missing_worker_preserves_cache(self) -> None:
        """Refuse a missing legacy worker even when the modern worker exists."""
        del self.entries["package/legacy/build/pdf.worker.min.mjs"]
        self.write_archive()
        with self.assertRaisesRegex(ValueError, "pdf.worker.min.mjs"):
            self.prepare()
        self.assert_original_cache()

    def test_modern_receipt_upgrades_with_recorded_backup(self) -> None:
        """Replace a verified old modern receipt and retain its exact provenance."""
        self.write_archive()
        modern_manifest = self.prepare()
        del modern_manifest["build"]
        del modern_manifest["runtime_sources"]
        for target in ("pdf.min.mjs", "pdf.worker.min.mjs"):
            data = self.entries[f"package/build/{target}"]
            (self.destination / target).write_bytes(data)
            modern_manifest["files"][target] = hashlib.sha256(data).hexdigest()
        receipt = self.destination / "assets-manifest.json"
        receipt.write_text(json.dumps(modern_manifest), encoding="utf-8")

        updated = self.prepare()
        self.assertEqual(updated["build"], "legacy")
        self.assertEqual(updated["origin"], modern_manifest["origin"])
        backups = list((self.root / "backups").glob("*/previous/assets-manifest.json"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(json.loads(backups[0].read_text()), modern_manifest)
        self.assertEqual(
            (backups[0].parent / "pdf.min.mjs").read_bytes(),
            self.entries["package/build/pdf.min.mjs"],
        )
        self.assertEqual(
            (self.destination / "pdf.min.mjs").read_bytes(),
            self.entries["package/legacy/build/pdf.min.mjs"],
        )

    def test_unsafe_archive_paths_preserve_cache(self) -> None:
        """Reject traversal, absolute paths, and Windows path ambiguity."""
        for name in ("package/cmaps/../../escape", "/tmp/escape", "package/cmaps/dir\\escape", "package/cmaps/drive:file"):
            with self.subTest(name=name):
                self.entries[name] = b"unsafe"
                self.write_archive()
                with self.assertRaisesRegex(ValueError, "Unsafe asset path"):
                    self.prepare()
                self.assert_original_cache()
                del self.entries[name]

    def test_symbolic_link_is_rejected_even_outside_selected_assets(self) -> None:
        """Never follow or install symbolic links from an archive."""
        entry = tarfile.TarInfo("package/unused-link")
        entry.type = tarfile.SYMTYPE
        entry.linkname = "../../outside"
        self.write_archive(entry)
        with self.assertRaisesRegex(ValueError, "Non-regular"):
            self.prepare()
        self.assert_original_cache()

    def test_wrong_version_or_missing_resource_license(self) -> None:
        """Enforce package identity and resource provenance before publication."""
        self.entries["package/package.json"] = b'{"name":"pdfjs-dist","version":"0.0.0"}'
        self.write_archive()
        with self.assertRaisesRegex(ValueError, "version"):
            self.prepare()
        self.assert_original_cache()
        self.entries["package/package.json"] = b'{"name":"pdfjs-dist","version":"6.3.289"}'
        del self.entries["package/iccs/LICENSE"]
        self.write_archive()
        with self.assertRaisesRegex(ValueError, "licensing"):
            self.prepare()
        self.assert_original_cache()

    def test_unknown_existing_file_is_preserved(self) -> None:
        """Do not replace a cache containing unrelated user data."""
        self.write_archive()
        personal = self.destination / "personal-notes.txt"
        personal.write_bytes(b"retain")
        with self.assertRaisesRegex(ValueError, "Unrecognized"):
            self.prepare()
        self.assertEqual(personal.read_bytes(), b"retain")
        self.assert_original_cache()

    def test_modified_receipt_owned_file_is_preserved(self) -> None:
        """Refuse to overwrite a locally modified installed resource."""
        self.write_archive()
        self.prepare()
        modified = self.destination / "cmaps" / "sample.bcmap"
        modified.write_bytes(b"user changed asset")
        with self.assertRaisesRegex(ValueError, "modified"):
            self.prepare()
        self.assertEqual(modified.read_bytes(), b"user changed asset")

    def test_second_rename_failure_restores_previous_cache(self) -> None:
        """Restore the previous directory when installing the staged cache fails."""
        self.write_archive()
        original_rename = Path.rename

        def fail_install(path: Path, target: Path) -> Path:
            """Inject one installation failure while allowing rollback.

            Args:
                path: Source path of the attempted rename.
                target: Destination path of the attempted rename.

            Returns:
                Renamed destination for successful operations.

            Raises:
                OSError: Only when moving the staged cache into place.
            """
            if path.name == "staged":
                raise OSError("simulated installation failure")
            return original_rename(path, target)

        with mock.patch.object(Path, "rename", fail_install):
            with self.assertRaisesRegex(OSError, "simulated"):
                self.prepare()
        self.assert_original_cache()


if __name__ == "__main__":
    unittest.main()
