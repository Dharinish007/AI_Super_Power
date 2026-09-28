/**
 * ChatGPT Context Monitor - Context Calculator
 * 
 * Aggregates token measurements across conversation messages, attachments,
 * tools, and model limits to calculate context utilization and breakdown statistics.
 */

import { ContextClassifier, AccuracyClass, EvidenceType } from './context-classifier.js';
import { ConfidenceEngine } from './confidence-engine.js';

export class ContextCalculator {
  /**
   * Formats a raw token number into a human-friendly string (e.g. 1,250 -> 1.3K, 128000 -> 128K)
   * @param {number|null} count 
   * @returns {string}
   */
  static formatTokenCount(count) {
    if (count === null || count === undefined || isNaN(count)) {
      return 'Unknown';
    }
    if (count < 1000) {
      return count.toLocaleString();
    }
    if (count < 1000000) {
      const rounded = (Math.round(count / 100) / 10).toFixed(1).replace(/\.0$/, '');
      return `${rounded}K`;
    }
    const m = (Math.round(count / 10000) / 100).toFixed(2).replace(/\.00$/, '');
    return `${m}M`;
  }

  /**
   * Calculates comprehensive context usage state.
   * 
   * @param {Object} input
   * @param {Array<{ id: string, role: string, tokens: number }>} input.messages
   * @param {Object} input.model
   * @param {Object} input.attachments
   * @param {Object} input.tools
   * @param {Object} input.memory
   * @param {Object} input.authoritative
   * @param {boolean} input.isPartial
   * @returns {Object} Context state object
   */
  static calculate(input = {}) {
    const history = input.messages || [];
    const model = input.model || { displayName: 'Unknown', contextWindow: null, id: 'unknown' };
    const attachments = input.attachments || { count: 0, estimatedTokens: 0, hasUnknown: false };
    const tools = input.tools || { observed: false, list: [] };
    const memory = input.memory || { enabled: false, observed: false };
    const authoritative = input.authoritative || null;
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
        // Backward compatibility for standalone callers without plan context
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
      let budget = contextWindow -(attachments.estimatedTokens || 0) - hiddenTokens;
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
    let nonTextPartsCount = 0;
    const nonTextPartsList = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const msgTokens = msg.tokens || 0;

      // Track non-text parts when provided
      if (Array.isArray(msg.nonTextParts) && msg.nonTextParts.length > 0) {
        nonTextPartsCount += msg.nonTextParts.length;
        nonTextPartsList.push(...msg.nonTextParts);
      } else if (Array.isArray(msg.parts)) {
        for (const p of msg.parts) {
          if (p && typeof p === 'object' && p.type && p.type !== 'text') {
            nonTextPartsCount++;
            nonTextPartsList.push({
              type: p.type,
              classification: p.classification || 'UNKNOWN'
            });
          }
        }
      }

      if (msg.role === 'user') {
        userTokens += msgTokens;
      } else {
        assistantTokens += msgTokens;
      }
    }
    const conversationTokens = userTokens + assistantTokens;

    // Attachment tokens
    const attachmentTokens = attachments.estimatedTokens || 0;

    // Total measurable context
    const totalMeasurableTokens = conversationTokens + attachmentTokens + hiddenTokens;

    let utilizationPercent = null;
    if (contextWindow && contextWindow > 0) {
      utilizationPercent = Math.min(100, Number(((totalMeasurableTokens / contextWindow) * 100).toFixed(1)));
    }

    // Epistemic classification for each dimension
    const accuracy = {
      conversation: ContextClassifier.classifyConversation(Boolean(authoritative?.tokens)),
      model: ContextClassifier.classifyModel(model.id),
      plan: ContextClassifier.classifyPlan(planTier),
      contextWindow: ContextClassifier.classifyLimit(contextWindow, model.limitStatus === 'VERIFIED'),
      attachments: ContextClassifier.classifyAttachment(attachments.count, !attachments.hasUnknown),
      memory: ContextClassifier.classifyMemory(),
      tools: ContextClassifier.classifyTools(tools.observed),
      hiddenContext: ContextClassifier.classifyHiddenContext(),
      total: ContextClassifier.classifyTotal(Boolean(authoritative?.tokens))
    };

