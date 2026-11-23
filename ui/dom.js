/**
 * Context Monitor - shared DOM helpers and components (h, icons, Section, RowList, HiddenStack, formatters).
 * Moved out of overlay-ui.js so the widgets and the side panel build the same DOM. No dependencies.
 */

export const ICONS = {
  chevron: 'M4 6l4 4 4-4',
  refresh: 'M13 8a5 5 0 1 1-1.5-3.55M13 2.5v3h-3',
  copy: 'M5.5 5.5V3.5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M2.5 6.5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1z',
  gear: 'M6.5 1.5h3l.4 1.5a5 5 0 0 1 1.2.7l1.5-.5 2.1 2.1-.5 1.5c.3.4.5.8.7 1.2l1.5.4v3l-1.5.4a5 5 0 0 1-.7 1.2l.5 1.5-2.1 2.1-1.5-.5a5 5 0 0 1-1.2.7l-.4 1.5h-3l-.4-1.5a5 5 0 0 1-1.2-.7l-1.5.5-2.1-2.1.5-1.5a5 5 0 0 1-.7-1.2l-1.5-.4v-3l1.5-.4a5 5 0 0 1 .7-1.2l-.5-1.5 2.1-2.1 1.5.5a5 5 0 0 1 1.2-.7l.4-1.5zM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z'
};

