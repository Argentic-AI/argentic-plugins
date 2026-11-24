"""Argentic client and run. Standard library only, Python 3.10+.

Framework adapters live in `argentic_ai.langchain`, `argentic_ai.openai_agents` and `argentic_ai.pydantic_ai`.
`python -m argentic_ai demo` (or the `argentic-ai` command) kills an agent mid-run and resumes it.
Retry-safe tools for Stripe, Resend, SMTP, Slack, GitHub and HTTP: `argentic_ai.tools.tool_pack`.
"""
from .core import (
    DEFAULT_BASE_URL,
    FREE_MODEL,
    Action,
    Argentic,
    ArgenticError,
    Ledger,
    ModelSpec,
    RetryLater,
    RunResult,
    Tool,
    ToolContext,
    WakeResponse,
    __version__,
    hint_for,
    model_from_env,
    run,
    run_durable,
    summarize_replay,
    to_argentic_schema,
)

__all__ = [
    "Action", "Argentic", "ArgenticError", "DEFAULT_BASE_URL", "FREE_MODEL", "Ledger", "ModelSpec", "RetryLater", "RunResult",
    "Tool", "ToolContext", "WakeResponse", "__version__", "hint_for", "model_from_env",
    "run", "run_durable", "summarize_replay", "to_argentic_schema",
]
