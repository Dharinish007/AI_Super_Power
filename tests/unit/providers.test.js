/**
 * Claude + Gemini provider adapters: conversation reading, live updates, model / plan detection,
 * published context limits, estimated tokens and confidence. Runs the real ProviderCoordinator with
 * only the page and network edges stubbed.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ClaudeProvider, GeminiProvider, claudeModelKey, providerForHost, parseBatchexecute, buildGeminiContractData } from '../../src/providers/common/providers.js';
import { ProviderCoordinator } from '../../src/providers/common/provider-coordinator.js';
import { ConfidenceEngine } from '../../src/engine/confidence-engine.js';
import { Tokenizer } from '../../src/engine/tokenizer.js';
import { toWidgetState, formatResetIn } from '../../src/ui/widget/widget-state.js';
import { limitText } from '../../src/ui/shared/dom.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLAUDE_CONV = '11111111-2222-4333-8444-555555555555';

/** Minimal element: text, tag, attribute-selector matching for the adapters' selectors. */
function el(tag, text, attrs = {}, parent = null) {
  const node = {
    tagName: tag.toUpperCase(), textContent: text, attrs, parentElement: parent,
    matches(sel) { return sel.split(',').some(s => matchOne(node, s.trim())); },
    closest(sel) { for (let n = node; n; n = n.parentElement) if (n.matches(sel)) return n; return null; },
    querySelector(sel) { return (node.children || []).find(c => c.matches(sel)) || null; },
    querySelectorAll() { return []; }
  };
  return node;
}
function matchOne(node, s) {
  const attr = s.match(/^\[([\w-]+)="([^"]+)"\]$/);
  if (attr) return node.attrs[attr[1]] === attr[2];
  if (s.startsWith('.')) return (node.attrs.class || '').split(' ').includes(s.slice(1));
  return node.tagName.toLowerCase() === s.toLowerCase();
}
const doc = (nodes, extra = {}) => ({
  querySelectorAll: (sel) => (extra.all?.(sel)) || nodes.filter(n => n.matches(sel)),
  querySelector: (sel) => (extra.one?.(sel)) || null,
  cookie: extra.cookie || ''
});

function claudeTree() {
  const msg = (uuid, parent, sender, content, extra = {}) => ({ uuid, parent_message_uuid: parent, sender, content, ...extra });
  return {
    uuid: CLAUDE_CONV,
    model: 'claude-opus-5-5',
    current_leaf_message_uuid: 'a2',
    chat_messages: [
      msg('u1', '00000000-0000-4000-8000-000000000000', 'human', [{ type: 'text', text: 'Summarize the attached notes please.' }],
        { attachments: [{ file_name: 'notes.txt', extracted_content: 'Meeting notes: ship the adapter on Friday.' }], files: [{ file_kind: 'image' }] }),
      msg('a1', 'u1', 'assistant', [
        { type: 'thinking', thinking: 'internal reasoning that is not resent' },
        { type: 'tool_use', name: 'web_search', input: { query: 'adapter release' } },
        { type: 'tool_result', content: [{ type: 'text', text: 'Result: release notes page.' }] },
        { type: 'text', text: 'The notes say the adapter ships on Friday.' }
      ]),
      msg('u2', 'a1', 'human', [{ type: 'text', text: 'And the owner?' }]),
      msg('a2', 'u2', 'assistant', [{ type: 'text', text: 'The notes do not name an owner.' }]),
      msg('x2', 'u2', 'assistant', [{ type: 'text', text: 'An abandoned regenerated branch that must not count.' }])
    ]
  };
}

/** ProviderCoordinator with the page and API stubbed. */
function harness(provider, env) {
  const c = new ProviderCoordinator(provider);
  const p = Object.create(provider);
  p.extractMessages = () => env.dom || [];
  p.detectModel = () => env.domModel || null;
  p.detectPlan = () => env.domPlan || null;
  p.fetchConversation = async () => {
    env.apiCalls = (env.apiCalls || 0) + 1;
    if (env.apiError) throw new Error(env.apiError);
    return env.api ? provider.normalizeConversation ? { ...provider.normalizeConversation(env.api), plan: env.accountPlan || null, hidden: env.hidden } : null : null;
  };
  c.provider = p;
  c.overlayUI = { mount() {}, render() {}, update(vm) { env.vm = vm; } };
  c.syncState = () => {};
  const run = async (event) => { await c.handleDOMChange(event); return c.latestState; };
  return { c, run };
}

