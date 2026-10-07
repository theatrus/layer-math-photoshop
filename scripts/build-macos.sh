#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || { echo 'Requires macOS and Xcode.' >&2; exit 1; }
cd "$(dirname "$0")/.."
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
mkdir -p build/native
if [[ "${1:-}" == --backend-only ]]; then
  cargo build --locked --release
  xcrun clang++ -std=c++17 -O2 native/abi_smoke.cpp target/release/liblayer_math_photoshop.a -o build/native/abi_smoke
  build/native/abi_smoke
  exit
fi
sdk="${1:-${UXP_HYBRID_SDK:-}}"
[[ -d "$sdk/src/utilities" ]] || { echo 'Pass the hybrid SDK root containing src/utilities.' >&2; exit 1; }
sdk="$(cd "$sdk" && pwd)"
rustup target add aarch64-apple-darwin x86_64-apple-darwin
export MACOSX_DEPLOYMENT_TARGET=12.0
for arch in arm64 x64; do
  target=aarch64-apple-darwin; cpu=arm64
  if [[ "$arch" == x64 ]]; then target=x86_64-apple-darwin; cpu=x86_64; fi
  cargo build --locked --release --target "$target"
  mkdir -p "build/addons/mac/$arch"
  xcrun clang++ -std=c++17 -O2 -fvisibility=hidden -arch "$cpu" -mmacosx-version-min=12.0 \
    -dynamiclib -I"$sdk/src/utilities" native/addon.cpp "target/$target/release/liblayer_math_photoshop.a" \
    -o "build/addons/mac/$arch/layer_math.uxpaddon"
  codesign --force --sign - "build/addons/mac/$arch/layer_math.uxpaddon"
  codesign --verify --strict "build/addons/mac/$arch/layer_math.uxpaddon"
  xcrun lipo "build/addons/mac/$arch/layer_math.uxpaddon" -verify_arch "$cpu"
done
target=x86_64-apple-darwin
[[ "$(uname -m)" != arm64 ]] || target=aarch64-apple-darwin
xcrun clang++ -std=c++17 -O2 native/abi_smoke.cpp "target/$target/release/liblayer_math_photoshop.a" -o build/native/abi_smoke
build/native/abi_smoke
python3 scripts/stage.py --platform mac
