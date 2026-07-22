# jefr cursor (Remote SSH)

English-localized Cursor IDE extension for side-panel chat via **Model Context Protocol (MCP)**, with **Remote SSH** support for Linux and Windows remotes.

Split from [`jefr-cursor`](https://github.com/rainfrog123/jefr-cursor) (`multi-agent-ssh`). For local-only use, see that repo’s `multi-agent-local` branch.

## Quick start

Current packaged build: **v1.1.1**.

See [QUICKSTART.txt](QUICKSTART.txt).

1. Install `jefr-cursor.vsix` or `extension/jefr-cursor-1.1.1.vsix` in Cursor Extensions
2. Restart Cursor
3. Enable **jefr cursor** under Settings → Tools & MCP
4. Send `Hello` once in native chat to start the loop
5. Continue from the **jefr cursor** bottom panel

**Remote SSH (Linux or Windows):** install the committed VSIX in the remote window — details in [docs/remote-ssh-response-log.md](docs/remote-ssh-response-log.md). Workspace `.cursor/mcp.json` is auto-written per OS (not committed).

## Repository layout

```
extension/
  dist/           Built extension + MCP server
  rules/          English MCP rules (mcp-messenger.mdc)
  HOW_IT_WORKS.md Architecture documentation
.cursor/rules/    Workspace copy of MCP rules (English)
docs/             Remote SSH Response Log bridge notes
```

## MCP rules

The plugin installs `.cursor/rules/mcp-messenger.mdc` into workspaces. The English version requires the AI to:

- Call `check_messages` after every reply
- Use `ask_question` when user input is required
- Use `send_progress` during multi-step tasks

Remote SSH uses `publish_response_log` + port forward for the Obsidian Response Log — see [docs/remote-ssh-response-log.md](docs/remote-ssh-response-log.md).

## License

See extension `package.json` (MIT).
