# jefr cursor (Remote SSH / VPS)

Cursor IDE extension for side-panel chat via **Model Context Protocol (MCP)**, meant to run on a **Remote SSH** host (Linux or Windows VPS) while you talk from **local Obsidian**.

Split from [`jefr-cursor`](https://github.com/rainfrog123/jefr-cursor). Local-only day-to-day work stays there (`multi-agent-local`).

## Roles

| Where | What |
|-------|------|
| **This repo (VPS)** | jefr Cursor extension + MCP + port forward (`:39517`) |
| **Local `jefr-cursor`** | Obsidian plugin (`obsidian-plugin/`) — install into your vault |

```
Local Obsidian ──WS :39518──► Cursor port forward
                                      │
                                      ▼
                         Remote jefr extension :39517
                                      │
                         MCP + Cursor agent on VPS
```

## Quick start (on the VPS)

Current packaged build: **v1.0.0**.

See [QUICKSTART.txt](QUICKSTART.txt) and [docs/remote-ssh-response-log.md](docs/remote-ssh-response-log.md).

1. Clone/pull this repo on the remote
2. In the **Remote SSH** Cursor window: Extensions → **Install from VSIX…** → `extension/jefr-cursor-1.0.0.vsix` (or root `jefr-cursor.vsix`)
3. Reload Window; enable **jefr** under Settings → Tools & MCP
4. Confirm local port forward **39517 → 39518** (see `.vscode/settings.json`)
5. On the local machine: Obsidian plugin from `jefr-cursor` → Online → send a test message

## Repository layout

```
extension/          Extension source, dist, MCP server, packaged VSIX
.vscode/            Remote SSH port forward defaults
.cursor/            MCP rules + mcp.json.example (mcp.json is auto-written)
docs/               Remote SSH Response Log bridge notes
```

## MCP rules

The plugin installs `.cursor/rules/mcp-messenger.mdc` into workspaces. Agents must:

- Call `check_messages` after every reply
- Use `ask_question` when user input is required
- Use `send_progress` during multi-step tasks
- Call `publish_response_log` so local Obsidian can write the Response Log note

## License

See extension `package.json` (MIT).
