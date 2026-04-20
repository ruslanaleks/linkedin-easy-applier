// feed/feedContent.js - Entry point for feed page content script
// Enhanced initialization with error handling and module coordination

window.linkedInAutoApply = window.linkedInAutoApply || {};

(function () {
  'use strict';

  let badgeInterval = null;

  /**
   * Initialize feed module
   */
  function initFeed() {
    console.log('[FeedContent] LinkedIn Feed Analyzer initializing...');

    // Check if required modules are loaded
    const requiredModules = [
      'feed',
      'feedEngagement',
      'feedUI',
    ];

    for (const module of requiredModules) {
      if (!window.linkedInAutoApply[module]) {
        console.error(`[FeedContent] Required module '${module}' not loaded. Check script order in manifest.`);
        return;
      }
    }

    // Load settings then create UI
    if (typeof window.linkedInAutoApply.loadSettings === 'function') {
      window.linkedInAutoApply.loadSettings()
        .then(() => {
          console.log('[FeedContent] Settings loaded, creating UI buttons...');
          createAllButtons();
          postInitSetup();

          // Show welcome notification (once per session)
          showWelcomeNotification();
        })
        .catch((err) => {
          console.error('[FeedContent] Failed to load settings:', err);
          createAllButtons();
          postInitSetup();
        });
    } else {
      console.warn('[FeedContent] loadSettings not available, creating UI with defaults...');
      createAllButtons();
      postInitSetup();
    }
  }

  function createAllButtons() {
    window.linkedInAutoApply.feedUI.createAnalyzeFeedButton();
    window.linkedInAutoApply.feedUI.createAutoEngageButton();
    window.linkedInAutoApply.feedUI.createSettingsButton();
    window.linkedInAutoApply.feedUI.createWeeklyReportButton();

    console.log('[FeedContent] Feed analyzer ready. Buttons created:');
    console.log('  - Analyze Feed | Auto Engage | Feed Settings | Weekly Report');
  }

  /**
   * Post-init: set up message listener, badge refresh, deferred checks.
   */
  function postInitSetup() {
    // Update badges immediately
    if (window.linkedInAutoApply.feedUI?.updateBadges) {
      window.linkedInAutoApply.feedUI.updateBadges();
    }

    // Periodic badge refresh (every 30s)
    if (!badgeInterval) {
      badgeInterval = setInterval(() => {
        if (window.linkedInAutoApply.feedUI?.updateBadges) {
          window.linkedInAutoApply.feedUI.updateBadges();
        }
      }, 30000);
    }

    // Process any deferred influencer checks
    if (window.linkedInAutoApply.feedMonitor?.processPendingChecks) {
      window.linkedInAutoApply.feedMonitor.processPendingChecks();
    }

    // Start continuous influencer monitoring (MutationObserver + periodic scan)
    if (window.linkedInAutoApply.feedMonitor?.startContinuousMonitoring) {
      window.linkedInAutoApply.feedMonitor.startContinuousMonitoring();
    }
  }

  // ── Message Listener (background → content script) ──────────────────

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'influencerScan') {
        const tier = message.tier;
        console.log(`[FeedContent] Received influencer scan request for Tier-${tier}`);

        const _monitor = window.linkedInAutoApply.feedMonitor;
        if (_monitor?.performInfluencerScan) {
          _monitor.performInfluencerScan(tier).then(result => {
            sendResponse(result);
          }).catch(err => {
            console.warn('[FeedContent] Influencer scan failed:', err.message);
            sendResponse({ newPosts: [], tier, error: err.message });
          });
          return true; // async response
        } else {
          console.warn('[FeedContent] feedMonitor not available for scan');
          sendResponse({ newPosts: [], tier, error: 'feedMonitor not loaded' });
        }

      } else if (message.action === 'generateCommentForProfileVisitor') {
        // Background relays AI comment request from profile visitor tab
        const _ai = window.linkedInAutoApply.feedAI;
        const _eng = window.linkedInAutoApply.feedEngagement;
        if (_ai?.generateAIComment) {
          _ai.generateAIComment(message.post).then(comment => {
            if (comment) {
              const cleaned = comment.replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
              sendResponse({ comment: cleaned });
            } else {
              sendResponse({ comment: null });
            }
          }).catch(err => {
            console.warn('[FeedContent] AI comment for profile visitor failed:', err.message);
            sendResponse({ comment: null });
          });
          return true; // async
        } else {
          sendResponse({ comment: null });
        }

      } else if (message.action === 'profileVisitProgress') {
        // Update UI with profile visit progress
        console.log(`[FeedContent] Profile visit: ${message.current}/${message.total} — ${message.influencerName}`);
        if (window.linkedInAutoApply.feedUI?.updateProfileVisitProgress) {
          window.linkedInAutoApply.feedUI.updateProfileVisitProgress(message);
        }

      } else if (message.action === 'profileVisitsComplete') {
        console.log('[FeedContent] All profile visits complete:', message.results);
        if (window.linkedInAutoApply.feedUI?.onProfileVisitsComplete) {
          window.linkedInAutoApply.feedUI.onProfileVisitsComplete(message.results);
        }

      } else if (message.action === 'profileVisitStatsUpdate') {
        // Update influencer stats after profile visit engagement
        const _scoring = window.linkedInAutoApply.feedScoring;
        if (_scoring?.updateInfluencerStats && message.influencerId) {
          for (let c = 0; c < (message.commented || 0); c++) {
            _scoring.updateInfluencerStats(message.influencerId, 'commented').catch(() => {});
          }
        }
      }
    });
  }

  /**
   * Show welcome notification (first time only per session)
   */
  async function showWelcomeNotification() {
    try {
      // Check if chrome.storage is available
      if (typeof chrome === 'undefined' || !chrome.storage) {
        console.warn('[FeedContent] chrome.storage not available, skipping notification');
        return;
      }

      const data = await chrome.storage.session.get('feedModuleNotified');
      if (!data.feedModuleNotified) {
        console.log('[FeedContent] Feed Module Enhanced!');
        console.log('  - Rate limiting, caching, progress tracking');
        console.log('  - Influencer monitoring with tier-based alerts');
        console.log('  - Weekly engagement report');

        await chrome.storage.session.set({ feedModuleNotified: true });
      }
    } catch (err) {
      if (err.message?.includes('Extension context invalidated') ||
          err.message?.includes('storage is not allowed')) {
        // Silently ignore - extension reloaded or wrong context
      } else {
        console.warn('[FeedContent] Notification failed:', err);
      }
    }
  }

  /**
   * Handle page navigation (SPA)
   * LinkedIn is a single-page app, so we need to reinitialize on navigation
   */
  function handleNavigation() {
    let lastUrl = location.href;

    // Use MutationObserver to detect URL changes
    const observer = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;

        // Check if we're still on a feed page
        if (isFeedPage()) {
          console.log('[FeedContent] Navigation detected, reinitializing...');
          // Buttons already exist, no need to recreate
        }
      }
    });

    observer.observe(document.body, {
      subtree: true,
      childList: true,
    });
  }

  /**
   * Check if current page is a feed page
   */
  function isFeedPage() {
    const feedPatterns = [
      /^https?:\/\/(www\.)?linkedin\.com\/feed/,
      /^https?:\/\/(www\.)?linkedin\.com\/$/,
      /^https?:\/\/(www\.)?linkedin\.com\/?$/,
    ];

    return feedPatterns.some(pattern => pattern.test(location.href));
  }

  /**
   * Cleanup on page unload
   */
  function cleanup() {
    console.log('[FeedContent] Cleaning up...');

    // Stop badge refresh
    if (badgeInterval) {
      clearInterval(badgeInterval);
      badgeInterval = null;
    }

    // Stop continuous influencer monitoring
    if (window.linkedInAutoApply.feedMonitor?.stopContinuousMonitoring) {
      window.linkedInAutoApply.feedMonitor.stopContinuousMonitoring();
    }

    // Stop any ongoing engagement
    if (window.linkedInAutoApply.feedEngagement) {
      window.linkedInAutoApply.feedEngagement.stopEngagement();
    }

    // Persist cache
    if (window.linkedInAutoApply.feed) {
      window.linkedInAutoApply.feed.persistCache();
    }

    // Remove UI buttons
    document.getElementById('linkedin-feed-analyze-btn')?.remove();
    document.getElementById('linkedin-feed-engage-btn')?.remove();
    document.getElementById('linkedin-feed-settings-btn')?.remove();
    document.getElementById('linkedin-feed-report-btn')?.remove();
  }

  // Initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFeed);
  } else {
    initFeed();
  }

  // Handle navigation
  handleNavigation();

  // Cleanup on unload
  window.addEventListener('beforeunload', cleanup);

  console.log('[FeedContent] Module loaded');
})();
