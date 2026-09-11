"""Verify official Windows runtime downloads without networking or execution."""

from __future__ import annotations

import hashlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from tools import download_windows_runtime as runtime


class RuntimeDownloadTests(unittest.TestCase):
    """Exercise reuse, trusted origins, integrity failures, and interrupted reads."""

    def setUp(self) -> None:
        """Create a fake archive and lock in an isolated source directory."""
        self.temporary = tempfile.TemporaryDirectory(prefix="presenter-runtime-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.output = self.root / "downloads/python.zip"
        self.lock_path = self.root / "dependencies.lock.json"
        self.archive = b"locked fixture bytes; never executed"
        self.url = "https://www.python.org/ftp/python/3.14.7/python-3.14.7-embed-amd64.zip"
        self.lock = {"url": self.url, "sha256": hashlib.sha256(self.archive).hexdigest()}
        self.write_lock()
        patch = mock.patch.object(runtime.urllib.request, "urlopen")
        self.urlopen = patch.start()
        self.addCleanup(patch.stop)

    def write_lock(self) -> None:
        """Write the current fake dependency lock for the next download attempt."""
        self.lock_path.write_text(json.dumps({"python": self.lock}), encoding="utf-8")

    def response(self, data: bytes | None = None, url: str | None = None) -> mock.MagicMock:
        """Create a context-managed stream returned by the mocked HTTPS opener.

        Args:
            data: Response bytes, or the expected archive when omitted.
            url: Final response URL, or the official URL when omitted.

        Returns:
            A mock response whose body is read from memory.
        """
        response = mock.MagicMock()
        response.__enter__.return_value = response
        response.geturl.return_value = self.url if url is None else url
        response.read.side_effect = io.BytesIO(self.archive if data is None else data).read
        self.urlopen.return_value = response
        return response

    def test_download_verifies_bytes_and_uses_the_locked_official_url(self) -> None:
        """Publish only an archive with the exact expected SHA-256."""
        self.response()
        result = runtime.download_runtime(self.output, self.lock_path)
        self.assertEqual(result, self.output)
        self.assertEqual(result.read_bytes(), self.archive)
        self.urlopen.assert_called_once_with(self.url, timeout=60)
        self.assertEqual(list(self.output.parent.iterdir()), [self.output])

    def test_matching_existing_archive_is_reused_without_network(self) -> None:
        """Avoid fetching an input that has already passed its integrity check."""
        self.output.parent.mkdir()
        self.output.write_bytes(self.archive)
        self.assertEqual(runtime.download_runtime(self.output, self.lock_path), self.output)
        self.urlopen.assert_not_called()
        self.assertEqual(self.output.read_bytes(), self.archive)

    def test_mismatched_existing_archive_is_preserved_without_network(self) -> None:
        """Refuse to overwrite an existing archive with different bytes."""
        self.output.parent.mkdir()
        self.output.write_bytes(b"unrelated existing file")
        with self.assertRaises(ValueError):
            runtime.download_runtime(self.output, self.lock_path)
        self.urlopen.assert_not_called()
        self.assertEqual(self.output.read_bytes(), b"unrelated existing file")

    def test_bad_download_hash_leaves_no_archive(self) -> None:
        """Discard a complete response whose checksum differs from the lock."""
        self.response(b"wrong archive")
        with self.assertRaises(ValueError):
            runtime.download_runtime(self.output, self.lock_path)
        self.assertFalse(self.output.exists())
        self.assertEqual(list(self.output.parent.iterdir()), [])

    def test_off_origin_or_insecure_redirect_is_rejected_before_body_read(self) -> None:
        """Refuse redirects to another origin or an unencrypted Python URL."""
        for url in ("https://example.invalid/python.zip", "http://www.python.org/python.zip", "https://www.python.org.example.invalid/python.zip"):
            with self.subTest(url=url):
                response = self.response(url=url)
                with self.assertRaises(ValueError):
                    runtime.download_runtime(self.output, self.lock_path)
                response.read.assert_not_called()
                self.assertFalse(self.output.exists())

    def test_same_origin_redirect_remains_integrity_checked(self) -> None:
        """Allow an official-origin redirect only when the returned bytes match."""
        self.response(url="https://www.python.org/ftp/python/redirected.zip")
        self.assertEqual(runtime.download_runtime(self.output, self.lock_path).read_bytes(), self.archive)

    def test_invalid_lock_is_rejected_without_network(self) -> None:
        """Reject untrusted origins and malformed SHA-256 values before opening a URL."""
        for update in (
            {"url": "https://example.invalid/python.zip"},
            {"url": "http://www.python.org/python.zip"},
            {"sha256": "f" * 63}, {"sha256": "g" * 64},
        ):
            with self.subTest(update=update):
                original = self.lock.copy()
                self.lock.update(update)
                self.write_lock()
                with self.assertRaises(ValueError):
                    runtime.download_runtime(self.output, self.lock_path)
                self.lock = original
                self.assertFalse(self.output.exists())
        self.urlopen.assert_not_called()

    def test_network_failure_leaves_no_unverified_archive(self) -> None:
        """Preserve a clean destination after the HTTPS opener fails."""
        self.urlopen.side_effect = OSError("fixture network failure")
        with self.assertRaises(OSError):
            runtime.download_runtime(self.output, self.lock_path)
        self.assertFalse(self.output.exists())
        self.assertEqual(list(self.output.parent.iterdir()), [])

    def test_interrupted_body_read_leaves_no_unverified_archive(self) -> None:
        """Remove temporary response data when the network stream stops early."""
        response = self.response()
        response.read.side_effect = [b"partial bytes", OSError("fixture interrupted read")]
        with self.assertRaises(OSError):
            runtime.download_runtime(self.output, self.lock_path)
        self.assertFalse(self.output.exists())
        self.assertEqual(list(self.output.parent.iterdir()), [])

    def test_output_symlink_does_not_modify_its_target(self) -> None:
        """Reject a destination alias even when its target has the expected bytes."""
        target = self.root / "existing.zip"
        target.write_bytes(self.archive)
        self.output.parent.mkdir()
        try:
            self.output.symlink_to(target)
        except (OSError, NotImplementedError):
            self.skipTest("This platform does not permit fixture symlinks.")
        with self.assertRaises(ValueError):
            runtime.download_runtime(self.output, self.lock_path)
        self.urlopen.assert_not_called()
        self.assertEqual(target.read_bytes(), self.archive)

    def test_file_created_during_download_is_not_overwritten(self) -> None:
        """Keep a file that appears after the initial destination check."""
        response = self.response()
        response.geturl.side_effect = self.create_racing_file
        with self.assertRaises(FileExistsError):
            runtime.download_runtime(self.output, self.lock_path)
        self.assertEqual(self.output.read_bytes(), b"another process wrote this")
        self.assertEqual(list(self.output.parent.iterdir()), [self.output])

    def test_failed_publication_leaves_no_archive_or_temporary_files(self) -> None:
        """Keep the destination unpublished when the atomic link cannot be created."""
        self.response()
        with mock.patch.object(runtime.os, "link", side_effect=OSError("fixture publication failure")) as publish:
            with self.assertRaises(OSError):
                runtime.download_runtime(self.output, self.lock_path)
            publish.assert_called_once()
        self.assertFalse(self.output.exists())
        self.assertEqual(list(self.output.parent.iterdir()), [])

    def create_racing_file(self) -> str:
        """Create a competing output immediately before response bytes are read.

        Returns:
            The trusted URL used by the response mock.
        """
        self.output.write_bytes(b"another process wrote this")
        return self.url


if __name__ == "__main__":
    unittest.main()
