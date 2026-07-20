# jefr cursor

English-localized Cursor IDE extension for side-panel chat via **Model Context Protocol (MCP)**.

## Quick start

Current packaged build: **v1.1.1** (`multi-agent-ssh`).

See [QUICKSTART.txt](QUICKSTART.txt).

1. Install `jefr-cursor.vsix` or `extension/jefr-cursor-1.1.1.vsix` in Cursor Extensions
2. Restart Cursor
3. Enable **jefr cursor** under Settings → Tools & MCP
4. Send `Hello` once in native chat to start the loop
5. Continue from the **jefr cursor** bottom panel

**Remote SSH (Linux or Windows):** `git pull` on `multi-agent-ssh`, install the committed VSIX in the remote window — details in [docs/remote-ssh-response-log.md](docs/remote-ssh-response-log.md). Workspace `.cursor/mcp.json` is auto-written per OS (not committed).

## Repository layout

```
extension/
  dist/           Built extension + MCP server
  rules/          English MCP rules (mcp-messenger.mdc)
  HOW_IT_WORKS.md Architecture documentation
.cursor/rules/    Workspace copy of MCP rules (English)
```

## MCP rules

The plugin installs `.cursor/rules/mcp-messenger.mdc` into workspaces. The English version requires the AI to:

- Call `check_messages` after every reply
- Use `ask_question` when user input is required
- Use `send_progress` during multi-step tasks

Branch **`multi-agent-ssh`** adds a Remote-SSH path for the Obsidian Response Log via `publish_response_log` + port forward — see [docs/remote-ssh-response-log.md](docs/remote-ssh-response-log.md). Local-only use stays on **`multi-agent-local`**.

## License

See extension `package.json` (MIT).
