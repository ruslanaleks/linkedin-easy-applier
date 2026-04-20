// background.js - Background script for LinkedIn Auto Apply extension

// Track application statistics
let stats = {
  totalApplied: 0,
  sessionsApplied: 0,
  lastApplied: null,
};

// Initialize job keywords
let jobKeywords = [
  "javascript",
  "JavaScript",
  "express.js",
  "Express.js",
  "HTML",
  "CSS",
  "PostgreSQL",
  "MongoDB",
  "MySQL",
  "node.js",
  "Node.js",
  "NodeJs",
  "react",
  "ReactJS",
  "NextJS",
  "PHP",
  "php",
  "NestJS",
  "angular",
  "Angular",
  "nest.js",
  "next.js",
  "keystone.js",
  "KeystoneJs",
  "typescript",
  "Typescript",
];

// ── Influencer Monitoring Alarms ─────────────────────────────────────────

const TIER_ALARM_CONFIG = {
  1: { name: 'influencer-check-tier-1', periodInMinutes: 30 },   // 30 minutes
  2: { name: 'influencer-check-tier-2', periodInMinutes: 120 },  // 2 hours
  3: { name: 'influencer-check-tier-3', periodInMinutes: 360 },  // 6 hours
};

// Profile visits run automatically every 4 hours during working hours (8–22)
const PROFILE_VISIT_ALARM = 'influencer-profile-visits';
const PROFILE_VISIT_INTERVAL_MIN = 240; // 4 hours
const PROFILE_VISIT_STORAGE_KEY = 'profileVisitLastRun';

const LINKEDIN_FEED_URLS = [
  'https://www.linkedin.com/feed*',
  'https://www.linkedin.com/',
];

/**
 * Set up influencer monitoring alarms based on the current influencer list.
 * Only creates alarms for tiers that have at least one enabled influencer.
 */
async function setupInfluencerAlarms() {
  try {
    const data = await chrome.storage.local.get('feedScoringSettings');
    const settings = data?.feedScoringSettings || {};
    const list = settings.influencerList || [];

    for (const tier of [1, 2, 3]) {
      const config = TIER_ALARM_CONFIG[tier];
      const hasEnabled = list.some(i => i.enabled !== false && i.tier === tier);

      if (hasEnabled) {
        const existing = await chrome.alarms.get(config.name);
        if (!existing) {
          chrome.alarms.create(config.name, { periodInMinutes: config.periodInMinutes });
          console.log(`[Background] Created alarm ${config.name} (every ${config.periodInMinutes}m)`);
        }
      } else {
        await chrome.alarms.clear(config.name);
      }
    }

    // Profile visit alarm — create if any influencer has a profileUrl
    const hasProfileUrls = list.some(i => i.enabled !== false && i.profileUrl);
    if (hasProfileUrls) {
      const existing = await chrome.alarms.get(PROFILE_VISIT_ALARM);
      if (!existing) {
        chrome.alarms.create(PROFILE_VISIT_ALARM, {
          delayInMinutes: 10,  // first run 10 min after extension loads
          periodInMinutes: PROFILE_VISIT_INTERVAL_MIN,
        });
        console.log(`[Background] Created alarm ${PROFILE_VISIT_ALARM} (every ${PROFILE_VISIT_INTERVAL_MIN}m)`);
      }
    } else {
      await chrome.alarms.clear(PROFILE_VISIT_ALARM);
    }
  } catch (err) {
    console.warn('[Background] Failed to setup influencer alarms:', err.message);
  }
}

/**
 * Find an open LinkedIn feed tab and send a message to it.
 * Returns true if message was sent, false if no tab available.
 */
async function sendToLinkedInTab(message) {
  try {
    const tabs = await chrome.tabs.query({ url: LINKEDIN_FEED_URLS });
    if (tabs.length === 0) return false;

    // Prefer the active tab, otherwise use the first one
    const target = tabs.find(t => t.active) || tabs[0];
    await chrome.tabs.sendMessage(target.id, message);
    return true;
  } catch (err) {
    // Tab may have navigated away or content script not injected
    console.warn('[Background] Failed to message LinkedIn tab:', err.message);
    return false;
  }
}

/**
 * Store a deferred check so the content script can pick it up on load.
 */
