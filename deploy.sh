#!/usr/bin/env bash
# deploy.sh — rebuild and redeploy the Linear Workbench to Butterbase
#
# Usage:
#   ./deploy.sh           — deploy both function + frontend
#   ./deploy.sh fn        — redeploy only the serverless function
#   ./deploy.sh frontend  — rebuild and redeploy only the frontend
#
# Prerequisites:
#   export BUTTERBASE_SERVICE_KEY="bb_sk_..."   (from Butterbase dashboard → API Keys)
#   cd frontend && npm install

set -euo pipefail

# Load .env from project root if present (and BUTTERBASE_SERVICE_KEY not already set)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ -z "${BUTTERBASE_SERVICE_KEY:-}" && -f "${SCRIPT_DIR}/.env" ]]; then
  # shellcheck source=/dev/null
  set -o allexport; source "${SCRIPT_DIR}/.env"; set +o allexport
fi

APP_ID="app_02vcbf6ev0vp"
API_BASE="https://api.butterbase.ai/v1/${APP_ID}"
FRONTEND_DIR="$(cd "$(dirname "$0")/frontend" && pwd)"
ZIP_PATH="$(cd "$(dirname "$0")" && pwd)/frontend.zip"
MODE="${1:-all}"

# ── Auth check ────────────────────────────────────────────────────────────────
require_key() {
  if [[ -z "${BUTTERBASE_SERVICE_KEY:-}" ]]; then
    echo "Error: BUTTERBASE_SERVICE_KEY is not set."
    echo "  export BUTTERBASE_SERVICE_KEY=\"bb_sk_...\""
    echo "  (generate one in the Butterbase dashboard under API Keys)"
    exit 1
  fi
}

AUTH_HEADER() {
  echo "Authorization: Bearer ${BUTTERBASE_SERVICE_KEY}"
}

# ── Frontend ──────────────────────────────────────────────────────────────────
deploy_frontend() {
  require_key

  echo "▸ Building frontend…"
  (cd "$FRONTEND_DIR" && npm run build)

  echo "▸ Creating deployment…"
  DEPLOY_JSON=$(curl -sf -X POST "${API_BASE}/deployments" \
    -H "$(AUTH_HEADER)" \
    -H "Content-Type: application/json" \
    -d '{"framework":"react-vite"}')

  DEPLOY_ID=$(echo "$DEPLOY_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['deployment_id'])")
  UPLOAD_URL=$(echo "$DEPLOY_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['uploadUrl'])")

  echo "▸ Zipping dist/…"
  (cd "${FRONTEND_DIR}/dist" && zip -r "$ZIP_PATH" .)

  echo "▸ Uploading zip…"
  HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$UPLOAD_URL" \
    -H "Content-Type: application/zip" \
    --data-binary @"$ZIP_PATH")
  [[ "$HTTP" == "200" ]] || { echo "Upload failed (HTTP $HTTP)"; exit 1; }

  echo "▸ Starting deployment ${DEPLOY_ID}…"
  curl -sf -X POST "${API_BASE}/deployments/${DEPLOY_ID}/start" \
    -H "$(AUTH_HEADER)" \
    -H "Content-Type: application/json" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f'  status : {d.get(\"status\")}')
print(f'  url    : {d.get(\"url\")}')
"
  rm -f "$ZIP_PATH"
}

# ── Function ──────────────────────────────────────────────────────────────────
deploy_function() {
  require_key

  echo "▸ Deploying function evaluate…"
  CODE=$(cat "$(dirname "$0")/functions/evaluate.ts")

  curl -sf -X POST "${API_BASE}/functions" \
    -H "$(AUTH_HEADER)" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c "
import json, sys
code = open('$(dirname "$0")/functions/evaluate.ts').read()
print(json.dumps({
  'name': 'evaluate',
  'code': code,
  'timeoutMs': 45000,
  'trigger': {
    'type': 'http',
    'config': {'method': 'POST', 'path': '/evaluate', 'auth': 'none'}
  }
}))
")" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f'  name : {d.get(\"name\")}')
print(f'  url  : {d.get(\"url\")}')
print(f'  status: {d.get(\"status\", d.get(\"deployedAt\", \"?\"))}')
"
}

# ── Main ──────────────────────────────────────────────────────────────────────
case "$MODE" in
  fn|function)   deploy_function ;;
  frontend)      deploy_frontend ;;
  all|*)         deploy_function; echo; deploy_frontend ;;
esac

echo
echo "✓ Done."
