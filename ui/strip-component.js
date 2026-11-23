/**
 * Context Monitor - StripComponent
 *
 * Single shared UI component for the usage & context strip above the chat input across
 * claude.ai, gemini.google.com, and chatgpt.com.
 *
 * Layout (two-column):
 * - Left: usage rows (0 to 2 rows). Label, bar, percent, reset time, optional note.
 * - Right: context ring, with percent beside it. Optional "~N msgs left" above ring (Claude only)
 *          or reset time (Gemini).
 * - Ring hover or click: opens detail drawer with context breakdown and biggest item.
 * - Usage row hover or click: opens detail drawer with usage details.
 */

import { h, setText, setAttr, show, iconButton, textButton, ICONS } from './dom.js';
import { formatTokens, formatReset, formatMsgs, threshold } from './formatters.js';
import { ResetCountdown } from '../content/countdown.js';
import { shouldShowNewChatSuggestion } from '../content/alerts.js';
import { formatBiggestItemDisplay, scrollToItem } from '../content/biggest-item.js';
import { generateSparklinePath } from '../content/history.js';
import { formatPreSendEstimate } from '../content/pre-send.js';
import { buildCheckpointMarkdown, downloadMarkdownFile } from '../content/checkpoint-export.js';

const RING_R = 9;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_R; // ~56.55

export class StripComponent {
  /**
   * @param {Element} container Parent element (usually shadow root or wrapper inside shadow root)
   * @param {{ onToggleDrawer?: (open: boolean) => void, onToggleDev?: (open: boolean) => void }} [callbacks]
   */
  constructor(container, callbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;
    this.drawerOpen = false;
    this.devOpen = false;
    this._data = null;
    this._hoverTimer = null;
    this._pinnedOpen = false;
    this._countdown = new ResetCountdown({
      onTick: (text) => this._onCountdownTick(text)
    });

    this._build();
  }

