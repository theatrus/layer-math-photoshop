"""Validate CCX identity/architecture inventory without trusting archive paths."""
import argparse
import json
from pathlib import Path
import tomllib
import zipfile

ROOT = Path(__file__).resolve().parent.parent
TARGETS = ["win/x64", "mac/arm64", "mac/x64"]

def verify(path, extract_mac=None):
    version = tomllib.loads((ROOT / "Cargo.toml").read_text())["package"]["version"]
    with zipfile.ZipFile(path) as archive:
        if len(archive.namelist()) != len(set(archive.namelist())):
            raise ValueError("Duplicate CCX entries")
        manifest = json.loads(archive.read("manifest.json"))
        if manifest.get("id") != "us.theatr.layer-math" or manifest.get("version") != version:
            raise ValueError("CCX identity/version mismatch")
        for target in TARGETS:
            name = target+"/layer_math.uxpaddon"
            info = archive.getinfo(name)
            if not 0 < info.file_size <= 128*1024*1024:
                raise ValueError("Invalid addon size")
            data = archive.read(name)
            if target.startswith("win") and data[:2] != b"MZ":
                raise ValueError("Expected Windows PE addon")
            if target.startswith("mac") and data[:4] not in [b"\xcf\xfa\xed\xfe", b"\xfe\xed\xfa\xcf", b"\xca\xfe\xba\xbe", b"\xbe\xba\xfe\xca"]:
                raise ValueError("Expected Mach-O addon")
            if extract_mac and target.startswith("mac"):
                output = extract_mac / target.split("/")[1] / "layer_math.uxpaddon"
                output.parent.mkdir(parents=True, exist_ok=True)
                output.write_bytes(data)
    print("CCX identity and all three addon entries verified (signatures checked separately)")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ccx",type=Path)
    parser.add_argument("--extract-mac",type=Path)
    args=parser.parse_args()
    verify(args.ccx,args.extract_mac)
