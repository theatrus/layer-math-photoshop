#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || exit 1
directory="${1:?Pass the directory containing arm64 and x64}"
identity="${2:?Pass a Developer ID Application identity}"
[[ "$identity" == 'Developer ID Application:'* ]] || { echo 'Developer ID Application is required.' >&2; exit 1; }
for arch in arm64 x64; do
  binary="$directory/$arch/layer_math.uxpaddon"
  [[ -f "$binary" && ! -L "$binary" ]] || exit 1
  cpu="$arch"; [[ "$arch" != x64 ]] || cpu=x86_64
  xcrun lipo "$binary" -verify_arch "$cpu"
  codesign --force --options runtime --timestamp --identifier us.theatr.layer-math.addon --sign "$identity" "$binary"
  codesign --verify --strict --verbose=2 "$binary"
  codesign -d --verbose=2 "$binary" 2>&1 | grep -q '^Authority=Developer ID Application'
  codesign -d --verbose=2 "$binary" 2>&1 | grep -q '^Timestamp='
done
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
ditto -c -k --keepParent "$directory" "$work/addons.zip"
# Bare dylibs receive tickets but cannot be stapled. The final DMG is stapled.
bash "$(dirname "$0")/notarize-macos.sh" "$work/addons.zip"
