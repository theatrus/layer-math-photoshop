#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || { echo 'DMG packaging requires macOS.' >&2; exit 1; }
ccx="${1:?Pass a verified cross-platform CCX}"; identity="${2:-}"; output_dir="${3:-dist}"
ccx="$(cd "$(dirname "$ccx")" && pwd)/$(basename "$ccx")"
cd "$(dirname "$0")/.."
version="$(python3 -c 'import tomllib; print(tomllib.load(open("Cargo.toml","rb"))["package"]["version"])')"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && -f "$ccx" ]] || exit 1
[[ "$identity" != '-' ]] || exit 1
if [[ -n "$identity" ]]; then
  : "${APPLE_API_KEY_PATH:?Set APPLE_API_KEY_PATH for a signed release DMG}"
  : "${APPLE_API_KEY:?Set APPLE_API_KEY}"
  : "${APPLE_API_ISSUER:?Set APPLE_API_ISSUER}"
fi
work="$(mktemp -d)"; mount="$work/volume"; attached=''
cleanup() {
  if [[ -n "$attached" ]]; then hdiutil detach "$mount" || hdiutil detach -force "$mount" || return 1; fi
  rm -rf "$work"
}
trap cleanup EXIT
python3 scripts/verify-ccx.py "$ccx" --extract-mac "$work/mac"
for arch in arm64 x64; do
  cpu="$arch"; [[ "$arch" != x64 ]] || cpu=x86_64
  xcrun lipo "$work/mac/$arch/layer_math.uxpaddon" -verify_arch "$cpu"
  codesign --verify --strict "$work/mac/$arch/layer_math.uxpaddon"
  if [[ -n "$identity" ]]; then codesign -d --verbose=2 "$work/mac/$arch/layer_math.uxpaddon" 2>&1 | grep -q '^Authority=Developer ID Application: StackFoundry LLC (HSRHLHH333)$'; fi
done
python3 -m venv "$work/python"
"$work/python/bin/python" -m pip install --disable-pip-version-check -r scripts/dmg-requirements.txt
export LAYER_MATH_DMG_PYTHON="$work/python/bin/python"
stage="$work/staging"; mkdir -p "$stage/.background" "$stage/Documentation" dist
cp "$ccx" "$stage/Install Layer Math.ccx"
cp scripts/macos-install.txt "$stage/Read me first.txt"
cp NOTICE LICENSE THIRD_PARTY_NOTICES.txt "$stage/Documentation/"
cp scripts/dmg-background.png "$stage/.background/instructions.png"
mkdir -p "$output_dir"
output="$(cd "$output_dir" && pwd)/LayerMath-Photoshop-macOS-universal-${version}.dmg"
[[ ! -e "$output" ]] || { echo 'Output exists; move it aside first.' >&2; exit 1; }
size="$(du -sm "$stage" | awk '{print $1 + 32}')"
hdiutil create -volname "Layer Math $version" -srcfolder "$stage" -fs HFS+ -format UDRW -size "${size}m" "$work/writable.dmg"
mkdir "$mount"
hdiutil attach -readwrite -nobrowse -mountpoint "$mount" "$work/writable.dmg"; attached=1
"$LAYER_MATH_DMG_PYTHON" scripts/dmg-layout.py "$mount"
sync; hdiutil detach "$mount"; attached=''
hdiutil convert "$work/writable.dmg" -format UDZO -o "$output"
if [[ -n "$identity" ]]; then
  codesign --force --timestamp --sign "$identity" --identifier us.theatr.layer-math.disk-image "$output"
  codesign --verify --strict "$output"
  bash scripts/notarize-macos.sh "$output" "$output"
  spctl --assess --type open --context context:primary-signature --verbose=2 "$output"
fi
bash scripts/test-macos-dmg.sh "$output" "$ccx"
(cd "$(dirname "$output")" && shasum -a 256 "$(basename "$output")" > "$(basename "$output").sha256")