    const completenessInput = input.completeness || null;
    const completeness = completenessInput || {
      conversationComplete: !isPartial,
      domIsPartial: isPartial,
      renderedTurnCount: messages.length,
      authoritativeTurnCount: Boolean(authoritative?.tokens) ? messages.length : null,
      virtualizationGap: 0,
      completenessSource: Boolean(authoritative?.tokens) ? 'authoritative_api' : (isPartial ? 'dom_partial' : 'dom_complete')
    };

    // Confidence evaluation with evidence-based factors (Group E + F)
    const confidence = ConfidenceEngine.evaluate({
      isAuthoritative: Boolean(authoritative?.tokens),
      // An unrecognized slug is displayed by name but is not "known": it has no limit
      isModelKnown: model.id !== 'unknown' && model.recognized !== false,
      isLimitVerified: Boolean(contextWindow) && model.limitStatus !== 'UNVERIFIED',
      contextLimit: contextWindow,
      planTier,
      isPlanKnown: planTier !== 'unknown' && Boolean(planTier),
      modelDisplayName: model.displayName,
      messageCount: messages.length,
      attachmentCount: attachments.count,
      hasUnknownAttachments: attachments.hasUnknown,
      hasObservedTools: tools.observed,
      isPartialConversation: isPartial,
      completenessSource: completeness.completenessSource,
      isNetworkActive: Boolean(input.networkHealth?.networkAvailable),
      encoding: model.encoding || 'o200k_base',
      conflicts: input.conflicts || [],
      agreements: input.agreements,
      evidence: input.evidence,
      tokenizerExact: input.tokenizerExact !== false
    });

    const apiContextLimit = model.apiContextLimit ?? (model.id !== 'unknown' ? (model.contextWindow || contextWindow) : null);

