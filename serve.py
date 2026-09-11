#!/usr/bin/env python3
"""Serve Beamer PDF Presenter locally and open it in the default browser."""

from __future__ import annotations

import argparse
import contextlib
import http.server
import io
import json
import mimetypes
import os
import re
import socket
import socketserver
import sys
import threading
import time
import urllib.parse
import webbrowser
from pathlib import Path
from typing import BinaryIO

APP_ROOT = Path(__file__).resolve().parent
DEFAULT_PORT = 8000
MAX_PORT_ATTEMPTS = 20
PRIVATE_ROOT_NAMES = {"runtime", "tools", "tests", "output"}
PRIVATE_ROOT_FILES = {"serve.py", "launch_windows.py", "package-manifest.json", "dependencies.lock.json"}

mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("application/pdf", ".pdf")


class PresenterRequestHandler(http.server.SimpleHTTPRequestHandler):
    """Serve application files with explicit MIME and security headers."""

    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".mjs": "text/javascript; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".pdf": "application/pdf",
    }

    def _path_is_allowed(self, path: Path) -> bool:
        """Check that a served path stays inside the visible application tree.

        Args:
            path: Filesystem path produced by the request handler or an index candidate.

        Returns:
            Whether both the requested and resolved paths are inside the serving
            directory and contain no hidden path components.
        """
        root = Path(self.directory)
        try:
            requested = path.relative_to(root)
            resolved = path.resolve().relative_to(root.resolve())
        except (OSError, RuntimeError, ValueError):
            return False
        for relative in (requested, resolved):
            if relative.parts and relative.parts[0].lower() in PRIVATE_ROOT_NAMES:
                return False
            if relative.as_posix().lower() in PRIVATE_ROOT_FILES:
                return False
        return not any(part.startswith(".") for part in (*requested.parts, *resolved.parts))

    def send_head(self) -> BinaryIO | None:
        """Serve GET and HEAD requests only from visible application paths.

        Returns:
            The opened response file, or None after an error or redirect response.
        """
        url_path = self.path.split("?", 1)[0].split("#", 1)[0]
        if url_path == "/api/brands":
            return self._send_brand_catalog()
        decoded_path = urllib.parse.unquote(url_path)
        path = Path(self.translate_path(self.path))
        hidden_component = any(part.startswith(".") for part in decoded_path.split("/"))
        if hidden_component or not self._path_is_allowed(path):
            self.send_error(403, "This path is not available.")
            return None

        # SimpleHTTPRequestHandler selects an index after translating a directory.
        # Apply the same checks to that file before its inherited implementation opens it.
        if path.is_dir():
            for name in ("index.html", "index.htm"):
                index_path = path / name
                if index_path.is_file():
                    if not self._path_is_allowed(index_path):
                        self.send_error(403, "This path is not available.")
                        return None
                    break
        return super().send_head()

    def _send_brand_catalog(self) -> BinaryIO:
        """Return a narrow catalog of immediate visible PNG logo filenames.

        Returns:
            JSON response stream used for both GET and HEAD. Missing logo
            directories yield an empty catalog, never a filesystem listing.
        """
        root = Path(self.directory)
        logo_root = root / "logos"
        filenames: list[str] = []
        if not logo_root.is_symlink() and self._path_is_allowed(logo_root):
            try:
                for asset in logo_root.iterdir():
                    name = asset.name
                    if (
                        len(name) <= 180
                        and name == name.strip()
                        and not name.startswith(".")
                        and name.lower().endswith(".png")
                        and name[:-4].replace("_", " ").replace("-", " ").strip()
                        and not re.search(r'[\\/:*?"<>|\x00-\x1f\x7f]', name)
                        and not re.match(r"(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)", name, re.IGNORECASE)
                        and not asset.is_symlink()
                        and asset.is_file()
                        and self._path_is_allowed(asset)
                    ):
                        filenames.append(name)
            except OSError:
                filenames = []
        payload = json.dumps({"filenames": sorted(filenames, key=str.casefold)}, ensure_ascii=True).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        return io.BytesIO(payload)

    def list_directory(self, path: str) -> None:
        """Reject directory listings instead of exposing application file names.

        Args:
            path: Directory for which the inherited handler requested a listing.
        """
        self.send_error(403, "Directory listing is disabled.")
        return None

    def end_headers(self) -> None:
        """Add conservative headers before completing an HTTP response."""
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin-allow-popups")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Content-Security-Policy", (
            "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; "
            "worker-src 'self' blob:; connect-src 'self' blob: data:; "
            "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
            "font-src 'self' data: blob:; frame-src 'self' blob:; "
            "object-src 'self' blob:; base-uri 'none'; form-action 'none'"
        ))
        super().end_headers()

    def log_message(self, format_string: str, *args: object) -> None:
        """Write compact request logs to standard error."""
        sys.stderr.write(f"[Beamer PDF Presenter] {format_string % args}\n")


class ReusableThreadingServer(socketserver.ThreadingTCPServer):
    """Threaded local HTTP server with reusable addresses."""

    allow_reuse_address = True
    daemon_threads = True


def parse_args() -> argparse.Namespace:
    """Parse command-line options."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1", help="Bind address (default: 127.0.0.1).")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Preferred port (default: 8000).")
    parser.add_argument("--no-browser", action="store_true", help="Do not open the browser automatically.")
    parser.add_argument("--demo", action="store_true", help="Open with the bundled demo PDF.")
    return parser.parse_args()


def create_server(host: str, preferred_port: int) -> tuple[ReusableThreadingServer, int]:
    """Create a server, advancing to a free port when necessary."""
    handler = lambda *args, **kwargs: PresenterRequestHandler(  # noqa: E731
        *args,
        directory=str(APP_ROOT),
        **kwargs,
    )

    last_error: OSError | None = None
    for port in range(preferred_port, preferred_port + MAX_PORT_ATTEMPTS):
        try:
            return ReusableThreadingServer((host, port), handler), port
        except OSError as error:
            last_error = error
            if error.errno not in {48, 98, 10048}:  # macOS, Linux, Windows address-in-use codes
                raise

    raise OSError(
        f"No free port found from {preferred_port} to "
        f"{preferred_port + MAX_PORT_ATTEMPTS - 1}."
    ) from last_error


def open_browser_later(url: str) -> None:
    """Open the application after the server has begun accepting requests."""
    time.sleep(0.45)
    webbrowser.open(url, new=2)


def main() -> int:
    """Run the local application server until interrupted."""
    args = parse_args()
    os.chdir(APP_ROOT)

    try:
        server, port = create_server(args.host, args.port)
    except OSError as error:
        print(f"Could not start Beamer PDF Presenter: {error}", file=sys.stderr)
        return 1

    query = "?demo=1" if args.demo else ""
    display_host = "localhost" if args.host in {"127.0.0.1", "0.0.0.0"} else args.host
    url = f"http://{display_host}:{port}/{query}"

    print("Beamer PDF Presenter is running.")
    print(f"Open: {url}")
    print("Press Ctrl+C to stop the server.")

    if not args.no_browser:
        threading.Thread(target=open_browser_later, args=(url,), daemon=True).start()

    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        print("\nStopping Beamer PDF Presenter.")
    finally:
        with contextlib.suppress(Exception):
            server.shutdown()
        server.server_close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
