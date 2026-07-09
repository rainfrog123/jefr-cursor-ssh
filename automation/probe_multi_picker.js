(() => {
  const clean = (t) =>
    (t || "")
      .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const isFollowupEditor = (ed) => {
    if (ed.closest(".agent-panel-followup-input")) return true;
    const ph =
      ed.querySelector("[data-placeholder]")?.getAttribute("data-placeholder") ||
      ed.getAttribute("data-placeholder") ||
      "";
    return /send follow-?up/i.test(ph);
  };

  const tiles = (() => {
    const tiled = [
      ...document.querySelectorAll(".glass-agent-conversation-tiling__tile"),
    ];
    if (tiled.length > 0) return tiled;
    const shell = document.querySelector(".agent-panel-conversation-shell");
    return shell ? [shell] : [];
  })();

  return tiles.map((t, i) => {
    const pickers = [...t.querySelectorAll(".ui-model-picker__trigger")].map(
      (tr, j) => {
        const text = clean(
          tr.querySelector(".ui-model-picker__trigger-text")?.textContent,
        );
        const root =
          tr.closest(".ui-prompt-input") ||
          tr.closest(".agent-prompt-input-root") ||
          tr.closest(".agent-panel-followup-input");
        const ed = root?.querySelector(
          ".tiptap.ProseMirror.ui-prompt-input-editor__input",
        );
        const inFollowup = !!tr.closest(".agent-panel-followup-input");
        const inEdit = !!tr.closest(".prompt-edit-input");
        const visible = !!(tr.offsetParent || tr.getClientRects().length);
        return {
          j,
          text,
          inFollowup,
          inEdit,
          visible,
          compact: tr
            .closest(".glass-model-picker-wrapper")
            ?.getAttribute("data-compact-visible"),
          aria: clean(tr.getAttribute("aria-label")),
          editorFollowup: ed ? isFollowupEditor(ed) : null,
        };
      },
    );

    const eds = [
      ...(t.querySelectorAll(
        ".tiptap.ProseMirror.ui-prompt-input-editor__input",
      ) || []),
    ].filter((e) => !e.closest(".prompt-edit-input"));
    const activeEd = eds.find(isFollowupEditor) || eds[eds.length - 1];
    const activeRoot = activeEd
      ? activeEd.closest(".ui-prompt-input") ||
        activeEd.closest(".agent-prompt-input-root")
      : null;
    const activeText = clean(
      activeRoot?.querySelector(".ui-model-picker__trigger-text")?.textContent,
    );
    const firstText = clean(
      t.querySelector(".ui-model-picker__trigger-text")?.textContent,
    );

    return {
      i,
      pickerCount: pickers.length,
      firstText,
      activeComposerText: activeText,
      mismatch: firstText !== activeText,
      pickers,
    };
  });
})()
