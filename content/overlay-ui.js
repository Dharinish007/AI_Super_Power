/**
 * Context Monitor - Context Widget (provider-neutral UI)
 *
 * Renders the view state from widget-state.js (toWidgetState). It knows nothing about any AI site:
 * the adapter supplies a name, `onRefresh()` and `getDiagnostics()`. Everything lives in a shadow
 * root, so the host page's CSS cannot reach it and ours never leaks out.
 *
 *   Collapsed (default)  pill "39.3K • Medium" — click expands, drag moves
 *   Expanded             header (drag handle: theme / collapse / close)
 *                        hero: token count, usage bar, window, model, limit line, warning
 *                        stats: You / <Site> + tools / Hidden
 *                        sections (closed by default): Breakdown, Hidden context, Usage limits, Diagnostics
 *                        footer: confidence, Copy diagnostics, Refresh
 *
 * Position: free drag (pointer events, translate3d), clamped to the viewport, snapped to the nearest
 * side on release (hold Alt to skip), anchored to that side so expanding never pushes it off screen.
 * Position, expanded state and theme persist per site in chrome.storage.local.
 * Components build their DOM once; updates write only what changed, and page-derived strings are
 * only ever assigned as text, never HTML.
 *
 * Header tabs: Context (above) | Capsules (CapsulePanel: create, edit, save, insert; see capsule.js)
 * | Skills (the same panel with kind 'skill': reusable instructions).
 */

import { CAPSULES_KEY, CAPSULE_HANDOFF_KEY, CapsuleStore, buildCapsulePrompt, parseCapsule, readLatestCapsule, latestReplyText, formatForInsert, insertText, chatLimitReached, readTranscript, buildQuickCapsule, formatTranscript, saveHandoff, readHandoff, clearHandoff, formatCost, exportCapsules, SKILLS_KEY, STARTER_SKILLS, formatSkillForInsert, projectsOf, searchItems, formatManyForInsert } from './capsule.js';
import { formatModelName, alertLevel, formatChatExport, chatIdFromHref, recordUsage } from './widget-state.js';
import { STYLES } from '../ui/styles.js';
import { h, iconButton, approx, TAG_TIPS, Section, RowList, HiddenStack, textButton, download, setText, setAttr, setClass, show, fmtK, fmtInt, tone, levelName, reducedMotion, limitText, headlineLimit, ICONS } from '../ui/dom.js';

const MARGIN = 8; // Viewport clamp
const TOP_SAFE = 72; // Default/snap top: below the sites' top bars (Share, account buttons)
const SNAP_Y = 48; // Snap to a top/bottom corner when released this close
const DRAG_THRESHOLD = 4; // Pointer movement that turns a press into a drag
const DEFAULT_POS = { side: 'right', dx: 16, y: TOP_SAFE };
const THEMES = ['auto', 'dark', 'light'];

/**
 * Capsules tab. Create fills the chat box with the Capsule prompt (the user sends it); while waiting,
 * a MutationObserver watches for the reply's END marker and opens it in the editor; Save stores it.
 * The saved list (one for all sites) has Insert / Copy / Edit / Delete.
 * With `kind: 'skill'` the same panel is the Skills tab: reusable instructions written by the user
 * (＋ New Skill, starter Skills on first open), no AI capture, no Update.
 * @param {HTMLElement} parent
 * @param {{ kind?: 'capsule'|'skill', provider: string, findInput: () => Element|null, replySelector: string|null,
 *   storage: Object|null, toast: (text: string) => void, reveal: () => void }} ctx
 */
