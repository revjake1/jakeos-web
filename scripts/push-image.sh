#!/usr/bin/env bash
# Build + push the multi-arch jakeos-web image to GitHub Container Registry.
#
# Prereq: the gh CLI must have the `write:packages` scope. If push fails with
# "permission_denied: The token provided does not match expected scopes",
# run `gh auth refresh -s write:packages,read:packages` once, then re-run this.

set -euo pipefail

cd "$(dirname "$0")/.."

IMAGE="ghcr.io/revjake1/jakeos-web"
TAG_LATEST="$IMAGE:latest"
# Bump TAG_VERSION when shipping a meaningfully new build alongside :latest.
TAG_VERSION="$IMAGE:${TAG_VERSION:-phase-3.2}"

echo "→ Logging in to ghcr.io as revjake1…"
gh auth token | docker login ghcr.io -u revjake1 --password-stdin

echo "→ Building + pushing $TAG_LATEST and $TAG_VERSION (linux/amd64, linux/arm64)…"
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag "$TAG_LATEST" \
  --tag "$TAG_VERSION" \
  --push \
  .

echo "✓ Pushed $TAG_LATEST and $TAG_VERSION"
