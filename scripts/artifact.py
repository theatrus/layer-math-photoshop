"""Record/verify trusted CI payload inventories. Not a replacement for code signing."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tomllib

ROOT=Path(__file__).resolve().parent.parent
def inventory(platform):
    directory=ROOT / "build/addons" / platform
    paths=["x64/layer_math.uxpaddon"] if platform=="win" else ["arm64/layer_math.uxpaddon","x64/layer_math.uxpaddon"]
    actual={str(p.relative_to(directory)).replace("\\","/") for p in directory.rglob("*") if p.is_file() and p != directory/"inventory.json"}
    if actual != set(paths) or any(p.is_symlink() for p in directory.rglob("*")):
        raise ValueError("Unexpected payload inventory")
    sha=subprocess.check_output(["git","rev-parse","HEAD"],cwd=ROOT,text=True).strip()
    return {"source":sha,"version":tomllib.loads((ROOT/"Cargo.toml").read_text())["package"]["version"],"platform":platform,
        "files":{p:hashlib.sha256((directory/p).read_bytes()).hexdigest() for p in paths}}
def verify(platform, signed=False):
    saved=json.loads((ROOT/"build/addons"/platform/"inventory.json").read_text())
    if signed and saved.get("signed") is not True:
        raise ValueError("Missing signing-stage verification")
    saved.pop("signed",None)
    if saved != inventory(platform):
        raise ValueError("Payload hash, version or source mismatch")
if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command",choices=("record","verify"));parser.add_argument("platform",choices=("win","mac"));parser.add_argument("--signed",action="store_true")
    args=parser.parse_args()
    if args.command=="verify":verify(args.platform,args.signed)
    else:(ROOT/"build/addons"/args.platform/"inventory.json").write_text(json.dumps({**inventory(args.platform),"signed":args.signed},indent=2)+"\n")
