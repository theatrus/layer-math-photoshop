#!/usr/bin/env bash
set -euo pipefail
image="${1:?Pass the DMG}"; ccx="${2:?Pass the original CCX}"
hdiutil verify "$image"
work="$(mktemp -d)"; mount="$work/remounted"; attached=''
cleanup() {
  if [[ -n "$attached" ]]; then hdiutil detach "$mount" || hdiutil detach -force "$mount" || return 1; fi
  rm -rf "$work"
}
trap cleanup EXIT
mkdir "$mount"
hdiutil attach -readonly -nobrowse -mountpoint "$mount" "$image"; attached=1
if [[ -z "${LAYER_MATH_DMG_PYTHON:-}" ]]; then
  python3 -m venv "$work/python"
  "$work/python/bin/python" -m pip install -r "$(dirname "$0")/dmg-requirements.txt"
  LAYER_MATH_DMG_PYTHON="$work/python/bin/python"
fi
"$LAYER_MATH_DMG_PYTHON" "$(dirname "$0")/dmg-layout.py" --verify "$mount"
cmp "$ccx" "$mount/Install Layer Math.ccx"
for doc in NOTICE LICENSE THIRD_PARTY_NOTICES.txt; do cmp "$(dirname "$0")/../$doc" "$mount/Documentation/$doc"; done
test ! -e "$mount/Photoshop Plug-ins"
echo 'Verified DMG layout, background alias and unchanged CCX; no installation performed.'
