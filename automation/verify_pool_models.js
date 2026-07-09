(async () => {
  const TARGETS = __TARGETS__;
  const AGENT_ID = __AGENT_ID__;
  const log = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let agentId = AGENT_ID || agentIdOfTile(tileAt(0));
  if (!agentId) {
    focusEditorIn(0);
    await sleep(200);
    agentId = agentIdOfTile(tileAt(0));
  }
  if (!agentId) return { error: 'no agentId', log };

  const results = [];
  function labelOk(target, after) {
    if (/^auto$/i.test(String(target || '').trim())) return /^auto/i.test(after || '');
    const escaped = String(target).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(escaped, 'i').test(after || '');
  }
  for (const target of TARGETS) {
    if (/^auto$/i.test(String(target || '').trim())) {
      const r = await selectModelByAgent(agentId, /^auto/i);
      results.push({ target, ...r });
      log.push({ target, ...r });
      continue;
    }
    const r = await selectTargetModelByAgent(agentId, target);
    const after =
      modelTriggerIn(idxByAgentId(agentId))
        ?.querySelector('.ui-model-picker__trigger-text')
        ?.textContent?.trim() || '';
    const ok = !r.error && labelOk(target, after);
    results.push({ target, ok, after, ...r });
    log.push({ target, ok, after, ...r });
    await sleep(400);
  }

  const allOk = results.every((r) => /^auto$/i.test(r.target) ? !r.error : r.ok);
  return {
    ok: allOk,
    agentId,
    results,
    log,
    snapshot: snapshot(),
  };
})()
