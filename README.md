# Lento plugin marketplace

> **Generated — do not edit here.** The source of truth is `plugin/lento/` in the private
> Lento monorepo; this repo is overwritten by that repo's `publish-plugin` workflow.

Published from monorepo commit `2d36be83db9dd5c14f29a98a4b83de8f25ed1432` (plugin version `0.1.13`).

## Install (Claude Code / Desktop / Cursor — macOS)

First install the Lento macOS helper `.pkg` from https://lento.press — it ships the printer
MCP server this plugin drives. Then, in your host:

```
/plugin marketplace add jake-mac/lento-plugin
/plugin install lento@lento-plugin
```

## Troubleshooting: "Couldn't start this server … Connection closed"

If your host says it can't start `lento` — but the tools still work in some sessions — you
almost certainly have a **second, older `lento` registration** left over from an earlier setup
that ran the server with `npx -y @lento/mcp`. That package was never published, so npm answers
`404` and the server dies before it can connect. The host's message names the server, not the
config file, which makes it look like this plugin is broken when it isn't.

Look for a stale entry in `~/Library/Application Support/Claude/claude_desktop_config.json`
(`mcpServers.lento`) and under a project key in `~/.claude.json`
(`projects["…"].mcpServers.lento`). The npm `404` itself is logged in
`~/Library/Logs/Claude/mcp-server-lento.log`.

**Fix:** delete that entry — this plugin registers `lento` for you. If you need to keep it,
replace it with `{ "command": "/usr/local/lento/lento-mcp" }` and remove its `env` block: the
launcher supplies the exchange URL and reads your key from the Keychain / config file the `.pkg`
wrote, so an `LENTO_MCP_KEY` there is redundant — and a plaintext secret on disk. Rotate it at
https://lento.press/mcp-keys if you find one, then restart your host.
