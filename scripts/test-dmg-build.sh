#!/usr/bin/env bash
# Exercise DMG construction on macOS without Adobe SDKs or release credentials.
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || { echo 'Requires macOS.' >&2; exit 1; }
cd "$(dirname "$0")/.."
mkdir -p build/dmg-tests
work="$(mktemp -d "$(pwd)/build/dmg-tests/run-XXXXXX")"
for arch in arm64 x86_64; do
  printf 'int layer_math_packaging_fixture(void) { return 0; }\n' | \
    xcrun clang -x c - -dynamiclib -arch "$arch" -o "$work/$arch.uxpaddon"
  codesign --force --sign - "$work/$arch.uxpaddon"
done
python3 - "$work" <<'PY'
import json
from pathlib import Path
import sys
import zipfile
work = Path(sys.argv[1])
with zipfile.ZipFile(work / 'fixture.ccx', 'w') as out:
    out.write('uxp/manifest.json', 'manifest.json')
    # Deliberately not a valid Windows binary: this fixture cannot pass release setup verification.
    out.writestr('win/x64/layer_math.uxpaddon', b'MZ-packaging-test-only')
    out.write(work / 'arm64.uxpaddon', 'mac/arm64/layer_math.uxpaddon')
    out.write(work / 'x86_64.uxpaddon', 'mac/x64/layer_math.uxpaddon')
PY
bash scripts/build-macos-dmg.sh "$work/fixture.ccx" '' "$work/output"
(cd "$work/output" && shasum -a 256 -c ./*.sha256)
echo "DMG construction/remount checks passed with test binaries. Not an installable plugin: $work"
