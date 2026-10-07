"""Decrypt and verify the pinned hybrid SDK; never log or publish its contents."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parent.parent
SDK = ROOT / ".sdk" / "ci"
CONFIG = json.loads((ROOT / "scripts/sdk.json").read_text())

def safe_members(archive):
    members = archive.infolist()
    if sum(i.file_size for i in members) > 256 * 1024 * 1024:
        raise ValueError("SDK archive exceeds extraction budget")
    for info in members:
        raw = info.orig_filename
        path = PurePosixPath(raw)
        if path.is_absolute() or ".." in path.parts or "\\" in raw or ":" in raw or "\x00" in raw or stat.S_ISLNK(info.external_attr >> 16):
            raise ValueError("Unsafe SDK archive path")
    return members

def clean():
    # Fixed CI-owned subtree only. Refuse redirected directories.
    if SDK.is_symlink() or SDK.resolve() != ROOT / ".sdk" / "ci":
        raise ValueError("Refusing redirected SDK cleanup")
    extracted = SDK / "extracted"
    if extracted.is_symlink() or extracted.resolve() != SDK / "extracted":
        raise ValueError("Refusing redirected extraction directory")
    if extracted.exists():
        shutil.rmtree(extracted)
    (SDK / CONFIG["archive"]).unlink(missing_ok=True)

def decrypt():
    password = os.environ.get("UXP_HYBRID_SDK_PASSPHRASE")
    if not password:
        raise ValueError("Set UXP_HYBRID_SDK_PASSPHRASE to decrypt the SDK")
    gpg = shutil.which("gpg")
    if not gpg and os.name == "nt":
        gpg = str(Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "Git/usr/bin/gpg.exe")
    SDK.mkdir(parents=True, exist_ok=True)
    clean()
    archive = SDK / CONFIG["archive"]
    try:
        subprocess.run([gpg or "gpg", "--batch", "--yes", "--pinentry-mode", "loopback", "--passphrase-fd", "0", "--output", str(archive), "--decrypt", str(archive)+".gpg"], input=(password+"\n").encode(), check=True)
        if hashlib.sha256(archive.read_bytes()).hexdigest() != CONFIG["sha256"]:
            raise ValueError("SDK SHA-256 mismatch")
        with zipfile.ZipFile(archive) as sdk:
            sdk.extractall(SDK / "extracted", members=safe_members(sdk))
        root = SDK / "extracted" / CONFIG["root"]
        if not all((root / name).is_file() for name in CONFIG["required"]):
            raise ValueError("Required hybrid SDK headers are missing")
        print("SDK verified and extracted")
    except BaseException:
        clean()
        raise
    finally:
        archive.unlink(missing_ok=True)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--clean", action="store_true")
    if parser.parse_args().clean:
        clean()
    else:
        decrypt()
