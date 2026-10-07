"""Explicit one-time setup: encrypt the pinned SDK, upload ciphertext, set CI secret.

The passphrase exists only in this process and stdin pipes; never print it.
Refuses an existing SDK release so reruns cannot silently rotate a shared key.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile
from ci_sdk import ROOT, CONFIG

def provision(archive, repo):
    if repo != "theatrus/layer-math-photoshop":
        raise ValueError("This setup is scoped to theatrus/layer-math-photoshop")
    if hashlib.sha256(archive.read_bytes()).hexdigest() != CONFIG["sha256"]:
        raise ValueError("SDK does not match the pinned archive")
    release=CONFIG["release"]
    found=subprocess.run(["gh","release","view",release,"--repo",repo],capture_output=True)
    if found.returncode==0:
        raise ValueError("SDK release already exists; do not rotate its encryption key")
    # Distinguish missing release from an authentication/network failure.
    subprocess.run(["gh","repo","view",repo,"--json","nameWithOwner"],check=True,stdout=subprocess.DEVNULL)
    gpg=shutil.which("gpg") or str(Path(os.environ.get("ProgramFiles","C:/Program Files"))/"Git/usr/bin/gpg.exe")
    password=secrets.token_urlsafe(48)
    with tempfile.TemporaryDirectory(prefix="layer-math-sdk-") as work:
        encrypted=Path(work)/(CONFIG["archive"]+".gpg")
        subprocess.run([gpg,"--batch","--yes","--pinentry-mode","loopback","--passphrase-fd","0","--symmetric","--cipher-algo","AES256","--output",str(encrypted),str(archive.resolve())],input=(password+"\n").encode(),check=True)
        subprocess.run(["gh","secret","set","UXP_HYBRID_SDK_PASSPHRASE","--repo",repo],input=password.encode(),check=True)
        subprocess.run(["gh","release","create",release,str(encrypted),"--repo",repo,"--prerelease","--title","Encrypted UXP Hybrid SDK 6.5.0 build inputs","--notes","Encrypted build inputs only. Not an installable plugin. Adobe SDK plaintext is not distributed."],check=True)
    subprocess.run(["gh","variable","set","ENABLE_NATIVE_BUILDS","--repo",repo,"--body","true"],check=True)
    print("Encrypted SDK inputs and decryption secret configured; native CI enabled.")

if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive",type=Path)
    parser.add_argument("--repo",required=True)
    args=parser.parse_args()
    provision(args.archive,args.repo)
