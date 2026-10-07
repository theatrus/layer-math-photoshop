"""Use Adobe's CLI to package staged files, then verify the packaged addon bytes."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile
from stage import ROOT, stage
from artifact import verify as verify_artifact

def package(cli, development=False):
    if not development:
        verify_artifact("win", signed=True)
        verify_artifact("mac", signed=True)
    if not cli.is_file():
        raise ValueError("Pass Adobe CLI 1.2.0 src/uxp.js via --cli")
    cli_package = json.loads((cli.parent.parent / "package.json").read_text())
    if cli_package.get("name") != "@adobe/uxp-devtools-cli" or cli_package.get("version") != "1.2.0":
        raise ValueError("Packaging requires @adobe/uxp-devtools-cli 1.2.0")
    destination = stage("win" if development and __import__("os").name == "nt" else "mac" if development else "all")
    # Development tests are not shipped in distributable packages.
    (destination / "smoke.js").unlink()
    (destination / "live-smoke.js").unlink()
    record = json.loads((ROOT / "build/staged-plugin.json").read_text())
    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    name = f"LayerMath-Photoshop-{record['version']}{'-development' if development else ''}.ccx"
    target = dist / name
    if target.exists():
        raise ValueError("Output exists; move it aside before repackaging")
    with tempfile.TemporaryDirectory(prefix="package-", dir=ROOT / "build") as work:
        subprocess.run([shutil.which("node") or "node", str(cli.resolve()), "plugin", "package", "--manifest", str(destination / "manifest.json"), "--outputPath", work], check=True)
        packages = list(Path(work).glob("*.ccx"))
        if len(packages) != 1:
            raise ValueError("Adobe did not create exactly one CCX (the CLI can return zero on failure)")
        with zipfile.ZipFile(packages[0]) as archive:
            for path, expected in record["addons"].items():
                if hashlib.sha256(archive.read(path)).hexdigest() != expected:
                    raise ValueError(f"Packaged addon changed: {path}")
            manifest = json.loads(archive.read("manifest.json"))
            if manifest["version"] != record["version"] or manifest["id"] != "us.theatr.layer-math":
                raise ValueError("Packaged identity mismatch")
        shutil.copy2(packages[0], target)
    checksum = hashlib.sha256(target.read_bytes()).hexdigest()
    target.with_suffix(".ccx.sha256").write_text(f"{checksum}  {name}\n")
    print(f"Verified CCX: {target}")
    return target

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cli", type=Path, required=True)
    parser.add_argument("--development", action="store_true", help="Current platform only; unsigned, not a release")
    args = parser.parse_args()
    package(args.cli, args.development)
