/**
 * Context Monitor - Capsules / Skills panel
 *
 * Moved out of content/overlay-ui.js. It touches the AI site only through `ctx.page` (the Page
 * interface, content/page-actions.js), so it runs the same in the page or in the side panel.
 */

import { CapsuleStore, buildCapsulePrompt, parseCapsule, formatForInsert, chatLimitReached, quickCapsule, formatTranscript, saveHandoff, readHandoff, clearHandoff, formatCost, exportCapsules, SKILLS_KEY, STARTER_SKILLS, formatSkillForInsert, projectsOf, searchItems, formatManyForInsert } from '../content/capsule.js';
import { formatModelName } from '../content/widget-state.js';
import { h, textButton, download, setText, show, fmtK } from './dom.js';

/**
 * Capsules tab. Create fills the chat box with the Capsule prompt (the user sends it); while waiting,
 * page.watchCapsule watches for the reply's END marker and opens it in the editor; Save stores it.
 * The saved list (one for all sites) has Insert / Copy / Edit / Delete.
 * With `kind: 'skill'` the same panel is the Skills tab: reusable instructions written by the user
 * (＋ New Skill, starter Skills on first open), no AI capture, no Update.
 * @param {HTMLElement} parent
 * @param {{ kind?: 'capsule'|'skill', page: Object, storage: Object|null, toast: (text: string) => void, reveal: () => void }} ctx
 *   `page`: the Page interface (content/page-actions.js); every call is async
 */
