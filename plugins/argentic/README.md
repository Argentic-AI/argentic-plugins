# Argentic

Argentic runs agents that keep their memory between calls and record what they did. If an agent is cut off in the middle of a run, it picks up where it stopped and does not repeat actions that already finished. Every run comes with a record of what ran, on any model.

This plugin connects your coding agent to Argentic. It does three things and nothing else:

- It adds one MCP server, `https://getargentic.com/mcp`. You sign in with your Argentic account (OAuth) and choose an organization. The plugin never sees your password.
- It adds five skills. `argentic` explains how to build on the API without wasting money or claiming features that do not exist. `argentic-setup` walks through connecting and making a first call. `argentic-quickstart` adds Argentic to your project. `argentic-status` shows your agents and which runs got cut off. `argentic-fix` finds why a run stopped and resumes it with your say-so.
- It asks for no model key. The MCP only reads (runs, steps, proof, usage) and manages keys and budget; it cannot wake an agent or run a model, so no model key ever goes to `getargentic.com/mcp`.

The plugin runs no local code, installs no packages and has no hooks.

## Tools

Account tools: `get_account`, `get_usage`, `set_budget`, `list_api_keys`, `create_api_key`, `revoke_api_key`.

Agent tools, read only: `argentic_wakes`, `argentic_wake_get`, `argentic_replay`, `argentic_agents`.

`set_budget` needs an owner or admin on the organization.

## Install

Claude Code:

```
claude plugin marketplace add Argentic-AI/argentic-plugins
claude plugin install argentic@argentic
```

Then run `/mcp` and sign in to `argentic`.

Docs: https://getargentic.com/docs. Privacy: https://getargentic.com/privacy. Terms: https://getargentic.com/terms.

MIT licensed.
