# Remote SSH — Linux or Windows VPS

Goal: open a **Remote SSH** folder from this repo, install jefr on the remote, and have **local Obsidian chat + Response Log** work without hand-rolled reverse tunnels.

## What runs where

| Capability | How it works |
|------------|--------------|
| Talk from **Obsidian (local)** to agent on **remote** | jefr on remote `:39517` auto-forwarded via `.vscode/settings.json` → local `:39518` |
| Agent updates **MCP Response Log** on local vault | MCP tool `publish_response_log` → file IPC on remote → extension WS → Obsidian writes vault |
| Cursor jefr panel on remote | Works with the extension alone |

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

**Obsidian plugin is not in this repo.** Install it from the local [`jefr-cursor`](https://github.com/rainfrog123/jefr-cursor) project (`obsidian-plugin/`).

## Paths by remote OS

`.cursor/mcp.json` is **not committed** (machine-specific). jefr **auto-writes** it on activate from the installed extension. See [`.cursor/README-mcp.md`](../.cursor/README-mcp.md).

| Remote OS | Extension root | Data dir |
|-----------|----------------|----------|
| Linux | `~/.cursor-server/extensions/jefr.jefr-cursor-3.0.0/` | `~/.moyu-message/<workspace-hash>/` |
| Windows | `%USERPROFILE%\.cursor-server\extensions\jefr.jefr-cursor-3.0.0\` | `%USERPROFILE%\.moyu-message\<workspace-hash>\` |

After first activate: **Reload Window** so MCP picks up the written path. Verify `node -v` on the remote — MCP uses `"command": "node"`.

If an old `.cursor/mcp.json` points at a missing VSIX folder (or a `/root/...` path on Windows), jefr rewrites it automatically on activate.

## Deploy to remote

Packaged VSIX files are committed so the remote can install without a local Node build.

```bash
# on the remote, in the jefr-cursor-ssh workspace
git pull --ff-only origin main

# install either packaged build (same extension; prefer the vsce one)
#   extension/jefr-cursor-3.0.0.vsix   — full vsce package
#   jefr-cursor.vsix                   — lighter python pack (QUICKSTART)
```

In the **Remote SSH** Cursor window: Extensions → `…` → **Install from VSIX…** → pick the file above → **Reload Window**.

### Example: Linux VPS

Workspace e.g. `/root/jefr-cursor-ssh`. After install + reload, mcp.json should resolve under `/root/.cursor-server/extensions/jefr.jefr-cursor-3.0.0/`.

### Example: Windows Remote SSH

Workspace e.g. `C:\Users\Lab\jefr-cursor-ssh`. After install + reload, mcp.json should resolve under `C:\Users\Lab\.cursor-server\extensions\jefr.jefr-cursor-3.0.0\`.

If you also keep another remote forwarded, give each remote a **different local port** (default here is **39518** for the first remote).

## One-time setup

1. **Local:** Obsidian with jefr plugin from `jefr-cursor/obsidian-plugin/` (host `127.0.0.1`, port **39518** when using the default forward).
2. **Remote:** Clone/pull this repo (`main`), install the committed VSIX in the Remote SSH window, enable jefr MCP, reload.
3. Confirm local can reach the remote jefr port:
   - Cursor should auto-forward **39517** → local **39518** (see `.vscode/settings.json`).
   - Or Ports view → forward `39517`.
   - Smoke: on local `curl -sS http://127.0.0.1:39518/api/status`
4. Obsidian → Online, send a test message.
5. Agent should call `publish_response_log` each turn; the vault note updates.

## Optional fallbacks

- **HTTP bridge** on Obsidian `:39527` + `RemoteForward 39527` — only if `publish_response_log` is missing (old build).
- Direct local-path write — only if the vault is mounted on the remote.

## Install checklist

- [ ] This repo on the remote workspace (`git pull` on `main`)
- [ ] VSIX **3.0.0** installed in the Remote SSH window (`extension/jefr-cursor-3.0.0.vsix` or root `jefr-cursor.vsix`)
- [ ] `.cursor/mcp.json` auto-written to this OS’s `.cursor-server` extension path
- [ ] jefr Cursor extension running in the remote window
- [ ] Port 39517 forwarded to local (auto → 39518, or Ports panel)
- [ ] Local Obsidian jefr Online (plugin from `jefr-cursor`, not this repo)
- [ ] MCP tools include `publish_response_log` (rebuild/reload if not)

## Rebuild (developers)

```bash
cd extension
npm run compile
npm run package          # → extension/jefr-cursor-3.0.0.vsix
cd .. && python pack_vsix.py   # → jefr-cursor.vsix
```

Commit both VSIX files + `extension/dist/` when shipping to remotes via `git pull`. Reload the Cursor window on the remote after installing so MCP picks up the new tool.
