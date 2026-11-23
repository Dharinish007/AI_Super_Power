/**
 * Context Monitor - Coordinator for provider adapters (Claude, Gemini)
 *
 * Same pipeline and widget as ChatGPT, fed by a provider adapter (content/providers.js):
 *   saved conversation (adapter API, when it has one) or the page  ->  live page turns merged in
 *   ->  model / plan evidence reconciled  ->  published context window  ->  tokens (ESTIMATED)
 *   ->  confidence + context intelligence  ->  widget + toolbar badge
 * ChatGPT keeps its own coordinator (content-main.js); nothing here runs on ChatGPT.
 */

import { Tokenizer } from '../engine/tokenizer.js';
import { ContextCalculator } from '../engine/context-calculator.js';
import { EvidenceMerger, EvidenceType } from '../engine/evidence-merger.js';
import { Widgets } from './widgets.js';
import { toWidgetState } from './widget-state.js';
import { servePanel } from './panel-channel.js';
import { mergeLiveTurns } from './turn-merger.js';
import { ChatGPTDOMObserver } from './chatgpt-dom.js';
import { invalidateText, trustTextCache } from './providers.js';
import { conversationRef, diagnosticsSnapshot, limitEvidence, addIntelligence } from './coordinator-common.js';

const API_TTL_MS = 60000; // Saved copy stays fresh for a minute; a reply finishing re-reads it at once
const EMPTY_RETRY_MS = 3000; // A saved copy with no turns yet (brand-new chat) is read again this soon
const API_BACKOFF_MS = 15000; // After a failed read, wait before trying again (Refresh skips this)

/**
 * Page turns newer than the saved copy (just sent, or a reply still being written), so they count at
 * once instead of after the next saved-copy read (up to API_TTL_MS later).
 * Counting turns only works when the page shows the whole chat (Claude). Gemini renders just the turns
 * scrolled into view, so the page is also aligned on the last saved user message: everything after it,
 * past the saved turns that follow it, is new. The larger of the two answers wins.
 * @param {Array<{ role: string, text: string }>} savedMessages
 * @param {Array<{ role: string, text: string }>} dom Page turns, in order
 * @returns {Array<Object>}
 */
export function unsavedPageTurns(savedMessages, dom) {
  const saved = savedMessages.filter(m => m.role !== 'tool');
  const byCount = dom.length > saved.length ? dom.slice(saved.length) : [];
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  let lastUser = -1;
  for (let i = saved.length - 1; i >= 0; i--) if (saved[i].role === 'user') { lastUser = i; break; }
  if (lastUser === -1) return byCount;
  const text = norm(saved[lastUser].text);
  let onPage = -1;
  for (let i = dom.length - 1; i >= 0; i--) if (dom[i].role === 'user' && norm(dom[i].text) === text) { onPage = i; break; }
  const byText = onPage === -1 ? [] : dom.slice(onPage + 1 + (saved.length - 1 - lastUser));
  return byText.length > byCount.length ? byText : byCount;
}

export class ProviderCoordinator {
  /** @param {Object} provider Adapter from content/providers.js */
  constructor(provider) {
    this.provider = provider;
    this.tokenizer = new Tokenizer();
    this.overlayUI = new Widgets({
      provider: provider.name,
      findInput: () => provider.findInput(document),
      replySelector: provider.replySelector,
      userSelector: provider.userSelector,
      // Same count as the context: the site's own tokenizer once loaded, else o200k scaled to it (Claude counts more)
      countTokens: (text) => {
        const { encoding, scale } = this._counting();
        return Math.round(this.tokenizer.countTokens(text, encoding) * scale);
      }
    });
    this.domObserver = null;
    this.latestState = null;
    this.activeConversationId = null;
    this._runSeq = 0;
    this._api = null; // { conversationId, result, at } last successful saved-conversation read
    this._apiFailure = null; // { conversationId, error, at }
    this._apiInFlight = null;
    this._wasStreaming = false;
    this._sessionStartTokens = new Map();
    this._sendBadge = () => {}; // Toolbar badges removed per design simplification
    this._activeOrgId = undefined;
    this._streamLimits = null;
    this._accountLimits = null;
    this._accountLimitsAt = 0;
  }

