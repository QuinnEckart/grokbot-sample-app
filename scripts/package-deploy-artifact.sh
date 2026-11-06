#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${OUT_DIR:-$ROOT/dist}"
mkdir -p "$OUT_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="grokbot-sample-app-deploy-${STAMP}.tar.gz"
DEST="$OUT_DIR/$NAME"

cd "$ROOT"
tar -czvf "$DEST" \
  package.json \
  package-lock.json \
  server.js \
  Dockerfile \
  .dockerignore \
  lib \
  public \
  .do/app.yaml \
  README.md \
  LICENSE \
  .env.example

echo "$DEST"