export async function runProvidersTests() {
  console.log('--- Running Claude + Gemini Provider Adapter Tests ---');
  let passed = 0;
  let failed = 0;
  const assert = (name, cond) => {
    if (cond) { console.log(`  ✅ [PASS] ${name}`); passed++; } else { console.error(`  ❌ [FAIL] ${name}`); failed++; }
  };
  const saved = { document: globalThis.document, location: globalThis.location };
  const tk = new Tokenizer();
  const count = (t) => tk.countTokens(t, 'o200k_base');
  const claudeCount = (t) => Math.round(count(t) * 1.4); // Claude adapter's tokenizer correction

  try {
    // ------------------------------------------------------------------ routing
    assert('claude.ai -> Claude adapter, gemini.google.com -> Gemini adapter', providerForHost('claude.ai') === ClaudeProvider && providerForHost('gemini.google.com') === GeminiProvider);
    assert('ChatGPT hosts keep the ChatGPT coordinator (no adapter)', providerForHost('chatgpt.com') === null && providerForHost('chat.openai.com') === null && providerForHost('') === null);

    // ------------------------------------------------------------------ Claude: ids, models, limits
    assert('Claude conversation id from /chat/<uuid>; new chat has none',
      ClaudeProvider.conversationId(`https://claude.ai/chat/${CLAUDE_CONV}`) === CLAUDE_CONV && ClaudeProvider.conversationId('https://claude.ai/new') === null);
    assert('Claude model keys: API slugs and selector text agree',
      claudeModelKey('claude-opus-5-5') === 'opus-5.5' && claudeModelKey('Opus 5.5') === 'opus-5.5' &&
      claudeModelKey('claude-sonnet-4-5-20250929') === 'sonnet-4.5' && claudeModelKey('claude-3-5-sonnet-20241022') === 'sonnet-3.5' &&
      claudeModelKey('Sonnet 5') === 'sonnet-5' && claudeModelKey('Fable 5.1') === 'fable-5.1' && claudeModelKey('New chat') === null);
    const l1 = ClaudeProvider.resolveLimit('claude-opus-5-5', 'pro');
    const l2 = ClaudeProvider.resolveLimit('claude-sonnet-4-5-20250929', 'max');
    assert('Claude: Opus 5.5 on a paid plan = 1M (published), VERIFIED', l1.contextWindow === 1000000 && l1.status === 'VERIFIED' && /support\.claude\.com/.test(l1.source));
    assert('Claude: other models on paid plans = 200K (published)', l2.contextWindow === 200000 && l2.status === 'VERIFIED');
    // Haiku 5.5 shares the 1M window with Opus 5.5, Sonnet 5, Sonnet 5.5, and Fable 5.1 on paid plans; 200K on free.
    const lHaiku = ClaudeProvider.resolveLimit('claude-haiku-5-5', 'max');
    assert('Claude: Haiku 5.5 on paid plans = 1M (published, VERIFIED)', lHaiku.contextWindow === 1000000 && lHaiku.status === 'VERIFIED' && /support\.claude\.com/.test(lHaiku.source));
    assert('Claude: Haiku 5.5 on free plan = 200K (standard published)', ClaudeProvider.resolveLimit('claude-haiku-5-5', 'free').contextWindow === 200000 && ClaudeProvider.resolveLimit('claude-haiku-5-5', 'free').status === 'VERIFIED');
    assert('Claude: Free plan window is 200K (standard published)', ClaudeProvider.resolveLimit('Sonnet 5', 'free').contextWindow === 200000 && ClaudeProvider.resolveLimit('Sonnet 5', 'free').status === 'VERIFIED');
    assert('Claude: unknown plan or unrecognized model -> UNKNOWN, never guessed',
      ClaudeProvider.resolveLimit('Opus 5.5', 'unknown').contextWindow === null && ClaudeProvider.resolveLimit('mystery', 'pro').recognized === false);
    assert('Claude plan from account capabilities',
      ClaudeProvider.planFromOrganization({ capabilities: ['chat', 'claude_max'] }).value === 'max' &&
      ClaudeProvider.planFromOrganization({ capabilities: ['chat', 'claude_pro'] }).evidenceType === 'OBSERVED' &&
      ClaudeProvider.planFromOrganization({ capabilities: ['chat', 'raven'], raven_type: 'enterprise' }).value === 'enterprise' &&
      ClaudeProvider.planFromOrganization({ capabilities: ['chat'] }).evidenceType === 'ESTIMATED' &&
      ClaudeProvider.planFromOrganization(null) === null);

    // ------------------------------------------------------------------ Claude: conversation reading
    const norm = ClaudeProvider.normalizeConversation(claudeTree());
    const texts = norm.messages.map(m => m.text).join(' | ');
    assert('Claude: only the active branch is read (abandoned branch excluded)', !texts.includes('abandoned') && norm.visibleTurns === 4);
    assert('Claude: earlier thinking is not counted (not resent)', !texts.includes('internal reasoning'));
    assert('Claude: tool call stays in the reply, tool result is a tool turn',
      norm.messages.some(m => m.role === 'tool' && m.text.includes('release notes page')) && norm.messages.some(m => m.role === 'assistant' && m.text.includes('adapter release')));

    // ------------------------------------------------------------------ Claude: hidden context
    {
      const items = ClaudeProvider.hiddenContext({
        conv: { settings: { enabled_web_search: true } },
        profile: { conversation_preferences: 'Answer in short bullet points.' },
        account: { settings: { enabled_artifacts_attachments: true, enabled_web_search: false } },
        project: { prompt_template: 'You review Chrome extensions.' },
        kb: { knowledge_size: 12000 }
      });
      const kinds = items.map(i => i.kind).join(',');
      assert('Claude hidden: system prompt, preferences, project instructions, knowledge, enabled tools', kinds === 'system_prompt,instructions,instructions_base,project,project_knowledge,tool,tool');
      assert('Claude hidden: conversation settings override account settings (web search on for this chat)', items.some(i => /Web search/.test(i.label)));
      assert('Claude hidden: fixed costs are estimates, text items carry their text', items.filter(i => i.estimated).every(i => i.tokens > 0) && items.find(i => i.kind === 'instructions').text.includes('bullet'));
      const searched = ClaudeProvider.hiddenContext({ conv: { settings: { use_project_knowledge_search: true } }, kb: { knowledge_size: 900000 } });
      assert('Claude hidden: project in search mode is shown but not counted', searched.find(i => i.kind === 'project_knowledge').included === false);
      assert('Claude hidden: nothing readable -> only the system prompt estimate', ClaudeProvider.hiddenContext({}).length === 1);
    }

    // ------------------------------------------------------------------ Claude: usage limits
    {
      const now = Date.parse('2026-09-28T12:00:00Z');
      const newer = ClaudeProvider.parseUsage({ limits: [
        { kind: 'session', percent: 28, resets_at: '2026-09-28T15:57:00Z' },
        { kind: 'weekly_all', percent: 12.4, resets_at: '2026-10-02T12:00:00Z' },
        { kind: 'weekly_scoped', percent: 40, resets_at: null, scope: { model: { display_name: 'Opus' } } },
        { kind: 'mystery', percent: 99 }
      ] });
      assert('Usage (limits[] shape): 5h, weekly and per-model weekly; unknown kinds skipped',
        newer.map(l => `${l.key}:${l.percent}`).join(',') === '5h:28,weekly:12,weekly:Opus:40');
      const older = ClaudeProvider.parseUsage({ five_hour: { utilization: 7, resets_at: '2026-09-28T13:00:00Z' }, seven_day: null });
      assert('Usage (older top-level shape) is read too', older.length === 1 && older[0].key === '5h' && older[0].percent === 7);
      assert('Usage: missing or malformed response -> no limits', ClaudeProvider.parseUsage(null).length === 0 && ClaudeProvider.parseUsage({ limits: [{ kind: 'session' }] }).length === 0);
      assert('Reset time formatted relative to now', formatResetIn(newer[0].resetsAt, now) === '3h 57m' &&
        formatResetIn(newer[1].resetsAt, now) === '4d 0h' && formatResetIn(now - 1000, now) === null && formatResetIn(null, now) === null);
      const vm = toWidgetState({ tokens: {}, observables: {}, limits: newer }, { provider: 'Claude' });
      assert('Widget state carries the limits; other providers get none', vm.limits.length === 3 && toWidgetState({ tokens: {}, observables: {} }).limits.length === 0);

      // Stream event (the only source when /usage is empty, e.g. Free plan)
      const ml = ClaudeProvider.parseMessageLimit({ resetsAt: 1790000000, windows: { '5h': { utilization: 0.19 }, '7d': { utilization: 0.05, resets_at: '2026-10-02T12:00:00Z' } } });
      assert('message_limit: 5h/7d fractions -> 5h/Weekly percent; epoch-seconds reset -> ms',
        ml.length === 2 && ml[0].key === '5h' && ml[0].percent === 19 && ml[0].resetsAt === 1790000000000 && ml[1].percent === 5 && ml[1].resetsAt === Date.parse('2026-10-02T12:00:00Z'));
      const mlWithin = ClaudeProvider.parseMessageLimit({ type: 'within_limit' });
      assert('message_limit: within_limit -> dynamic note', mlWithin.length === 1 && mlWithin[0].note === 'Within limit · Dynamic');
      const mlExceeded = ClaudeProvider.parseMessageLimit({ type: 'exceeded_limit', resetsAt: 1790000000 });
      assert('message_limit: exceeded_limit -> blocked with reset time', mlExceeded.length === 1 && mlExceeded[0].blocked === true && mlExceeded[0].resetsAt === 1790000000000);
      assert('message_limit: malformed -> nothing', ClaudeProvider.parseMessageLimit(null).length === 0 && ClaudeProvider.parseMessageLimit({ windows: { '5h': {} } }).length === 0);

      const coord = new ProviderCoordinator(ClaudeProvider);
      assert('Limits: nothing known yet -> placeholder 5h row (percent null)', coord._currentLimits([]).length === 1 && coord._currentLimits([])[0].percent === null && coord._currentLimits([])[0].label === '5h');
      assert('Limits: Free plan initial load -> dynamic limit note', coord._currentLimits([], 'Free')[0].note === 'Available · Dynamic limit');

      // Account-wide fetchUsage testing
      const fakeFetch = async (url) => {
        if (url === '/api/organizations') return [{ uuid: 'org-test', capabilities: ['chat'] }];
        if (url === '/api/organizations/org-test/usage') {
          return { five_hour: { utilization: 0.65, resets_at: '2026-11-22T20:00:00Z' }, seven_day: { utilization: 0.07, resets_at: '2026-11-29T20:00:00Z' } };
        }
        throw new Error('404');
      };
      const fetchedLimits = await ClaudeProvider.fetchUsage(fakeFetch);
      assert('fetchUsage: parses 5h and 7d from /api/organizations/{org}/usage',
        fetchedLimits.length === 2 && fetchedLimits[0].percent === 65 && fetchedLimits[1].percent === 7);

      // Storage key scoping by organization
      assert('Limit keys: un-scoped when org is null', coord._limitKey() === 'limits:Claude' && coord._limitKey('account') === 'limits:Claude:account');
      const scopedCoord = new ProviderCoordinator({ ...ClaudeProvider, getOrgId: () => 'user-org-uuid' });
      assert('Limit keys: scoped by org when present', scopedCoord._limitKey() === 'limits:Claude:user-org-uuid' && scopedCoord._limitKey('account') === 'limits:Claude:user-org-uuid:account');
      assert('limitText: estimated percentage includes ≈ badge', limitText({ percent: 25, estimated: true, resetIn: '4h 12m' }) === '≈ 25% · resets in 4h 12m');
      assert('limitText: exact percentage without ≈ badge', limitText({ percent: 25, estimated: false, resetIn: '4h 12m' }) === '25% · resets in 4h 12m');

      coord._streamLimits = { limits: [{ id: '5h', key: '5h', label: '5h', percent: 19, resetsAt: Date.now() + 3600000 }], at: Date.now() };
      assert('Limits: streamed value used when /usage is empty', coord._currentLimits([])[0].percent === 19);
      coord._api = { at: Date.now() + 1000 };
      assert('Limits: a newer /usage read wins over the streamed value', coord._currentLimits([{ id: '5h', key: '5h', label: '5h', percent: 30, resetsAt: null }])[0].percent === 30);
      coord._api = null;
      coord._streamLimits.limits[0].resetsAt = Date.now() - 1000;
      assert('Limits: past the reset time -> 0%, no reset shown', coord._currentLimits([])[0].percent === 0 && coord._currentLimits([])[0].resetsAt === null);
      assert('Limits: providers without a stream source get no placeholder', new ProviderCoordinator(GeminiProvider)._currentLimits([]).length === 0);
      // Streamed value keeps winning even when the timestamps land in the same millisecond and both show
      // a smaller percentage than the API copy — this was the five-hour reduction bug.
      const sameMs = Date.now();
      coord._streamLimits = { limits: [{ id: '5h', key: '5h', label: '5h', percent: 9, resetsAt: sameMs + 3600000 }], at: sameMs };
      coord._api = { at: sameMs };
      assert('Limits: streamed value wins on equal milliseconds', coord._currentLimits([{ id: '5h', key: '5h', label: '5h', percent: 30, resetsAt: null }])[0].percent === 9);

      // 5-hour rolling session window estimation on Claude Free tier
      coord._streamLimits = null;
      coord._api = null;
      const freeLimitsFromApi = [
        { id: '5h', key: '5h', label: '5h', percent: 0, resetsAt: null },
        { id: 'weekly', key: 'weekly', label: 'Weekly', percent: 7, resetsAt: Date.now() + 8 * 3600 * 1000 }
      ];
      const userMsgs = [{ role: 'user', text: 'hi', tokens: 10, createdAt: Date.now() - 60000 }];
      const resolvedFree = coord._currentLimits(freeLimitsFromApi, 'Free', userMsgs, 'claude-3-5-haiku-20241022');
      assert('Limits: Free tier with user messages estimates 5h rolling session',
        resolvedFree[0].key === '5h' && resolvedFree[0].label === '5h' && resolvedFree[0].estimated === true && resolvedFree[0].percent > 0 && typeof resolvedFree[0].resetsAt === 'number');
      assert('Limits: Weekly limit preserved from server',
        resolvedFree[1].key === 'weekly' && resolvedFree[1].percent === 7);

      // Pro plan with authoritative session limit preserves server value without estimating
      const proLimitsFromApi = [
        { id: '5h', key: '5h', label: '5h', percent: 45, resetsAt: Date.now() + 3600000, estimated: false },
        { id: 'weekly', key: 'weekly', label: 'Weekly', percent: 12, resetsAt: Date.now() + 8 * 3600 * 1000 }
      ];
      const resolvedPro = coord._currentLimits(proLimitsFromApi, 'Pro', userMsgs, 'claude-3-5-sonnet-20241022');
      assert('Limits: Pro tier with authoritative session preserves exact server values',
        resolvedPro[0].key === '5h' && resolvedPro[0].label === '5h' && resolvedPro[0].percent === 45 && !resolvedPro[0].estimated);

      // Claude shared contract verification
      const contract = ClaudeProvider.toContractData({
        tokens: { totalMeasurable: 96000, user: 4000, assistant: 55000, hidden: 37000 },
        model: { contextWindow: 200000 },
        limits: [
          { id: '5h', label: '5h', used: 67, total: 100, resetsAt: 1700000000000, source: 'api' },
          { id: 'weekly', label: 'Weekly', used: 12, total: 100, resetsAt: 1700500000000, source: 'api' }
        ]
      });
      assert('Claude toContractData adheres to shared contract',
        contract.provider === 'claude' &&
        contract.context.used === 96000 &&
        contract.context.limit === 200000 &&
        contract.context.confidence === 'estimate' &&
        contract.context.segments.length === 3 &&
        contract.context.segments[0].id === 'user' && contract.context.segments[0].tokens === 4000 &&
        contract.context.segments[1].id === 'assistant' && contract.context.segments[1].tokens === 55000 &&
        contract.context.segments[2].id === 'system' && contract.context.segments[2].tokens === 37000 &&
        contract.limits.length === 2 &&
        contract.limits[0].id === '5h' && contract.limits[0].label === '5h' && contract.limits[0].used === 67 &&
        contract.limits[1].id === 'weekly' && contract.limits[1].label === 'Weekly'
      );

      // Watcher (MAIN world): forwards only message_limit from a completion stream, page response untouched
      const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../content/claude-limit-watcher.js'), 'utf8');
      const posted = [];
      const sse = 'event: completion\ndata: {"type":"completion","completion":"SECRET reply text"}\n\n' +
        'event: message_limit\ndata: {"type":"message_limit","message_limit":{"windows":{"5h":{"utilization":0.19}}}}\n\n';
      const fakeWin = {
        location: { origin: 'https://claude.ai' },
        postMessage: (msg) => posted.push(msg),
        fetch: async () => new Response(sse, { status: 200 })
      };
      new Function('window', src)(fakeWin);
      const pageRes = await fakeWin.fetch('https://claude.ai/api/organizations/o1/chat_conversations/c1/completion', { method: 'POST' });
      const pageText = await pageRes.text();
      await new Promise(r => setTimeout(r, 20));
      assert('Watcher: page still reads the full stream', pageText === sse);
      assert('Watcher: forwards only the message_limit object, never reply text',
        posted.length === 1 && posted[0].source === 'CONTEXT_MONITOR_CLAUDE_LIMIT' && posted[0].messageLimit.windows['5h'].utilization === 0.19 && !JSON.stringify(posted).includes('SECRET'));
      await fakeWin.fetch('https://claude.ai/api/organizations/o1/chat_conversations/c1');
      await new Promise(r => setTimeout(r, 20));
      assert('Watcher: other requests are ignored', posted.length === 1);
    }
    assert('Claude: text extracted from attached files is counted with the user turn', norm.messages[0].role === 'user' && norm.messages[0].text.includes('Meeting notes'));
    assert('Claude: files without visible content are flagged unknown', norm.attachments.count === 2 && norm.attachments.hasUnknown === true);

    // ------------------------------------------------------------------ Claude: brand-new chat (saved copy has no turns yet)
    globalThis.location = { href: `https://claude.ai/chat/${CLAUDE_CONV}`, hostname: 'claude.ai', pathname: `/chat/${CLAUDE_CONV}` };
    globalThis.document = { cookie: '', querySelector: () => null, querySelectorAll: () => [] };
    {
      const env = { api: { uuid: CLAUDE_CONV, chat_messages: [] }, accountPlan: { value: 'pro', evidenceType: 'OBSERVED' }, domModel: 'Sonnet 5',
        dom: [{ id: 'claude-dom-0-user', role: 'user', text: 'hi' }, { id: 'claude-dom-1-assistant', role: 'assistant', text: 'Hi there!' }] };
      const { c, run } = harness(ClaudeProvider, env);
      const s = await run();
      const vm = toWidgetState(s);
      assert('Claude new chat: empty saved copy -> page text, labelled not saved yet, not a lower bound',
        s.observables.dataSource === 'dom_unsaved' && s.completeness.isLowerBound === false && vm.source === 'Page text (not saved yet)' && !vm.warning);
      assert('Claude new chat: empty saved copy is retried within seconds, not cached for the TTL', Date.now() - c._api.at > 50000);
    }

    // ------------------------------------------------------------------ Claude: full pipeline
    globalThis.location = { href: `https://claude.ai/chat/${CLAUDE_CONV}`, hostname: 'claude.ai', pathname: `/chat/${CLAUDE_CONV}` };
    globalThis.document = { cookie: '', querySelector: () => null, querySelectorAll: () => [] };
    {
      const env = { api: claudeTree(), accountPlan: { value: 'pro', evidenceType: 'OBSERVED' }, domModel: 'Opus 5.5', dom: [
        { id: 'claude-dom-0-user', role: 'user', text: 'Summarize the attached notes please.' },
        { id: 'claude-dom-1-assistant', role: 'assistant', text: 'The notes say the adapter ships on Friday.' },
        { id: 'claude-dom-2-user', role: 'user', text: 'And the owner?' },
        { id: 'claude-dom-3-assistant', role: 'assistant', text: 'The notes do not name an owner.' }
      ] };
      const { run } = harness(ClaudeProvider, env);
      const s = await run();
      // Tool results before the latest user message are not resent
      const lastUser = norm.messages.map(m => m.role).lastIndexOf('user');
      const expected = norm.messages.filter((m, i) => !(m.role === 'tool' && i < lastUser)).reduce((sum, m) => sum + claudeCount(m.text), 0);
      const vm = toWidgetState(s, { provider: 'Claude' });
      assert('Claude: saved conversation read through the API', s.observables.dataSource === 'authoritative' && s.completeness.completenessSource === 'authoritative_api');
      assert('Claude: tokens = o200k count of the active branch (file text, calls; older tool results excluded)', s.tokens.totalMeasurable === expected);
      assert('Claude: 1M window for Opus 5.5 on Pro, percentage computed', s.model.contextWindow === 1000000 && s.utilization.percentage !== null);
      assert('Claude: model agreed by API and page, plan from the account API', s.evidence.model.confirmedBy.includes('dom') && s.evidence.plan.source === 'account_api');
      assert('Claude: token counts are ESTIMATED (approximate tokenizer)', s.evidence.tokens.total.evidenceType === 'ESTIMATED' && s.accuracy.total === 'ESTIMATED');
      assert('Claude: never HIGH, with the reason', s.confidence.level !== 'HIGH' && s.confidence.highBlockers.includes('approximate tokenizer') &&
        s.confidence.factors.some(f => f.text.startsWith('Approximate tokenizer')));
      assert('Claude: widget shows the provider name and model', vm.provider === 'Claude' && vm.breakdown[1].label === 'Claude + tools' && vm.model === 'Claude Opus 5.5');

      // Live: user sends a message, reply streams on the page before it is saved
      env.dom = [...env.dom,
        { id: 'claude-dom-4-user', role: 'user', text: 'Please draft the release email.' },
        { id: 'claude-dom-5-assistant', role: 'assistant', text: 'Subject: Adapter release', isStreaming: true }];
      const live = await run();
      assert('Claude live: new turns on the page are added to the saved ones', live.tokens.totalMeasurable === expected + claudeCount('Please draft the release email.') + claudeCount('Subject: Adapter release'));
      env.hidden = ClaudeProvider.hiddenContext({ profile: { conversation_preferences: 'Be brief.' } });
      const withHidden = await run({ forceApi: true });
      assert('Claude pipeline: hidden context (preferences + system prompt estimate) added to Used',
        withHidden.tokens.hidden === 3200 + 850 + claudeCount('Be brief.') && env.vm.hiddenItems.length === 3 && env.vm.breakdown.some(b => b.tag === 'ESTIMATED'));
      env.hidden = undefined;
      await run({ forceApi: true });
      const callsBefore = env.apiCalls;
      env.dom = env.dom.map(m => ({ ...m, isStreaming: false }));
      await run();
      assert('Claude live: a reply finishing re-reads the saved conversation', env.apiCalls === callsBefore + 1);
    }
    {
      const env = { apiError: 'HTTP error 403', domModel: 'Sonnet 5', domPlan: { value: 'max', source: 'dom', evidenceType: 'OBSERVED' },
        dom: [{ id: 'claude-dom-0-user', role: 'user', text: 'Hi' }, { id: 'claude-dom-1-assistant', role: 'assistant', text: 'Hello!' }] };
      const { run } = harness(ClaudeProvider, env);
      const s = await run();
      assert('Claude API failure: page text is used and marked as a lower bound', s.observables.dataSource === 'dom_fallback' && s.completeness.isLowerBound === true && /403/.test(s.observables.apiError));
      assert('Claude API failure: plan from the page, 1M for Sonnet 5 on Max', s.plan.tier === 'max' && s.model.contextWindow === 1000000);
    }

    // ------------------------------------------------------------------ Gemini
    assert('Gemini conversation id from /app/<id> and /gem/<gem>/<id>',
      GeminiProvider.conversationId('https://gemini.google.com/app/8f2c1a9b3d4e') === '8f2c1a9b3d4e' &&
      GeminiProvider.conversationId('https://gemini.google.com/gem/coding-partner/8f2c1a9b3d4e') === '8f2c1a9b3d4e' &&
      GeminiProvider.conversationId('https://gemini.google.com/app') === null);
    assert('Gemini windows by plan (published): free 32K, Plus 128K, Pro/Ultra 1M',
      GeminiProvider.resolveLimit('Fast', 'free').contextWindow === 32000 && GeminiProvider.resolveLimit(null, 'plus').contextWindow === 128000 &&
      GeminiProvider.resolveLimit('Pro', 'pro').contextWindow === 1000000 && GeminiProvider.resolveLimit('Thinking', 'ultra').status === 'VERIFIED');
    assert('Gemini: unknown plan -> window UNKNOWN', GeminiProvider.resolveLimit('Fast', 'unknown').contextWindow === null);
    const pro = GeminiProvider.detectPlan(doc([], { all: () => [{ textContent: 'Gemini  Google AI Pro' }] }));
    const badge = GeminiProvider.detectPlan(doc([], { all: () => [{ textContent: 'Gemini PRO' }] }));
    assert('Gemini plan: explicit "Google AI Pro" is OBSERVED, a bare badge only ESTIMATED',
      pro.value === 'pro' && pro.evidenceType === 'OBSERVED' && badge.source === 'dom_heuristic' && badge.evidenceType === 'ESTIMATED' &&
      GeminiProvider.detectPlan(doc([], { all: () => [] })) === null);
    const gDom = doc([
      Object.assign(el('user-query', 'You said Explain tokens'), { querySelector: () => el('div', 'Explain tokens', { class: 'query-text' }) }),
      Object.assign(el('model-response', 'Gemini said Tokens are pieces of text.'), { querySelector: (s) => (s === 'message-content' ? el('message-content', 'Tokens are pieces of text.') : null) })
    ]);
    const gMsgs = GeminiProvider.extractMessages(gDom);
    assert('Gemini page reading: user-query / model-response turns in order, content only',
      gMsgs.length === 2 && gMsgs[0].role === 'user' && gMsgs[0].text === 'Explain tokens' && gMsgs[1].role === 'assistant' && gMsgs[1].text === 'Tokens are pieces of text.');

    globalThis.location = { href: 'https://gemini.google.com/app/8f2c1a9b3d4e', hostname: 'gemini.google.com', pathname: '/app/8f2c1a9b3d4e' };
    {
      // Saved turns in Gemini's own shape (oldest first after paging): [[c_id, r_id], _, [[user]], [candidates, …, chosen at 3, model at 21]]
      const reply = (rc, text) => [rc, [text]];
      const gTurn = (r, user, cands, chosen, model) => { const m = [cands, null, null, chosen]; m[21] = model; return [['c_8f2c1a9b3d4e', r], null, [[user], 4], m, [1790843112, 0]]; };
      const env = {
        domModel: 'Pro', domPlan: { value: 'pro', source: 'dom', evidenceType: 'OBSERVED' }, dom: gMsgs,
        api: [gTurn('r_1', 'Explain tokens', [reply('rc_a', 'A discarded draft.'), reply('rc_b', 'Tokens are pieces of text.')], 'rc_b', '3.6 Pro')]
      };
      const { run } = harness(GeminiProvider, env);
      const s = await run();
      assert('Gemini: whole chat read from its own saved data, not a lower bound', s.observables.dataSource === 'authoritative' && s.completeness.isLowerBound === false && env.apiCalls === 1);
      assert('Gemini: reply is the chosen candidate; 1M window on Google AI Pro; + system prompt estimate', s.model.contextWindow === 1000000 && s.tokens.totalMeasurable === count('Explain tokens') + count('Tokens are pieces of text.') + GeminiProvider.systemPromptEstimate('3.6 Pro').tokens);
      assert('Gemini: page mode "Pro" and saved model "3.6 Pro" agree (no conflict)', s.conflicts.length === 0 && s.confidence.level !== 'LOW');
      assert('Gemini: widget shows Gemini and the saved model', toWidgetState(s, { provider: 'Gemini' }).model === 'Gemini · 3.6 Pro');

      // Long chat: the page renders only the turns in view (fewer than saved). A message just sent and its
      // reply in progress count at once, without waiting for the next saved-copy read
      {
        const lazy = {
          ...env,
          apiCalls: 0,
          api: [gTurn('r_1', 'First question', [reply('rc_1', 'First answer.')], 'rc_1', '3.6 Pro'),
            gTurn('r_2', 'Second question', [reply('rc_2', 'Second answer.')], 'rc_2', '3.6 Pro'),
            gTurn('r_3', 'Third question', [reply('rc_3', 'Third answer.')], 'rc_3', '3.6 Pro')],
          dom: [
            { id: 'gemini-dom-0-user', role: 'user', text: 'Third  question' }, // Page whitespace differs
            { id: 'gemini-dom-1-assistant', role: 'assistant', text: 'Third answer.' },
            { id: 'gemini-dom-2-user', role: 'user', text: 'A brand new question' },
            { id: 'gemini-dom-3-assistant', role: 'assistant', text: 'A reply still being writ' }
          ]
        };
        const g = harness(GeminiProvider, lazy);
        const sl = await g.run();
        const savedTokens = ['First question', 'First answer.', 'Second question', 'Second answer.', 'Third question', 'Third answer.'].reduce((n, t) => n + count(t), 0);
        assert('Gemini lazy page: new turns count at once (no wait for the next saved read)',
          sl.tokens.totalMeasurable === savedTokens + count('A brand new question') + count('A reply still being writ') + GeminiProvider.systemPromptEstimate('3.6 Pro').tokens &&
          sl.observables.messagesCount === 8 && lazy.apiCalls === 1);
        lazy.dom = lazy.dom.slice(0, 2); // Nothing new on the page: the saved copy alone, nothing doubled
        assert('Gemini lazy page: turns already saved are not counted twice', (await g.run()).observables.messagesCount === 6);
      }

      // Gemini's own tokenizer (Gemma 4) loaded: counts switch to it, exact, no approximate-tokenizer penalty
      {
        const g = harness(GeminiProvider, { ...env });
        const bin = fs.readFileSync(path.join(root, GeminiProvider.tokenizer.file));
        const gemma = GeminiProvider.tokenizer.create(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.length));
        g.c.tokenizer.useCounter('gemma4', gemma);
        const se = await g.run();
        assert('Gemini + Gemma 4 loaded: text counted with Gemini\'s tokenizer, marked exact',
          se.tokens.totalMeasurable === gemma.count('Explain tokens') + gemma.count('Tokens are pieces of text.') + GeminiProvider.systemPromptEstimate('3.6 Pro').tokens &&
          se.confidence.factors.some(f => f.text === 'Exact tokenizer') && !(se.confidence.highBlockers || []).includes('approximate tokenizer'));
        assert('Gemini + Gemma 4: confidence above the approximate cap', se.confidence.percentage > s.confidence.percentage);
      }

      // System prompt: sized from the closest public leak of the same family, at or below the model's version
      const est = (m) => GeminiProvider.systemPromptEstimate(m);
      assert('Gemini system prompt: 3.6 Pro -> 3.1 Pro leak, 3.6 Flash -> 3.5 Flash, 3.8 Flash -> 3.8, Flash-Lite counts as Flash, 2.5 -> oldest',
        est('3.6 Pro').basis === '3.1 Pro' && est('3.6 Flash').tokens === 3900 && est('3.8 Flash').tokens === 13800 &&
        est('3.5 Flash-Lite').basis === '3.5 Flash' && est('2.5 Flash').basis === '3 Flash');
      assert("Gemini system prompt: no version shown -> the family's latest leak", est('Flash').basis === '3.8 Flash' && est(null).basis === '3.8 Flash');
      const sp = s.tokens.hiddenItems?.find(i => i.kind === 'system_prompt') || s.tokens.hidden;
      assert('Gemini hidden context names the leak it is sized from', JSON.stringify(sp).includes('3.1 Pro'));

      const failing = { ...env, api: null, apiError: 'HTTP error 500' };
      const hf = harness(GeminiProvider, failing);
      let retryMs = null;
      hf.c._retryLater = (id, ms) => { retryMs = ms; };
      const sf = await hf.run();
      assert('Gemini: a failed read schedules its own retry (a quiet page no longer keeps the failure)', retryMs === 15000);
      await hf.run({ forceApi: true });
      assert('Gemini: repeated failures back off (15 s -> 30 s)', retryMs === 30000);
      assert('Gemini: read failure falls back to the page, flagged as a lower bound', sf.observables.dataSource === 'dom_fallback' && sf.completeness.isLowerBound === true);
      const contractFailing = GeminiProvider.toContractData(sf);
      assert('Gemini RPC failure gracefully falls back to DOM with source: "dom" and limit 200000 without throwing',
        contractFailing.provider === 'gemini' &&
        contractFailing.context.source === 'dom' &&
        contractFailing.context.limit === 200000 &&
        contractFailing.context.used > 0 &&
        contractFailing.context.confidence === 'estimate' &&
        contractFailing.context.segments.length === 3 &&
        contractFailing.context.segments[0].label === 'You' &&
        contractFailing.context.segments[1].label === 'Gemini & tools' &&
        contractFailing.context.segments[2].label === 'System & memory'
      );

      env.domPlan = null;
      const s2 = await run();
      assert('Gemini: plan not detected -> window UNKNOWN, no percentage', s2.model.contextWindow === null && s2.utilization.percentage === null);

      // Long chat: at/over half the window, a note (no invented number); below it, none
      env.domPlan = { value: 'free', source: 'dom_heuristic', evidenceType: 'ESTIMATED' };
      const long = 'word '.repeat(20000);
      const shortChat = env.api;
      env.api = [gTurn('r_2', long, [reply('rc_c', 'ok')], 'rc_c', '3.6 Flash')];
      const s3 = await run({ forceApi: true });
      env.api = shortChat;
      await run({ forceApi: true });
      assert('Gemini: long chat (>=50% of the window) gets the note', s3.limits.some(l => l.key === 'long_chat' && /new chat is lighter/.test(l.note)));
      env.dom = gMsgs;
      assert('Gemini: short chat, no note', !(await run()).limits.some(l => l.key === 'long_chat'));
    }

    // ------------------------------------------------------------------ Gemini: saved-data parsing, plan, page attachments
    {
      const live = ")]}'\n\n711\n" + JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([[['x']], null]), null, null, null, 'generic'], ['di', 642]]) + '\n25\n[["e",4,null,null,747]]';
      assert('batchexecute: payload of the rpc decoded from the length-prefixed response', JSON.stringify(parseBatchexecute(live, 'hNvQHb')) === '[[["x"]],null]');
      const errRow = ")]}'\n" + JSON.stringify([['wrb.fr', 'hNvQHb', null, null, null, [3, null, []], 'generic']]);
      let threw = '';
      try { parseBatchexecute(errRow, 'hNvQHb'); } catch (e) { threw = e.message; }
      assert('batchexecute: an error row throws (page fallback), never an empty chat', /Gemini error 3/.test(threw));
      assert('Gemini model family: "Flash" (page) = "3.6 Flash" (saved), Fast -> flash',
        GeminiProvider.modelKey('Flash') === GeminiProvider.modelKey('3.6 Flash') && GeminiProvider.modelKey('Fast') === 'flash' && GeminiProvider.modelKey('3.5 Flash-Lite') === 'flash-lite');
      const work = GeminiProvider.detectPlan({ querySelector: (sel) => (sel.includes('tier-enterprise') ? {} : null), querySelectorAll: () => [] });
      assert('Gemini: "Work" account label -> workspace plan (OBSERVED), 1M per the Business / Enterprise page',
        work.value === 'workspace' && work.evidenceType === 'OBSERVED' && GeminiProvider.resolveLimit('3.6 Flash', 'workspace').contextWindow === 1000000);

      // Usage RPC as returned live (2026-10-01): tier 1, 5h and weekly windows unused
      const usage = GeminiProvider.parseUsage(parseBatchexecute(")]}'\n\n189\n" + JSON.stringify([['wrb.fr', 'jSf9Qc', '[1,[[600,0,1,[[1790880148,801040000]]],[12096,0,2,[[1791466948,801043000]]]],false]', null, null, null, 'generic']]), 'jSf9Qc'));
      assert('Gemini usage: tier 1 -> free (reported, OBSERVED); 5h + weekly limits with reset times',
        usage.plan.value === 'free' && usage.plan.evidenceType === 'OBSERVED' && usage.limits.length === 2 &&
        usage.limits[0].id === '5h' && usage.limits[0].key === '5h' && usage.limits[0].label === '5h' && usage.limits[0].percent === 0 && usage.limits[0].resetsAt === 1790880148000 &&
        usage.limits[1].id === 'weekly' && usage.limits[1].key === 'weekly' && usage.limits[1].label === 'Weekly');
      const tiers = [2, 3, 4, 6].map(t => GeminiProvider.parseUsage([t, [[10, 0.42, 1, [[1, 0]]], [5, 0.9, 3, []]]]));
      assert('Gemini usage: tiers 2 Pro, 3/6 Ultra, 4 Plus; used fraction -> percent; AI-credit window skipped',
        tiers.map(u => u.plan.value).join() === 'pro,ultra,plus,ultra' && tiers[0].limits.length === 1 && tiers[0].limits[0].percent === 42);
      // The reported tier is applied on each page pass, so a "Work" label that renders later still wins
      const noLabel = { querySelector: () => null, querySelectorAll: () => [] };
      const label = { querySelector: (sel) => (sel.includes('tier-enterprise') ? {} : null), querySelectorAll: () => [] };
      let tierReply = '[1,[]]';
      const fetchWith = async (doc) => {
        const saved = globalThis.document;
        globalThis.document = doc;
        const realFetch = globalThis.fetch;
        globalThis.fetch = async (url) => ({ ok: true, text: async () => ")]}'\n" + JSON.stringify([['wrb.fr', String(url).includes('jSf9Qc') ? 'jSf9Qc' : 'hNvQHb',
          String(url).includes('jSf9Qc') ? tierReply : '[[],null]', null, null, null, 'generic']]) });
        try { return await GeminiProvider.fetchConversation('abc'); } finally { globalThis.fetch = realFetch; globalThis.document = saved; }
      };
      const sessionDoc = (extra) => ({ ...extra, querySelectorAll: (sel) => (sel === 'script' ? [{ textContent: '{"SNlM0e":"tok","FdrFJe":"1","cfb2h":"bl"}' }] : []) });
      const read = await fetchWith(sessionDoc(noLabel));
      assert('Gemini: reported tier kept for the page passes, not baked into the saved copy', read.plan === null && GeminiProvider.detectPlan(noLabel).value === 'free' && GeminiProvider.detectPlan(noLabel).source === 'account_api');
      assert('Gemini: "Work" label rendering after the read still makes it workspace (1M), not Free 32K', GeminiProvider.detectPlan(label).value === 'workspace');
      tierReply = '[99,[]]';
      await fetchWith(sessionDoc(noLabel)); // Unknown tier clears it: later tests see no reported plan

      assert('Gemini usage: unknown tier or bad shape -> no plan, no limits',
        GeminiProvider.parseUsage([99, []]).plan === null && GeminiProvider.parseUsage(null).limits.length === 0);

      const preview = (isImage) => ({ querySelector: () => (isImage ? {} : null) });
      const q = { querySelectorAll: () => [preview(true), preview(true), preview(false)] };
      const a = GeminiProvider.pageAttachments({ querySelectorAll: () => [q] }, '3.6 Flash');
      assert('Gemini attachments: images 1,120 tokens each on Gemini 3+ (default resolution), other files counted with unknown size',
        a.count === 3 && a.estimatedTokens === 2240 && a.hasUnknown === true);
      assert('Gemini attachments: 258 per image on 2.x; current model when no version is shown',
        GeminiProvider.pageAttachments({ querySelectorAll: () => [q] }, '2.5 Flash').estimatedTokens === 516 &&
        GeminiProvider.pageAttachments({ querySelectorAll: () => [q] }, 'Flash').estimatedTokens === 2240);

      // Gemini shared contract verification
      const gContract = GeminiProvider.toContractData({
        tokens: { totalMeasurable: 80000, user: 10000, assistant: 50000, hidden: 20000 },
        model: { contextWindow: 200000 },
        limits: [
          { id: '5h', label: '5h', used: 45, total: 100, resetsAt: 1790880148000, source: 'api' },
          { id: 'weekly', label: 'Weekly', used: 12, total: 100, resetsAt: 1791466948000, source: 'api' }
        ]
      });
      assert('Gemini toContractData adheres to shared contract',
        gContract.provider === 'gemini' &&
        gContract.context.used === 80000 &&
        gContract.context.limit === 200000 &&
        gContract.context.confidence === 'estimate' &&
        gContract.context.segments.length === 3 &&
        gContract.context.segments[0].id === 'user' && gContract.context.segments[0].label === 'You' && gContract.context.segments[0].tokens === 10000 &&
        gContract.context.segments[1].id === 'assistant' && gContract.context.segments[1].label === 'Gemini & tools' && gContract.context.segments[1].tokens === 50000 &&
        gContract.context.segments[2].id === 'system' && gContract.context.segments[2].label === 'System & memory' && gContract.context.segments[2].tokens === 20000 &&
        gContract.limits.length === 2 &&
        gContract.limits[0].id === '5h' && gContract.limits[0].label === '5h' && gContract.limits[0].used === 45 &&
        gContract.limits[1].id === 'weekly' && gContract.limits[1].label === 'Weekly' && gContract.limits[1].used === 12
      );

      // Gemini 0 context usage (Fix B1, Fix B2)
      const gZeroContract = GeminiProvider.toContractData({
        tokens: { totalMeasurable: 0, user: 0, assistant: 0, hidden: 0 }
      });
      assert('Gemini toContractData at 0 usage: used = 0, limit = 200000, all segments 0',
        gZeroContract.context.used === 0 &&
        gZeroContract.context.limit === 200000 &&
        gZeroContract.context.segments.every(s => s.tokens === 0)
      );

      // Limit labels: zero "Session" occurrences in Gemini limits (Fix B3)
      const gSessionWindow = GeminiProvider.resolveSessionWindow([{ role: 'user', text: 'hello', createdAt: Date.now() - 1000 }]);
      const gParsedUsage = GeminiProvider.parseUsage([1, [[600, 0.35, 1, [[1790880148, 0]]], [12096, 0.12, 2, [[1791466948, 0]]]]]);
      const gSerialized = JSON.stringify({ gSessionWindow, gParsedUsage, gContract });
      assert('Gemini limit labels are "5h" and "Weekly" with zero "Session" occurrences',
        !gSerialized.toLowerCase().includes('session (5h)') &&
        !gSerialized.includes('"label":"Session"') &&
        !gSerialized.includes('"id":"session"') &&
        gParsedUsage.limits[0].id === '5h' && gParsedUsage.limits[0].label === '5h' &&
        gParsedUsage.limits[1].id === 'weekly' && gParsedUsage.limits[1].label === 'Weekly' &&
        gSessionWindow.limit.id === '5h' && gSessionWindow.limit.label === '5h'
      );

      assert('buildGeminiContractData exports pure function returning compliant object',
        buildGeminiContractData().provider === 'gemini' &&
        buildGeminiContractData().context.limit === 200000 &&
        buildGeminiContractData().context.used === 0
      );
    }

    // ------------------------------------------------------------------ Gemini: layout, free plan, limit notice
    {
      const picker = { getAttribute: (a) => (a === 'aria-label' ? 'Open mode picker, currently 3.5 Flash-Lite' : null), textContent: 'Gemini 3.5 Flash-Lite' };
      assert('Gemini model from the current mode picker (aria-label "currently …")',
        GeminiProvider.detectModel({ querySelector: (s) => (s.includes('mode picker') ? picker : null) }) === '3.5 Flash-Lite');
      const free = GeminiProvider.detectPlan(doc([], { all: () => [{ textContent: 'Gemini  Sign in' }] }));
      assert('Gemini plan: top bar without a paid badge -> free (ESTIMATED)', free.value === 'free' && free.evidenceType === 'ESTIMATED');

      const now = new Date(2026, 8, 29, 14, 0).getTime();
      const alertDoc = (text, reply = null) => ({ querySelectorAll: (s) => (s === 'model-response' ? (reply ? [{ textContent: reply }] : []) : [{ textContent: text }]) });
      const at = GeminiProvider.detectLimitReached(alertDoc("You've reached your limit. Try again at 5:30 PM."), now);
      assert('Gemini limit notice: used up, reset "at 5:30 PM" -> today 17:30', at.blocked && at.resetsAt === new Date(2026, 8, 29, 17, 30).getTime());
      const rel = GeminiProvider.detectLimitReached(alertDoc('You hit the usage limit. It resets in 3 hours.'), now);
      assert('Gemini limit notice: "in 3 hours" -> now + 3h', rel.resetsAt === now + 3 * 3600000);
      assert('Gemini limit notice: past time rolls to tomorrow', GeminiProvider.parseResetTime('try again at 9:00 AM', now) === new Date(2026, 8, 30, 9, 0).getTime());
      assert('Gemini: a long reply that discusses limits is not a notice',
        GeminiProvider.detectLimitReached(alertDoc('', 'Gemini has a usage limit that resets. '.repeat(20)), now) === null);
      assert('Gemini: no notice -> nothing', GeminiProvider.detectLimitReached(alertDoc('All good'), now) === null);
    }

    // ------------------------------------------------------------------ Claude page reading
    {
      const turn = el('div', '', { 'data-is-streaming': 'true' });
      const user = el('div', 'What is BPE?', { 'data-testid': 'user-message' });
      const reply = el('div', 'Byte pair encoding merges', { class: 'font-claude-response' }, turn);
      const msgs = ClaudeProvider.extractMessages(doc([user, reply]));
      assert('Claude page reading: roles, text and streaming flag', msgs.length === 2 && msgs[0].role === 'user' && msgs[1].role === 'assistant' && msgs[1].isStreaming === true && msgs[0].isStreaming === false);
    }

    // ------------------------------------------------------------------ ChatGPT unchanged
    const chatgptConf = ConfidenceEngine.evaluate({ isModelKnown: true, messageCount: 4, completenessSource: 'authoritative_api', isNetworkActive: true });
    assert('ChatGPT keeps the exact tokenizer factor (default unchanged)', chatgptConf.factors.some(f => f.text === 'Exact tokenizer') && !chatgptConf.highBlockers.includes('approximate tokenizer'));
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    const main = manifest.content_scripts.find(s => s.js.includes('content/content-script.js'));
    const interceptor = manifest.content_scripts.find(s => s.js.includes('content/network-interceptor.js'));
    assert('Manifest: widget runs on ChatGPT, Claude and Gemini', ['https://claude.ai/*', 'https://gemini.google.com/*', 'https://chatgpt.com/*'].every(h => main.matches.includes(h)));
    assert('Manifest: ChatGPT network interceptor stays ChatGPT-only', interceptor.matches.every(h => /chatgpt\.com|chat\.openai\.com/.test(h)));
    assert('Bundle selects the adapter by hostname and keeps ChatGPT prefetch',
      /providerForHost\(location\.hostname\)[\s\S]*if \(!provider\) coordinator\.prefetch\(\)/.test(fs.readFileSync(path.join(root, 'content/content-script.js'), 'utf8')));
  } finally {
    Object.assign(globalThis, saved);
  }

  console.log(`\n  Provider Adapter Results: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
