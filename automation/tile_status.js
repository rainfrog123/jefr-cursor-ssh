// Shared tile status helpers (included inline or via evaluate)
function cursorCleanLabel(t) {
  return (t || '')
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim() || null;
}

/** Model label from the LAST composer on the tile (not the first picker). */
function cursorTileModel(tile) {
  if (!tile) return null;
  const eds = [...tile.querySelectorAll('.tiptap.ProseMirror.ui-prompt-input-editor__input')]
    .filter((ed) => !ed.closest('.prompt-edit-input'));
  const ed = eds[eds.length - 1];
  const root = ed
    ? (ed.closest('.ui-prompt-input') || ed.closest('.agent-prompt-input-root'))
    : null;
  const fromComposer = root?.querySelector('.ui-model-picker__trigger-text')?.textContent;
  if (fromComposer) return cursorCleanLabel(fromComposer);
  const texts = [...tile.querySelectorAll('.ui-model-picker__trigger-text')]
    .filter((el) => !el.closest('.prompt-edit-input'));
  return cursorCleanLabel(texts[texts.length - 1]?.textContent);
}

function cursorTileStatus(tile) {
  if (!tile) return null;
  const seg = [...tile.querySelectorAll('.glass-chat-status-bar__segment-label')]
    .map(e => cursorCleanLabel(e.textContent)).filter(Boolean);
  const follow = cursorCleanLabel(tile.querySelector('.agent-panel-followup-status-area')?.textContent) || '';
  const shimmer = tile.querySelector('.ui-collapsible-action.ui-collapsible-shimmer');
  const shimmerText = cursorCleanLabel(shimmer?.textContent) || '';
  const planning = /planning\s+next\s+move/i.test(shimmerText);
  const submits = [...tile.querySelectorAll('.ui-prompt-input-submit-button')]
    .filter((b) => !b.closest('.prompt-edit-input'));
  const submit = submits[submits.length - 1] || null;
  const generating = submits.some((b) => b.getAttribute('data-state') === 'stop');
  return {
    title: cursorCleanLabel(tile.querySelector('.chat-title-tab-title')?.textContent),
    model: cursorTileModel(tile),
    submit: {
      state: submit?.getAttribute('data-state'),
      label: submit?.getAttribute('aria-label'),
    },
    statusLabels: seg,
    followup: follow,
    planning,
    planningText: shimmerText || null,
    generating,
  };
}

function cursorAllTileStatus() {
  const tiles = [...document.querySelectorAll('.glass-agent-conversation-tiling__tile')];
  return {
    tileCount: tiles.length,
    anyPlanning: tiles.some(t => cursorTileStatus(t)?.planning),
    tiles: tiles.map((t, i) => ({ i, ...cursorTileStatus(t) })),
  };
}