async function deferInfluencerCheck(tier) {
  try {
    const data = await chrome.storage.local.get('pendingInfluencerChecks');
    const pending = data?.pendingInfluencerChecks || {};
    pending[tier] = Date.now();
    await chrome.storage.local.set({ pendingInfluencerChecks: pending });
    console.log(`[Background] Deferred Tier-${tier} check (no LinkedIn tab open)`);
  } catch (err) {
    console.warn('[Background] Failed to defer check:', err.message);
  }
}

// Handle alarm fires
chrome.alarms.onAlarm.addListener(async (alarm) => {
  // Profile visit alarm
  if (alarm.name === PROFILE_VISIT_ALARM) {
    console.log('[Background] Profile visit alarm fired');
    await maybeRunAutoProfileVisits();
    return;
  }

  // Match influencer check alarms
  const tierMatch = alarm.name.match(/^influencer-check-tier-(\d)$/);
  if (!tierMatch) return;

  const tier = parseInt(tierMatch[1], 10);
  console.log(`[Background] Alarm fired: ${alarm.name}`);

  const sent = await sendToLinkedInTab({ action: 'influencerScan', tier });
  if (!sent) {
    await deferInfluencerCheck(tier);
  }
});

/**
 * Check guards (working hours, cooldown, not already running) and run profile visits.
 */
async function maybeRunAutoProfileVisits() {
  // Guard: already running
  if (_profileVisitRunning) {
    console.log('[Background] Auto profile visits skipped — already running');
    return;
  }

  // Guard: working hours (8:00–22:00 local time)
  const hour = new Date().getHours();
  if (hour < 8 || hour >= 22) {
    console.log(`[Background] Auto profile visits skipped — outside working hours (${hour}:00)`);
    return;
  }

  // Guard: cooldown — don't run if last run was less than 3 hours ago
  try {
    const data = await chrome.storage.local.get(PROFILE_VISIT_STORAGE_KEY);
    const lastRun = data?.[PROFILE_VISIT_STORAGE_KEY] || 0;
    const elapsed = Date.now() - lastRun;
    const MIN_GAP_MS = 3 * 60 * 60 * 1000; // 3 hours
    if (elapsed < MIN_GAP_MS) {
      const minsAgo = Math.round(elapsed / 60000);
      console.log(`[Background] Auto profile visits skipped — last run ${minsAgo}m ago`);
      return;
    }
  } catch {}

  // Guard: must have at least one influencer with a profile URL
  try {
    const data = await chrome.storage.local.get('feedScoringSettings');
    const list = (data?.feedScoringSettings?.influencerList || []).filter(
      i => i.enabled !== false && i.profileUrl
    );
    if (list.length === 0) {
      console.log('[Background] Auto profile visits skipped — no influencers with profile URLs');
      return;
    }
  } catch {}

  // All guards passed — run
  console.log('[Background] Starting automatic profile visits...');
  try {
    await runProfileVisits();
  } catch (err) {
    console.warn('[Background] Automatic profile visits failed:', err.message);
  }
}

// ── Profile Visitor Orchestration ────────────────────────────────────────

let _profileVisitRunning = false;
let _profileVisitResolve = null;
let _profileVisitProgress = null;

/**
 * Build the activity feed URL for an influencer.
 * Accepts either a full profile URL or a vanity handle.
 */