  init() {
    this.overlayUI.mount();
    this.domObserver = new ChatGPTDOMObserver({
      onChange: (event) => this.handleDOMChange(event),
      composerSelector: this.provider.inputSelector,
      // Changed elements drop their cached text; unchanged messages are reused without re-reading
      onMutations: (records) => { for (const r of records) invalidateText(r.target); }
    });
    trustTextCache(true);
    this.domObserver.start();
    this.tokenizer.warm(); // Build the BPE tables while the first read is in flight
    this._loadSiteTokenizer();
    this._listenForLimits();
    this._fetchAccountLimits();
    // The side panel reads this tab through one port: view state is pushed, Page calls come back
    if (typeof chrome !== 'undefined' && chrome.runtime?.onConnect) {
      this.panel = servePanel({
        runtime: chrome.runtime,
        page: this.overlayUI.page,
        getState: () => this._lastViewState || toWidgetState(null, { provider: this.provider.name }),
        actions: { refresh: () => this.refresh(), diagnostics: () => this.getDiagnostics() }
      });
    }
  }

  /**
   * The site's own tokenizer (adapter `tokenizer`, e.g. Gemma 4 on Gemini), loaded from the extension
   * package once and built in ~8 ms slices; o200k counts until it is ready, then the chat is recounted.
   */
  async _loadSiteTokenizer() {
    const t = this.provider.tokenizer;
    if (!t || typeof chrome === 'undefined' || !chrome.runtime?.getURL) return;
    try {
      const buffer = await (await fetch(chrome.runtime.getURL(t.file))).arrayBuffer();
      const counter = t.create(buffer);
      while (!counter.build(8)) await new Promise(resolve => setTimeout(resolve, 0));
      this.tokenizer.useCounter(t.name, counter);
      this.handleDOMChange();
    } catch (err) {
      console.warn(`[Context Monitor] ${this.provider.name} tokenizer unavailable, counting with o200k:`, err);
    }
  }

  /** Encoding to count with, its correction factor, and whether it is the model's own tokenizer. */
  _counting(modelRaw = null) {
    const t = this.provider.tokenizer;
    if (t && this.tokenizer.resolveEncoding(t.name) === t.name) {
      return { encoding: t.name, scale: 1, exact: t.exactFor ? t.exactFor(modelRaw) : true };
    }
    return { encoding: 'o200k_base', scale: this.provider.tokenScale || 1, exact: false };
  }