export const fmtK = (n) => {
  if (n === null || n === undefined) return '—';
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(Math.round(n / 100) / 10).toString().replace(/\.0$/, '')}K`;
  return `${(Math.round(n / 1e4) / 100).toString()}M`;
};
export const fmtInt = (n) => (n === null || n === undefined ? '—' : Math.round(n).toLocaleString());
export const tone = (p) => (p === null || p === undefined ? '' : p > 85 ? 'bad' : p >= 60 ? 'warn' : '');
export const levelName = (lvl) => (lvl ? lvl.charAt(0) + lvl.slice(1).toLowerCase() : 'Low');
export const reducedMotion = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

export function h(tag, cls, parent, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  if (parent) parent.appendChild(n);
  return n;
}
/** Writes only when the value changed: identical updates cause no DOM mutation. */
export const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };
export const setClass = (node, cls) => { if (node.className !== cls) node.className = cls; };
export const setAttr = (node, name, value) => { if (node.getAttribute(name) !== value) node.setAttribute(name, value); };
export const show = (node, visible) => { node.classList.toggle('hide', !visible); };

/** Stroked 16x16 icon. */
export function icon(parent, d) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.6');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  parent.appendChild(svg);
  return { svg, path };
}

export function iconButton(parent, d, label) {
  const b = h('button', 'ib', parent);
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.dataset.tip = label;
  return { b, ...icon(b, d) };
}

/** The single "≈" badge (estimated / unverified / unknown), explained in a tooltip. */
export function approx(parent, tip, mark = '≈') {
  const s = h('span', 'approx', parent, mark);
  s.dataset.tip = tip;
  s.setAttribute('aria-label', tip);
  s.tabIndex = 0;
  return s;
}
export const TAG_TIPS = {
  EXACT: 'Exact: counted from the full conversation',
  OBSERVED: 'Observed: read directly from the page',
  ESTIMATED: 'Estimated: not reported by the site',
  UNKNOWN: 'Not measurable from the page',
  UNVERIFIED: 'Window from our limits table, not confirmed for this plan'
};

/** "28% · resets in 3h 57m" / "5 left · resets in 30d" / "limit reached", or a note before the site reports it. */
export const limitText = (l) => {
  if (l.note && (l.percent === null || l.percent === undefined)) return l.note;
  const reset = l.resetIn ? ` · resets in ${l.resetIn}` : '';
  if (l.key === 'limit') return `limit reached${reset}`;
  if (l.remaining !== undefined && l.remaining !== null) return `${l.blocked ? 'used up' : `${l.remaining} left`}${reset}`;
  if (l.percent === null || l.percent === undefined) return l.note || 'updates after your next message';
  const est = l.estimated ? '≈ ' : '';
  return `${est}${l.percent}%${reset}`;
};
/** Headline limit: the session, else anything used up, else the allowance closest to running out. */
export const headlineLimit = (limits = []) => limits.find(l => l.key === 'session') || limits.find(l => l.blocked) ||
  limits.filter(l => typeof l.remaining === 'number').sort((a, b) => a.remaining - b.remaining)[0] || null;

/** Collapsible section; closed by default, open state survives updates (DOM is built once). */
export function Section(parent, title) {
  const el = h('section', 'sec', parent);
  const head = h('button', 'sec-h', el);
  head.type = 'button';
  h('span', null, head, title);
  icon(head, ICONS.chevron);
  head.setAttribute('aria-expanded', 'false');
  const body = h('div', 'sec-b', el);
  body.hidden = true;
  head.addEventListener('click', () => {
    const open = head.getAttribute('aria-expanded') !== 'true';
    head.setAttribute('aria-expanded', String(open));
    body.hidden = !open;
  });
  return { el, body };
}

/** Label/value rows; rebuilt only when the rows change. */
export function RowList(parent) {
  const el = h('div', null, parent);
  let signature = null;
  return {
    update(rows) {
      const next = JSON.stringify(rows);
      if (next === signature) return;
      signature = next;
      el.textContent = '';
      for (const r of rows) {
        const row = h('div', 'row', el);
        h('span', 'k', row, r.label);
        const v = h('span', 'v', row, r.value);
        if (r.tip) approx(v, r.tip, r.mark);
      }
    }
  };
}

/**
 * Hidden context as one stacked bar (counted items, exact tokens on hover) plus a legend. Each legend
 * entry opens that item's text. Items not counted are listed but left out of the bar.
 */
export function HiddenStack(parent) {
  const bar = h('div', 'stack', parent);
  bar.setAttribute('role', 'img');
  const legend = h('div', null, parent);
  let signature = null;
  return {
    update(items) {
      const next = JSON.stringify(items);
      if (next === signature) return;
      signature = next;
      const open = new Set([...legend.querySelectorAll('.leg[aria-expanded="true"]')].map(b => b.dataset.key));
      bar.textContent = '';
      legend.textContent = '';
      const counted = items.filter(i => i.note !== 'not counted' && i.tokens > 0);
      const total = counted.reduce((n, i) => n + i.tokens, 0);
      bar.setAttribute('aria-label', `Hidden context: ${total.toLocaleString()} tokens in ${counted.length} parts`);
      items.forEach((it, idx) => {
        const color = `var(--s${(idx % 8) + 1})`;
        const est = it.note === 'estimate';
        const off = it.note === 'not counted';
        if (!off && it.tokens > 0) {
          const seg = h('i', null, bar);
          seg.style.flex = `${it.tokens} 0 0`;
          seg.style.background = color;
          seg.dataset.tip = `${it.label}: ${est ? '≈' : ''}${it.tokens.toLocaleString()} tokens`;
        }
        const key = `${idx}:${it.label}`;
        const row = h('button', 'leg', legend);
        row.type = 'button';
        row.dataset.key = key;
        const sw = h('span', `sw${off ? ' off' : ''}`, row);
        sw.style.background = color;
        h('span', 'l', row, it.label);
        h('span', 't', row, `${est ? '≈' : ''}${it.tokens.toLocaleString()}${off ? ' · not counted' : ''}`);
        const pre = h('pre', null, legend, it.text || '(no text)');
        const isOpen = open.has(key);
        row.setAttribute('aria-expanded', String(isOpen));
        pre.hidden = !isOpen;
        row.addEventListener('click', () => {
          const o = row.getAttribute('aria-expanded') !== 'true';
          row.setAttribute('aria-expanded', String(o));
          pre.hidden = !o;
        });
      });
    }
  };
}

export function textButton(parent, label, onClick, cls = 'btn') {
  const b = h('button', cls, parent, label);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

/** Saves text as a file named `<base>-YYYY-MM-DD.<ext>` (a plain download: no permission needed). */
export function download(parent, base, ext, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', null, parent);
  a.href = url;
  a.download = `${base}-${new Date().toISOString().slice(0, 10)}.${ext}`;
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
