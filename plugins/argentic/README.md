# Argentic

Argentic is an engine that keeps AI agents right for hours while prompt size is bounded. Your app wakes the agent over the API; the engine rebuilds its prompt from a record of what it did, and every run comes with that record, on any model.

This plugin connects your coding agent to Argentic. It does three things and nothing else:

- It adds one MCP server, `https://getargentic.com/mcp`. You sign in with your Argentic account (OAuth) and choose an organization. The plugin never sees your password.
- It adds five skills. `argentic` explains how to build on the API without wasting money or claiming features that do not exist. `argentic-setup` walks through connecting and making a first call. `argentic-quickstart` adds Argentic to your project. `argentic-status` shows your agents and which runs got cut off. `argentic-fix` finds why a run stopped and tells you what your app should do about it.
- It asks for no model key. The MCP reads your agents' runs and proof and manages API keys, usage and budget. It cannot wake an agent, resume a run or run a model, so no model key ever goes to `getargentic.com/mcp`. Your own app wakes its agents over the REST API.

The plugin runs no local code, installs no packages and has no hooks.

## Tools

Account tools: `get_account`, `get_usage`, `set_budget`, `list_api_keys`, `create_api_key`, `revoke_api_key`.

Run tools, read only: `argentic_wakes` (find runs), `argentic_wake_get` (read one run), `argentic_replay` (check a run's proof), `get_run_links` (the dashboard page and proof link for a run). None of them runs a model or spends on your model account.

`set_budget` needs an owner or admin on the organization. Creating and revoking keys and setting a budget are the only tools that change anything. Reading an agent's journal or memory is in the dashboard and the REST API, not in the MCP.

## Install

Claude Code:

```
claude plugin marketplace add Argentic-AI/argentic-plugins
claude plugin install argentic@argentic
```

Then run `/mcp` and sign in to `argentic`.

Docs: https://getargentic.com/docs. Privacy: https://getargentic.com/privacy. Terms: https://getargentic.com/terms.

MIT licensed.