  /** Same-origin JSON GET with the page's cookies; throws on HTTP errors. */
  async _fetchJson(path) {
    const res = await fetch(path, { credentials: 'include', headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    return res.json();
  }

  /**
   * Saved conversation through the adapter's API: cached per conversation, one read at a time,
   * backed off after a failure. Returns { result, error, fromCache }.
   */
  async _readApi(conversationId, force = false) {
    if (!this.provider.hasApi || !conversationId) return { result: null, error: null };
    const fresh = this._api && this._api.conversationId === conversationId && Date.now() - this._api.at < API_TTL_MS;
    if (!force && fresh) return { result: this._api.result, error: null, fromCache: true };
    const failed = this._apiFailure && this._apiFailure.conversationId === conversationId && Date.now() - this._apiFailure.at < API_BACKOFF_MS;
    if (!force && failed) return { result: this._keptCopy(conversationId), error: this._apiFailure.error };
    if (!force && this._apiInFlight?.conversationId === conversationId) return this._apiInFlight.promise;

    const promise = (async () => {
      try {
        const result = await this.provider.fetchConversation(conversationId, (p) => this._fetchJson(p));
        if (!result) throw new Error('Conversation API unavailable');
        // A just-created chat is read before its first turns are saved: an empty copy is retried after
        // EMPTY_RETRY_MS instead of being served as fresh for the whole TTL
        const at = result.messages.length ? Date.now() : Date.now() - API_TTL_MS + EMPTY_RETRY_MS;
        this._api = { conversationId, result, at };
        this._apiFailure = null;
        if (!result.messages.length) this._retryLater(conversationId, EMPTY_RETRY_MS);
        return { result, error: null };
      } catch (err) {
        const tries = this._apiFailure?.conversationId === conversationId ? this._apiFailure.tries + 1 : 1;
        this._apiFailure = { conversationId, error: err.message || 'Conversation API failed', at: Date.now(), tries };
        // Re-read without waiting for a page change (a quiet page would otherwise keep the failure):
        // 15 s, 30 s, 60 s … up to 2 minutes
        this._retryLater(conversationId, Math.min(API_BACKOFF_MS * 2 ** (tries - 1), 120000));
        return { result: this._keptCopy(conversationId), error: this._apiFailure.error };
      } finally {
        if (this._apiInFlight?.promise === promise) this._apiInFlight = null;
      }
    })();
    this._apiInFlight = { conversationId, promise };
    return promise;
  }

  /** One pending re-read per tab, dropped if the user has moved to another conversation. */
  _retryLater(conversationId, ms) {
    clearTimeout(this._retryTimer);
    this._retryTimer = setTimeout(() => {
      if (globalThis.location && this.provider.conversationId(location.href) === conversationId) this.handleDOMChange();
    }, ms);
    this._retryTimer?.unref?.(); // Node (tests) only: a pending retry never keeps the process alive
  }

  /** Last good copy of this conversation (used when a later read fails). */
  _keptCopy(conversationId) {
    return this._api && this._api.conversationId === conversationId ? this._api.result : null;
  }

  async refresh() {
    await this._fetchAccountLimits(true);
    await this.handleDOMChange({ isRefresh: true, forceApi: true });
  }

  _conversationRef(id) {
    return conversationRef(this.tokenizer, id);
  }

  getDiagnostics() {
    const currentRef = this._conversationRef(this.provider.conversationId(location.href));
    return diagnosticsSnapshot(this.latestState, currentRef, { provider: this.provider.name });
  }

  _getOrgScope() {
    const p = this.provider;
    return typeof p.getOrgId === 'function' ? p.getOrgId() : null;
  }

  _limitKey(suffix = '') {
    const p = this.provider;
    const org = this._getOrgScope();
    const base = org ? `limits:${p.name}:${org}` : `limits:${p.name}`;
    return suffix ? `${base}:${suffix}` : base;
  }

  _loadStoredLimits() {
    const p = this.provider;
    if (!p.limitStreamSource) return;
    const store = typeof chrome !== 'undefined' ? chrome.storage?.local : null;
    if (!store) return;
    const key = this._limitKey();
    const accountKey = this._limitKey('account');
    const fallbackStreamKey = `limits:${p.name}`;
    const fallbackAccountKey = `limits:${p.name}:account`;

    store.get([key, accountKey, fallbackStreamKey, fallbackAccountKey]).then(r => {
      const streamData = r?.[key] || r?.[fallbackStreamKey];
      if (streamData && (!this._streamLimits || (streamData.at || 0) >= (this._streamLimits.at || 0))) {
        this._streamLimits = streamData;
      }
      const accountData = r?.[accountKey] || r?.[fallbackAccountKey];
      if (accountData && (!this._accountLimits || (accountData.at || 0) >= (this._accountLimitsAt || 0))) {
        this._accountLimits = accountData.limits;
        this._accountLimitsAt = accountData.at;
      }
      if (streamData || accountData) this.handleDOMChange();
    }).catch(() => {});
  }

  /**
   * Fetches account-wide usage limits from /api/organizations/{org}/usage.
   * Scoped to the current organization and cached locally.
   */
  async _fetchAccountLimits(force = false) {
    if (!this.provider.fetchUsage || typeof this.provider.fetchUsage !== 'function') return;
    const now = Date.now();
    if (!force && this._accountLimitsAt && (now - this._accountLimitsAt < API_TTL_MS)) return;
    try {
      const limits = await this.provider.fetchUsage((p) => this._fetchJson(p));
      if (Array.isArray(limits) && limits.length > 0) {
        this._accountLimits = limits;
        this._accountLimitsAt = now;
        const key = this._limitKey('account');
        const fallbackKey = `limits:${this.provider.name}:account`;
        const store = typeof chrome !== 'undefined' ? chrome.storage?.local : null;
        store?.set({ [key]: { limits, at: now }, [fallbackKey]: { limits, at: now } }).catch(() => {});
        this.handleDOMChange();
      }
    } catch (_) {}
  }

  /**
   * Plan limits streamed with each reply (adapters with `limitStreamSource`, i.e. Claude). The last
   * value (percent + reset time only) is kept in extension storage scoped to account/org so other chats and reloads show it.
   */
  _listenForLimits() {
    const p = this.provider;
    if (typeof window === 'undefined') return;
    const store = typeof chrome !== 'undefined' ? chrome.storage?.local : null;
    this._loadStoredLimits();
    window.addEventListener('message', (e) => {
      if (e.origin && typeof location !== 'undefined' && e.origin !== location.origin) return;
      const data = e.data;
      if (!data || typeof data !== 'object') return;
      const isOurWatcher = data.source === p.limitStreamSource || data.source === 'CONTEXT_MONITOR_CLAUDE_LIMIT';
      const isClaudeMonitor = data.source === 'claude-usage-monitor';
      if (!isOurWatcher && !isClaudeMonitor) return;

      const rawLimits = data.messageLimit || data.limits;
      const limits = p.parseMessageLimit(rawLimits);
      if (!limits || !limits.length) return;
      this._streamLimits = { limits, at: Date.now() };
      const key = this._limitKey();
      const fallbackKey = `limits:${p.name}`;
      store?.set({ [key]: this._streamLimits, [fallbackKey]: this._streamLimits }).catch(() => {});
      this.handleDOMChange();
    });
  }

  /**
   * Limits to show: the newer of /usage and the last streamed value. A limit
   * past its reset time shows as 0%. Pure API / stream authoritative model with zero synthetic math.
   */
  _currentLimits(apiLimits = [], plan = null) {
    const streamed = this._streamLimits;
    const serverLimits = apiLimits.length ? apiLimits : (this._accountLimits || []);
    const useStream = Boolean(streamed && (!serverLimits.length || (streamed.at || 0) >= (this._accountLimitsAt || this._api?.at || 0)));
    const now = Date.now();
    const rawLimits = useStream ? streamed.limits : serverLimits;
    const limits = rawLimits
      .map(l => (l.resetsAt && l.resetsAt <= now ? { ...l, percent: 0, resetsAt: null } : l));

    if (limits.length) return limits;

    if (this.provider.name === 'Claude') {
      if (String(plan).toLowerCase() === 'free') {
        return [{ key: 'session', label: 'Session', note: 'Available · Dynamic limit' }];
      }
      return [{ key: 'session', label: 'Session (5h)', percent: null, resetsAt: null }];
    }

    if (!limits.length && this.provider.limitStreamSource) {
      if (String(plan).toLowerCase() === 'free') {
        return [{ key: 'session', label: 'Session', note: 'Available · Dynamic limit' }];
      }
      return [{ key: 'session', label: 'Session (5h)', percent: null, resetsAt: null }];
    }
    return limits;
  }

  async handleDOMChange(event = {}) {
    const runSeq = ++this._runSeq;
    const p = this.provider;
    try {
      const currentOrg = this._getOrgScope();
      if (this._activeOrgId !== undefined && currentOrg && this._activeOrgId !== currentOrg) {
        this._activeOrgId = currentOrg;
        this._streamLimits = null;
        this._accountLimits = null;
        this._accountLimitsAt = 0;
        this._api = null;
        this._apiFailure = null;
        this._loadStoredLimits();
        this._fetchAccountLimits(true);
      } else if (this._activeOrgId === undefined && currentOrg) {
        this._activeOrgId = currentOrg;
      }

      const conversationId = p.conversationId(location.href);
      if (conversationId !== this.activeConversationId) {
        // Another saved conversation: show loading, never the previous one's numbers
        if (conversationId) this.showState(toWidgetState(null, { provider: p.name }));
        this.activeConversationId = conversationId;
        this._wasStreaming = false;
      }

      // Page (one read per pass)
      const dom = p.extractMessages(document);
      const domModelRaw = p.detectModel(document);
      const domPlan = p.detectPlan(document);
      const streaming = dom.some(m => m.isStreaming);
      // A reply just finished: the saved copy is now behind, read it again
      const forceApi = Boolean(event.forceApi) || (this._wasStreaming && !streaming);
      this._wasStreaming = streaming;

      // Saved conversation (Claude API) when available
      const api = await this._readApi(conversationId, forceApi);
      if (runSeq !== this._runSeq) return;
      const saved = api.result && (!api.result.conversationId || api.result.conversationId === conversationId) ? api.result : null;

      let messages;
      let dataSource;
      let completenessSource;
      if (saved && saved.messages.length > 0) {
        dataSource = 'authoritative';
        completenessSource = 'authoritative_api';
        // Turns on the page beyond the saved ones are live (just sent / still streaming)
        messages = mergeLiveTurns(saved.messages, unsavedPageTurns(saved.messages, dom), { conversationId, baseIsFinal: true });
      } else {
        // Saved copy read fine but holds no turns yet (brand-new chat): the page has the whole chat.
        // Saved turns that normalize to nothing (format change) stay a fallback, flagged as partial.
        const unsaved = Boolean(saved) && !saved.rawMessages;
        dataSource = !(conversationId && p.hasApi) ? 'dom' : unsaved ? 'dom_unsaved' : 'dom_fallback';
        messages = dom;
        // A saved chat read only from the page may miss turns (API failed, or lazy-loaded history)
        completenessSource = !unsaved && conversationId && p.hasApi ? 'dom_partial' : 'dom_complete';
      }
      const complete = completenessSource !== 'dom_partial';
      const awaitingData = Boolean(conversationId) && messages.length === 0;

      // Model and plan evidence
      const modelCandidates = [];
      if (saved?.model) modelCandidates.push({ value: saved.model, compareKey: p.modelKey(saved.model), source: 'conversation_api', evidenceType: EvidenceType.EXACT });
      if (domModelRaw) modelCandidates.push({ value: domModelRaw, compareKey: p.modelKey(domModelRaw), source: 'dom', evidenceType: EvidenceType.OBSERVED });
      const planCandidates = [];
      if (saved?.plan) planCandidates.push({ value: saved.plan.value, source: 'account_api', evidenceType: saved.plan.evidenceType });
      if (domPlan) planCandidates.push(domPlan);
      const turnCandidates = [];
      if (saved) turnCandidates.push({ value: saved.visibleTurns, source: 'conversation_api', evidenceType: EvidenceType.EXACT });
      if (dom.length && (!saved || dom.length >= saved.visibleTurns)) turnCandidates.push({ value: dom.length, source: 'dom', evidenceType: EvidenceType.OBSERVED });

      const completeness = {
        conversationComplete: complete,
        domIsPartial: !complete,
        renderedTurnCount: dom.length,
        authoritativeTurnCount: saved ? saved.visibleTurns : null,
        virtualizationGap: 0,
        completenessSource
      };
      const reconciled = EvidenceMerger.reconcileState({ modelCandidates, planCandidates, turnCandidates, completeness, networkHealth: { networkAvailable: false } });
      const ev = reconciled.evidence;
      const modelRaw = ev.model?.value || null;
      const plan = ev.plan?.value || 'unknown';
      const limit = p.resolveLimit(modelRaw, plan);

      // Tokens: the site's own tokenizer when it is public and loaded (Gemini); otherwise o200k BPE as
      // an estimate, scaled by the adapter's correction factor (fixed-cost estimates are already in tokens)
      const { encoding, scale, exact } = this._counting(modelRaw);
      const scaled = (n) => Math.round(n * scale);
      const tokenized = messages.map(m => {
        const r = this.tokenizer.countMessagePartsTokens(m.id, m.parts || [{ type: 'text', text: m.text }], encoding);
        return {
          id: m.id,
          role: m.role,
          tokens: scaled(r.tokens),
          hasNonTextParts: r.hasNonTextParts,
          nonTextParts: r.nonTextParts,
          createdAt: m.createdAt || null,
          isStreaming: Boolean(m.isStreaming),
          preview: String(m.text || '').slice(0, 80)
        };
      });
      const attachments = saved?.attachments || p.pageAttachments?.(document, modelRaw) || { count: 0, estimatedTokens: 0, hasUnknown: false };
      // Hidden context from the adapter (Claude): text items are counted here, fixed-cost items carry tokens.
      // Only once the chat has a message: nothing is sent before that.
      const hidden = messages.length ? (saved?.hidden || p.pageHiddenContext?.(modelRaw) || []).map(i => (i.tokens !== undefined ? i
        : { ...i, tokens: scaled(this.tokenizer.countMessageTokens(`hidden:${i.kind}`, i.text, encoding)) })) : [];

      const state = ContextCalculator.calculate({
        messages: tokenized,
        model: {
          // The window may be known from the plan alone (Gemini), so the id is the provider's app
          id: limit.recognized || limit.contextWindow ? (p.modelKey(modelRaw) || `${p.name.toLowerCase()}-app`) : 'unknown',
          displayName: p.displayName(modelRaw) || `${p.name} (model not detected)`,
          contextWindow: limit.contextWindow,
          limitStatus: limit.status,
          limitSource: limit.source,
          recognized: limit.recognized,
          encoding
        },
        plan: ev.plan,
        attachments,
        hidden,
        dropStaleTools: Boolean(p.dropsOldToolResults),
        tools: { observed: tokenized.some(m => m.role === 'tool'), list: [] },
        completeness,
        isPartial: !complete,
        evidence: ev,
        conflicts: reconciled.conflicts,
        agreements: reconciled.agreements,
        networkHealth: { networkAvailable: false },
        tokenizerExact: exact
      });

      state.observables.dataSource = dataSource;
      state.observables.conversationId = conversationId;
      state.observables.awaitingData = awaitingData;
      // Plan usage limits as the site reports them (Claude only); read with the conversation
      state.limits = this._currentLimits(saved?.limits || [], plan);
      // Sites that only show a notice once a limit is hit (Claude / Gemini)
      const reached = p.detectLimitReached?.(document);
      if (reached) {
        const idx = state.limits.findIndex(l => l.key === reached.key);
        if (idx >= 0) state.limits[idx] = reached;
        else state.limits.push(reached);
      }
      if (p.longChatNoteAt && state.utilization.percentage >= p.longChatNoteAt) {
        state.limits.push({ key: 'long_chat', label: 'Long chat', note: `each message uses more of your ${p.name} limit; a new chat is lighter` });
      }
      if (api.error) state.observables.apiError = saved ? `Conversation API failed (${api.error}); using the last good copy` : `Conversation API failed (${api.error}); reading the page`;
      state.completeness.isLowerBound = !complete;
      state.completeness.hiddenContextMeasured = false;
      ev.limit = limitEvidence(state, limit.source);
      ev.tokens = { total: { value: state.tokens.totalMeasurable, source: 'tokenizer', evidenceType: EvidenceType.ESTIMATED, approximate: !exact || hidden.some(i => i.estimated) } };

      addIntelligence(state, { conversationId, awaitingData, attachments, isLowerBound: !complete, sessionStart: this._sessionStartTokens });

      // Structure only: no message text, no raw conversation id
      state.diagnostics = {
        provider: p.name,
        generatedAt: new Date().toISOString(),
        conversation: {
          ref: this._conversationRef(conversationId), loading: awaitingData, dataSource, apiError: api.error || null,
          turns: { api: saved ? saved.visibleTurns : null, apiRaw: saved ? (saved.rawMessages ?? null) : null, apiCounted: saved ? saved.messages.length : null, page: dom.length, counted: messages.length }, completeness: { source: completenessSource, lowerBound: !complete },
          hiddenContext: hidden.map(i => `${i.kind}:${i.tokens}`) // Kinds and counts only, never the text
        },
        candidates: { model: modelCandidates.map(c => `${c.source}:${c.value}`), plan: planCandidates.map(c => `${c.source}:${c.value}`) },
        conflicts: reconciled.conflicts.map(c => ({ field: c.field, winning: `${c.winning.source}:${c.winning.value}`, discarded: `${c.discarded.source}:${c.discarded.value}` })),
        agreements: reconciled.agreements,
        resolved: { model: modelRaw, plan, limit: state.model.contextWindow, limitStatus: ev.limit.status, limitReference: ev.limit.reference },
        tokens: { used: state.tokens.totalMeasurable, remaining: state.tokens.remaining, percentage: state.utilization.percentage, tokenizer: exact ? `${encoding} (the model's own tokenizer)` : `${encoding} x${scale} (approximate for this provider)` },
        limits: state.limits.map(l => `${l.key}:${typeof l.percent === 'number' ? `${l.percent}%` : l.remaining ?? (l.note ? 'note' : 'pending')}`),
        confidence: { level: state.confidence.level, percentage: state.confidence.percentage, highBlockers: state.confidence.highBlockers || [] },
        intelligence: { health: state.intelligence.health.level, advice: state.intelligence.advice.title }
      };
      this.latestState = state;
      this.showState(toWidgetState(state, { provider: p.name }));
      this.syncState(state);
    } catch (err) {
      console.error(`[Context Monitor] ${p.name} extraction error:`, err);
    }
  }

  /** Shows the view state in the in-page widget and pushes it to an open side panel. */
  showState(viewState) {
    this._lastViewState = viewState;
    this.overlayUI.update(viewState);
    this.panel?.push(viewState);
  }

  /** Toolbar badge (service worker); see badgeSender. */
  syncState(state) {
    this._sendBadge(state);
  }
}
