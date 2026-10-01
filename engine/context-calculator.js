/**
 * ChatGPT Context Monitor - Context Calculator
 *
 * Aggregates token measurements across conversation messages, attachments,
 * tools, and model limits to calculate context utilization and breakdown statistics.
 */

import { ContextClassifier, EvidenceType } from './context-classifier.js';
import { ConfidenceEngine } from './confidence-engine.js';

export class ContextCalculator {
  /**
   * Calculates comprehensive context usage state.
   *
   * @param {Object} input
   * @param {Array<{ id: string, role: string, tokens: number }>} input.messages Tokenized turns, in order
   * @param {Object} input.model Resolved model: { id, displayName, contextWindow, limitStatus, recognized, encoding }
   * @param {Object|string} [input.plan] Plan evidence ({ value | tier, source }) or a tier name
   * @param {Object} [input.attachments] { count, estimatedTokens, hasUnknown, files }
   * @param {Array<Object>} [input.hidden] Hidden context items: { kind, label, text, tokens, included? }
   * @param {Object} [input.tools] { observed, list }
   * @param {Object} [input.completeness] Completeness record from the coordinator
   * @param {boolean} [input.isPartial] Turns may be missing (count is a lower bound)
   * @param {boolean} [input.dropStaleTools] / [input.fitToWindow] ChatGPT context rules (see below)
   * @param {Object} [input.evidence] Reconciled evidence (EvidenceMerger), with conflicts / agreements
   * @param {boolean} [input.tokenizerExact] false when the provider's own tokenizer is not the one counting
   * @returns {Object} Context state object
   */
  static calculate(input = {}) {
    const history = input.messages || [];
    const model = input.model || { displayName: 'Unknown', contextWindow: null, id: 'unknown' };
    const attachments = input.attachments || { count: 0, estimatedTokens: 0, hasUnknown: false };
    const tools = input.tools || { observed: false, list: [] };
    const isPartial = Boolean(input.isPartial);
    // Hidden context read from the API (custom instructions, memory, system/hidden messages): [{ kind, label, text, tokens }]
    const hidden = Array.isArray(input.hidden) ? input.hidden : [];
    // included: false = shown for reference only (not known to be in this chat), never counted
    const hiddenTokens = hidden.reduce((sum, h) => sum + (h.included === false ? 0 : (h.tokens || 0)), 0);

    // Resolve plan tier and source (Group F)
    const planInput = input.plan;
    let planTier = 'unknown';
    let planSource = 'unknown';
    if (typeof planInput === 'string') {
      planTier = planInput;
    } else if (planInput && typeof planInput === 'object') {
      planTier = planInput.value || planInput.tier || 'unknown';
      planSource = planInput.source || 'unknown';
    } else if (model.planTier) {
      planTier = model.planTier;
    }

    // Context window & utilization (Group F)
    // Rule: Never invent a limit. If model is unknown or plan is unknown, contextWindow = null
    let contextWindow = null;
    if (model.id !== 'unknown') {
      if (planTier !== 'unknown' && model.contextWindow) {
        contextWindow = model.contextWindow;
      } else if (input.plan === undefined && model.contextWindow) {
        // Standalone callers (tests) without plan context
        contextWindow = model.contextWindow;
      }
    }

    // Which turns are actually in the model's context (ChatGPT only: opt-in flags).
    // 1. dropStaleTools: tool output (search results, pages, code runs) from before the latest user
    //    message is treated as not resent; only the current turn's tool output is in context.
    //    ponytail: heuristic from ChatGPT's observed behavior, not a documented rule.
    // 2. fitToWindow: a chat longer than the window keeps only its newest turns that fit next to the
    //    fixed context (hidden + attachments); the newest turn is always kept.
    let lastUser = -1;
    for (let i = history.length - 1; i >= 0; i--) if (history[i].role === 'user') { lastUser = i; break; }
    const staleTools = input.dropStaleTools ? history.filter((m, i) => m.role === 'tool' && i < lastUser) : [];
    const live = staleTools.length ? history.filter(m => !staleTools.includes(m)) : history;
    let messages = live;
    let outOfWindow = [];
    if (input.fitToWindow && contextWindow) {
      let budget = contextWindow - (attachments.estimatedTokens || 0) - hiddenTokens;
      let cut = live.length - 1; // index of the oldest kept turn
      budget -= live.length ? (live[cut].tokens || 0) : 0;
      while (cut > 0 && (live[cut - 1].tokens || 0) <= budget) {
        cut--;
        budget -= live[cut].tokens || 0;
      }
      if (cut > 0) {
        outOfWindow = live.slice(0, cut);
        messages = live.slice(cut);
      }
    }
    const sumTokens = (list) => list.reduce((n, m) => n + (m.tokens || 0), 0);

    // Sum message tokens by author role and track non-text parts
    let userTokens = 0;
    let assistantTokens = 0;
    const nonTextPartsList = [];
    for (const msg of messages) {
      if (Array.isArray(msg.nonTextParts) && msg.nonTextParts.length > 0) {
        nonTextPartsList.push(...msg.nonTextParts);
      } else if (Array.isArray(msg.parts)) {
        for (const p of msg.parts) {
          if (p && typeof p === 'object' && p.type && p.type !== 'text') {
            nonTextPartsList.push({ type: p.type, classification: p.classification || 'UNKNOWN' });
          }
        }
      }
      if (msg.role === 'user') userTokens += msg.tokens || 0;
      else assistantTokens += msg.tokens || 0;
    }
    const conversationTokens = userTokens + assistantTokens;
    const attachmentTokens = attachments.estimatedTokens || 0;
    const totalMeasurableTokens = conversationTokens + attachmentTokens + hiddenTokens;
    const utilizationPercent = contextWindow > 0
      ? Math.min(100, Number(((totalMeasurableTokens / contextWindow) * 100).toFixed(1)))
      : null;

    // Epistemic classification for each dimension. Token counts are always made locally (no site
    // reports its own usage), so the conversation and the total are ESTIMATED.
    const accuracy = {
      conversation: ContextClassifier.classifyConversation(false),
      model: ContextClassifier.classifyModel(model.id),
      plan: ContextClassifier.classifyPlan(planTier),
      contextWindow: ContextClassifier.classifyLimit(contextWindow, model.limitStatus === 'VERIFIED'),
      attachments: ContextClassifier.classifyAttachment(attachments.count, !attachments.hasUnknown),
      memory: ContextClassifier.classifyMemory(),
      tools: ContextClassifier.classifyTools(tools.observed),
      hiddenContext: ContextClassifier.classifyHiddenContext(),
      total: ContextClassifier.classifyTotal(false)
    };

    const completeness = input.completeness || {
      conversationComplete: !isPartial,
      domIsPartial: isPartial,
      renderedTurnCount: messages.length,
      authoritativeTurnCount: null,
      virtualizationGap: 0,
      completenessSource: isPartial ? 'dom_partial' : 'dom_complete'
    };

    // Confidence evaluation with evidence-based factors (Group E + F)
    const confidence = ConfidenceEngine.evaluate({
      // An unrecognized slug is displayed by name but is not "known": it has no limit
      isModelKnown: model.id !== 'unknown' && model.recognized !== false,
      isLimitVerified: Boolean(contextWindow) && model.limitStatus !== 'UNVERIFIED',
      contextLimit: contextWindow,
      planTier,
      isPlanKnown: planTier !== 'unknown' && Boolean(planTier),
      messageCount: messages.length,
      attachmentCount: attachments.count,
      hasUnknownAttachments: attachments.hasUnknown,
      hasObservedTools: tools.observed,
      isPartialConversation: isPartial,
      completenessSource: completeness.completenessSource,
      isNetworkActive: Boolean(input.networkHealth?.networkAvailable),
      conflicts: input.conflicts || [],
      agreements: input.agreements,
      evidence: input.evidence,
      tokenizerExact: input.tokenizerExact !== false
    });

    // Counted locally from visible text: an estimate of what the model receives, not reported usage
    const estimated = (value) => ({ value, source: 'tokenizer', evidenceType: EvidenceType.ESTIMATED });

    return {
      timestamp: Date.now(),
      model: {
        id: model.id || 'unknown',
        displayName: model.displayName || 'Unknown Model',
        encoding: model.encoding || 'o200k_base',
        contextWindow,
        limitStatus: model.limitStatus || (contextWindow ? 'VERIFIED' : 'UNKNOWN'),
        recognized: model.recognized !== false && model.id !== 'unknown'
      },
      plan: { tier: planTier, source: planSource },
      tokens: {
        user: userTokens,
        assistant: assistantTokens,
        conversation: conversationTokens,
        attachments: attachmentTokens,
        hidden: hiddenTokens,
        hiddenItems: hidden,
        contextMessages: messages, // The turns counted as in context (for the advisor; not synced)
        // Whole chat as saved, and what was left out of the current context (see fitToWindow/dropStaleTools)
        history: sumTokens(history) + attachmentTokens + hiddenTokens,
        excluded: {
          staleTools: { count: staleTools.length, tokens: sumTokens(staleTools) },
          outOfWindow: { count: outOfWindow.length, tokens: sumTokens(outOfWindow) }
        },
        totalMeasurable: totalMeasurableTokens,
        // Window minus measured tokens; hidden context is not measurable, so the true remainder is lower
        remaining: contextWindow ? Math.max(0, contextWindow - totalMeasurableTokens) : null
      },
      utilization: { percentage: utilizationPercent },
      completeness: {
        conversationComplete: completeness.conversationComplete,
        domIsPartial: completeness.domIsPartial,
        renderedTurnCount: completeness.renderedTurnCount,
        authoritativeTurnCount: completeness.authoritativeTurnCount,
        virtualizationGap: completeness.virtualizationGap,
        completenessSource: completeness.completenessSource
      },
      observables: {
        messagesCount: messages.length,
        attachmentsCount: attachments.count,
        attachmentFiles: attachments.files || [],
        isPartialConversation: isPartial,
        nonTextPartsCount: nonTextPartsList.length,
        nonTextPartsList
      },
      accuracy,
      tokenizerExact: input.tokenizerExact !== false,
      confidence,
      // Coordinators pass reconciled evidence; standalone callers get the token and completeness provenance
      evidence: input.evidence || {
        tokens: {
          user: estimated(userTokens),
          assistant: estimated(assistantTokens),
          total: estimated(totalMeasurableTokens),
          contextWindow: { value: contextWindow, source: 'model_db', evidenceType: contextWindow ? EvidenceType.OBSERVED : EvidenceType.UNKNOWN }
        },
        completeness: {
          value: completeness.conversationComplete ? 'COMPLETE' : 'PARTIAL',
          source: completeness.completenessSource,
          evidenceType: completeness.completenessSource === 'authoritative_api' ? EvidenceType.EXACT : EvidenceType.OBSERVED
        }
      },
      conflicts: input.conflicts || []
    };
  }
}
