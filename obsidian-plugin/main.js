"use strict";

/**
 * jefr — Obsidian chat plugin.
 *
 * A faithful port of the jefr Cursor side-panel input area, living inside
 * Obsidian. It connects to the jefr VS Code extension's local WebSocket server
 * (default ws://127.0.0.1:39517) and speaks the exact same protocol the
 * built-in Remote Console uses, so everything you send here flows through the
 * SAME message queue your Cursor agent reads — and shows up in the jefr panel
 * inside Cursor as well.
 *
 * Protocol (server -> client):
 *   { type: "init" | "stateUpdate", queue, queueCount, reply, question, workspace, wsClients, port, ... }
 *   { type: "queueUpdate", count }
 *   { type: "pong" }
 * Protocol (client -> server):
 *   { type: "sendText", text }
 *   { type: "submitAnswer", data: { id, answers: [{ questionId, selected, other }] } }
 *   { type: "cancelQuestion" }
 *   { type: "ackReply" }
 *   { type: "ping" }
 */

const { Plugin, ItemView, PluginSettingTab, Setting, MarkdownRenderer, Notice, setIcon } = require("obsidian");

const VIEW_TYPE_JEFR = "jefr-chat-view";

const DEFAULT_SETTINGS = {
  host: "127.0.0.1",
  port: 39517,
  autoReconnect: true,
  maxHistory: 400,
  minimized: false,
  // Fire a native OS (Windows) notification whenever the MCP Response Log is
  // rewritten by the agent. Path is vault-relative (forward slashes).
  notifyOnLogRewrite: true,
  logNotifyPath: "Tech/Meta/MCP Response Log.md",
  // HTTP bridge so a Remote-SSH agent can POST markdown and have THIS Windows
  // Obsidian process overwrite the Response Log (via SSH RemoteForward).
  logBridgeEnabled: true,
  logBridgePort: 39527,
  // Optional shared secret. Empty = no auth (ok for 127.0.0.1 + tunnel only).
  logBridgeToken: "",
};

const LOG_BRIDGE_MAX_BYTES = 2 * 1024 * 1024;

/* ------------------------------------------------------------------ */
/* Plugin entry                                                        */
/* ------------------------------------------------------------------ */

class JefrPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    this.registerView(VIEW_TYPE_JEFR, (leaf) => new JefrView(leaf, this));

    this.addRibbonIcon("messages-square", "Open jefr chat", () => {
      this.activateView();
    });

    this.addCommand({
      id: "open-jefr-chat",
      name: "Open jefr chat",
      callback: () => this.activateView(),
    });

    // Focus-independent way to attach the clipboard image (bind a hotkey to it,
    // e.g. Ctrl+Shift+V). Works even when a note has focus.
    this.addCommand({
      id: "attach-clipboard-image",
      name: "Attach image from clipboard",
      callback: async () => {
        try {
          let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_JEFR)[0];
          if (!leaf) {
            await this.activateView();
            leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_JEFR)[0];
          }
          const view = leaf && leaf.view;
          if (view && typeof view.tryClipboardImage === "function") {
            this.app.workspace.revealLeaf(leaf);
            const ok = await view.tryClipboardImage();
            if (!ok) new Notice("jefr: no image found in clipboard");
          } else {
            new Notice("jefr: open the jefr panel first, then retry");
          }
        } catch {
          /* ignore */
        }
      },
    });

    this.addCommand({
      id: "toggle-compact-mode",
      name: "Toggle compact mode",
      callback: async () => {
        this.settings.minimized = !this.settings.minimized;
        await this.saveData(this.settings);
        this.app.workspace.getLeavesOfType(VIEW_TYPE_JEFR).forEach((leaf) => {
          if (leaf.view instanceof JefrView) leaf.view.applyMinimized();
        });
      },
    });

    this.addSettingTab(new JefrSettingTab(this.app, this));

    // Watch the vault for the MCP Response Log being rewritten and raise a
    // native OS notification. Obsidian fires "modify" for external writes too,
    // so this catches the agent overwriting the file from outside Obsidian.
    this._lastLogNotifyAt = 0;
    void ensureNotificationPermission();
    this.registerEvent(
      this.app.vault.on("modify", (file) => this.onVaultModify(file)),
    );

    this._logBridgeServer = null;
    this.startLogBridge();
  }

  onunload() {
    this.stopLogBridge();
    // Views detach themselves and close their sockets via onClose().
  }

  /** Start (or restart) the localhost Response Log HTTP bridge. */
  startLogBridge() {
    this.stopLogBridge();
    if (!this.settings.logBridgeEnabled) return;

    let http;
    try {
      http = require("http");
    } catch (e) {
      console.error("[jefr] log bridge: http module unavailable", e);
      return;
    }

    const port = Number(this.settings.logBridgePort) || 39527;
    const server = http.createServer((req, res) => {
      void this.handleLogBridgeRequest(req, res);
    });
    server.on("error", (err) => {
      console.error("[jefr] log bridge listen error:", err && err.message);
      new Notice(`jefr log bridge failed: ${err && err.message ? err.message : err}`);
    });
    try {
      server.listen(port, "127.0.0.1", () => {
        console.log(`[jefr] response-log bridge on http://127.0.0.1:${port}`);
      });
      this._logBridgeServer = server;
    } catch (e) {
      console.error("[jefr] log bridge start failed", e);
    }
  }

  stopLogBridge() {
    const server = this._logBridgeServer;
    this._logBridgeServer = null;
    if (!server) return;
    try {
      server.close();
    } catch {
      /* ignore */
    }
  }

  /** HTTP handler: GET /health, POST /response-log → vault Response Log write. */
  async handleLogBridgeRequest(req, res) {
    const sendJson = (code, obj) => {
      const body = JSON.stringify(obj);
      res.writeHead(code, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Jefr-Token",
      });
      res.end(body);
    };

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Jefr-Token",
      });
      res.end();
      return;
    }

    const url = (req.url || "").split("?")[0];
    if (req.method === "GET" && (url === "/health" || url === "/")) {
      sendJson(200, {
        ok: true,
        service: "jefr-response-log-bridge",
        path: this.settings.logNotifyPath,
        port: this.settings.logBridgePort,
      });
      return;
    }

    if (req.method === "POST" && url === "/response-log") {
      const token = (this.settings.logBridgeToken || "").trim();
      if (token) {
        const auth = String(req.headers["authorization"] || "");
        const headerTok = String(req.headers["x-jefr-token"] || "");
        const bearer = auth.toLowerCase().startsWith("bearer ")
          ? auth.slice(7).trim()
          : "";
        if (headerTok !== token && bearer !== token) {
          sendJson(401, { ok: false, error: "Unauthorized" });
          return;
        }
      }

      let raw = "";
      let aborted = false;
      req.on("data", (chunk) => {
        if (aborted) return;
        raw += chunk;
        if (raw.length > LOG_BRIDGE_MAX_BYTES) {
          aborted = true;
          sendJson(413, { ok: false, error: "Payload too large" });
          req.destroy();
        }
      });
      req.on("end", async () => {
        if (aborted) return;
        try {
          const markdown = parseLogBridgeBody(raw, req.headers["content-type"]);
          if (typeof markdown !== "string" || !markdown.trim()) {
            sendJson(400, { ok: false, error: "Missing markdown body" });
            return;
          }
          const rel = (this.settings.logNotifyPath || "").trim() || "Tech/Meta/MCP Response Log.md";
          await writeVaultMarkdown(this.app, rel, markdown);
          sendJson(200, { ok: true, path: rel, bytes: Buffer.byteLength(markdown, "utf8") });
        } catch (e) {
          console.error("[jefr] log bridge write failed", e);
          sendJson(500, {
            ok: false,
            error: e && e.message ? e.message : String(e),
          });
        }
      });
      return;
    }

    sendJson(404, { ok: false, error: "Not Found" });
  }

  /** Vault "modify" handler — fire an OS notification when the configured
   *  MCP Response Log file changes. Debounced so one rewrite = one toast. */
  onVaultModify(file) {
    if (!this.settings.notifyOnLogRewrite || !file || !file.path) return;
    const target = (this.settings.logNotifyPath || "").trim();
    if (!target) return;

    const norm = (p) => p.replace(/\\/g, "/").toLowerCase();
    const fp = norm(file.path);
    const tp = norm(target);
    // Match the configured vault-relative path, or fall back to basename so a
    // mis-set folder still works as long as the filename matches.
    const baseOf = (p) => p.slice(p.lastIndexOf("/") + 1);
    const matches = fp === tp || fp.endsWith("/" + tp) || baseOf(fp) === baseOf(tp);
    if (!matches) return;

    const now = Date.now();
    if (now - (this._lastLogNotifyAt || 0) < 800) return; // debounce double-fires
    this._lastLogNotifyAt = now;

    showOsNotification("MCP Response Log updated", {
      body: (file.basename || baseOf(file.path)) + " was just rewritten by the agent.",
      onClick: () => {
        try {
          this.app.workspace.openLinkText(file.path, "", false);
        } catch {
          /* ignore */
        }
      },
    });
  }

  async saveSettings() {
    await this.saveData(this.settings);
    // Let any open view react to host/port changes.
    this.app.workspace.getLeavesOfType(VIEW_TYPE_JEFR).forEach((leaf) => {
      const view = leaf.view;
      if (view instanceof JefrView) view.onSettingsChanged();
    });
    // Bridge bind settings may have changed.
    this.startLogBridge();
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_JEFR)[0];
    if (!leaf) {
      // Open in the main editor area as a new tab (not the right sidebar).
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_JEFR, active: true });
    }
    workspace.revealLeaf(leaf);
  }
}

