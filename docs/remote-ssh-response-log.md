# Remote SSH — Linux or Windows (multi-agent-ssh)

Goal: open a **Remote SSH** folder on branch **`multi-agent-ssh`**, install jefr, and have **local Obsidian chat + Response Log** work without hand-rolled reverse tunnels — whether the remote is **Linux** or **Windows**.

## What “open the box” means

| Capability | How it works |
|------------|--------------|
| Talk from **Obsidian (local)** to agent on **remote** | jefr on remote `:39517` auto-forwarded via `.vscode/settings.json` |
| Agent updates **MCP Response Log** on local vault | MCP tool `publish_response_log` → file IPC on remote → extension WS → Obsidian writes vault |
| Cursor jefr panel on remote | Works with the extension alone (no Obsidian needed) |

```
Local Obsidian ──WS :39518──► (Cursor LocalForward / defaultForwardedPorts)
                                      │
                                      ▼
                         Remote jefr extension :39517  (Linux or Windows)
                                      │
                         queue / reply / response-log.json
                                      │
                         Remote MCP + Cursor agent

Agent publish_response_log ──► response-log.json ──► WS responseLog ──► Obsidian vault write
```

## Paths by remote OS

`.cursor/mcp.json` is **not committed** (machine-specific). jefr **auto-writes** it on activate from the installed extension. See [`.cursor/README-mcp.md`](../.cursor/README-mcp.md).

| Remote OS | Extension root | Data dir |
|-----------|----------------|----------|
| Linux | `~/.cursor-server/extensions/jefr.jefr-cursor-1.1.1/` | `~/.moyu-message/<workspace-hash>/` |
| Windows | `%USERPROFILE%\.cursor-server\extensions\jefr.jefr-cursor-1.1.1\` | `%USERPROFILE%\.moyu-message\<workspace-hash>\` |

After first activate: **Reload Window** so MCP picks up the written path. Verify `node -v` on the remote — MCP uses `"command": "node"`.

If an old `.cursor/mcp.json` points at a missing VSIX folder (or a `/root/...` path on Windows), jefr rewrites it automatically on activate.

## Deploy to remote (fresh build)

Packaged VSIX files are committed on this branch so the remote can install without a local Node build.

```bash
# on the remote, in the jefr-cursor workspace
git fetch origin
git checkout multi-agent-ssh
git pull --ff-only origin multi-agent-ssh

# install either packaged build (same extension; prefer the vsce one)
#   extension/jefr-cursor-1.1.1.vsix   — full vsce package
#   jefr-cursor.vsix                   — lighter python pack (QUICKSTART)
```

In the **Remote SSH** Cursor window: Extensions → `…` → **Install from VSIX…** → pick the file above → **Reload Window**.

### Example: Linux VPS (`ali_sg`)

Workspace e.g. `/root/jefr-cursor`. After install + reload, mcp.json should resolve under `/root/.cursor-server/extensions/jefr.jefr-cursor-1.1.1/`.

### Example: Windows Remote SSH (e.g. VMware guest)

Workspace e.g. `C:\Users\Lab\jefr-cursor`. After install + reload, mcp.json should resolve under `C:\Users\Lab\.cursor-server\extensions\jefr.jefr-cursor-1.1.1\`.

If you also keep a Linux remote forwarded, give each remote a **different local port** (default here is **39518** for the first remote).

## One-time setup

1. **Local:** Obsidian with jefr plugin enabled (vault already symlinks to this repo’s `obsidian-plugin/`).
2. **Remote (Linux or Windows):** Clone/checkout `multi-agent-ssh`, install the committed VSIX, open the folder in Cursor Remote SSH, enable jefr MCP, reload.
3. Confirm local can reach the remote jefr port:
   - Cursor should auto-forward **39517** → local **39518** (see `.vscode/settings.json`).
   - Or Ports view → forward `39517`.
   - Smoke: on local `curl -sS http://127.0.0.1:39518/api/status` (or `39517` if you forwarded 1:1)
4. Obsidian → Online, send a test message.
5. Agent should call `publish_response_log` each turn; the vault note updates.

## Optional fallbacks

- **HTTP bridge** on Obsidian `:39527` + `RemoteForward 39527` — only if `publish_response_log` is missing (old build).
- Direct local-path write — only if the vault is mounted on the remote.

## Install checklist

- [ ] Branch `multi-agent-ssh` on the remote workspace (`git pull` latest)
- [ ] VSIX **1.1.1** installed in the Remote SSH window (`extension/jefr-cursor-1.1.1.vsix` or root `jefr-cursor.vsix`)
- [ ] `.cursor/mcp.json` auto-written to this OS’s `.cursor-server` extension path (not a foreign `/root/...` on Windows)
- [ ] jefr Cursor extension running in the remote window
- [ ] Port 39517 forwarded to local (auto → 39518, or Ports panel)
- [ ] Obsidian jefr Online
- [ ] MCP tools include `publish_response_log` (rebuild/reload if not)

## Rebuild (developers)

```bash
cd extension
npm run compile
npm run package          # → extension/jefr-cursor-1.1.1.vsix
cd .. && python pack_vsix.py   # → jefr-cursor.vsix
```

Commit both VSIX files + `extension/dist/` when shipping to remotes via `git pull`. Reload the Cursor window on the remote after installing so MCP picks up the new tool.
