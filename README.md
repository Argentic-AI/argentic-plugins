# Argentic plugins

[Argentic](https://getargentic.com/docs) (getargentic.com) is an engine that keeps AI agents right for hours while prompt size is bounded. This repo has the skills and the optional connector that let your coding assistant integrate Argentic into your app, then manage your API keys, usage and budget.

If your agent runs out of context and gets worse after many tokens, that is the problem the engine is for. [How it compares with Lossless Claw, Hindsight, Mem0 and Letta](https://getargentic.com/blog/my-agent-gets-worse-over-long-runs/), read from each one's own docs.

This repo holds only manifests, skills, MCP settings and small client adapters. The engine is not in it.

Start with the [prompt below](#ask-your-agent-to-do-it): your assistant integrates your app first. The connector comes after, as an optional dev tool. There is one MCP, `https://getargentic.com/mcp`. You sign in with your Argentic account and pick an organization. Sign-in is CIMD only: there is no client ID or secret to get from Argentic and no API key to paste into the app. The MCP reads your agents' runs and proof and manages API keys, usage and budget. It cannot wake an agent, resume a run or run a model: your own app wakes your agents.

## Try it

To run your own agent, start with the [TypeScript client](adapters/typescript/README.md#use) or the [quickstart](https://getargentic.com/docs/quickstart/). You need an Argentic API key from https://getargentic.com/platform and a model key.

To test Argentic against a plain loop on a scripted scenario, use [`@argentic-ai/check`](check/README.md). It runs scripted scenarios (a shop shift, a coordinator day and longshift ship with it; you can add your own) on your own keys, scores both arms with code, and stops at a spend cap you set. It needs an Argentic key and a model key.

`npx @argentic-ai/client demo` was removed in client 0.2.0. The kill-and-resume refund story still lives in [`examples/`](examples/).

## Optional: the connector

Once your app is integrated, add the connector so your assistant can manage keys, usage and runs.

## Claude Code

```
claude plugin marketplace add Argentic-AI/argentic-plugins
claude plugin install argentic@argentic
```

Then run `/mcp` and sign in to `argentic`.

MCP only, no plugin:

```
claude mcp add --transport http argentic https://getargentic.com/mcp
```

Then run `/mcp` to sign in.

## claude.ai and Claude Projects

Customize, Connectors, Add custom connector, URL `https://getargentic.com/mcp`. Sign in and pick your organization. Disconnect any time in your Argentic settings.

For the skills: Customize, Plugins, the + next to Personal plugins, Add marketplace, From a repository, `Argentic-AI/argentic-plugins`.

## Cursor

Once the listing is live, search for Argentic in the Cursor marketplace. Until then, add the MCP by hand in `~/.cursor/mcp.json`:

```
{"mcpServers": {"argentic": {"url": "https://getargentic.com/mcp"}}}
```

Cursor opens the sign-in when you enable the server.

## Codex

```
codex plugin marketplace add Argentic-AI/argentic-plugins
```

That adds the skills. Add the MCP to `~/.codex/config.toml`:

```
[mcp_servers.argentic]
url = "https://getargentic.com/mcp"
```

Sign in with `codex mcp login argentic`.

## Without the MCP

The HTTP API still works on its own: `POST /v1/agents/{agent}/wake` and the other routes take an API key (`aek_...`, created by the `create_api_key` tool or in the dashboard) as `Authorization: Bearer`, plus `X-Model-Key` to wake. Your app makes that call, never the MCP. See the [docs](https://getargentic.com/docs).

## Bring your tools

Already have tools written for the Vercel AI SDK, Mastra, LangChain / LangGraph, Pydantic AI or the OpenAI Agents SDK? Bring your tools, your prompt and your model key. Argentic runs the loop and replaces your framework's. [`adapters/`](adapters/) has one small tool converter per framework (TypeScript: `npm i @argentic-ai/client`; Python: `argentic-ai`, coming to PyPI, until then `pip install` it from this repo as [`adapters/python`](adapters/python/README.md) describes), and [`examples/`](examples/) has a runnable refund agent for each, plus one with no framework at all. To try Argentic with nothing to write, see [Try it](#try-it); the Python package still has `python -m argentic_ai demo`.

## Ask your agent to do it

Paste this into Claude Code, Codex or another coding assistant, in your app's folder. It integrates Argentic into your app first, then offers the connector.

```
Add Argentic to this app. Read https://getargentic.com/docs/quickstart and follow it for my stack.

Argentic runs the agent loop and keeps the history, so each call sends only the new events (a user message, a tool result), never the whole transcript. Use my Anthropic key as the model key if I have one, since prompt caching is built for Anthropic models.

Put ARGENTIC_API_KEY and my model key in .env. Don't ask me to paste keys into this chat: tell me where each one goes and let me add it. Run one small test call with a spend cap and tell me what it cost.

When that works, ask whether I also want the Argentic connector installed in this assistant. It's optional: it lets you manage my keys, usage and runs from here. If I say yes, follow https://getargentic.com/docs/agents#assistant. Don't install it unless I say yes.
```

## What is in the plugin

- `argentic` skill: how to build on the API without wasting money or claiming features that do not exist.
- `argentic-setup` skill: integrates your app first, then offers the connector.
- `argentic-quickstart` skill: add Argentic to your own project, with keys in `.env`, and run one small test call.
- `argentic-status` skill: list your agents and which runs got cut off. Read only.
- `argentic-fix` skill: find why a run stopped, then tell you what your app should do (resume it, or raise a limit with your say-so).
- `argentic` MCP server, signed in with your Argentic account.
  - Account tools: `get_account`, `list_api_keys`, `create_api_key`, `revoke_api_key`, `get_usage`, `set_budget`.
  - Run tools, read only: `argentic_wakes`, `argentic_wake_get`, `argentic_replay`, and `get_run_links` where it is switched on. They run no model and spend nothing.
  - `set_budget` needs an owner or admin. Other tools work as far as your role allows.

MIT licensed.
