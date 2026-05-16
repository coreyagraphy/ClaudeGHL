#!/bin/bash
# SessionStart hook for Claude Code on the web.
# Runs once when a new session starts on this branch. Prepares the
# environment so the agent lands with full context:
#   1. Installs npm dependencies (node_modules/ is .gitignored).
#   2. Sets LLM_BACKEND=claude-cli for the session (this repo runs through
#      the user's Claude Code subscription, not an API key).
#   3. Prints HANDOFF.md so the new agent gets the full project state
#      without needing to scroll through prior transcript.
#   4. Runs `node src/index.js doctor` for a config sanity check.
#
# Web-only: skips on local Claude Code sessions where the user already
# has their environment configured.

set -euo pipefail

# Local-session escape hatch — only run in the managed remote env.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# --- 1. Install deps (idempotent; cached after first run) ---
if [ -f package-lock.json ]; then
  npm ci --no-audit --no-fund --prefer-offline 2>&1 | tail -3
else
  npm install --no-audit --no-fund 2>&1 | tail -3
fi

# --- 2. Pin backend to the Claude Code subscription ---
echo 'export LLM_BACKEND=claude-cli' >> "$CLAUDE_ENV_FILE"

# --- 3. Surface HANDOFF.md to the agent's context ---
if [ -f HANDOFF.md ]; then
  echo ""
  echo "================ HANDOFF.md ================"
  cat HANDOFF.md
  echo "================ end HANDOFF.md ================"
  echo ""
else
  echo "⚠  HANDOFF.md not found at repo root."
fi

# --- 4. Preflight check (informational; never fails the hook) ---
echo ""
echo "================ doctor ================"
LLM_BACKEND=claude-cli node src/index.js doctor || true
echo "================ end doctor ================"
