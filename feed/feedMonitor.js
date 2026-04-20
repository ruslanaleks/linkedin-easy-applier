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

    const config = _scoring.getConfig();
    const tierTargets = config.TIER_WEEKLY_COMMENT_TARGET || { 1: -1, 2: 3, 3: 0 };

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

      const weekCommentCount = stats.weekCommentCount || 0;
      const weekPostsSeen = stats.weekPostsSeen || 0;
      const tierTarget = tierTargets[inf.tier];

      // Compute per-influencer target and percentage
      let target, pct;
      if (tierTarget === -1) {
        // Tier 1: every post
        target = weekPostsSeen;
        pct = target > 0 ? Math.min(100, Math.round((weekCommentCount / target) * 100)) : (weekCommentCount > 0 ? 100 : 0);
      } else if (tierTarget > 0) {
        // Tier 2: fixed weekly target
        target = tierTarget;
        pct = Math.min(100, Math.round((weekCommentCount / target) * 100));
      } else {
        // Tier 3: optional
        target = 0;
        pct = weekCommentCount > 0 ? 100 : 0;
      }

      return {
        id: inf.id,
        name: inf.name,
        title: inf.title || '',
        tier: inf.tier,
        weekCommentCount,
        weekPostsSeen,
        target,
        pct,
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
          weekPostsSeen: stats.weekPostsSeen || 0,
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

  // ── Continuous Monitoring ─────────────────────────────────────────────

  let _observer = null;
  let _scanInterval = null;
  let _observerDebounce = null;
  let _monitoring = false;

  // How often the periodic scan fires (ms). Tier 1 posts are critical so
  // we scan relatively often; the scan itself is fast (visible posts only).
  const CONTINUOUS_SCAN_INTERVAL = 3 * 60 * 1000; // 3 minutes

  // Minimum gap between observer-triggered scans to avoid hammering during
  // rapid DOM mutations (LinkedIn inserts nodes in bursts as the user scrolls).
  const OBSERVER_DEBOUNCE_MS = 5000;

  /**
   * Start continuous monitoring: MutationObserver + periodic interval.
   * Call once on feed page load. Safe to call multiple times (no-op if running).
   */
  function startContinuousMonitoring() {
    if (_monitoring) return;
    _monitoring = true;

    console.log('[FeedMonitor] Starting continuous monitoring...');

    // 1. Immediate initial scan for all tiers
    runFullScan();

    // 2. Periodic scan every CONTINUOUS_SCAN_INTERVAL
    _scanInterval = setInterval(runFullScan, CONTINUOUS_SCAN_INTERVAL);

    // 3. MutationObserver on feed container to catch new posts as they appear
    startFeedObserver();
  }

  /**
   * Stop continuous monitoring. Called on page unload / cleanup.
   */
  function stopContinuousMonitoring() {
    _monitoring = false;
    if (_observer) { _observer.disconnect(); _observer = null; }
    if (_scanInterval) { clearInterval(_scanInterval); _scanInterval = null; }
    if (_observerDebounce) { clearTimeout(_observerDebounce); _observerDebounce = null; }
    console.log('[FeedMonitor] Continuous monitoring stopped');
  }

  /**
   * Run a scan across all tiers that have enabled influencers.
   */
  async function runFullScan() {
    const _scoring = window.linkedInAutoApply.feedScoring;
    if (!_scoring) return;

    try {
      const settings = await _scoring.loadSettings();
      const list = settings.influencerList || [];

      for (const tier of [1, 2, 3]) {
        if (list.some(i => i.enabled !== false && i.tier === tier)) {
          await performInfluencerScan(tier);
        }
      }
    } catch (err) {
      console.warn('[FeedMonitor] Full scan failed:', err.message);
    }
  }

  /**
   * Observe the feed container for new child nodes (new posts loaded by
   * LinkedIn as the user scrolls or the SPA updates). Triggers a debounced
   * scan so we react within seconds of a new post appearing.
   */
  function startFeedObserver() {
    if (_observer) return; // already running

    const _feed = window.linkedInAutoApply.feed;
    if (!_feed?.findFeedContainer) {
      // Feed module not ready yet — retry once after a short delay
      setTimeout(startFeedObserver, 3000);
      return;
    }

    const container = _feed.findFeedContainer();
    if (!container) {
      console.warn('[FeedMonitor] No feed container found, retrying in 5s...');
      setTimeout(startFeedObserver, 5000);
      return;
    }

    _observer = new MutationObserver(() => {
      // Debounce: wait for the burst of mutations to settle
      if (_observerDebounce) clearTimeout(_observerDebounce);
      _observerDebounce = setTimeout(() => {
        _observerDebounce = null;
        runFullScan();
      }, OBSERVER_DEBOUNCE_MS);
    });

    _observer.observe(container, { childList: true, subtree: true });
    console.log('[FeedMonitor] Feed observer attached');
  }

  // ── Profile Visitor ──────────────────────────────────────────────────

  /**
   * Kick off profile visits for all enabled influencers with profile URLs.
   * Background.js handles tab creation, script injection, and orchestration.
   * @returns {Promise<Object>} results summary
   */
  async function visitInfluencerProfiles() {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ action: 'startProfileVisits' }, (resp) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (resp?.success) {
            resolve(resp.results);
          } else {
            reject(new Error(resp?.error || 'Unknown error'));
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Check if profile visits are currently running.
   */
  async function getProfileVisitStatus() {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ action: 'getProfileVisitStatus' }, (resp) => {
          resolve(resp || { running: false });
        });
      } catch {
        resolve({ running: false });
      }
    });
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
    startContinuousMonitoring,
    stopContinuousMonitoring,
    visitInfluencerProfiles,
    getProfileVisitStatus,
    STORAGE_KEY,
  };

  console.log('[FeedMonitor] Module loaded');
})();
