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
import { analyzeContext } from '../engine/context-advisor.js';
import { ContextWidget } from './overlay-ui.js';
import { toWidgetState } from './widget-state.js';
import { mergeLiveTurns } from './turn-merger.js';
import { ChatGPTDOMObserver } from './chatgpt-dom.js';
import { invalidateText, trustTextCache } from './providers.js';

const API_TTL_MS = 60000; // Saved copy stays fresh for a minute; a reply finishing re-reads it at once
const EMPTY_RETRY_MS = 3000; // A saved copy with no turns yet (brand-new chat) is read again this soon
const API_BACKOFF_MS = 15000; // After a failed read, wait before trying again (Refresh skips this)

export class ProviderCoordinator {
  /** @param {Object} provider Adapter from content/providers.js */
  constructor(provider) {
    this.provider = provider;
    this.tokenizer = new Tokenizer();
    this.overlayUI = new ContextWidget({
      provider: provider.name,
      findInput: () => provider.findInput(document),
      replySelector: provider.replySelector,
      onRefresh: () => this.refresh(),
      getDiagnostics: () => this.getDiagnostics()
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
    this._listenForLimits();
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request?.type !== 'TOGGLE_OVERLAY') return false;
        this.overlayUI.isVisible = !this.overlayUI.isVisible;
        this.overlayUI.render();
        sendResponse({ success: true, isVisible: this.overlayUI.isVisible });
        return true;
      });
    }
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
        return { result, error: null };
      } catch (err) {
        this._apiFailure = { conversationId, error: err.message || 'Conversation API failed', at: Date.now() };
        return { result: this._keptCopy(conversationId), error: this._apiFailure.error };
      } finally {
        if (this._apiInFlight?.promise === promise) this._apiInFlight = null;
      }
    })();
    this._apiInFlight = { conversationId, promise };
    return promise;
  }

  /** Last good copy of this conversation (used when a later read fails). */
  _keptCopy(conversationId) {
    return this._api && this._api.conversationId === conversationId ? this._api.result : null;
  }

  async refresh() {
    await this.handleDOMChange({ isRefresh: true, forceApi: true });
  }

  _conversationRef(id) {
    return id ? this.tokenizer.hashString(id).toString(16) : null;
  }

  getDiagnostics() {
    const currentRef = this._conversationRef(this.provider.conversationId(location.href));
    const copiedAt = new Date().toISOString();
    const d = this.latestState?.diagnostics;
    if (!d) return { note: 'Nothing read yet in this tab', provider: this.provider.name, currentConversationRef: currentRef, copiedAt };
    if (d.conversation.ref !== currentRef) {
      return { note: 'The conversation on screen is still loading; data from the previous conversation is withheld', provider: this.provider.name, currentConversationRef: currentRef, loading: true, copiedAt };
    }
    return { ...d, copiedAt, stateAgeMs: Date.now() - this.latestState.timestamp };
  }

  /**
   * Plan limits streamed with each reply (adapters with `limitStreamSource`, i.e. Claude). The last
   * value (percent + reset time only) is kept in extension storage so other chats and reloads show it.
   */
  _listenForLimits() {
    const p = this.provider;
    if (!p.limitStreamSource || typeof window === 'undefined') return;
    const store = typeof chrome !== 'undefined' ? chrome.storage?.local : null;
    const key = `limits:${p.name}`;
    store?.get(key).then(r => { if (r?.[key] && !this._streamLimits) this._streamLimits = r[key]; }).catch(() => {});
    window.addEventListener('message', (e) => {
      if (e.source !== window || e.data?.source !== p.limitStreamSource) return;
      const limits = p.parseMessageLimit(e.data.messageLimit);
      if (!limits.length) return;
      this._streamLimits = { limits, at: Date.now() };
      store?.set({ [key]: this._streamLimits }).catch(() => {});
      this.handleDOMChange();
    });
  }

  /**
   * Limits to show: the newer of /usage (empty on some plans) and the last streamed value. A limit
   * past its reset time shows as 0%. Adapters that stream limits show a placeholder until the first reply.
   */
  _currentLimits(apiLimits = []) {
    const streamed = this._streamLimits;
    const useStream = streamed && (!apiLimits.length || streamed.at > (this._api?.at || 0));
    const now = Date.now();
    const limits = (useStream ? streamed.limits : apiLimits)
      .map(l => (l.resetsAt && l.resetsAt <= now ? { ...l, percent: 0, resetsAt: null } : l));
    if (!limits.length && this.provider.limitStreamSource) return [{ key: 'session', label: 'Session (5h)', percent: null, resetsAt: null }];
    return limits;
  }

  async handleDOMChange(event = {}) {
    const runSeq = ++this._runSeq;
    const p = this.provider;
    try {
      const conversationId = p.conversationId(location.href);
      if (conversationId !== this.activeConversationId) {
        // Another saved conversation: show loading, never the previous one's numbers
        if (conversationId) this.overlayUI.update(toWidgetState(null, { provider: p.name }));
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
        const savedVisible = saved.messages.filter(m => m.role !== 'tool').length;
        messages = mergeLiveTurns(saved.messages, dom.length > savedVisible ? dom.slice(savedVisible) : [], { conversationId, baseIsFinal: true });
      } else {
        // Saved copy read fine but holds no turns yet (brand-new chat): the page has the whole chat.
        // Saved turns that normalize to nothing (format change) stay a fallback, flagged as partial.
        const unsaved = Boolean(saved) && !saved.rawMessages;
        dataSource = !(conversationId && p.hasApi) ? 'dom' : unsaved ? 'dom_unsaved' : 'dom_fallback';
        messages = dom;
        // A saved chat read only from the page may miss turns (API failed, or lazy-loaded history)
        completenessSource = !unsaved && conversationId && (p.hasApi || (typeof p.pageMayBePartial === 'function' ? p.pageMayBePartial(document, conversationId, dom.length) : p.pageMayBePartial)) ? 'dom_partial' : 'dom_complete';
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

      // Tokens: o200k BPE as an estimate (the provider's tokenizer is not public), scaled by the
      // adapter's correction factor for counted text (fixed-cost estimates are already in its tokens)
      const scale = p.tokenScale || 1;
      const scaled = (n) => Math.round(n * scale);
      const tokenized = messages.map(m => {
        const r = this.tokenizer.countMessagePartsTokens(m.id, m.parts || [{ type: 'text', text: m.text }], 'o200k_base');
        return { id: m.id, role: m.role, tokens: scaled(r.tokens), hasNonTextParts: r.hasNonTextParts, nonTextParts: r.nonTextParts, isStreaming: Boolean(m.isStreaming) };
      });
      const attachments = saved?.attachments || p.pageAttachments?.(document) || { count: 0, estimatedTokens: 0, hasUnknown: false };
      // Hidden context from the adapter (Claude): text items are counted here, fixed-cost items carry tokens.
      // Only once the chat has a message: nothing is sent before that.
      const hidden = messages.length ? (saved?.hidden || p.pageHiddenContext?.() || []).map(i => (i.tokens !== undefined ? i
        : { ...i, tokens: scaled(this.tokenizer.countMessageTokens(`hidden:${i.kind}`, i.text, 'o200k_base')) })) : [];

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
          encoding: 'o200k_base'
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
        tokenizerExact: false
      });

      state.observables.dataSource = dataSource;
      state.observables.conversationId = conversationId;
      state.observables.awaitingData = awaitingData;
      // Plan usage limits as the site reports them (Claude only); read with the conversation
      state.limits = this._currentLimits(saved?.limits || []);
      // Sites that only show a notice once a limit is hit (Gemini)
      const reached = p.detectLimitReached?.(document);
      if (reached) state.limits.push(reached);
      if (p.longChatNoteAt && state.utilization.percentage >= p.longChatNoteAt) {
        state.limits.push({ key: 'long_chat', label: 'Long chat', note: `each message uses more of your ${p.name} limit; a new chat is lighter` });
      }
      if (api.error) state.observables.apiError = saved ? `Conversation API failed (${api.error}); using the last good copy` : `Conversation API failed (${api.error}); reading the page`;
      state.completeness.isLowerBound = !complete;
      state.completeness.hiddenContextMeasured = false;
      const windowKnown = Boolean(state.model.contextWindow);
      ev.limit = {
        value: state.model.contextWindow,
        status: windowKnown ? state.model.limitStatus : 'UNKNOWN',
        source: windowKnown ? 'model_db' : 'unknown',
        reference: windowKnown ? limit.source : null,
        evidenceType: windowKnown ? EvidenceType.OBSERVED : EvidenceType.UNKNOWN
      };
      ev.tokens = { total: { value: state.tokens.totalMeasurable, source: 'tokenizer', evidenceType: EvidenceType.ESTIMATED, approximate: true } };

      if (!awaitingData && conversationId && !this._sessionStartTokens.has(conversationId)) this._sessionStartTokens.set(conversationId, state.tokens.totalMeasurable);
      state.intelligence = analyzeContext({
        percentage: state.utilization.percentage,
        usedTokens: state.tokens.totalMeasurable,
        contextLimit: state.model.contextWindow,
        remainingTokens: state.tokens.remaining,
        messages: state.tokens.contextMessages,
        attachments,
        isLowerBound: !complete,
        hiddenTokens: state.tokens.hidden,
        sessionStartTokens: conversationId ? (this._sessionStartTokens.get(conversationId) ?? null) : null
      });

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
        tokens: { used: state.tokens.totalMeasurable, remaining: state.tokens.remaining, percentage: state.utilization.percentage, tokenizer: `o200k_base x${scale} (approximate for this provider)` },
        limits: state.limits.map(l => `${l.key}:${typeof l.percent === 'number' ? `${l.percent}%` : l.remaining ?? (l.note ? 'note' : 'pending')}`),
        confidence: { level: state.confidence.level, percentage: state.confidence.percentage, highBlockers: state.confidence.highBlockers || [] },
        intelligence: { health: state.intelligence.health.level, advice: state.intelligence.advice.title }
      };
      state.evidence = ev;
      state.conflicts = reconciled.conflicts;

      this.latestState = state;
      this.overlayUI.update(toWidgetState(state, { provider: p.name }));
      this.syncState(state);
    } catch (err) {
      console.error(`[Context Monitor] ${p.name} extraction error:`, err);
    }
  }

  /** Toolbar badge; at most one message per 250 ms (streaming updates the page many times a second). */
  syncState(state) {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
    // The badge is the only consumer: send just its two values, never conversation data
    this._pendingSync = { percentage: state.utilization?.percentage ?? null, awaitingData: Boolean(state.observables?.awaitingData) };
    if (this._syncTimer) return;
    const send = () => {
      if (!this._pendingSync) return;
      chrome.runtime.sendMessage({ type: 'CONTEXT_UPDATED', payload: this._pendingSync }).catch(() => {});
      this._pendingSync = null;
    };
    send();
    this._syncTimer = setTimeout(() => { this._syncTimer = null; send(); }, 250);
  }
}
