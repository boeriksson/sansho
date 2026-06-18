"""Hermes Agent on Amazon Bedrock AgentCore.

Uses the bedrock-agentcore SDK (BedrockAgentCoreApp), which serves the
/ping and /invocations HTTP contract automatically.

The anthropic SDK is monkey-patched BEFORE hermes-agent is imported so that
any `anthropic.Anthropic(...)` construction transparently returns an
`anthropic.AnthropicBedrock(...)` client. hermes-agent code is unmodified;
it thinks it is talking to the Anthropic API while every call is routed
through Bedrock with SigV4 (the runtime's IAM role), no API key required.
"""

from __future__ import annotations

import logging
import os
import signal
import sys
import traceback
from typing import Any

import httpx
import anthropic

_OrigAnthropic = anthropic.Anthropic

# Cheapest Claude on Bedrock. Override with the BEDROCK_MODEL_ID env var
# (set in agentcore/agentcore.json) to move to Sonnet/Opus later.
DEFAULT_MODEL_ID = "eu.anthropic.claude-haiku-4-5-20251001-v1:0"


def _get_region() -> str:
    return (
        os.environ.get("AWS_REGION")
        or os.environ.get("AWS_DEFAULT_REGION")
        or "us-west-2"
    )


class _PatchedAnthropic:
    """Drop-in replacement for anthropic.Anthropic that uses Bedrock."""

    _bedrock_client = None

    def __new__(cls, *args, **kwargs):
        # If a real Anthropic API key is supplied, fall back to the real client.
        api_key = kwargs.get("api_key", "")
        if api_key and api_key.startswith("sk-ant-"):
            return _OrigAnthropic(*args, **kwargs)

        if cls._bedrock_client is None:
            cls._bedrock_client = anthropic.AnthropicBedrock(
                aws_region=_get_region(),
                timeout=httpx.Timeout(600.0, connect=10.0),
            )
        return cls._bedrock_client


anthropic.Anthropic = _PatchedAnthropic  # type: ignore[misc]

# ---------------------------------------------------------------------------

from bedrock_agentcore.runtime import BedrockAgentCoreApp  # noqa: E402

logger = logging.getLogger("hermes.agentcore")
app = BedrockAgentCoreApp()
log = app.logger

_agent = None


def get_or_create_agent():
    """Lazy-init the full hermes-agent. Blocks on first request (~10-30s)."""
    global _agent
    if _agent is not None:
        return _agent

    log.info("Initializing hermes-agent (first request) ...")

    os.environ["HERMES_HEADLESS"] = "1"
    os.environ.setdefault("AGENTCORE_MODE", "1")
    region = _get_region()
    os.environ.setdefault("AWS_DEFAULT_REGION", region)
    os.environ.setdefault("AWS_REGION", region)

    from run_agent import AIAgent

    # Keep the dotted Bedrock model ID intact during __init__ normalization.
    AIAgent._anthropic_preserve_dots = lambda self: True

    model = os.environ.get("BEDROCK_MODEL_ID", DEFAULT_MODEL_ID)

    _agent = AIAgent(model=model, provider="anthropic", quiet_mode=True)
    # hermes-agent's __init__ rewrites dots to dashes (us.anthropic... ->
    # us-anthropic...), which Bedrock rejects. Force the dotted ID back.
    _agent.model = model

    log.info("hermes-agent ready (model=%s, region=%s, backend=bedrock)", model, region)
    return _agent


def _sigterm_handler(signum: int, frame: Any) -> None:
    log.info("SIGTERM received - shutting down")
    sys.exit(0)


@app.entrypoint
async def invoke(payload, context):
    """Handle one AgentCore invocation.

    Payload fields (all optional except a message):
      prompt | message       the user's text
      channel                origin label (e.g. "whatsapp", "cron")
      chatId                 conversation/channel id, surfaced to the agent
      conversationHistory    prior turns to restore context
    """
    message = payload.get("message") or payload.get("prompt") or ""
    if not message.strip():
        yield ""
        return

    channel = payload.get("channel", "agentcore")

    try:
        agent = get_or_create_agent()

        system_extra = f"The user is contacting you via {channel}."
        if payload.get("chatId"):
            system_extra += f" Chat ID: {payload['chatId']}."

        result = agent.run_conversation(
            user_message=message,
            system_message=system_extra,
            conversation_history=payload.get("conversationHistory") or None,
        )
        # run_conversation returns a dict with final_response key
        yield result.get("final_response") or ""
    except Exception as exc:
        log.error("Agent error: %s\n%s", exc, traceback.format_exc())
        yield f"Sorry, an error occurred: {exc}"


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
    )
    signal.signal(signal.SIGTERM, _sigterm_handler)
    app.run()