/* ------------------------------------------------------------------ */
/* The chat view                                                       */
/* ------------------------------------------------------------------ */

class JefrView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;

    this.ws = null;
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.reconnectAttempts = 0;
    this.manualClose = false;

    // De-dupe / render bookkeeping.
    this.lastReplyTs = null;
    this.currentQuestionId = null;
    this.selected = {}; // questionId -> string[]
    this.connStatus = "offline";
    this.attachments = []; // staged images: { id, name, dataUrl }
    this._progressHideTimer = null;
    this.lastQueue = [];
    this.queueOpen = false;
    this.renderedIds = new Set(); // shared-history item ids already shown
  }

  getViewType() {
    return VIEW_TYPE_JEFR;
  }

  getDisplayText() {
    return "jefr";
  }

  getIcon() {
    return "messages-square";
  }

  async onOpen() {
    this.buildUI();
    this.connect();
  }

  async onClose() {
    this.manualClose = true;
    this.teardownSocket();
  }

  onSettingsChanged() {
    // Reconnect to the (possibly) new host/port.
    this.teardownSocket();
    this.reconnectAttempts = 0;
    this.connect();
  }

  /* ----------------------------- UI ------------------------------ */

  buildUI() {
    const root = this.contentEl;
    root.empty();
    root.addClass("jefr-root");

    // Scrollable region: header + status + messages all scroll together, so the
    // header scrolls away as you scroll down. The composer stays pinned below.
    const scroll = root.createDiv({ cls: "jefr-scroll" });
    this.scrollEl = scroll;

    // Header
    const header = scroll.createDiv({ cls: "jefr-header" });
    this.headerEl = header;
    const brand = header.createDiv({ cls: "jefr-brand" });
    brand.createSpan({ cls: "jefr-logo", text: "jefr" });
    // The agent route picker now lives down with the composer (see below) so it's
    // always next to where you type. These just hold the picker state.
    this.liveAgents = [];
    this.selectedAgentId = null;
    this.statusPill = brand.createSpan({ cls: "jefr-status jefr-status-offline", text: "Offline" });
    // Distinct from the connection pill: this reflects whether a Cursor agent is
    // actually running the perpetual loop (heartbeat), not just that the socket
    // is open. "Listening" = will pick up your message now; "Busy" = mid-task,
    // messages queue; "No agent" = nothing is draining the queue.
    this.agentPill = brand.createSpan({ cls: "jefr-agent jefr-agent-idle", text: "No agent" });
    this.agentPill.setAttr("title", "Whether a Cursor agent is actively listening");

    const headerRight = header.createDiv({ cls: "jefr-header-right" });
    this.queueBadge = headerRight.createSpan({ cls: "jefr-queue-badge", text: "" });
    this.queueBadge.onclick = () => this.toggleQueuePanel();
    this.reconnectBtn = headerRight.createEl("button", { cls: "jefr-icon-btn jefr-reconnect-btn", attr: { "aria-label": "Reconnect" } });
    setIcon(this.reconnectBtn, "refresh-cw");
    this.reconnectBtn.onclick = () => {
      this.teardownSocket();
      this.reconnectAttempts = 0;
      this.connect();
    };

    // Collapsible panel listing the queued (pending) messages. Toggled by
    // clicking the queue badge. Smoothly expands/collapses.
    this.queuePanel = scroll.createDiv({ cls: "jefr-queue-panel" });
    this.queueOpen = false;

    // Progress bar (driven by send_progress percent).
    this.progressWrap = scroll.createDiv({ cls: "jefr-progress" });
    this.progressWrap.style.display = "none";
    const progressTrack = this.progressWrap.createDiv({ cls: "jefr-progress-track" });
    this.progressFill = progressTrack.createDiv({ cls: "jefr-progress-fill" });
    this.progressLabel = this.progressWrap.createDiv({ cls: "jefr-progress-label" });

    this.workspaceLine = scroll.createDiv({ cls: "jefr-workspace" });
    this.workspaceLine.setText("");

    // Messages
    this.messagesEl = scroll.createDiv({ cls: "jefr-messages" });
    this.renderEmptyState();

    // Question card mount point (above the composer)
    this.questionEl = scroll.createDiv({ cls: "jefr-question-host" });

    // Composer (inside the scroll region so the header can scroll away above it)
    const composer = scroll.createDiv({ cls: "jefr-composer" });
    this.composerEl = composer;
    // Agent route picker pinned with the composer: see/switch which agent your
    // message routes to right where you type. Click it (or use Ctrl/Cmd+PageUp/
    // PageDown while focused in the box) to change the target.
    const routeBar = composer.createDiv({ cls: "jefr-composer-route" });
    this.routeLabel = routeBar.createSpan({
      cls: "jefr-route jefr-route-idle",
      attr: { role: "button", tabindex: "0" },
    });
    this.routeLabel.setAttr("title", "Choose which agent this message routes to");
    this.routeNameEl = this.routeLabel.createSpan({ cls: "jefr-route-name", text: "" });
    this.routeModelEl = this.routeLabel.createSpan({ cls: "jefr-route-model", text: "" });
    this.routeLabel.createSpan({ cls: "jefr-route-caret", text: "▾" });
    this.routeLabel.onclick = (e) => {
      e.stopPropagation();
      this.toggleAgentMenu();
    };
    this.routeLabel.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this.toggleAgentMenu();
      }
    });
    // Dropdown of live agents, opening upward from the composer.
    this.agentMenu = routeBar.createDiv({ cls: "jefr-agent-menu" });
    // Expand/compact toggle sits on this row (right side), so the redundant "jefr"
    // header can be hidden in compact mode — Obsidian already labels the pane.
    this.minimizeBtn = routeBar.createEl("button", { cls: "jefr-icon-btn jefr-minimize-btn", attr: { "aria-label": "Toggle compact mode" } });
    this.minimizeBtn.onclick = () => this.toggleMinimized();
    this.updateRouteLabel();
    this.attachBar = composer.createDiv({ cls: "jefr-attachbar" });
    this.input = composer.createEl("textarea", {
      cls: "jefr-input",
      attr: {
        placeholder: "Message your Cursor agent…  (Enter to send, Shift+Enter newline, paste an image)",
        rows: "3",
        spellcheck: "false",
        autocorrect: "off",
        autocapitalize: "off",
        autocomplete: "off",
      },
    });
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.doSend();
      } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.doSend();
      } else if (e.key === "ArrowUp" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Shell-style history recall: Up brings back the previous sent message.
        // Only hijacks Up when the caret is at the very start (or input empty),
        // or once we're already navigating history, so multi-line editing works.
        const hist = this.sentHistory || [];
        const inHistory = this.historyIndex != null && this.historyIndex !== -1;
        const caretAtStart = this.input.selectionStart === 0 && this.input.selectionEnd === 0;
        if (hist.length && (this.input.value === "" || caretAtStart || inHistory)) {
          e.preventDefault();
          this.recallHistory(-1);
        }
      } else if (e.key === "ArrowDown" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (this.historyIndex != null && this.historyIndex !== -1) {
          e.preventDefault();
          this.recallHistory(1);
        }
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "v" || e.key === "V")) {
        // Try every clipboard method; if none yields an image, fall back to
        // absorbing any ![[..]] embed Obsidian may insert.
        this.tryClipboardImage().then((ok) => {
          if (!ok) window.setTimeout(() => this.absorbEmbeds(), 60);
        });
      }
    });
    this.input.addEventListener("input", () => {
      // Real typing leaves history-navigation mode (programmatic value sets in
      // recallHistory don't fire 'input', so they won't reset this).
      this.historyIndex = -1;
      this.updateSendState();
    });
    // Capture phase so we see the paste before Obsidian's global handler can
    // swallow it; bubble phase as a backup.
    this.input.addEventListener("paste", (e) => this.onPaste(e), true);
    this.input.addEventListener("paste", (e) => this.onPaste(e));

    // Drag & drop images/files onto the composer.
    composer.addEventListener("dragover", (e) => {
      e.preventDefault();
      composer.addClass("jefr-dragover");
    });
    composer.addEventListener("dragleave", () => composer.removeClass("jefr-dragover"));
    composer.addEventListener("drop", (e) => {
      e.preventDefault();
      composer.removeClass("jefr-dragover");
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) this.ingestFiles(Array.from(files));
    });

    const toolbar = composer.createDiv({ cls: "jefr-toolbar" });
    const leftActions = toolbar.createDiv({ cls: "jefr-actions-left" });
    this.attachBtn = leftActions.createEl("button", { cls: "jefr-icon-btn", attr: { "aria-label": "Attach / paste image" } });
    setIcon(this.attachBtn, "image-plus");
    this.attachBtn.onclick = () => this.onAttachClick();
    this.hint = leftActions.createSpan({ cls: "jefr-hint", text: "Enter to send" });

    // Hidden file input for the attach button. Use a visually-hidden style
    // (not display:none) so the programmatic click reliably opens the dialog.
    this.fileInput = composer.createEl("input", { cls: "jefr-fileinput", attr: { type: "file", accept: "image/*", multiple: "true" } });
    this.fileInput.addEventListener("change", () => {
      const files = this.fileInput.files ? Array.from(this.fileInput.files) : [];
      if (files.length) this.ingestFiles(files);
      this.fileInput.value = "";
    });

    const actions = toolbar.createDiv({ cls: "jefr-actions" });
    this.clearBtn = actions.createEl("button", { cls: "jefr-btn jefr-btn-ghost", text: "Clear" });
    this.clearBtn.onclick = () => this.clearHistory();
    this.sendBtn = actions.createEl("button", { cls: "jefr-btn jefr-btn-send", text: "Send" });
    this.sendBtn.onclick = () => this.doSend();

    // Document-level capture paste: Obsidian's global handler otherwise routes a
    // pasted image into the active note. When our input is focused, grab it first.
    this.registerDomEvent(
      document,
      "paste",
      (e) => {
        if (this.isComposerFocused()) this.onPaste(e);
      },
      true
    );

    // Ctrl/Cmd + PageUp / PageDown switches the active ("talking-to") agent while
    // the composer is focused. A window capture-phase keydown (fires before any
    // document/element listener, so it can beat Obsidian's default tab hotkey),
    // gated to when the composer has focus. It does NOT push a keymap scope, so it
    // can't affect textarea focus (which the earlier scope approach did).
    this.registerDomEvent(
      window,
      "keydown",
      (e) => {
        if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
        if (e.key !== "PageUp" && e.key !== "PageDown") return;
        if (!this.isComposerFocused()) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        this.cycleAgent(e.key === "PageDown" ? 1 : -1);
      },
      true
    );

    // Dock the header together with the composer at the bottom, below the
    // scrollable conversation, so the brand/status/controls and the input read as
    // one integrated block. (The elements were built inside `scroll`; move them.)
    const dock = root.createDiv({ cls: "jefr-dock" });
    dock.appendChild(this.headerEl);
    // Keep the Q&A card in the dock (above the composer) so ask_question is still
    // shown in compact mode, where the scrollable conversation is hidden.
    dock.appendChild(this.questionEl);
    dock.appendChild(this.composerEl);

    this.applyMinimized();
    this.updateSendState();
  }

  isComposerFocused() {
    const active = document.activeElement;
    return active === this.input || (this.input && this.input.contains(active));
  }

  onAttachClick() {
    // Open the picker synchronously to preserve the user gesture (an await here
    // would make Electron block the file dialog).
    if (this.fileInput) this.fileInput.click();
  }

  applyMinimized() {
    const on = !!this.plugin.settings.minimized;
    if (this.contentEl) this.contentEl.toggleClass("jefr-minimized", on);
    if (this.minimizeBtn) {
      this.minimizeBtn.empty();
      setIcon(this.minimizeBtn, on ? "maximize-2" : "minimize-2");
      this.minimizeBtn.setAttr("aria-label", on ? "Expand" : "Compact mode");
    }
    if (on) {
      // Compact: default-scroll past the header so only the text area shows;
      // scrolling up reveals the header.
      window.setTimeout(() => this.scrollPastHeader(), 30);
    } else {
      this.scrollToBottom();
    }
  }

  scrollPastHeader() {
    if (this.scrollEl && this.headerEl) {
      this.scrollEl.scrollTop = this.headerEl.offsetHeight;
    }
  }

  async toggleMinimized() {
    this.plugin.settings.minimized = !this.plugin.settings.minimized;
    await this.plugin.saveData(this.plugin.settings);
    this.applyMinimized();
  }

  /* ------------------------- Agent picker ------------------------ */

  /** Update the compact route label text/title from the current selection. */
  updateRouteLabel() {
    if (!this.routeNameEl) return;
    const sid = this.selectedAgentId ? String(this.selectedAgentId) : "";
    const shortId = sid ? sid.slice(0, 8) : "";
    this.routeNameEl.setText(shortId || "All agents");
    const agent = sid
      ? (Array.isArray(this.liveAgents) ? this.liveAgents : []).find(
          (a) => a && String(a.id) === sid,
        )
      : null;
    if (this.routeModelEl) {
      const model = agent && agent.model ? String(agent.model) : "";
      this.routeModelEl.setText(model);
      this.routeModelEl.style.display = model ? "" : "none";
    }
    if (this.routeLabel) {
      const modelHint = agent && agent.model ? ` · ${agent.model}` : "";
      this.routeLabel.setAttr(
        "title",
        sid
          ? `Routes to agent ${sid}${modelHint} — click to change`
          : "Routes to all agents (shared queue) — click to change",
      );
    }
  }

  toggleAgentMenu() {
    if (!this.agentMenu) return;
    if (this.agentMenu.hasClass("jefr-open")) this.closeAgentMenu();
    else this.openAgentMenu();
  }

  /** Stable signature of what the menu shows (ids + states + selection), so we
   *  can skip rebuilding it when nothing meaningful changed. Order-independent. */
  agentMenuSignature() {
    const parts = (Array.isArray(this.liveAgents) ? this.liveAgents : [])
      .map((a) => `${a.id}:${a.state}:${a.model || ""}`)
      .sort();
    return `${this.selectedAgentId || ""}|${parts.join(",")}`;
  }

  openAgentMenu() {
    if (!this.agentMenu) return;
    this._agentMenuSig = this.agentMenuSignature();
    this.renderAgentMenu();
    this.agentMenu.addClass("jefr-open");
    // Dismiss on any outside click.
    this._agentMenuOutside = (e) => {
      const t = e.target;
      if (
        this.agentMenu &&
        !this.agentMenu.contains(t) &&
        this.routeLabel &&
        !this.routeLabel.contains(t)
      ) {
        this.closeAgentMenu();
      }
    };
    window.setTimeout(
      () => document.addEventListener("mousedown", this._agentMenuOutside, true),
      0,
    );
  }

  closeAgentMenu() {
    if (this.agentMenu) this.agentMenu.removeClass("jefr-open");
    if (this._agentMenuOutside) {
      document.removeEventListener("mousedown", this._agentMenuOutside, true);
      this._agentMenuOutside = null;
    }
  }

  renderAgentMenu() {
    if (!this.agentMenu) return;
    this.agentMenu.empty();
    // Stable display order (by id) so rows never bump as heartbeats update.
    const agents = (Array.isArray(this.liveAgents) ? this.liveAgents : [])
      .slice()
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const sel = this.selectedAgentId ? String(this.selectedAgentId) : "";

    // "All agents (shared)" — routes to the shared queue (no specific target).
    const allRow = this.agentMenu.createDiv({
      cls: "jefr-agent-opt" + (!sel ? " jefr-agent-opt-active" : ""),
    });
    allRow.createSpan({ cls: "jefr-agent-opt-dot" });
    allRow.createSpan({ cls: "jefr-agent-opt-name", text: "All agents (shared)" });
    allRow.onclick = () => this.selectAgentRemote(null);

    if (!agents.length) {
      this.agentMenu.createDiv({ cls: "jefr-agent-empty", text: "No live agents" });
    }
    for (const a of agents) {
      const id = a && a.id ? String(a.id) : "";
      if (!id) continue;
      const row = this.agentMenu.createDiv({
        cls: "jefr-agent-opt" + (id === sel ? " jefr-agent-opt-active" : ""),
      });
      const busy = a.state === "working";
      row.createSpan({ cls: "jefr-agent-opt-dot " + (busy ? "is-busy" : "is-listening") });
      row.createSpan({ cls: "jefr-agent-opt-name jefr-agent-opt-id", text: id.slice(0, 8) });
      const meta = [busy ? "busy" : "listening"];
      if (a.model) meta.push(a.model);
      if (typeof a.queueCount === "number" && a.queueCount > 0) {
        meta.push(`${a.queueCount} queued`);
      }
      row.createSpan({ cls: "jefr-agent-opt-meta", text: meta.join(" · ") });
      row.setAttr("title", a.model ? `${id} · ${a.model}` : id);
      row.onclick = () => this.selectAgentRemote(id);
    }
  }

  selectAgentRemote(id) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "selectAgent", agentId: id || null }));
    }
    // Optimistic update; the bridge will re-broadcast the authoritative state.
    this.selectedAgentId = id || null;
    this.updateRouteLabel();
    this.closeAgentMenu();
  }

  /** Cycle the routed ("talking-to") agent by `dir` (+1 next, -1 prev) through the
   *  same order the picker shows — ["All agents (shared)", ...live agents by id] —
   *  wrapping around. Bound to Ctrl/Cmd+PageDown / PageUp. */
  cycleAgent(dir) {
    const ids = (Array.isArray(this.liveAgents) ? this.liveAgents : [])
      .map((a) => (a && a.id ? String(a.id) : ""))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    const order = [null, ...ids]; // null = "All agents (shared)"
    if (order.length <= 1) return; // nothing to switch between
    const cur = this.selectedAgentId ? String(this.selectedAgentId) : null;
    let idx = order.indexOf(cur);
    if (idx < 0) idx = 0;
    const next = order[(idx + dir + order.length) % order.length];
    // The route label by the composer reflects the change — no toast needed.
    this.selectAgentRemote(next);
  }

  renderEmptyState() {
    this.messagesEl.empty();
    const empty = this.messagesEl.createDiv({ cls: "jefr-empty" });
    empty.createDiv({ cls: "jefr-empty-icon", text: "✦" });
    empty.createDiv({ cls: "jefr-empty-title", text: "jefr chat" });
    empty.createDiv({
      cls: "jefr-empty-sub",
      text: "Send a message to your Cursor agent. Everything here syncs with the jefr panel in Cursor.",
    });
  }

  updateSendState() {
    const hasText = this.input && this.input.value.trim().length > 0;
    const hasAttach = this.attachments.length > 0;
    const online = this.connStatus === "online";
    if (this.sendBtn) this.sendBtn.disabled = (!hasText && !hasAttach) || !online;
    if (this.hint) {
      const agent = this.agentStatus;
      let hint;
      if (!online) {
        hint = "Offline — waiting for Cursor…";
      } else if (agent && agent.alive && agent.state === "working") {
        hint = "Agent busy — message will queue";
      } else if (agent && agent.alive) {
        hint = "Enter to send";
      } else {
        hint = "No agent listening — message will queue";
      }
      this.hint.setText(hint);
    }
  }

  /* --------------------------- Attachments ----------------------- */

  onPaste(e) {
    const dt = e.clipboardData;
    const files = [];
    if (dt) {
      if (dt.files && dt.files.length) {
        files.push(...Array.from(dt.files));
      } else if (dt.items) {
        for (const it of Array.from(dt.items)) {
          if (it.kind === "file") {
            const f = it.getAsFile();
            if (f) files.push(f);
          }
        }
      }
    }
    const imgs = files.filter((f) => f.type && f.type.startsWith("image/"));
    if (imgs.length) {
      e.preventDefault();
      e.stopPropagation();
      this.ingestFiles(imgs);
      return;
    }
    if (files.length) {
      e.preventDefault();
      this.ingestFiles(files);
      return;
    }
    // No file in the payload. Try the native clipboard synchronously so we can
    // block Obsidian before it writes an embed.
    const du = readClipboardImage();
    if (du) {
      e.preventDefault();
      e.stopPropagation();
      this.stageImage(du, "pasted-image.png");
      return;
    }
    // Last resort: let Obsidian save the image + insert an ![[..]] embed, then
    // absorb that embed back into an attachment and strip the text.
    window.setTimeout(() => this.absorbEmbeds(), 40);
  }

  /** Detect ![[file.png]] / ![](file.png) embeds Obsidian inserted on paste,
   *  load those files from the vault, stage them as image attachments, and
   *  remove the embed text from the input. */
  async absorbEmbeds() {
    let val = this.input.value;
    if (!val || val.indexOf("![") === -1) return false;
    const found = [];
    const reWiki = /!\[\[([^\]|]+?\.(?:png|jpe?g|gif|webp|bmp|svg))(?:\|[^\]]*)?\]\]/gi;
    const reMd = /!\[[^\]]*\]\(([^)]+?\.(?:png|jpe?g|gif|webp|bmp|svg))\)/gi;
    let m;
    while ((m = reWiki.exec(val)) !== null) found.push({ full: m[0], link: m[1].trim() });
    while ((m = reMd.exec(val)) !== null) found.push({ full: m[0], link: decodeURIComponent(m[1].trim()) });
    if (!found.length) return false;

    for (const f of found) {
      const file =
        this.app.metadataCache.getFirstLinkpathDest(f.link, "") ||
        this.app.vault.getAbstractFileByPath(f.link);
      if (!file || !("extension" in file)) {
        // Couldn't resolve — still strip the embed text so it isn't sent as junk.
        val = val.split(f.full).join("");
        continue;
      }
      try {
        const buf = await this.app.vault.readBinary(file);
        const ext = (file.extension || "png").toLowerCase();
        const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "svg" ? "image/svg+xml" : "image/" + ext;
        const dataUrl = "data:" + mime + ";base64," + arrayBufferToBase64(buf);
        this.stageImage(dataUrl, file.name);
      } catch {
        /* ignore */
      }
      val = val.split(f.full).join("");
    }
    this.input.value = val;
    this.updateSendState();
    return true;
  }

  async tryClipboardImage() {
    // 1) Async Clipboard API (works in Chromium/Electron, needs a user gesture).
    try {
      if (navigator.clipboard && navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const type = (item.types || []).find((t) => t.startsWith("image/"));
          if (type) {
            const blob = await item.getType(type);
            const dataUrl = await blobToDataUrl(blob);
            if (dataUrl) {
              this.stageImage(dataUrl, "pasted-image.png");
              return true;
            }
          }
        }
      }
    } catch {
      /* fall through */
    }
    // 2) Native Electron clipboard bitmap (screenshots / copied image data).
    const du = readClipboardImage();
    if (du) {
      this.stageImage(du, "pasted-image.png");
      return true;
    }
    // 3) Copied image FILE(s) — clipboard holds file paths (text/uri-list).
    const fileImgs = readClipboardFileImages();
    if (fileImgs.length) {
      for (const fi of fileImgs) this.stageImage(fi.dataUrl, fi.name);
      return true;
    }
    return false;
  }

  stageImage(dataUrl, name) {
    if (!dataUrl) return;
    // De-dupe: paste event + keydown + clipboard read can fire for one paste.
    if (this.attachments.some((a) => a.dataUrl === dataUrl)) return;
    this.attachments.push({ id: makeId(), name: name || "pasted-image", dataUrl });
    this.renderAttachments();
    this.updateSendState();
  }

  ingestFiles(files) {
    for (const file of files) {
      if (file.type && file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const dataUrl = String(ev.target && ev.target.result ? ev.target.result : "");
          this.stageImage(dataUrl, file.name || "pasted-image");
        };
        reader.readAsDataURL(file);
      } else {
        // Non-image: inline a text preview into the composer (no binary upload).
        const reader = new FileReader();
        reader.onload = (ev) => {
          const content = String(ev.target && ev.target.result ? ev.target.result : "");
          const preview = content.length > 4000 ? content.slice(0, 4000) + "\n…(truncated)" : content;
          const snippet = `[File: ${file.name}]\n${preview}`;
          this.input.value = this.input.value ? this.input.value + "\n" + snippet : snippet;
          this.updateSendState();
        };
        reader.readAsText(file);
      }
    }
  }

  renderAttachments() {
    if (!this.attachBar) return;
    this.attachBar.empty();
    for (const a of this.attachments) {
      const chip = this.attachBar.createDiv({ cls: "jefr-attach-chip" });
      const img = chip.createEl("img", { cls: "jefr-attach-thumb", attr: { src: a.dataUrl, alt: a.name } });
      void img;
      const rm = chip.createEl("button", { cls: "jefr-attach-remove", text: "×", attr: { "aria-label": "Remove" } });
      rm.onclick = () => {
        this.attachments = this.attachments.filter((x) => x.id !== a.id);
        this.renderAttachments();
        this.updateSendState();
      };
    }
  }

  setStatus(status) {
    this.connStatus = status;
    if (!this.statusPill) return;
    this.statusPill.removeClass("jefr-status-online", "jefr-status-offline", "jefr-status-connecting");
    if (status === "online") {
      this.statusPill.addClass("jefr-status-online");
      this.statusPill.setText("Online");
    } else if (status === "connecting") {
      this.statusPill.addClass("jefr-status-connecting");
      this.statusPill.setText("Connecting…");
    } else {
      this.statusPill.addClass("jefr-status-offline");
      this.statusPill.setText("Offline");
    }
    // When the socket is down we have no idea about the agent, so show "unknown".
    if (status !== "online") this.setAgentStatus(null);
    this.updateSendState();
  }

  setAgentStatus(agent) {
    this.agentStatus = agent || null;
    if (!this.agentPill) return;
    this.agentPill.removeClass("jefr-agent-ready", "jefr-agent-busy", "jefr-agent-idle");
    const alive = !!(agent && agent.alive);
    if (alive && agent.state === "working") {
      this.agentPill.addClass("jefr-agent-busy");
      this.agentPill.setText("Agent busy");
      this.agentPill.setAttr("title", "An agent is alive but mid-task — messages will queue until it listens again");
    } else if (alive) {
      this.agentPill.addClass("jefr-agent-ready");
      this.agentPill.setText("Agent listening");
      this.agentPill.setAttr("title", "An agent is actively waiting — your message is picked up immediately");
    } else {
      this.agentPill.addClass("jefr-agent-idle");
      this.agentPill.setText("No agent");
      this.agentPill.setAttr("title", "No agent is running the loop — messages queue until one calls check_messages");
    }
    // Mirror liveness onto the compact route label's dot.
    if (this.routeLabel) {
      this.routeLabel.removeClass("jefr-route-ready", "jefr-route-busy", "jefr-route-idle");
      if (alive && agent.state === "working") this.routeLabel.addClass("jefr-route-busy");
      else if (alive) this.routeLabel.addClass("jefr-route-ready");
      else this.routeLabel.addClass("jefr-route-idle");
    }
    this.updateSendState();
  }

  /* --------------------------- Messaging ------------------------- */

  hasContent() {
    return this.messagesEl && !this.messagesEl.querySelector(".jefr-empty");
  }

  ensureMessagesReady() {
    if (!this.hasContent()) this.messagesEl.empty();
  }

  scrollToBottom() {
    const el = this.scrollEl || this.messagesEl;
    if (el) el.scrollTop = el.scrollHeight;
  }

  addUserBubble(text) {
    this.ensureMessagesReady();
    const row = this.messagesEl.createDiv({ cls: "jefr-row jefr-row-user" });
    const bubble = row.createDiv({ cls: "jefr-bubble jefr-bubble-user" });
    bubble.createDiv({ cls: "jefr-bubble-text", text });
    bubble.createDiv({ cls: "jefr-bubble-time", text: nowTime() });
    this.trimHistory();
    this.scrollToBottom();
  }

  async addReplyBubble(content) {
    this.ensureMessagesReady();
    const row = this.messagesEl.createDiv({ cls: "jefr-row jefr-row-ai" });
    const bubble = row.createDiv({ cls: "jefr-bubble jefr-bubble-ai" });
    const md = bubble.createDiv({ cls: "jefr-bubble-md markdown-rendered" });
    await renderMd(this, content, md);
    bubble.createDiv({ cls: "jefr-bubble-time", text: nowTime() });
    this.trimHistory();
    this.scrollToBottom();
  }

  renderSharedHistory(items) {
    for (const it of items) {
      if (!it || !it.id || this.renderedIds.has(it.id)) continue;
      this.renderedIds.add(it.id);
      if (it.kind === "reply") {
        this.addReplyBubble(it.text || "");
      } else if (it.kind === "image" && ((it.images && it.images.length) || it.dataUrl)) {
        const imgs = it.images && it.images.length ? it.images : [{ dataUrl: it.dataUrl, name: it.name }];
        this.addImageBubble(imgs, it.caption);
      } else if (it.kind === "image" || it.kind === "file") {
        this.addUserBubble(it.caption || it.name || it.text || "[" + it.kind + "]");
      } else {
        this.addUserBubble(it.text || "");
      }
    }
  }

  addImageBubble(images, caption) {
    this.ensureMessagesReady();
    // Backward compatible: accept a single (dataUrl, name, caption) call too.
    let imgs = images;
    if (typeof images === "string") {
      imgs = [{ dataUrl: images, name: caption }];
      caption = arguments[2];
    }
    const row = this.messagesEl.createDiv({ cls: "jefr-row jefr-row-user" });
    const bubble = row.createDiv({ cls: "jefr-bubble jefr-bubble-user jefr-bubble-image" });
    for (const im of imgs || []) {
      if (im && im.dataUrl) {
        bubble.createEl("img", { cls: "jefr-msg-img", attr: { src: im.dataUrl, alt: im.name || "image" } });
      }
    }
    if (caption) bubble.createDiv({ cls: "jefr-bubble-text", text: caption });
    bubble.createDiv({ cls: "jefr-bubble-time", text: nowTime() });
    this.trimHistory();
    this.scrollToBottom();
  }

  addSystemNote(text) {
    this.ensureMessagesReady();
    const row = this.messagesEl.createDiv({ cls: "jefr-row jefr-row-system" });
    row.createDiv({ cls: "jefr-system-note", text });
    this.scrollToBottom();
  }

  trimHistory() {
    const max = this.plugin.settings.maxHistory || 400;
    while (this.messagesEl.children.length > max) {
      this.messagesEl.removeChild(this.messagesEl.firstChild);
    }
  }

  clearHistory() {
    this.renderEmptyState();
  }

  doSend() {
    const text = this.input.value.trim();
    const attachments = this.attachments.slice();
    if (!text && attachments.length === 0) return;
    if (this.connStatus !== "online" || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      new Notice("jefr is offline — open Cursor with the jefr extension running.");
      return;
    }
    try {
      if (attachments.length) {
        // Combine text + all image(s) into ONE message (a single queue item) so
        // the agent receives them together as one combined bubble.
        this.queueSend({
          type: "sendImages",
          dataUrls: attachments.map((a) => a.dataUrl),
          caption: text,
        });
      } else if (text) {
        this.queueSend({ type: "sendText", text });
      }
      // Bubbles are rendered from the shared history broadcast (no optimistic add),
      // so the same message shows identically across all front-ends.
    } catch (e) {
      new Notice("jefr: failed to send message.");
      return;
    }
    this.pushSentHistory(text);
    this.input.value = "";
    this.attachments = [];
    this.renderAttachments();
    this.updateSendState();
    this.input.focus();
  }

  /* --------------------------- Questions ------------------------- */

  renderQuestion(q) {
    if (!q || !q.questions || !q.questions.length) {
      this.removeQuestionKeyHandler();
      this.questionEl.empty();
      this.currentQuestionId = null;
      return;
    }
    // Don't wipe/re-render an already-shown question when other state updates
    // (queue count, reply, etc.) arrive — that was clearing the visible card.
    if (q.id === this.currentQuestionId) return;
    this.currentQuestionId = q.id;
    this.selected = {};
    this.questionEl.empty();

    const card = this.questionEl.createDiv({ cls: "jefr-qcard" });
    const head = card.createDiv({ cls: "jefr-qcard-head" });
    head.createSpan({ cls: "jefr-qcard-title", text: "Agent question" });
    head.createSpan({ cls: "jefr-qcard-badge", text: "Awaiting answer" });

    const body = card.createDiv({ cls: "jefr-qcard-body" });
    for (const qi of q.questions) {
      this.selected[qi.id] = [];
      const block = body.createDiv({ cls: "jefr-qblock" });
      block.createDiv({ cls: "jefr-qtext", text: qi.question });
      const opts = block.createDiv({ cls: "jefr-qopts" });
      for (const opt of qi.options || []) {
        const optEl = opts.createDiv({ cls: "jefr-qopt" + (qi.allow_multiple ? " jefr-multi" : "") });
        optEl.createSpan({ cls: "jefr-qcheck" });
        optEl.createSpan({ cls: "jefr-qopt-label", text: opt.label });
        optEl.onclick = () => this.toggleOption(qi, opt.id, optEl, opts);
      }
      const other = block.createEl("input", {
        cls: "jefr-qother",
        attr: {
          type: "text",
          placeholder: "Additional notes (Enter to submit)",
          "data-qid": qi.id,
        },
      });
      void other;
    }

    const actions = card.createDiv({ cls: "jefr-qactions" });
    const cancel = actions.createEl("button", { cls: "jefr-btn jefr-btn-ghost", text: "Cancel" });
    cancel.onclick = () => this.cancelQuestion();
    const submit = actions.createEl("button", { cls: "jefr-btn jefr-btn-send", text: "Submit answer" });
    submit.onclick = () => this.submitQuestion(q);

    // Enter (anywhere except the main message box) submits the question; Shift+
    // Enter is left alone. Registered while the card is shown and torn down on
    // submit / cancel / replace so it never lingers or double-fires.
    this.removeQuestionKeyHandler();
    const onKey = (e) => {
      if (e.key !== "Enter" || e.shiftKey) return;
      const ae = document.activeElement;
      if (ae && ae.classList && ae.classList.contains("jefr-input")) return;
      e.preventDefault();
      this.submitQuestion(q);
    };
    document.addEventListener("keydown", onKey, true);
    this._removeQuestionKey = () =>
      document.removeEventListener("keydown", onKey, true);

    this.scrollToBottom();
  }

  removeQuestionKeyHandler() {
    if (this._removeQuestionKey) {
      this._removeQuestionKey();
      this._removeQuestionKey = null;
    }
  }

  toggleOption(qi, optId, optEl, optsContainer) {
    let arr = this.selected[qi.id] || [];
    const idx = arr.indexOf(optId);
    if (qi.allow_multiple) {
      if (idx > -1) arr.splice(idx, 1);
      else arr.push(optId);
    } else {
      arr = idx > -1 ? [] : [optId];
      optsContainer.querySelectorAll(".jefr-qopt").forEach((el) => el.removeClass("jefr-selected"));
    }
    this.selected[qi.id] = arr;
    optEl.toggleClass("jefr-selected", arr.indexOf(optId) > -1);
  }

  submitQuestion(q) {
    // Guard against a double-submit (e.g. Enter + button, or repeated Enter):
    // once the active question is cleared, ignore further submits for it.
    if (!q || this.currentQuestionId !== q.id) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      new Notice("jefr is offline.");
      return;
    }
    const answers = [];
    for (const qi of q.questions) {
      const otherEl = this.questionEl.querySelector(`.jefr-qother[data-qid="${qi.id}"]`);
      answers.push({
        questionId: qi.id,
        selected: this.selected[qi.id] || [],
        other: otherEl ? otherEl.value.trim() : "",
      });
    }
    this.ws.send(JSON.stringify({ type: "submitAnswer", data: { id: q.id, answers } }));
    this.addSystemNote("Answer submitted");
    this.removeQuestionKeyHandler();
    this.questionEl.empty();
    this.currentQuestionId = null;
  }

  cancelQuestion() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "cancelQuestion" }));
    }
    this.addSystemNote("Question cancelled");
    this.removeQuestionKeyHandler();
    this.questionEl.empty();
    this.currentQuestionId = null;
  }

  /* ----------------------- Inbound state ------------------------- */

  handleState(d) {
    // Real agent liveness (heartbeat), independent of the socket connection.
    this.setAgentStatus(d.agent);

    // Connection / workspace
    if (d.workspace) {
      const name = d.workspace.name || "";
      const p = d.workspace.path || "";
      this.workspaceLine.setText(name ? `${name}` : "");
      this.workspaceLine.setAttr("title", p);
    }

    // Compact agent picker: which agent this message routes to. The bridge sends
    // the live-agent list (`agents`) + current `selectedAgentId` (mirrors the
    // panel's Agent Picker). Clicking the label opens a dropdown to switch.
    this.liveAgents = Array.isArray(d.agents) ? d.agents : [];
    this.selectedAgentId = d.selectedAgentId || null;
    this.updateRouteLabel();
    // Only rebuild the open menu when the agent set / states / selection actually
    // change — otherwise the 0.5s heartbeat push would re-render (and the
    // ts-sorted order would reshuffle) every tick, making it flicker/bump.
    if (this.agentMenu && this.agentMenu.hasClass("jefr-open")) {
      const sig = this.agentMenuSignature();
      if (sig !== this._agentMenuSig) {
        this._agentMenuSig = sig;
        this.renderAgentMenu();
      }
    }

    // Queue badge + remember the queued items for the toggle panel.
    this.lastQueue = Array.isArray(d.queue) ? d.queue : [];
    const count = typeof d.queueCount === "number" ? d.queueCount : this.lastQueue.length;
    if (this.queueBadge) {
      this.queueBadge.setText(count > 0 ? `${count} queued` : "");
      this.queueBadge.toggleClass("jefr-has-queue", count > 0);
    }
    if (count === 0 && this.queueOpen) this.closeQueuePanel();
    else if (this.queueOpen) this.renderQueuePanel();

    // Question
    if (d.question) {
      this.renderQuestion(d.question);
    } else if (this.currentQuestionId) {
      this.removeQuestionKeyHandler();
      this.questionEl.empty();
      this.currentQuestionId = null;
    }

    // Shared chat history (sends from any front-end)
    if (Array.isArray(d.history)) this.renderSharedHistory(d.history);

    // Progress only — actual reply bubbles now come through the shared history
    // (kind: "reply"), so we don't render them from reply.json to avoid doubles.
    if (d.reply && d.reply.content) {
      const ts = d.reply.timestamp || "";
      if (ts !== this.lastReplyTs) {
        this.lastReplyTs = ts;
        if (typeof d.reply.percent === "number") {
          this.updateProgress(d.reply.percent, d.reply.content);
        } else {
          this.hideProgress();
        }
      }
    }
  }

  toggleQueuePanel() {
    if (this.queueOpen) this.closeQueuePanel();
    else this.openQueuePanel();
  }

  openQueuePanel() {
    if (!this.queuePanel) return;
    const items = this.lastQueue || [];
    if (!items.length) return; // nothing queued
    this.queueOpen = true;
    this.renderQueuePanel();
    this.queuePanel.addClass("jefr-open");
  }

  closeQueuePanel() {
    this.queueOpen = false;
    if (this.queuePanel) this.queuePanel.removeClass("jefr-open");
  }

  renderQueuePanel() {
    if (!this.queuePanel) return;
    this.queuePanel.empty();
    const items = this.lastQueue || [];
    const head = this.queuePanel.createDiv({ cls: "jefr-queue-head" });
    head.createSpan({ text: items.length + " message" + (items.length === 1 ? "" : "s") + " queued" });
    if (items.length > 0) {
      const clearBtn = head.createEl("button", { cls: "jefr-queue-clear", text: "Clear all" });
      clearBtn.onclick = () => this.clearQueueAll();
    }
    for (const it of items) {
      const row = this.queuePanel.createDiv({ cls: "jefr-queue-row" });
      const type = it.type || "text";
      let preview;
      if (type === "image") {
        const n = it.images && it.images.length ? it.images.length : 1;
        const label = n > 1 ? "[" + n + " images]" : "[Image]";
        preview = it.caption ? label + " " + it.caption : label;
      }
      else if (type === "file") preview = "[File] " + (it.path ? it.path.split(/[\\/]/).pop() : "");
      else preview = (it.content || "").replace(/\s+/g, " ").trim();
      row.createSpan({ cls: "jefr-queue-type jefr-qt-" + type, text: type });
      row.createSpan({ cls: "jefr-queue-text", text: preview.length > 120 ? preview.slice(0, 120) + "…" : preview });
      const del = row.createEl("button", { cls: "jefr-queue-del", attr: { "aria-label": "Delete this queued message" } });
      del.setText("×");
      del.onclick = (e) => {
        e.stopPropagation();
        this.deleteQueueItem(it.id);
      };
    }
  }

  recallHistory(dir) {
    const hist = this.sentHistory || (this.sentHistory = []);
    if (!hist.length) return;
    if (this.historyIndex == null) this.historyIndex = -1;
    if (this.historyIndex === -1) {
      // Entering history navigation: stash the current draft to restore later.
      this.historyDraft = this.input.value;
    }
    if (dir < 0) {
      this.historyIndex =
        this.historyIndex === -1 ? hist.length - 1 : Math.max(0, this.historyIndex - 1);
    } else {
      if (this.historyIndex === -1) return;
      this.historyIndex += 1;
      if (this.historyIndex >= hist.length) {
        // Past the newest entry: restore the draft and leave history mode.
        this.historyIndex = -1;
        this.input.value = this.historyDraft || "";
        this.placeCaretEnd();
        this.updateSendState();
        return;
      }
    }
    this.input.value = hist[this.historyIndex];
    this.placeCaretEnd();
    this.updateSendState();
  }

  placeCaretEnd() {
    const len = this.input.value.length;
    try {
      this.input.setSelectionRange(len, len);
    } catch (e) {
      /* ignore */
    }
  }

  pushSentHistory(text) {
    if (!text) return;
    this.sentHistory = this.sentHistory || [];
    if (this.sentHistory[this.sentHistory.length - 1] !== text) {
      this.sentHistory.push(text);
    }
    if (this.sentHistory.length > 100) this.sentHistory.shift();
    this.historyIndex = -1;
    this.historyDraft = "";
  }

  deleteQueueItem(id) {
    if (!id) return;
    if (this.connStatus !== "online" || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      new Notice("jefr is offline — can't delete right now.");
      return;
    }
    try {
      this.ws.send(JSON.stringify({ type: "deleteQueueItem", id }));
    } catch (e) {
      new Notice("jefr: failed to delete queued message.");
    }
  }

  clearQueueAll() {
    if (this.connStatus !== "online" || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      new Notice("jefr is offline — can't clear right now.");
      return;
    }
    try {
      this.ws.send(JSON.stringify({ type: "clearQueue" }));
    } catch (e) {
      new Notice("jefr: failed to clear queue.");
    }
  }

  /* ----- Reliable, acknowledged sends -----
   * A WebSocket can stay readyState===OPEN for a while after the server has
   * actually gone (e.g. Cursor reload), so ws.send() silently drops the frame
   * and the message never reaches the queue. To make sends reliable we tag each
   * with a client id, keep it "pending" until the server acks it, force a
   * reconnect if no ack arrives, and re-send everything pending on reconnect.
   * The server de-dupes by client id, so re-sends never double-queue. */

  genCid() {
    this._cidSeq = (this._cidSeq || 0) + 1;
    return Date.now().toString(36) + "-" + this._cidSeq;
  }

  queueSend(payload) {
    this.pending = this.pending || new Map();
    const cid = this.genCid();
    payload.cid = cid;
    this.pending.set(cid, { payload, attempts: 0 });
    this.flushSend(cid);
  }

  flushSend(cid) {
    const entry = this.pending && this.pending.get(cid);
    if (!entry) return;
    entry.attempts = (entry.attempts || 0) + 1;
    if (entry.attempts > 5) {
      // Give up after repeated unacked attempts (e.g. a server too old to ack)
      // so we never loop forever or pile up duplicates.
      this.pending.delete(cid);
      if (this._ackTimers && this._ackTimers.has(cid)) {
        clearTimeout(this._ackTimers.get(cid));
        this._ackTimers.delete(cid);
      }
      new Notice("jefr: couldn't confirm a message was delivered — try reloading Cursor.");
      return;
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(entry.payload));
      } catch (e) {
        /* will be retried via the ack watchdog / reconnect flush */
      }
    }
    // Ack watchdog: if the server doesn't confirm soon, the socket is likely a
    // zombie — force a reconnect, which re-flushes everything still pending.
    this._ackTimers = this._ackTimers || new Map();
    if (this._ackTimers.has(cid)) return;
    const t = window.setTimeout(() => {
      this._ackTimers.delete(cid);
      if (this.pending && this.pending.has(cid)) {
        this.recoverConnection();
      }
    }, 3000);
    this._ackTimers.set(cid, t);
  }

  flushPending() {
    if (!this.pending || !this.pending.size) return;
    for (const cid of Array.from(this.pending.keys())) this.flushSend(cid);
  }

  ackSend(cid) {
    if (this.pending) this.pending.delete(cid);
    if (this._ackTimers && this._ackTimers.has(cid)) {
      clearTimeout(this._ackTimers.get(cid));
      this._ackTimers.delete(cid);
    }
  }

  recoverConnection() {
    if (this._recovering) return;
    this._recovering = true;
    try {
      if (this.ws) this.ws.close(); // onclose -> scheduleReconnect -> connect -> onopen -> flushPending
    } catch (e) {
      /* ignore */
    }
    window.setTimeout(() => {
      this._recovering = false;
    }, 1500);
  }

  updateProgress(pct, label) {
    const p = Math.max(0, Math.min(100, Math.round(pct)));
    if (this.progressWrap) this.progressWrap.style.display = "";
    if (this.progressFill) this.progressFill.style.width = p + "%";
    if (this.progressLabel) {
      const line = (label || "").split("\n")[0].replace(/^#+\s*/, "").trim();
      this.progressLabel.setText(p + "%" + (line ? " · " + (line.length > 60 ? line.slice(0, 60) + "…" : line) : ""));
    }
    if (this._progressHideTimer) {
      clearTimeout(this._progressHideTimer);
      this._progressHideTimer = null;
    }
    if (p >= 100) {
      this._progressHideTimer = window.setTimeout(() => this.hideProgress(), 2500);
    }
  }

  hideProgress() {
    if (this._progressHideTimer) {
      clearTimeout(this._progressHideTimer);
      this._progressHideTimer = null;
    }
    if (this.progressWrap) this.progressWrap.style.display = "none";
    if (this.progressFill) this.progressFill.style.width = "0%";
  }

  /* --------------------------- Socket ---------------------------- */

  connect() {
    if (this.ws) return;
    this.manualClose = false;
    const { host, port } = this.plugin.settings;
    const url = `ws://${host}:${port}`;
    this.setStatus("connecting");

    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.awaitingPong = false;
      this.setStatus("online");
      this.startPing();
      // Re-send anything that wasn't acknowledged before the (re)connection.
      this.flushPending();
    };

    ws.onmessage = (ev) => {
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m.type === "init" || m.type === "stateUpdate") {
        this.handleState(m);
      } else if (m.type === "queueUpdate") {
        if (this.queueBadge) {
          const c = m.count || 0;
          this.queueBadge.setText(c > 0 ? `${c} queued` : "");
          this.queueBadge.toggleClass("jefr-has-queue", c > 0);
        }
      } else if (m.type === "sendAck") {
        this.ackSend(m.cid);
      } else if (m.type === "pong") {
        this.awaitingPong = false;
      }
    };

    ws.onclose = () => {
      this.stopPing();
      this.ws = null;
      this.setStatus("offline");
      if (!this.manualClose && this.plugin.settings.autoReconnect) {
        this.scheduleReconnect();
      }
    };

    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts - 1), 30000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  startPing() {
    this.stopPing();
    this.awaitingPong = false;
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        if (this.awaitingPong) {
          // Previous ping was never answered -> the socket is a zombie. Recover.
          this.awaitingPong = false;
          this.recoverConnection();
          return;
        }
        try {
          this.ws.send(JSON.stringify({ type: "ping" }));
          this.awaitingPong = true;
        } catch {
          /* ignore */
        }
      }
    }, 12000);
  }

  stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  teardownSocket() {
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.manualClose = true;
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.setStatus("offline");
  }
}

