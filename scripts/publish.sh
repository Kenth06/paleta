#!/usr/bin/env bash
# Publish paleta packages to npm in dependency order.
#
# Default: dry-run. Prints every tarball npm would upload, never hits the network.
# Pass --go to actually publish.
#
# Requires:
#   - `pnpm` (publish uses pnpm to resolve workspace:* specs to real versions)
#   - `npm login` already done with npm 2FA enabled
#   - Rust toolchain if you want a fresh WASM build (skip with --skip-wasm)
#
# Usage:
#   scripts/publish.sh                 # dry-run all packages
#   scripts/publish.sh --go            # actually publish
#   scripts/publish.sh --go --tag beta # publish with a different dist-tag
#   scripts/publish.sh --skip-wasm     # reuse the checked-in WASM artifact

set -euo pipefail
cd "$(dirname "$0")/.."

GO=0
SKIP_WASM=0
TAG="alpha"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --go)        GO=1; shift ;;
    --skip-wasm) SKIP_WASM=1; shift ;;
    --tag)       TAG="$2"; shift 2 ;;
    -h|--help)   sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

# --- pre-flight checks ---
command -v pnpm >/dev/null || { echo "pnpm not found"; exit 1; }
pnpm --version | grep -qE '^([9-9]|[1-9][0-9])\.' || {
  echo "pnpm >= 9 required (got $(pnpm --version))"; exit 1;
}

if [[ $GO -eq 1 ]]; then
  npm whoami >/dev/null 2>&1 || {
    echo "error: 'npm whoami' failed — run 'npm login' first"; exit 1;
  }
  echo "Publishing as npm user: $(npm whoami)"
fi

# --- build steps ---
if [[ $SKIP_WASM -eq 0 ]]; then
  echo "[1/3] Building Rust WASM quantizer"
  bash scripts/build-wasm.sh >/dev/null
else
  echo "[1/3] Skipping WASM build (using checked-in artifact)"
fi

echo "[2/3] Building TS packages"
pnpm -r --filter='./packages/*' build >/dev/null

echo "[3/3] Running tests before publish"
pnpm test >/dev/null

# --- publish in dependency order ---
#
# @paleta/core has no internal deps → publish first.
# @paleta/jsquash + @paleta/cache-do depend on @paleta/core.
# @paleta/exif is standalone.
ORDER=(
  "packages/core"
  "packages/exif"
  "packages/jsquash"
  "packages/cache-do"
)

echo
echo "Publish plan (tag=${TAG}, go=${GO}):"
for p in "${ORDER[@]}"; do
  name=$(node -p "require('./$p/package.json').name")
  ver=$(node -p "require('./$p/package.json').version")
  echo "  $name @ $ver"
done
echo

if [[ $GO -eq 0 ]]; then
  for p in "${ORDER[@]}"; do
    name=$(node -p "require('./$p/package.json').name")
    echo "================ $name (dry-run) ================"
    (cd "$p" && pnpm publish --dry-run --tag "$TAG" --no-git-checks)
    echo
  done
  echo "Dry-run complete. Re-run with --go to publish for real."
  exit 0
fi

# Real publish. 2FA prompts come through pnpm's stdio.
for p in "${ORDER[@]}"; do
  name=$(node -p "require('./$p/package.json').name")
  echo "================ Publishing $name ================"
  (cd "$p" && pnpm publish --access public --tag "$TAG" --no-git-checks)
  # npm's index takes a few seconds to propagate before the next package
  # (which may depend on this one) can resolve the just-published version.
  sleep 5
done

# Tag the release
ver=$(node -p "require('./packages/core/package.json').version")
TAG_NAME="v${ver}"
if git rev-parse "$TAG_NAME" >/dev/null 2>&1; then
  echo "git tag $TAG_NAME already exists — skipping"
else
  git tag "$TAG_NAME"
  git push origin "$TAG_NAME"
  echo "Created and pushed git tag $TAG_NAME"
fi

echo
echo "Published. Install with:"
echo "  npm install @paleta/core@${TAG}"
