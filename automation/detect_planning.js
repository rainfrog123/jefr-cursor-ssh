(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const PROMPT = 'say hi';
  const tiles = () => [...document.querySelectorAll('.glass-agent-conversation-tiling__tile')];
  const tileAt = i => tiles()[i] ?? null;

  const readStatus = (t) => {
    const labels = [...t.querySelectorAll('.glass-chat-status-bar__segment-label')]
      .map(e => e.textContent?.trim()).filter(Boolean);
    const follow = t.querySelector('.agent-panel-followup-status-area')?.textContent?.trim() || '';
    const combined = [...labels, follow].join(' ');
    const planning = /planning\s+next\s+move/i.test(combined) || /planning\s+next\s+move/i.test(t.innerText || '');
    return { labels, follow, combined, planning };
  };

  // use last tile (or tile with Auto model)
  let idx = tiles().length - 1;
  let target = tileAt(idx);
  const lastModelText = (t) => {
    const texts = [...t.querySelectorAll('.ui-model-picker__trigger-text')]
      .filter((el) => !el.closest('.prompt-edit-input'));
    return texts[texts.length - 1]?.textContent?.trim() || '';
  };
  const lastModelTrigger = (t) => {
    const all = [...t.querySelectorAll('.ui-model-picker__trigger')]
      .filter((tr) => !tr.closest('.prompt-edit-input'));
    return all[all.length - 1] || null;
  };
  const autoIdx = tiles().findIndex(t => lastModelText(t) === 'Auto');
  if (autoIdx >= 0) { idx = autoIdx; target = tileAt(idx); }

  const eds = [...(target?.querySelectorAll('.tiptap.ProseMirror.ui-prompt-input-editor__input') || [])]
    .filter((e) => !e.closest('.prompt-edit-input'));
  const ed = eds[eds.length - 1];
  if (!ed) return { error: 'no editor', idx };
  ed.focus(); ed.click();
  await sleep(80);

  const mt = lastModelTrigger(target);
  if (mt && mt.querySelector('.ui-model-picker__trigger-text')?.textContent?.trim() !== 'Auto') {
    mt.click(); await sleep(250);
    const auto = [...document.querySelectorAll('[role^="menuitem"],[role="option"]')]
      .filter(e => e.offsetParent).find(e => /^auto/i.test(e.textContent.trim()));
    if (auto) auto.click();
    await sleep(200); ed.focus();
    target = tileAt(idx) ?? target;
  }

  document.execCommand('selectAll', false, null);
  document.execCommand('insertText', false, PROMPT);
  await sleep(100);
  const send = target.querySelector('.ui-prompt-input-submit-button');
  if (!send || send.getAttribute('data-state') === 'stop') return { error: 'cannot send' };
  send.click();

  const log = [];
  let sawPlanning = false;
  let firstPlanningAt = null;
  for (let i = 0; i < 80; i++) {
    await sleep(200);
    const t = tileAt(idx) ?? tiles().at(-1);
    const s = readStatus(t);
    if (s.planning && !sawPlanning) { sawPlanning = true; firstPlanningAt = i * 200; }
    if (i % 5 === 0 || s.planning) log.push({ ms: i * 200, ...s });
    const stop = t?.querySelector('.ui-prompt-input-submit-button[data-state="stop"]');
    if (!stop && i > 10) break; // generation ended
  }
  return { idx, sawPlanning, firstPlanningAt, log: log.slice(-15) };
})()