function buildActivityUrl(profileUrl) {
  if (!profileUrl) return null;
  // Normalize: strip trailing slash, append /recent-activity/all/
  let base = profileUrl.replace(/\/+$/, '');
  // If it already ends with recent-activity, use as-is
  if (/\/recent-activity/i.test(base)) return base + '/';
  // If it's a full linkedin profile URL
  if (/linkedin\.com\/in\//i.test(base)) return base + '/recent-activity/all/';
  // If it's just a handle
  if (!base.includes('/')) return `https://www.linkedin.com/in/${base}/recent-activity/all/`;
  return null;
}

/**
 * Run profile visits for all enabled influencers that have a profileUrl.
 * Visits one at a time in a dedicated tab.
 */
async function runProfileVisits() {
  if (_profileVisitRunning) {
    console.log('[Background] Profile visits already running');
    return { skipped: true };
  }

  _profileVisitRunning = true;
  _profileVisitProgress = { current: 0, total: 0, results: [] };

  // Stamp the run time so auto-alarm cooldown resets (even for manual runs)
  chrome.storage.local.set({ [PROFILE_VISIT_STORAGE_KEY]: Date.now() }).catch(() => {});

  try {
    // Load influencer list
    const data = await chrome.storage.local.get('feedScoringSettings');
    const settings = data?.feedScoringSettings || {};
    const list = (settings.influencerList || []).filter(
      i => i.enabled !== false && i.profileUrl
    );

    if (list.length === 0) {
      console.log('[Background] No influencers with profile URLs');
      return { total: 0, results: [] };
    }

    _profileVisitProgress.total = list.length;
    const allResults = [];

    for (let i = 0; i < list.length; i++) {
      const inf = list[i];
      _profileVisitProgress.current = i + 1;

      const activityUrl = buildActivityUrl(inf.profileUrl);
      if (!activityUrl) {
        console.warn(`[Background] Can't build activity URL for ${inf.name}: ${inf.profileUrl}`);
        allResults.push({ influencer: inf.name, error: 'invalid profileUrl' });
        continue;
      }

      console.log(`[Background] Visiting ${inf.name} (${i + 1}/${list.length}): ${activityUrl}`);

      // Notify feed tab about progress
      broadcastToFeedTabs({
        action: 'profileVisitProgress',
        current: i + 1,
        total: list.length,
        influencerName: inf.name,
      });

      try {
        const result = await visitSingleProfile(activityUrl, inf);
        allResults.push({ influencer: inf.name, ...result });

        // Update influencer stats if we commented
        if (result.commented > 0 && inf.id) {
          // Send stat updates via storage (feedScoring reads from storage)
          broadcastToFeedTabs({
            action: 'profileVisitStatsUpdate',
            influencerId: inf.id,
            commented: result.commented,
            postsFound: result.weeklyPosts || 0,
          });
        }
      } catch (err) {
        console.warn(`[Background] Visit failed for ${inf.name}:`, err.message);
        allResults.push({ influencer: inf.name, error: err.message });
      }

      // Delay between influencers (human-like)
      if (i < list.length - 1) {
        const waitSec = 15 + Math.floor(Math.random() * 20);
        console.log(`[Background] Waiting ${waitSec}s before next profile...`);
        await new Promise(r => setTimeout(r, waitSec * 1000));
      }
    }

    _profileVisitProgress.results = allResults;

    // Notify feed tab that all visits are done
    broadcastToFeedTabs({
      action: 'profileVisitsComplete',
      results: allResults,
    });

    // Desktop notification
    const totalLiked = allResults.reduce((s, r) => s + (r.liked || 0), 0);
    const totalCommented = allResults.reduce((s, r) => s + (r.commented || 0), 0);
    chrome.notifications.create(`profile-visits-${Date.now()}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon48.png'),
      title: 'Influencer Profile Visits Complete',
      message: `Visited ${list.length} profiles: ${totalLiked} likes, ${totalCommented} comments`,
      priority: 1,
    });

    return { total: list.length, results: allResults };
  } finally {
    _profileVisitRunning = false;
  }
}

/**
 * Visit a single influencer's activity page.
 * Creates a tab, injects profileVisitor.js, waits for completion.
 */
async function visitSingleProfile(url, influencer) {
  return new Promise(async (resolve, reject) => {
    let tabId = null;
    let timeoutId = null;
    let onTabRemoved = null;
    const MAX_VISIT_MS = 5 * 60 * 1000; // 5 min max per profile

    function cleanup() {
      clearTimeout(timeoutId);
      if (onTabRemoved) {
        chrome.tabs.onRemoved.removeListener(onTabRemoved);
        onTabRemoved = null;
      }
    }

    // Set up the resolve hook so profileVisitorComplete message can resolve us
    _profileVisitResolve = (result) => {
      cleanup();
      if (tabId) chrome.tabs.remove(tabId).catch(() => {});
      resolve(result);
    };

    // Timeout
    timeoutId = setTimeout(() => {
      cleanup();
      _profileVisitResolve = null;
      if (tabId) chrome.tabs.remove(tabId).catch(() => {});
      reject(new Error('Profile visit timed out (5 min)'));
    }, MAX_VISIT_MS);

    try {
      // Create tab (not active, in background)
      const tab = await chrome.tabs.create({ url, active: false });
      tabId = tab.id;

      // If user closes the tab manually, resolve with partial result
      onTabRemoved = (closedId) => {
        if (closedId === tabId) {
          cleanup();
          _profileVisitResolve = null;
          resolve({ error: 'tab closed by user', liked: 0, commented: 0 });
        }
      };
      chrome.tabs.onRemoved.addListener(onTabRemoved);

      // Wait for tab to finish loading
      await new Promise((res) => {
        function onUpdated(id, info) {
          if (id === tabId && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(onUpdated);
            res();
          }
        }
        chrome.tabs.onUpdated.addListener(onUpdated);
      });

      // Extra wait for LinkedIn SPA to render
      await new Promise(r => setTimeout(r, 3000));

      // Inject the profile visitor script
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['feed/profileVisitor.js'],
      });

      // Now we wait for profileVisitorComplete message (handled above)
    } catch (err) {
      cleanup();
      _profileVisitResolve = null;
      if (tabId) chrome.tabs.remove(tabId).catch(() => {});
      reject(err);
    }
  });
}

/**
 * Relay an AI comment generation request to a feed tab that has feedAI loaded.
 */
async function relayAICommentRequest(postData) {
  const tabs = await chrome.tabs.query({ url: LINKEDIN_FEED_URLS });
  if (tabs.length === 0) {
    // No feed tab open — can't generate AI comment
    return null;
  }

  const target = tabs.find(t => t.active) || tabs[0];
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(target.id, {
      action: 'generateCommentForProfileVisitor',
      post: postData,
    }, (resp) => {
      if (chrome.runtime.lastError) {
        console.warn('[Background] AI relay failed:', chrome.runtime.lastError.message);
        resolve(null);
      } else {
        resolve(resp?.comment || null);
      }
    });
  });
}

/**
 * Send a message to all open LinkedIn feed tabs.
 */
async function broadcastToFeedTabs(message) {
  try {
    const tabs = await chrome.tabs.query({ url: LINKEDIN_FEED_URLS });
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, message).catch(() => {});
    }
  } catch {}
}

// ── Message Listener ─────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "applicationSent") {
    // Update statistics
    stats.totalApplied++;
    stats.sessionsApplied++;
    stats.lastApplied = new Date().toISOString();

    // Save stats to storage
    chrome.storage.local.set({ applicationStats: stats }, () => {
      console.log("Application statistics updated:", stats);
    });

    // Send notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon48.png'),
      title: "LinkedIn Auto Apply",
      message: `Application sent successfully! Total applications: ${stats.totalApplied}`,
      priority: 2,
    });

    sendResponse({ success: true });
  } else if (message.action === "getStats") {
    // Retrieve stats from storage
    chrome.storage.local.get("applicationStats", (data) => {
      if (data.applicationStats) {
        stats = data.applicationStats;
      }
      sendResponse({ stats: stats });
    });
    return true; // Required for async sendResponse
  } else if (message.action === "updateKeywords") {
    // Update job keywords
    jobKeywords = message.keywords;
    chrome.storage.local.set({ jobKeywords: jobKeywords });
    sendResponse({ success: true });
  } else if (message.action === "feedAnalysisComplete") {
    // Log feed analysis summary
    console.log("Feed analysis complete:", message.summary);
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon48.png'),
      title: "LinkedIn Feed Analysis",
      message: `Scanned ${message.summary.totalPosts} posts. Found ${message.summary.hiringPostsCount} hiring posts, ${message.summary.keywordMatchCount} keyword matches.`,
      priority: 1,
    });
    sendResponse({ success: true });
  } else if (message.action === "feedEngagementComplete") {
    console.log("Feed engagement complete:", message.stats);
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon48.png'),
      title: "LinkedIn Feed Engagement",
      message: `Liked ${message.stats.liked} posts, skipped ${message.stats.skipped}.`,
      priority: 1,
    });
    sendResponse({ success: true });
  } else if (message.action === "getKeywords") {
    // Retrieve job keywords
    chrome.storage.local.get("jobKeywords", (data) => {
      if (data.jobKeywords) {
        jobKeywords = data.jobKeywords;
      }
      sendResponse({ keywords: jobKeywords });
    });
    return true; // Required for async sendResponse

  // ── Influencer monitoring messages ──────────────────────────────────
  } else if (message.action === "influencerScanComplete") {
    const { newPosts, tier } = message;
    console.log(`[Background] Tier-${tier} scan complete: ${newPosts?.length || 0} new posts`);

    // Tier 1: fire Chrome desktop notification for each new post
    if (tier === 1 && newPosts && newPosts.length > 0) {
      if (newPosts.length === 1) {
        const p = newPosts[0];
        chrome.notifications.create(`inf-tier1-${Date.now()}`, {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icon48.png'),
          title: `New post from ${p.influencerName}`,
          message: p.contentSnippet || `${p.author} posted on LinkedIn`,
          priority: 2,
        });
      } else {
        const names = [...new Set(newPosts.map(p => p.influencerName))].join(', ');
        chrome.notifications.create(`inf-tier1-${Date.now()}`, {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icon48.png'),
          title: `${newPosts.length} new Tier-1 influencer posts`,
          message: `From: ${names}`,
          priority: 2,
        });
      }
    }

    // Tier 2: icon badge only (handled by content script updateBadges)
    // Tier 3: silent — already in state, no notification

    sendResponse({ success: true });

  } else if (message.action === "refreshInfluencerAlarms") {
    // User saved settings — recreate alarms with updated influencer list
    console.log('[Background] Refreshing influencer alarms...');
    setupInfluencerAlarms().then(() => {
      sendResponse({ success: true });
    });
    return true; // async

  } else if (message.action === "snapshotWeeklyHistory") {
    // Triggered by content script to snapshot before week rollover
    console.log('[Background] Weekly history snapshot requested');
    sendResponse({ success: true });

  // ── Profile Visitor messages ────────────────────────────────────────────

  } else if (message.action === "startProfileVisits") {
    console.log('[Background] Starting influencer profile visits...');
    runProfileVisits().then(results => {
      sendResponse({ success: true, results });
    }).catch(err => {
      console.warn('[Background] Profile visits failed:', err.message);
      sendResponse({ success: false, error: err.message });
    });
    return true; // async

  } else if (message.action === "profileVisitorGenerateComment") {
    // Relay AI comment generation to the feed tab (which has feedAI loaded)
    relayAICommentRequest(message.post).then(comment => {
      sendResponse({ comment });
    }).catch(err => {
      console.warn('[Background] AI comment relay failed:', err.message);
      sendResponse({ comment: null });
    });
    return true; // async

  } else if (message.action === "profileVisitorStatus") {
    console.log(`[Background] Profile visitor: ${message.status} @ ${message.url}`);
    sendResponse({ success: true });

  } else if (message.action === "profileVisitorComplete") {
    const r = message.results || {};
    console.log('[Background] Profile visit complete:', {
      url: r.url, liked: r.liked, commented: r.commented, errors: r.errors,
    });
    // Resolve the pending visit promise
    if (_profileVisitResolve) {
      _profileVisitResolve(r);
      _profileVisitResolve = null;
    }
    sendResponse({ success: true });

  } else if (message.action === "getProfileVisitStatus") {
    sendResponse({ running: _profileVisitRunning, progress: _profileVisitProgress });
  }
});

// ── Lifecycle ────────────────────────────────────────────────────────────

// Reset session stats when browser starts
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get("applicationStats", (data) => {
    if (data.applicationStats) {
      stats = data.applicationStats;
      stats.sessionsApplied = 0;
      chrome.storage.local.set({ applicationStats: stats });
    }
  });
  setupInfluencerAlarms();
});

// Set up alarms on install/update
chrome.runtime.onInstalled.addListener(() => {
  setupInfluencerAlarms();
});

// Initialize stats and keywords from storage when extension loads
chrome.storage.local.get(["applicationStats", "jobKeywords"], (data) => {
  if (data.applicationStats) {
    stats = data.applicationStats;
    console.log("Loaded application statistics:", stats);
  } else {
    // Initialize stats if not found
    chrome.storage.local.set({ applicationStats: stats });
  }

  if (data.jobKeywords) {
    jobKeywords = data.jobKeywords;
    console.log("Loaded job keywords:", jobKeywords);
  } else {
    // Initialize keywords if not found
    chrome.storage.local.set({ jobKeywords: jobKeywords });
  }
});

// Also set up alarms on service worker wake-up (covers restart after idle)
setupInfluencerAlarms();
