// agent_map.js — map each agent tile to its stable agentId (= chat UUID) via the
// React fiber, and optionally focus a tile BY agentId.
//
// Usage (via cdp.py --file, with a __AGENT__ substitution for focus):
//   python cdp.py --file agent_map.js                 -> list {i, agentId, model, state}
//   (replace __AGENT__ with a uuid in the caller to focus that agent's tile)
(() => {
  const TARGET = "__AGENT__"; // caller may replace; "" / "__AGENT__" = list only

  const fiberOf = (node) => {
    const k = Object.keys(node).find(
      (x) => x.startsWith("__reactFiber$") || x.startsWith("__reactInternalInstance$")
    );
    return k ? node[k] : null;
  };
  const agentIdOf = (node) => {
    let f = fiberOf(node), steps = 0;
    while (f && steps++ < 40) {
      const p = f.memoizedProps;
      if (p && typeof p === "object" && typeof p.agentId === "string") return p.agentId;
      f = f.return;
    }
    return null;
  };

  const tiles = (() => {
    const tiled = [...document.querySelectorAll(".glass-agent-conversation-tiling__tile")];
    if (tiled.length > 0) return tiled;
    const shell = document.querySelector(".agent-panel-conversation-shell");
    return shell ? [shell] : [];
  })();
  const modelOf = (t) => {
    const eds = [...(t?.querySelectorAll(".tiptap.ProseMirror.ui-prompt-input-editor__input") || [])]
      .filter((e) => !e.closest(".prompt-edit-input"));
    const ed = eds[eds.length - 1];
    const root = ed
      ? ed.closest(".ui-prompt-input") || ed.closest(".agent-prompt-input-root")
      : null;
    const fromComposer = root?.querySelector(".ui-model-picker__trigger-text")?.textContent?.trim();
    if (fromComposer) return fromComposer;
    const texts = [...(t?.querySelectorAll(".ui-model-picker__trigger-text") || [])]
      .filter((el) => !el.closest(".prompt-edit-input"));
    return texts[texts.length - 1]?.textContent?.trim() || "";
  };

  const rows = tiles.map((t, i) => {
    const submits = [...t.querySelectorAll(".ui-prompt-input-submit-button")]
      .filter((b) => !b.closest(".prompt-edit-input"));
    const submit = submits[submits.length - 1];
    const aria = submit?.getAttribute("aria-label") || "";
    const text = (t.innerText || "").replace(/\s+/g, " ").trim();
    return {
      i,
      agentId: agentIdOf(t),
      model: modelOf(t),
      generating: submits.some((b) => b.getAttribute("data-state") === "stop") || /stop generation/i.test(aria),
      runningJefr: /(Ran|Running) Check Messages in jefr/i.test(text),
    };
  });

  if (TARGET && TARGET !== "__" + "AGENT__") {
    const hit = rows.find((r) => r.agentId === TARGET);
    if (!hit) return { ok: false, error: "agentId not found", target: TARGET, rows };
    const t = tiles[hit.i];
    // Last composer on the tile (same rule as modelOf / editorIn).
    const eds = [...(t?.querySelectorAll(".tiptap.ProseMirror.ui-prompt-input-editor__input") || [])]
      .filter((e) => !e.closest(".prompt-edit-input"));
    const ed = eds[eds.length - 1];
    if (ed) {
      ed.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      ed.focus();
      ed.click();
    }
    return { ok: true, focused: hit.i, agentId: TARGET, rows };
  }

  return { ok: true, rows };
})()
