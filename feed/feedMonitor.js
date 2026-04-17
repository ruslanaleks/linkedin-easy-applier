// feed/feedMonitor.js — Background influencer post monitoring
// Scans visible feed posts for influencer matches at tier-specific intervals.
// Stores results in chrome.storage.local and notifies background for Chrome
// notifications (Tier 1) and badge updates.

window.linkedInAutoApply = window.linkedInAutoApply || {};

(function () {
  'use strict';

  const STORAGE_KEY = 'influencerMonitorState';
  const PENDING_KEY = 'pendingInfluencerChecks';
  const MAX_NEW_POSTS = 100;
  const MAX_WEEKLY_HISTORY = 4;

  // ── Default State ────────────────────────────────────────────────────────

  function getDefaultState() {
    return {
      newPosts: [],
      lastCheckTimes: { 1: 0, 2: 0, 3: 0 },
      weeklyHistory: [],
    };
  }

  async function loadState() {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage) return getDefaultState();
      const data = await chrome.storage.local.get(STORAGE_KEY);
      return { ...getDefaultState(), ...(data?.[STORAGE_KEY] || {}) };
    } catch {
      return getDefaultState();
    }
  }

  async function saveState(state) {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage) return;
      await chrome.storage.local.set({ [STORAGE_KEY]: state });
    } catch (err) {
      if (!err.message?.includes('Extension context invalidated')) {
        console.warn('[FeedMonitor] Failed to save state:', err.message);
      }
    }
  }

  // ── Core Scan ────────────────────────────────────────────────────────────

  /**
   * Perform a lightweight influencer scan on visible feed posts.
   * No scrolling, no content expansion — runs in < 1 second.
   * @param {number} tier — 1, 2, or 3
   * @returns {{ newPosts: Array, tier: number }}
   */
  async function performInfluencerScan(tier) {
    const _feed = window.linkedInAutoApply.feed;
    const _scoring = window.linkedInAutoApply.feedScoring;
    if (!_feed || !_scoring) {
      console.warn('[FeedMonitor] Required modules not loaded');
      return { newPosts: [], tier };
    }

    console.log(`[FeedMonitor] Starting Tier-${tier} scan...`);

    // 1. Scrape visible posts (no scroll, no expand)
    let posts;
    try {
      posts = await _feed.scrapeVisiblePosts(false);
    } catch (err) {
      console.warn('[FeedMonitor] scrapeVisiblePosts failed:', err.message);
      return { newPosts: [], tier };
    }

    if (!posts || posts.length === 0) {
      console.log('[FeedMonitor] No visible posts found');
      return { newPosts: [], tier };
    }

    // 2. Load influencer list, filter to requested tier
    const settings = await _scoring.loadSettings();
    const influencerList = (settings.influencerList || []).filter(
      i => i.enabled !== false && i.tier === tier
    );

    if (influencerList.length === 0) {
      console.log(`[FeedMonitor] No enabled Tier-${tier} influencers`);
      return { newPosts: [], tier };
    }

    // 3. Match posts against influencer names
    const state = await loadState();
    const existingIds = new Set(state.newPosts.map(p => p.postId));
    const foundPosts = [];

    for (const post of posts) {
      if (!post.author || !post.id) continue;

      const matched = _scoring.matchInfluencer(post.author, influencerList);
      if (!matched) continue;

      // Dedupe: skip if already in newPosts or in influencer's seenPostIds
      if (existingIds.has(post.id)) continue;
      const seenIds = matched.stats?.seenPostIds || [];
      if (seenIds.includes(post.id)) continue;

      foundPosts.push({
        postId: post.id,
        author: post.author,
        influencerId: matched.id,
        influencerName: matched.name,
        tier: matched.tier,
        contentSnippet: (post.content || '').slice(0, 150),
        foundAt: Date.now(),
        seen: false,
      });

      // Update influencer stats (fire-and-forget)
      _scoring.updateInfluencerStats(matched.id, 'seen', post.id).catch(() => {});
    }

    // 4. Persist new posts (FIFO cap)
    if (foundPosts.length > 0) {
      state.newPosts = [...foundPosts, ...state.newPosts].slice(0, MAX_NEW_POSTS);
    }
    state.lastCheckTimes[tier] = Date.now();
    await saveState(state);

    console.log(`[FeedMonitor] Tier-${tier} scan complete: ${foundPosts.length} new posts from ${posts.length} visible`);

    // 5. Notify background (for Chrome notification on Tier 1)
    if (foundPosts.length > 0) {
      try {
        chrome.runtime.sendMessage({
          action: 'influencerScanComplete',
          newPosts: foundPosts,
          tier,
        });
      } catch {}
    }

    // 6. Update UI badges
    if (window.linkedInAutoApply.feedUI?.updateBadges) {
      window.linkedInAutoApply.feedUI.updateBadges();
    }

    return { newPosts: foundPosts, tier };
  }

  // ── Deferred Checks ──────────────────────────────────────────────────────

  /**
   * Execute any deferred influencer checks that were stored while no
   * LinkedIn tab was open.
   */
  async function processPendingChecks() {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage) return;
      const data = await chrome.storage.local.get(PENDING_KEY);
      const pending = data?.[PENDING_KEY];
      if (!pending) return;

      const maxAge = { 1: 2 * 60 * 60 * 1000, 2: 6 * 60 * 60 * 1000, 3: 12 * 60 * 60 * 1000 };
      const now = Date.now();
      let ran = false;

      for (const tier of [1, 2, 3]) {
        const ts = pending[tier];
        if (ts && (now - ts) < maxAge[tier]) {
          console.log(`[FeedMonitor] Processing deferred Tier-${tier} check`);
          await performInfluencerScan(tier);
          ran = true;
        }
      }

      if (ran) {
        await chrome.storage.local.remove(PENDING_KEY);
      }
    } catch (err) {
      if (!err.message?.includes('Extension context invalidated')) {
        console.warn('[FeedMonitor] Failed to process pending checks:', err.message);
      }
    }
  }

  // ── State Accessors ──────────────────────────────────────────────────────

  async function getMonitorState() {
    return loadState();
  }

  /**
   * Mark specific posts as seen (clears badge counts).
   * @param {string[]} postIds
   */
  async function markPostsSeen(postIds) {
    if (!postIds || postIds.length === 0) return;
    const idSet = new Set(postIds);
    const state = await loadState();
    let changed = false;
    for (const p of state.newPosts) {
      if (idSet.has(p.postId) && !p.seen) {
        p.seen = true;
        changed = true;
      }
    }
    if (changed) {
      await saveState(state);
      if (window.linkedInAutoApply.feedUI?.updateBadges) {
        window.linkedInAutoApply.feedUI.updateBadges();
      }
    }
  }

  /**
   * Mark all unseen posts as seen.
   */
  async function markAllSeen() {
    const state = await loadState();
    let changed = false;
    for (const p of state.newPosts) {
      if (!p.seen) { p.seen = true; changed = true; }
    }
    if (changed) {
      await saveState(state);
      if (window.linkedInAutoApply.feedUI?.updateBadges) {
        window.linkedInAutoApply.feedUI.updateBadges();
      }
    }
  }

  // ── Weekly Report Data ───────────────────────────────────────────────────

  /**
   * Build aggregated weekly report data for the report panel.
   * Combines influencer stats from feedScoring with monitor state.
   */
  async function getWeeklyReport() {
    const _scoring = window.linkedInAutoApply.feedScoring;
    if (!_scoring) return null;

    const settings = await _scoring.loadSettings();
    const list = (settings.influencerList || []).filter(i => i.enabled !== false);
    const currentWeek = _scoring.getCurrentWeekIso();
    const state = await loadState();

    const tierSummary = _scoring.getTierSummary(settings);

    // Per-influencer rows
    const rows = list.map(inf => {
      const stats = inf.stats || _scoring.makeDefaultStats();
      _scoring.rolloverWeekIfNeeded(stats);

      // Count posts found by monitor this week for this influencer
      const monitorPosts = state.newPosts.filter(
        p => p.influencerId === inf.id
      );
      const monitorPostsThisWeek = monitorPosts.filter(p => {
        const d = new Date(p.foundAt);
        const week = _scoring.getCurrentWeekIso(d);
        return week === currentWeek;
      });

      return {
        id: inf.id,
        name: inf.name,
        title: inf.title || '',
        tier: inf.tier,
        weekCommentCount: stats.weekCommentCount || 0,
        weekStatus: stats.weekStatus || 'new',
        totalPostsSeen: stats.totalPostsSeen || 0,
        lastSeenAt: stats.lastSeenAt || 0,
        monitorPostsThisWeek: monitorPostsThisWeek.length,
        unseenCount: monitorPosts.filter(p => !p.seen).length,
      };
    });

    // Unseen posts for the "New Posts" section
    const unseenPosts = state.newPosts.filter(p => !p.seen);

    return {
      currentWeek,
      tierSummary,
      rows,
      unseenPosts,
      lastCheckTimes: state.lastCheckTimes,
    };
  }

  // ── Weekly History Snapshot ─────────────────────────────────────────────

  /**
   * Snapshot current week stats into weeklyHistory before rollover.
   * Called by the weekly alarm in background.js.
   */
  async function snapshotWeeklyHistory() {
    const _scoring = window.linkedInAutoApply.feedScoring;
    if (!_scoring) return;

    const settings = await _scoring.loadSettings();
    const list = (settings.influencerList || []).filter(i => i.enabled !== false);
    const currentWeek = _scoring.getCurrentWeekIso();
    const state = await loadState();

    const influencerStats = {};
    for (const inf of list) {
      const stats = inf.stats || {};
      if (stats.weekIso === currentWeek) {
        influencerStats[inf.id] = {
          postsSeen: stats.totalPostsSeen || 0,
          commentsMade: stats.weekCommentCount || 0,
        };
      }
    }

    // Append and cap history
    state.weeklyHistory = state.weeklyHistory || [];
    // Replace if same week already exists
    const idx = state.weeklyHistory.findIndex(h => h.weekIso === currentWeek);
    const entry = { weekIso: currentWeek, influencerStats };
    if (idx >= 0) {
      state.weeklyHistory[idx] = entry;
    } else {
      state.weeklyHistory.push(entry);
    }
    // Keep only last N weeks
    if (state.weeklyHistory.length > MAX_WEEKLY_HISTORY) {
      state.weeklyHistory = state.weeklyHistory.slice(-MAX_WEEKLY_HISTORY);
    }

    await saveState(state);
    console.log('[FeedMonitor] Weekly history snapshot saved for', currentWeek);
  }

  // ── Public API ─────────────────────────────────────────────────────────

  window.linkedInAutoApply.feedMonitor = {
    performInfluencerScan,
    processPendingChecks,
    getMonitorState,
    markPostsSeen,
    markAllSeen,
    getWeeklyReport,
    snapshotWeeklyHistory,
    STORAGE_KEY,
  };

  console.log('[FeedMonitor] Module loaded');
})();