function CapsulePanel(parent, ctx) {
  const isSkill = ctx.kind === 'skill';
  const noun = isSkill ? 'Skill' : 'Capsule';
  const fmt = isSkill ? formatSkillForInsert : formatForInsert; // Text that Insert / Copy / the cost use
  const view = h('div', 'body caps hide', parent);
  const store = ctx.storage ? new CapsuleStore(ctx.storage, isSkill ? { key: SKILLS_KEY, noun } : {}) : null;

  // The site's limit is reached: the AI here cannot write the Capsule
  const limitCard = h('div', 'card warn hide', view);
  limitCard.setAttribute('role', 'status');
  const limitText = h('div', 't', limitCard);
  h('div', 'm', limitCard, `${ctx.provider} can't write a Capsule right now. Use ⚡ Quick (no AI), or 🔀 make it in another AI.`);

  // A hand-off made on another chat or site, waiting to be pasted here
  const handoffCard = h('div', 'card hide', view);
  const handoffText = h('div', 't', handoffCard);
  h('div', 'm', handoffCard, `Paste it here, press Enter, and ${ctx.provider} writes the Capsule.`);
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
  h('div', 'm', wait, `Press Enter in the chat to send the prompt. The Capsule opens here when ${ctx.provider} has written it.`);
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
  const tokenCache = new Map(); // `${id}:${updatedAt}` -> estimated tokens

  let pendingSelection = '';
  let editing = null; // { id, source, fromHandoff } of the Capsule in the editor
  let watcher = null; // { observer, timer } while waiting for the reply
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

  /** Selection is read on press: the click itself may move focus away from the chat. */
  const takeSelection = () => {
    const s = (pendingSelection || String(window.getSelection?.() || '')).trim();
    pendingSelection = '';
    return s;
  };
  for (const b of [create, quickBtn, handoffBtn]) b.addEventListener('pointerdown', () => { pendingSelection = String(window.getSelection?.() || ''); });

  function stopWaiting() {
    if (!watcher) return;
    watcher.observer.disconnect();
    clearTimeout(watcher.timer);
    watcher = null;
    mode('idle');
  }

  /** Draft of a Capsule just written for a hand-off / update (`from`), or for this chat. */
  const draftFrom = (capsule, from) => openDraft({ ...capsule, id: from?.id, source: from?.source || ctx.provider }, Boolean(from?.handoff));

  /** @param {boolean} [fromHandoff] Saving it also clears the hand-off */
  function openDraft(capsule, fromHandoff = false) {
    stopWaiting();
    editing = { id: capsule.id || null, source: capsule.source || ctx.provider, fromHandoff };
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
   * @param {string|null} ignoreBody Capsule already on the page before this one was asked for
   * @param {{ source: string, id?: string, handoff?: boolean }|null} [from] Hand-off (keeps its original site)
   *   or Update (replaces Capsule `id`) being written
   */
  function startWaiting(ignoreBody, from = null) {
    stopWaiting();
    const check = () => {
      if (!watcher) return;
      watcher.timer = null;
      const capsule = readLatestCapsule(document, ctx.replySelector, ignoreBody);
      if (!capsule) return;
      draftFrom(capsule, from);
      ctx.reveal();
      ctx.toast('Capsule ready: review and save');
    };
    // At most one read per 500 ms while the reply streams; nothing runs when not waiting
    const observer = new MutationObserver(() => { if (watcher && !watcher.timer) watcher.timer = setTimeout(check, 500); });
    watcher = { observer, timer: null };
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    watcher.from = from;
    mode('waiting');
  }

  /** Fills the chat box with a prompt and waits for the Capsule in the reply. */
  function promptAndWait(prompt, from = null) {
    const input = ctx.findInput();
    if (!input) return ctx.toast('Chat box not found');
    const ignoreBody = readLatestCapsule(document, ctx.replySelector)?.body ?? null;
    if (!insertText(input, prompt)) return ctx.toast('Could not fill the chat box');
    startWaiting(ignoreBody, from);
    ctx.toast('Prompt ready: press Enter to send');
  }

  const chat = () => readTranscript(document, ctx.userSelector, ctx.replySelector);
  const copy = (capsule, done) => navigator.clipboard.writeText(fmt(capsule)).then(() => ctx.toast(done), () => ctx.toast('Copy failed'));

  create.addEventListener('click', () => {
    const selection = takeSelection();
    if (!ctx.replySelector || !document.querySelector(ctx.replySelector)) return ctx.toast('Open a conversation first');
    promptAndWait(buildCapsulePrompt(selection));
  });

  // Step 2: no AI. A selection is used as-is; otherwise goal + latest turns + code from the page
  quickBtn.addEventListener('click', () => {
    const selection = takeSelection();
    const capsule = selection
      ? { title: selection.split('\n').find(l => l.trim()).trim().slice(0, 60), body: selection }
      : buildQuickCapsule(chat());
    if (!capsule) return ctx.toast('Open a conversation first');
    openDraft({ ...capsule, source: ctx.provider });
  });

  // Step 3: the prompt plus this conversation wait in storage (and the clipboard) for another AI
  handoffBtn.addEventListener('click', async () => {
    const selection = takeSelection();
    const messages = chat();
    if (!messages.length) return ctx.toast('Open a conversation first');
    if (!ctx.storage) return ctx.toast('Storage unavailable');
    const prompt = buildCapsulePrompt(selection, formatTranscript(messages));
    try { await saveHandoff(ctx.storage, { prompt, source: ctx.provider }); } catch (_) { return ctx.toast('Hand-off failed'); }
    navigator.clipboard?.writeText(prompt).catch(() => {});
    ctx.toast('Ready: open another AI → Capsules → Paste & create');
  });

  textButton(handoffBtns, 'Paste & create', () => {
    if (handoff) promptAndWait(handoff.prompt, { source: handoff.source, handoff: true });
  });
  textButton(handoffBtns, 'Dismiss', async () => {
    try { await clearHandoff(ctx.storage); } catch (_) {}
    refresh();
  });

  textButton(waitBtns, 'Use last reply', () => {
    const capsule = parseCapsule(latestReplyText(document, ctx.replySelector), { loose: true });
    if (!capsule) return ctx.toast('No reply yet');
    const from = watcher?.from;
    draftFrom(capsule, from);
  });
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

  /** Estimated tokens of the text Insert puts in the chat (cached per Capsule version). */
  function tokensOf(capsule) {
    const key = `${capsule.id}:${capsule.updatedAt}`;
    if (!tokenCache.has(key)) {
      let n = null;
      try { n = ctx.countTokens ? ctx.countTokens(fmt(capsule)) : null; } catch (_) {}
      tokenCache.set(key, n);
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
    const tokens = tokensOf(capsule);
    if (tokens !== null) {
      const cost = formatCost(tokens, view_.contextLimit, view_.remaining);
      const line = h('div', `m${cost.tooBig ? ' bad' : ''}`, card, cost.tooBig ? `${cost.text} · too big for this chat` : cost.text);
      line.dataset.tip = 'Estimated with a local tokenizer; the site may count a little differently';
    }
    const btns = h('div', 'btns', card);
    textButton(btns, 'Insert', () => {
      const input = ctx.findInput();
      if (input && insertText(input, fmt(capsule))) ctx.toast(isSkill ? 'Skill added: write your question and send' : 'Inserted: add your question and send');
      else copy(capsule, 'Chat box not found: copied instead');
    });
    textButton(btns, 'Copy', () => copy(capsule, 'Copied'));
    // Update: this AI rewrites the Capsule with this chat's new progress; saving replaces it
    if (!isSkill) {
      const upd = textButton(btns, 'Update', () => {
        if (limit) return ctx.toast(`${ctx.provider}'s limit is reached: update it later, or edit by hand`);
        if (!ctx.replySelector || !document.querySelector(ctx.replySelector)) return ctx.toast('Open the chat with the new progress first');
        promptAndWait(buildCapsulePrompt(takeSelection(), '', capsule), { id: capsule.id, source: capsule.source });
      });
      upd.dataset.tip = `${ctx.provider} rewrites it with this chat's new progress`;
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
    const name = limit && (String(limit.key).startsWith('model:') ? formatModelName(limit.key.slice(6)) : limit.label || ctx.provider);
    if (limit) setText(limitText, `⚠️ ${name} limit reached${limit.resetIn ? ` · resets in ${limit.resetIn}` : ''}`);
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
  function updatePick() {
    for (const id of [...selected]) if (!items.some(c => c.id === id)) selected.delete(id); // Deleted elsewhere
    const picked = items.filter(c => selected.has(c.id));
    show(pick, picked.length > 0);
    if (!picked.length) return;
    setText(pickText, `☑️ ${picked.length} ${noun}${picked.length === 1 ? '' : 's'} picked`);
    let tokens = null;
    try { tokens = ctx.countTokens ? ctx.countTokens(formatManyForInsert(picked, ctx.kind)) : null; } catch (_) {}
    const cost = tokens === null ? null : formatCost(tokens, view_.contextLimit, view_.remaining);
    setText(pickCost, !cost ? '' : cost.tooBig ? `${cost.text} · too big for this chat`
      : `${cost.text}${view_.remaining !== null ? ` · ${fmtK(view_.remaining)} left` : ''}`);
    pickCost.classList.toggle('bad', Boolean(cost?.tooBig));
  }

  const pickedText = () => formatManyForInsert(items.filter(c => selected.has(c.id)), ctx.kind);
  textButton(pickBtns, 'Insert all', () => {
    const input = ctx.findInput();
    const text = pickedText();
    if (input && insertText(input, text)) {
      ctx.toast(`Inserted ${selected.size}: add your question and send`);
      selected.clear();
      renderList();
    } else {
      navigator.clipboard.writeText(text).then(() => ctx.toast('Chat box not found: copied instead'), () => ctx.toast('Copy failed'));
    }
  });
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

export class ContextWidget {
  /**
   * @param {{ provider?: string, findInput?: () => Element|null, replySelector?: string, onRefresh?: () => any, getDiagnostics?: () => Object }} [adapter]
   *   `findInput` finds the site's chat box and `replySelector` matches assistant replies (Capsules).
   */
  constructor(adapter = {}) {
    this.adapter = {
      provider: adapter.provider || 'AI',
      findInput: adapter.findInput || (() => null),
      replySelector: adapter.replySelector || null,
      userSelector: adapter.userSelector || null,
      countTokens: adapter.countTokens || null,
      onRefresh: adapter.onRefresh || (() => {}),
      getDiagnostics: adapter.getDiagnostics || (() => this.latestState?.diagnostics)
    };
    this.hostElement = null;
    this.shadowRoot = null;
    this.isExpanded = false;
    this.isVisible = true;
    this.tab = 'context';
    this.theme = 'auto';
    this.pos = { ...DEFAULT_POS };
    this.latestState = null;
    this._alerted = new Map();
    this.parts = null;
    this._shownTokens = null;
    this._countRaf = null;
    this._posRaf = null;
    this._drag = null;
    this._justDragged = false;
    this._storeKey = typeof location !== 'undefined' ? `ui:${location.hostname}` : 'ui';
    this._usageKey = typeof location !== 'undefined' ? `usage:${location.hostname}` : 'usage';
    this.compact = false; // Hero number as 61.3K instead of 61,302
    this.badges = true; // Usage % next to the chats in the site's sidebar
    this._usage = {};
  }

  mount() {
    if (this.hostElement || typeof document === 'undefined') return;
    document.getElementById('chatgpt-context-monitor-host')?.remove();
    const host = this.hostElement = document.createElement('div');
    host.id = 'chatgpt-context-monitor-host';
    // Fixed at the origin, moved only with transform (no layout work while dragging)
    host.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483000;contain:layout style;will-change:transform;';
    this.shadowRoot = host.attachShadow({ mode: 'open' });
    h('style', null, this.shadowRoot, STYLES);
    const root = h('div', 'root', this.shadowRoot);
    this.parts = { root, ...this._build(root) };
    (document.body || document.documentElement).appendChild(host);

    window.addEventListener('resize', () => this._schedulePosition());
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => this._applyTheme());
    // Alt+T shows/hides the panel on any page state
    window.addEventListener('keydown', (e) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyT') {
        e.preventDefault();
        this.isVisible = !this.isVisible;
        this.render();
      }
    }, true);
    // A Capsule saved or deleted on another site / tab shows up here too
    try {
      chrome.storage?.onChanged?.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes[CAPSULES_KEY] || changes[CAPSULE_HANDOFF_KEY]) this.parts?.caps.refresh();
        if (changes[SKILLS_KEY]) this.parts?.skills.refresh();
      });
    } catch (_) {}
    this.parts.caps.refresh();
    this.parts.skills.refresh();
    this._loadPrefs();
    this._startBadgeWatch();
    this.render();
  }

  _build(root) {
    const provider = this.adapter.provider;

    // Pill
    const pill = h('button', 'pill', root);
    pill.type = 'button';
    pill.setAttribute('aria-expanded', 'false');
    const pillDot = h('span', 'dot', pill);
    const pillNum = h('span', 'num', pill);
    h('span', 'sep', pill, '•');
    const pillLvl = h('span', 'lvl', pill);
    pill.addEventListener('click', () => {
      if (this._justDragged) { this._justDragged = false; return; }
      this._setExpanded(true);
    });

    // Panel
    const panel = h('div', 'panel', root);
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', `${provider} context usage`);
    const head = h('div', 'head', panel);
    head.tabIndex = 0;
    head.setAttribute('aria-label', 'Move panel: drag, or use arrow keys. Double-click to reset position.');
    const tabs = h('div', 'tabs', head);
    tabs.setAttribute('role', 'tablist');
    const tab = (label, key) => {
      const b = textButton(tabs, label, () => this._setTab(key), 'tab');
      b.setAttribute('role', 'tab');
      return b;
    };
    const tabContext = tab('Context', 'context');
    const tabCaps = tab('Capsules', 'capsules');
    const tabSkills = tab('Skills', 'skills');
    const themeBtn = iconButton(head, ICONS.auto, 'Theme: auto');
    const collapseBtn = iconButton(head, ICONS.collapse, 'Collapse');
    const closeBtn = iconButton(head, ICONS.close, 'Close (Alt+T to reopen)');
    themeBtn.b.addEventListener('click', () => {
      this.theme = THEMES[(THEMES.indexOf(this.theme) + 1) % THEMES.length];
      this._applyTheme();
      this._savePrefs();
    });
    collapseBtn.b.addEventListener('click', () => this._setExpanded(false));
    closeBtn.b.addEventListener('click', () => { this.isVisible = false; this.render(); });

    const body = h('div', 'body', panel);
    const hero = h('div', 'hero', body);
    const top = h('div', 'top', hero);
    const big = h('span', 'big', top, '—');
    h('span', 'unit', top, 'tokens');
    const pct = h('span', 'pct', top);
    const bar = h('div', 'bar', hero);
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', 'Context window used');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    const fill = h('b', null, bar);
    const meta = h('div', 'meta', hero);
    const windowText = h('span', null, meta);
    const windowBadge = approx(meta, 'Window size is not known for this model/plan');
    const modelText = h('span', 'model', meta);
    const limitLine = h('div', 'line', hero);
    const warnLine = h('div', 'line warn', hero);
    warnLine.setAttribute('role', 'status');
    // At 80% full: save the chat as a Capsule now, and continue in a new chat with it
    const saveCard = h('div', 'card warn hide', hero);
    const saveText = h('div', 't', saveCard);
    h('div', 'm', saveCard, 'Save it as a Capsule, then insert it in a new chat to keep going.');
    textButton(h('div', 'btns', saveCard), '📦 Save as Capsule', () => {
      this._setTab('capsules');
      this.parts.caps.capture();
    });

    const stats = h('div', 'stats', body);
    const stat = (label) => {
      const c = h('div', 'stat', stats);
      const k = h('div', 'k', c, label);
      return { k, v: h('div', 'v', c, '—') };
    };
    const sUser = stat('You');
    const sAsst = stat(`${provider} + tools`);
    const sHidden = stat('Hidden');

    const brk = Section(body, 'Breakdown');
    const brkRows = RowList(brk.body);
    h('div', 'divider', brk.body);
    const totals = RowList(brk.body);

    const bigSec = Section(body, 'Biggest messages');
    const bigRows = RowList(bigSec.body);
    h('div', 'fine', bigSec.body, 'The largest turns in this chat. Trim them, or save them to a file, to free room.');
    const exportBtns = h('div', 'btns', bigSec.body);
    const exportChat = (format) => {
      const msgs = readTranscript(document, this.adapter.userSelector, this.adapter.replySelector);
      if (!msgs.length) return this._toast('Open a conversation first');
      download(bigSec.body, 'chat', format, formatChatExport(msgs, format, { provider }), format === 'json' ? 'application/json' : 'text/plain');
      this._toast(`Exported ${msgs.length} messages shown on the page`, 2500);
    };
    for (const [label, format] of [['📄 Markdown', 'md'], ['📝 Text', 'txt'], ['🧾 JSON', 'json']]) {
      textButton(exportBtns, label).addEventListener('click', () => exportChat(format));
    }

    const growth = Section(body, 'Growth');
    const spark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    spark.setAttribute('viewBox', '0 0 200 40');
    spark.setAttribute('preserveAspectRatio', 'none');
    spark.setAttribute('class', 'spark');
    spark.setAttribute('role', 'img');
    const sparkLine = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    spark.appendChild(sparkLine);
    growth.body.appendChild(spark);
    const growthText = h('div', 'fine', growth.body);

    const att = Section(body, 'Attachments');
    const attRows = RowList(att.body);
    h('div', 'fine', att.body, 'Images use an estimate; documents the site reads server-side have no known cost here.');

    const hid = Section(body, 'Hidden context');
    const hidStack = HiddenStack(hid.body);
    h('div', 'fine', hid.body, `Read from ${provider}'s own data. ≈ marks estimates; anything else ${provider} adds on its servers is not visible.`);

    const lim = Section(body, 'Usage limits');
    const limRows = RowList(lim.body);

    const diag = Section(body, 'Diagnostics');
    const diagWarn = h('div', 'line warn', diag.body);
    const diagRows = RowList(diag.body);
    const evidence = h('ul', 'evidence', diag.body);
    h('div', 'fine', diag.body, 'Counts visible text, hidden context the site exposes, and estimates where it does not. Everything runs in your browser: nothing is sent anywhere.');

    const display = Section(body, 'Display');
    const displayBtns = h('div', 'btns', display.body);
    const compactBtn = textButton(displayBtns, '', () => { this.compact = !this.compact; this._savePrefs(); this.render(); });
    const badgesBtn = textButton(displayBtns, '', () => { this.badges = !this.badges; this._savePrefs(); this._paintBadges(); this.render(); });

    const panelCtx = {
      provider,
      findInput: () => this.adapter.findInput(),
      replySelector: this.adapter.replySelector,
      userSelector: this.adapter.userSelector,
      countTokens: this.adapter.countTokens,
      storage: this._storage(),
      toast: (text) => this._toast(text),
      reveal: () => {
        this.isVisible = true;
        this._setTab('capsules');
        if (!this.isExpanded) this._setExpanded(true);
      }
    };
    const caps = CapsulePanel(panel, panelCtx);
    const skills = CapsulePanel(panel, { ...panelCtx, kind: 'skill' });

    const foot = h('div', 'foot', panel);
    const conf = h('div', 'conf', foot);
    const confDot = h('span', 'dot', conf);
    const confText = h('span', null, conf);
    const copyBtn = iconButton(foot, ICONS.copy, 'Copy diagnostics');
    const refreshBtn = iconButton(foot, ICONS.refresh, 'Refresh');
    copyBtn.b.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(JSON.stringify(this.adapter.getDiagnostics() || { note: 'no state yet' }, null, 2));
        this._toast('Diagnostics copied');
      } catch (_) {
        this._toast('Copy failed');
      }
    });
    refreshBtn.b.addEventListener('click', async () => {
      if (refreshBtn.b.disabled) return;
      refreshBtn.b.disabled = true;
      refreshBtn.b.classList.add('spin');
      try { await this.adapter.onRefresh(); } catch (_) { /* the next automatic pass still updates */ } finally {
        refreshBtn.b.disabled = false;
        refreshBtn.b.classList.remove('spin');
      }
    });

    const toast = h('div', 'toast', root);
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    const tip = h('div', 'tip', root);
    tip.setAttribute('aria-hidden', 'true');

    // Tooltips for anything with data-tip (bar segments, badges, icon buttons)
    root.addEventListener('pointerover', (e) => {
      const t = e.target.closest?.('[data-tip]');
      if (t && !this._drag?.moved) this._showTip(t);
    });
    root.addEventListener('pointerout', (e) => { if (e.target.closest?.('[data-tip]')) tip.classList.remove('show'); });
    root.addEventListener('focusin', (e) => { if (e.target.dataset?.tip) this._showTip(e.target); });
    root.addEventListener('focusout', () => tip.classList.remove('show'));

    // Drag from the pill or the header (never from a header button)
    for (const handle of [pill, head]) {
      handle.addEventListener('pointerdown', (e) => this._dragStart(e, handle));
      handle.addEventListener('pointermove', (e) => this._dragMove(e));
      handle.addEventListener('pointerup', (e) => this._dragEnd(e));
      handle.addEventListener('pointercancel', (e) => this._dragEnd(e));
    }
    head.addEventListener('dblclick', (e) => {
      if (e.target.closest('button')) return;
      this.pos = { ...DEFAULT_POS };
      this._position();
      this._savePrefs();
    });
    head.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 40 : 10;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!d || e.target !== head) return;
      e.preventDefault();
      const { x, y } = this._xy();
      this._settle(x + d[0], y + d[1], false);
    });
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isExpanded) { e.stopPropagation(); this._setExpanded(false); pill.focus(); }
    });

    return {
      pill, pillDot, pillNum, pillLvl, panel, bigRows, spark, sparkLine, growthText, attRows, att, compactBtn, badgesBtn, head, tabContext, tabCaps, tabSkills, body, foot, caps, skills, themeBtn, big, pct, bar, fill, windowText, windowBadge, modelText, limitLine, warnLine,
      saveCard, saveText, sUser, sAsst, sHidden, brkRows, totals, hid, hidStack, lim, limRows, diagWarn, diagRows, evidence, confDot, confText, toast, tip
    };
  }

  /** @param {Object} viewState Output of toWidgetState() */
  update(viewState) {
    this.latestState = viewState;
    if (!this.hostElement) this.mount();
    this._maybeAlert(viewState);
    this._trackUsage(viewState);
    this.parts?.caps.setView(viewState);
    this.parts?.skills.setView(viewState);
    // SPA re-renders can drop our node; re-attach instead of rebuilding
    if (!this.hostElement.isConnected) (document.body || document.documentElement).appendChild(this.hostElement);
    this.render();
  }

  render() {
    if (!this.hostElement || !this.parts) return;
    const display = this.isVisible ? '' : 'none';
    if (this.hostElement.style.display !== display) this.hostElement.style.display = display;
    const p = this.parts;
    this._applyTheme();
    setClass(p.root, `root${this._isDark() ? '' : ' light'}${this.isExpanded ? ' open' : ''}${this._drag?.moved ? ' dragging' : ''}`);
    show(p.pill, !this.isExpanded);
    show(p.panel, this.isExpanded);
    setAttr(p.pill, 'aria-expanded', String(this.isExpanded));
    const onContext = this.tab === 'context';
    show(p.body, onContext);
    show(p.foot, onContext);
    show(p.caps.view, this.tab === 'capsules');
    show(p.skills.view, this.tab === 'skills');
    setAttr(p.tabContext, 'aria-selected', String(onContext));
    setAttr(p.tabCaps, 'aria-selected', String(this.tab === 'capsules'));
    setAttr(p.tabSkills, 'aria-selected', String(this.tab === 'skills'));

    const vm = this.latestState || { ready: false, usedTokens: 0, percentage: null, evidence: [], breakdown: [], hiddenItems: [], limits: [], confidenceLevel: 'LOW', confidence: 0, provider: this.adapter.provider, model: 'Detecting…' };
    const lvl = vm.ready === false ? 'LOW' : vm.confidenceLevel;
    setClass(p.pillDot, `dot ${lvl}`);
    setText(p.pillNum, vm.ready === false ? '…' : fmtK(vm.usedTokens));
    setText(p.pillLvl, vm.ready === false ? 'Reading' : levelName(vm.confidenceLevel));
    setAttr(p.pill, 'aria-label', vm.ready === false
      ? 'Context usage: reading conversation. Expand panel.'
      : `Context usage ${fmtInt(vm.usedTokens)} tokens${vm.percentage !== null ? `, ${vm.percentage}% of window` : ''}, confidence ${levelName(vm.confidenceLevel)}. Expand panel.`);

    if (this.isExpanded) this._renderPanel(vm);
    this._schedulePosition();
  }

  _renderPanel(vm) {
    const p = this.parts;
    const ready = vm.ready !== false;
    this._countTo(ready ? vm.usedTokens : null);
    setText(p.pct, ready && vm.percentage !== null ? `${vm.percentage === 0 && vm.usedTokens > 0 ? '<0.1' : vm.percentage}%` : '');
    const known = ready && vm.percentage !== null;
    setClass(p.bar, `bar ${known ? tone(vm.percentage) : 'unknown'}`.trim());
    const width = known ? `${Math.min(100, vm.percentage)}%` : '';
    if (p.fill.style.width !== width) p.fill.style.width = width;
    if (known) setAttr(p.bar, 'aria-valuenow', String(vm.percentage)); else p.bar.removeAttribute('aria-valuenow');
    setText(p.windowText, !ready ? 'Reading conversation…' : vm.contextLimit ? `of ${fmtK(vm.contextLimit)} window${vm.exchangesLeft !== null && vm.exchangesLeft !== undefined ? ` · ~${vm.exchangesLeft} exchanges left` : ''}` : 'window unknown');
    show(p.windowBadge, ready && (!vm.contextLimit || vm.limitStatus !== 'VERIFIED'));
    p.windowBadge.dataset.tip = vm.contextLimit ? TAG_TIPS.UNVERIFIED : `Window size is not known${vm.plan ? '' : ' (plan not detected)'}`;
    const model = [vm.model, vm.modelFamily].filter(Boolean).join(' · ');
    setText(p.modelText, model);
    setAttr(p.modelText, 'title', `${vm.provider}: ${model}`);
    const head = headlineLimit(vm.limits);
    setText(p.limitLine, head ? `${head.key === 'session' ? 'Session' : head.label} ${limitText(head)}` : '');
    setText(p.warnLine, vm.warning || '');
    const full = ready && vm.percentage !== null && alertLevel(vm.percentage) >= 80;
    show(p.saveCard, full);
    if (full) setText(p.saveText, `💡 This chat is ${vm.percentage}% full`);

    const st = vm.stats || { user: 0, assistant: 0, hidden: 0 };
    setText(p.sUser.v, ready ? fmtK(st.user) : '—');
    setText(p.sAsst.v, ready ? fmtK(st.assistant) : '—');
    setText(p.sHidden.v, ready ? fmtK(st.hidden) : '—');

    const tokens = (n) => (!ready || n === null || n === undefined ? '—' : `${n.toLocaleString()}`);
    p.brkRows.update((vm.breakdown || []).map(b => ({ label: b.label, value: b.value, tip: b.tag ? b.why || TAG_TIPS[b.tag] || b.tag : null, mark: b.tag === 'EXACT' || b.tag === 'OBSERVED' ? '✓' : undefined })));
    p.bigRows.update((vm.biggest || []).map(m => ({ label: `#${m.turn} ${m.role === 'user' ? 'You' : vm.provider}: ${m.preview.slice(0, 32)}`, value: fmtK(m.tokens) })));
    this._renderSpark(vm, ready);
    show(p.att.el, (vm.attachmentFiles || []).length > 0);
    p.attRows.update((vm.attachmentFiles || []).map(f => ({
      label: f.name,
      value: f.tokens !== null ? `~${f.tokens.toLocaleString()}` : f.inText ? 'in message text' : 'cost unknown'
    })));
    setText(p.compactBtn, `Exact numbers: ${this.compact ? 'off' : 'on'}`);
    setText(p.badgesBtn, `Sidebar badges: ${this.badges ? 'on' : 'off'}`);
    p.totals.update([
      { label: 'Used', value: tokens(vm.usedTokens) },
      { label: 'Remaining', value: tokens(vm.remainingTokens) },
      { label: 'Window', value: vm.contextLimit ? vm.contextLimit.toLocaleString() : 'Unknown', tip: vm.contextLimit && vm.limitStatus === 'VERIFIED' ? null : (vm.contextLimit ? TAG_TIPS.UNVERIFIED : TAG_TIPS.UNKNOWN) }
    ]);

    const items = vm.hiddenItems || [];
    show(p.hid.el, items.length > 0);
    p.hidStack.update(items);
    show(p.lim.el, (vm.limits || []).length > 0);
    p.limRows.update((vm.limits || []).map(l => ({ label: l.label, value: limitText(l) })));

    setText(p.diagWarn, vm.warning || '');
    p.diagRows.update([
      { label: 'Provider', value: vm.provider },
      { label: 'Model', value: model || '—' },
      { label: 'Plan', value: vm.plan || 'Unknown' },
      { label: 'Source', value: vm.source || '—' },
      { label: 'Turns', value: ready ? String(vm.turns) : '—' }
    ]);
    const evSig = JSON.stringify(vm.evidence || []);
    if (p.evidence.dataset.sig !== evSig) {
      p.evidence.dataset.sig = evSig;
      p.evidence.textContent = '';
      for (const e of vm.evidence || []) {
        const li = h('li', null, p.evidence);
        h('span', e.ok ? 'y' : 'n', li, e.ok ? '✓' : '!');
        h('span', null, li, e.text);
      }
    }
    setClass(p.confDot, `dot ${ready ? vm.confidenceLevel : 'LOW'}`);
    setText(p.confText, ready ? `${levelName(vm.confidenceLevel)} confidence · ${vm.confidence}%` : 'Reading…');
  }

  /** Token count animates from the last shown value (instant with reduced motion). */
  _countTo(target) {
    const el = this.parts.big;
    if (this._countRaf) cancelAnimationFrame(this._countRaf);
    if (target === null) { setText(el, '—'); this._shownTokens = null; return; }
    const from = this._shownTokens;
    if (from === null || from === target || reducedMotion() || typeof requestAnimationFrame !== 'function') {
      this._shownTokens = target;
      setText(el, this._num(target));
      return;
    }
    const start = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - start) / 400);
      const v = from + (target - from) * (1 - Math.pow(1 - k, 3));
      setText(el, this._num(v));
      this._shownTokens = k < 1 ? v : target;
      this._countRaf = k < 1 ? requestAnimationFrame(step) : null;
    };
    this._countRaf = requestAnimationFrame(step);
  }

  _setExpanded(open) {
    this.isExpanded = open;
    this.render();
    this._savePrefs();
    if (open) this.parts.head.focus({ preventScroll: true });
  }

  /** @param {'context'|'capsules'|'skills'} key */
  _setTab(key) {
    if (this.tab !== key && key === 'capsules') this.parts.caps.refresh();
    if (this.tab !== key && key === 'skills') this.parts.skills.refresh();
    this.tab = key;
    this.render();
    this._savePrefs();
  }

  _toast(text, ms = 1500) {
    const t = this.parts.toast;
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  _num(n) { return this.compact ? fmtK(Math.round(n)) : fmtInt(n); }

  /** Tokens by turn as a line, scaled to the window when known (so the slope reads as "how fast it fills"). */
  _renderSpark(vm, ready) {
    const { spark, sparkLine, growthText } = this.parts;
    const g = ready ? vm.growth : null;
    if (!g || g.points.length < 2) {
      sparkLine.setAttribute('points', '');
      setText(growthText, 'Appears after a few messages.');
      return;
    }
    const top = Math.max(vm.contextLimit || 0, g.total) || 1;
    const pts = g.points.map((v, i) => `${((i / (g.points.length - 1)) * 200).toFixed(1)},${(38 - (v / top) * 36).toFixed(1)}`).join(' ');
    if (sparkLine.getAttribute('points') !== pts) sparkLine.setAttribute('points', pts);
    spark.setAttribute('aria-label', `Message tokens by turn: ${fmtInt(g.total)} over ${g.turns} turns`);
    setText(growthText, `${g.turns} turns · ${fmtInt(g.total)} message tokens${vm.contextLimit ? ` of ${fmtK(vm.contextLimit)}` : ''}`);
  }

  /** Remembers this chat's usage and shows it next to the chat in the sidebar. */
  _trackUsage(vm) {
    if (!vm.ready || !vm.conversationId || vm.percentage === null) return;
    const before = this._usage[vm.conversationId]?.pct;
    this._usage = recordUsage(this._usage, vm.conversationId, vm.percentage);
    if (this._usage[vm.conversationId]?.pct === before) return;
    this._paintBadges();
    clearTimeout(this._usageTimer);
    this._usageTimer = setTimeout(() => {
      try { this._storage()?.set({ [this._usageKey]: this._usage }).catch(() => {}); } catch (_) {}
    }, 1000);
  }

  _paintBadges() {
    const links = document.querySelectorAll('a[href*="/c/"], a[href*="/chat/"], a[href*="/app/"]');
    const inChat = [this.adapter.replySelector, this.adapter.userSelector].filter(Boolean).join(',');
    for (const a of links) {
      let badge = a.querySelector(':scope > [data-ctx-badge]');
      const id = this.badges && !(inChat && a.closest(inChat)) ? chatIdFromHref(a.getAttribute('href')) : null;
      const u = id && this._usage[id];
      if (!u) { badge?.remove(); continue; }
      if (!badge) {
        badge = document.createElement('span');
        badge.setAttribute('data-ctx-badge', '');
        badge.style.cssText = 'flex:none;margin-left:6px;padding:0 5px;border:1px solid currentColor;border-radius:4px;font:600 10px/16px system-ui,sans-serif;opacity:.75;';
        a.appendChild(badge);
      }
      const text = `${u.pct}%`;
      if (badge.textContent !== text) badge.textContent = text;
      badge.title = `Context ${text} full (Context Monitor)`;
      const color = u.pct > 85 ? '#F87171' : u.pct >= 60 ? '#FBBF24' : '';
      if (badge.style.color !== color) badge.style.color = color;
    }
  }

  _startBadgeWatch() {
    this._storage()?.get(this._usageKey).then((r) => {
      if (r?.[this._usageKey] && typeof r[this._usageKey] === 'object') this._usage = { ...r[this._usageKey], ...this._usage };
      this._paintBadges();
    }).catch(() => {});
    // The site re-renders its sidebar constantly: repaint at most every 400 ms, only when something changed
    this._badgeObserver = new MutationObserver(() => {
      if (this._badgeTimer) return;
      this._badgeTimer = setTimeout(() => { this._badgeTimer = null; this._paintBadges(); }, 400);
    });
    this._badgeObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

  /** One toast per chat when usage first reaches 80% and again at 95%; never repeats for the same step. */
  _maybeAlert(vm) {
    if (!vm.ready || vm.percentage === null) return;
    const lvl = alertLevel(vm.percentage);
    const key = vm.conversationId || '';
    if (lvl <= (this._alerted.get(key) || 0)) return;
    this._alerted.set(key, lvl);
    this._toast(lvl === 95
      ? `Context ${vm.percentage}% full: start a new chat soon`
      : `Context ${vm.percentage}% full: consider wrapping up`, 4000);
    if (!reducedMotion()) this.parts.bar.animate?.([{ transform: 'scaleY(1)' }, { transform: 'scaleY(2.2)' }, { transform: 'scaleY(1)' }], { duration: 700, iterations: 2 });
  }

  _showTip(target) {
    const { tip, root } = this.parts;
    tip.textContent = target.dataset.tip;
    const r = target.getBoundingClientRect();
    const rr = root.getBoundingClientRect();
    tip.classList.add('show');
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let left = r.left - rr.left + r.width / 2 - tw / 2;
    left = Math.max(4, Math.min(left, rr.width - tw - 4));
    let top = r.top - rr.top - th - 6;
    if (r.top - th - 6 < 0) top = r.bottom - rr.top + 6; // No room above: show below
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }

  // ------------------------------------------------------------------ theme

  _isDark() {
    if (this.theme === 'dark') return true;
    if (this.theme === 'light') return false;
    return Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  }

  _applyTheme() {
    if (!this.parts) return;
    const { root, themeBtn } = this.parts;
    root.classList.toggle('light', !this._isDark());
    const label = `Theme: ${this.theme}`;
    if (themeBtn.b.getAttribute('aria-label') !== label) {
      themeBtn.b.setAttribute('aria-label', label);
      themeBtn.b.dataset.tip = label;
      themeBtn.path.setAttribute('d', ICONS[this.theme]);
    }
  }

  // ------------------------------------------------------------------ drag & position

  _dragStart(e, handle) {
    if (e.button !== 0 || (handle === this.parts.head && e.target.closest('button'))) return;
    const { x, y } = this._xy();
    this._drag = { id: e.pointerId, handle, sx: e.clientX, sy: e.clientY, x0: x, y0: y, x, y, moved: false };
    try { handle.setPointerCapture(e.pointerId); } catch (_) {}
  }

  _dragMove(e) {
    const d = this._drag;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return; // Still a click
      d.moved = true;
      this.parts.tip.classList.remove('show');
      this.parts.root.classList.add('dragging');
      document.documentElement.style.userSelect = 'none';
    }
    e.preventDefault();
    d.x = d.x0 + dx;
    d.y = d.y0 + dy;
    if (!this._posRaf) this._posRaf = requestAnimationFrame(() => { this._posRaf = null; this._applyXY(d.x, d.y); });
  }

  _dragEnd(e) {
    const d = this._drag;
    if (!d || e.pointerId !== d.id) return;
    try { d.handle.releasePointerCapture(d.id); } catch (_) {}
    this._drag = null;
    if (!d.moved) return;
    this._justDragged = d.handle === this.parts.pill; // Swallow the click that follows a pill drag
    this.parts.root.classList.remove('dragging');
    document.documentElement.style.userSelect = '';
    this._settle(d.x, d.y, !e.altKey && e.type !== 'pointercancel', true);
  }

  /**
   * Stores a position given as top-left x/y: anchored to the nearer side, optionally snapped to that
   * side (and to a top/bottom corner when close), then applied and saved.
   */
  _settle(x, y, snap, animate = false) {
    const { w, h: ht } = this._size();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const side = x + w / 2 < vw / 2 ? 'left' : 'right';
    let dx = side === 'left' ? x : vw - w - x;
    if (snap) {
      dx = 16;
      if (Math.abs(y - TOP_SAFE) < SNAP_Y) y = TOP_SAFE;
      else if (Math.abs(vh - ht - MARGIN - y) < SNAP_Y) y = vh - ht - MARGIN;
    }
    // Store what is shown: the clamped position, so collapsing/reloading never jumps
    dx = Math.max(MARGIN, Math.min(dx, vw - w - MARGIN));
    y = Math.max(MARGIN, Math.min(y, vh - ht - MARGIN));
    this.pos = { side, dx, y };
    if (animate && !reducedMotion()) {
      this.hostElement.style.transition = 'transform .15s ease';
      setTimeout(() => { if (this.hostElement) this.hostElement.style.transition = ''; }, 170);
    }
    this._position();
    this._savePrefs();
  }

  _size() {
    const el = this.isExpanded ? this.parts.panel : this.parts.pill;
    const r = el.getBoundingClientRect();
    return { w: r.width || (this.isExpanded ? 320 : 150), h: r.height || 32 };
  }

  /** Current top-left from the stored side-anchored position. */
  _xy() {
    const { w } = this._size();
    const x = this.pos.side === 'left' ? this.pos.dx : window.innerWidth - w - this.pos.dx;
    return { x, y: this.pos.y };
  }

  _applyXY(x, y) {
    const { w, h: ht } = this._size();
    const cx = Math.round(Math.max(MARGIN, Math.min(x, window.innerWidth - w - MARGIN)));
    const cy = Math.round(Math.max(MARGIN, Math.min(y, window.innerHeight - ht - MARGIN)));
    const t = `translate3d(${cx}px, ${cy}px, 0)`;
    if (this.hostElement.style.transform !== t) this.hostElement.style.transform = t;
  }

  _position() {
    if (!this.hostElement || !this.parts || this._drag?.moved) return;
    const { x, y } = this._xy();
    this._applyXY(x, y);
  }

  /** One layout pass per frame for resizes and content changes. */
  _schedulePosition() {
    if (this._posRaf || typeof requestAnimationFrame !== 'function') return this._position();
    this._posRaf = requestAnimationFrame(() => { this._posRaf = null; this._position(); });
  }

  // ------------------------------------------------------------------ preferences

  _storage() {
    try { return typeof chrome !== 'undefined' ? chrome.storage?.local || null : null; } catch (_) { return null; }
  }

  _loadPrefs() {
    const store = this._storage();
    if (!store) return;
    try {
      store.get(this._storeKey).then((r) => {
        const s = r?.[this._storeKey];
        if (!s || typeof s !== 'object') return;
        if (s.pos && ['left', 'right'].includes(s.pos.side) && Number.isFinite(s.pos.dx) && Number.isFinite(s.pos.y)) this.pos = s.pos;
        if (THEMES.includes(s.theme)) this.theme = s.theme;
        if (['context', 'capsules', 'skills'].includes(s.tab)) this.tab = s.tab;
        this.isExpanded = Boolean(s.expanded);
        this.compact = Boolean(s.compact);
        this.badges = s.badges !== false;
        this.render();
      }).catch(() => {});
    } catch (_) {}
  }

  _savePrefs() {
    const store = this._storage();
    if (!store) return;
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      try { store.set({ [this._storeKey]: { pos: this.pos, expanded: this.isExpanded, theme: this.theme, tab: this.tab, compact: this.compact, badges: this.badges } }).catch(() => {}); } catch (_) {}
    }, 200);
  }

  unmount() {
    this._badgeObserver?.disconnect();
    this.parts?.caps.stop();
    this.parts?.skills.stop();
    this.hostElement?.remove();
    this.hostElement = null;
    this.shadowRoot = null;
    this.parts = null;
  }
}
