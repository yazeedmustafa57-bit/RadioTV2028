#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$PROJECT_DIR"
PORT="${PORT:-3000}"
[[ "$PORT" =~ ^[0-9]+$ ]] && (( PORT > 0 && PORT < 65536 )) || { echo "Invalid PORT: $PORT" >&2; exit 1; }
DIST_DIR="$PROJECT_DIR/dist"
WEB_META_DIR="${OPENCODE_WEB_DIR:-/home/runner/work/_temp/omgithub-web}"

/usr/bin/time -p npm ci --no-audit --no-fund
/usr/bin/time -p mkdir -p "$DIST_DIR" "$WEB_META_DIR"
/usr/bin/time -p cp -f "$PROJECT_DIR/index.html" "$DIST_DIR/index.html"
/usr/bin/time -p node -e 'const fs=require("node:fs"); const p=process.argv[1]; const d=process.argv[2]; fs.writeFileSync(p, JSON.stringify({project:d, directory:d+"/dist"})+"\n", {mode:0o600});' "$WEB_META_DIR/deployment-output.json" "$PROJECT_DIR"

export PORT DIST_DIR
/usr/bin/time -p node "$PROJECT_DIR/serve-static.cjs"
