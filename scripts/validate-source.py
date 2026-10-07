"""Validate manual tag inputs, and log the actual source rather than workflow SHA."""
import os
import re
import subprocess
import tomllib
from pathlib import Path

tag = os.environ.get("RELEASE_TAG", "")
version = tomllib.loads((Path(__file__).resolve().parent.parent / "Cargo.toml").read_text())["package"]["version"]
if tag and (not re.fullmatch(r"v\d+\.\d+\.\d+", tag) or tag != "v"+version):
    raise SystemExit("release_tag must match the checked-out package version")
sha = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
if tag:
    tagged = subprocess.check_output(["git", "rev-parse", "refs/tags/"+tag+"^{commit}"], text=True).strip()
    if sha != tagged:
        raise SystemExit("Source does not match release tag")
print(f"Source commit: {sha}; version: {version}; workflow run source: {os.environ.get('GITHUB_SHA', 'local')}")
