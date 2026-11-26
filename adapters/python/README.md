# argentic-ai

Argentic client for Python. Argentic is an engine that keeps AI agents right for hours while prompt size is bounded. It runs your agent's loop, calls the model, and hands each tool call back to your code as an action with a stable key. If your process is killed mid-run, start it again: it resumes without repeating a finished action.

The package is the client and `run`, with no dependencies (Python 3.10+), plus three adapters that take the tools you already wrote:

- `argentic_ai.langchain`: LangChain and LangGraph tools. Needs `langchain-core`.
- `argentic_ai.openai_agents`: OpenAI Agents SDK `@function_tool` tools and an `Agent`'s instructions. Needs `openai-agents`. Nothing here runs `Runner`.
- `argentic_ai.pydantic_ai`: Pydantic AI tools (`Tool` objects or plain functions). Needs `pydantic-ai-slim`. Nothing here runs `Agent.run`.

Nothing in this package runs LangChain's, LangGraph's, Pydantic AI's or the Agents SDK's loop. The TypeScript client, `@argentic-ai/client` on npm, does the same job for the Vercel AI SDK and Mastra, and the two read each other's ledger files.

Retry-safe tools for Stripe, Resend, SMTP, Slack, GitHub and a generic HTTP POST are in `argentic_ai.tools` (`tool_pack`), standard library only. See [TOOLS.md](TOOLS.md).

## Install

```
pip install argentic-ai
pip install "argentic-ai[langchain]"      # or [openai-agents], [pydantic-ai]
```

Straight from GitHub, if you want the latest code or a pinned tag (swap `main` for a tag such as `npm-v0.1.4`):

```
pip install "argentic-ai @ git+https://github.com/Argentic-AI/argentic-plugins@main#subdirectory=adapters/python"
```

You need an Argentic API key from https://getargentic.com/platform and a model key. You choose the model: any provider you have a key for.

## Try it

```
export ARGENTIC_API_KEY=aek_...
export MODEL_KEY=...                       # your provider's key
export ARGENTIC_MODEL_PROVIDER=openai       # or ARGENTIC_MODEL_BASE_URL=https://... (any OpenAI-compatible endpoint)
export ARGENTIC_MODEL_ID=...
export ARGENTIC_PRICE_IN=0.25 ARGENTIC_PRICE_OUT=2  # dollars per million tokens
python -m argentic_ai demo
```

(`argentic-ai demo` does the same.) A support agent refunds an order, emails the customer and closes the ticket. Press Ctrl-C while it works, or pass `--kill-after 1`, then run the same command again: the refund is skipped, the rest finishes, and each wake is checked against the journal. State lives in `./.argentic-demo/`, the same folder the npm demo uses. `--fresh` starts over.

## Use

Plain tools are a name, a JSON schema and a handler:

```python
from argentic_ai import Argentic, Tool, model_from_env, run

def close_ticket(args, ctx):
    # ctx.idempotency_key is "<agent>:<seq>": pass it on to the system you call
    return close(args["ticket_id"], args["note"], idempotency_key=ctx.idempotency_key)

result = run(
    Argentic(),  # reads ARGENTIC_API_KEY and MODEL_KEY
    agent="support-bot", run_id="ticket-77",  # keep both the same across restarts
    task="Close ticket T-77 with the note 'refund sent'.",
    system="Call one tool per turn. When done, reply in one line.",
    tools=[Tool("close_ticket", "Close a support ticket.",
                {"type": "object", "properties": {"ticket_id": {"type": "string"}, "note": {"type": "string"}},
                 "required": ["ticket_id", "note"]}, close_ticket)],
    ledger_path=".argentic-ticket-77.json", model=model_from_env(),
)
print(result.reply)
```

Handlers can be `async def`; `run` itself is synchronous. With LangChain tools:

```python
from langchain_core.tools import tool
from argentic_ai.langchain import from_langchain_tools

@tool
def close_ticket(ticket_id: str, note: str) -> str:
    """Close a support ticket."""
    return f"closed {ticket_id}"

result = run(Argentic(), agent="support-bot", run_id="ticket-77", task="Close ticket T-77.",
                     tools=from_langchain_tools([close_ticket]), ledger_path=".argentic-ticket-77.json")
```

`task` is the new event: what happened since the agent last ran, never the earlier messages. `ledger_path` is optional: leave it out and finished actions are kept in memory for the call, so make your handlers safe to repeat with `ctx.idempotency_key`.

Run it again after a crash and it resumes. `model` is required and there is no default: `{"provider": "openai", "id": "...", "prices": {...}}`, or `"base_url"` in place of `provider` for any public https OpenAI-compatible endpoint. `model_from_env()` reads the variables below.

`client.replay(agent, wake_id)` re-renders a wake's prompts from the journal and compares them to what the model was shown. It calls no model and spends nothing. The answer always has `turns`, `matched`, `mismatched` and `unverifiable`, and `summarize_replay(result)` gives one line.

