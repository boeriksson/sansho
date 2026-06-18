#!/usr/bin/env bash
# Workspace init, then start the AgentCore contract server.
set -e

WORKSPACE="${HERMES_HOME:-/mnt/workspace/.hermes}"

for dir in memories skills sessions logs cache cron; do
    mkdir -p "$WORKSPACE/$dir" 2>/dev/null || true
done

# Seed the agent's SOUL.md from the bundled default if the user has none.
if [ ! -f "$WORKSPACE/SOUL.md" ] && [ -f /app/hermes-agent/SOUL.md ]; then
    cp /app/hermes-agent/SOUL.md "$WORKSPACE/SOUL.md"
fi

exec "$@"
