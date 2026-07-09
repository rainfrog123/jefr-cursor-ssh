(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const TILE = __TILE__;

  // Cursor sometimes appends ZWSP / "Edit" affordance text to row labels.
  const stripEdit = (t) =>
    t
      .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
      .replace(/\s*Edit\s*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();

  const tiled = [...document.querySelectorAll('.glass-agent-conversation-tiling__tile')];
  const shell = document.querySelector('.agent-panel-conversation-shell');
  const roots = tiled.length > 0 ? tiled : shell ? [shell] : [];
  const ti = TILE >= 0 ? TILE : roots.length - 1;
  const t = roots[ti];
  if (!t) return { error: 'no tile or conversation shell', tileCount: tiled.length };

  const ed = t.querySelector('.tiptap.ProseMirror.ui-prompt-input-editor__input');
  ed?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  ed?.focus();
  ed?.click();
  await sleep(120);

  const currentRaw = t.querySelector('.ui-model-picker__trigger-text')?.textContent || '';
  const current = stripEdit(currentRaw);
  const trigger = t.querySelector('.ui-model-picker__trigger');
  if (!trigger) return { error: 'no model picker', tile: ti, current };

  trigger.click();
  await sleep(550);

  const autoRow = [...document.querySelectorAll('[role^="menuitem"],[role="option"]')].find(
    (e) => e.offsetParent && /^auto/i.test(stripEdit(e.textContent || '')),
  );
  const sw = autoRow?.querySelector('button,[role="switch"],input[type="checkbox"]');
  const autoOn =
    sw &&
    (sw.getAttribute('aria-checked') === 'true' || sw.getAttribute('data-state') === 'checked');
  if (autoOn && sw) {
    sw.click();
    await sleep(600);
    trigger.click();
    await sleep(550);
  }

  const skipLabel = (label) =>
    !label ||
    /^auto$/i.test(label) ||
    /^add models?$/i.test(label) ||
    /^max mode$/i.test(label) ||
    /^search models$/i.test(label);

  const rows = [...document.querySelectorAll('[role="menuitem"]')]
    .filter((el) => el.offsetParent)
    .map((el) => {
      const content = el.querySelector('.ui-model-picker__item-content')?.textContent?.trim();
      return stripEdit(content || el.textContent || '');
    })
    .filter((label) => !skipLabel(label));

  const seen = new Set();
  const models = rows.filter((label) => {
    if (seen.has(label)) return false;
    seen.add(label);
    return true;
  });

  // Auto is a toggle in the picker, not a row — still offer it in the workflow UI.
  const withAuto = ['Auto', ...models];

  trigger.click();
  await sleep(100);

  return {
    tile: ti,
    tileCount: tiled.length,
    mode: tiled.length > 0 ? 'tiled' : 'single-pane',
    current,
    models: withAuto,
    hasAutoToggle: !!autoRow,
    autoWasOn: !!autoOn,
  };
})()
