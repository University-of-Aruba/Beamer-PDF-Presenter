#!/usr/bin/env python3
"""Verify the portable package and start its loopback-only presentation server."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import runpy
import sys
from pathlib import Path, PurePosixPath

APP_ROOT = Path(__file__).resolve().parent
MANIFEST_NAME = "package-manifest.json"
REQUIRED_FILES = frozenset(
    {
        "index.html",
        "app.mjs",
        "pdf-activation.mjs",
        "vendor/pdfjs/assets-manifest.json",
        "serve.py",
        "launch_windows.py",
        "start-windows.bat",
        "runtime/python/python.exe",
        "vendor/pdfjs/pdf.min.mjs",
        "vendor/pdfjs/pdf.worker.min.mjs",
        "vendor/pdfjs/LICENSE",
    }
)
REQUIRED_RESOURCE_FOLDERS = (
    "vendor/pdfjs/cmaps/",
    "vendor/pdfjs/standard_fonts/",
    "vendor/pdfjs/wasm/",
)
WINDOWS_RESERVED_NAMES = frozenset(
    {"CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"}
    | {f"{prefix}{digit}" for prefix in ("COM", "LPT") for digit in "123456789¹²³"}
)


class PackageError(ValueError):
    """Report a missing, unsafe, or corrupted portable package component."""


def unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    """Decode a JSON object while rejecting duplicate keys.

    Args:
        pairs: Ordered name/value pairs supplied by the JSON decoder.

    Returns:
        The decoded mapping.

    Raises:
        PackageError: A key occurs more than once.
    """
    result = {}
    for key, value in pairs:
        if key in result:
            raise PackageError("The package manifest contains duplicate entries.")
        result[key] = value
    return result


def checked_path(root: Path, relative: str) -> Path:
    """Resolve a portable file name without traversal or Windows path aliases.

    Args:
        root: Resolved package directory.
        relative: Relative POSIX path recorded in the package manifest.

    Returns:
        An existing regular file inside the package directory.

    Raises:
        PackageError: The path is unsafe, missing, or contains a symbolic link.
        OSError: Filesystem metadata cannot be read.
    """
    if not isinstance(relative, str) or not relative:
        raise PackageError("The package manifest contains an invalid file name.")
    parts = relative.split("/")
    if (
        PurePosixPath(relative).is_absolute()
        or any(part in {"", ".", ".."} for part in parts)
        or any(character in relative for character in '\\:*?"<>|')
        or any(ord(character) < 32 for character in relative)
        or any(part.endswith((" ", ".")) for part in parts)
        or any(part.split(".", 1)[0].upper() in WINDOWS_RESERVED_NAMES for part in parts)
    ):
        raise PackageError("The package manifest contains an unsafe file name.")
    candidate = root
    for part in parts:
        candidate = candidate / part
        if candidate.is_symlink():
            raise PackageError("The application folder contains a symbolic link.")
    if not candidate.resolve().is_relative_to(root):
        raise PackageError("A package file is outside the application folder.")
    if not candidate.is_file():
        raise PackageError(f"A required file is missing: {relative}")
    return candidate


def verify_package(root: Path) -> int:
    """Check every listed file against the package's SHA-256 inventory.

    Args:
        root: Extracted portable package directory.

    Returns:
        Number of files whose checksums matched the manifest.

    Raises:
        PackageError: The manifest, required inventory, or a checksum is invalid.
        OSError: A package file cannot be read.

    Note:
        Checksums detect extraction errors and accidental changes. The manifest
        is not a digital signature and does not authenticate its own contents.
    """
    root = root.resolve()
    manifest_path = root / MANIFEST_NAME
    if manifest_path.is_symlink() or not manifest_path.is_file():
        raise PackageError("The package manifest is missing or invalid.")
    try:
        manifest = json.loads(
            manifest_path.read_text(encoding="utf-8"), object_pairs_hook=unique_object
        )
    except (json.JSONDecodeError, UnicodeError) as error:
        raise PackageError("The package manifest cannot be read.") from error
    if (
        not isinstance(manifest, dict)
        or type(manifest.get("schema_version")) is not int
        or manifest["schema_version"] != 1
        or not isinstance(manifest.get("files"), dict)
    ):
        raise PackageError("The package manifest has an unsupported format.")
    files = manifest["files"]
    if not REQUIRED_FILES.issubset(files) or MANIFEST_NAME in files:
        raise PackageError("The package manifest is missing required application files.")
    if any(not any(name.startswith(folder) for name in files) for folder in REQUIRED_RESOURCE_FOLDERS):
        raise PackageError("The package manifest is missing offline PDF resources.")
    runtime_stems = {
        name.removesuffix("._pth")
        for name in files
        if re.fullmatch(r"runtime/python/python\d+\._pth", name)
    }
    if not any(f"{stem}.zip" in files and f"{stem}.dll" in files for stem in runtime_stems):
        raise PackageError("The package manifest is missing the bundled Python runtime.")
    seen_paths = set()
    for relative, expected in files.items():
        path = checked_path(root, relative)
        folded = relative.casefold()
        if folded in seen_paths:
            raise PackageError("The package manifest contains conflicting Windows file names.")
        seen_paths.add(folded)
        if not isinstance(expected, str) or not re.fullmatch(r"[0-9a-f]{64}", expected):
            raise PackageError("The package manifest contains an invalid checksum.")
        digest = hashlib.sha256()
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
        if digest.hexdigest() != expected:
            raise PackageError(f"A package file is incomplete or changed: {relative}")
    return len(files)


def main(arguments: list[str] | None = None) -> int:
    """Verify the extracted package and optionally launch the local server.

    Args:
        arguments: Command-line arguments, or None to read sys.argv.

    Returns:
        Zero after verification succeeds; one if a package file is invalid.

    Note:
        Server execution may raise SystemExit with the server's own exit code.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Verify files and exit without starting.")
    parser.add_argument("--no-browser", action="store_true", help="Start without opening a browser.")
    args = parser.parse_args(arguments)
    print("Checking Beamer PDF Presenter files...", flush=True)
    try:
        count = verify_package(APP_ROOT)
    except (PackageError, OSError) as error:
        print(f"Beamer PDF Presenter could not start: {error}", file=sys.stderr)
        print(
            "Right-click the downloaded ZIP, choose Extract all again, and run "
            "start-windows.bat from the extracted folder.",
            file=sys.stderr,
        )
        return 1
    if args.check:
        print(f"Package verified: {count} files. No server was started.")
        return 0
    print("Keep this window open while presenting.")
    if not args.no_browser:
        print("The application will open in the default browser.")
    print("Choose a PDF in the application, then open the audience window.")
    print("When finished, press Ctrl+C here to stop the application.")
    server = APP_ROOT / "serve.py"
    sys.argv = [str(server), "--host", "127.0.0.1"]
    if args.no_browser:
        sys.argv.append("--no-browser")
    sys.dont_write_bytecode = True
    runpy.run_path(str(server), run_name="__main__")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
