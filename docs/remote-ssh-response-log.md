# Remote SSH → Windows MCP Response Log

Branch **`multi-agent-ssh`** is meant for Cursor **Remote SSH** agents that still need to overwrite the Obsidian note on your Windows PC:

`C:\Users\jar71\obsidian\Tech\Meta\MCP Response Log.md`

Local-only work stays on **`multi-agent`** (direct filesystem write).

## Why a bridge?

On Remote SSH, the agent runs on the remote host. That machine usually cannot write your Windows vault path. The **Obsidian jefr plugin** (on Windows) therefore exposes a localhost HTTP bridge that writes the vault file.

## Architecture

```
Remote Cursor agent
    │  POST http://127.0.0.1:39527/response-log
    │  {"markdown":"..."}
    ▼
SSH RemoteForward 39527 → Windows 127.0.0.1:39527
    ▼
Obsidian jefr plugin (Windows)
    ▼
Vault: Tech/Meta/MCP Response Log.md
```

## Setup

### 1. Windows — Obsidian plugin

1. Install/update `obsidian-plugin/` into `<vault>/.obsidian/plugins/jefr-chat/`.
2. Enable **jefr** in Obsidian.
3. Settings → **Remote SSH response-log bridge**:
   - Enable log bridge: **on**
   - Port: `39527` (default)
   - Optional token if you want auth
4. Click **Write test** and confirm the Response Log note updates.

### 2. SSH / Cursor RemoteForward

Forward remote localhost:39527 to Windows localhost:39527.

**OpenSSH `~/.ssh/config` on the machine that initiates the SSH session (usually Windows):**

```sshconfig
Host my-remote
  HostName example.com
  User you
  RemoteForward 39527 127.0.0.1:39527
```

**Cursor:** the same `RemoteForward` in the SSH config Cursor uses for that host is enough. After connecting, on the remote run:

```bash
curl -sS http://127.0.0.1:39527/health
```

You should see JSON with `"ok": true`.

### 3. Agent rules

This branch’s `.cursor/rules/mcp-messenger.mdc` tells the agent to POST the rich reply to:

- `JEFR_LOG_BRIDGE_URL` if set, else `http://127.0.0.1:39527/response-log`
- Optional `JEFR_LOG_BRIDGE_TOKEN` → `X-Jefr-Token` header

## API

### `GET /health`

Returns bridge status and configured vault-relative path.

### `POST /response-log`

Body (preferred):

```json
{ "markdown": "# Title\n\nFull note…" }
```

Also accepts `{ "content": "…" }`, `{ "text": "…" }`, or raw `text/markdown`.

Response:

```json
{ "ok": true, "path": "Tech/Meta/MCP Response Log.md", "bytes": 1234 }
```

## Security notes

- Bridge binds **`127.0.0.1` only** on Windows.
- Reachability from the remote depends on **SSH RemoteForward**, not a LAN open port.
- Set an optional token if multiple users share the Windows machine.

## Troubleshooting

| Symptom | Check |
|---------|--------|
| `curl: connection refused` on remote | RemoteForward missing / Obsidian closed / bridge disabled |
| `401 Unauthorized` | Token mismatch (`JEFR_LOG_BRIDGE_TOKEN` vs plugin setting) |
| Health OK but note unchanged | Wrong vault, or `MCP log path` setting doesn’t match |
| Port in use | Change bridge port in Obsidian and match RemoteForward |
