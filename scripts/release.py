"""Bind the final CCX to a source commit; make ZIP transports and final hashes."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tomllib
import zipfile

ROOT = Path(__file__).resolve().parent.parent
INPUT_NAME = "LayerMath-release-input.json"
DOCS = ("LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.txt")
spec = importlib.util.spec_from_file_location("verify_ccx", ROOT / "scripts/verify-ccx.py")
ccx_verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ccx_verifier)


def version():
    return tomllib.loads((ROOT / "Cargo.toml").read_text())["package"]["version"]


def source():
    return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def identity(ccx):
    return {"formatVersion": 1, "version": version(), "source": source(),
            "ccx": f"LayerMath-Photoshop-{version()}.ccx", "sha256": digest(ccx)}


def check(ccx, record):
    expected = identity(ccx)
    saved = json.loads(record.read_text(encoding="utf-8"))
    if ccx.name != expected["ccx"] or saved != expected:
        raise ValueError("CCX source, version, filename or hash differs from release input")
    ccx_verifier.verify(ccx)
    # Panel bytes must come from the same checkout as the native artifact inventories.
    with zipfile.ZipFile(ccx) as archive:
        # Adobe's packager reformats manifest JSON. Compare all values, not whitespace.
        if json.loads(archive.read("manifest.json")) != json.loads((ROOT / "uxp/manifest.json").read_bytes()):
            raise ValueError("CCX source manifest mismatch")
        for name in ("index.html", "host.js", "panel.js", "pixels.js",
                     "recipes.js", "live.js", "live-data.js", "icons/icon.png"):
            if archive.read(name) != (ROOT / "uxp" / name).read_bytes():
                raise ValueError(f"CCX source file mismatch: {name}")
        if archive.read("presets.json") != (ROOT / "examples/recipes.json").read_bytes():
            raise ValueError("CCX preset mismatch")
        for name in DOCS:
            if archive.read(name) != (ROOT / name).read_bytes():
                raise ValueError(f"CCX legal file mismatch: {name}")


def record(ccx):
    # Called only after package-uxp has verified signed native inventories.
    subprocess.run(["git", "diff", "--exit-code", "HEAD", "--"], cwd=ROOT,
                   stdout=subprocess.DEVNULL, check=True)
    output = ccx.parent / INPUT_NAME
    if output.exists():
        raise ValueError("Release input record exists; move it aside first")
    output.write_text(json.dumps(identity(ccx), indent=2) + "\n", encoding="utf-8")
    check(ccx, output)
    print(f"Recorded release input: {output}")


def archives(ccx, record_path, platform, output):
    check(ccx, record_path)
    output.mkdir(parents=True, exist_ok=True)
    label = "Windows-x64" if platform == "win" else "macOS-universal"
    target = output / f"LayerMath-Photoshop-{label}-{version()}.zip"
    if target.exists():
        raise ValueError("ZIP output exists; move it aside first")
    with zipfile.ZipFile(target, "x", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.write(ccx, "Install Layer Math.ccx")
        archive.write(ROOT / "scripts" / ("windows-install.txt" if platform == "win" else "macos-install.txt"), "Read me first.txt")
        for name in DOCS:
            archive.write(ROOT / name, "Documentation/" + name)
    with zipfile.ZipFile(target) as archive:
        if hashlib.sha256(archive.read("Install Layer Math.ccx")).hexdigest() != digest(ccx):
            raise ValueError("ZIP changed CCX bytes")
    checksum(target)
    print(f"Verified transport: {target}")


def checksum(path):
    path.with_name(path.name + ".sha256").write_text(f"{digest(path)}  {path.name}\n", encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("record"); p.add_argument("ccx", type=Path)
    for command in ("verify", "archives"):
        p = sub.add_parser(command); p.add_argument("ccx", type=Path); p.add_argument("record", type=Path)
        if command == "archives":
            p.add_argument("platform", choices=("win", "mac")); p.add_argument("--output", type=Path, default=ROOT / "dist")
    p = sub.add_parser("hash"); p.add_argument("files", type=Path, nargs="+")
    args = parser.parse_args()
    if args.command == "record": record(args.ccx)
    elif args.command == "verify": check(args.ccx, args.record)
    elif args.command == "archives": archives(args.ccx, args.record, args.platform, args.output)
    else:
        for path in args.files: checksum(path)
