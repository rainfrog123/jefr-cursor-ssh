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

## Deploy to VPS (fresh build)

Packaged VSIX files are committed on this branch so the VPS can install without a local Node build.

```bash
# on the VPS, in the jefr-cursor workspace
git fetch origin
git checkout multi-agent-ssh
git pull --ff-only origin multi-agent-ssh

# install either packaged build (same extension; prefer the vsce one)
#   extension/jefr-cursor-1.1.0.vsix   — full vsce package
#   jefr-cursor.vsix                   — lighter python pack (QUICKSTART)
```

In the **Remote SSH** Cursor window: Extensions → `…` → **Install from VSIX…** → pick the file above → **Reload Window**.

Workspace `.cursor/mcp.json` points at:

`/root/.cursor-server/extensions/jefr.jefr-cursor-1.1.0/dist/mcp-server.mjs`

After installing **1.1.0**, that path matches. If you keep an older install, bump the folder name in `.cursor/mcp.json` or reinstall the matching VSIX.

## One-time setup

1. **Windows:** Obsidian with jefr plugin enabled (vault already symlinks to this repo’s `obsidian-plugin/`).
2. **VPS:** Clone/checkout `multi-agent-ssh`, install the committed VSIX (see **Deploy to VPS**), open the folder in Cursor Remote SSH, enable jefr MCP, reload.
3. Confirm Windows can reach the remote jefr port:
   - Cursor should auto-forward **39517** → local **39518** (see `.vscode/settings.json`).
   - Or Ports view → forward `39517`.
   - Smoke: on Windows `curl -sS http://127.0.0.1:39518/api/status` (or `39517` if you forwarded 1:1)
4. Obsidian → Online, send a test message.
5. Agent should call `publish_response_log` each turn; the vault note updates.

## Optional fallbacks

- **HTTP bridge** on Obsidian `:39527` + `RemoteForward 39527` — only if `publish_response_log` is missing (old build).
- Direct Windows path write — only if the vault is mounted on the remote.

## Install checklist

- [ ] Branch `multi-agent-ssh` on the VPS workspace (`git pull` latest)
- [ ] VSIX **1.1.0** installed in the Remote SSH window (`extension/jefr-cursor-1.1.0.vsix` or root `jefr-cursor.vsix`)
- [ ] `.cursor/mcp.json` path matches `jefr.jefr-cursor-1.1.0`
- [ ] jefr Cursor extension running in the remote window
- [ ] Port 39517 forwarded to local (auto → 39518, or Ports panel)
- [ ] Obsidian jefr Online
- [ ] MCP tools include `publish_response_log` (rebuild/reload if not)

## Rebuild (developers)

```bash
cd extension
npm run compile
npm run package          # → extension/jefr-cursor-1.1.0.vsix
cd .. && python pack_vsix.py   # → jefr-cursor.vsix
```

Commit both VSIX files + `extension/dist/` when shipping to the VPS via `git pull`. Reload the Cursor window on the VPS after installing so MCP picks up the new tool.