/* ------------------------------------------------------------------ */
/* Settings tab                                                        */
/* ------------------------------------------------------------------ */

class JefrSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h3", { text: "jefr connection" });

    new Setting(containerEl)
      .setName("Host")
      .setDesc("Host of the jefr local server running inside Cursor (usually 127.0.0.1).")
      .addText((t) =>
        t
          .setPlaceholder("127.0.0.1")
          .setValue(this.plugin.settings.host)
          .onChange(async (v) => {
            this.plugin.settings.host = (v || "").trim() || "127.0.0.1";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Port")
      .setDesc("Port of the jefr local server. Default is 39517.")
      .addText((t) =>
        t
          .setPlaceholder("39517")
          .setValue(String(this.plugin.settings.port))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            this.plugin.settings.port = Number.isFinite(n) && n > 0 ? n : 39517;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Auto-reconnect")
      .setDesc("Automatically reconnect when Cursor restarts or the connection drops.")
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.autoReconnect).onChange(async (v) => {
          this.plugin.settings.autoReconnect = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Max messages kept")
      .setDesc("How many chat bubbles to keep in the view before trimming the oldest.")
      .addText((t) =>
        t
          .setPlaceholder("400")
          .setValue(String(this.plugin.settings.maxHistory))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            this.plugin.settings.maxHistory = Number.isFinite(n) && n > 20 ? n : 400;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "Notifications" });

    new Setting(containerEl)
      .setName("Notify on MCP log rewrite")
      .setDesc("Show a native OS (Windows) notification whenever the MCP Response Log file is rewritten.")
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.notifyOnLogRewrite).onChange(async (v) => {
          this.plugin.settings.notifyOnLogRewrite = v;
          await this.plugin.saveSettings();
          if (v) ensureNotificationPermission();
        })
      );

    new Setting(containerEl)
      .setName("MCP log path")
      .setDesc("Vault-relative path to the MCP Response Log to watch (forward slashes).")
      .addText((t) =>
        t
          .setPlaceholder("Tech/Meta/MCP Response Log.md")
          .setValue(this.plugin.settings.logNotifyPath)
          .onChange(async (v) => {
            this.plugin.settings.logNotifyPath = (v || "").trim() || "Tech/Meta/MCP Response Log.md";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Test notification")
      .setDesc("Fire a sample OS notification to confirm Windows toasts work.")
      .addButton((b) =>
        b.setButtonText("Send test").onClick(async () => {
          await ensureNotificationPermission();
          showOsNotification("MCP Response Log updated", {
            body: "This is a test notification from the jefr plugin.",
          });
        })
      );

    containerEl.createEl("h3", { text: "Remote SSH response-log bridge" });

    new Setting(containerEl)
      .setName("Enable log bridge")
      .setDesc(
        "Listen on 127.0.0.1 so a Remote-SSH agent can POST markdown (via SSH RemoteForward) and overwrite the MCP Response Log in this vault."
      )
      .addToggle((tg) =>
        tg.setValue(!!this.plugin.settings.logBridgeEnabled).onChange(async (v) => {
          this.plugin.settings.logBridgeEnabled = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Log bridge port")
      .setDesc("Default 39527. Forward this port from the remote host to Windows.")
      .addText((t) =>
        t
          .setPlaceholder("39527")
          .setValue(String(this.plugin.settings.logBridgePort || 39527))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            this.plugin.settings.logBridgePort = Number.isFinite(n) && n > 0 ? n : 39527;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Log bridge token (optional)")
      .setDesc("If set, require Authorization: Bearer <token> or X-Jefr-Token.")
      .addText((t) =>
        t
          .setPlaceholder("(empty = no auth)")
          .setValue(this.plugin.settings.logBridgeToken || "")
          .onChange(async (v) => {
            this.plugin.settings.logBridgeToken = (v || "").trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Test log bridge")
      .setDesc("POST a sample note through the local bridge endpoint.")
      .addButton((b) =>
        b.setButtonText("Write test").onClick(async () => {
          const port = Number(this.plugin.settings.logBridgePort) || 39527;
          const token = (this.plugin.settings.logBridgeToken || "").trim();
          try {
            const headers = { "Content-Type": "application/json" };
            if (token) headers["X-Jefr-Token"] = token;
            const resp = await fetch(`http://127.0.0.1:${port}/response-log`, {
              method: "POST",
              headers,
              body: JSON.stringify({
                markdown:
                  "# Bridge test\n\nWritten via Obsidian log bridge at " +
                  new Date().toISOString() +
                  ".\n",
              }),
            });
            const data = await resp.json().catch(() => ({}));
            if (resp.ok && data.ok) {
              new Notice("jefr: log bridge write ok");
            } else {
              new Notice(
                "jefr: log bridge failed — " + (data.error || resp.status)
              );
            }
          } catch (e) {
            new Notice(
              "jefr: log bridge unreachable — " + (e && e.message ? e.message : e)
            );
          }
        })
      );

    const tip = containerEl.createEl("p", { cls: "jefr-settings-tip" });
    tip.setText(
      "The jefr Cursor extension must be running for chat to connect. For Remote SSH Response Log writes, keep this bridge enabled and forward port 39527 — see docs/remote-ssh-response-log.md."
    );
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function makeId() {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

/** Parse POST body for the response-log bridge: JSON `{ markdown }` / `{ content }`
 *  or raw text/markdown. */
function parseLogBridgeBody(raw, contentType) {
  const ct = String(contentType || "").toLowerCase();
  const text = String(raw || "");
  if (ct.includes("application/json") || /^\s*\{/.test(text)) {
    try {
      const data = JSON.parse(text);
      if (typeof data.markdown === "string") return data.markdown;
      if (typeof data.content === "string") return data.content;
      if (typeof data.text === "string") return data.text;
    } catch {
      // fall through to raw text
    }
  }
  return text;
}

/** Ensure parent folders exist, then overwrite a vault-relative markdown path. */
async function writeVaultMarkdown(app, relPath, markdown) {
  const norm = String(relPath || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  if (!norm || norm.includes("..")) {
    throw new Error("Invalid vault-relative path");
  }
  const parts = norm.split("/");
  if (parts.length > 1) {
    let dir = "";
    for (let i = 0; i < parts.length - 1; i++) {
      dir = dir ? dir + "/" + parts[i] : parts[i];
      const existing = app.vault.getAbstractFileByPath(dir);
      if (!existing) {
        await app.vault.createFolder(dir);
      }
    }
  }
  await app.vault.adapter.write(norm, markdown);
}

/** Ask the browser/Electron for notification permission once (no-op if already
 *  granted or unsupported). Returns a promise that resolves to the permission. */
async function ensureNotificationPermission() {
  try {
    if (typeof Notification === "undefined") return "unsupported";
    if (Notification.permission === "granted" || Notification.permission === "denied") {
      return Notification.permission;
    }
    return await Notification.requestPermission();
  } catch {
    return "default";
  }
}

/** Show a native OS notification (Windows toast in Electron). Falls back to an
 *  in-app Obsidian Notice if the web Notification API is unavailable/blocked. */
function showOsNotification(title, opts) {
  const body = (opts && opts.body) || "";
  const onClick = opts && opts.onClick;
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      const n = new Notification(title, { body, silent: false });
      if (onClick) n.onclick = () => onClick();
      return;
    }
    if (typeof Notification !== "undefined" && Notification.permission !== "denied") {
      // Permission not resolved yet — request, then show on grant.
      ensureNotificationPermission().then((perm) => {
        if (perm === "granted") {
          const n = new Notification(title, { body, silent: false });
          if (onClick) n.onclick = () => onClick();
        } else {
          new Notice(title + (body ? " — " + body : ""));
        }
      });
      return;
    }
  } catch {
    /* fall through to Notice */
  }
  try {
    new Notice(title + (body ? " — " + body : ""));
  } catch {
    /* ignore */
  }
}

function nowTime() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function arrayBufferToBase64(buf) {
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    try {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ""));
      r.onerror = () => resolve("");
      r.readAsDataURL(blob);
    } catch {
      resolve("");
    }
  });
}

/** Read an image from the native Electron clipboard as a data URL, or "" if none. */
function readClipboardImage() {
  return readClipboardImageDiag().dataUrl;
}

/** Read image FILES referenced on the clipboard (copied from File Explorer etc.),
 *  which appear as a text/uri-list of file:// URIs. Returns [{dataUrl, name}]. */
function readClipboardFileImages() {
  const out = [];
  try {
    const electron = require("electron");
    const clip = electron && electron.clipboard;
    if (!clip) return out;
    let txt = "";
    try {
      if (typeof clip.read === "function") txt = clip.read("text/uri-list") || "";
    } catch {
      /* ignore */
    }
    if (!txt && typeof clip.readText === "function") txt = clip.readText() || "";
    if (!txt) return out;
    const fs = require("fs");
    const path = require("path");
    const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];
    const uris = txt
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s && s[0] !== "#");
    for (const uri of uris) {
      let p = uri;
      if (/^file:\/\//i.test(p)) {
        p = decodeURIComponent(p.replace(/^file:\/\//i, ""));
        if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1); // Windows /C:/... → C:/...
      }
      const ext = (path.extname(p).slice(1) || "").toLowerCase();
      if (imageExts.indexOf(ext) === -1) continue;
      try {
        const buf = fs.readFileSync(p);
        const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "svg" ? "image/svg+xml" : "image/" + ext;
        out.push({ dataUrl: "data:" + mime + ";base64," + buf.toString("base64"), name: path.basename(p) });
      } catch {
        /* unreadable path */
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}

/** Like readClipboardImage but returns a diagnostic note for debugging. */
function readClipboardImageDiag() {
  try {
    const electron = require("electron");
    if (!electron) return { dataUrl: "", note: "electron: require returned null" };
    const clip = electron.clipboard || (electron.remote && electron.remote.clipboard);
    if (!clip) return { dataUrl: "", note: "electron: no .clipboard" };
    if (typeof clip.readImage !== "function") return { dataUrl: "", note: "electron: no readImage()" };
    const img = clip.readImage();
    if (!img) return { dataUrl: "", note: "electron: readImage null" };
    if (typeof img.isEmpty === "function" && img.isEmpty()) {
      let formats = "";
      try {
        formats = (clip.availableFormats && clip.availableFormats().join(",")) || "";
      } catch {
        /* ignore */
      }
      return { dataUrl: "", note: "electron: image empty; formats=[" + formats + "]" };
    }
    return { dataUrl: img.toDataURL(), note: "electron: image OK" };
  } catch (e) {
    return { dataUrl: "", note: "electron err: " + (e && e.message ? e.message : e) };
  }
}

async function renderMd(view, markdown, el) {
  try {
    if (MarkdownRenderer && typeof MarkdownRenderer.render === "function") {
      await MarkdownRenderer.render(view.app, markdown || "", el, "", view);
      return;
    }
    if (MarkdownRenderer && typeof MarkdownRenderer.renderMarkdown === "function") {
      await MarkdownRenderer.renderMarkdown(markdown || "", el, "", view);
      return;
    }
  } catch {
    /* fall through to plain text */
  }
  el.setText(markdown || "");
}

module.exports = JefrPlugin;
