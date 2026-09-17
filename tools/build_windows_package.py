#!/usr/bin/env python3
"""Build a checked offline Windows ZIP from locked local dependency archives."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import struct
import subprocess
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

APP_ROOT = Path(__file__).resolve().parents[1]
PACKAGE_NAME = "Beamer-PDF-Presenter"
LICENSE_FILES = (
    "LICENSE.txt", "NOTICE", "THIRD_PARTY_NOTICES.md",
    "LICENSES/original-beamer-presenter-MIT.txt", "LICENSES/core-js-3.50.0-MIT.txt",
    "LICENSES/quickjs-MIT.txt", "LICENSES/pdf-js-quickjs-MIT.txt",
    "LICENSES/liberation-fonts-1.07.4.tar.gz", "LICENSES/README.md", "LICENSES/provenance.json",
)
SOURCE_FILES = (
    "index.html", "styles.css", "app.mjs", "countdown.mjs", "timer-view.mjs",
    "pdf-library.mjs", "pdf-activation.mjs", "laser-pointer.mjs", "branding.mjs",
    "narration.mjs", "narration-player.mjs", "narration-controls.mjs", "narration-audience.mjs", "preview-render.mjs", "page-render-cache.mjs",
    "sample-beamer.txt", "docs/NARRATION.md", "splitter.mjs", "sample-beamer.pdf", "serve.py", "launch_windows.py",
    "start-windows.bat", "START HERE.txt", "VERSION", *LICENSE_FILES,
    "dependencies.lock.json",
    "logos/sisstem.png", "logos/README.md", "logos/SOURCES.md",
)
WINDOWS_RESERVED_NAMES = frozenset(
    {"CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"}
    | {f"{prefix}{digit}" for prefix in ("COM", "LPT") for digit in "123456789¹²³"}
)


def sha256(path: Path) -> str:
    """Return the SHA-256 digest of a local file.

    Args:
        path: File to read.

    Returns:
        Lowercase hexadecimal digest.
    """
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def safe_relative(name: str) -> Path:
    """Accept a canonical relative archive path without traversal or hidden parts.

    Args:
        name: POSIX archive path.

    Returns:
        A relative filesystem path.

    Raises:
        ValueError: The name is absolute, hidden, ambiguous or traverses parents.
    """
    parts = name.split("/")
    if (not name or PurePosixPath(name).is_absolute()
            or any(character in name for character in '\\:*?"<>|')
            or any(ord(character) < 32 or ord(character) == 127 for character in name)
            or any(not part or part.startswith(".") or part.endswith((" ", ".")) for part in parts)
            or any(part.split(".", 1)[0].upper() in WINDOWS_RESERVED_NAMES for part in parts)):
        raise ValueError(f"Unsafe archive path: {name}")
    return Path(*parts)


def checked_source_file(name: str) -> Path:
    """Resolve a regular source file without following file or directory aliases.

    Args:
        name: Canonical source-relative POSIX filename.

    Returns:
        Existing regular source path inside the application root.

    Raises:
        ValueError: A path is unsafe, missing, linked or outside the source tree.
    """
    relative = safe_relative(name)
    source = APP_ROOT
    if source.is_symlink():
        raise ValueError("The source application root is a symlink")
    for part in relative.parts:
        source = source / part
        if source.is_symlink():
            raise ValueError(f"Source path is a symlink: {name}")
    if not source.resolve().is_relative_to(APP_ROOT.resolve()) or not source.is_file():
        raise ValueError(f"Source file is missing or outside the application: {name}")
    return source


def logo_source_names() -> list[str]:
    """Discover the server's immediate PNG logo set with Windows-safe filenames.

    Returns:
        Sorted source-relative paths for eligible logo PNGs.

    Raises:
        ValueError: The logo directory is missing or linked, an eligible file
            is linked, or names collide or cannot be extracted safely on Windows.
    """
    logo_root = APP_ROOT / "logos"
    if logo_root.is_symlink() or not logo_root.is_dir():
        raise ValueError("The source logos folder is missing or a symlink")
    names = []
    seen = set()
    for asset in logo_root.iterdir():
        name = asset.name
        if (
            len(name) > 180 or name != name.strip() or name.startswith(".")
            or not name.lower().endswith(".png")
            or not name[:-4].replace("_", " ").replace("-", " ").strip()
            or re.search(r'[\\/:*?"<>|\x00-\x1f\x7f]', name)
            or re.match(r"(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)", name, re.IGNORECASE)
        ):
            continue
        if asset.is_symlink():
            raise ValueError(f"Source logo is a symlink: {name}")
        if not asset.is_file():
            continue
        relative = f"logos/{name}"
        checked_source_file(relative)
        if name.casefold() in seen:
            raise ValueError(f"Logo filenames conflict on Windows: {name}")
        seen.add(name.casefold())
        names.append(relative)
    return sorted(names, key=str.casefold)


def copy_source(destination: Path) -> None:
    """Copy the explicit application file set without development or personal files.

    Args:
        destination: Existing empty package directory, not a symbolic link.

    Raises:
        ValueError: A required source file or logo has an unsafe or missing path,
            or the destination is not an empty regular directory.
    """
    if destination.is_symlink() or not destination.is_dir() or any(destination.iterdir()):
        raise ValueError("The package destination must be an empty directory without a symlink")
    logos = logo_source_names()
    names = list(SOURCE_FILES) + [name for name in logos if name not in SOURCE_FILES]
    if len({name.casefold() for name in names}) != len(names):
        raise ValueError("Source filenames conflict on Windows")
    sources = {name: checked_source_file(name) for name in names}
    for name, source in sources.items():
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    (destination / "logos/catalog.json").write_text(
        json.dumps({"filenames": [Path(name).name for name in logos]}, indent=2) + "\n", encoding="utf-8"
    )


def copy_pdfjs(destination: Path, lock: dict) -> int:
    """Copy only the verified complete PDF.js cache into the package.

    Args:
        destination: New package directory.
        lock: Pinned dependency metadata.

    Returns:
        Number of copied runtime and resource files.

    Raises:
        ValueError: Cache provenance, completeness or a file digest is invalid.
    """
    cache = APP_ROOT / "vendor/pdfjs"
    receipt_path = cache / "assets-manifest.json"
    if (cache.is_symlink() or cache.parent.is_symlink() or receipt_path.is_symlink()
            or not receipt_path.is_file()):
        raise ValueError("PDF.js cache and receipt must be regular local paths, not symlinks")
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    if receipt.get("version") != lock["version"] or receipt.get("origin") != {
        "url": lock["url"], "integrity": lock["integrity"]
    }:
        raise ValueError("PDF.js cache does not match dependencies.lock.json")
    if receipt.get("build") != "legacy" or receipt.get("runtime_sources") != {
        "pdf.min.mjs": "package/legacy/build/pdf.min.mjs",
        "pdf.worker.min.mjs": "package/legacy/build/pdf.worker.min.mjs",
    }:
        raise ValueError("PDF.js cache must contain the matched legacy compatibility build")
    files = receipt["files"]
    for required in ("pdf.min.mjs", "pdf.worker.min.mjs", "LICENSE", "package.json"):
        if required not in files:
            raise ValueError(f"PDF.js cache is missing {required}")
    for folder in ("cmaps/", "standard_fonts/", "wasm/", "iccs/"):
        if not any(name.startswith(folder) for name in files):
            raise ValueError(f"PDF.js cache is missing {folder}")
    for name, digest in files.items():
        relative = safe_relative(name)
        source = cache / relative
        if not source.resolve().is_relative_to(cache.resolve()) or source.is_symlink() or sha256(source) != digest:
            raise ValueError(f"PDF.js cache file is changed: {name}")
        target = destination / "vendor/pdfjs" / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    shutil.copyfile(cache / "assets-manifest.json", destination / "vendor/pdfjs/assets-manifest.json")
    return len(files)


def extract_python(archive_path: Path, destination: Path, lock: dict) -> int:
    """Verify and copy the unmodified official Windows x64 embeddable runtime.

    Args:
        archive_path: Downloaded Python ZIP.
        destination: New package directory.
        lock: Pinned Python URL, version and published SHA-256.

    Returns:
        Number of runtime files copied.

    Raises:
        ValueError: Archive checksum, structure or executable architecture is invalid.
    """
    if sha256(archive_path) != lock["sha256"]:
        raise ValueError("Python archive does not match the published SHA-256")
    target = destination / "runtime/python"
    target.mkdir(parents=True)
    with zipfile.ZipFile(archive_path) as archive:
        names = archive.namelist()
        if len(set(names)) != len(names) or archive.testzip() is not None:
            raise ValueError("Python archive is duplicated or corrupt")
        for item in archive.infolist():
            relative = safe_relative(item.filename)
            if item.is_dir() or len(relative.parts) != 1:
                raise ValueError("Unexpected Python archive layout")
            (target / relative).write_bytes(archive.read(item))
    executable = (target / "python.exe").read_bytes()
    offset = struct.unpack_from("<I", executable, 0x3C)[0]
    if executable[:2] != b"MZ" or executable[offset:offset + 4] != b"PE\0\0" or struct.unpack_from("<H", executable, offset + 4)[0] != 0x8664:
        raise ValueError("The bundled Python executable is not Windows x64")
    return len(names)


def build_package(python_archive: Path, output: Path) -> dict:
    """Assemble and verify a new ZIP without changing an existing delivery.

    Args:
        python_archive: Official locally cached Python embeddable ZIP.
        output: New output ZIP path, which must not already exist.

    Returns:
        Package path, checksum, size and member counts.

    Raises:
        FileExistsError: The delivery path already exists.
        ValueError: Input integrity or ZIP readback fails.
    """
    if output.exists():
        raise FileExistsError(f"Output already exists: {output}")
    lock = json.loads((APP_ROOT / "dependencies.lock.json").read_text())
    output.parent.mkdir(parents=True, exist_ok=True)
    temp_root = APP_ROOT / ".tmp"
    temp_root.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="windows-build-", dir=temp_root) as temporary:
        package = Path(temporary) / PACKAGE_NAME
        package.mkdir()
        copy_source(package)
        pdf_count = copy_pdfjs(package, lock["pdfjs"])
        python_count = extract_python(python_archive, package, lock["python"])
        revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=APP_ROOT, text=True).strip()
        dirty = bool(subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=normal"], cwd=APP_ROOT, text=True).strip())
        provenance = {"application_version": (APP_ROOT / "VERSION").read_text().strip(),
                      "bundle": "Beamer PDF Presenter offline Windows x64", "source_commit": revision,
                      "source_worktree_modified": dirty, "dependencies": lock}
        (package / "BUILD-INFO.json").write_text(json.dumps(provenance, indent=2) + "\n")
        files = {p.relative_to(package).as_posix(): sha256(p) for p in sorted(package.rglob("*")) if p.is_file()}
        (package / "package-manifest.json").write_text(json.dumps({"schema_version": 1, "files": files}, indent=2) + "\n")
        expected = {**files, "package-manifest.json": sha256(package / "package-manifest.json")}
        intermediate = Path(temporary) / "package.zip"
        with zipfile.ZipFile(intermediate, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for name in sorted(expected):
                info = zipfile.ZipInfo(f"{PACKAGE_NAME}/{name}", (2026, 9, 7, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                archive.writestr(info, (package / name).read_bytes())
        with zipfile.ZipFile(intermediate) as archive:
            if archive.testzip() is not None or len(archive.namelist()) != len(expected):
                raise ValueError("ZIP completeness check failed")
            for name, digest in expected.items():
                if hashlib.sha256(archive.read(f"{PACKAGE_NAME}/{name}")).hexdigest() != digest:
                    raise ValueError(f"ZIP readback mismatch: {name}")
        shutil.copyfile(intermediate, output)
    result = {"path": str(output.resolve()), "sha256": sha256(output), "bytes": output.stat().st_size,
              "manifest_files": len(files), "python_files": python_count, "pdfjs_files": pdf_count}
    output.with_suffix(".sha256").write_text(f"{result['sha256']}  {output.name}\n")
    return result


def main() -> int:
    """Parse local archive/output paths and print the completed package evidence.

    Returns:
        Zero after a fully checked package is written.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--python-archive", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(build_package(args.python_archive, args.output), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
