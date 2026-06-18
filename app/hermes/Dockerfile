# Hermes Agent on Amazon Bedrock AgentCore -- runtime container.
#
# Build context is this directory (app/hermes/). The deploy script clones
# NousResearch/hermes-agent into app/hermes/hermes-agent/ before `agentcore
# deploy` so the editable install below can find it.
#
# AgentCore runs on Graviton (ARM64); `agentcore deploy` builds for that arch.

# ---- Stage 1: builder ----------------------------------------------------
FROM public.ecr.aws/docker/library/python:3.11-slim AS builder

WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc g++ make libffi-dev libsqlite3-dev git curl \
    && rm -rf /var/lib/apt/lists/*

COPY hermes-agent/ /build/hermes-agent/

# hermes-agent (editable) + the Bedrock/AgentCore runtime deps.
RUN pip install --no-cache-dir --prefix=/install \
        -e "/build/hermes-agent[cron,mcp]" \
        "anthropic[bedrock]" boto3 botocore bedrock-agentcore

RUN python -m compileall -q /install/lib 2>/dev/null || true

# ---- Stage 2: runtime ----------------------------------------------------
FROM public.ecr.aws/docker/library/python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        libsqlite3-0 curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /install /usr/local
COPY --from=builder /build/hermes-agent /app/hermes-agent
COPY main.py /app/main.py

ENV PYTHONPATH="/app:/app/hermes-agent"

RUN useradd -m -u 1000 bedrock_agentcore \
    && mkdir -p /mnt/workspace/.hermes \
    && chown -R bedrock_agentcore:bedrock_agentcore /mnt/workspace

VOLUME ["/mnt/workspace"]

# AgentCore HTTP contract port.
EXPOSE 8080

ENV HERMES_HEADLESS=1 \
    AGENTCORE_MODE=1 \
    HERMES_HOME=/mnt/workspace/.hermes \
    PORT=8080 \
    PYTHONUNBUFFERED=1 \
    DOCKER_CONTAINER=1

COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

USER bedrock_agentcore

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["python", "-m", "main"]
