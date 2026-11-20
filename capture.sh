#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$PROJECT_DIR"
: "${CAPTURE_URL:?Set CAPTURE_URL to the exact preview URL.}"
: "${CAPTURE_DIR:?Set CAPTURE_DIR to the evidence output directory.}"
: "${RUNTIME_DIR:?RUNTIME_DIR must point to the OMGithub runtime scripts.}"

/usr/bin/time -p mkdir -p "$CAPTURE_DIR"
/usr/bin/time -p node "$RUNTIME_DIR/scripts/default-capture.mjs"