  _build() {
    this.root = h('div', 'glance-container root', this.container);

    // Pre-send draft token estimate pill (debounced 300ms, shown only when draft exists)
    this.draftPill = h('div', 'draft-estimate hide', this.root);

    // Toast element for threshold alerts
    this.toast = h('div', 'toast hide', this.root);
    this.toast.setAttribute('role', 'status');
    this.toast.setAttribute('aria-live', 'polite');

    // 1. Detail Drawer (collapsed by default, opens on click/hover)
    this.drawer = h('div', 'detail-drawer', this.root);
    this.drawer.hidden = true;

    // Header: Context ~96K / 200K · est. + Gear button
    const dHead = h('div', 'drawer-header', this.drawer);
    const titleBox = h('div', null, dHead);
    titleBox.style.cssText = 'display:flex;align-items:baseline;gap:6px;';
    this.dTitle = h('span', 'drawer-title', titleBox, 'Context —');
    this.dModel = h('span', 'model-caption', titleBox);
    this.dGear = iconButton(dHead, ICONS.gear, 'Toggle developer diagnostics');
    this.dGear.b.classList.add('drawer-gear');
    this.dGear.b.setAttribute('aria-expanded', 'false');

    // Stacked bar
    this.dStack = h('div', 'stack-bar', this.drawer);
    this.dStack.setAttribute('role', 'progressbar');
    this.dStack.setAttribute('aria-label', 'Context distribution');
    this.dSegUser = h('span', 'seg seg-user', this.dStack);
    this.dSegAsst = h('span', 'seg seg-asst', this.dStack);
    this.dSegSys = h('span', 'seg seg-sys', this.dStack);

    // Legend: You 4% · Claude & tools 55% · System 41%
    this.dLegend = h('div', 'drawer-legend', this.drawer);
    this.dLegUser = h('span', null, this.dLegend);
    h('span', 'sep', this.dLegend, '·');
    this.dLegAsst = h('span', null, this.dLegend);
    h('span', 'sep', this.dLegend, '·');
    this.dLegSys = h('span', null, this.dLegend);
    this.dLegSys.title = 'System prompt, memory, tool definitions';

    // Suggestion line: "Consider a new chat" (rendered in drawer only at >=80% context)
    this.dNewChatRow = h('div', 'drawer-row new-chat-suggestion hide', this.drawer);
    this.dNewChatVal = h('span', 'suggestion-text', this.dNewChatRow, '💡 High context usage: Consider starting a new chat');

    // Biggest item: <name> · <tokens> (shown only when data exists)
    this.dBigRow = h('div', 'drawer-row biggest-row hide', this.drawer);
    h('span', 'k', this.dBigRow, 'Biggest item:');
    this.dBigVal = h('span', 'v', this.dBigRow);
    this.dBigRow.addEventListener('click', () => {
      if (this._currentBiggest?.element) {
        scrollToItem(this._currentBiggest.element);
      }
    });

    // Usage history sparkline (rolling 7-day, gaps drawn as breaks)
    this.dSparklineBox = h('div', 'drawer-row sparkline-row hide', this.drawer);
    h('span', 'k', this.dSparklineBox, 'Usage history:');
    const sSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    sSvg.setAttribute('class', 'drawer-sparkline');
    sSvg.setAttribute('viewBox', '0 0 120 24');
    sSvg.setAttribute('aria-hidden', 'true');
    this.dSparklinePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    sSvg.appendChild(this.dSparklinePath);
    this.dSparklineBox.appendChild(sSvg);

    // Usage details section in drawer
    this.dUsage = h('div', 'drawer-usage hide', this.drawer);

    // Developer view (hidden by default behind gear icon)
    this.dDev = h('div', 'dev-view hide', this.drawer);
    h('div', 'sec-title', this.dDev, 'Diagnostics');
    this.dDevContent = h('div', null, this.dDev);
    this.dExportBtn = textButton(this.dDevContent, 'Export Checkpoint (MD)', () => this._exportCheckpoint());

    this.dGear.b.addEventListener('click', (e) => {
      e.stopPropagation();
      this.devOpen = !this.devOpen;
      show(this.dDev, this.devOpen);
      this.dGear.b.setAttribute('aria-expanded', String(this.devOpen));
      if (this.callbacks.onToggleDev) this.callbacks.onToggleDev(this.devOpen);
    });

    // 2. Main Strip Box (Two columns: Left = usage rows, Right = context ring)
    this.strip = h('div', 'strip-box', this.root);
    this.strip.setAttribute('role', 'region');
    this.strip.setAttribute('tabindex', '0');
    this.strip.setAttribute('aria-label', 'AI Chat Usage and Context Strip');
    this.strip.setAttribute('aria-expanded', 'false');

    // Left Column: Usage Rows
    this.stripLeft = h('div', 'strip-left', this.strip);

    // Right Column: Context Ring + msgs left
    this.stripRight = h('div', 'strip-right', this.strip);
    this.ctxMsgs = h('div', 'ctx-msgs hide', this.stripRight);

    this.ctxRow = h('div', 'ctx-row', this.stripRight);
    this.ringBtn = h('button', 'ctx-ring-btn', this.ctxRow);
    this.ringBtn.type = 'button';
    this.ringBtn.setAttribute('tabindex', '0');
    this.ringBtn.setAttribute('aria-label', 'Context ring: click or hover for breakdown');

    // SVG Circular Ring
    const NS = 'http://www.w3.org/2000/svg';
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.setAttribute('class', 'ctx-ring-svg');
    this.svg.setAttribute('viewBox', '0 0 24 24');
    this.svg.setAttribute('aria-hidden', 'true');

    this.ringTrack = document.createElementNS(NS, 'circle');
    this.ringTrack.setAttribute('class', 'ctx-ring-track');
    this.ringTrack.setAttribute('cx', '12');
    this.ringTrack.setAttribute('cy', '12');
    this.ringTrack.setAttribute('r', String(RING_R));
    this.svg.appendChild(this.ringTrack);

    this.ringArc = document.createElementNS(NS, 'circle');
    this.ringArc.setAttribute('class', 'ctx-ring-arc');
    this.ringArc.setAttribute('cx', '12');
    this.ringArc.setAttribute('cy', '12');
    this.ringArc.setAttribute('r', String(RING_R));
    this.ringArc.setAttribute('stroke-dasharray', String(RING_CIRCUMFERENCE));
    this.ringArc.setAttribute('stroke-dashoffset', String(RING_CIRCUMFERENCE));
    this.svg.appendChild(this.ringArc);

    this.ringBtn.appendChild(this.svg);
    this.ctxVal = h('span', 'ctx-pct', this.ringBtn, '—');

    // Events: click toggles pinned open state; hover previews drawer
    this.strip.addEventListener('click', (e) => {
      if (e.target.closest('.drawer-gear') || e.target.closest('.dev-view')) return;
      this._toggleDrawer();
    });

    this.strip.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this._toggleDrawer();
      }
    });

    this.strip.addEventListener('mouseenter', () => {
      clearTimeout(this._hoverTimer);
      this._hoverTimer = setTimeout(() => {
        if (!this.drawerOpen) {
          this._setDrawerOpen(true, false);
        }
      }, 150);
    });

    this.strip.addEventListener('mouseleave', () => {
      clearTimeout(this._hoverTimer);
      if (!this._pinnedOpen && this.drawerOpen) {
        this._setDrawerOpen(false, false);
      }
    });
  }

  _toggleDrawer(force) {
    const next = typeof force === 'boolean' ? force : !this.drawerOpen;
    this._pinnedOpen = next;
    this._setDrawerOpen(next, true);
  }

  _setDrawerOpen(open, notify = true) {
    this.drawerOpen = open;
    this.drawer.hidden = !open;
    setAttr(this.strip, 'aria-expanded', String(open));
    if (notify && this.callbacks.onToggleDrawer) {
      this.callbacks.onToggleDrawer(open);
    }
  }

  /**
   * Renders the strip and drawer with standardized data.
   *
   * @param {{
   *   rows: Array<{
   *     label: string,
   *     state: 'ok'|'warn'|'danger'|'unlimited'|'unknown',
   *     percent?: number,
   *     resetsAt?: string|number,
   *     source: 'measured'|'estimated',
   *     note?: string
   *   }>,
   *   context?: {
   *     used?: number,
   *     limit?: number,
   *     source: 'measured'|'estimated',
   *     refLimit?: number,
   *     refType?: 'user'|'published',
   *     state?: 'A'|'B'|'C'
   *   },
   *   msgsLeft?: number|null,
   *   rightNote?: string|null,
   *   breakdown?: { user?: number, assistant?: number, system?: number },
   *   biggest?: { name?: string, role?: string, turn?: number, tokens?: number },
   *   provider?: string,
   *   model?: string,
   *   modelFamily?: string
   * }} data
   */
  render(data) {
    this._data = data;
    if (!data) {
      this.strip.style.display = 'none';
      return;
    }

    const rows = Array.isArray(data.rows) ? data.rows : [];
    const ctx = data.context || null;

    // If both rows and context are empty/unavailable, hide the strip cleanly without error
    if (rows.length === 0 && (!ctx || ctx.used === undefined || ctx.used === null)) {
      this.strip.style.display = 'none';
      return;
    }
    this.strip.style.display = '';

    // -------------------------------------------------------------------------
    // 1. Render Left Column: Usage Rows
    // -------------------------------------------------------------------------
    this.stripLeft.textContent = '';
    this.dUsage.textContent = '';
    let hasUsageDetails = false;

    for (const r of rows) {
      const uRow = h('div', 'u-row', this.stripLeft);
      uRow.setAttribute('tabindex', '0');

      // Label (site's own name, e.g. "5h", "Wk", "Uploads")
      h('span', 'u-label', uRow, r.label);

      // Bar and values
      if (r.state === 'unlimited') {
        const noteText = r.note || 'No limit · subject to safeguards';
        const noteEl = h('span', 'u-note', uRow, noteText);
        noteEl.style.color = 'var(--muted)';
      } else if (typeof r.percent === 'number' && Number.isFinite(r.percent)) {
        const pct = Math.round(r.percent);
        const t = threshold(pct);
        const isEst = r.source === 'estimated';

        // Bar container
        const barTrack = h('div', 'u-bar-track', uRow);
        const barFill = h('div', 'u-bar-fill', barTrack);
        barFill.style.width = `${Math.min(100, Math.max(0, pct))}%`;

        // Bar fill style: solid for measured, hatched for estimated
        const fillClass = isEst ? `hatched-${t.state}` : `solid-${t.state}`;
        barFill.classList.add(fillClass);

        // Percent text: at 80%+ append ⚠
        const pctEl = h('span', `u-pct ${t.state}`, uRow, t.symbol ? `${pct}% ${t.symbol}` : `${pct}%`);
        if (isEst) {
          pctEl.title = 'Estimated';
        }

        // Reset text
        const resetStr = r.resetsAt ? (formatReset(r.resetsAt) || '') : '';
        if (resetStr) {
          const rReset = h('span', 'u-reset', uRow, resetStr);
          if (data.features?.countdown !== false) {
            this._activeResetEl = rReset;
            this._countdown.start(r.resetsAt);
          }
        }

        // Row note if present
        if (r.note) {
          h('span', 'u-note', uRow, r.note);
        }

        // Build matching drawer usage row
        const dRow = h('div', 'drawer-row usage-row', this.dUsage);
        const tag = isEst ? '🟡 est.' : '🟢 measured';
        const parts = [r.label, `${pct}%`, resetStr, tag].filter(Boolean);
        setText(dRow, parts.join(' · '));
        hasUsageDetails = true;
      } else if (r.note) {
        h('span', 'u-note', uRow, r.note);
      }
    }
    show(this.dUsage, hasUsageDetails);

    // -------------------------------------------------------------------------
    // 2. Render Right Column: Msgs Left & Context Ring
    // -------------------------------------------------------------------------
    // Right Top: msgsLeft (Claude) or reset note (Gemini)
    if (typeof data.msgsLeft === 'number' && Number.isFinite(data.msgsLeft)) {
      const split = formatMsgs(data.msgsLeft, { split: true });
      if (split) {
        this.ctxMsgs.textContent = '';
        h('div', null, this.ctxMsgs, split.top);
        h('div', null, this.ctxMsgs, split.bottom);
        this.ctxMsgs.title = 'Estimated messages left before limit';
        show(this.ctxMsgs, true);
      } else {
        show(this.ctxMsgs, false);
      }
    } else if (data.rightNote) {
      this.ctxMsgs.textContent = '';
      h('div', null, this.ctxMsgs, data.rightNote);
      show(this.ctxMsgs, true);
    } else {
      show(this.ctxMsgs, false);
    }

    // Right Bottom: Context Ring
    // Determine ring state: A (Known limit), B (User reference), C (No limit)
    let ringState = 'C';
    let ringLimit = null;
    let _isUserRef = false;

    if (ctx) {
      if (ctx.limit && Number.isFinite(ctx.limit) && ctx.limit > 0) {
        ringState = 'A';
        ringLimit = ctx.limit;
      } else if (ctx.refLimit && Number.isFinite(ctx.refLimit) && ctx.refLimit > 0) {
        ringState = 'B';
        ringLimit = ctx.refLimit;
        _isUserRef = true;
      } else {
        ringState = 'C';
      }
    }

    const used = ctx?.used;
    const isEstCtx = ctx?.source === 'estimated';

    if (ringState === 'A' || ringState === 'B') {
      const pct = typeof used === 'number' && Number.isFinite(used) && ringLimit
        ? Math.round((used / ringLimit) * 100)
        : null;

      if (pct !== null) {
        const t = threshold(pct);
        const offset = RING_CIRCUMFERENCE * (1 - Math.min(100, Math.max(0, pct)) / 100);

        this.ringArc.style.display = '';
        this.ringArc.setAttribute('stroke-dashoffset', String(offset));
        this.ringArc.className.baseVal = `ctx-ring-arc ${t.state} ${isEstCtx ? 'hatched' : ''}`;

        setText(this.ctxVal, t.symbol ? `${pct}% ${t.symbol}` : `${pct}%`);
        this.ctxVal.className = `ctx-pct ${t.state}`;
      } else {
        this.ringArc.style.display = 'none';
        setText(this.ctxVal, '—');
        this.ctxVal.className = 'ctx-pct neutral';
      }
    } else {
      // State C: No limit. Outlined ring, NO fill arc, count ONLY beside ring (no percent)
      this.ringArc.style.display = 'none';
      const formattedUsed = typeof used === 'number' && Number.isFinite(used)
        ? formatTokens(used, { approx: true })
        : '—';
      setText(this.ctxVal, formattedUsed);
      this.ctxVal.className = 'ctx-pct neutral';
    }

    // -------------------------------------------------------------------------
    // 3. Render Detail Drawer
    // -------------------------------------------------------------------------
    const usedFormatted = formatTokens(used, { approx: true }) || '0';
    const tagCtx = isEstCtx ? 'est.' : 'measured';

    let titleText = 'Context —';
    if (ringState === 'A' && ringLimit) {
      titleText = `Context ${usedFormatted} / ${formatTokens(ringLimit)} · ${tagCtx}`;
    } else if (ringState === 'B' && ringLimit) {
      titleText = `Context ${usedFormatted} vs your ${formatTokens(ringLimit)} ref · ${tagCtx}`;
    } else if (ringState === 'C' && used !== null && used !== undefined) {
      titleText = `Context ${usedFormatted} used · ${tagCtx}`;
    }
    setText(this.dTitle, titleText);

    const modelCaption = [data.model, data.modelFamily].filter(Boolean).join(' · ');
    setText(this.dModel, modelCaption ? `(${modelCaption})` : '');

    // Stacked breakdown
    const bk = data.breakdown || {};
    const uTokens = bk.user || 0;
    const aTokens = bk.assistant || 0;
    const sTokens = bk.system || 0;
    const totalBk = (uTokens + aTokens + sTokens) || used || 1;

    const uPct = Math.round((uTokens / totalBk) * 100);
    const aPct = Math.round((aTokens / totalBk) * 100);
    const sPct = Math.max(0, 100 - uPct - aPct);

    this.dSegUser.style.width = `${uPct}%`;
    this.dSegAsst.style.width = `${aPct}%`;
    this.dSegSys.style.width = `${sPct}%`;

    const provName = data.provider || 'Assistant';
    setText(this.dLegUser, `You ${uPct}%`);
    setText(this.dLegAsst, `${provName} & tools ${aPct}%`);
    setText(this.dLegSys, `System ${sPct}%`);

    // Biggest item
    const big = data.biggest;
    this._currentBiggest = big;
    if (big && typeof big.tokens === 'number' && big.tokens > 0) {
      const disp = formatBiggestItemDisplay(big, formatTokens);
      if (disp) {
        this.dBigVal.textContent = '';
        h('span', null, this.dBigVal, disp.text);
        if (disp.sub) {
          h('span', 'visible-only-badge', this.dBigVal, ` (${disp.sub})`);
        }
        this.dBigRow.style.cursor = big.element ? 'pointer' : '';
        show(this.dBigRow, true);
      } else {
        show(this.dBigRow, false);
      }
    } else {
      show(this.dBigRow, false);
    }

    // "Consider a new chat" line in drawer (at 80%+ context, 85%+ if estimated)
    const ctxPct = (ringState === 'A' || ringState === 'B') && ringLimit
      ? Math.round((used / ringLimit) * 100)
      : null;
    const isEst = isEstCtx || data.context?.source === 'estimated';
    const showSuggest = shouldShowNewChatSuggestion(ctxPct, isEst ? 'estimated' : 'measured', data.features?.newChatSuggestion ?? true);
    show(this.dNewChatRow, showSuggest);

    // Usage history sparkline in drawer
    if (Array.isArray(data.history) && data.history.length > 0 && data.features?.usageHistory !== false) {
      const dPath = generateSparklinePath(data.history, 120, 24);
      if (dPath) {
        this.dSparklinePath.setAttribute('d', dPath);
        show(this.dSparklineBox, true);
      } else {
        show(this.dSparklineBox, false);
      }
    } else {
      show(this.dSparklineBox, false);
    }
  }

  setDraftEstimate(tokens) {
    if (tokens && typeof tokens === 'number' && tokens > 0) {
      const text = formatPreSendEstimate(tokens, formatTokens);
      setText(this.draftPill, text);
      show(this.draftPill, true);
    } else {
      show(this.draftPill, false);
    }
  }

  _exportCheckpoint() {
    if (this.callbacks.onExportCheckpoint) {
      this.callbacks.onExportCheckpoint();
      return;
    }
    const msgs = this._data?.messages || [];
    const md = buildCheckpointMarkdown(msgs, {
      title: this._data?.title || (this._data?.model ? `${this._data.model} Chat` : 'Conversation Checkpoint'),
      model: this._data?.model,
      usedTokens: this._data?.context?.used,
      contextLimit: this._data?.context?.limit,
      percentage: this._data?.percentage,
      range: 20
    });
    downloadMarkdownFile(md);
    this.showToast('Checkpoint exported as Markdown');
  }

  destroy() {
    if (this._countdown) {
      this._countdown.destroy();
    }
  }

  _onCountdownTick(text) {
    if (!text) return;
    if (this._activeResetEl) {
      setText(this._activeResetEl, text);
    }
  }

  showToast(text, ms = 4000) {
    if (!this.toast) return;
    this.toast.textContent = text;
    show(this.toast, true);
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => show(this.toast, false), ms);
  }
}