Hooks on `run`: `on_wake_start(step)` just before each wake is sent, `on_wake(step, wake_id, status, replayed)` after each answer, and `on_action(seq, tool, result, fresh)` for every action (`fresh` is False for one the ledger says already finished).

Each follow-up wake also sends the tool results as the `results` field, `[{"seq": n, "result": ...}]`, next to the message text the model reads, so the API journals the real result of every call (0.1.8). The first wake has none, and a result the ledger already held is sent again like the others. Pass `structured_results=False` to `run` for the text only. If the API does not know the field yet, it answers 400 and names `results`; the client sends that wake again once without it, under the same key, and leaves it out from then on. Calling `client.wake()` yourself, pass `results=[...]` with the `message`, never with `fire_due`, at most 100 entries.

## Waking the agent later

Argentic has no clock of its own: your app decides when an agent runs. Pass `schedule=True` on the agent's wakes so it can put a time on a plan. Every answer then has `wake_at`, the time the agent next wants waking, or `None`. Keep the latest one per agent in your own scheduler (cron, Celery's `eta`, a delayed queue job) and at that time wake the agent with `fire_due=True`:

```python
MY_MODEL = model_from_env()  # or a dict: {"provider": "openai", "id": "...", "prices": {"in": 0.25, "out": 2}}
out = client.wake("support-bot", "Chase the refund on Friday.", model=MY_MODEL, idempotency_key="chase-1", schedule=True)
if out.wake_at:
    wake_later.apply_async(eta=datetime.fromisoformat(out.wake_at))

# later, in that task:
client.wake("support-bot", model=MY_MODEL, idempotency_key=f"due-{out.wake_at}", fire_due=True, schedule=True)
```

`run` does the same for an agent with tools of your own: pass `schedule=True`, and the result's `wake_at` is the time to wake it next, with `fire_due=True` in place of `task`:

```python
out = run(client, agent="support-bot", run_id=event["id"], task=event["text"], tools=tools, schedule=True)
if out.wake_at:
    wake_later.apply_async(eta=datetime.fromisoformat(out.wake_at))

# later, in that task:
run(client, agent="support-bot", run_id=f"due-{time.time_ns()}", fire_due=True, tools=tools, schedule=True)
```

A `fire_due` wake with nothing due makes no model call and costs nothing. `client.due()` lists every plan whose time has passed, if your scheduler loses track.

## Settings

| Variable | What it is |
|---|---|
| `ARGENTIC_API_KEY` | Your Argentic API key (`aek_...`). |
| `MODEL_KEY` | Your model provider's key, sent as `X-Model-Key`. Argentic never stores it. |
| `EMBED_KEY` | Your embedding provider's key, sent as `X-Embed-Key`. With it, the agent's recall also finds what was said in other words; without it, recall goes by words. Argentic never stores it, and your provider bills you for the embedding calls. |
| `EMBED_PROVIDER`, `EMBED_REGION` | `cohere` (the default) or `bedrock`, and for `bedrock` the region your key calls (default `us-east-1`). |
| `ARGENTIC_BASE_URL` | The API address. Unset, it is `https://api.getargentic.com`. |
| `ARGENTIC_MODEL_ID`, `ARGENTIC_MODEL_PROVIDER` or `ARGENTIC_MODEL_BASE_URL`, `ARGENTIC_PRICE_IN`, `ARGENTIC_PRICE_OUT` | Your model, read by `model_from_env()`. Give a provider name or a base URL (a public https OpenAI-compatible endpoint), not both. `ARGENTIC_BASE_URL` above is Argentic's API, not the model's. Prices are dollars per million tokens. With no `ARGENTIC_MODEL_ID` it raises `ValueError`: there is no default model. |

`Argentic(api_key=..., model_key=..., embed_key=..., base_url=..., timeout=300)` takes the same things as arguments. A 409 (the agent is mid-run) waits and sends the same request again, and a 5xx or a network failure retries with the same key after 1, 2, 4 and 8 seconds, so a retry never adds a message twice. `backoff=` and `max_queued_waits=` change both. If the ledger file is not valid JSON, `run` warns on stderr, sets it aside as `<path>.corrupt` and starts empty, so finished actions may run again. Errors are `ArgenticError` with `.status` (None when no answer came back) and `.body`; `hint_for(error)` returns a next step for the ones a first run tends to hit.

## Honest limits

Delivery is at-least-once. If the process dies while an action is running, before its result is written to the ledger, that action runs again on resume. Make handlers safe to repeat by using `ctx.idempotency_key` (`"<agent>:<seq>"`) with the system you call.

LangChain tools are called the way a LangGraph `ToolNode` calls them, with that key as the tool call id. A tool that takes `tool_call_id: Annotated[str, InjectedToolCallId]` receives `"<agent>:<seq>"` and can pass it on as the idempotency key of the system it calls.

OpenAI Agents SDK tools are called through their own `on_invoke_tool`, with that key as the SDK `ctx.tool_call_id`. Each tool call runs on its own event loop, so call `run` from sync code.

Docs: https://getargentic.com/docs/client/. Source and issues: https://github.com/Argentic-AI/argentic-plugins.