export function CapsulePanel(parent, ctx) {
  const isSkill = ctx.kind === 'skill';
  const provider = ctx.page.provider;
  const noun = isSkill ? 'Skill' : 'Capsule';
  const fmt = isSkill ? formatSkillForInsert : formatForInsert; // Text that Insert / Copy / the cost use
  const view = h('div', 'body caps hide', parent);
  const store = ctx.storage ? new CapsuleStore(ctx.storage, isSkill ? { key: SKILLS_KEY, noun } : {}) : null;

  // The site's limit is reached: the AI here cannot write the Capsule
  const limitCard = h('div', 'card warn hide', view);
  limitCard.setAttribute('role', 'status');
  const limitTextEl = h('div', 't', limitCard);
  h('div', 'm', limitCard, `${provider} can't write a Capsule right now. Use ⚡ Quick (no AI), or 🔀 make it in another AI.`);

  // A hand-off made on another chat or site, waiting to be pasted here
  const handoffCard = h('div', 'card hide', view);
  const handoffText = h('div', 't', handoffCard);
  h('div', 'm', handoffCard, `Paste it here, press Enter, and ${provider} writes the Capsule.`);
  const handoffBtns = h('div', 'btns', handoffCard);

  const create = textButton(view, '📦 Create Capsule', null, 'btn primary');
  const alt = h('div', 'btns', view);
  const quickBtn = textButton(alt, '⚡ Quick (no AI)');
  quickBtn.dataset.tip = 'Build it from this chat without any AI: goal, latest turns, code';
  const handoffBtn = textButton(alt, '🔀 Make in another AI');
  handoffBtn.dataset.tip = 'Copy this chat with the Capsule prompt; paste it into another AI that still has messages left';
  const hint = h('div', 'fine', view, 'Select part of the chat first to capture only that part.');

  // Skills tab: written by the user
  const newBtn = textButton(view, '＋ New Skill', () => openDraft({ source: 'You' }), 'btn primary');
  const skillHint = h('div', 'fine', view, 'Insert adds to what is already in the chat box: insert a Capsule, then a Skill, and send them together.');

  const wait = h('div', 'card wait hide', view);
  wait.setAttribute('role', 'status');
  h('div', 't', wait, 'Waiting for the Capsule…');
  h('div', 'm', wait, `Press Enter in the chat to send the prompt. The Capsule opens here when ${provider} has written it.`);
  const waitBtns = h('div', 'btns', wait);

  const draft = h('div', 'card hide', view);
  const titleIn = h('input', 'field', draft);
  titleIn.placeholder = isSkill ? 'Skill name, e.g. Code reviewer' : 'Title';
  titleIn.maxLength = 80;
  titleIn.setAttribute('aria-label', `${noun} title`);
  const metaRow = h('div', 'two', draft);
  const projectIn = h('input', 'field', metaRow);
  projectIn.placeholder = '📁 Project';
  projectIn.maxLength = 40;
  projectIn.setAttribute('aria-label', `${noun} project`);
  const projectList = h('datalist', null, draft); // Suggests the projects already in use
  projectList.id = `${ctx.kind || 'capsule'}-projects`;
  projectIn.setAttribute('list', projectList.id);
  const tagsIn = h('input', 'field', metaRow);
  tagsIn.placeholder = '🏷️ Tags: work, auth';
  tagsIn.setAttribute('aria-label', `${noun} tags, separated by commas`);
  const bodyIn = h('textarea', 'field', draft);
  bodyIn.spellcheck = false;
  bodyIn.setAttribute('aria-label', `${noun} text`);
  if (isSkill) bodyIn.placeholder = 'How the AI should answer, e.g. "Review my code like a senior developer. Bugs first, be short."';
  const draftBtns = h('div', 'btns', draft);

  // Library: search (every word must match; #tag = tags only) and a project filter
  const searchRow = h('div', 'two hide', view);
  const searchIn = h('input', 'field', searchRow);
  searchIn.type = 'search';
  searchIn.placeholder = `🔍 Search ${noun}s… (#tag)`;
  searchIn.setAttribute('aria-label', `Search ${noun}s`);
  const projectSel = h('select', 'field', searchRow);
  projectSel.setAttribute('aria-label', 'Show one project');

  const listHead = h('div', 'caps-h hide', view);
  const list = h('div', 'caps', view);
  list.style.padding = '0';
  const noMatch = h('div', 'fine hide', view, 'No matches. Try fewer words, or "All projects".');
  const empty = h('div', 'fine', view, isSkill
    ? 'No Skills yet. A Skill is an instruction you reuse, like "Explain simply". Add one, then insert it into any AI.'
    : 'No Capsules yet. Create one here, then insert it into ChatGPT, Claude or Gemini.');
  const io = h('div', 'btns', view);
  const exportBtn = textButton(io, '📤 Export');
  exportBtn.dataset.tip = `Download all ${noun}s as a JSON file (backup, or move to another PC)`;
  const importBtn = textButton(io, '📥 Import');
  importBtn.dataset.tip = `Add ${noun}s from an exported file; newer copies replace older ones`;
  const fileIn = h('input', 'hide', view);
  fileIn.type = 'file';
  fileIn.accept = '.json,application/json';
  fileIn.setAttribute('aria-label', `${noun}s file to import`);

  // Ticked items: one insert for all of them, with what it costs here
  const pick = h('div', 'card pick hide', view);
  pick.setAttribute('role', 'status');
  const pickText = h('div', 't', pick);
  const pickCost = h('div', 'm', pick);
  const pickBtns = h('div', 'btns', pick);
  let query = '';
  let projectFilter = '';
  const selected = new Set(); // Ticked ids; kept while the list re-renders

  let items = []; // Saved Capsules (or Skills), newest first
  let seeded = false; // Skills: starters offered once per page (CapsuleStore.seed skips a list already written)
  let view_ = { sig: null, contextLimit: null, remaining: null }; // This chat's window, for cost lines
  const tokenCache = new Map(); // `${id}:${updatedAt}` -> Promise of the estimated tokens

  let pendingSelection = null; // Promise of the selection read on press
  let editing = null; // { id, source, fromHandoff } of the Capsule in the editor
  let watcher = null; // { from, stop } while waiting for the reply
  let current = 'idle';
  let limit = null; // Limit that blocks chatting here (chatLimitReached)
  let handoff = null; // Waiting hand-off (readHandoff)

  const mode = (m) => {
    current = m;
    const idle = m === 'idle';
    const capture = idle && !isSkill; // AI capture exists only for Capsules
    show(limitCard, capture && Boolean(limit));
    show(handoffCard, capture && Boolean(handoff));
    show(create, capture);
    show(alt, capture);
    show(hint, capture);
    show(newBtn, idle && isSkill);
    show(skillHint, idle && isSkill);
    show(wait, m === 'waiting');
    show(draft, m === 'draft');
  };

  /** A click handler that calls the page: a failed call (page gone) shows a toast instead of throwing. */
  const onPage = (fn) => (...args) => fn(...args).catch((e) => { console.warn('[Context Monitor]', e); ctx.toast('Page not reachable'); });
  /** Estimated tokens of a text: a number, or null when it can't be counted (never rejects). */
  const countOne = (text) => Promise.resolve().then(() => ctx.page.countTokens([text()])).then(r => (typeof r?.[0] === 'number' ? r[0] : null));

  /** Selection is read on press: the click itself may move focus away from the chat. */
  const takeSelection = async () => {
    const pending = pendingSelection;
    pendingSelection = null;
    return (await pending) || ctx.page.takeSelection();
  };
  for (const b of [create, quickBtn, handoffBtn]) b.addEventListener('pointerdown', () => { pendingSelection = ctx.page.takeSelection().catch(() => ''); });

  function stopWaiting() {
    if (!watcher) return;
    watcher.stop();
    watcher = null;
    mode('idle');
  }

  /** Draft of a Capsule just written for a hand-off / update (`from`), or for this chat. */
  const draftFrom = (capsule, from) => openDraft({ ...capsule, id: from?.id, source: from?.source || provider }, Boolean(from?.handoff));

  /** @param {boolean} [fromHandoff] Saving it also clears the hand-off */
  function openDraft(capsule, fromHandoff = false) {
    stopWaiting();
    editing = { id: capsule.id || null, source: capsule.source || provider, fromHandoff };
    titleIn.value = capsule.title || '';
    bodyIn.value = capsule.body || '';
    // An Update's new text has no tags or project: the saved item's win. A new one starts in the
    // project being shown.
    const stored = capsule.id ? items.find(c => c.id === capsule.id) : null;
    tagsIn.value = ((stored || capsule).tags || []).join(', ');
    projectIn.value = stored ? (stored.project || '') : (capsule.project || projectFilter);
    projectList.textContent = '';
    for (const p of projectsOf(items)) h('option', null, projectList).value = p;
    mode('draft');
    bodyIn.scrollTop = 0;
    titleIn.focus({ preventScroll: true });
  }

  /**
   * Waits for the Capsule in the reply (the one already on the page is ignored).
   * @param {{ source: string, id?: string, handoff?: boolean }|null} [from] Hand-off (keeps its original site)
   *   or Update (replaces Capsule `id`) being written
   */
  async function startWaiting(from = null) {
    stopWaiting();
    const w = watcher = { from, stop: () => {} };
    mode('waiting');
    let stop;
    try {
      stop = await ctx.page.watchCapsule((capsule) => {
        if (watcher !== w) return;
        draftFrom(capsule, from);
        ctx.reveal();
        ctx.toast('Capsule ready: review and save');
      });
    } catch (e) {
      if (watcher === w) { watcher = null; mode('idle'); }
      throw e;
    }
    if (watcher === w) w.stop = stop; else stop(); // Cancelled (or found) while the watch started
  }

  /** Fills the chat box with a prompt and waits for the Capsule in the reply. */
  async function promptAndWait(prompt, from = null) {
    if (!(await ctx.page.fill(prompt))) return ctx.toast('Chat box not found');
    await startWaiting(from);
    ctx.toast('Prompt ready: press Enter to send');
  }

  const copy = (capsule, done) => navigator.clipboard.writeText(fmt(capsule)).then(() => ctx.toast(done), () => ctx.toast('Copy failed'));

  create.addEventListener('click', onPage(async () => {
    const selection = await takeSelection();
    if (!(await ctx.page.hasConversation())) return ctx.toast('Open a conversation first');
    await promptAndWait(buildCapsulePrompt(selection));
  }));

  // Step 2: no AI. A selection is used as-is; otherwise goal + latest turns + code from the page
  quickBtn.addEventListener('click', onPage(async () => {
    const selection = await takeSelection();
    const capsule = await quickCapsule(selection, () => ctx.page.transcript());
    if (!capsule) return ctx.toast('Open a conversation first');
    openDraft({ ...capsule, source: provider });
  }));

  // Step 3: the prompt plus this conversation wait in storage (and the clipboard) for another AI
  handoffBtn.addEventListener('click', onPage(async () => {
    const selection = await takeSelection();
    const messages = await ctx.page.transcript();
    if (!messages.length) return ctx.toast('Open a conversation first');
    if (!ctx.storage) return ctx.toast('Storage unavailable');
    const prompt = buildCapsulePrompt(selection, formatTranscript(messages));
    try { await saveHandoff(ctx.storage, { prompt, source: provider }); } catch (_) { return ctx.toast('Hand-off failed'); }
    navigator.clipboard?.writeText(prompt).catch(() => {});
    ctx.toast('Ready: open another AI → Capsules → Paste & create');
  }));

  textButton(handoffBtns, 'Paste & create', onPage(async () => {
    if (handoff) await promptAndWait(handoff.prompt, { source: handoff.source, handoff: true });
  }));
  textButton(handoffBtns, 'Dismiss', async () => {
    try { await clearHandoff(ctx.storage); } catch (_) {}
    refresh();
  });

  textButton(waitBtns, 'Use last reply', onPage(async () => {
    const w = watcher;
    const capsule = parseCapsule(await ctx.page.latestReply(), { loose: true });
    if (watcher !== w) return; // Cancelled, or the Capsule arrived, meanwhile
    if (!capsule) return ctx.toast('No reply yet');
    draftFrom(capsule, w?.from);
  }));
  textButton(waitBtns, 'Cancel', stopWaiting);

  textButton(draftBtns, 'Save', async () => {
    if (!store) return ctx.toast('Storage unavailable');
    try {
      await store.save({ id: editing?.id, source: editing?.source, title: titleIn.value, body: bodyIn.value, tags: tagsIn.value, project: projectIn.value });
      if (editing?.fromHandoff) await clearHandoff(ctx.storage);
    } catch (e) {
      return ctx.toast(e?.message === `${noun} is empty` ? e.message : 'Save failed');
    }
    editing = null;
    mode('idle');
    ctx.toast(`${noun} saved`);
    refresh();
  });
  textButton(draftBtns, 'Discard', () => { editing = null; mode('idle'); });

  // Keys typed in the editor or search stay there: the sites move focus to their chat box on stray keystrokes
  for (const type of ['keydown', 'keypress', 'keyup']) {
    view.addEventListener(type, (e) => { if (e.key !== 'Escape' && e.target.matches?.('input, textarea, select')) e.stopPropagation(); });
  }

  /** Estimated tokens of the text Insert puts in the chat (cached per Capsule version; a failed count is retried). */
  function tokensOf(capsule) {
    const key = `${capsule.id}:${capsule.updatedAt}`;
    if (!tokenCache.has(key)) {
      tokenCache.set(key, countOne(() => fmt(capsule)).catch(() => { tokenCache.delete(key); return null; }));
    }
    return tokenCache.get(key);
  }

  function renderItem(capsule) {
    const card = h('div', `card${selected.has(capsule.id) ? ' on' : ''}`, list);
    const th = h('div', 'th', card);
    const box = h('input', null, th);
    box.type = 'checkbox';
    box.checked = selected.has(capsule.id);
    box.setAttribute('aria-label', `Pick "${capsule.title}" to insert together with others`);
    box.addEventListener('change', () => {
      if (box.checked) selected.add(capsule.id); else selected.delete(capsule.id);
      card.classList.toggle('on', box.checked);
      updatePick();
    });
    h('div', 't', th, capsule.title);
    const pinLabel = capsule.pinned ? 'Unpin' : 'Pin to the top';
    const pin = textButton(th, '📌', async () => {
      try { await store.setPinned(capsule.id, !capsule.pinned); } catch (_) { return ctx.toast('Pin failed'); }
      refresh();
    }, `pin${capsule.pinned ? ' on' : ''}`);
    pin.setAttribute('aria-pressed', String(Boolean(capsule.pinned)));
    pin.setAttribute('aria-label', pinLabel);
    pin.dataset.tip = pinLabel;
    const date = new Date(capsule.updatedAt || capsule.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    h('div', 'm', card, `${capsule.source} · ${date}${capsule.project ? ` · 📁 ${capsule.project}` : ''}`);
    if (capsule.tags?.length) {
      const tagRow = h('div', 'tags', card);
      for (const t of capsule.tags) {
        const chip = textButton(tagRow, `#${t}`, () => { searchIn.value = query = `#${t}`; renderList(); }, 'chip');
        chip.setAttribute('aria-label', `Show only #${t}`);
      }
    }
    // Cost line: filled in when the count arrives
    const line = h('div', 'm hide', card);
    line.dataset.tip = 'Estimated with a local tokenizer; the site may count a little differently';
    tokensOf(capsule).then((tokens) => {
      if (tokens === null) return;
      const cost = formatCost(tokens, view_.contextLimit, view_.remaining);
      line.className = `m${cost.tooBig ? ' bad' : ''}`;
      line.textContent = cost.tooBig ? `${cost.text} · too big for this chat` : cost.text;
    });
    const btns = h('div', 'btns', card);
    textButton(btns, 'Insert', onPage(async () => {
      if (await ctx.page.fill(fmt(capsule))) ctx.toast(isSkill ? 'Skill added: write your question and send' : 'Inserted: add your question and send');
      else copy(capsule, 'Chat box not found: copied instead');
    }));
    textButton(btns, 'Copy', () => copy(capsule, 'Copied'));
    // Update: this AI rewrites the Capsule with this chat's new progress; saving replaces it
    if (!isSkill) {
      const upd = textButton(btns, 'Update', onPage(async () => {
        if (limit) return ctx.toast(`${provider}'s limit is reached: update it later, or edit by hand`);
        if (!(await ctx.page.hasConversation())) return ctx.toast('Open the chat with the new progress first');
        await promptAndWait(buildCapsulePrompt(await takeSelection(), '', capsule), { id: capsule.id, source: capsule.source });
      }));
      upd.dataset.tip = `${provider} rewrites it with this chat's new progress`;
    }
    textButton(btns, 'Edit', () => openDraft(capsule));
    const del = textButton(btns, 'Delete', async () => {
      if (!del.dataset.armed) {
        del.dataset.armed = '1';
        del.textContent = 'Sure?';
        setTimeout(() => { delete del.dataset.armed; del.textContent = 'Delete'; }, 3000);
        return;
      }
      try { await store.remove(capsule.id); } catch (_) { return ctx.toast('Delete failed'); }
      ctx.toast('Deleted');
      refresh();
    }, 'btn danger');
  }

  /** @param {Object} vm Widget view state: limits, and this chat's window for the cost lines */
  function setView(vm) {
    limit = chatLimitReached(vm?.limits);
    const contextLimit = vm?.contextLimit || null;
    const remaining = Number.isFinite(vm?.remainingTokens) ? vm.remainingTokens : null;
    // Cost lines change with the window or the room left (to the nearest 1K): re-render only then
    const sig = `${contextLimit}|${remaining === null ? '' : Math.round(remaining / 1000)}`;
    if (sig !== view_.sig) {
      view_ = { sig, contextLimit, remaining };
      renderList();
    }
    // "GPT-5 limit reached" (not "Messages · gpt-5"), "Session (5h) limit reached", "Gemini usage limit reached"
    const name = limit && (String(limit.key).startsWith('model:') ? formatModelName(limit.key.slice(6)) : limit.label || provider);
    if (limit) setText(limitTextEl, `⚠️ ${name} limit reached${limit.resetIn ? ` · resets in ${limit.resetIn}` : ''}`);
    mode(current);
  }

  async function refresh() {
    if (!store) return;
    if (isSkill && !seeded) {
      seeded = true;
      try { await store.seed(STARTER_SKILLS); } catch (_) {}
    }
    try {
      handoff = isSkill ? null : await readHandoff(ctx.storage);
    } catch (_) { handoff = null; }
    const mins = handoff ? Math.round((Date.now() - handoff.at) / 60000) : 0;
    if (handoff) setText(handoffText, `📨 Hand-off from ${handoff.source} · ${mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`}`);
    mode(current);
    try { items = await store.list(); } catch (_) { return; }
    renderList();
  }

  function renderList() {
    // Project filter: options follow the projects in use; a project that no longer exists resets it
    const projects = projectsOf(items);
    if (projectSel.dataset.sig !== projects.join('\n')) {
      projectSel.dataset.sig = projects.join('\n');
      projectSel.textContent = '';
      h('option', null, projectSel, 'All projects').value = '';
      for (const p of projects) h('option', null, projectSel, `📁 ${p}`).value = p;
      if (!projects.includes(projectFilter)) projectFilter = '';
      projectSel.value = projectFilter;
    }
    show(projectSel, projects.length > 0);

    const shown = searchItems(items, query, { project: projectFilter || null });
    list.textContent = '';
    setText(listHead, query.trim() || projectFilter ? `Found ${shown.length} of ${items.length}` : `Saved (${items.length})`);
    show(listHead, items.length > 0);
    show(searchRow, items.length > 0);
    show(empty, items.length === 0);
    show(noMatch, items.length > 0 && shown.length === 0);
    show(exportBtn, items.length > 0);
    for (const c of shown) renderItem(c);
    updatePick();
  }

  searchIn.addEventListener('input', () => { query = searchIn.value; renderList(); });
  projectSel.addEventListener('change', () => { projectFilter = projectSel.value; renderList(); });

  /** Footer for the ticked items: count, cost of inserting them together, room left. */
  async function updatePick() {
    for (const id of [...selected]) if (!items.some(c => c.id === id)) selected.delete(id); // Deleted elsewhere
    const picked = items.filter(c => selected.has(c.id));
    show(pick, picked.length > 0);
    if (!picked.length) return;
    setText(pickText, `☑️ ${picked.length} ${noun}${picked.length === 1 ? '' : 's'} picked`);
    const tokens = await countOne(() => formatManyForInsert(picked, ctx.kind)).catch(() => null);
    const cost = tokens === null ? null : formatCost(tokens, view_.contextLimit, view_.remaining);
    setText(pickCost, !cost ? '' : cost.tooBig ? `${cost.text} · too big for this chat`
      : `${cost.text}${view_.remaining !== null ? ` · ${fmtK(view_.remaining)} left` : ''}`);
    pickCost.classList.toggle('bad', Boolean(cost?.tooBig));
  }

  const pickedText = () => formatManyForInsert(items.filter(c => selected.has(c.id)), ctx.kind);
  textButton(pickBtns, 'Insert all', onPage(async () => {
    const text = pickedText();
    if (await ctx.page.fill(text)) {
      ctx.toast(`Inserted ${selected.size}: add your question and send`);
      selected.clear();
      renderList();
    } else {
      navigator.clipboard.writeText(text).then(() => ctx.toast('Chat box not found: copied instead'), () => ctx.toast('Copy failed'));
    }
  }));
  textButton(pickBtns, 'Copy', () => navigator.clipboard.writeText(pickedText()).then(() => ctx.toast('Copied'), () => ctx.toast('Copy failed')));
  textButton(pickBtns, 'Clear', () => { selected.clear(); renderList(); });

  // Export: one JSON file with every Capsule
  exportBtn.addEventListener('click', () => {
    download(view, store.key, 'json', exportCapsules(items, store.key), 'application/json');
    ctx.toast(`Exported ${items.length} ${noun}${items.length === 1 ? '' : 's'}`);
  });

  // Import: merge a file from Export (newer copies win; invalid entries skipped)
  importBtn.addEventListener('click', () => fileIn.click());
  fileIn.addEventListener('change', async () => {
    const file = fileIn.files?.[0];
    fileIn.value = '';
    if (!file || !store) return;
    try {
      const r = await store.importMany(await file.text());
      ctx.toast(`${r.added} added, ${r.updated} updated, ${r.skipped} skipped`);
      refresh();
    } catch (e) {
      ctx.toast(e?.message === `Not a ${noun}s file` ? e.message : 'Import failed');
    }
  });

  // Capture this chat from outside the tab (Context tab "Save as Capsule"): the AI writes it, or
  // Quick (no AI) when the site's limit is reached
  const capture = () => (limit ? quickBtn : create).click();

  return { view, refresh, setView, capture, stop: stopWaiting };
}
