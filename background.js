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
  1: { name: 'influencer-check-tier-1', periodInMinutes: 120 },  // 2 hours
  2: { name: 'influencer-check-tier-2', periodInMinutes: 360 },  // 6 hours
  3: { name: 'influencer-check-tier-3', periodInMinutes: 720 },  // 12 hours
};

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
      type: "basic",
      iconUrl: "icon48.png",
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
      type: "basic",
      iconUrl: "icon48.png",
      title: "LinkedIn Feed Analysis",
      message: `Scanned ${message.summary.totalPosts} posts. Found ${message.summary.hiringPostsCount} hiring posts, ${message.summary.keywordMatchCount} keyword matches.`,
      priority: 1,
    });
    sendResponse({ success: true });
  } else if (message.action === "feedEngagementComplete") {
    console.log("Feed engagement complete:", message.stats);
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icon48.png",
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
          iconUrl: 'icon48.png',
          title: `New post from ${p.influencerName}`,
          message: p.contentSnippet || `${p.author} posted on LinkedIn`,
          priority: 2,
        });
      } else {
        const names = [...new Set(newPosts.map(p => p.influencerName))].join(', ');
        chrome.notifications.create(`inf-tier1-${Date.now()}`, {
          type: 'basic',
          iconUrl: 'icon48.png',
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
