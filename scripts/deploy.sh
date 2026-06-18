#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Deploy Hermes-on-AgentCore + WhatsApp/cron for the `sansho` project.
#
#   ./scripts/deploy.sh            # runtime, then app (full deploy)
#   ./scripts/deploy.sh runtime    # build + deploy the AgentCore runtime only
#   ./scripts/deploy.sh app        # deploy the WhatsApp + cron CDK stacks only
#
# Order matters: `runtime` must run first so the app stacks can read the
# deployed runtime ARN (written into infra/cdk.json context).
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

PHASE="${1:-all}"
HERMES_REPO="https://github.com/NousResearch/hermes-agent.git"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ---------------------------------------------------------------------------
# runtime: build the container + deploy the AgentCore runtime via the CLI.
# ---------------------------------------------------------------------------
runtime() {
    info "=== Runtime: build + deploy AgentCore runtime ==="

    if ! command -v agentcore &>/dev/null; then
        info "Installing @aws/agentcore CLI ..."
        npm install -g @aws/agentcore
    fi

    # The agentcore CDK app requires at least one deployment target.
    local targets="$PROJECT_DIR/agentcore/aws-targets.json"
    if [ ! -s "$targets" ] || [ "$(jq 'length' "$targets" 2>/dev/null || echo 0)" = "0" ]; then
        local account region
        account=$(aws sts get-caller-identity --query Account --output text)
        region=$(aws configure get region 2>/dev/null || echo "us-west-2")
        info "Writing agentcore/aws-targets.json (account=$account, region=$region)"
        cat > "$targets" <<JSON
[
  { "name": "default", "description": "Default target", "account": "$account", "region": "$region" }
]
JSON
    fi

    # Bring NousResearch/hermes-agent into the Docker build context.
    if [ ! -d "$PROJECT_DIR/app/hermes/hermes-agent" ]; then
        info "Cloning hermes-agent into the build context ..."
        git clone --depth 1 "$HERMES_REPO" "$PROJECT_DIR/app/hermes/hermes-agent"
    fi

    info "Installing agentcore CDK dependencies ..."
    (cd "$PROJECT_DIR/agentcore/cdk" && npm install)

    info "Deploying runtime (agentcore deploy) ..."
    agentcore deploy --yes --verbose

    info "Reading runtime IDs ..."
    local status arn qualifier
    status=$(agentcore status --json 2>/dev/null | sed 's/\x1b\[[0-9;?]*[a-zA-Z]//g' || echo "{}")
    arn=$(echo "$status" | jq -r '
        [.. | objects | (.agentRuntimeArn // .runtimeArn // .arn // empty)]
        | map(select(type == "string" and (test("runtime")))) | .[0] // empty' 2>/dev/null || echo "")
    qualifier=$(echo "$status" | jq -r '
        [.. | objects | (.endpointName // .qualifier // empty)] | .[0] // "DEFAULT"' 2>/dev/null || echo "DEFAULT")
    [ -z "$qualifier" ] && qualifier="DEFAULT"

    if [ -z "$arn" ]; then
        warn "Could not auto-detect the runtime ARN."
        warn "Run 'agentcore status --json', then set agentcore_runtime_arn in infra/cdk.json."
        return
    fi

    info "Runtime ARN: $arn"
    info "Qualifier:   $qualifier"
    local tmp
    tmp=$(mktemp)
    jq ".context.agentcore_runtime_arn = \"$arn\" | .context.agentcore_qualifier = \"$qualifier\"" \
        "$PROJECT_DIR/infra/cdk.json" > "$tmp" && mv "$tmp" "$PROJECT_DIR/infra/cdk.json"
    info "infra/cdk.json updated."
}

# ---------------------------------------------------------------------------
# app: deploy the WhatsApp router + cron stacks.
# ---------------------------------------------------------------------------
app() {
    info "=== App: WhatsApp + cron CDK stacks ==="

    local arn
    arn=$(jq -r '.context.agentcore_runtime_arn // empty' "$PROJECT_DIR/infra/cdk.json")
    if [ -z "$arn" ]; then
        warn "agentcore_runtime_arn is empty in infra/cdk.json — run './scripts/deploy.sh runtime' first."
    fi

    info "Installing infra dependencies ..."
    (cd "$PROJECT_DIR/infra" && npm install)

    if ! aws cloudformation describe-stacks --stack-name CDKToolkit &>/dev/null; then
        info "Bootstrapping CDK ..."
        (cd "$PROJECT_DIR/infra" && npx cdk bootstrap)
    fi

    info "Deploying stacks ..."
    (cd "$PROJECT_DIR/infra" && npx cdk deploy sansho-whatsapp sansho-cron --require-approval never)

    cat <<'NOTE'

Next steps:
  1. Set the WhatsApp Cloud API credentials in Secrets Manager:
       aws secretsmanager put-secret-value --secret-id sansho/whatsapp \
         --secret-string '{"accessToken":"...","phoneNumberId":"...","appSecret":"...","verifyToken":"..."}'
  2. In the Meta App dashboard, set the webhook callback URL to the WebhookUrl
     output above and use the same verifyToken. Subscribe to the "messages" field.
  3. Enable model access for Claude Haiku 4.5 in the Bedrock console (same region).
NOTE
}

case "$PHASE" in
    all)     runtime; app ;;
    runtime) runtime ;;
    app)     app ;;
    *)       error "Usage: $0 [all|runtime|app]"; exit 1 ;;
esac

info "=== Done ==="
