/**
 * Context Monitor - StripComponent
 *
 * Single shared UI component for the usage & context strip above the chat input across
 * claude.ai, gemini.google.com, and chatgpt.com.
 *
 * Layout:
 * - Top row (Claude & Gemini): 5h limit and Weekly limit side by side, flat solid bars, no glow.
 *   (ChatGPT: no 5h/Weekly bars).
 * - Bottom row:
 *   - Left: "~N msgs left" (Claude), "N/A msgs left" (Gemini), or "msgs left" + [Limit] button (ChatGPT).
 *   - Right: flat context circle with percentage beside it (e.g. (◔) 20%).
 *   - Hover on context circle: ~220px popover anchored above circle with 150ms leave delay and
 *     viewport auto-flip (System, Hidden, You/Provider, divider, Total ~X / 200K).
 *   - Click on [Limit] (ChatGPT): toggles message limits mini box with outside-click dismiss.
 */

import { h, setText, setAttr, show, iconButton, textButton, ICONS } from '../shared/dom.js';
import { formatTokens, formatReset, formatMsgs, threshold, bandFor } from '../shared/formatters.js';
import { ResetCountdown } from '../../features/countdown/countdown.js';
import { shouldShowNewChatSuggestion } from '../../features/alerts/alerts.js';
import { formatBiggestItemDisplay, scrollToItem } from '../../features/biggest-item/biggest-item.js';
import { generateSparklinePath } from '../../features/history/history.js';
import { formatPreSendEstimate } from '../../features/pre-send/pre-send.js';
import { buildCheckpointMarkdown, downloadMarkdownFile } from '../../features/checkpoint/checkpoint-export.js';

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
    this._ctxHoverTimer = null;
    this._limitLeaveTimer = null;
    this._ringLimit = null;
    this._pinnedOpen = false;
    this._countdown = new ResetCountdown({
      withSeconds: true,
      withExact: true,
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

    // Header: Context ~96K / 200K · est. + Export + Gear buttons
    const dHead = h('div', 'drawer-header', this.drawer);
    const titleBox = h('div', null, dHead);
    titleBox.style.cssText = 'display:flex;align-items:baseline;gap:6px;';
    this.dTitle = h('span', 'drawer-title', titleBox, 'Context —');
    this.dModel = h('span', 'model-caption', titleBox);
    const btnBox = h('div', 'drawer-actions', dHead);
    btnBox.style.cssText = 'display:flex;align-items:center;gap:4px;';
    this.dExport = iconButton(btnBox, ICONS.export, 'Export conversation');
    this.dExport.b.classList.add('drawer-export');
    this.dExport.b.setAttribute('aria-label', 'Export conversation');
    this.dExport.b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.callbacks.onExportClick) this.callbacks.onExportClick();
    });
    this.dGear = iconButton(btnBox, ICONS.gear, 'Toggle developer diagnostics');
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
    this.dExportRow = h('div', 'export-row hide', this.dDev);
    this.dExportBtn = textButton(this.dExportRow, 'Export Checkpoint (MD)', () => this._exportCheckpoint());
    this.dExportBtn.classList.add('btn-checkpoint-export');
    h('div', 'sec-title', this.dDev, 'Diagnostics');
    this.dDevContent = h('div', null, this.dDev);

    this.dGear.b.addEventListener('click', (e) => {
      e.stopPropagation();
      this.devOpen = !this.devOpen;
      show(this.dDev, this.devOpen);
      this.dGear.b.setAttribute('aria-expanded', String(this.devOpen));
      if (this.callbacks.onToggleDev) this.callbacks.onToggleDev(this.devOpen);
    });

    // 2. Main Strip Box - single straight line floating below chat input
    this.strip = h('div', 'strip-box', this.root);
    this.strip.setAttribute('role', 'region');
    this.strip.setAttribute('tabindex', '0');
    this.strip.setAttribute('aria-label', 'AI Chat Usage and Context Strip');
    this.strip.setAttribute('aria-expanded', 'false');

    // Left Container: Session / 5h, separator, Weekly, or ChatGPT Limit button
    this.stripLeft = h('div', 'strip-top', this.strip);
    this.stripTop = this.stripLeft; // Compatibility alias for tests & callers
    this.stripBottomLeft = this.stripLeft; // Compatibility alias

    // Divider between top row and bottom row (kept hidden for compatibility)
    this.stripDivider = h('div', 'strip-divider hide', this.strip);

    // Left elements: "~N msgs left" (Claude/Gemini) + "Limit" button (ChatGPT)
    this.ctxMsgs = h('div', 'ctx-msgs hide', this.stripLeft);

    // ChatGPT Limit button & popover
    this.limitBtn = h('button', 'acm-limit-btn hide', this.stripLeft, 'Limit');
    this.limitBtn.type = 'button';
    this.limitBtn.setAttribute('aria-label', 'Message limits');
    this.limitBtn.setAttribute('aria-expanded', 'false');

    this.limitBox = h('div', 'acm-limit-box hide', this.stripLeft);
    this.limitBox.setAttribute('role', 'dialog');
    this.limitBox.setAttribute('aria-label', 'Message limits');

    // Right Side: model name in Claude + context circle + percentage beside it (◔) 20%
    this.stripRight = h('div', 'strip-bottom-right', this.strip);
    this.stripBottom = this.strip; // Compatibility alias
    this.stripBottomRight = this.stripRight; // Compatibility alias

    // Model name in Claude (shown before the context circle)
    this.ctxModel = h('span', 'ctx-model hide', this.stripRight);

    this.ctxRow = h('div', 'ctx-row', this.stripRight);

    // Flat context ring wrap
    this.ctxRingWrap = h('div', 'ctx-ring-wrap', this.ctxRow);
    this.ringBtn = h('button', 'ctx-ring-btn', this.ctxRingWrap);
    this.ringBtn.type = 'button';
    this.ringBtn.setAttribute('tabindex', '0');
    this.ringBtn.setAttribute('aria-label', 'Context circle: hover for breakdown');
    this.ringBtn.setAttribute('aria-expanded', 'false');

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

    // Hidden center wrap (kept for backwards compatibility if referenced)
    this.ringCenterWrap = h('div', 'ctx-ring-center-wrap hide', this.ctxRingWrap);
    this.ringCenterText = h('span', 'ctx-ring-center-text', this.ringCenterWrap, '—');

    // Percentage directly beside the circle
    this.ctxVal = h('span', 'ctx-pct', this.ctxRingWrap, '—');

    // Context breakdown popover on hover (~220px wide, anchored above circle)
    this.ctxPopover = h('div', 'acm-popover ctx-breakdown-popover hide', this.stripRight);
    this.ctxPopover.setAttribute('role', 'tooltip');
    this.ctxPopover.setAttribute('aria-label', 'Context breakdown');

    // Wire up HOVER interaction on context circle with ~150ms leave delay
    const openCtxPopover = () => {
      clearTimeout(this._ctxHoverTimer);
      this._renderCtxHoverPopover();
      this._positionPopover(this.ctxPopover, this.ctxRingWrap);
      show(this.ctxPopover, true);
      this.ringBtn.setAttribute('aria-expanded', 'true');
    };

    const closeCtxPopover = () => {
      clearTimeout(this._ctxHoverTimer);
      this._ctxHoverTimer = setTimeout(() => {
        show(this.ctxPopover, false);
        this.ringBtn.setAttribute('aria-expanded', 'false');
      }, 150);
    };

    this.ctxRingWrap.addEventListener('mouseenter', openCtxPopover);
    this.ctxRingWrap.addEventListener('mouseleave', closeCtxPopover);
    this.ctxPopover.addEventListener('mouseenter', () => clearTimeout(this._ctxHoverTimer));
    this.ctxPopover.addEventListener('mouseleave', closeCtxPopover);

    // Wire up HOVER & CLICK interaction on ChatGPT Limit button
    const openLimitBox = () => {
      clearTimeout(this._limitHoverTimer);
      this._renderLimitBox();
      this._positionPopover(this.limitBox, this.limitBtn);
      show(this.limitBox, true);
      this.limitBtn.setAttribute('aria-expanded', 'true');
    };

    const closeLimitBox = () => {
      clearTimeout(this._limitHoverTimer);
      this._limitHoverTimer = setTimeout(() => {
        show(this.limitBox, false);
        this.limitBtn.setAttribute('aria-expanded', 'false');
      }, 150);
    };

    this.limitBtn.addEventListener('mouseenter', openLimitBox);
    this.limitBtn.addEventListener('mouseleave', closeLimitBox);
    this.limitBox.addEventListener('mouseenter', () => clearTimeout(this._limitHoverTimer));
    this.limitBox.addEventListener('mouseleave', closeLimitBox);

    this.limitBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = !this.limitBox.classList.contains('hide');
      if (isOpen) {
        show(this.limitBox, false);
        this.limitBtn.setAttribute('aria-expanded', 'false');
      } else {
        openLimitBox();
      }
    });

    // Outside click dismiss & Escape key dismiss
    this._popoverDismissHandler = (e) => {
      if (this.limitBox && !this.limitBox.classList.contains('hide')) {
        if (!this.limitBox.contains(e.target) && !this.limitBtn.contains(e.target)) {
          show(this.limitBox, false);
          this.limitBtn.setAttribute('aria-expanded', 'false');
        }
      }
    };
    this._popoverKeyHandler = (e) => {
      if (e.key === 'Escape') {
        show(this.ctxPopover, false);
        show(this.limitBox, false);
        this.ringBtn.setAttribute('aria-expanded', 'false');
        this.limitBtn.setAttribute('aria-expanded', 'false');
      }
    };
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('click', this._popoverDismissHandler, true);
      document.addEventListener('keydown', this._popoverKeyHandler, true);
    }
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

  _closeAllPopovers() {
    show(this.ctxPopover, false);
    show(this.limitBox, false);
    if (this.ringBtn) this.ringBtn.setAttribute('aria-expanded', 'false');
    if (this.limitBtn) this.limitBtn.setAttribute('aria-expanded', 'false');
  }

  /**
   * Positions a popover anchored above the trigger element, flipping below if no room above.
   * @param {Element} popover
   * @param {Element} anchor
   */
  _positionPopover(popover, anchor) {
    if (!popover || !anchor) return;
    popover.classList.remove('flip-below');
    if (typeof anchor.getBoundingClientRect !== 'function') return;
    const rect = anchor.getBoundingClientRect();
    const popHeight = popover.offsetHeight || 140;
    // If less than 8px room above, flip below
    if (rect.top - popHeight < 8) {
      popover.classList.add('flip-below');
    }
  }

  /**
   * Renders the hover popover for context breakdown:
   * Rows: System, Hidden, You / Provider, divider, Total (~X / 200K)
   */
  _renderCtxHoverPopover() {
    const data = this._data;
    if (!data) return;
    const ctx = data.context || {};
    const bk = data.breakdown || {};
    const ringLimit = ctx.limit || (typeof this._ringLimit === 'number' ? this._ringLimit : null);
    const used = ctx.used;
    const isApprox = ctx.approx === true || ctx.source === 'estimated';

    this.ctxPopover.textContent = '';
    h('div', 'acm-popover-title', this.ctxPopover, 'Context breakdown');

    const uTokens = bk.user ?? 0;
    const aTokens = bk.assistant ?? 0;
    const sTokens = bk.system ?? 0;
    const hTokens = bk.hidden ?? 0;

    const fmtPctOrTokens = (tokens) => {
      if (ringLimit && Number.isFinite(ringLimit) && ringLimit > 0) {
        return `${Math.round((tokens / ringLimit) * 100)}%`;
      }
      if (tokens > 0) {
        return formatTokens(tokens) || '0';
      }
      return '0%';
    };

    // Row 1: System
    const rSys = h('div', 'acm-popover-row', this.ctxPopover);
    h('span', 'acm-popover-label', rSys, 'System');
    h('span', 'acm-popover-val', rSys, fmtPctOrTokens(sTokens));

    // Row 2: Hidden
    const rHid = h('div', 'acm-popover-row', this.ctxPopover);
    h('span', 'acm-popover-label', rHid, 'Hidden');
    h('span', 'acm-popover-val', rHid, hTokens > 0 ? fmtPctOrTokens(hTokens) : '0%');

    // Row 3: You / Provider (Claude / Gemini / etc.)
    const prov = data.provider || 'AI';
    const rYouAsst = h('div', 'acm-popover-row', this.ctxPopover);
    h('span', 'acm-popover-label', rYouAsst, `You / ${prov}`);
    const combinedTokens = uTokens + aTokens;
    h('span', 'acm-popover-val', rYouAsst, fmtPctOrTokens(combinedTokens));

    // Divider line
    h('div', 'acm-popover-divider', this.ctxPopover);

    // Row 4: Total (~X / 200K)
    const rTotal = h('div', 'acm-popover-row acm-popover-total', this.ctxPopover);
    h('span', 'acm-popover-label', rTotal, 'Total');
    const usedFmt = formatTokens(used, { approx: isApprox }) || '0';
    const limitFmt = ringLimit ? formatTokens(ringLimit) : 'N/A';
    h('span', 'acm-popover-val', rTotal, `~${usedFmt} / ${limitFmt}`);
  }

  /**
   * Renders the message limits mini box for ChatGPT.
   */
  _renderLimitBox() {
    const data = this._data;
    this.limitBox.textContent = '';
    h('div', 'acm-popover-title', this.limitBox, 'Message Limits');

    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const validLimits = rows.filter(r => r.label !== '5h' && r.label !== 'Weekly');

    if (validLimits.length === 0) {
      const emptyRow = h('div', 'acm-popover-row', this.limitBox);
      h('span', 'acm-popover-label', emptyRow, 'No limits tracked · subject to safeguards');
      return;
    }

    for (const r of validLimits) {
      const row = h('div', 'acm-popover-row', this.limitBox);
      h('span', 'acm-popover-label', row, r.label);

      let valStr;
      if (r.state === 'unlimited') {
        valStr = r.note || 'No limit · subject to safeguards';
      } else if (r.used !== undefined && r.max !== undefined) {
        valStr = `${r.used} / ${r.max}`;
      } else if (typeof r.percent === 'number') {
        valStr = `${Math.round(r.percent)}%`;
      } else if (r.note) {
        valStr = r.note;
      } else {
        valStr = 'Active';
      }

      if (r.resetsAt) {
        const resetStr = formatReset(r.resetsAt, Date.now(), { relative: true }) || '';
        if (resetStr) valStr += ` · ${resetStr}`;
      }

      h('span', 'acm-popover-val', row, valStr);
    }
  }

  /**
   * Renders the strip and drawer with standardized data.
   */
  render(data) {
    this._data = data;
    if (!data) {
      this.strip.style.display = 'none';
      return;
    }

    const rows = Array.isArray(data.rows) ? data.rows : [];
    const ctx = data.context || null;

    if (rows.length === 0 && (!ctx || ctx.used === undefined || ctx.used === null)) {
      this.strip.style.display = 'none';
      return;
    }
    this.strip.style.display = '';

    const isChatGPT = data.provider === 'ChatGPT';

    // -------------------------------------------------------------------------
    // 1. Render Top Row: 5h and Weekly limit bars (Claude & Gemini side-by-side)
    // -------------------------------------------------------------------------
    this.stripTop.textContent = '';
    this.dUsage.textContent = '';
    let hasUsageDetails = false;
    let primaryResetTs = null;
    let primaryResetEl = null;

    // Filter rows: for ChatGPT, remove 5h and Weekly bars
    const visibleRows = isChatGPT
      ? rows.filter(r => r.label !== '5h' && r.label !== 'Weekly')
      : rows;

    for (const r of visibleRows) {
      const uRow = h('div', 'u-row', this.stripTop);
      uRow.setAttribute('tabindex', '0');

      // Label (e.g. "5h", "Weekly")
      h('span', 'u-label', uRow, r.label);

      if (r.state === 'unlimited') {
        const noteText = r.note || 'No limit · subject to safeguards';
        const noteEl = h('span', 'u-note', uRow, noteText);
        noteEl.style.color = 'var(--muted)';
      } else if (typeof r.percent === 'number' && Number.isFinite(r.percent)) {
        const pct = Math.round(r.percent);
        const t = threshold(pct);
        const isEst = r.source === 'estimated';

        // Flat solid progress bar
        const barTrack = h('div', 'u-bar-track', uRow);
        const barFill = h('div', 'u-bar-fill', barTrack);
        barFill.style.width = `${Math.min(100, Math.max(0, pct))}%`;

        const fillClass = isEst ? `hatched-${t.state}` : `solid-${t.state}`;
        barFill.classList.add(fillClass);

        const pctEl = h('span', `u-pct ${t.state}`, uRow, t.symbol ? `${pct}% ${t.symbol}` : `${pct}%`);
        if (isEst) pctEl.title = 'Estimated';

        const isSessionRow = r.label?.toLowerCase().includes('5h') || r.label?.toLowerCase().includes('session');
        const resetStr = r.resetsAt
          ? (formatReset(r.resetsAt, Date.now(), { withSeconds: true, withExact: isSessionRow }) || formatReset(r.resetsAt) || '')
          : '';
        if (resetStr) {
          const rReset = h('span', 'u-reset', uRow, `· ${resetStr}`);
          if (data.features?.countdown !== false) {
            const rTs = typeof r.resetsAt === 'number' ? (r.resetsAt < 1e12 ? r.resetsAt * 1000 : r.resetsAt) : Date.parse(r.resetsAt);
            const curPrimaryTs = typeof primaryResetTs === 'number' ? (primaryResetTs < 1e12 ? primaryResetTs * 1000 : primaryResetTs) : (primaryResetTs ? Date.parse(primaryResetTs) : null);
            if (!primaryResetTs || (rTs && curPrimaryTs && rTs < curPrimaryTs)) {
              primaryResetTs = r.resetsAt;
              primaryResetEl = rReset;
            }
          }
        }

        // Gemini: remove heavy usage wording near usage tracker
        if (r.note && !(data.provider === 'Gemini' && r.note.toLowerCase().includes('heavy'))) {
          h('span', 'u-note', uRow, r.note);
        }

        const dRow = h('div', 'drawer-row usage-row', this.dUsage);
        const tag = isEst ? '🟡 est.' : '🟢 measured';
        const parts = [r.label, `${pct}%`, resetStr, tag].filter(Boolean);
        setText(dRow, parts.join(' · '));
        hasUsageDetails = true;
      } else {
        // Missing field -> show "N/A"
        const barTrack = h('div', 'u-bar-track', uRow);
        const barFill = h('div', 'u-bar-fill neutral', barTrack);
        barFill.style.width = '0%';
        h('span', 'u-pct neutral', uRow, 'N/A');
        if (r.note && !(data.provider === 'Gemini' && r.note.toLowerCase().includes('heavy'))) {
          h('span', 'u-note', uRow, r.note);
        }
      }
    }
    show(this.dUsage, hasUsageDetails);

    // Display top row and divider (hide on ChatGPT or if no rows)
    const showTopRow = !isChatGPT && visibleRows.length > 0;
    show(this.stripTop, showTopRow);
    show(this.stripDivider, showTopRow);

    if (primaryResetTs && primaryResetEl && data.features?.countdown !== false) {
      this._activeResetEl = primaryResetEl;
      this._countdown.start(primaryResetTs);
    } else {
      this._countdown.stop();
    }

    // -------------------------------------------------------------------------
    // 2. Render Left ("Limit" button for ChatGPT) & Right (Model + (◔) 20%)
    // -------------------------------------------------------------------------
    if (isChatGPT) {
      show(this.limitBtn, true);
      show(this.ctxMsgs, false); // Requirement 2: remove msg left in ChatGPT
    } else {
      show(this.limitBtn, false);
      if (typeof data.msgsLeft === 'number' && Number.isFinite(data.msgsLeft)) {
        const split = formatMsgs(data.msgsLeft, { split: true });
        if (split) {
          this.ctxMsgs.textContent = '';
          h('span', null, this.ctxMsgs, split.top + ' ' + split.bottom);
          this.ctxMsgs.title = 'Estimated messages left before limit';
          show(this.ctxMsgs, true);
        } else {
          setText(this.ctxMsgs, `~${data.msgsLeft} msgs left`);
          show(this.ctxMsgs, true);
        }
      } else if (data.provider === 'Gemini') {
        const note = data.rightNote ? ` (${data.rightNote})` : '';
        setText(this.ctxMsgs, `N/A msgs left${note}`);
        show(this.ctxMsgs, true);
      } else if (data.rightNote) {
        setText(this.ctxMsgs, data.rightNote);
        show(this.ctxMsgs, true);
      } else {
        show(this.ctxMsgs, false);
      }
    }

    // Model name in Claude displayed immediately before the context circle
    if (data.provider === 'Claude' && data.model) {
      setText(this.ctxModel, data.model);
      show(this.ctxModel, true);
    } else {
      show(this.ctxModel, false);
    }

    // Right side: Context Ring + percentage beside it (◔) 20%
    let ringState = 'C';
    let ringLimit = null;

    if (ctx) {
      if (ctx.limit && Number.isFinite(ctx.limit) && ctx.limit > 0) {
        ringState = 'A';
        ringLimit = ctx.limit;
      } else if (ctx.refLimit && Number.isFinite(ctx.refLimit) && ctx.refLimit > 0) {
        ringState = 'B';
        ringLimit = ctx.refLimit;
      } else {
        ringState = 'C';
      }
    }
    this._ringLimit = ringLimit;

    const used = ctx?.used;
    const isEstCtx = ctx?.source === 'estimated';
    const isApprox = ctx?.approx === true || isEstCtx;

    if (ringState === 'A' || ringState === 'B') {
      const pct = typeof used === 'number' && Number.isFinite(used) && ringLimit
        ? Math.round((used / ringLimit) * 100)
        : null;

      if (pct !== null) {
        const band = bandFor(pct);
        const t = threshold(pct);
        const offset = RING_CIRCUMFERENCE * (1 - Math.min(100, Math.max(0, pct)) / 100);

        this.ringArc.style.display = pct === 0 ? 'none' : '';
        this.ringArc.setAttribute('stroke-dashoffset', String(offset));
        const arcState = band === 'green' ? 'ok' : band === 'amber' ? 'warn' : 'danger';
        this.ringArc.className.baseVal = `ctx-ring-arc ${arcState} ${isEstCtx ? 'hatched' : ''}`;

        setText(this.ctxVal, t.symbol ? `${pct}% ${t.symbol}` : `${pct}%`);
        const ctxState = band === 'green' ? 'ok' : band === 'amber' ? 'warn' : 'danger';
        this.ctxVal.className = `ctx-pct ${ctxState}`;
      } else {
        this.ringArc.style.display = 'none';
        setText(this.ctxVal, 'N/A');
        this.ctxVal.className = 'ctx-pct neutral';
      }
    } else {
      // State C (e.g. ChatGPT default)
      // Requirement 2: in ChatGPT, circle should be colored with % for context
      if (isChatGPT && typeof used === 'number' && Number.isFinite(used)) {
        const fallbackLimit = (data.model && (data.model.includes('o1') || data.model.includes('o3'))) ? 200000 : 128000;
        this._ringLimit = fallbackLimit;
        const pct = Math.round((used / fallbackLimit) * 100);
        const band = bandFor(pct);
        const t = threshold(pct);
        const offset = RING_CIRCUMFERENCE * (1 - Math.min(100, Math.max(0, pct)) / 100);

        this.ringArc.style.display = pct === 0 ? 'none' : '';
        this.ringArc.setAttribute('stroke-dashoffset', String(offset));
        const arcState = band === 'green' ? 'ok' : band === 'amber' ? 'warn' : 'danger';
        this.ringArc.className.baseVal = `ctx-ring-arc ${arcState} ${isEstCtx ? 'hatched' : ''}`;

        setText(this.ctxVal, t.symbol ? `${pct}% ${t.symbol}` : `${pct}%`);
        const ctxState = band === 'green' ? 'ok' : band === 'amber' ? 'warn' : 'danger';
        this.ctxVal.className = `ctx-pct ${ctxState}`;
      } else {
        this.ringArc.style.display = 'none';
        const formattedUsed = typeof used === 'number' && Number.isFinite(used)
          ? formatTokens(used, { approx: isApprox })
          : 'N/A';
        setText(this.ctxVal, formattedUsed || 'N/A');
        this.ctxVal.className = 'ctx-pct neutral';
      }
    }

    // If popover is currently open, refresh its content
    if (!this.ctxPopover.classList.contains('hide')) {
      this._renderCtxHoverPopover();
    }
    if (!this.limitBox.classList.contains('hide')) {
      this._renderLimitBox();
    }

    // -------------------------------------------------------------------------
    // 3. Render Detail Drawer (unchanged)
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

    const bk = data.breakdown || {};
    const uTokens = bk.user || 0;
    const aTokens = bk.assistant || 0;
    const sTokens = bk.system || 0;
    const contextLimit = ringLimit || data.context?.limit || 200000;

    const uPct = contextLimit > 0 ? Math.round((uTokens / contextLimit) * 100) : 0;
    const aPct = contextLimit > 0 ? Math.round((aTokens / contextLimit) * 100) : 0;
    const sPct = contextLimit > 0 ? Math.round((sTokens / contextLimit) * 100) : 0;

    this.dSegUser.style.width = `${uPct}%`;
    this.dSegAsst.style.width = `${aPct}%`;
    this.dSegSys.style.width = `${sPct}%`;

    const provName = data.provider || 'Assistant';
    setText(this.dLegUser, `You ${uPct}%`);
    setText(this.dLegAsst, `${provName} & tools ${aPct}%`);
    setText(this.dLegSys, `System ${sPct}%`);

    const big = data.biggest;
    this._currentBiggest = big;
    const showBiggest = (data.features?.biggestItem ?? true) && big && typeof big.tokens === 'number' && big.tokens > 0;
    if (showBiggest) {
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

    const ctxPct = (ringState === 'A' || ringState === 'B') && ringLimit
      ? Math.round((used / ringLimit) * 100)
      : (typeof data.percentage === 'number' && Number.isFinite(data.percentage) ? Math.round(data.percentage) : null);
    const isEst = isEstCtx || data.context?.source === 'estimated';
    const showSuggest = shouldShowNewChatSuggestion(ctxPct, isEst ? 'estimated' : 'measured', data.features?.newChatSuggestion ?? true);
    show(this.dNewChatRow, showSuggest);

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

    show(this.dExportRow, Boolean(data.features?.checkpointExport));
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
    if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('click', this._popoverDismissHandler, true);
      document.removeEventListener('keydown', this._popoverKeyHandler, true);
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
