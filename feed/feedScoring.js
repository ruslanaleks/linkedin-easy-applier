// feed/feedScoring.js - AI-powered batch post scoring via Claude API
// Collects 5-10 pre-filtered posts, scores them in ONE Claude request,
// returns structured 0-100 ratings that drive engagement decisions.

window.linkedInAutoApply = window.linkedInAutoApply || {};

(function () {
  'use strict';

  // ── Configuration ──────────────────────────────────────────────────────
  const CONFIG = {
    ENDPOINT: 'https://api.anthropic.com/v1/messages',
    DEFAULT_MODEL: 'claude-sonnet-4-20250514',
    API_TIMEOUT: 45000,       // 45s — batch needs more time
    RETRY_COUNT: 4,
    RETRY_DELAY: 3000,
    MAX_CONTENT_LENGTH: 1200, // per-post truncation (shorter to fit batch)
    API_VERSION: '2023-06-01',
    BATCH_SIZE: 8,            // target batch size (5-10 range)
    BATCH_MIN: 3,             // send batch even if fewer posts remain
    MAX_TOKENS: 4096,         // enough for 10 post results

    // Score thresholds
    THRESHOLD_LIKE_COMMENT_FOLLOW: 85, // 85-100 → like + comment + follow
    THRESHOLD_LIKE_COMMENT: 70,  // 70-84  → like + comment
    THRESHOLD_LIKE_ONLY: 40,     // 40-69  → only like
    // 0-39 → skip

    // Storage key
    SETTINGS_KEY: 'feedScoringSettings',

    // Cache
    CACHE_TTL_MS: 10 * 60 * 1000,
    MAX_CACHE_SIZE: 200,
  };

  // ── State ──────────────────────────────────────────────────────────────
  const scoreCache = new Map();

  // ── Utility ────────────────────────────────────────────────────────────

  function truncate(text, max) {
    if (!text) return '';
    return text.length > max ? text.slice(0, max - 3) + '...' : text;
  }

  function sanitize(text) {
    if (!text) return '';
    return text
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')
      .replace(/[\uD800-\uDFFF]/g, '')
      .replace(/\s{3,}/g, '  ')
      .trim();
  }

  function contentHash(content) {
    const norm = (content || '').toLowerCase().replace(/\s+/g, ' ').trim();
    let h = 0;
    for (let i = 0; i < Math.min(norm.length, 500); i++) {
      h = ((h << 5) - h) + norm.charCodeAt(i);
      h = h & h;
    }
    return `score-${Math.abs(h).toString(36)}`;
  }

  // ── Settings ───────────────────────────────────────────────────────────

  function getDefaultSettings() {
    return {
      enableScoring: false,
      claudeApiKey: '',
      claudeModel: CONFIG.DEFAULT_MODEL,
      thresholdLikeCommentFollow: CONFIG.THRESHOLD_LIKE_COMMENT_FOLLOW,
      thresholdLikeComment: CONFIG.THRESHOLD_LIKE_COMMENT,
      thresholdLikeOnly: CONFIG.THRESHOLD_LIKE_ONLY,
      niches: ['AI agents', 'payments', 'startup funding', 'engineering', 'fintech'],
      influencers: [],          // general influencer names (boost author score)
      tier1Influencers: [       // Tier 1 — ALWAYS like + comment
        'Spiros Margaris',
      ],
    };
  }

  async function loadSettings() {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage) return getDefaultSettings();
      const data = await chrome.storage.local.get(CONFIG.SETTINGS_KEY);
      return { ...getDefaultSettings(), ...(data?.[CONFIG.SETTINGS_KEY] || {}) };
    } catch (err) {
      if (!err.message?.includes('Extension context invalidated')) {
        console.warn('[FeedScoring] Failed to load settings:', err.message);
      }
      return getDefaultSettings();
    }
  }

  async function saveSettings(settings) {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        await chrome.storage.local.set({ [CONFIG.SETTINGS_KEY]: settings });
      }
    } catch (err) {
      if (!err.message?.includes('Extension context invalidated')) {
        console.warn('[FeedScoring] Failed to save settings:', err.message);
      }
    }
  }

  // ── Tier-1 Check ───────────────────────────────────────────────────────

  /**
   * Check if post author matches a Tier-1 influencer (case-insensitive partial match).
   * @param {string} author
   * @param {string[]} tier1List
   * @returns {boolean}
   */
  function isTier1(author, tier1List) {
    if (!author || !tier1List?.length) return false;
    const authorLower = author.toLowerCase();
    return tier1List.some(name => {
      const nameLower = name.toLowerCase().trim();
      return nameLower && authorLower.includes(nameLower);
    });
  }

  // ── Batch Prompt ───────────────────────────────────────────────────────

  /**
   * Build a single prompt that asks Claude to score N posts at once.
   * @param {Array<{post: Object, ageHours: number|null}>} items
   * @param {Object} settings
   * @returns {{ system: string, user: string }}
   */
  function buildBatchPrompt(items, settings) {
    const niches = (settings.niches || []).join(', ');
    const influencersList = (settings.influencers || []).length > 0
      ? `Known influencers / high-value authors: ${settings.influencers.join(', ')}.`
      : '';
    const tier1List = (settings.tier1Influencers || []).length > 0
      ? `Tier-1 influencers (ALWAYS score 70+): ${settings.tier1Influencers.join(', ')}.`
      : '';

    const system = `You are a LinkedIn post scoring engine for a professional engagement bot.
You receive a BATCH of posts and return a JSON ARRAY with one score object per post, in the same order.

Target niches: ${niches}.
${influencersList}
${tier1List}

Scoring rubric (total 0-100):

1. THEME RELEVANCE (0-30): How well does the post fit the target niches? Pure niche content = 25-30. Tangentially related = 10-20. Off-topic = 0-5.

2. CONTENT DEPTH (0-15): Real substance — experience, numbers, architecture decisions, lessons learned = 12-15. Generic motivational / empty platitudes = 0-4.

3. COMMENT POTENTIAL (0-10): Can we add genuine expert value? Technical topics where expertise shines = 8-10. Posts that don't invite discussion = 0-3.

4. AUTHOR VALUE (0-25): Founder, CTO, investor, VP Engineering, or someone from the influencer list = 20-25. Mid-level professional with niche expertise = 10-15. Random / unknown = 0-5. Tier-1 influencers from the list above MUST get 22-25.

5. VISIBILITY POTENTIAL (0-10): Sweet spot 10-50 reactions (growing, comment visible) = 8-10. 50-200 = 4-7. 200+ (comment drowns) = 0-3.

6. FRESHNESS (0-10): <1 hour = 9-10. 1-6h = 6-8. 6-12h = 3-5. 12-24h = 1-2. >24h = 0.

Return ONLY a valid JSON array, no markdown fences, no explanation outside JSON.
Each element must have this shape:
{
  "postIndex": <number, 0-based index matching input order>,
  "score": <number 0-100>,
  "breakdown": {
    "themeRelevance": <0-30>,
    "contentDepth": <0-15>,
    "commentPotential": <0-10>,
    "authorValue": <0-25>,
    "visibilityPotential": <0-10>,
    "freshness": <0-10>
  },
  "themes": [<detected theme strings, e.g. "AI Agents", "PCI-DSS">],
  "action": "<like_comment_follow | like_comment | like_only | skip>",
  "language": "<English | Russian | Spanish | Other>",
  "rationale": "<one sentence: why this post is or is not valuable>"
}`;

    // Build numbered post list
    const postBlocks = items.map((item, idx) => {
      const { post, ageHours } = item;
      return `--- POST ${idx} ---
Author: ${sanitize(post.author || 'Unknown')}
Headline: ${sanitize(post.headline || '')}
Reactions: ${post.reactions || 0}  Comments: ${post.comments || 0}
Age: ${ageHours !== null ? Math.round(ageHours * 10) / 10 + 'h' : 'unknown'}
Hashtags: ${(post.hashtags || []).join(', ') || 'none'}
Text: ${sanitize(truncate(post.content || '', CONFIG.MAX_CONTENT_LENGTH))}`;
    }).join('\n\n');

    const user = `Score these ${items.length} LinkedIn posts:\n\n${postBlocks}`;

    return { system, user };
  }

  // ── Claude API Call ────────────────────────────────────────────────────

  async function callClaudeAPI(systemPrompt, userMessage, settings) {
    const body = {
      model: settings.claudeModel || CONFIG.DEFAULT_MODEL,
      max_tokens: CONFIG.MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    };

    const response = await fetch(CONFIG.ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': settings.claudeApiKey,
        'anthropic-version': CONFIG.API_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CONFIG.API_TIMEOUT),
    });

    if (!response.ok) {
      let errText;
      try { errText = await response.text(); } catch { errText = response.statusText; }
      throw new Error(`Claude API ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const content = data?.content?.[0]?.text;
    if (!content) throw new Error('Empty response from Claude API');
    return content;
  }

  // ── Batch Scoring ──────────────────────────────────────────────────────

  /**
   * Score a batch of posts in a single Claude API call.
   *
   * @param {Array<{post: Object, ageHours: number|null, postEl: Element}>} items
   * @param {Object} settings
   * @returns {Promise<Array<{post, postEl, ageHours, scoreResult, scoredAction}>>}
   *   Scored queue ready for engagement. Items with Tier-1 override are force-set.
   */
  async function scoreBatch(items, settings) {
    if (!items.length) return [];
    if (!settings?.enableScoring || !settings?.claudeApiKey) return [];

    const tier1List = settings.tier1Influencers || [];

    // Separate cached hits from items that need API scoring
    const results = new Array(items.length).fill(null);
    const toScore = []; // { originalIdx, item }

    for (let i = 0; i < items.length; i++) {
      const hash = contentHash(items[i].post.content);
      const cached = scoreCache.get(hash);
      if (cached && (Date.now() - cached.timestamp < CONFIG.CACHE_TTL_MS)) {
        results[i] = cached.result;
      } else {
        toScore.push({ originalIdx: i, item: items[i] });
      }
    }

    // Call Claude API for uncached posts
    if (toScore.length > 0) {
      const batchItems = toScore.map(e => e.item);
      const { system, user } = buildBatchPrompt(batchItems, settings);

      let raw;
      for (let attempt = 0; attempt <= CONFIG.RETRY_COUNT; attempt++) {
        try {
          raw = await callClaudeAPI(system, user, settings);
          break;
        } catch (err) {
          console.warn(`[FeedScoring] Batch API attempt ${attempt + 1} failed:`, err.message);
          if (attempt < CONFIG.RETRY_COUNT) {
            // Exponential backoff: 3s, 6s, 12s, 24s
            const backoff = CONFIG.RETRY_DELAY * Math.pow(2, attempt);
            console.log(`[FeedScoring] Retrying in ${backoff / 1000}s...`);
            await new Promise(r => setTimeout(r, backoff));
          } else {
            console.error('[FeedScoring] All retries exhausted for batch of', toScore.length);
            // Return items without scores — they'll get fallback action
            return items.map(item => ({
              ...item,
              scoreResult: null,
              scoredAction: getAction(null, settings),
            }));
          }
        }
      }

      // Parse JSON array
      let parsed;
      try {
        const jsonStr = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
        parsed = JSON.parse(jsonStr);
        if (!Array.isArray(parsed)) {
          // Maybe Claude wrapped it in an object
          if (parsed.results && Array.isArray(parsed.results)) {
            parsed = parsed.results;
          } else {
            throw new Error('Response is not an array');
          }
        }
      } catch (parseErr) {
        console.error('[FeedScoring] Failed to parse batch response:', raw?.slice(0, 500));
        return items.map(item => ({
          ...item,
          scoreResult: null,
          scoredAction: getAction(null, settings),
        }));
      }

      // Map parsed results back to original indices
      for (const entry of parsed) {
        const batchIdx = entry.postIndex ?? parsed.indexOf(entry);
        if (batchIdx < 0 || batchIdx >= toScore.length) continue;

        const originalIdx = toScore[batchIdx].originalIdx;
        entry.score = Math.max(0, Math.min(100, Math.round(entry.score || 0)));

        results[originalIdx] = entry;

        // Cache
        const hash = contentHash(items[originalIdx].post.content);
        if (scoreCache.size >= CONFIG.MAX_CACHE_SIZE) {
          const oldest = scoreCache.keys().next().value;
          if (oldest) scoreCache.delete(oldest);
        }
        scoreCache.set(hash, { result: entry, timestamp: Date.now() });
      }
    }

    // Build final scored queue with Tier-1 override
    const queue = items.map((item, idx) => {
      const scoreResult = results[idx] || null;
      const authorIsTier1 = isTier1(item.post.author, tier1List);

      let scoredAction;
      if (authorIsTier1) {
        scoredAction = 'like_comment_follow'; // Tier-1: ALWAYS like + comment + follow
      } else {
        scoredAction = getAction(scoreResult, settings);
      }

      return {
        ...item,
        scoreResult,
        scoredAction,
        isTier1: authorIsTier1,
      };
    });

    console.log('[FeedScoring] Batch scored:', queue.length, 'posts',
      '| like+comment+follow:', queue.filter(q => q.scoredAction === 'like_comment_follow').length,
      '| like+comment:', queue.filter(q => q.scoredAction === 'like_comment').length,
      '| like only:', queue.filter(q => q.scoredAction === 'like_only').length,
      '| skip:', queue.filter(q => q.scoredAction === 'skip').length,
      '| tier1:', queue.filter(q => q.isTier1).length,
    );

    return queue;
  }

  // ── Action Resolution ──────────────────────────────────────────────────

  /**
   * Determine engagement action from score result and thresholds.
   * @param {Object|null} scoreResult
   * @param {Object} settings
   * @returns {'like_comment'|'like_only'|'skip'}
   */
  function getAction(scoreResult, settings) {
    if (!scoreResult) return 'like_only'; // fallback when scoring unavailable
    const { score } = scoreResult;
    const tLCF = settings?.thresholdLikeCommentFollow ?? CONFIG.THRESHOLD_LIKE_COMMENT_FOLLOW;
    const tLC = settings?.thresholdLikeComment ?? CONFIG.THRESHOLD_LIKE_COMMENT;
    const tLO = settings?.thresholdLikeOnly ?? CONFIG.THRESHOLD_LIKE_ONLY;
    if (score >= tLCF) return 'like_comment_follow';
    if (score >= tLC) return 'like_comment';
    if (score >= tLO) return 'like_only';
    return 'skip';
  }

  // ── Legacy single-post wrapper (for backwards compat) ──────────────────

  async function scorePost(post, ageHours, settingsOverride = null) {
    const settings = settingsOverride || await loadSettings();
    const batch = await scoreBatch([{ post, ageHours, postEl: null }], settings);
    return batch[0]?.scoreResult || null;
  }

  // ── Test Connection ────────────────────────────────────────────────────

  async function testConnection(settings) {
    try {
      if (!settings?.claudeApiKey) {
        return { success: false, message: 'No API key provided' };
      }
      const raw = await callClaudeAPI(
        'You are a test assistant. Respond with exactly: {"ok":true}',
        'Ping',
        settings,
      );
      return { success: true, message: `Connected. Response: ${raw.slice(0, 60)}` };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  // ── Cache Management ───────────────────────────────────────────────────

  function clearCache() {
    scoreCache.clear();
  }

  function getCacheStats() {
    return { size: scoreCache.size, maxSize: CONFIG.MAX_CACHE_SIZE };
  }

  // ── Public API ─────────────────────────────────────────────────────────

  window.linkedInAutoApply.feedScoring = {
    scoreBatch,
    scorePost,
    getAction,
    isTier1,
    loadSettings,
    saveSettings,
    getDefaultSettings,
    testConnection,
    clearCache,
    getCacheStats,
    getConfig: () => ({ ...CONFIG }),
  };

  console.log('[FeedScoring] Module loaded (batch mode)');
})();
