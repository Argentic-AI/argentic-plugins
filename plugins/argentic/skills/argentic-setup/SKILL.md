---
name: argentic-setup
description: Use when the user asks to set up Argentic or add it to their app. Integrates their app first, then offers the optional connector. Also for a missing or failing argentic MCP server or unauthorized.
---

# Setting up Argentic

Order matters. Argentic is for the user's own app, so integrate the app first. The connector (the MCP below) is an optional dev tool for keys, usage and runs. Never install it as step one.

## Step 1: integrate the user's app

Use the `argentic-quickstart` skill. In short:

1. Detect their stack and install the client.
2. Send Argentic only the new events (a user message, a tool result). Argentic keeps the history and builds each prompt from it, so never resend the transcript.
3. Put `ARGENTIC_API_KEY` and the model key in `.env`, never in chat or in code. Tell the user where each goes and let them add it. Prefer an Anthropic model key: prompt caching is built for Anthropic models.
4. Run one small test call with `max_usd` of 0.05 and report `spent_usd`.

## Step 2: offer the connector

Only after the test call works, ask: "Want the Argentic connector in this assistant too? It lets me manage your keys, usage and runs from here." Install it only on a yes. Everything below is that connector.

# The connector

## What you need

1. An Argentic account. The MCP signs in with it and asks which organization to use. Sign-in is CIMD only (Client ID Metadata Documents): there is no client ID or client secret to get from Argentic, no dynamic client registration, and no API key to paste into the app. Do not ask the user for a client ID. Only allow-listed apps can sign in (Claude, Codex, VS Code); anything else uses the API key route below.
2. The connector needs no model key: it only reads and manages the account. The user's own key for a model provider belongs to their app (integrated first, above).

Never ask the user to paste a key into the chat. Point them at the place the key goes and let them put it there.

## Where to connect

The one MCP is `https://getargentic.com/mcp`.

- Claude Code plugin: `claude plugin marketplace add Argentic-AI/argentic-plugins`, then `claude plugin install argentic@argentic`. Then `/mcp` and sign in to `argentic`.
- Claude Code, MCP only: `claude mcp add --transport http argentic https://getargentic.com/mcp`, then `/mcp` to sign in.
- claude.ai: Customize, Connectors, Add custom connector, the URL above. Sign in and pick the organization.
- Codex: in `~/.codex/config.toml`, a `[mcp_servers.argentic]` table with the `url` above. Sign in with `codex mcp login argentic`.

The HTTP API takes an API key (`aek_...`, from the `create_api_key` tool or the dashboard); the app's wake call adds `X-Model-Key`.

## Check it works, cheaply

1. Call `get_account`. It costs nothing and proves the sign-in and organization. `unauthorized` means sign in again via `/mcp`.
2. Call `argentic_agents` (where available) or `argentic_wakes` for any agent id. Empty is fine; it proves the agent routes work.
3. The connector cannot wake an agent. To test a call, use the app's own call from `argentic-quickstart`.

Tell the user which organization it signed in to and what it listed.
