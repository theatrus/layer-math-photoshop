#!/usr/bin/env bash
set -euo pipefail
: "${APPLE_API_KEY_PATH:?Set APPLE_API_KEY_PATH}"
: "${APPLE_API_KEY:?Set APPLE_API_KEY}"
: "${APPLE_API_ISSUER:?Set APPLE_API_ISSUER}"
submission="${1:?Pass a ZIP or DMG}"; shift
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
xcrun notarytool submit "$submission" --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER" --wait --timeout 30m --output-format json > "$work/result.json" || true
read_result() {
  python3 - "$work/result.json" "$1" <<'PY'
import json, sys
text = open(sys.argv[1]).read()
decoder, index, last = json.JSONDecoder(), 0, {}
while True:
    start = text.find('{', index)
    if start < 0:
        break
    try:
        last, index = decoder.raw_decode(text, start)
    except ValueError:
        index = start + 1
print(last.get(sys.argv[2], '') if isinstance(last, dict) else '')
PY
}
id="$(read_result id)"; status="$(read_result status)"
[[ -n "$id" ]] || { echo 'No notarization submission ID.' >&2; exit 1; }
echo "Notarization $id: $status"
xcrun notarytool log "$id" --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER"
[[ "$status" == Accepted ]] || exit 1
for target in "$@"; do
  xcrun stapler staple "$target"
  xcrun stapler validate "$target"
done
