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

    // Influencer tier targets (comments/week the bot tries to achieve per influencer)
    TIER_WEEKLY_COMMENT_TARGET: { 1: 2, 2: 1, 3: 0 },
    // Score boost applied on top of AI score when the author matches an influencer.
    // Tier 1 is also force-promoted to like_comment_follow regardless of numeric score.
    TIER_SCORE_BOOST: { 1: 0, 2: 15, 3: 8 },
    // Max post IDs retained per-influencer in stats.seenPostIds (FIFO).
    MAX_SEEN_POST_IDS: 200,
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

  function getCurrentWeekIso(date = new Date()) {
    // ISO 8601 week: Monday-start, week 1 contains first Thursday of year.
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNum = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
  }

  function makeInfluencerId() {
    return 'inf_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function makeDefaultStats() {
    return {
      lastSeenAt: 0,
      lastCheckedAt: 0,
      weekIso: getCurrentWeekIso(),
      weekCommentCount: 0,
      weekStatus: 'new',       // 'new' | 'ok' | 'commented'
      totalPostsSeen: 0,
      seenPostIds: [],
    };
  }

  function normalizeInfluencer(raw) {
    return {
      id: raw.id || makeInfluencerId(),
      name: (raw.name || '').trim(),
      title: (raw.title || '').trim(),
      reason: (raw.reason || '').trim(),
      profileUrl: (raw.profileUrl || '').trim(),
      tier: [1, 2, 3].includes(raw.tier) ? raw.tier : 2,
      enabled: raw.enabled !== false,
      stats: { ...makeDefaultStats(), ...(raw.stats || {}) },
    };
  }

  function getDefaultSettings() {
    return {
      enableScoring: false,
      claudeApiKey: '',
      claudeModel: CONFIG.DEFAULT_MODEL,
      thresholdLikeCommentFollow: CONFIG.THRESHOLD_LIKE_COMMENT_FOLLOW,
      thresholdLikeComment: CONFIG.THRESHOLD_LIKE_COMMENT,
      thresholdLikeOnly: CONFIG.THRESHOLD_LIKE_ONLY,
      niches: ['AI agents', 'payments', 'startup funding', 'engineering', 'fintech'],
      influencerList: [
        normalizeInfluencer({ name: 'Spiros Margaris', tier: 1, title: 'Top fintech influencer', reason: 'High-reach fintech/AI voice', enabled: true }),
      ],
    };
  }

  /**
   * Migrate legacy flat arrays (influencers[], tier1Influencers[]) into the
   * structured influencerList. Idempotent — only runs if influencerList is
   * empty/missing and a legacy field has entries.
   */
  function migrateLegacyInfluencers(stored) {
    if (!stored) return stored;
    const hasNew = Array.isArray(stored.influencerList) && stored.influencerList.length > 0;
    const hasLegacy = (Array.isArray(stored.tier1Influencers) && stored.tier1Influencers.length)
      || (Array.isArray(stored.influencers) && stored.influencers.length);

    if (hasNew || !hasLegacy) {
      // Still normalize whatever is there so fields like stats/id are present
      if (Array.isArray(stored.influencerList)) {
        stored.influencerList = stored.influencerList.map(normalizeInfluencer);
      }
      return stored;
    }

    const list = [];
    const seen = new Set();
    for (const name of (stored.tier1Influencers || [])) {
      const clean = (name || '').trim();
      if (!clean || seen.has(clean.toLowerCase())) continue;
      seen.add(clean.toLowerCase());
      list.push(normalizeInfluencer({ name: clean, tier: 1, reason: 'Migrated from tier1Influencers' }));
    }
    for (const name of (stored.influencers || [])) {
      const clean = (name || '').trim();
      if (!clean || seen.has(clean.toLowerCase())) continue;
      seen.add(clean.toLowerCase());
      list.push(normalizeInfluencer({ name: clean, tier: 2, reason: 'Migrated from influencers' }));
    }
    stored.influencerList = list;
    delete stored.tier1Influencers;
    delete stored.influencers;
    console.log('[FeedScoring] Migrated', list.length, 'legacy influencers to influencerList');
    return stored;
  }

  async function loadSettings() {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage) return getDefaultSettings();
      const data = await chrome.storage.local.get(CONFIG.SETTINGS_KEY);
      const stored = migrateLegacyInfluencers(data?.[CONFIG.SETTINGS_KEY] || null);
      const merged = { ...getDefaultSettings(), ...(stored || {}) };
      // Ensure list shape is normalized even if merged from partial legacy
      merged.influencerList = (merged.influencerList || []).map(normalizeInfluencer);
      // Persist migration result so next load skips the migration path
      if (stored && data?.[CONFIG.SETTINGS_KEY] && !Array.isArray(data[CONFIG.SETTINGS_KEY].influencerList)) {
        saveSettings(merged).catch(() => {});
      }
      return merged;
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

  // ── Influencer Matching ────────────────────────────────────────────────

  /**
   * Match a post author against the structured influencer list.
   * Case-insensitive substring match on the full normalized name. Disabled
   * entries are skipped. Returns the first matching influencer object or null.
   * Tier 1 wins ties (sort order).
   *
   * @param {string} author
   * @param {Array<Object>} influencerList
   * @returns {Object|null} influencer record or null
   */
  function matchInfluencer(author, influencerList) {
    if (!author || !Array.isArray(influencerList) || !influencerList.length) return null;
    const authorLower = author.toLowerCase().trim();
    if (!authorLower) return null;

    // Stable sort by tier so a Tier-1 match wins if the same name exists at multiple tiers
    const candidates = influencerList
      .filter(inf => inf && inf.enabled !== false && inf.name)
      .slice()
      .sort((a, b) => (a.tier || 9) - (b.tier || 9));

    for (const inf of candidates) {
      const nameLower = inf.name.toLowerCase().trim();
      if (nameLower && authorLower.includes(nameLower)) return inf;
    }
    return null;
  }

  /**
   * Backwards-compat: true if the author matches a Tier-1 influencer.
   * Accepts either a structured list or a legacy flat array of names.
   */
  function isTier1(author, listOrNames) {
    if (!author || !listOrNames?.length) return false;
    // Legacy flat array of strings
    if (typeof listOrNames[0] === 'string') {
      const authorLower = author.toLowerCase();
      return listOrNames.some(name => {
        const nameLower = (name || '').toLowerCase().trim();
        return nameLower && authorLower.includes(nameLower);
      });
    }
    const matched = matchInfluencer(author, listOrNames);
    return !!matched && matched.tier === 1;
  }

  /**
   * Strip internal stats/id fields when attaching to a queue item — keeps the
   * queue payload small and forward-compatible.
   */
  function serializeInfluencerForQueue(inf) {
    if (!inf) return null;
    return {
      id: inf.id,
      name: inf.name,
      title: inf.title || '',
      reason: inf.reason || '',
      tier: inf.tier,
    };
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
    const list = (settings.influencerList || []).filter(i => i.enabled !== false && i.name);
    const tier1Names = list.filter(i => i.tier === 1).map(i => i.name);
    const tier2Names = list.filter(i => i.tier === 2).map(i => i.name);
    const tier3Names = list.filter(i => i.tier === 3).map(i => i.name);
    const tier1List = tier1Names.length
      ? `Tier-1 influencers (ALWAYS score 70+, force top author value): ${tier1Names.join(', ')}.`
      : '';
    const tier2List = tier2Names.length
      ? `Tier-2 influencers (high-value, boost score): ${tier2Names.join(', ')}.`
      : '';
    const tier3List = tier3Names.length
      ? `Tier-3 influencers (tracked, minor boost): ${tier3Names.join(', ')}.`
      : '';
    const influencersList = [tier2List, tier3List].filter(Boolean).join(' ');

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

    const influencerList = settings.influencerList || [];

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

    // Build final scored queue with per-tier influencer override + boost
    const queue = items.map((item, idx) => {
      const scoreResult = results[idx] || null;
      const matched = matchInfluencer(item.post.author, influencerList);

      // Apply per-tier score boost on top of AI score (does not affect Tier-1
      // force-action; Tier-1 bypasses thresholds entirely).
      let boostedScoreResult = scoreResult;
      if (matched && scoreResult && matched.tier !== 1) {
        const boost = CONFIG.TIER_SCORE_BOOST[matched.tier] || 0;
        if (boost > 0) {
          boostedScoreResult = {
            ...scoreResult,
            score: Math.min(100, (scoreResult.score || 0) + boost),
            boostApplied: boost,
            boostReason: `tier-${matched.tier} influencer`,
          };
        }
      }

      let scoredAction;
      if (matched && matched.tier === 1) {
        scoredAction = 'like_comment_follow'; // Tier-1: ALWAYS like + comment + follow
      } else {
        scoredAction = getAction(boostedScoreResult, settings);
      }

      return {
        ...item,
        scoreResult: boostedScoreResult,
        scoredAction,
        isTier1: !!(matched && matched.tier === 1),
        influencer: serializeInfluencerForQueue(matched),
      };
    });

    console.log('[FeedScoring] Batch scored:', queue.length, 'posts',
      '| like+comment+follow:', queue.filter(q => q.scoredAction === 'like_comment_follow').length,
      '| like+comment:', queue.filter(q => q.scoredAction === 'like_comment').length,
      '| like only:', queue.filter(q => q.scoredAction === 'like_only').length,
      '| skip:', queue.filter(q => q.scoredAction === 'skip').length,
      '| influencer matches:', queue.filter(q => q.influencer).length,
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

  // ── Influencer Stats Tracking ──────────────────────────────────────────

  /**
   * Ensure the influencer's week fields reflect the current ISO week, resetting
   * weekStatus / weekCommentCount at the boundary. Mutates and returns the stats.
   */
  function rolloverWeekIfNeeded(stats) {
    const currentWeek = getCurrentWeekIso();
    if (stats.weekIso !== currentWeek) {
      stats.weekIso = currentWeek;
      stats.weekStatus = 'new';
      stats.weekCommentCount = 0;
    }
    return stats;
  }

  /**
   * Record an engagement event for an influencer and persist it.
   * @param {string} influencerId
   * @param {'seen'|'ok'|'commented'} event
   * @param {string} [postId] — optional LinkedIn post id/urn, added to seenPostIds
   */
  async function updateInfluencerStats(influencerId, event, postId = null) {
    if (!influencerId) return;
    try {
      const settings = await loadSettings();
      const list = settings.influencerList || [];
      const inf = list.find(i => i.id === influencerId);
      if (!inf) return;

      const stats = inf.stats || makeDefaultStats();
      rolloverWeekIfNeeded(stats);

      const now = Date.now();
      stats.lastSeenAt = now;

      if (postId) {
        if (!stats.seenPostIds) stats.seenPostIds = [];
        if (!stats.seenPostIds.includes(postId)) {
          stats.seenPostIds.push(postId);
          if (stats.seenPostIds.length > CONFIG.MAX_SEEN_POST_IDS) {
            stats.seenPostIds.splice(0, stats.seenPostIds.length - CONFIG.MAX_SEEN_POST_IDS);
          }
        }
      }

      // State machine: new → ok → commented. Only allow forward transitions
      // within the same week so a later 'seen' doesn't downgrade 'commented'.
      if (event === 'seen') {
        stats.totalPostsSeen = (stats.totalPostsSeen || 0) + 1;
        if (stats.weekStatus === 'new') stats.weekStatus = 'new'; // no-op — 'seen' doesn't imply ok yet
      } else if (event === 'ok') {
        if (stats.weekStatus === 'new') stats.weekStatus = 'ok';
      } else if (event === 'commented') {
        stats.weekStatus = 'commented';
        stats.weekCommentCount = (stats.weekCommentCount || 0) + 1;
      }

      inf.stats = stats;
      await saveSettings(settings);
    } catch (err) {
      if (!err.message?.includes('Extension context invalidated')) {
        console.warn('[FeedScoring] Failed to update influencer stats:', err.message);
      }
    }
  }

  /**
   * Aggregate per-tier summary used by the settings UI: posts seen this week,
   * target, percent achieved.
   */
  function getTierSummary(settings) {
    const list = (settings?.influencerList || []).filter(i => i.enabled !== false);
    const summary = { 1: null, 2: null, 3: null };
    const currentWeek = getCurrentWeekIso();

    for (const tier of [1, 2, 3]) {
      const tierInfs = list.filter(i => i.tier === tier);
      let weekComments = 0;
      let weekOks = 0;
      let weekNews = 0;
      for (const inf of tierInfs) {
        const s = inf.stats || makeDefaultStats();
        const status = s.weekIso === currentWeek ? s.weekStatus : 'new';
        if (status === 'commented') weekComments++;
        else if (status === 'ok') weekOks++;
        else weekNews++;
      }
      const target = CONFIG.TIER_WEEKLY_COMMENT_TARGET[tier] || 0;
      const totalPosts = tierInfs.reduce((sum, i) => sum + (i.stats?.totalPostsSeen || 0), 0);
      summary[tier] = {
        tier,
        count: tierInfs.length,
        target,
        weekComments,
        weekOks,
        weekNews,
        totalPostsSeen: totalPosts,
        targetMet: target === 0 ? true : weekComments >= target,
      };
    }
    return summary;
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
    matchInfluencer,
    normalizeInfluencer,
    makeInfluencerId,
    updateInfluencerStats,
    getTierSummary,
    getCurrentWeekIso,
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
