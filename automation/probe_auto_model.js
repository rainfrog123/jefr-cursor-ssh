(() => {
  const clean = (t) =>
    (t || "")
      .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
      .replace(/\s+/g, " ")
      .trim();

  function agentIdOf(node) {
    const k = Object.keys(node).find(
      (x) =>
        x.startsWith("__reactFiber$") || x.startsWith("__reactInternalInstance$"),
    );
    let f = k ? node[k] : null;
    let steps = 0;
    while (f && steps++ < 50) {
      const p = f.memoizedProps;
      if (p && typeof p === "object" && typeof p.agentId === "string") return p.agentId;
      f = f.return;
    }
    return null;
  }

  function fiberModelHints(node) {
    const k = Object.keys(node).find(
      (x) =>
        x.startsWith("__reactFiber$") || x.startsWith("__reactInternalInstance$"),
    );
    let f = k ? node[k] : null;
    let steps = 0;
    const hits = [];
    while (f && steps++ < 60) {
      const p = f.memoizedProps;
      if (p && typeof p === "object") {
        for (const key of Object.keys(p)) {
          if (!/model|provider|routing|selected/i.test(key)) continue;
          const v = p[key];
          const t = typeof v;
          if (t === "string" && v.trim()) {
            hits.push({ key, value: clean(v).slice(0, 120) });
          } else if (t === "object" && v) {
            try {
              const s = JSON.stringify(v);
              if (s && s.length < 400 && /model|grok|opus|gpt|auto/i.test(s)) {
                hits.push({ key, value: s.slice(0, 200) });
              }
            } catch {}
          }
        }
      }
      f = f.return;
    }
    return hits.slice(0, 30);
  }

  const tiles = [...document.querySelectorAll(".glass-agent-conversation-tiling__tile")];
  return tiles.map((t, i) => {
    const trigger = t.querySelector(".ui-model-picker__trigger");
    const text = clean(t.querySelector(".ui-model-picker__trigger-text")?.textContent);
    const aria = clean(trigger?.getAttribute("aria-label"));
    const title = clean(trigger?.getAttribute("title"));
    const wrapper = trigger?.closest(".glass-model-picker-wrapper");
    const wrapperAttrs = wrapper
      ? Object.fromEntries([...wrapper.attributes].map((a) => [a.name, a.value]))
      : null;
    const triggerKids = trigger
      ? [...trigger.querySelectorAll("*")]
          .map((e) => ({
            tag: e.tagName,
            cls: e.className?.toString?.()?.slice(0, 80) || "",
            text: clean(e.textContent).slice(0, 80),
          }))
          .filter((x) => x.text && x.text !== text)
          .slice(0, 12)
      : [];
    return {
      i,
      agentId: agentIdOf(t)?.slice(0, 8),
      text,
      aria,
      title,
      wrapperAttrs,
      triggerKids,
      fiberHints: fiberModelHints(trigger || t),
    };
  });
})()
