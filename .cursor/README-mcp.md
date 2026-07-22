# Workspace MCP config (`.cursor/mcp.json`)

`.cursor/mcp.json` is **not committed**. Paths differ per remote OS and user home, so shipping a fixed file (e.g. `/root/...`) breaks the other platform.

## How it gets created

When you open this folder in a **Remote SSH** Cursor window with jefr-cursor-ssh installed, the extension **auto-writes** workspace and global MCP config via `setupMcpConfig` / `getMcpServerPath()` (resolves `dist/mcp-server.mjs` from the installed extension).

After the first activate: **Reload Window** so Cursor picks up the written MCP path.

## Expected install roots

| Remote OS | Extension root | Data dir |
|-----------|----------------|----------|
| Linux | `~/.cursor-server/extensions/jefr.jefr-cursor-ssh-<ver>/` | `~/.moyu-message/<workspace-hash>/` |
| Windows | `%USERPROFILE%\.cursor-server\extensions\jefr.jefr-cursor-ssh-<ver>\` | `%USERPROFILE%\.moyu-message\<workspace-hash>\` |

Both use `os.homedir()` under the hood. MCP launches with `"command": "node"` — verify `node -v` on the remote.

## Manual fallback

Copy [`mcp.json.example`](mcp.json.example) to `mcp.json` and replace the placeholders, or run the jefr-cursor-ssh “Install MCP config” flow / reopen the folder so auto-setup runs.
