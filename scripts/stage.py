"""Stage an allowlisted development plugin. This does not manufacture a CCX."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import tomllib

ROOT = Path(__file__).resolve().parent.parent

def stage(platform):
    manifest = json.loads((ROOT / "uxp/manifest.json").read_text())
    version = tomllib.loads((ROOT / "Cargo.toml").read_text())["package"]["version"]
    if manifest["version"] != version:
        raise ValueError("Cargo and UXP versions differ")
    # New directory per stage avoids stale or mixed-platform binaries.
    import tempfile
    (ROOT / "build").mkdir(exist_ok=True)
    destination = Path(tempfile.mkdtemp(prefix="plugin-", dir=ROOT / "build"))
    for name in ("manifest.json", "index.html", "panel.js", "host.js", "pixels.js", "recipes.js", "live-data.js", "live.js", "smoke.js", "live-smoke.js"):
        shutil.copy2(ROOT / "uxp" / name, destination / name)
    shutil.copy2(ROOT / "examples/recipes.json", destination / "presets.json")
    shutil.copytree(ROOT / "uxp/icons", destination / "icons")
    for name in ("LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.txt"):
        shutil.copy2(ROOT / name, destination / name)
    targets = {"win": ["win/x64"], "mac": ["mac/arm64", "mac/x64"], "all": ["win/x64", "mac/arm64", "mac/x64"]}[platform]
    inventory = {}
    for target in targets:
        source = ROOT / "build/addons" / target / "layer_math.uxpaddon"
        if not source.is_file():
            raise ValueError(f"Missing built addon for {target}")
        output = destination / target / source.name
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, output)
        inventory[str(output.relative_to(destination)).replace("\\", "/")] = hashlib.sha256(output.read_bytes()).hexdigest()
    (ROOT / "build/staged-plugin.json").write_text(json.dumps({"path": str(destination), "version": version, "platform": platform, "addons": inventory}, indent=2)+"\n")
    print(f"Staged plugin: {destination}")
    return destination

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--platform", choices=("win", "mac", "all"), required=True)
    stage(parser.parse_args().platform)
