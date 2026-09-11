"""Exercise the local server's file boundary through actual HTTP requests."""

from __future__ import annotations

import functools
import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path

import serve


class ServingBoundaryTests(unittest.TestCase):
    """Check GET and HEAD behavior against an isolated application fixture."""

    @classmethod
    def setUpClass(cls) -> None:
        """Create a temporary application and start a loopback-only test server."""
        cls.temporary = tempfile.TemporaryDirectory(prefix="beamer-presenter-http-")
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.root = Path(cls.temporary.name) / "app"
        cls.root.mkdir()
        (cls.root / "index.html").write_text("<h1>Presenter</h1>", encoding="utf-8")
        (cls.root / "app.mjs").write_text("export const ready = true;", encoding="utf-8")
        (cls.root / "sample.pdf").write_bytes(b"%PDF-1.7\npublic fixture")
        (cls.root / "gear.svg").write_text("<svg></svg>", encoding="utf-8")
        (cls.root / ".git").mkdir()
        (cls.root / ".git" / "HEAD").write_text("private repository metadata", encoding="utf-8")
        (cls.root / ".secret.pdf").write_bytes(b"private PDF")
        (cls.root / "empty").mkdir()
        (cls.root / "nested").mkdir()
        (cls.root / "nested" / "index.html").write_text("nested public page", encoding="utf-8")
        (cls.root / "runtime").mkdir()
        (cls.root / "runtime" / "python.exe").write_bytes(b"private runtime")
        (cls.root / "package-manifest.json").write_text("private inventory", encoding="utf-8")
        (cls.root / "launch_windows.py").write_text("private launcher", encoding="utf-8")
        (cls.root / "logos").mkdir()
        (cls.root / "logos" / "sisstem.png").write_bytes(b"PNG fixture")
        (cls.root / "logos" / "faculty_of_arts_and_science.PNG").write_bytes(b"PNG fixture")
        (cls.root / "logos" / "readme.txt").write_text("not a logo", encoding="utf-8")
        (cls.root / "logos" / ".hidden.png").write_bytes(b"hidden logo")
        (cls.root / "logos" / "---.png").write_bytes(b"empty name")
        (cls.root / "logos" / "nested.png").mkdir()
        (cls.root / "logos" / "nested.png" / "child.png").write_bytes(b"nested logo")
        cls.outside = Path(cls.temporary.name) / "outside.txt"
        cls.outside.write_text("outside secret", encoding="utf-8")
        cls.symlinks_available = True
        try:
            (cls.root / "outside-link.txt").symlink_to(cls.outside)
            (cls.root / "hidden-link.txt").symlink_to(cls.root / ".git" / "HEAD")
            (cls.root / "repo-link").symlink_to(cls.root / ".git", target_is_directory=True)
            (cls.root / "public-link.pdf").symlink_to(cls.root / "sample.pdf")
            (cls.root / "linked-index").mkdir()
            (cls.root / "linked-index" / "index.html").symlink_to(cls.outside)
            (cls.root / "hidden-index").mkdir()
            (cls.root / "hidden-index" / "index.html").symlink_to(cls.root / ".git" / "HEAD")
            (cls.root / "logos" / "internal-link.png").symlink_to(cls.root / "logos" / "sisstem.png")
            (cls.root / "logos" / "external-link.png").symlink_to(cls.outside)
        except (OSError, NotImplementedError):
            cls.symlinks_available = False

        handler = functools.partial(serve.PresenterRequestHandler, directory=str(cls.root))
        cls.server = serve.ReusableThreadingServer(("127.0.0.1", 0), handler)
        cls.addClassCleanup(cls.server.server_close)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.addClassCleanup(cls.stop_server)

    @classmethod
    def stop_server(cls) -> None:
        """Stop and join the finite test server before removing its files."""
        cls.server.shutdown()
        cls.thread.join(timeout=5)
        if cls.thread.is_alive():
            raise RuntimeError("The test server did not stop.")

    def request(self, method: str, path: str) -> tuple[int, dict[str, str], bytes]:
        """Send one unnormalized HTTP request and return its complete response.

        Args:
            method: HTTP method, GET or HEAD.
            path: Raw request target, preserving encoded and traversal components.

        Returns:
            The response status, header mapping, and response body.
        """
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_address[1], timeout=3)
        try:
            connection.request(method, path)
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def test_public_files_and_directory_indexes(self) -> None:
        """Preserve normal static GET/HEAD responses and index-file selection."""
        for path, expected_type, expected_body in (
            ("/", "text/html", b"<h1>Presenter</h1>"),
            ("/app.mjs", "text/javascript", b"export const ready = true;"),
            ("/sample.pdf", "application/pdf", b"%PDF-1.7\npublic fixture"),
            ("/gear.svg", "image/svg+xml", b"<svg></svg>"),
            ("/nested/", "text/html", b"nested public page"),
        ):
            for method in ("GET", "HEAD"):
                with self.subTest(path=path, method=method):
                    status, headers, body = self.request(method, path)
                    self.assertEqual(status, 200)
                    self.assertTrue(headers["Content-type"].startswith(expected_type))
                    self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
                    self.assertIn("connect-src 'self' blob: data:", headers["Content-Security-Policy"])
                    self.assertEqual(body, expected_body if method == "GET" else b"")

    def test_hidden_encoded_and_traversal_paths_are_denied(self) -> None:
        """Reject hidden files and traversal before inherited path normalization."""
        for path in (
            "/.git/HEAD",
            "/%2egit/HEAD",
            "/%2Egit%2FHEAD",
            "/%2e%67%69%74/HEAD?download=1",
            "/.secret.pdf",
            "/nested/../.git/HEAD",
            "/nested/%2e%2e/%2egit/HEAD",
            "/../outside.txt",
            "/%2e%2e/outside.txt",
        ):
            for method in ("GET", "HEAD"):
                with self.subTest(path=path, method=method):
                    status, _, body = self.request(method, path)
                    self.assertEqual(status, 403)
                    self.assertNotIn(b"private repository metadata", body)
                    self.assertNotIn(b"outside secret", body)
                    if method == "HEAD":
                        self.assertEqual(body, b"")

    def test_directory_listing_is_disabled(self) -> None:
        """Deny listing a directory without an index for both read methods."""
        for method in ("GET", "HEAD"):
            with self.subTest(method=method):
                status, _, body = self.request(method, "/empty/")
                self.assertEqual(status, 403)
                if method == "HEAD":
                    self.assertEqual(body, b"")

    def test_portable_runtime_and_private_metadata_are_denied(self) -> None:
        """Keep bundled executables, launcher code and inventory outside HTTP access."""
        for path in ("/runtime/python.exe", "/runtime/", "/package-manifest.json", "/launch_windows.py"):
            for method in ("GET", "HEAD"):
                with self.subTest(path=path, method=method):
                    status, _, body = self.request(method, path)
                    self.assertEqual(status, 403)
                    self.assertNotIn(b"private runtime", body)

    def test_hidden_and_external_symlinks_are_denied(self) -> None:
        """Apply file boundaries to aliases and implicit directory index files."""
        if not self.symlinks_available:
            self.skipTest("This platform does not permit creating test symlinks.")
        for path in (
            "/outside-link.txt",
            "/hidden-link.txt",
            "/repo-link/HEAD",
            "/linked-index/",
            "/hidden-index/",
        ):
            for method in ("GET", "HEAD"):
                with self.subTest(path=path, method=method):
                    status, _, body = self.request(method, path)
                    self.assertEqual(status, 403)
                    self.assertNotIn(b"private repository metadata", body)
                    self.assertNotIn(b"outside secret", body)

    def test_visible_internal_symlink_remains_usable(self) -> None:
        """Allow an alias whose requested and resolved paths are both public."""
        if not self.symlinks_available:
            self.skipTest("This platform does not permit creating test symlinks.")
        for method in ("GET", "HEAD"):
            with self.subTest(method=method):
                status, _, body = self.request(method, "/public-link.pdf")
                self.assertEqual(status, 200)
                self.assertEqual(body, b"%PDF-1.7\npublic fixture" if method == "GET" else b"")

    def test_brand_catalog_lists_only_immediate_visible_png_files(self) -> None:
        """Expose PNG names without recursive entries, symlinks or arbitrary paths."""
        status, headers, body = self.request("GET", "/api/brands")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "application/json; charset=utf-8")
        self.assertEqual(int(headers["Content-Length"]), len(body))
        self.assertEqual(json.loads(body), {"filenames": ["faculty_of_arts_and_science.PNG", "sisstem.png"]})
        self.assertNotIn(str(self.root).encode(), body)
        self.assertEqual(self.request("GET", "/api/brands?path=../")[2], body)
        self.assertEqual(self.request("GET", "/logos/")[0], 403)

    def test_brand_catalog_head_matches_get_headers_without_a_body(self) -> None:
        """Keep HEAD useful to probes without transmitting JSON content."""
        _, get_headers, _ = self.request("GET", "/api/brands")
        status, head_headers, body = self.request("HEAD", "/api/brands")
        self.assertEqual(status, 200)
        self.assertEqual(body, b"")
        self.assertEqual(head_headers["Content-Length"], get_headers["Content-Length"])
        self.assertEqual(head_headers["Content-Type"], get_headers["Content-Type"])

    def test_missing_or_linked_logo_directory_has_an_empty_catalog(self) -> None:
        """Return an empty catalog when logos are missing or the directory is an alias."""
        logos = self.root / "logos"
        backup = self.root / "saved-logos"
        logos.rename(backup)
        try:
            self.assertEqual(json.loads(self.request("GET", "/api/brands")[2]), {"filenames": []})
            if self.symlinks_available:
                logos.symlink_to(backup, target_is_directory=True)
                self.assertEqual(json.loads(self.request("GET", "/api/brands")[2]), {"filenames": []})
                logos.unlink()
        finally:
            if logos.is_symlink():
                logos.unlink()
            backup.rename(logos)


if __name__ == "__main__":
    unittest.main()
