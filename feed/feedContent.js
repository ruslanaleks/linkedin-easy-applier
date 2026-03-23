// feed/feedContent.js - Entry point for feed page content script
// Enhanced initialization with error handling and module coordination

window.linkedInAutoApply = window.linkedInAutoApply || {};

(function () {
  'use strict';

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

          // Create UI buttons
          window.linkedInAutoApply.feedUI.createAnalyzeFeedButton();
          window.linkedInAutoApply.feedUI.createAutoEngageButton();
          window.linkedInAutoApply.feedUI.createSettingsButton();

          console.log('[FeedContent] Feed analyzer ready. Buttons created:');
          console.log('  - 📊 Analyze Feed: Scan and analyze posts');
          console.log('  - ❤️ Auto Engage: Auto-like and interact');
          console.log('  - ⚙️ Feed Settings: Configure engagement');

          // Show welcome notification (once per session)
          showWelcomeNotification();
        })
        .catch((err) => {
          console.error('[FeedContent] Failed to load settings:', err);
          // Create UI anyway with defaults
          window.linkedInAutoApply.feedUI.createAnalyzeFeedButton();
          window.linkedInAutoApply.feedUI.createAutoEngageButton();
          window.linkedInAutoApply.feedUI.createSettingsButton();
        });
    } else {
      console.warn('[FeedContent] loadSettings not available, creating UI with defaults...');
      window.linkedInAutoApply.feedUI.createAnalyzeFeedButton();
      window.linkedInAutoApply.feedUI.createAutoEngageButton();
      window.linkedInAutoApply.feedUI.createSettingsButton();
    }
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
        console.log('[FeedContent] 🎉 Feed Module Enhanced!');
        console.log('  New features:');
        console.log('  - Rate limiting for safe engagement');
        console.log('  - Post caching for better performance');
        console.log('  - Expandable content extraction');
        console.log('  - Real-time progress tracking');
        console.log('  - Configurable engagement settings');
        console.log('  - Anti-detection human-like delays');
        console.log('  - 115+ smart comments library');

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
