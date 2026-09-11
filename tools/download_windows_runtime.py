#!/usr/bin/env python3
"""Download the integrity-pinned Windows runtime for maintainer builds."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import tempfile
import urllib.request
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]


def download_runtime(output: Path, lock_path: Path = APP_ROOT / "dependencies.lock.json") -> Path:
    """Download or reuse the exact locked archive without overwriting other files.

    Args:
        output: Destination archive; an existing file must already match the lock.
        lock_path: JSON file identifying the official HTTPS URL and SHA-256.

    Returns:
        The verified archive path.

    Raises:
        ValueError: The lock or existing/downloaded archive is invalid.
        OSError: The download or filesystem operation fails.
    """
    lock = json.loads(lock_path.read_text(encoding="utf-8"))["python"]
    expected = lock["sha256"]
    if (not lock["url"].startswith("https://www.python.org/")
            or len(expected) != 64 or any(c not in "0123456789abcdef" for c in expected)):
        raise ValueError("A locked official Python URL and SHA-256 are required")
    if output.is_symlink():
        raise ValueError("The runtime archive must not be a symbolic link")
    if output.exists():
        with output.open("rb") as source:
            actual = hashlib.file_digest(source, "sha256").hexdigest()
        if actual != expected:
            raise ValueError("Existing runtime archive differs from the lock; choose a new output path")
        return output
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="python-download-", dir=output.parent) as temporary:
        archive = Path(temporary) / "python.zip"
        with urllib.request.urlopen(lock["url"], timeout=60) as response, archive.open("wb") as target:
            if not response.geturl().startswith("https://www.python.org/"):
                raise ValueError("The runtime download redirected outside the official Python origin")
            shutil.copyfileobj(response, target)
        with archive.open("rb") as source:
            actual = hashlib.file_digest(source, "sha256").hexdigest()
        if actual != expected:
            raise ValueError("Downloaded runtime SHA-256 differs from dependencies.lock.json")
        # The verified temporary file shares the output filesystem. Publishing
        # one hard link is atomic and fails if another writer created the path.
        os.link(archive, output)
    return output


def main() -> int:
    """Parse the archive destination and report a verified build input.

    Returns:
        Zero after verification; errors terminate without an unverified archive.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(f"Verified Windows runtime: {download_runtime(args.output)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