    return {
      timestamp: Date.now(),
      model: {
        id: model.id || 'unknown',
        displayName: model.displayName || 'Unknown Model',
        encoding: model.encoding || 'o200k_base',
        apiContextLimit,
        contextWindow: contextWindow,
        maxOutput: model.maxOutput || null,
        planTier,
        limitStatus: model.limitStatus || (contextWindow ? 'VERIFIED' : 'UNKNOWN'),
        recognized: model.recognized !== false && model.id !== 'unknown',
        source: model.source || 'unverified',
        accuracy: accuracy.model
      },
      plan: {
        tier: planTier,
        displayName: planTier.charAt(0).toUpperCase() + planTier.slice(1),
        source: planSource,
        accuracy: accuracy.plan
      },
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
        remaining: contextWindow ? Math.max(0, contextWindow - totalMeasurableTokens) : null,
        formatted: {
          user: this.formatTokenCount(userTokens),
          assistant: this.formatTokenCount(assistantTokens),
          conversation: this.formatTokenCount(conversationTokens),
          attachments: this.formatTokenCount(attachmentTokens),
          total: this.formatTokenCount(totalMeasurableTokens),
          contextWindow: contextWindow ? this.formatTokenCount(contextWindow) : 'Unknown'
        }
      },
      utilization: {
        percentage: utilizationPercent,
        formatted: utilizationPercent !== null ? `${utilizationPercent}%` : 'Unknown'
      },
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
        toolsObserved: tools.observed,
        toolsList: tools.list || [],
        memoryObserved: memory.observed,
        isPartialConversation: isPartial,
        conversationComplete: completeness.conversationComplete,
        domIsPartial: completeness.domIsPartial,
        renderedTurnCount: completeness.renderedTurnCount,
        authoritativeTurnCount: completeness.authoritativeTurnCount,
        virtualizationGap: completeness.virtualizationGap,
        completenessSource: completeness.completenessSource,
        nonTextPartsCount,
        nonTextPartsList
      },
      accuracy,
      confidence,
      evidence: input.evidence || {
        model: {
          value: model.id,
          source: model.source || 'model_db',
          evidenceType: model.id !== 'unknown' ? EvidenceType.OBSERVED : EvidenceType.UNKNOWN
        },
        plan: {
          value: planTier,
          source: planSource,
          evidenceType: planTier !== 'unknown' ? EvidenceType.OBSERVED : EvidenceType.UNKNOWN
        },
        limit: {
          value: contextWindow,
          apiLimit: apiContextLimit,
          status: model.limitStatus || (contextWindow ? 'VERIFIED' : 'UNKNOWN'),
          source: model.limitSource || 'model_db',
          evidenceType: contextWindow ? EvidenceType.OBSERVED : EvidenceType.UNKNOWN
        },
        turns: {
          value: messages.length,
          source: Boolean(authoritative?.tokens) ? 'conversation_api' : 'dom',
          evidenceType: Boolean(authoritative?.tokens) ? EvidenceType.EXACT : EvidenceType.OBSERVED
        },
        attachments: {
          value: attachments.count,
          source: attachments.source || 'dom',
          evidenceType: attachments.count > 0 ? (attachments.hasUnknown ? EvidenceType.ESTIMATED : EvidenceType.OBSERVED) : EvidenceType.OBSERVED
        },
        tools: {
          value: tools.list.map(t => t.type || t.label).join(','),
          source: tools.source || 'dom',
          evidenceType: tools.observed ? EvidenceType.OBSERVED : EvidenceType.OBSERVED
        },
        tokens: {
          user: {
            value: userTokens,
            source: Boolean(authoritative?.tokens) ? 'conversation_api' : 'tokenizer',
            evidenceType: Boolean(authoritative?.tokens) ? EvidenceType.EXACT : EvidenceType.ESTIMATED
          },
          assistant: {
            value: assistantTokens,
            source: Boolean(authoritative?.tokens) ? 'conversation_api' : 'tokenizer',
            evidenceType: Boolean(authoritative?.tokens) ? EvidenceType.EXACT : EvidenceType.ESTIMATED
          },
          total: {
            value: totalMeasurableTokens,
            source: Boolean(authoritative?.tokens) ? 'conversation_api' : 'tokenizer',
            evidenceType: Boolean(authoritative?.tokens) ? EvidenceType.EXACT : EvidenceType.ESTIMATED
          },
          contextWindow: {
            value: contextWindow,
            source: 'model_db',
            // Looked up from a curated table, not reported by ChatGPT, so never EXACT
            evidenceType: contextWindow ? EvidenceType.OBSERVED : EvidenceType.UNKNOWN
          }
        },
        completeness: {
          value: completeness.conversationComplete ? 'COMPLETE' : 'PARTIAL',
          source: completeness.completenessSource,
          evidenceType: completeness.completenessSource === 'authoritative_api' ? EvidenceType.EXACT : EvidenceType.OBSERVED,
          domIsPartial: completeness.domIsPartial,
          virtualizationGap: completeness.virtualizationGap
        },
        serverContext: {
          value: 'UNOBSERVABLE',
          source: 'unknown',
          evidenceType: EvidenceType.UNKNOWN
        },
        conflicts: input.conflicts || [],
        hasConflicts: Boolean(input.conflicts && input.conflicts.length > 0)
      },
      conflicts: input.conflicts || [],
      limitations: [
        'Visible conversation text is not the complete prompt submitted to the model.',
        'Hidden server-side system prompts, developer instructions, and runtime metadata are not measurable from the client.',
        'Tool schemas and memory retrieval token overhead remain classified as UNKNOWN.'
      ]
    };
  }
}
