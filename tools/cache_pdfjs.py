#!/usr/bin/env python3
"""Prepare the integrity-pinned PDF.js distribution for offline use."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import shutil
import sys
import tarfile
import tempfile
import urllib.error
import urllib.request
from pathlib import Path, PurePosixPath

APP_ROOT = Path(__file__).resolve().parents[1]
DESTINATION = APP_ROOT / "vendor" / "pdfjs"
LOCK_PATH = APP_ROOT / "dependencies.lock.json"
BUILD_FLAVOR = "legacy"
RUNTIME_SOURCES = {
    "pdf.min.mjs": "package/legacy/build/pdf.min.mjs",
    "pdf.worker.min.mjs": "package/legacy/build/pdf.worker.min.mjs",
}
DIRECT_FILES = {
    **{source: target for target, source in RUNTIME_SOURCES.items()},
    "package/LICENSE": "LICENSE",
    "package/package.json": "package.json",
}
RESOURCE_SUFFIXES = {
    "cmaps": {".bcmap"},
    "standard_fonts": {".pfb", ".ttf"},
    "wasm": {".wasm"},
    "iccs": {".icc"},
}
MANIFEST_NAME = "assets-manifest.json"


def safe_relative_path(name: str) -> PurePosixPath:
    """Validate a relative path without platform-dependent normalization.

    Args:
        name: Forward-slash-delimited archive or receipt path.

    Returns:
        The validated relative POSIX path.

    Raises:
        ValueError: If the name can escape its root or is ambiguous on Windows.
    """
    path = PurePosixPath(name)
    parts = name.rstrip("/").split("/")
    if (
        not name
        or path.is_absolute()
        or "\\" in name
        or ":" in name
        or any(part in {"", ".", ".."} or part.endswith((".", " ")) for part in parts)
    ):
        raise ValueError(f"Unsafe asset path: {name!r}")
    return path


def digest_file(path: Path, algorithm: str = "sha256") -> str:
    """Hash a file without loading the entire archive into memory.

    Args:
        path: File to read.
        algorithm: A hashlib-supported digest algorithm.

    Returns:
        Lowercase hexadecimal digest of the complete file.
    """
    digest = hashlib.new(algorithm)
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_lock(path: Path) -> dict[str, str]:
    """Read and validate the PDF.js dependency lock.

    Args:
        path: JSON lock containing a pdfjs object.

    Returns:
        The locked version, HTTPS origin, and SHA-512 integrity.

    Raises:
        ValueError: If required fields or integrity metadata are invalid.
    """
    lock = json.loads(path.read_text(encoding="utf-8"))["pdfjs"]
    if not isinstance(lock, dict) or any(not isinstance(lock.get(key), str) for key in ("version", "url", "integrity")):
        raise ValueError("PDF.js lock must contain version, url, and integrity strings.")
    if not lock["url"].startswith("https://") or not lock["integrity"].startswith("sha512-"):
        raise ValueError("PDF.js requires a locked HTTPS URL and SHA-512 integrity.")
    expected = base64.b64decode(lock["integrity"][7:], validate=True)
    if len(expected) != 64:
        raise ValueError("The PDF.js lock contains an invalid SHA-512 digest.")
    return lock


def validate_existing_cache(destination: Path) -> None:
    """Refuse replacement of unknown, linked, or modified receipt-owned files.

    Args:
        destination: Existing cache directory, which may be absent.

    Raises:
        ValueError: If a cache contains unrecognized or modified content.
    """
    if destination.is_symlink():
        raise ValueError("The PDF.js destination must not be a symbolic link.")
    if not destination.exists():
        return
    if not destination.is_dir():
        raise ValueError("The PDF.js destination must be a directory.")
    allowed = {"README.md", "pdf.min.mjs", "pdf.worker.min.mjs", "LICENSE"}
    receipt = destination / MANIFEST_NAME
    if receipt.is_symlink():
        raise ValueError("The PDF.js manifest must not be a symbolic link.")
    if receipt.exists():
        manifest = json.loads(receipt.read_text(encoding="utf-8"))
        files = manifest.get("files")
        if manifest.get("schema_version") != 1 or not isinstance(files, dict):
            raise ValueError("The existing PDF.js manifest has an unsupported format.")
        allowed.add(MANIFEST_NAME)
        for name, digest in files.items():
            safe_relative_path(name)
            owned = destination / name
            if owned.is_symlink() or not owned.is_file() or digest_file(owned) != digest:
                raise ValueError(f"Existing receipt-owned asset is missing or modified: {name}")
            allowed.add(name)
    directories = {str(parent) for name in allowed for parent in PurePosixPath(name).parents if str(parent) != "."}
    for existing in destination.rglob("*"):
        name = existing.relative_to(destination).as_posix()
        if existing.is_symlink() or (name not in directories if existing.is_dir() else name not in allowed):
            raise ValueError(f"Unrecognized existing PDF.js content: {name}")


def stage_archive(archive: Path, stage: Path, lock: dict[str, str]) -> dict:
    """Verify the complete archive, then copy selected regular runtime files.

    Args:
        archive: Local npm tarball matching the lock integrity.
        stage: Empty directory for the validated runtime assets.
        lock: Validated PDF.js dependency lock.

    Returns:
        Manifest containing provenance and each asset's SHA-256 digest.

    Raises:
        ValueError: If integrity, archive paths, or required assets are invalid.
    """
    expected = base64.b64decode(lock["integrity"][7:], validate=True).hex()
    if digest_file(archive, "sha512") != expected:
        raise ValueError("PDF.js archive SHA-512 integrity does not match dependencies.lock.json.")
    files = {}
    seen = set()
    with tarfile.open(archive, "r:gz") as package:
        for member in package:
            path = safe_relative_path(member.name)
            if not member.isdir() and not member.isfile():
                raise ValueError(f"Non-regular archive entry is not allowed: {member.name}")
            if member.isdir():
                continue
            relative = DIRECT_FILES.get(member.name)
            if relative is None and len(path.parts) >= 3 and path.parts[0] == "package" and path.parts[1] in RESOURCE_SUFFIXES:
                relative = PurePosixPath(*path.parts[1:]).as_posix()
            if relative is None:
                continue
            if relative.casefold() in seen:
                raise ValueError(f"Duplicate PDF.js asset: {relative}")
            seen.add(relative.casefold())
            target = stage / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            source = package.extractfile(member)
            if source is None or member.size == 0:
                raise ValueError(f"Empty PDF.js asset: {relative}")
            with source, target.open("xb") as output:
                shutil.copyfileobj(source, output)
            files[relative] = digest_file(target)
    missing = set(DIRECT_FILES.values()) - files.keys()
    if missing:
        raise ValueError(f"Missing required PDF.js assets: {', '.join(sorted(missing))}")
    metadata = json.loads((stage / "package.json").read_text(encoding="utf-8"))
    if metadata.get("name") != "pdfjs-dist" or metadata.get("version") != lock["version"]:
        raise ValueError("PDF.js package name or version does not match the lock.")
    for directory, suffixes in RESOURCE_SUFFIXES.items():
        resources = [name for name in files if name.startswith(directory + "/")]
        if not any(PurePosixPath(name).suffix in suffixes for name in resources):
            raise ValueError(f"Missing runtime resources in PDF.js {directory}/.")
        if not any(PurePosixPath(name).name.startswith("LICENSE") for name in resources):
            raise ValueError(f"Missing licensing information in PDF.js {directory}/.")
    manifest = {
        "schema_version": 1,
        "version": lock["version"],
        "build": BUILD_FLAVOR,
        "runtime_sources": RUNTIME_SOURCES,
        "origin": {"url": lock["url"], "integrity": lock["integrity"]},
        "files": dict(sorted(files.items())),
    }
    (stage / MANIFEST_NAME).write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def prepare_cache(archive: Path, lock_path: Path = LOCK_PATH, destination: Path = DESTINATION, backup_root: Path | None = None) -> dict:
    """Install a complete cache with a retained backup and rollback on failure.

    Args:
        archive: Previously downloaded tarball; no network access is performed.
        lock_path: Dependency lock to verify before extracting any file.
        destination: Cache directory to replace after full validation.
        backup_root: Storage for staging and retained backups; defaults to .tmp.

    Returns:
        The installed manifest, after a successful directory swap.

    Raises:
        ValueError: If validation fails; the original cache remains intact.
        OSError: If filesystem work fails. A failed second rename rolls back.
    """
    lock = read_lock(lock_path)
    validate_existing_cache(destination)
    work_root = backup_root if backup_root is not None else APP_ROOT / ".tmp" / "pdfjs-backups"
    work_root.mkdir(parents=True, exist_ok=True)
    workspace = Path(tempfile.mkdtemp(prefix="cache-", dir=work_root))
    stage = workspace / "staged"
    stage.mkdir()
    previous = workspace / "previous"
    try:
        manifest = stage_archive(archive, stage, lock)
        readme = destination / "README.md"
        if readme.is_file():
            shutil.copy2(readme, stage / "README.md")
        validate_existing_cache(destination)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            destination.rename(previous)
        try:
            stage.rename(destination)
        except OSError:
            if previous.exists():
                previous.rename(destination)
            raise
        return manifest
    finally:
        if stage.exists():
            shutil.rmtree(stage)
        if not previous.exists():
            workspace.rmdir()


def main() -> int:
    """Prepare pinned assets from a local archive or a build-time download.

    Returns:
        Zero on success; one after a reported preparation failure.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, help="Reuse a local locked npm tarball without network access.")
    args = parser.parse_args()
    try:
        archive = args.archive
        if archive is None:
            lock = read_lock(LOCK_PATH)
            download_dir = APP_ROOT / ".tmp" / "downloads"
            download_dir.mkdir(parents=True, exist_ok=True)
            request = urllib.request.Request(lock["url"], headers={"User-Agent": "Beamer-Presenter-offline-cache/2.0"})
            with tempfile.NamedTemporaryFile(dir=download_dir, delete=False, suffix=".tgz") as temporary:
                archive = Path(temporary.name)
                with urllib.request.urlopen(request, timeout=60) as response:
                    shutil.copyfileobj(response, temporary)
        manifest = prepare_cache(archive)
        print(f"Offline PDF.js {manifest['version']} ({manifest['build']}) ready: {len(manifest['files'])} verified assets in {DESTINATION}")
        return 0
    except (ValueError, KeyError, TypeError, OSError, tarfile.TarError, urllib.error.URLError) as error:
        print(f"PDF.js cache preparation failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
