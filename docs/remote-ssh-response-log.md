# Remote SSH — out of the box (multi-agent-ssh)

Goal: open the remote folder on branch **`multi-agent-ssh`**, install jefr, and have **local Obsidian chat + Response Log** work without hand-rolled reverse tunnels.

## What “open the box” means

| Capability | How it works |
|------------|--------------|
| Talk from **Obsidian (Windows)** to agent on **VPS** | jefr server on VPS `:39517` auto-forwarded to Windows via `.vscode/settings.json` |
| Agent updates **MCP Response Log** on Windows | MCP tool `publish_response_log` → file IPC on VPS → extension WS → Obsidian writes vault |
| Cursor jefr panel on remote | Works with the extension alone (no Obsidian needed) |

```
Windows Obsidian ──WS :39517──► (Cursor LocalForward / defaultForwardedPorts)
                                      │
                                      ▼
                               VPS jefr extension :39517
                                      │
                         queue / reply / response-log.json
                                      │
                               VPS MCP + Cursor agent

Agent publish_response_log ──► response-log.json ──► WS responseLog ──► Obsidian vault write
```

## One-time setup

1. **Windows:** Obsidian with jefr plugin enabled (vault already symlinks to this repo’s `obsidian-plugin/`).
2. **VPS:** Clone/checkout `multi-agent-ssh`, open in Cursor Remote SSH, install/enable the jefr extension, reload MCP.
3. Confirm Windows can reach the remote jefr port:
   - Cursor should auto-forward **39517** (see `.vscode/settings.json`).
   - Or Ports view → forward `39517`.
   - Smoke: on Windows `curl -sS http://127.0.0.1:39517/api/status`
4. Obsidian → Online, send a test message.
5. Agent should call `publish_response_log` each turn; the vault note updates.

## Optional fallbacks

- **HTTP bridge** on Obsidian `:39527` + `RemoteForward 39527` — only if `publish_response_log` is missing (old build).
- Direct Windows path write — only if the vault is mounted on the remote.

## Install checklist

- [ ] Branch `multi-agent-ssh` on the VPS workspace
- [ ] jefr Cursor extension running in the remote window
- [ ] Port 39517 forwarded to local (auto or Ports panel)
- [ ] Obsidian jefr Online
- [ ] MCP tools include `publish_response_log` (rebuild/reload if not)

## Rebuild (developers)

```bash
cd extension && npm run compile
```

Reload the Cursor window on the VPS after compiling so MCP picks up the new tool.
