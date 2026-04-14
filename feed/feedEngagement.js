// feed/feedEngagement.js - Auto-engage with LinkedIn feed posts
// Enhanced version with safe limits, anti-detection, and human-like behavior
// LinkedIn uses obfuscated/numbered CSS classes. This scraper relies on
// data-testid, aria-label, and text-pattern matching instead.

window.linkedInAutoApply = window.linkedInAutoApply || {};

(function () {
  'use strict';

  // ── Configuration & Safety Limits ──────────────────────────────────────
  const CONFIG = {
    // Daily/hourly limits to avoid detection (conservative defaults)
    MAX_LIKES_PER_HOUR: 25,
    MAX_LIKES_PER_DAY: 100,
    MAX_COMMENTS_PER_HOUR: 20,
    MAX_COMMENTS_PER_DAY: 80,
    MAX_FOLLOWS_PER_HOUR: 20,
    MAX_FOLLOWS_PER_DAY: 60,
    MAX_REPLIES_PER_HOUR: 10,
    MAX_REPLIES_PER_DAY: 40,
    // Default action cooldown (seconds) — overridden by user setting
    DEFAULT_ACTION_COOLDOWN_SEC: 60,
    // Delay ranges are now derived from actionCooldownSec at runtime
    // Scroll behavior
    MIN_SCROLL_DELAY: 2000,
    MAX_SCROLL_DELAY: 4000,
    SCROLL_PIXELS: 600,

    // Engagement patterns (randomized)
    ENGAGEMENT_PROBABILITY: {
      like: 1.0,      // 100% chance to like qualifying posts
      comment: 0.7,   // 70% chance to comment (when enabled)
      follow: 0.3,    // 30% chance to follow author
      reply: 0.5,     // 50% chance to reply to a comment (when enabled)
    },

    // Cooldown after reaching limits
    COOLDOWN_MS: 30 * 60 * 1000, // 30 minutes

    // Session tracking
    SESSION_KEY: 'feedEngagementSession',
    DAILY_STATS_KEY: 'feedEngagementDailyStats',
  };

  // ── State Management ───────────────────────────────────────────────────
  let isEngaging = false;
  let abortController = null;

  // Rate limiting state
  let rateLimitState = {
    likesThisHour: 0,
    likesToday: 0,
    commentsThisHour: 0,
    commentsToday: 0,
    followsThisHour: 0,
    followsToday: 0,
    repliesThisHour: 0,
    repliesToday: 0,
    lastReset: Date.now(),
    lastHourReset: Date.now(),
  };

  // Current session stats
  let sessionStats = {
    liked: 0,
    commented: 0,
    replied: 0,
    followed: 0,
    skipped: 0,
    errors: 0,
    startTime: null,
    endTime: null,
  };

  // ── Utility Functions ──────────────────────────────────────────────────

  /**
   * Safe delay with abort support
   * @param {number} ms
   * @param {AbortSignal} [signal]
   * @returns {Promise<void>}
   */
  function delay(ms, signal = null) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(resolve, ms);
      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(timeout);
          reject(new Error('Aborted'));
        });
      }
    });
  }

  /**
   * Get random delay within range (for human-like behavior)
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  function randomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Delay with periodic progress heartbeat so the UI doesn't appear frozen.
   * Fires the callback every ~5 seconds with remaining time info.
   * @param {number} ms - Total delay in milliseconds
   * @param {AbortSignal} [signal] - Abort signal
   * @param {function} [onTick] - Called every 5s with { remaining, total }
   * @returns {Promise<void>}
   */
  function delayWithProgress(ms, signal = null, onTick = null) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const timeout = setTimeout(() => {
        clearInterval(ticker);
        resolve();
      }, ms);

      const ticker = onTick ? setInterval(() => {
        const elapsed = Date.now() - start;
        const remaining = Math.max(0, ms - elapsed);
        onTick({ remaining, total: ms });
      }, 1000) : null;

      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(timeout);
          if (ticker) clearInterval(ticker);
          reject(new Error('Aborted'));
        });
      }
    });
  }

  /**
   * Safe text extraction
   * @param {Element|null} el
   * @returns {string}
   */
  function safeGetText(el) {
    try {
      return el ? (el.innerText || el.textContent || '').trim() : '';
    } catch {
      return '';
    }
  }

  /**
   * Safe attribute getter
   * @param {Element|null} el
   * @param {string} attr
   * @returns {string|null}
   */
  function safeGetAttr(el, attr) {
    try {
      return el ? el.getAttribute(attr) : null;
    } catch {
      return null;
    }
  }

  /**
   * Query selector with error handling
   * @param {Element} root
   * @param {string} selector
   * @returns {Element|null}
   */
  function safeQuerySelector(root, selector) {
    try {
      return root ? root.querySelector(selector) : null;
    } catch {
      return null;
    }
  }

  /**
   * Query selector all with error handling
   * @param {Element} root
   * @param {string} selector
   * @returns {Element[]}
   */
  function safeQuerySelectorAll(root, selector) {
    try {
      return root ? Array.from(root.querySelectorAll(selector)) : [];
    } catch {
      return [];
    }
  }

  // ── Pre-filter: Engaged Posts Tracking (persistent across sessions) ────
  const ENGAGED_POSTS_KEY = 'feedEngagedPostIds';
  const ENGAGED_POSTS_MAX = 2000; // cap stored IDs to avoid unbounded growth

  /**
   * Load the set of already-engaged post IDs from storage
   * @returns {Promise<Set<string>>}
   */
  async function loadEngagedPostIds() {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage) return new Set();
      const data = await chrome.storage.local.get(ENGAGED_POSTS_KEY);
      const arr = data?.[ENGAGED_POSTS_KEY];
      return new Set(Array.isArray(arr) ? arr : []);
    } catch {
      return new Set();
    }
  }

  /**
   * Persist engaged post IDs to storage (keeps latest ENGAGED_POSTS_MAX entries)
   * @param {Set<string>} ids
   */
  async function saveEngagedPostIds(ids) {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage) return;
      let arr = Array.from(ids);
      if (arr.length > ENGAGED_POSTS_MAX) {
        arr = arr.slice(arr.length - ENGAGED_POSTS_MAX);
      }
      await chrome.storage.local.set({ [ENGAGED_POSTS_KEY]: arr });
    } catch {
      // ignore storage errors
    }
  }

  // ── Pre-filter: Timestamp Helpers ─────────────────────────────────────

  /**
   * Parse a LinkedIn relative timestamp string into an age in hours.
   * Handles: "2h", "3d", "1w", "5m", "30s", "1mo", "1y",
   *          "2 hours ago", "3 days ago", datetime ISO strings.
   * @param {string} ts
   * @returns {number|null} age in hours, or null if unparseable
   */
  function parseTimestampToHours(ts) {
    if (!ts) return null;
    const t = ts.trim().toLowerCase();

    // ISO datetime (from <time datetime="...">)
    if (t.includes('t') && t.includes('-')) {
      const d = new Date(ts);
      if (!isNaN(d.getTime())) {
        return (Date.now() - d.getTime()) / (1000 * 60 * 60);
      }
    }

    // Short form: "2h", "3d", "1w", "5m", "30s", "1mo", "1y"
    const shortMatch = t.match(/^(\d+)\s*(mo|h|d|w|m|s|y)$/);
    if (shortMatch) {
      const val = parseInt(shortMatch[1], 10);
      const unit = shortMatch[2];
      if (unit === 's') return val / 3600;
      if (unit === 'm') return val / 60;
      if (unit === 'h') return val;
      if (unit === 'd') return val * 24;
      if (unit === 'w') return val * 24 * 7;
      if (unit === 'mo') return val * 24 * 30;
      if (unit === 'y') return val * 24 * 365;
    }

    // Long form: "2 hours ago", "3 days ago"
    const longMatch = t.match(/^(\d+)\s+(second|minute|hour|day|week|month|year)s?\s*ago$/);
    if (longMatch) {
      const val = parseInt(longMatch[1], 10);
      const unit = longMatch[2];
      if (unit === 'second') return val / 3600;
      if (unit === 'minute') return val / 60;
      if (unit === 'hour') return val;
      if (unit === 'day') return val * 24;
      if (unit === 'week') return val * 24 * 7;
      if (unit === 'month') return val * 24 * 30;
      if (unit === 'year') return val * 24 * 365;
    }

    return null;
  }

  // ── Pre-filter: Repost Detection ──────────────────────────────────────

  const REPOST_SIGNALS = [
    'reposted this', 'reposted', 'shared this', 'compartió esto',
    'ha compartido', 'republicó', 'репост',
  ];

  /**
   * Check if a post DOM element is a repost (someone else's content reshared).
   * LinkedIn marks reposts with a small header like "Name reposted this".
   * @param {Element} postEl
   * @returns {boolean}
   */
  function isRepost(postEl) {
    try {
      // Strategy 1: header text within the first 200 chars of the post element
      const headerCandidates = safeQuerySelectorAll(postEl,
        '[class*="update-components-header"], [class*="feed-shared-header"], ' +
        '[class*="social-details-social-activity"], [data-testid*="header"]'
      );
      for (const el of headerCandidates) {
        const text = safeGetText(el).toLowerCase();
        if (REPOST_SIGNALS.some(sig => text.includes(sig))) return true;
      }

      // Strategy 2: check the first few spans/p in the post for repost text
      const topTexts = safeQuerySelectorAll(postEl, 'span, p').slice(0, 15);
      for (const el of topTexts) {
        const text = safeGetText(el).toLowerCase();
        if (text.length > 200) continue; // skip large blocks
        if (REPOST_SIGNALS.some(sig => text.includes(sig))) return true;
      }
    } catch {
      // ignore
    }
    return false;
  }

  // ── Pre-filter: Vacancy Detection ─────────────────────────────────────

  const VACANCY_SIGNALS = [
    'hiring', "we're hiring", 'we are hiring', 'join our team',
    'open position', 'open role', 'job opening', 'apply now',
    'come work with us', 'new opportunity', 'career opportunity',
    'estamos contratando', 'buscamos', 'vacante', 'oportunidad laboral',
    'únete a nuestro equipo', 'puesto abierto',
    '#hiring', '#opentowork', '#jobalert', '#nowhiring',
    'looking for a', 'looking to hire',
  ];

  /**
   * Check if a post is a job vacancy / hiring announcement.
   * @param {Object} post - parsed post object
   * @returns {boolean}
   */
  function isVacancy(post) {
    const text = ((post.content || '') + ' ' + (post.author || '')).toLowerCase();
    return VACANCY_SIGNALS.some(sig => text.includes(sig));
  }

  // ── Current User Detection (prevent self-engagement) ───────────────────

  let _cachedCurrentUser = null;

  /**
   * Get the current LinkedIn user's name from the page navigation.
   * Caches the result for the session.
   * @returns {string|null}
   */
  function getCurrentUserName() {
    if (_cachedCurrentUser) return _cachedCurrentUser;
    try {
      // LinkedIn nav profile link (most reliable)
      const selectors = [
        '.global-nav__me .t-16',                          // name shown under "Me"
        'img.global-nav__me-photo',                       // alt text of nav photo
        '.feed-identity-module__actor-meta a',            // left sidebar name
        '.feed-identity-module__actor-meta .t-16',
        '.artdeco-entity-lockup__title',                  // sidebar lockup
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (!el) continue;
        // For <img> use alt attribute
        const text = el.tagName === 'IMG'
          ? (el.getAttribute('alt') || '').trim()
          : (el.innerText || el.textContent || '').trim();
        if (text && text.length > 1 && text.length < 80) {
          _cachedCurrentUser = text.split('\n')[0].trim();
          console.log('[FeedEngagement] Current user detected:', _cachedCurrentUser);
          return _cachedCurrentUser;
        }
      }
    } catch (err) {
      console.warn('[FeedEngagement] getCurrentUserName error:', err.message);
    }
    return null;
  }

  /**
   * Check if a name likely matches the current user (case-insensitive, substring match)
   * @param {string} name
   * @returns {boolean}
   */
  function isSelfName(name) {
    const current = getCurrentUserName();
    if (!current || !name) return false;
    const a = current.toLowerCase().trim();
    const b = name.toLowerCase().trim();
    // Exact match or one contains the other (handles "John Doe" vs "John Doe, MBA")
    return a === b || a.includes(b) || b.includes(a);
  }

  // ── Rate Limiting & Persistence ────────────────────────────────────────

  /**
   * Load daily stats from storage
   */
  async function loadDailyStats() {
    try {
      // Check if chrome.storage is available
      if (typeof chrome === 'undefined' || !chrome.storage) {
        console.warn('[FeedEngagement] chrome.storage not available, using defaults');
        return;
      }

      const data = await chrome.storage.local.get(CONFIG.DAILY_STATS_KEY);
      if (data?.[CONFIG.DAILY_STATS_KEY]) {
        const stats = data[CONFIG.DAILY_STATS_KEY];
        const now = Date.now();
        const dayAgo = now - 24 * 60 * 60 * 1000;
        const hourAgo = now - 60 * 60 * 1000;

        // Reset if old data
        if (stats.date < dayAgo) {
          resetDailyStats();
          return;
        }

        rateLimitState = {
          likesThisHour: stats.lastHourReset < hourAgo ? 0 : (stats.likesThisHour || 0),
          likesToday: stats.likesToday || 0,
          commentsThisHour: stats.lastHourReset < hourAgo ? 0 : (stats.commentsThisHour || 0),
          commentsToday: stats.commentsToday || 0,
          followsThisHour: stats.lastHourReset < hourAgo ? 0 : (stats.followsThisHour || 0),
          followsToday: stats.followsToday || 0,
          repliesThisHour: stats.lastHourReset < hourAgo ? 0 : (stats.repliesThisHour || 0),
          repliesToday: stats.repliesToday || 0,
          lastReset: stats.date,
          lastHourReset: stats.lastHourReset < hourAgo ? now : stats.lastHourReset,
        };
      }
    } catch (err) {
      if (err.message?.includes('Extension context invalidated')) {
        console.warn('[FeedEngagement] Extension context invalidated, using defaults');
      } else {
        console.warn('[FeedEngagement] Failed to load daily stats:', err);
      }
      resetDailyStats();
    }
  }

  /**
   * Save daily stats to storage
   */
  async function saveDailyStats() {
    try {
      // Check if chrome.storage is available
      if (typeof chrome === 'undefined' || !chrome.storage) {
        return; // Silently skip if storage not available
      }

      await chrome.storage.local.set({
        [CONFIG.DAILY_STATS_KEY]: {
          date: rateLimitState.lastReset,
          lastHourReset: rateLimitState.lastHourReset,
          likesThisHour: rateLimitState.likesThisHour,
          likesToday: rateLimitState.likesToday,
          commentsThisHour: rateLimitState.commentsThisHour,
          commentsToday: rateLimitState.commentsToday,
          followsThisHour: rateLimitState.followsThisHour,
          followsToday: rateLimitState.followsToday,
          repliesThisHour: rateLimitState.repliesThisHour,
          repliesToday: rateLimitState.repliesToday,
        },
      });
    } catch (err) {
      if (err.message?.includes('Extension context invalidated')) {
        // Extension was reloaded, ignore
      } else {
        console.warn('[FeedEngagement] Failed to save daily stats:', err);
      }
    }
  }

  /**
   * Reset daily stats
   */
  function resetDailyStats() {
    rateLimitState = {
      likesThisHour: 0,
      likesToday: 0,
      commentsThisHour: 0,
      commentsToday: 0,
      followsThisHour: 0,
      followsToday: 0,
      repliesThisHour: 0,
      repliesToday: 0,
      lastReset: Date.now(),
      lastHourReset: Date.now(),
    };
    saveDailyStats();
  }

  /**
   * Check and reset hourly limits
   */
  function checkHourlyReset() {
    const now = Date.now();
    if (now - rateLimitState.lastHourReset > 60 * 60 * 1000) {
      rateLimitState.likesThisHour = 0;
      rateLimitState.commentsThisHour = 0;
      rateLimitState.followsThisHour = 0;
      rateLimitState.repliesThisHour = 0;
      rateLimitState.lastHourReset = now;
      saveDailyStats();
      console.log('[FeedEngagement] Hourly limits reset');
    }
  }

  /**
   * Check if action is within rate limits
   * @param {'like'|'comment'|'follow'} action
   * @returns {{ allowed: boolean, reason?: string, retryAfter?: number }}
   */
  function checkRateLimit(action) {
    checkHourlyReset();

    const limits = {
      like: {
        hourly: CONFIG.MAX_LIKES_PER_HOUR,
        daily: CONFIG.MAX_LIKES_PER_DAY,
        currentHourly: rateLimitState.likesThisHour,
        currentDaily: rateLimitState.likesToday,
      },
      comment: {
        hourly: CONFIG.MAX_COMMENTS_PER_HOUR,
        daily: CONFIG.MAX_COMMENTS_PER_DAY,
        currentHourly: rateLimitState.commentsThisHour,
        currentDaily: rateLimitState.commentsToday,
      },
      follow: {
        hourly: CONFIG.MAX_FOLLOWS_PER_HOUR,
        daily: CONFIG.MAX_FOLLOWS_PER_DAY,
        currentHourly: rateLimitState.followsThisHour,
        currentDaily: rateLimitState.followsToday,
      },
      reply: {
        hourly: CONFIG.MAX_REPLIES_PER_HOUR,
        daily: CONFIG.MAX_REPLIES_PER_DAY,
        currentHourly: rateLimitState.repliesThisHour,
        currentDaily: rateLimitState.repliesToday,
      },
    };

    const limit = limits[action];
    if (!limit) return { allowed: false, reason: 'Invalid action' };

    if (limit.currentHourly >= limit.hourly) {
      const retryAfter = 60 * 60 * 1000 - (Date.now() - rateLimitState.lastHourReset);
      return {
        allowed: false,
        reason: `Hourly limit reached for ${action} (${limit.currentHourly}/${limit.hourly})`,
        retryAfter: Math.max(retryAfter, 0),
      };
    }

    if (limit.currentDaily >= limit.daily) {
      const retryAfter = 24 * 60 * 60 * 1000 - (Date.now() - rateLimitState.lastReset);
      return {
        allowed: false,
        reason: `Daily limit reached for ${action} (${limit.currentDaily}/${limit.daily})`,
        retryAfter: Math.max(retryAfter, 0),
      };
    }

    return { allowed: true };
  }

  /**
   * Increment action count
   * @param {'like'|'comment'|'follow'} action
   */
  function incrementAction(action) {
    checkHourlyReset();

    switch (action) {
      case 'like':
        rateLimitState.likesThisHour++;
        rateLimitState.likesToday++;
        break;
      case 'comment':
        rateLimitState.commentsThisHour++;
        rateLimitState.commentsToday++;
        break;
      case 'follow':
        rateLimitState.followsThisHour++;
        rateLimitState.followsToday++;
        break;
      case 'reply':
        rateLimitState.repliesThisHour++;
        rateLimitState.repliesToday++;
        break;
    }

    saveDailyStats();
  }

  /**
   * Get current rate limit status
   * @returns {Object}
   */
  function getRateLimitStatus() {
    checkHourlyReset();
    return {
      likes: {
        hourly: `${rateLimitState.likesThisHour}/${CONFIG.MAX_LIKES_PER_HOUR}`,
        daily: `${rateLimitState.likesToday}/${CONFIG.MAX_LIKES_PER_DAY}`,
      },
      comments: {
        hourly: `${rateLimitState.commentsThisHour}/${CONFIG.MAX_COMMENTS_PER_HOUR}`,
        daily: `${rateLimitState.commentsToday}/${CONFIG.MAX_COMMENTS_PER_DAY}`,
      },
      follows: {
        hourly: `${rateLimitState.followsThisHour}/${CONFIG.MAX_FOLLOWS_PER_HOUR}`,
        daily: `${rateLimitState.followsToday}/${CONFIG.MAX_FOLLOWS_PER_DAY}`,
      },
      replies: {
        hourly: `${rateLimitState.repliesThisHour}/${CONFIG.MAX_REPLIES_PER_HOUR}`,
        daily: `${rateLimitState.repliesToday}/${CONFIG.MAX_REPLIES_PER_DAY}`,
      },
      cooldownActive: false,
      nextReset: new Date(rateLimitState.lastHourReset + 60 * 60 * 1000).toISOString(),
    };
  }

  // Initialize stats on load
  loadDailyStats();

  // ── Like Functionality ─────────────────────────────────────────────────

  /**
   * Find the Like button for a post element
   * @param {Element} postEl
   * @returns {Element|null}
   */
  function findLikeButton(postEl) {
    try {
      // Clickable elements — LinkedIn sometimes uses span/div instead of button
      const clickableSelector = 'button, [role="button"]';

      // Strategy 1: "no reaction" state (newer LinkedIn)
      const noReactionBtn = safeQuerySelectorAll(postEl, 'button[aria-label*="no reaction"], button[aria-label*="No reaction"], [role="button"][aria-label*="no reaction"], [role="button"][aria-label*="No reaction"]')[0];
      if (noReactionBtn) return noReactionBtn;

      // Strategy 2: Button with "React Like" or "Like" in aria-label
      const allBtns = safeQuerySelectorAll(postEl, `${clickableSelector}`);
      for (const b of allBtns) {
        const label = safeGetAttr(b, 'aria-label')?.toLowerCase() || '';
        const pressed = safeGetAttr(b, 'aria-pressed');
        // Match "like", "react like", "me gusta", "нравится" — skip already-liked
        if ((label.includes('like') || label.includes('react') || label.includes('me gusta') || label.includes('нравится')) &&
            !label.includes('liked') && !label.includes('unlike') && !label.includes('already') &&
            pressed !== 'true') {
          return b;
        }
      }

      // Strategy 3: Look for the social actions bar and find the first clickable (usually Like)
      const actionBarSelectors = [
        '[class*="social-actions"]',
        '[class*="feed-shared-social-action"]',
        '[class*="social-action"]',
        '[class*="feed-shared-social"]',
        '[data-testid*="social-action"]',
      ];
      for (const abSel of actionBarSelectors) {
        const actionBar = safeQuerySelector(postEl, abSel);
        if (actionBar) {
          const firstBtn = safeQuerySelector(actionBar, clickableSelector);
          if (firstBtn) {
            const label = safeGetAttr(firstBtn, 'aria-label')?.toLowerCase() || '';
            const pressed = safeGetAttr(firstBtn, 'aria-pressed');
            if (pressed !== 'true' && !label.includes('liked') && !label.includes('unlike')) {
              return firstBtn;
            }
          }
          break;
        }
      }
    } catch (err) {
      console.warn('[FeedEngagement] findLikeButton error:', err.message);
    }
    return null;
  }

  /**
   * Check if a post is already liked
   * @param {Element} postEl
   * @returns {boolean}
   */
  function isAlreadyLiked(postEl) {
    try {
      // Check for "no reaction" button — its presence means NOT liked
      const noReaction = safeQuerySelectorAll(postEl, 'button[aria-label*="no reaction"], button[aria-label*="No reaction"], [role="button"][aria-label*="no reaction"], [role="button"][aria-label*="No reaction"]');
      if (noReaction.length > 0) return false;

      // Check for explicit "liked" or "Unlike" labels on like-related buttons only
      const allBtns = safeQuerySelectorAll(postEl, 'button[aria-label], [role="button"][aria-label]');
      for (const b of allBtns) {
        const label = safeGetAttr(b, 'aria-label')?.toLowerCase() || '';
        // Only check buttons that are clearly the Like/reaction button
        if (label.includes('like') || label.includes('react') || label.includes('me gusta') || label.includes('нравится')) {
          if (label.includes('unlike') || label.includes('liked')) return true;
          const pressed = safeGetAttr(b, 'aria-pressed');
          if (pressed === 'true') return true;
          if (pressed === 'false') return false;
        }
      }

      // Uncertain — assume not liked to avoid skipping
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Like a single post with human-like delay
   * @param {Element} postEl
   * @param {Object} post - Parsed post data
   * @returns {Promise<boolean>}
   */
  async function likePost(postEl, post = null) {
    try {
      if (isAlreadyLiked(postEl)) {
        sessionStats.skipped++;
        return false;
      }

      // Check rate limit
      const limit = checkRateLimit('like');
      if (!limit.allowed) {
        console.warn('[FeedEngagement] Like rate limited:', limit.reason);
        sessionStats.skipped++;
        return false;
      }

      const likeBtn = findLikeButton(postEl);
      if (!likeBtn) {
        sessionStats.errors++;
        return false;
      }

      // Human-like: small delay before clicking
      await delay(randomDelay(200, 500));

      // Scroll button into view
      likeBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await delay(300);

      // Click
      likeBtn.click();

      // Track
      incrementAction('like');
      sessionStats.liked++;

      console.log('[FeedEngagement] Liked post:', post?.author || 'unknown');
      return true;
    } catch (err) {
      console.error('[FeedEngagement] likePost error:', err.message);
      sessionStats.errors++;
      return false;
    }
  }

  // ── Comment Functionality ──────────────────────────────────────────────

  /**
   * Find the Comment button for a post
   * @param {Element} postEl
   * @returns {Element|null}
   */
  function findCommentButton(postEl) {
    try {
      // Multi-language comment button labels
      const commentPatterns = ['comment', 'comentar', 'comentario', 'комментир', 'комментарий', 'комментировать'];
      // Patterns for the "N comments" count link (not the action button)
      const countPattern = /^\d+\s+(comment|comentario|комментари)/i;
      // Like-button patterns to identify the first button (so comment = next sibling)
      const likePatterns = ['like', 'react', 'me gusta', 'нравится'];

      // Clickable elements selector — LinkedIn sometimes uses span/div instead of button
      const clickableSelector = 'button, [role="button"], span[tabindex="0"], div[tabindex="0"]';

      // Broader action bar selectors — LinkedIn renames these classes periodically
      const actionBarSelectors = [
        '[class*="social-actions"]',
        '[class*="feed-shared-social-action"]',
        '[class*="social-action"]',
        '[class*="feed-shared-social"]',
        '[data-testid*="social-action"]',
      ];

      let actionBar = null;
      for (const sel of actionBarSelectors) {
        actionBar = safeQuerySelector(postEl, sel);
        if (actionBar) break;
      }

      // Strategy 1: Search within the social actions bar by label
      const searchRoots = actionBar ? [actionBar, postEl] : [postEl];

      for (const root of searchRoots) {
        const btns = safeQuerySelectorAll(root, clickableSelector);
        for (const btn of btns) {
          const label = (safeGetAttr(btn, 'aria-label') || '').toLowerCase();
          const text = safeGetText(btn).toLowerCase();
          const match = commentPatterns.some(p => label.includes(p) || text.includes(p));
          if (match && !countPattern.test(text)) {
            return btn;
          }
        }
        if (root === actionBar) continue;
      }

      // Strategy 2: Positional — Comment is the 2nd action in the social actions bar
      // (LinkedIn order: Like, Comment, Repost, Send)
      if (actionBar) {
        // Try direct children first, then nested buttons
        const barItems = safeQuerySelectorAll(actionBar, ':scope > *');
        const barBtns = barItems.length >= 3 ? barItems : safeQuerySelectorAll(actionBar, clickableSelector);

        // Find the Like button index, Comment is the next one
        for (let i = 0; i < barBtns.length; i++) {
          const el = barBtns[i];
          const btn = el.matches?.('button, [role="button"]') ? el : safeQuerySelector(el, 'button, [role="button"]');
          const target = btn || el;
          const label = (safeGetAttr(target, 'aria-label') || '').toLowerCase();
          const text = safeGetText(target).toLowerCase();
          const isLike = likePatterns.some(p => label.includes(p) || text.includes(p)) ||
                         label.includes('no reaction');
          if (isLike) {
            // Return the next sibling's clickable element
            const nextItem = barBtns[i + 1];
            if (nextItem) {
              const nextBtn = nextItem.matches?.('button, [role="button"]') ? nextItem : safeQuerySelector(nextItem, 'button, [role="button"]');
              console.log('[FeedEngagement] Found comment button via position (next after Like)');
              return nextBtn || nextItem;
            }
          }
        }
        // Fallback: just take the 2nd item if there are at least 3 (Like, Comment, Repost)
        if (barItems.length >= 3) {
          const secondItem = barItems[1];
          const secondBtn = safeQuerySelector(secondItem, 'button, [role="button"]') || secondItem;
          console.log('[FeedEngagement] Found comment button via position (2nd of', barItems.length, 'items)');
          return secondBtn;
        }
      }

      // Strategy 3: SVG icon detection — comment button typically has a chat/speech-bubble icon
      const svgs = safeQuerySelectorAll(postEl, 'svg');
      for (const svg of svgs) {
        const use = safeQuerySelector(svg, 'use');
        const href = safeGetAttr(use, 'href') || safeGetAttr(use, 'xlink:href') || '';
        if (href.includes('comment') || href.includes('speech') || href.includes('chat')) {
          // Walk up to find the clickable parent
          let parent = svg.parentElement;
          for (let d = 0; d < 5 && parent && parent !== postEl; d++) {
            if (parent.matches?.('button, [role="button"]') || parent.tagName === 'BUTTON') {
              console.log('[FeedEngagement] Found comment button via SVG icon');
              return parent;
            }
            parent = parent.parentElement;
          }
        }
      }

      // Strategy 4: Scan all clickable elements in post (broadest search)
      const allBtns = safeQuerySelectorAll(postEl, clickableSelector);
      for (const btn of allBtns) {
        const label = (safeGetAttr(btn, 'aria-label') || '').toLowerCase();
        const text = safeGetText(btn).toLowerCase();
        const match = commentPatterns.some(p => label.includes(p) || text.includes(p));
        if (match && !countPattern.test(text)) {
          return btn;
        }
      }
    } catch (err) {
      console.warn('[FeedEngagement] findCommentButton error:', err.message);
    }
    return null;
  }

  /**
   * Find the comment input box
   * @param {Element} postEl
   * @returns {Element|null}
   */
  function findCommentInput(postEl) {
    try {
      // Selectors for contenteditable elements (LinkedIn may use "true" or "plaintext-only")
      const editableSelector = '[contenteditable="true"], [contenteditable="plaintext-only"]';

      // Strategy 1: role="textbox" with contenteditable (any value)
      const tb = safeQuerySelector(postEl, '[role="textbox"][contenteditable]');
      if (tb) return tb;

      // Strategy 2: Any contenteditable div within a comment-related container
      const composerSelectors = [
        '[class*="comment-compose"]',
        '[class*="comments-comment-box"]',
        '[class*="comment-texteditor"]',
        '[class*="comments-comment-texteditor"]',
        '[class*="comment-box"]',
        '[class*="ql-editor"]',
      ];
      for (const sel of composerSelectors) {
        const composer = safeQuerySelector(postEl, sel);
        if (composer) {
          const editable = safeQuerySelector(composer, editableSelector) ||
                           safeQuerySelector(composer, '[role="textbox"]');
          if (editable) return editable;
        }
      }

      // Strategy 3: Any contenteditable div in post element
      const editable = safeQuerySelector(postEl, `div${editableSelector.split(', ')[0]}, div${editableSelector.split(', ')[1]}`);
      if (editable) return editable;

      // Strategy 4: Textarea or input (fallback)
      const textarea = safeQuerySelector(postEl, 'textarea, input[type="text"][class*="comment"]');
      if (textarea) return textarea;

      // Strategy 5: Look in modal/dialog if comment box opened in overlay
      const modal = document.querySelector('[role="dialog"], .artdeco-modal');
      if (modal) {
        const modalInput = safeQuerySelector(modal, '[role="textbox"][contenteditable], div[contenteditable="true"], div[contenteditable="plaintext-only"], textarea');
        if (modalInput) return modalInput;
      }

      return null;
    } catch (err) {
      console.error('[FeedEngagement] findCommentInput error:', err.message);
      return null;
    }
  }

  /**
   * Check if a button looks like a comment submit button (not the action bar "Comment" toggle)
   */
   /**
    * Known submit-button labels (text or aria-label) across locales
    */
   const SUBMIT_LABELS = ['post', 'post comment', 'submit comment', 'reply',
     'publicar', 'comentar', 'responder', 'comment'];

   function isSubmitButton(btn) {
    const text = safeGetText(btn).trim().toLowerCase();
    const label = (safeGetAttr(btn, 'aria-label') || '').toLowerCase();

    if (SUBMIT_LABELS.includes(text) || SUBMIT_LABELS.includes(label) ||
        label.includes('post a comment')) {
      return true;
    }

    return false;
  }

  function findCommentSubmit(postEl) {
    try {
      console.log('[FeedEngagement] Searching for submit button...');

      // Helper: search a root element for the submit button (returns even if disabled)
      function searchIn(root, label) {
        const btns = safeQuerySelectorAll(root, 'button');
        for (const btn of btns) {
          if (isSubmitButton(btn)) {
            const disabled = btn.disabled || btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true';
            console.log('[FeedEngagement] Found submit button in', label, ':', safeGetText(btn).trim(), '| disabled:', disabled);
            return btn;
          }
        }
        return null;
      }

      // Strategy 1: Walk up from the contenteditable input to find the
      // nearest form/container, then find the submit button there.
      // This is the most reliable approach regardless of class names.
      const input = safeQuerySelector(postEl, '[role="textbox"][contenteditable="true"], div[contenteditable="true"], textarea');
      if (input) {
        // Walk up through parents looking for a container that has a button
        let parent = input.parentElement;
        for (let depth = 0; depth < 8 && parent && parent !== postEl; depth++) {
          const btn = searchIn(parent, `input-ancestor-${depth}`);
          if (btn) return btn;
          parent = parent.parentElement;
        }
      }

      // Strategy 2: Look inside comment composer area by class pattern
      const composer = safeQuerySelector(postEl, '[class*="comments-comment-box"], [class*="comment-compose"], [class*="comments-comment-texteditor"]');
      if (composer) {
        const btn = searchIn(composer, 'composer');
        if (btn) return btn;
      }

      // Strategy 3: Look in the full post element
      const btn = searchIn(postEl, 'post');
      if (btn) return btn;

      // Strategy 4: Look in modal/dialog
      const modal = document.querySelector('[role="dialog"], .artdeco-modal');
      if (modal) {
        const modalBtn = searchIn(modal, 'modal');
        if (modalBtn) return modalBtn;
      }

      console.log('[FeedEngagement] Submit button not found with any strategy');
      return null;
    } catch (err) {
      console.error('[FeedEngagement] findCommentSubmit error:', err.message);
      return null;
    }
  }

  /**
   * Close the comment field by clicking the comment button again to toggle it off.
   * Used to clean up when commenting fails after the field was opened.
   * @param {Element} postEl
   */
  function closeCommentField(postEl) {
    try {
      const commentBtn = findCommentButton(postEl);
      if (commentBtn) {
        console.log('[FeedEngagement] Closing comment field to clean up...');
        commentBtn.click();
      }
    } catch (err) {
      console.warn('[FeedEngagement] closeCommentField error:', err.message);
    }
  }

  /**
   * Post a comment on a post
   * @param {Element} postEl
   * @param {string} commentText
   * @param {Object} post - Parsed post data
   * @returns {Promise<boolean>}
   */
  async function commentOnPost(postEl, commentText, post = null) {
    let commentFieldOpened = false;
    try {
      console.log('[FeedEngagement] commentOnPost starting...', {
        commentText: commentText.slice(0, 50) + '...',
        hasPostEl: !!postEl,
      });

      // Check rate limit
      const limit = checkRateLimit('comment');
      if (!limit.allowed) {
        console.warn('[FeedEngagement] Comment rate limited:', limit.reason);
        sessionStats.skipped++;
        return false;
      }

      // Find comment button (search postEl first, then parent)
      let commentBtn = findCommentButton(postEl);
      if (!commentBtn && postEl.parentElement) {
        commentBtn = findCommentButton(postEl.parentElement);
      }

      if (!commentBtn) {
        console.warn('[FeedEngagement] Comment button not found');
        sessionStats.errors++;
        return false;
      }

      // Click comment button — sometimes needs a second click to toggle open
      console.log('[FeedEngagement] Clicking comment button...');
      commentBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await delay(300);
      commentBtn.click();
      commentFieldOpened = true;
      await delay(randomDelay(1500, 2500));

      // Find input - try multiple times as it may take time to appear
      let input = null;
      const INPUT_ATTEMPTS = 8;
      for (let attempt = 0; attempt < INPUT_ATTEMPTS; attempt++) {
        // Search inside postEl, then ancestors up to 3 levels (LinkedIn may render
        // the comment composer outside the post element's subtree)
        const searchRoots = [postEl];
        let ancestor = postEl.parentElement;
        for (let lvl = 0; lvl < 3 && ancestor; lvl++) {
          searchRoots.push(ancestor);
          ancestor = ancestor.parentElement;
        }

        for (const root of searchRoots) {
          input = findCommentInput(root);
          if (input) break;
        }

        // Check document.activeElement — clicking Comment may have focused the input
        if (!input && document.activeElement) {
          const active = document.activeElement;
          const ce = active.getAttribute?.('contenteditable');
          if (ce === 'true' || ce === 'plaintext-only') {
            input = active;
          }
        }

        // Broad document scan: find the most recently visible contenteditable
        // that appeared near the comment button's viewport position
        if (!input) {
          const allEditable = document.querySelectorAll('[role="textbox"][contenteditable], div[contenteditable="true"], div[contenteditable="plaintext-only"]');
          if (allEditable.length > 0) {
            // Prefer one closest to the comment button vertically
            const btnRect = commentBtn.getBoundingClientRect();
            let bestDist = Infinity;
            for (const el of allEditable) {
              const rect = el.getBoundingClientRect();
              // Must be visible (non-zero size)
              if (rect.width === 0 || rect.height === 0) continue;
              const dist = Math.abs(rect.top - btnRect.bottom);
              if (dist < bestDist) {
                bestDist = dist;
                input = el;
              }
            }
            // Only accept if reasonably close (within 500px)
            if (bestDist > 500) input = null;
          }
        }

        if (input) break;

        // After first failed attempt, try clicking comment button again (toggle issue)
        if (attempt === 2) {
          console.log('[FeedEngagement] Re-clicking comment button...');
          commentBtn.click();
          await delay(randomDelay(1500, 2500));
        } else {
          await delay(1000);
        }
      }

      if (!input) {
        console.error('[FeedEngagement] Comment input not found after', INPUT_ATTEMPTS, 'attempts');
        closeCommentField(postEl);
        sessionStats.errors++;
        return false;
      }

      console.log('[FeedEngagement] Comment input found:', {
        tagName: input.tagName,
        type: input.type || 'N/A',
        contenteditable: input.getAttribute('contenteditable'),
      });

      // Focus and type
      input.focus();
      input.dispatchEvent(new Event('focus', { bubbles: true }));
      await delay(300);

      // Clear existing content
      if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
        input.value = '';
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
      } else if (input.hasAttribute('contenteditable')) {
        // Select all and delete so the editor's internal state stays in sync
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
      }
      await delay(200);

      console.log('[FeedEngagement] Typing comment...');

      if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
        // For standard form elements, set value directly
        for (let i = 0; i < commentText.length; i++) {
          const char = commentText[i];
          input.value += char;
          input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: char }));
          await delay(randomDelay(50, 150));
        }
      } else {
        // For contenteditable (LinkedIn's editor): simulate realistic key events
        // per character so LinkedIn's React/Prosemirror editor detects the change
        input.focus();
        for (let i = 0; i < commentText.length; i++) {
          const char = commentText[i];

          // Dispatch keydown/keypress before inserting
          input.dispatchEvent(new KeyboardEvent('keydown', { key: char, code: 'Key' + char.toUpperCase(), bubbles: true, cancelable: true }));
          input.dispatchEvent(new KeyboardEvent('keypress', { key: char, code: 'Key' + char.toUpperCase(), bubbles: true, cancelable: true }));

          // Primary: execCommand (still the most reliable for contenteditable)
          document.execCommand('insertText', false, char);

          // Also dispatch beforeinput + input (React 17+ listens on these)
          input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: char }));
          input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: char }));

          // keyup completes the keystroke
          input.dispatchEvent(new KeyboardEvent('keyup', { key: char, code: 'Key' + char.toUpperCase(), bubbles: true }));

          await delay(randomDelay(50, 150));
        }
      }

      // Fire comprehensive post-typing events so LinkedIn's framework picks up the change
      input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: commentText }));
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: commentText }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      // compositionend helps editors that rely on IME lifecycle
      input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: commentText }));

      console.log('[FeedEngagement] Comment typed, waiting for submit button to be enabled...');
      await delay(randomDelay(800, 1500));

      // Submit - find submit button and wait for it to become enabled
      let submitBtn = null;
      let submitReady = false;
      for (let attempt = 0; attempt < 10; attempt++) {
        submitBtn = findCommentSubmit(postEl);

        if (submitBtn) {
          const isDisabled = submitBtn.disabled || submitBtn.hasAttribute('disabled');
          const isAriaDisabled = submitBtn.getAttribute('aria-disabled') === 'true';

          console.log('[FeedEngagement] Submit button attempt', attempt + 1, ':', {
            disabled: isDisabled,
            ariaDisabled: isAriaDisabled,
          });

          if (!isDisabled && !isAriaDisabled) {
            submitReady = true;
            break;
          }

          // Button found but still disabled — re-focus the input and fire events
          // to nudge LinkedIn's editor into re-evaluating the button state
          input.focus();
          // Append + remove a space to force a state change cycle
          document.execCommand('insertText', false, ' ');
          await delay(100);
          document.execCommand('delete', false, null);
          input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
          await delay(100);
          // Also fire on the input directly (not just activeElement)
          input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: commentText }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          console.log('[FeedEngagement] Submit button attempt', attempt + 1, ': not found yet');
        }

        await delay(600);
      }

      if (!submitReady) {
        console.error('[FeedEngagement] Comment submit button not ready after 10 attempts');
        closeCommentField(postEl);
        sessionStats.errors++;
        return false;
      }

      // Click submit with full pointer + mouse event sequence
      console.log('[FeedEngagement] Clicking submit button...');
      submitBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await delay(300);
      // Pointer events (LinkedIn may use these instead of mouse events)
      submitBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      submitBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await delay(50);
      submitBtn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
      submitBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      submitBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      submitBtn.click(); // fallback native click
      await delay(randomDelay(1500, 2500));

      // Track
      incrementAction('comment');
      sessionStats.commented++;

      console.log('[FeedEngagement] ✓ Comment posted successfully!');
      return true;
    } catch (err) {
      console.error('[FeedEngagement] commentOnPost error:', err.message, err.stack);
      if (commentFieldOpened) {
        closeCommentField(postEl);
      }
      sessionStats.errors++;
      return false;
    }
  }

  // ── Comment Library ────────────────────────────────────────────────────
  // Extended library of professional comments for various post types

  const COMMENT_LIBRARY = {
    hiring: [
      'what an incredible opportunity, wishing the best!',
      'this role truly excites me!',
      'love seeing teams grow like this!',
      'someone will be so lucky to land this!',
      'the passion behind this hire really shows!',
      'can feel the energy in this opportunity!',
      'this is going to attract amazing talent!',
      'genuinely inspiring role, rooting for you!',
    ],

    achievement: [
      'this genuinely made my day, congrats!',
      'the dedication behind this is so inspiring!',
      'absolutely incredible milestone!',
      'so deeply deserved, what a journey!',
      'this fills me with so much admiration!',
      'hard work shining through, beautiful to see!',
      'moments like these remind me why I love this!',
      'what a powerful achievement, truly moving!',
    ],

    learning: [
      'this hit me right where I needed it!',
      'genuinely grateful for sharing this wisdom!',
      'my mind is buzzing after reading this!',
      'saving this, it really resonated deeply!',
      'the clarity here is absolutely refreshing!',
      'this perspective just shifted something in me!',
      'rarely does a post move me this much!',
      'what a gift to stumble upon this insight!',
    ],

    company: [
      'the energy behind this growth is contagious!',
      'genuinely moved by what this team built!',
      'this kind of progress gives me chills!',
      'so inspired by the momentum here!',
      'watching this unfold is truly exciting!',
      'the heart poured into this is visible!',
      'what a beautiful trajectory to witness!',
      'this team is on fire, love it!',
    ],

    launch: [
      'the excitement around this is so well deserved!',
      'this launch genuinely thrills me!',
      'can feel the passion in every detail!',
      'the world needed this, perfect timing!',
      'love the care put into this release!',
      'this is going to make real waves!',
      'brilliantly executed, can feel the dedication!',
      'so proud to see this come to life!',
    ],

    insight: [
      'this gave me actual goosebumps!',
      'the depth of thinking here is remarkable!',
      'rarely see analysis this powerful!',
      'this perspective genuinely moved me!',
      'absolutely brilliant framing of the issue!',
      'my heart and mind both agree with this!',
      'this is the kind of thinking we need more of!',
      'deeply resonated, what a thoughtful take!',
    ],

    gratitude: [
      'this warmth is exactly what we need!',
      'reading this filled my heart completely!',
      'the sincerity here is so touching!',
      'genuinely moved by these words!',
      'beautiful reminder of what truly matters!',
      'this radiates such genuine warmth!',
      'so refreshing, my soul needed this today!',
      'the authenticity here is truly beautiful!',
    ],

    event: [
      'the energy at this event must be incredible!',
      'so excited about the conversations happening here!',
      'this lineup genuinely thrills me!',
      'wish I could feel that energy in person!',
      'what an inspiring gathering of minds!',
      'the passion behind this event really shows!',
      'love seeing the community come alive like this!',
      'this is going to spark amazing connections!',
    ],

    personal: [
      'this vulnerability is incredibly brave, respect!',
      'genuinely touched by your honesty here!',
      'your courage to share this inspires me deeply!',
      'this rawness hits different, truly moving!',
      'so much respect for this level of openness!',
      'reading this gave me actual chills!',
      'your authenticity is a gift to this community!',
      'deeply moved, your story matters so much!',
    ],

    world_impact: [
      'the ripple effect here gives me so much hope!',
      'this could genuinely change everything!',
      'feeling deeply optimistic about this impact!',
      'the scale of this possibility is breathtaking!',
      'this is the kind of change that moves me!',
      'so inspired by the potential here!',
      'what a powerful force for real transformation!',
      'this impact will compound beautifully over time!',
    ],

    innovation: [
      'this breakthrough genuinely excites me!',
      'the elegance of this solution is stunning!',
      'can feel the paradigm shifting in real time!',
      'this unlocks so many possibilities, love it!',
      'brilliantly solving what others thought impossible!',
      'the ingenuity here gives me real hope!',
      'this is the innovation I have been waiting for!',
      'absolutely thrilling to see this emerge!',
    ],

    general: [
      'this really spoke to me, deeply!',
      'love the energy and thought behind this!',
      'genuinely grateful you shared this!',
      'this resonates on such a deep level!',
      'what a powerful perspective, truly!',
      'my heart says yes to every word!',
      'this is exactly what my feed needed!',
      'so moved by this, saving it!',
      'the passion here is truly infectious!',
      'this sparked something real in me!',
    ],
  };

  // ── Russian Comment Library ──────────────────────────────────────────
  const COMMENT_LIBRARY_RU = {
    hiring: [
      'какая потрясающая возможность, искренне желаю успехов!',
      'эта роль по-настоящему вдохновляет!',
      'кому-то очень повезёт с этой позицией!',
      'чувствуется энергия команды, это заражает!',
      'страсть к делу видна в каждом слове!',
      'такая вакансия притянет лучших!',
      'искренне восхищаюсь подходом к найму!',
      'болею за вас, найдёте идеального кандидата!',
    ],

    achievement: [
      'это искренне сделало мой день!',
      'какое вдохновляющее достижение!',
      'сердце радуется за вас!',
      'по-настоящему заслуженный результат!',
      'восхищаюсь силой духа за этим!',
      'такие моменты напоминают зачем мы работаем!',
      'эмоции зашкаливают, поздравляю!',
      'это просто невероятно, душа поёт!',
    ],

    learning: [
      'это попало прямо в точку!',
      'искренне благодарен за эту мудрость!',
      'голова кипит от идей после прочтения!',
      'сохраняю, это задело глубоко!',
      'такая ясность мысли вдохновляет!',
      'этот взгляд реально перевернул моё понимание!',
      'редко посты так трогают!',
      'какой подарок наткнуться на это!',
    ],

    company: [
      'энергия этого роста заражает!',
      'искренне восхищаюсь тем что команда построила!',
      'мурашки по коже от такого прогресса!',
      'вдохновляюсь этой динамикой!',
      'наблюдать за этим по-настоящему волнующе!',
      'душа вложенная в дело видна!',
      'какая красивая траектория развития!',
      'команда горит, это видно!',
    ],

    launch: [
      'восторг от этого запуска заслужен!',
      'этот релиз искренне радует!',
      'страсть чувствуется в каждой детали!',
      'миру это было нужно!',
      'любовь к деталям видна сразу!',
      'это вызовет настоящую волну!',
      'блестящая реализация, чувствуется самоотдача!',
      'горжусь что это увидело свет!',
    ],

    insight: [
      'мурашки по коже от этого анализа!',
      'глубина мысли поражает!',
      'редко встречаешь такой мощный разбор!',
      'эта мысль искренне задела!',
      'блестящая подача темы!',
      'сердце и ум согласны с этим!',
      'именно такое мышление нам нужно!',
      'глубоко откликнулось!',
    ],

    gratitude: [
      'это тепло именно то что нужно!',
      'сердце наполнилось после прочтения!',
      'искренность трогает до глубины!',
      'искренне тронут этими словами!',
      'красивое напоминание о главном!',
      'от этого идёт настоящее тепло!',
      'душе это было нужно сегодня!',
      'подлинность чувств прекрасна!',
    ],

    event: [
      'энергия этого события заражает!',
      'предвкушаю разговоры которые там будут!',
      'этот состав искренне волнует!',
      'хочется почувствовать эту атмосферу!',
      'вдохновляющее собрание умов!',
      'страсть организаторов чувствуется!',
      'сообщество оживает, это прекрасно!',
      'здесь родятся невероятные связи!',
    ],

    personal: [
      'эта искренность требует настоящей смелости!',
      'до глубины тронут вашей честностью!',
      'ваша смелость вдохновляет глубоко!',
      'это зацепило по-настоящему!',
      'огромное уважение за открытость!',
      'читаю и мурашки по коже!',
      'ваша подлинность бесценна!',
      'глубоко тронут, ваша история важна!',
    ],

    world_impact: [
      'каскадный эффект даёт столько надежды!',
      'это может изменить всё!',
      'глубокий оптимизм от этого влияния!',
      'масштаб возможностей захватывает дух!',
      'такие перемены волнуют по-настоящему!',
      'вдохновляюсь потенциалом!',
      'какая мощная сила трансформации!',
      'эффект будет накапливаться красиво!',
    ],

    innovation: [
      'этот прорыв искренне волнует!',
      'элегантность решения поражает!',
      'парадигма меняется на глазах!',
      'это открывает столько возможностей!',
      'блестяще решает невозможное!',
      'изобретательность даёт надежду!',
      'именно таких инноваций ждал!',
      'волнующе наблюдать как это появляется!',
    ],

    general: [
      'это задело глубоко!',
      'энергия этого поста заражает!',
      'искренне благодарен что поделились!',
      'это откликается на глубинном уровне!',
      'какая мощная мысль!',
      'сердце говорит да каждому слову!',
      'именно это было нужно моей ленте!',
      'глубоко тронут, сохраняю!',
      'страсть здесь заразительна!',
      'это зажгло что-то настоящее во мне!',
    ],
  };

  // ── Reply Library (eye-catching, discussion-provoking) ──────────────────
  const REPLY_LIBRARY = {
    hiring: [
      'Have you considered what makes this role different from similar listings flooding LinkedIn right now?',
      'The real question is retention. What keeps people once they join?',
      'Interesting role, but the best hires often come from unexpected backgrounds.',
      'Salary transparency would make this stand out instantly.',
      'Curious if this is backfill or new headcount. That tells a lot.',
    ],
    achievement: [
      'The part nobody talks about is what you had to sacrifice to get here.',
      'Most people see the result. Few appreciate the failed attempts behind it.',
      'This is proof that consistency beats talent every single time.',
      'Genuine question, what would you do differently if you started over?',
      'The compound effect is real. Small wins like these add up fast.',
    ],
    learning: [
      'Counterpoint, this works in theory but execution is where most teams fail.',
      'The real lesson here is between the lines. Context matters more than the tactic.',
      'This flips conventional wisdom on its head and I think you are right.',
      'Most people will read this and nod. Few will actually implement it.',
      'The gap between knowing this and doing it is where all the value lives.',
    ],
    company: [
      'Growth numbers are great, but culture at scale is the real test.',
      'The hidden metric here is how the team held up under pressure.',
      'What got you here will not get you to the next stage. That is the hard part.',
      'Speed of execution is a moat most companies underestimate.',
      'The real competitive advantage is the team, not the product.',
    ],
    launch: [
      'First-mover advantage is overrated. Timing and execution win every time.',
      'The distribution strategy matters more than the product itself right now.',
      'Bold move launching now. The market timing could be perfect.',
      'What is the one feature that almost did not make it into v1?',
      'Most launches fail at go-to-market, not at product. This looks different.',
    ],
    insight: [
      'This is the kind of analysis that should have way more engagement.',
      'Playing devil is advocate here, what if the data tells a different story next quarter?',
      'The second-order effects you are hinting at are the real story.',
      'Most market takes age badly. This one has legs.',
      'Nuanced take. The industry needs more of this and less hot takes.',
    ],
    gratitude: [
      'The people who shaped us rarely know the full impact they had.',
      'Vulnerability like this builds more trust than any corporate post ever could.',
      'This is the kind of post that reminds people why they are on LinkedIn.',
      'Gratitude compounds. The more you practice it the more you notice.',
    ],
    event: [
      'The hallway conversations at these events are worth more than the talks.',
      'Who is speaking that attendees should absolutely not miss?',
      'The real ROI of events is the relationships, not the content.',
      'Hot take, most conference talks could be blog posts. The networking is the point.',
    ],
    personal: [
      'It takes real courage to share this publicly. Respect.',
      'The messiest chapters often teach the most. Thanks for not polishing it.',
      'More people relate to this than will ever comment. You just helped someone.',
      'Raw honesty like this cuts through the LinkedIn noise instantly.',
    ],
    world_impact: [
      'The downstream effects of this will be visible in 5 years, not 5 months.',
      'Everyone focuses on the headline impact. The systemic shift underneath is bigger.',
      'This changes the incentive structure entirely and few people realize it yet.',
      'The scale at which this compounds is what makes it genuinely dangerous.',
    ],
    innovation: [
      'The non-obvious application is where the real disruption will come from.',
      'This solves the constraint, not the symptom. That is rare and important.',
      'Timing is everything. This would have failed 3 years ago.',
      'The bottleneck was never the tech. It was adoption. This changes that.',
    ],
    general: [
      'This deserves way more visibility than it is getting.',
      'Genuine question, what made you think about this differently?',
      'The part most people will miss here is actually the most important.',
      'Bold take. I have seen the opposite play out, but your logic is sound.',
      'This challenges the default assumption and I think that is the point.',
      'Saving this. The signal-to-noise ratio here is rare for LinkedIn.',
      'The real question this raises is what changes next because of it.',
      'Respectfully disagree with one part, but the core thesis is strong.',
    ],
  };

  const REPLY_LIBRARY_RU = {
    hiring: [
      'А чем эта роль реально отличается от десятков похожих вакансий в ленте?',
      'Ключевой вопрос не найм, а удержание. Что держит людей в команде?',
      'Лучшие кандидаты часто приходят из совершенно неожиданных сфер.',
      'Прозрачность по зарплате сразу выделила бы эту вакансию.',
      'Это бэкфилл или новая позиция? Разница говорит о многом.',
    ],
    achievement: [
      'Мало кто говорит о том, чем пришлось пожертвовать ради этого результата.',
      'Люди видят итог. Мало кто ценит провалы, которые к нему привели.',
      'Доказательство того, что стабильность важнее таланта.',
      'Честный вопрос, что бы сделали иначе, если начать заново?',
      'Эффект накопления реален. Маленькие победы складываются быстро.',
    ],
    learning: [
      'Контраргумент, в теории работает, но на практике большинство команд ломаются.',
      'Настоящий урок тут между строк. Контекст важнее самого приёма.',
      'Это переворачивает привычную логику с ног на голову. И похоже вы правы.',
      'Большинство прочитает и кивнёт. Единицы реально внедрят.',
      'Между знать и делать вся ценность.',
    ],
    company: [
      'Рост в цифрах это хорошо, но культура при масштабировании это настоящий тест.',
      'Скрытая метрика тут, как команда выдержала давление.',
      'То что привело сюда, не приведёт на следующий этап. В этом вся сложность.',
      'Скорость исполнения, это конкурентное преимущество которое все недооценивают.',
    ],
    launch: [
      'Преимущество первого хода переоценено. Решают тайминг и исполнение.',
      'Стратегия дистрибуции сейчас важнее самого продукта.',
      'Смелый ход запускаться сейчас. Тайминг может быть идеальным.',
      'Какая фича чуть не вылетела из первой версии?',
    ],
    insight: [
      'Такой анализ заслуживает на порядок больше внимания.',
      'Адвокат дьявола, а что если данные покажут другое через квартал?',
      'Эффекты второго порядка, на которые вы намекаете, вот настоящая история.',
      'Большинство аналитических постов устаревают быстро. У этого есть потенциал.',
    ],
    gratitude: [
      'Люди, которые нас сформировали, редко знают свой полный вклад.',
      'Такая уязвимость строит больше доверия чем любой корпоративный пост.',
      'Благодарность накапливается. Чем чаще практикуешь, тем больше замечаешь.',
    ],
    event: [
      'Разговоры в кулуарах на таких мероприятиях ценнее самих докладов.',
      'Кого из спикеров точно нельзя пропустить?',
      'Настоящий ROI мероприятий это связи, а не контент.',
    ],
    personal: [
      'Нужна реальная смелость чтобы поделиться этим публично. Уважаю.',
      'Самые сложные главы учат больше всего. Спасибо что не приукрасили.',
      'Больше людей узнают себя в этом чем когда-либо напишут в комментариях.',
    ],
    world_impact: [
      'Последствия этого будут видны через 5 лет, не через 5 месяцев.',
      'Все смотрят на заголовок. Системный сдвиг под ним намного масштабнее.',
      'Это меняет структуру стимулов целиком, и мало кто это пока осознаёт.',
    ],
    innovation: [
      'Неочевидное применение, вот откуда придёт настоящий прорыв.',
      'Это решает ограничение, а не симптом. Так бывает редко.',
      'Тайминг решает всё. Три года назад это бы не взлетело.',
    ],
    general: [
      'Это заслуживает куда большего охвата.',
      'Честный вопрос, что заставило вас посмотреть на это иначе?',
      'Самое важное тут то, что большинство пропустит.',
      'Смелый тезис. Видел обратное на практике, но ваша логика убедительна.',
      'Это ставит под сомнение стандартное допущение. И в этом суть.',
      'Сохраню. Соотношение сигнала к шуму тут редкое для LinkedIn.',
      'Настоящий вопрос, который это поднимает, что меняется дальше.',
    ],
  };

  /**
   * Detect if text is primarily Russian (Cyrillic).
   * Strips URLs, hashtags, and @mentions before counting so that
   * English technical terms / links don't skew the ratio.
   */
  function isRussianText(text) {
    if (!text) return false;
    const clean = text
      .replace(/https?:\/\/\S+/g, '')
      .replace(/#\w+/g, '')
      .replace(/@\w+/g, '');
    const cyrillic = (clean.match(/[\u0400-\u04FF]/g) || []).length;
    const latin = (clean.match(/[a-zA-Z]/g) || []).length;
    // Trigger on any meaningful Cyrillic presence (≥ 10 chars)
    // even if Latin chars dominate (common in tech posts with English jargon)
    return cyrillic > 10 && cyrillic > latin * 0.3;
  }

  /**
   * Detect the primary language of text: 'en', 'ru', or 'other'.
   * Used to ensure comments/replies stay in the same language as the post.
   */
  function detectTextLanguage(text) {
    if (!text) return 'en';
    const clean = text
      .replace(/https?:\/\/\S+/g, '')
      .replace(/#\w+/g, '')
      .replace(/@\w+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!clean) return 'en';

    const cyrillic = (clean.match(/[\u0400-\u04FF]/g) || []).length;
    const latin = (clean.match(/[a-zA-Z]/g) || []).length;
    // CJK, Arabic, Devanagari, etc.
    const nonLatinNonCyrillic = (clean.match(/[^\u0000-\u024F\u0400-\u04FF\s\d.,!?;:'"()\-–—]/g) || []).length;

    const total = cyrillic + latin + nonLatinNonCyrillic;
    if (total < 5) return 'en'; // too short to tell

    if (cyrillic > 10 && cyrillic > latin * 0.3) return 'ru';
    if (nonLatinNonCyrillic > total * 0.3) return 'other';

    // Latin-based text — check for non-English latin languages
    // Spanish/Portuguese/French/German accented chars
    const accented = (clean.match(/[àáâãäåæçèéêëìíîïðñòóôõöùúûüýþÿ¿¡]/gi) || []).length;
    if (accented > 2 && accented > latin * 0.05) return 'other';

    return 'en';
  }

  /**
   * Detect post type based on content, hashtags, and context
   * @param {Object} post - Parsed post data
   * @returns {string} - Post type key
   */
  function detectPostType(post) {
    const content = (post?.content || '').toLowerCase();
    const hashtags = (post?.hashtags || []).map(h => h.toLowerCase());
    const headline = (post?.headline || '').toLowerCase();
    const text = content + ' ' + hashtags.join(' ') + ' ' + headline;

    // Hiring signals (EN + RU)
    if (/(hiring|we'?re hiring|job|position|role|opportunity|join our team|vacancy|career|now hiring|вакансия|ищем|набираем|присоединяйтесь|нанимаем|позиция|открыта вакансия|ищем в команду)/.test(text)) {
      return 'hiring';
    }

    // Achievement signals (EN + RU)
    if (/(congrat|achiev|milestone|promot|anniversary|celebrat|proud|award|won|reached|goal|success|поздравля|достижение|повышение|юбилей|награ|победа|горжусь|успех|результат|цель достигнута)/.test(text)) {
      return 'achievement';
    }

    // Learning signals (EN + RU)
    if (/(learn|article|insight|thought|perspective|teach|lesson|tip|advice|guide|tutorial|how to|урок|статья|инсайт|совет|обучение|полезно|лайфхак|гайд|разбор|как сделать)/.test(text)) {
      return 'learning';
    }

    // Company/Business signals (EN + RU)
    if (/(company|business|growth|revenue|funding|investment|expansion|team|office|new hire|компания|бизнес|рост|выручка|инвестиции|расширение|команда|офис|масштабирование)/.test(text)) {
      return 'company';
    }

    // Launch signals (EN + RU)
    if (/(launch|release|announce|new product|introducing|unveil|beta|version|ship|запуск|релиз|анонс|новый продукт|представляем|выпуск|версия|выходит)/.test(text)) {
      return 'launch';
    }

    // Industry insight signals (EN + RU)
    if (/(industry|market|trend|analysis|prediction|forecast|future|state of|report|data|research|индустрия|рынок|тренд|анализ|прогноз|будущее|отчёт|данные|исследование)/.test(text)) {
      return 'insight';
    }

    // Gratitude signals (EN + RU)
    if (/(thank|grateful|gratitude|appreciat|blessed|lucky|honored|privileged|thankful|спасибо|благодар|признателен|повезло|ценю|рад|благословлён)/.test(text)) {
      return 'gratitude';
    }

    // Event signals (EN + RU)
    if (/(event|conference|summit|webinar|workshop|meetup|convention|expo|seminar|panel|мероприятие|конференция|саммит|вебинар|воркшоп|митап|выставка|семинар|панельная дискуссия)/.test(text)) {
      return 'event';
    }

    // Personal story signals (EN + RU)
    if (/(story|journey|personal|experience|struggle|challenge|overcome|mental health|vulnerable|honest|история|путь|личный опыт|борьба|вызов|преодолел|честно|откровенно|выгорание)/.test(text)) {
      return 'personal';
    }

    // World impact / Innovation — use feedAI detector if available, else regex fallback
    const priorityTopic = window.linkedInAutoApply?.feedAI?.detectPriorityTopic?.(post);
    if (priorityTopic) return priorityTopic;

    // Default to general
    return 'general';
  }

  /**
   * Generate a relevant comment for a post using AI or comment library
   * @param {Object} post - Parsed post data
   * @returns {Promise<string|null>}
   */
  async function generateComment(post) {
    try {
      // Skip political/military topics entirely — no AI, no library fallback
      if (window.linkedInAutoApply?.feedAI?.isSensitiveTopic?.(post)) {
        console.log('[FeedEngagement] Sensitive topic (politics/military), skipping comment');
        return null;
      }

      // PRIMARY: AI generation based on post context (text + images)
      if (window.linkedInAutoApply?.feedAI) {
        try {
          const aiSettings = await window.linkedInAutoApply.feedAI.loadAPISettings();
          console.log('[FeedEngagement] Generating AI comment for post:', {
            author: post?.author,
            contentLength: (post?.content || '').length,
            hasMedia: post?.hasMedia,
          });
          const aiComment = await window.linkedInAutoApply.feedAI.generateAIComment(post, {
            analyzeImage: aiSettings?.analyzeImages !== false,
          });

          if (aiComment) {
            // Strip any remaining newlines/extra spaces to prevent blank lines in replies
            const cleaned = aiComment.replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
            console.log('[FeedEngagement] ✓ AI comment generated:', cleaned);
            return cleaned;
          }
        } catch (aiErr) {
          console.warn('[FeedEngagement] AI comment generation failed, falling back to library:', aiErr.message);
        }
      }

      // FALLBACK: static library (only when AI unavailable or fails)
      // Only use library for supported languages (EN/RU) — skip others to avoid language mismatch
      const postLang = detectTextLanguage(post?.content);
      if (postLang === 'other') {
        console.log('[FeedEngagement] Post language not EN/RU, no library fallback available, skipping comment');
        return null;
      }
      const library = postLang === 'ru' ? COMMENT_LIBRARY_RU : COMMENT_LIBRARY;
      console.log('[FeedEngagement] Using static comment library as fallback, lang:', postLang);
      const postType = detectPostType(post);
      const typeComments = library[postType] || library.general;
      const comment = typeComments[Math.floor(Math.random() * typeComments.length)];

      console.log(`[FeedEngagement] Generated ${postType} comment (library fallback): "${comment}"`);
      return comment;

    } catch (err) {
      console.warn('[FeedEngagement] generateComment error:', err.message);
      const generalComments = COMMENT_LIBRARY.general;
      return generalComments[Math.floor(Math.random() * generalComments.length)];
    }
  }

  // ── Follow Functionality ───────────────────────────────────────────────

  /**
   * Find the Follow button for a post author
   * @param {Element} postEl
   * @returns {Element|null}
   */
  function findFollowButton(postEl) {
    try {
      // Look for follow button near author card
      const profileCard = safeQuerySelector(postEl, '[aria-label*="Profile"]');
      if (!profileCard) return null;

      // Check for "Follow" button within or near profile card
      const btns = safeQuerySelectorAll(profileCard, 'button');
      for (const btn of btns) {
        const text = safeGetText(btn).toLowerCase();
        const label = (safeGetAttr(btn, 'aria-label') || '').toLowerCase();
        if ((text === 'follow' || label.includes('follow')) &&
            !text.includes('following') && !label.includes('following')) {
          return btn;
        }
      }

      // Alternative: look in the post header area
      const headerBtns = safeQuerySelectorAll(postEl, 'button[aria-label*="Follow"]');
      if (headerBtns.length > 0) return headerBtns[0];
    } catch (err) {
      console.warn('[FeedEngagement] findFollowButton error:', err.message);
    }
    return null;
  }

  /**
   * Follow a post author
   * @param {Element} postEl
   * @param {Object} post - Parsed post data
   * @returns {Promise<boolean>}
   */
  async function followAuthor(postEl, post = null) {
    try {
      // Check rate limit
      const limit = checkRateLimit('follow');
      if (!limit.allowed) {
        console.warn('[FeedEngagement] Follow rate limited:', limit.reason);
        return false;
      }

      const followBtn = findFollowButton(postEl);
      if (!followBtn) {
        return false;
      }

      // Human-like delay
      await delay(randomDelay(300, 600));

      // Scroll into view
      followBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await delay(200);

      // Click
      followBtn.click();

      // Track
      incrementAction('follow');
      sessionStats.followed++;

      console.log('[FeedEngagement] Followed:', post?.author || 'unknown');
      return true;
    } catch (err) {
      console.error('[FeedEngagement] followAuthor error:', err.message);
      sessionStats.errors++;
      return false;
    }
  }

  // ── Reply to Comments Functionality ──────────────────────────────────

  /**
   * Scrape existing comments from a post element
   * @param {Element} postEl
   * @returns {{ author: string, text: string, element: Element }[]}
   */
  function scrapeComments(postEl) {
    const comments = [];
    try {
      // Try multiple selectors for comment containers (LinkedIn changes these frequently)
      const commentSelectors = [
        'article[class*="comments-comment-item"]',
        'article[class*="comment"]',
        '[data-testid*="comment-entity"]',
        '[data-testid*="comment-item"]',
        '[data-testid*="comment"]',
        '[class*="comments-comment-item"]',
        '[class*="comments-comment-list"] > *',
        '[class*="comment-item"]',
      ];

      let commentEls = [];
      for (const sel of commentSelectors) {
        commentEls = safeQuerySelectorAll(postEl, sel);
        if (commentEls.length > 0) {
          console.log(`[FeedEngagement] Found ${commentEls.length} comments via: ${sel}`);
          break;
        }
      }

      // Broader fallback: look for elements that contain a Reply button (they're likely comments)
      if (commentEls.length === 0) {
        console.log('[FeedEngagement] No comments via selectors, trying Reply-button heuristic...');
        const allBtns = safeQuerySelectorAll(postEl, 'button');
        const replyBtns = [];
        for (const btn of allBtns) {
          const text = safeGetText(btn).toLowerCase().trim();
          const label = (safeGetAttr(btn, 'aria-label') || '').toLowerCase();
          if (text === 'reply' || text === 'responder' || text === 'ответить' ||
              label.includes('reply') || label.includes('responder') || label.includes('ответить')) {
            replyBtns.push(btn);
          }
        }
        // Walk up from each Reply button to find comment container
        for (const replyBtn of replyBtns) {
          let parent = replyBtn.parentElement;
          for (let depth = 0; depth < 6 && parent && parent !== postEl; depth++) {
            // A comment container typically has substantial text and an author link
            const hasAuthorLink = safeQuerySelector(parent, 'a[href*="/in/"]');
            const textContent = safeGetText(parent);
            if (hasAuthorLink && textContent && textContent.length >= 20) {
              commentEls.push(parent);
              break;
            }
            parent = parent.parentElement;
          }
        }
        if (commentEls.length > 0) {
          console.log(`[FeedEngagement] Found ${commentEls.length} comments via Reply-button heuristic`);
        }
      }

      for (const el of commentEls) {
        // Extract author — try multiple selectors
        const authorSelectors = [
          '[data-testid="comment-entity-name"]',
          '[class*="comments-post-meta__name-text"]',
          '[class*="comment-item__inline-show-more-text"]',
          'a[class*="comment"] span[dir="ltr"]',
          'span[class*="hoverable-link-text"]',
          'a[href*="/in/"] span[dir="ltr"]',
          'a[href*="/in/"] span',
          'a[href*="/in/"]',
        ];
        let author = 'Unknown';
        for (const sel of authorSelectors) {
          const authorEl = safeQuerySelector(el, sel);
          if (authorEl) {
            const t = safeGetText(authorEl);
            if (t && t.length > 1 && t.length < 100) {
              author = t.split('\n')[0].trim();
              break;
            }
          }
        }

        // Extract comment text — try multiple selectors
        const textSelectors = [
          '[data-testid="comment-text"]',
          '[class*="comment-item__main-content"]',
          '[class*="feed-shared-inline-show-more-text"]',
          '[class*="comments-comment-item__main-content"]',
          'span[dir="ltr"][class*="break-words"]',
          'span.break-words',
          'span[dir="ltr"]',
        ];
        let text = '';
        for (const sel of textSelectors) {
          const textEl = safeQuerySelector(el, sel);
          if (textEl) {
            const t = safeGetText(textEl);
            if (t && t.length >= 10) {
              text = t;
              break;
            }
          }
        }

        // Broader fallback for text: get all text from the element, exclude the author
        if (!text || text.length < 10) {
          const fullText = safeGetText(el);
          if (fullText && author !== 'Unknown') {
            const remaining = fullText.replace(author, '').trim();
            if (remaining.length >= 10) {
              // Take first meaningful chunk (skip action button text)
              const lines = remaining.split('\n').map(l => l.trim()).filter(l => l.length >= 10);
              if (lines.length > 0) text = lines[0];
            }
          }
        }

        if (text && text.length >= 10) {
          comments.push({ author, text, element: el });
        }
      }

      console.log(`[FeedEngagement] Scraped ${comments.length} comments from post`);
    } catch (err) {
      console.warn('[FeedEngagement] scrapeComments error:', err.message);
    }
    return comments;
  }

  /**
   * Expand the comments section of a post by clicking the comment button
   * @param {Element} postEl
   * @returns {Promise<boolean>}
   */
  async function expandComments(postEl) {
    try {
      // Check if comments are already visible
      const commentCheckSelectors = [
        'article[class*="comments-comment-item"]',
        'article[class*="comment"]',
        '[data-testid*="comment-entity"]',
        '[data-testid*="comment-item"]',
        '[class*="comments-comment-item"]',
        '[class*="comments-comments-list"]',
        '[class*="comments-comment-list"]',
        '[class*="comment-list"]',
      ];
      for (const sel of commentCheckSelectors) {
        const existing = safeQuerySelectorAll(postEl, sel);
        if (existing.length > 0) {
          console.log(`[FeedEngagement] Comments already visible via: ${sel} (${existing.length})`);
          return true;
        }
      }

      // Also check if there's a "N comments" link/button to click first
      // Search both postEl and parent (LinkedIn may render counts outside the post)
      const searchRoots = [postEl];
      if (postEl.parentElement) searchRoots.push(postEl.parentElement);
      for (const root of searchRoots) {
        const btns = safeQuerySelectorAll(root, 'button, span[role="button"]');
        for (const btn of btns) {
          const text = safeGetText(btn).toLowerCase().trim();
          // Matches "3 comments", "1 comment", "12 comentarios", "5 комментариев" etc.
          if (/^\d+\s+(comment|comentario|комментари)/i.test(text)) {
            console.log('[FeedEngagement] Clicking comments count button:', text);
            btn.click();
            await delay(randomDelay(1500, 2500));

            for (const sel of commentCheckSelectors) {
              if (safeQuerySelectorAll(postEl, sel).length > 0 ||
                  (postEl.parentElement && safeQuerySelectorAll(postEl.parentElement, sel).length > 0)) {
                console.log(`[FeedEngagement] Comments appeared after clicking count via: ${sel}`);
                return true;
              }
            }
          }
        }
      }

      // Click comment button to expand
      const commentBtn = findCommentButton(postEl);
      if (!commentBtn) {
        // Also try searching in parent element
        const parentBtn = postEl.parentElement ? findCommentButton(postEl.parentElement) : null;
        if (!parentBtn) {
          console.warn('[FeedEngagement] expandComments: comment button not found');
          return false;
        }
        // Use parentBtn
        console.log('[FeedEngagement] Found comment button in parent, clicking...');
        parentBtn.click();
        await delay(randomDelay(2000, 3500));
        return true;
      }

      console.log('[FeedEngagement] Clicking comment button to expand comments...');
      commentBtn.click();
      await delay(randomDelay(2000, 3500));

      // Verify comments appeared (retry with longer wait)
      for (let attempt = 0; attempt < 2; attempt++) {
        for (const sel of commentCheckSelectors) {
          if (safeQuerySelectorAll(postEl, sel).length > 0) {
            console.log(`[FeedEngagement] Comments appeared via: ${sel}`);
            return true;
          }
        }
        if (attempt === 0) await delay(randomDelay(1500, 2500));
      }

      console.log('[FeedEngagement] expandComments: could not verify comments appeared, proceeding anyway');
      // Even if we can't verify, the click may have worked
      return true;
    } catch (err) {
      console.warn('[FeedEngagement] expandComments error:', err.message);
      return false;
    }
  }

  /**
   * Find the Reply button for a specific comment element
   * @param {Element} commentEl
   * @returns {Element|null}
   */
  function findReplyButton(commentEl) {
    try {
      // Search within the comment element and its immediate siblings
      const searchRoots = [commentEl];
      if (commentEl.parentElement) searchRoots.push(commentEl.parentElement);

      for (const root of searchRoots) {
        const btns = safeQuerySelectorAll(root, 'button, span[role="button"]');
        for (const btn of btns) {
          const text = safeGetText(btn).toLowerCase().trim();
          const label = (safeGetAttr(btn, 'aria-label') || '').toLowerCase();

          // Exact text matches (EN/ES/RU)
          if (text === 'reply' || text === 'responder' || text === 'ответить' ||
              text === 'répondre' || text === 'antworten') {
            console.log('[FeedEngagement] Found reply button via exact text:', text);
            return btn;
          }

          // aria-label includes reply
          if (label.includes('reply') || label.includes('responder') ||
              label.includes('ответить') || label.includes('répondre') ||
              label.includes('antworten')) {
            console.log('[FeedEngagement] Found reply button via aria-label:', label);
            return btn;
          }

          // Partial text match (e.g. "Reply to John's comment")
          if (text.startsWith('reply') || label.startsWith('reply')) {
            console.log('[FeedEngagement] Found reply button via startsWith:', text || label);
            return btn;
          }
        }
        // Only check parent if commentEl itself had no match
        if (root === commentEl) continue;
      }

      console.warn('[FeedEngagement] findReplyButton: no button found in comment element');
    } catch (err) {
      console.warn('[FeedEngagement] findReplyButton error:', err.message);
    }
    return null;
  }

  /**
   * Post a reply to a comment
   * @param {Element} postEl - The parent post element
   * @param {Element} commentEl - The comment element to reply to
   * @param {string} replyText - The reply text
   * @returns {Promise<boolean>}
   */
  async function replyToComment(postEl, commentEl, replyText) {
    try {
      console.log('[FeedEngagement] replyToComment starting...', {
        replyText: replyText.slice(0, 50),
      });

      // Check rate limit
      const limit = checkRateLimit('reply');
      if (!limit.allowed) {
        console.warn('[FeedEngagement] Reply rate limited:', limit.reason);
        return false;
      }

      // Find and click Reply button on the comment
      const replyBtn = findReplyButton(commentEl);
      if (!replyBtn) {
        console.warn('[FeedEngagement] Reply button not found on comment');
        return false;
      }

      replyBtn.click();
      await delay(randomDelay(1000, 2000));

      // Find the reply input (appears within or near the comment after clicking Reply)
      let input = null;
      // Count existing textboxes before click to detect the new one
      const preExisting = safeQuerySelectorAll(postEl, '[role="textbox"][contenteditable="true"], div[contenteditable="true"]');
      const preCount = preExisting.length;

      for (let attempt = 0; attempt < 5; attempt++) {
        // Strategy 1: Look directly inside or near the comment element
        input = safeQuerySelector(commentEl, '[role="textbox"][contenteditable="true"]');
        if (!input && commentEl.parentElement) {
          input = safeQuerySelector(commentEl.parentElement, '[role="textbox"][contenteditable="true"]');
        }
        // Walk up a few levels from comment to find sibling reply box
        if (!input) {
          let parent = commentEl.parentElement;
          for (let depth = 0; depth < 4 && parent && parent !== postEl; depth++) {
            input = safeQuerySelector(parent, '[role="textbox"][contenteditable="true"]');
            if (input) break;
            parent = parent.parentElement;
          }
        }

        // Strategy 2: detect newly appeared textbox (wasn't there before Reply click)
        if (!input) {
          // Search both postEl and its parent (LinkedIn may render reply box outside post)
          const searchRoots = [postEl];
          if (postEl.parentElement) searchRoots.push(postEl.parentElement);
          for (const root of searchRoots) {
            const allEditable = safeQuerySelectorAll(root, '[role="textbox"][contenteditable="true"], div[contenteditable="true"]');
            if (allEditable.length > preCount) {
              input = allEditable[allEditable.length - 1]; // the new one
              console.log('[FeedEngagement] Found reply input via new-textbox detection');
              break;
            }
          }
        }

        // Strategy 3: last contenteditable in the post or parent (fallback)
        if (!input) {
          const searchRoots = [postEl];
          if (postEl.parentElement) searchRoots.push(postEl.parentElement);
          for (const root of searchRoots) {
            const allEditable = safeQuerySelectorAll(root, '[role="textbox"][contenteditable="true"], div[contenteditable="true"]');
            if (allEditable.length > 0) {
              input = allEditable[allEditable.length - 1];
              break;
            }
          }
        }

        if (input) {
          console.log('[FeedEngagement] Reply input found on attempt', attempt + 1);
          break;
        }
        console.log('[FeedEngagement] Reply input not found, attempt', attempt + 1, '/ 5');
        await delay(randomDelay(600, 1200));
      }

      if (!input) {
        console.error('[FeedEngagement] Reply input not found after 5 attempts');
        return false;
      }

      // Focus and type (same logic as commentOnPost)
      input.focus();
      input.dispatchEvent(new Event('focus', { bubbles: true }));
      await delay(300);

      // Clear existing content
      if (input.hasAttribute('contenteditable')) {
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
      }
      await delay(200);

      // Type character by character
      input.focus();
      for (let i = 0; i < replyText.length; i++) {
        const char = replyText[i];
        input.dispatchEvent(new KeyboardEvent('keydown', { key: char, code: 'Key' + char.toUpperCase(), bubbles: true, cancelable: true }));
        input.dispatchEvent(new KeyboardEvent('keypress', { key: char, code: 'Key' + char.toUpperCase(), bubbles: true, cancelable: true }));
        document.execCommand('insertText', false, char);
        input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: char }));
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: char }));
        input.dispatchEvent(new KeyboardEvent('keyup', { key: char, code: 'Key' + char.toUpperCase(), bubbles: true }));
        await delay(randomDelay(50, 150));
      }

      // Fire post-typing events
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: replyText }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: replyText }));

      await delay(randomDelay(800, 1500));

      // Find and click submit button
      let submitBtn = null;
      let submitReady = false;

      for (let attempt = 0; attempt < 10; attempt++) {
        // Look for submit near the reply input
        let parent = input.parentElement;
        for (let depth = 0; depth < 8 && parent && parent !== postEl; depth++) {
          const btns = safeQuerySelectorAll(parent, 'button');
          for (const btn of btns) {
            if (isSubmitButton(btn)) {
              submitBtn = btn;
              break;
            }
          }
          if (submitBtn) break;
          parent = parent.parentElement;
        }

        if (submitBtn) {
          const isDisabled = submitBtn.disabled || submitBtn.hasAttribute('disabled');
          const isAriaDisabled = submitBtn.getAttribute('aria-disabled') === 'true';

          if (!isDisabled && !isAriaDisabled) {
            submitReady = true;
            break;
          }

          // Nudge the editor
          input.focus();
          document.execCommand('insertText', false, ' ');
          await delay(100);
          document.execCommand('delete', false, null);
          input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
          await delay(100);
          input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: replyText }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          submitBtn = null; // re-search next iteration
        }

        await delay(600);
      }

      if (!submitReady) {
        console.error('[FeedEngagement] Reply submit button not ready');
        return false;
      }

      // Click submit
      submitBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await delay(300);
      submitBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      submitBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await delay(50);
      submitBtn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
      submitBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      submitBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      submitBtn.click();
      await delay(randomDelay(1500, 2500));

      // Track
      incrementAction('reply');
      sessionStats.replied++;

      console.log('[FeedEngagement] Reply posted successfully');
      return true;
    } catch (err) {
      console.error('[FeedEngagement] replyToComment error:', err.message, err.stack);
      sessionStats.errors++;
      return false;
    }
  }

  // ── Repost Functionality ────────────────────────────────────────────

  /**
   * Find the Repost/Share button for a post element.
   * LinkedIn renders a social action bar under each post with Like, Comment,
   * Repost, Send buttons. The Repost button usually contains an SVG icon and
   * text "Repost" / "Compartir" / "Репост".
   * @param {Element} postEl
   * @returns {Element|null}
   */
  function findRepostButton(postEl) {
    try {
      // Strategy 1: Look within the social actions bar (same area as Like/Comment)
      const actionBar = safeQuerySelector(postEl, '[class*="social-actions"], [class*="feed-shared-social-action"]');
      const searchRoot = actionBar || postEl;
      const btns = safeQuerySelectorAll(searchRoot, 'button');

      for (const btn of btns) {
        const label = (safeGetAttr(btn, 'aria-label') || '').toLowerCase();
        const text = safeGetText(btn).toLowerCase().trim();
        const combined = label + ' ' + text;

        // Exclude already-reposted states
        if (combined.includes('unrepost') || combined.includes('undo')) continue;

        // Match repost button — text may include a count like "Repost\n3" or "Share\n5"
        if (label.includes('repost') || label.includes('republicar') || label.includes('репост') ||
            label.includes('share') || label.includes('поделиться') ||
            text.startsWith('repost') || text.startsWith('share') ||
            text.startsWith('compartir') || text.startsWith('репост') || text.startsWith('поделиться')) {
          console.log('[FeedEngagement] Found repost button:', { label, text: text.slice(0, 30) });
          return btn;
        }
      }

      // Strategy 2: All buttons in post — look for aria-label containing "repost" or "share"
      const allBtns = safeQuerySelectorAll(postEl, 'button[aria-label]');
      for (const btn of allBtns) {
        const label = (safeGetAttr(btn, 'aria-label') || '').toLowerCase();
        if ((label.includes('repost') || label.includes('share') || label.includes('republicar') ||
            label.includes('репост') || label.includes('поделиться')) &&
            !label.includes('unrepost') && !label.includes('undo')) {
          console.log('[FeedEngagement] Found repost button via fallback:', label);
          return btn;
        }
      }

      console.log('[FeedEngagement] Repost button not found');
    } catch (err) {
      console.warn('[FeedEngagement] findRepostButton error:', err.message);
    }
    return null;
  }

  /**
   * Check if a post was already reposted by looking for undo/unrepost state
   * @param {Element} postEl
   * @returns {boolean}
   */
  function isAlreadyReposted(postEl) {
    try {
      const btns = safeQuerySelectorAll(postEl, 'button');
      for (const btn of btns) {
        const label = (safeGetAttr(btn, 'aria-label') || '').toLowerCase();
        const text = safeGetText(btn).toLowerCase().trim();
        const pressed = safeGetAttr(btn, 'aria-pressed');
        if (label.includes('unrepost') || label.includes('undo repost') || label.includes('undo share') ||
            text.includes('unrepost') || text.includes('undo repost') || text.includes('undo share')) {
          return true;
        }
        if ((label.includes('repost') || label.includes('share') ||
            text.startsWith('repost') || text.startsWith('share')) && pressed === 'true') {
          return true;
        }
      }
    } catch { /* ignore */ }
    return false;
  }

  /**
   * Find an option inside the repost dropdown.
   * After clicking the Repost button LinkedIn opens a dropdown/menu with
   * "Repost" (instant) and "Repost with your thoughts" (quote-style).
   * @param {boolean} withThoughts
   * @returns {Element|null}
   */
  function findDropdownRepostOption(withThoughts) {
    try {
      // LinkedIn dropdown/popover — try multiple container selectors
      const menuSelectors = [
        '[role="menu"]',
        '[role="listbox"]',
        '.artdeco-dropdown__content',
        '.artdeco-dropdown__content-inner',
        '[data-testid*="share-via"]',
        '[data-testid*="repost"]',
        '[class*="repost-shared"]',
        '.share-promoted-detour-v2',
        '[class*="social-actions"] [class*="dropdown"]',
        '.artdeco-modal__content',
        '[class*="share-box"]',
      ];
      let menu = null;
      for (const sel of menuSelectors) {
        menu = document.querySelector(sel);
        if (menu) {
          console.log('[FeedEngagement] Found repost dropdown via:', sel);
          break;
        }
      }
      if (!menu) {
        console.log('[FeedEngagement] No dropdown menu found, searching whole document');
        menu = document;
      }

      // Collect all clickable items
      const items = safeQuerySelectorAll(menu, '[role="menuitem"], [role="option"], li, button, div[tabindex], span[tabindex], a');

      // Log what we found for debugging
      console.log('[FeedEngagement] Dropdown items found:', items.length);
      for (const item of items) {
        const text = safeGetText(item).toLowerCase().replace(/\s+/g, ' ').trim();
        const label = (safeGetAttr(item, 'aria-label') || '').toLowerCase();
        if (text.length > 0 || label.length > 0) {
          console.log('[FeedEngagement]   item:', { text: text.slice(0, 60), label: label.slice(0, 60) });
        }
      }

      // Now match
      let instantCandidate = null;
      let thoughtsCandidate = null;

      for (const item of items) {
        const text = safeGetText(item).toLowerCase().replace(/\s+/g, ' ').trim();
        const label = (safeGetAttr(item, 'aria-label') || '').toLowerCase();
        const combined = text + ' ' + label;

        // Detect "with thoughts" / "quote" variant
        const isThoughtsOption = combined.includes('with your thoughts') || combined.includes('your thoughts') ||
            combined.includes('quote') || combined.includes('с комментарием') ||
            combined.includes('con tus pensamientos') || combined.includes('с мыслями') ||
            combined.includes('с мыслью') || combined.includes('своим мнением') ||
            combined.includes('мнением') || combined.includes('комментарий');

        // Detect any repost/share keyword
        const isRepostOption = combined.includes('repost') || combined.includes('share') ||
            combined.includes('republicar') || combined.includes('compartir') ||
            combined.includes('репост') || combined.includes('поделиться') ||
            combined.includes('сделать репост') || combined.includes('переслать');

        if (isRepostOption && isThoughtsOption && !thoughtsCandidate) {
          thoughtsCandidate = item;
        } else if (isRepostOption && !isThoughtsOption && !instantCandidate) {
          instantCandidate = item;
        }
      }

      if (withThoughts) {
        if (thoughtsCandidate) {
          console.log('[FeedEngagement] Matched "with thoughts" option');
          return thoughtsCandidate;
        }
      } else {
        if (instantCandidate) {
          console.log('[FeedEngagement] Matched instant repost option');
          return instantCandidate;
        }
      }

      // Fallback: position-based matching inside the dropdown menu.
      // LinkedIn's repost dropdown always has exactly 2 items:
      //   1st = instant repost, 2nd = repost with your thoughts.
      // This covers cases where LinkedIn changed the label text.
      if (menu !== document) {
        const clickable = safeQuerySelectorAll(menu, '[role="menuitem"], [role="option"], li > div, li > button, li > a');
        const meaningful = clickable.filter(el => {
          const t = safeGetText(el).trim();
          return t.length > 0 && t.length < 120; // real menu items, not noise
        });
        console.log('[FeedEngagement] Position fallback: found', meaningful.length, 'menu items');
        if (meaningful.length >= 2) {
          if (withThoughts) {
            console.log('[FeedEngagement] Using 2nd item as "with thoughts" (position fallback)');
            return meaningful[1];
          } else {
            console.log('[FeedEngagement] Using 1st item as instant repost (position fallback)');
            return meaningful[0];
          }
        }
        // If only one item — it's the instant repost option
        if (meaningful.length === 1 && !withThoughts) {
          console.log('[FeedEngagement] Using sole item as instant repost (position fallback)');
          return meaningful[0];
        }
      }

      console.warn(`[FeedEngagement] ${withThoughts ? '"With thoughts"' : 'Instant repost'} option not found`);
      return null;
    } catch (err) {
      console.warn('[FeedEngagement] findDropdownRepostOption error:', err.message);
    }
    return null;
  }

  /**
   * Dismiss a repost confirmation dialog if one appears
   */
  async function confirmRepostDialog() {
    await delay(500);
    try {
      const dialog = document.querySelector('[role="alertdialog"], [role="dialog"]');
      if (!dialog) return;
      const btns = safeQuerySelectorAll(dialog, 'button');
      for (const btn of btns) {
        const text = safeGetText(btn).toLowerCase().trim();
        if (text === 'repost' || text === 'share' || text === 'republicar' || text === 'compartir' ||
            text === 'репост' || text === 'поделиться' || text === 'confirm') {
          btn.click();
          await delay(500);
          return;
        }
      }
    } catch { /* ignore */ }
  }

  /**
   * Perform an instant repost (no additional text).
   * Clicks the Repost button → selects "Repost" from the dropdown.
   * @param {Element} postEl
   * @param {Object} [post] - Parsed post data (for logging)
   * @returns {Promise<boolean>}
   */
  async function repostInstant(postEl, post = null) {
    try {
      if (isAlreadyReposted(postEl)) {
        console.log('[FeedEngagement] Already reposted, skip');
        sessionStats.skipped++;
        return false;
      }

      const limit = checkRateLimit('repost');
      if (!limit.allowed) {
        console.warn('[FeedEngagement] Repost rate limited:', limit.reason);
        sessionStats.skipped++;
        return false;
      }

      const repostBtn = findRepostButton(postEl);
      if (!repostBtn) {
        console.warn('[FeedEngagement] Repost button not found');
        sessionStats.errors++;
        return false;
      }

      // Open the dropdown with full event sequence (LinkedIn React needs pointer events)
      await delay(randomDelay(300, 600));
      repostBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await delay(300);
      repostBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      repostBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await delay(50);
      repostBtn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
      repostBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      repostBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      repostBtn.click();

      // Wait for dropdown with retry — LinkedIn dropdown can be slow to render
      let option = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        await delay(attempt === 0 ? randomDelay(800, 1200) : 600);
        option = findDropdownRepostOption(false);
        if (option) break;
        console.log(`[FeedEngagement] Dropdown retry ${attempt + 1}/5...`);
      }
      if (!option) {
        console.warn('[FeedEngagement] Instant repost option not found in dropdown after retries');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        sessionStats.errors++;
        return false;
      }

      // Click dropdown option with full event sequence
      option.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await delay(50);
      option.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
      option.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      option.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      option.click();
      await delay(randomDelay(1000, 2000));
      await confirmRepostDialog();

      incrementAction('repost');
      sessionStats.reposted++;
      console.log('[FeedEngagement] ✓ Instant repost:', post?.author || 'unknown');
      return true;
    } catch (err) {
      console.error('[FeedEngagement] repostInstant error:', err.message);
      sessionStats.errors++;
      return false;
    }
  }

  /**
   * Repost with your thoughts — opens the quote editor, types the thought, submits.
   * Falls back to instant repost on failure.
   * @param {Element} postEl
   * @param {string} thought
   * @param {Object} [post]
   * @returns {Promise<boolean>}
   */
  async function repostWithThoughts(postEl, thought, post = null) {
    try {
      if (isAlreadyReposted(postEl)) {
        console.log('[FeedEngagement] Already reposted, skip');
        sessionStats.skipped++;
        return false;
      }

      const limit = checkRateLimit('repost');
      if (!limit.allowed) {
        console.warn('[FeedEngagement] Repost rate limited:', limit.reason);
        sessionStats.skipped++;
        return false;
      }

      const repostBtn = findRepostButton(postEl);
      if (!repostBtn) {
        sessionStats.errors++;
        return false;
      }

      // Open dropdown with full event sequence
      await delay(randomDelay(300, 600));
      repostBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await delay(300);
      repostBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      repostBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await delay(50);
      repostBtn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
      repostBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      repostBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      repostBtn.click();

      // Wait for dropdown with retry
      let option = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        await delay(attempt === 0 ? randomDelay(800, 1200) : 600);
        option = findDropdownRepostOption(true);
        if (option) break;
        console.log(`[FeedEngagement] Dropdown retry ${attempt + 1}/5...`);
      }
      if (!option) {
        console.warn('[FeedEngagement] "With thoughts" option not found after retries, closing dropdown');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        sessionStats.errors++;
        return false;
      }

      option.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await delay(50);
      option.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
      option.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      option.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      option.click();
      await delay(randomDelay(1500, 2500));

      // Find the text editor in the share modal
      const editorSelectors = [
        '[role="dialog"] [role="textbox"][contenteditable="true"]',
        '[role="dialog"] div[contenteditable="true"]',
        '.artdeco-modal [role="textbox"][contenteditable="true"]',
        '.share-creation-state [role="textbox"]',
      ];
      let input = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        for (const sel of editorSelectors) {
          input = document.querySelector(sel);
          if (input) break;
        }
        if (input) break;
        await delay(600);
      }

      if (!input) {
        console.error('[FeedEngagement] Repost editor not found');
        const closeBtn = document.querySelector('[role="dialog"] button[aria-label*="Dismiss"], [role="dialog"] button[aria-label*="Close"]');
        if (closeBtn) closeBtn.click();
        sessionStats.errors++;
        return false;
      }

      // Focus & clear
      input.focus();
      input.dispatchEvent(new Event('focus', { bubbles: true }));
      await delay(300);
      if (input.hasAttribute('contenteditable')) {
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
      }
      await delay(200);

      // Type character-by-character (same approach as commentOnPost)
      for (let i = 0; i < thought.length; i++) {
        const char = thought[i];
        input.dispatchEvent(new KeyboardEvent('keydown', { key: char, code: 'Key' + char.toUpperCase(), bubbles: true, cancelable: true }));
        input.dispatchEvent(new KeyboardEvent('keypress', { key: char, code: 'Key' + char.toUpperCase(), bubbles: true, cancelable: true }));
        document.execCommand('insertText', false, char);
        input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: char }));
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: char }));
        input.dispatchEvent(new KeyboardEvent('keyup', { key: char, code: 'Key' + char.toUpperCase(), bubbles: true }));
        await delay(randomDelay(30, 100));
      }

      // Post-typing events
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: thought }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: thought }));
      await delay(randomDelay(1000, 2000));

      // Find & click the Post / Repost submit button in the modal
      let submitBtn = null;
      let submitReady = false;
      for (let attempt = 0; attempt < 8; attempt++) {
        const modal = document.querySelector('[role="dialog"], .artdeco-modal');
        if (modal) {
          const btns = safeQuerySelectorAll(modal, 'button');
          for (const btn of btns) {
            const t = safeGetText(btn).toLowerCase().trim();
            const l = (safeGetAttr(btn, 'aria-label') || '').toLowerCase();
            if (t === 'post' || t === 'repost' || t === 'share' || t === 'publicar' || t === 'опубликовать' ||
                l.includes('post') || (l.includes('repost') && !l.includes('undo')) ||
                (l.includes('share') && !l.includes('undo'))) {
              submitBtn = btn;
              break;
            }
          }
        }
        if (submitBtn) {
          const disabled = submitBtn.disabled || submitBtn.hasAttribute('disabled') ||
                           submitBtn.getAttribute('aria-disabled') === 'true';
          if (!disabled) { submitReady = true; break; }
          // Nudge editor
          input.focus();
          document.execCommand('insertText', false, ' ');
          await delay(100);
          document.execCommand('delete', false, null);
          input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: thought }));
          submitBtn = null;
        }
        await delay(600);
      }

      if (!submitReady) {
        console.error('[FeedEngagement] Repost submit not ready');
        const closeBtn = document.querySelector('[role="dialog"] button[aria-label*="Dismiss"], [role="dialog"] button[aria-label*="Close"]');
        if (closeBtn) closeBtn.click();
        sessionStats.errors++;
        return false;
      }

      // Click submit with full event sequence
      submitBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await delay(300);
      submitBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      submitBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await delay(50);
      submitBtn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
      submitBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      submitBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      submitBtn.click();
      await delay(randomDelay(2000, 3000));

      incrementAction('repost');
      sessionStats.reposted++;
      console.log('[FeedEngagement] ✓ Repost with thoughts:', post?.author || 'unknown');
      return true;
    } catch (err) {
      console.error('[FeedEngagement] repostWithThoughts error:', err.message);
      try {
        const closeBtn = document.querySelector('[role="dialog"] button[aria-label*="Dismiss"], [role="dialog"] button[aria-label*="Close"]');
        if (closeBtn) closeBtn.click();
      } catch { /* ignore */ }
      sessionStats.errors++;
      return false;
    }
  }

  /**
   * Score a post for repost worthiness. Only high-quality content should be reposted.
   * @param {Object} post
   * @returns {number}
   */
  function scorePostForRepost(post) {
    let score = 0;
    const content = (post?.content || '');
    const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;

    // Hard disqualifiers
    if (window.linkedInAutoApply?.feedAI?.isSensitiveTopic?.(post)) return -100;
    if (post?.author && isSelfName(post.author)) return -100;

    // Content length — base score (most posts have 20+ words)
    if (wordCount >= 50) score += 20;
    else if (wordCount >= 30) score += 15;
    else if (wordCount >= 15) score += 5;
    else return -50; // Too short to repost

    // Engagement bonuses (additive, not required — scraper often can't read counts)
    const reactions = post?.reactions || 0;
    const comments = post?.comments || 0;
    if (reactions >= 100) score += 20;
    else if (reactions >= 20) score += 10;
    else if (reactions >= 5) score += 5;
    if (comments >= 10) score += 10;
    else if (comments >= 3) score += 5;

    // Priority topics
    const priorityTopic = window.linkedInAutoApply?.feedAI?.detectPriorityTopic?.(post);
    if (priorityTopic === 'world_impact') score += 20;
    if (priorityTopic === 'innovation') score += 20;

    // Post type bonuses
    const postType = detectPostType(post);
    const typeBonus = { hiring: 10, insight: 15, learning: 15, launch: 10, world_impact: 20, innovation: 20, achievement: 5, gratitude: -15, personal: -25, event: 5, company: 5, general: 5 };
    score += typeBonus[postType] || 0;

    if (post?.hasMedia) score += 5;
    if ((post?.hashtags || []).length >= 2) score += 5;
    score += Math.random() * 10;
    return score;
  }

  /**
   * Generate text for "Repost with your thoughts" using AI or fallback library.
   * @param {Object} post
   * @returns {Promise<string|null>}
   */
  async function generateRepostText(post) {
    try {
      if (window.linkedInAutoApply?.feedAI?.isSensitiveTopic?.(post)) return null;

      // Try AI first
      if (window.linkedInAutoApply?.feedAI?.generateRepostThought) {
        try {
          const thought = await window.linkedInAutoApply.feedAI.generateRepostThought(post);
          if (thought) {
            console.log('[FeedEngagement] ✓ AI repost thought:', thought);
            return thought.replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
          }
        } catch (err) {
          console.warn('[FeedEngagement] AI repost thought failed:', err.message);
        }
      }

      // Fallback: static library
      const postLang = detectTextLanguage(post?.content);
      if (postLang === 'other') return null;

      const REPOST_LIB = {
        hiring: ['Worth sharing for anyone exploring new roles.', 'Strong opportunity. Passing it along.'],
        insight: ['The data here tells a story most are missing.', 'Sharp analysis. My network should see this.'],
        learning: ['Practical insight worth bookmarking.', 'More people need to see this breakdown.'],
        world_impact: ['The long-term implications here are bigger than the headline.', 'Systemic shift worth watching.'],
        innovation: ['This removes a constraint worth paying attention to.', 'The timing on this could not be better.'],
        launch: ['Clean execution. The market needs this.', 'Solid launch worth following.'],
        general: ['Worth amplifying. Signal over noise.', 'This deserves a wider audience.', 'Stood out in my feed today.'],
      };
      const REPOST_LIB_RU = {
        hiring: ['Делюсь для тех, кто ищет новые возможности.', 'Сильная позиция. Передаю своей сети.'],
        insight: ['Чёткий анализ. Моей сети стоит увидеть.', 'Данные тут рассказывают важную историю.'],
        learning: ['Практичный разбор, который стоит сохранить.', 'Больше людей должны увидеть этот анализ.'],
        world_impact: ['Долгосрочные последствия масштабнее заголовка.', 'Системный сдвиг, за которым стоит следить.'],
        innovation: ['Снимает ограничение, за которым давно наблюдаю.', 'Тайминг идеальный. Стоит обратить внимание.'],
        launch: ['Чистый запуск. Рынку это нужно.', 'Хороший релиз.'],
        general: ['Делюсь, потому что заслуживает более широкой аудитории.', 'Сигнал на фоне шума.', 'Выделяется в ленте.'],
      };

      const library = postLang === 'ru' ? REPOST_LIB_RU : REPOST_LIB;
      const postType = detectPostType(post);
      const pool = library[postType] || library.general;
      return pool[Math.floor(Math.random() * pool.length)];
    } catch (err) {
      console.warn('[FeedEngagement] generateRepostText error:', err.message);
      return null;
    }
  }

  // ── Smart Comment Scoring ───────────────────────────────────────────

  /**
   * Score a comment for reply priority. Higher score = better reply target.
   * Prioritizes substantive, discussion-worthy comments over short/generic ones.
   * @param {{ author: string, text: string, element: Element }} comment
   * @returns {number}
   */
  function scoreComment(comment) {
    let score = 0;
    const text = comment.text || '';
    const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;

    // Length bonus: prefer substantive comments (10-100 words sweet spot)
    if (wordCount >= 10 && wordCount <= 100) score += 30;
    else if (wordCount >= 5 && wordCount < 10) score += 15;
    else if (wordCount > 100) score += 20;
    // Very short comments (<5 words) get no bonus

    // Question mark = asking something = great reply target
    if (/\?/.test(text)) score += 25;

    // Contains opinion/stance indicators
    if (/\b(I think|I believe|in my experience|disagree|agree but|however|counter|on the other hand|я думаю|считаю|по моему опыту|не согласен|согласен но|однако)\b/i.test(text)) {
      score += 20;
    }

    // Contains specific data/numbers = substantive
    if (/\d+%|\$\d|€\d|\d+\s*(years?|months?|лет|месяц|год)/.test(text)) {
      score += 15;
    }

    // Penalize generic/low-effort comments
    if (/^(great|nice|love this|thanks|well said|agreed|exactly|отлично|круто|спасибо|согласен|класс|топ)[.!,\s]*$/i.test(text.trim())) {
      score -= 50;
    }

    // Penalize very short comments
    if (wordCount < 3) score -= 30;

    // Small random factor to avoid always picking the same comment
    score += Math.random() * 10;

    return score;
  }

  /**
   * Select the best comment to reply to from a list
   * @param {{ author: string, text: string, element: Element }[]} comments
   * @returns {{ author: string, text: string, element: Element }|null}
   */
  function selectBestComment(comments) {
    if (comments.length === 0) return null;

    const scored = comments.map(c => ({ comment: c, score: scoreComment(c) }));
    scored.sort((a, b) => b.score - a.score);

    console.log('[FeedEngagement] Comment scores:', scored.map(s => ({
      author: s.comment.author,
      score: Math.round(s.score),
      preview: s.comment.text.slice(0, 40),
    })));

    // Only reply to comments with positive score
    if (scored[0].score <= 0) {
      console.log('[FeedEngagement] Best comment has non-positive score, skipping');
      return null;
    }

    return scored[0].comment;
  }

  /**
   * Generate an AI reply to a comment
   * @param {Object} post - Parent post data
   * @param {string} commentAuthor - Comment author name
   * @param {string} commentText - Comment text
   * @returns {Promise<string|null>}
   */
  async function generateReply(post, commentAuthor, commentText) {
    try {
      // PRIMARY: AI generation via feedAI
      if (window.linkedInAutoApply?.feedAI?.generateAIReply) {
        try {
          const reply = await window.linkedInAutoApply.feedAI.generateAIReply(post, commentAuthor, commentText);
          if (reply) {
            const cleaned = reply.replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
            console.log('[FeedEngagement] AI reply generated:', cleaned);
            return cleaned;
          }
        } catch (aiErr) {
          console.warn('[FeedEngagement] AI reply generation failed:', aiErr.message);
        }
      }

      // FALLBACK: use dedicated reply library (more engaging than comment library)
      // Only use library for supported languages (EN/RU) — skip others to avoid language mismatch
      const commentLang = detectTextLanguage(commentText);
      if (commentLang === 'other') {
        console.log('[FeedEngagement] Comment language not EN/RU, no reply library available, skipping');
        return null;
      }
      const library = commentLang === 'ru' ? REPLY_LIBRARY_RU : REPLY_LIBRARY;
      const postType = detectPostType(post);
      const typeReplies = library[postType] || library.general;
      const reply = typeReplies[Math.floor(Math.random() * typeReplies.length)];
      console.log(`[FeedEngagement] Using reply library fallback (${postType}):`, reply);
      return reply;
    } catch (err) {
      console.warn('[FeedEngagement] generateReply error:', err.message);
      return null;
    }
  }

  // ── Conversation Thread Replies ─────────────────────────────────────

  /**
   * Scrape threaded replies under comments (sub-comments).
   * LinkedIn shows replies indented under the parent comment.
   * @param {Element} postEl
   * @returns {{ parentAuthor: string, parentText: string, replyAuthor: string, replyText: string, replyElement: Element }[]}
   */
  function scrapeCommentThreads(postEl) {
    const threads = [];
    try {
      // Find reply/thread containers — LinkedIn nests them under the parent comment
      const threadSelectors = [
        '[class*="comments-reply-item"]',
        '[class*="comments-comment-item--nested"]',
        '[data-testid*="reply-entity"]',
        '[data-testid*="reply-item"]',
        '[class*="reply-item"]',
      ];

      let replyEls = [];
      for (const sel of threadSelectors) {
        replyEls = safeQuerySelectorAll(postEl, sel);
        if (replyEls.length > 0) {
          console.log(`[FeedEngagement] Found ${replyEls.length} thread replies via: ${sel}`);
          break;
        }
      }

      // Fallback: look for indented / nested comment structures
      if (replyEls.length === 0) {
        // Comments within comment-list that have a nesting indicator
        const allCommentEls = safeQuerySelectorAll(postEl, 'article[class*="comment"]');
        for (const el of allCommentEls) {
          // Check if this is a nested reply (usually has margin-left or a thread indicator)
          const style = window.getComputedStyle(el);
          const marginLeft = parseInt(style.marginLeft, 10) || 0;
          const paddingLeft = parseInt(style.paddingLeft, 10) || 0;
          // Nested replies typically have > 20px additional left indent
          if (marginLeft > 20 || paddingLeft > 20 || el.closest('[class*="reply"]')) {
            replyEls.push(el);
          }
        }
        if (replyEls.length > 0) {
          console.log(`[FeedEngagement] Found ${replyEls.length} thread replies via indent heuristic`);
        }
      }

      for (const el of replyEls) {
        // Extract reply author
        const authorSelectors = [
          'a[href*="/in/"] span[dir="ltr"]',
          'a[href*="/in/"] span',
          'a[href*="/in/"]',
          'span[class*="hoverable-link-text"]',
        ];
        let replyAuthor = 'Unknown';
        for (const sel of authorSelectors) {
          const authorEl = safeQuerySelector(el, sel);
          if (authorEl) {
            const t = safeGetText(authorEl);
            if (t && t.length > 1 && t.length < 100) {
              replyAuthor = t.split('\n')[0].trim();
              break;
            }
          }
        }

        // Extract reply text
        const textSelectors = [
          '[data-testid="comment-text"]',
          'span[dir="ltr"][class*="break-words"]',
          'span.break-words',
          'span[dir="ltr"]',
        ];
        let replyText = '';
        for (const sel of textSelectors) {
          const textEl = safeQuerySelector(el, sel);
          if (textEl) {
            const t = safeGetText(textEl);
            if (t && t.length >= 5) {
              replyText = t;
              break;
            }
          }
        }

        // Find parent comment — walk up to find the parent comment container
        let parentAuthor = 'Unknown';
        let parentText = '';
        let parentEl = el.parentElement;
        for (let depth = 0; depth < 6 && parentEl && parentEl !== postEl; depth++) {
          // Check if this parent looks like a top-level comment
          const isComment = parentEl.matches?.('article[class*="comment"]') ||
                           parentEl.matches?.('[class*="comments-comment-item"]') ||
                           parentEl.matches?.('[data-testid*="comment-entity"]');
          if (isComment && parentEl !== el) {
            const pAuthorEl = safeQuerySelector(parentEl, 'a[href*="/in/"] span[dir="ltr"], a[href*="/in/"] span, a[href*="/in/"]');
            if (pAuthorEl) {
              parentAuthor = safeGetText(pAuthorEl).split('\n')[0].trim();
            }
            const pTextEl = safeQuerySelector(parentEl, '[data-testid="comment-text"], span.break-words, span[dir="ltr"]');
            if (pTextEl) {
              parentText = safeGetText(pTextEl);
            }
            break;
          }
          parentEl = parentEl.parentElement;
        }

        if (replyText && replyText.length >= 5) {
          threads.push({
            parentAuthor,
            parentText,
            replyAuthor,
            replyText,
            replyElement: el,
          });
        }
      }

      console.log(`[FeedEngagement] Scraped ${threads.length} thread replies`);
    } catch (err) {
      console.warn('[FeedEngagement] scrapeCommentThreads error:', err.message);
    }
    return threads;
  }

  /**
   * Find thread replies to the current user's comments (people who replied to YOU).
   * These are the highest-engagement reply targets.
   * @param {Element} postEl
   * @returns {{ replyAuthor: string, replyText: string, replyElement: Element, parentText: string }[]}
   */
  function findRepliesToOwnComments(postEl) {
    const threads = scrapeCommentThreads(postEl);
    const myReplies = threads.filter(t => isSelfName(t.parentAuthor) && !isSelfName(t.replyAuthor));
    console.log(`[FeedEngagement] Found ${myReplies.length} replies to own comments`);
    return myReplies;
  }

  // ── Auto Engagement ────────────────────────────────────────────────────

  /**
   * Auto-engage with posts (like, comment, follow)
   * @param {Object} options
   * @param {boolean} options.likeAll - Like all posts
   * @param {boolean} options.likeHiring - Like hiring posts
   * @param {boolean} options.likeKeywordMatches - Like keyword-matching posts
   * @param {boolean} options.enableComments - Enable commenting
   * @param {boolean} options.enableFollows - Enable following authors
   * @param {number} options.maxLikes - Maximum likes per session
   * @param {number} options.maxComments - Maximum comments per session
   * @param {function} options.onProgress - Progress callback
   * @returns {Promise<Object>}
   */
  async function autoEngage({
    likeAll = false,
    likeHiring = true,
    likeKeywordMatches = true,
    enableComments = false,
    enableReplies = false,
    replyToThreads = true,
    enableFollows = false,
    maxLikes = 30,
    maxComments = 15,
    maxReplies = 8,
    enableHashtags = false,
    hashtagCategories = {},
    enableDayKeywords = false,
    dayKeywords = {},
    actionCooldownSec = CONFIG.DEFAULT_ACTION_COOLDOWN_SEC,
    onProgress = null,
  } = {}) {
    // Resolve today's day-of-week keywords
    const todayDayNum = new Date().getDay(); // 0=Sun,1=Mon...6=Sat
    const todayKeywords = (enableDayKeywords && dayKeywords[todayDayNum]) || [];

    // Flatten all monitored hashtags into a single lowercase set for fast lookup
    const monitoredHashtags = [];
    const hashtagCategoryMap = {}; // hashtag -> category name (for logging)
    if (enableHashtags && hashtagCategories) {
      for (const [category, tags] of Object.entries(hashtagCategories)) {
        for (const tag of tags) {
          const lower = tag.toLowerCase().replace(/^#/, '');
          monitoredHashtags.push(lower);
          hashtagCategoryMap[lower] = category;
        }
      }
    }

    console.log('[FeedEngagement] autoEngage called with settings:', {
      likeAll,
      likeHiring,
      likeKeywordMatches,
      enableComments,
      enableReplies,
      replyToThreads,
      enableFollows,
      maxLikes,
      maxComments,
      maxReplies,
      enableHashtags,
      monitoredHashtags: monitoredHashtags.length,
      enableDayKeywords,
      todayKeywords,
      actionCooldownSec,
      commentProbability: CONFIG.ENGAGEMENT_PROBABILITY.comment,
      replyProbability: CONFIG.ENGAGEMENT_PROBABILITY.reply,
    });

    if (isEngaging) {
      console.log('[FeedEngagement] Already engaging, please wait...');
      return sessionStats;
    }

    isEngaging = true;
    abortController = new AbortController();
    sessionStats = {
      liked: 0,
      commented: 0,
      replied: 0,
      followed: 0,
      skipped: 0,
      errors: 0,
      startTime: new Date().toISOString(),
      endTime: null,
    };

    console.log('[FeedEngagement] Starting auto-engagement...', {
      likeAll,
      likeHiring,
      likeKeywordMatches,
      enableComments,
      enableReplies,
      enableFollows,
      commentLibrarySize: Object.keys(COMMENT_LIBRARY).length,
    });

    try {
      // Load previously-engaged post IDs for dedup (shared across rounds)
      const engagedPostIds = await loadEngagedPostIds();
      let roundNum = 0;
      let emptyRounds = 0;
      const processedElements = new WeakSet(); // track DOM elements across rounds

      // ── Continuous engagement loop: scrape → filter → score → engage → scroll more ──
      while (!abortController?.signal?.aborted) {
        roundNum++;
        console.log(`[FeedEngagement] ── Round ${roundNum} ──`);

        // Check if session limits are already reached
        if (sessionStats.liked >= maxLikes) {
          console.log('[FeedEngagement] Session like limit reached, stopping');
          break;
        }

      // Scrape posts with scrolling
      const posts = await window.linkedInAutoApply.feed.scrapeWithScroll({
        scrollCount: 5,
        scrollDelay: CONFIG.MIN_SCROLL_DELAY,
        onProgress: (progress) => {
          if (onProgress) {
            onProgress({
              phase: 'scraping',
              ...progress,
              stats: { ...sessionStats },
            });
          }
        },
        signal: abortController?.signal,
      });

      const postElements = window.linkedInAutoApply.feed.findPostElements();
      const keywords = (window.linkedInAutoApply?.settings?.jobKeywords) || [];

      // Pre-load scoring settings once (used inside the loop)
      const _scoring = window.linkedInAutoApply.feedScoring;
      const _scoringSettings = _scoring ? await _scoring.loadSettings() : null;

      console.log('[FeedEngagement] Processing', postElements.length, 'posts',
        '| already engaged:', engagedPostIds.size,
        '| AI scoring:', _scoringSettings?.enableScoring ? 'ON' : 'OFF');

      // ════════════════════════════════════════════════════════════════
      // PASS 1: Pre-filter all posts → collect candidates
      // ════════════════════════════════════════════════════════════════
      const preFiltered = []; // { post, postEl, ageHours }

      for (let i = 0; i < postElements.length; i++) {
        if (abortController?.signal?.aborted) break;

        const postEl = postElements[i];
        if (processedElements.has(postEl)) continue; // already handled in a previous round

        const post = await window.linkedInAutoApply.feed.parsePost(postEl, false);

        if (!post) { processedElements.add(postEl); sessionStats.skipped++; continue; }
        if (post.author && isSelfName(post.author)) { processedElements.add(postEl); sessionStats.skipped++; continue; }
        if (post.id && engagedPostIds.has(post.id)) { processedElements.add(postEl); sessionStats.skipped++; continue; }
        if (isAlreadyLiked(postEl)) { processedElements.add(postEl); sessionStats.skipped++; continue; }
        if ((post.reactions || 0) < 10) { processedElements.add(postEl); sessionStats.skipped++; continue; }

        const ageHours = parseTimestampToHours(post.timestamp);
        if (ageHours !== null && ageHours > 48) { processedElements.add(postEl); sessionStats.skipped++; continue; }
        if (isRepost(postEl)) { processedElements.add(postEl); sessionStats.skipped++; continue; }
        if (isVacancy(post)) { processedElements.add(postEl); sessionStats.skipped++; continue; }

        preFiltered.push({ post, postEl, ageHours });

        if (onProgress) {
          onProgress({
            phase: 'filtering',
            currentPost: i + 1,
            totalPosts: postElements.length,
            passed: preFiltered.length,
            stats: { ...sessionStats },
          });
        }
      }

      console.log('[FeedEngagement] Pre-filter passed:', preFiltered.length, '/', postElements.length);

      // ════════════════════════════════════════════════════════════════
      // PASS 2: Score (batch AI or legacy keyword matching)
      // ════════════════════════════════════════════════════════════════
      const scoringEnabled = _scoring && _scoringSettings?.enableScoring;
      let scoredQueue = []; // { post, postEl, ageHours, scoreResult, scoredAction, isTier1, engageReason }

      if (scoringEnabled && preFiltered.length > 0) {
        // Batch scoring via Claude
        const BATCH_SIZE = _scoring.getConfig().BATCH_SIZE || 8;

        if (onProgress) {
          onProgress({
            phase: 'scoring',
            total: preFiltered.length,
            scored: 0,
            stats: { ...sessionStats },
          });
        }

        for (let b = 0; b < preFiltered.length; b += BATCH_SIZE) {
          if (abortController?.signal?.aborted) break;
          const chunk = preFiltered.slice(b, b + BATCH_SIZE);

          if (onProgress) {
            onProgress({
              phase: 'scoring',
              total: preFiltered.length,
              scored: b,
              batchSize: chunk.length,
              stats: { ...sessionStats },
            });
          }

          const batchResults = await _scoring.scoreBatch(chunk, _scoringSettings);

          for (const item of batchResults) {
            const engageReason = item.scoredAction === 'skip'
              ? `AI skip (score: ${item.scoreResult?.score ?? '?'})`
              : `AI score ${item.scoreResult?.score ?? '?'} → ${item.scoredAction}` +
                (item.isTier1 ? ' [TIER-1]' : '') +
                (item.scoreResult?.themes?.length ? ` [${item.scoreResult.themes.join(', ')}]` : '');

            scoredQueue.push({ ...item, engageReason });
          }
        }

        // Sort queue: highest score first
        scoredQueue.sort((a, b) => (b.scoreResult?.score ?? 0) - (a.scoreResult?.score ?? 0));

      } else {
        // Legacy keyword / hashtag matching
        for (const item of preFiltered) {
          const { post } = item;
          let shouldEngage = likeAll;
          let engageReason = 'likeAll';

          if (!shouldEngage && likeHiring) {
            const signals = window.linkedInAutoApply.feed.detectHiringSignals(post);
            if (signals.length > 0) { shouldEngage = true; engageReason = `hiring (${signals.length} signals)`; }
          }
          if (!shouldEngage && likeKeywordMatches && keywords.length > 0) {
            const text = ((post.content || '') + ' ' + (post.author || '')).toLowerCase();
            const matched = keywords.filter(kw => text.includes(kw.toLowerCase()));
            if (matched.length > 0) { shouldEngage = true; engageReason = `keywords (${matched.join(', ')})`; }
          }
          if (!shouldEngage && monitoredHashtags.length > 0) {
            const text = ((post.content || '') + ' ' + (post.author || '')).toLowerCase();
            const postHashtags = (text.match(/#[\w\u00C0-\u024F]+/g) || []).map(h => h.slice(1));
            const matched = postHashtags.filter(h => monitoredHashtags.includes(h));
            if (matched.length > 0) {
              const categories = [...new Set(matched.map(h => hashtagCategoryMap[h]).filter(Boolean))];
              shouldEngage = true;
              engageReason = `hashtags [${categories.join(', ')}] (#${matched.join(', #')})`;
            }
          }
          if (!shouldEngage && todayKeywords.length > 0) {
            const text = ((post.content || '') + ' ' + (post.author || '')).toLowerCase();
            const matched = todayKeywords.filter(kw => text.toLowerCase().includes(kw.toLowerCase()));
            if (matched.length > 0) { shouldEngage = true; engageReason = `day keywords (${matched.join(', ')})`; }
          }

          scoredQueue.push({
            ...item,
            scoreResult: null,
            scoredAction: shouldEngage ? 'like_only' : 'skip',
            isTier1: false,
            engageReason: shouldEngage ? engageReason : 'no match',
          });
        }
      }

      // ════════════════════════════════════════════════════════════════
      // Emit scored queue so UI can render the post queue panel
      // ════════════════════════════════════════════════════════════════
      const actionableQueue = scoredQueue.filter(q => q.scoredAction !== 'skip');
      const skippedByScore = scoredQueue.filter(q => q.scoredAction === 'skip');
      // Mark skipped posts as processed so they're never re-scored
      for (const item of skippedByScore) {
        processedElements.add(item.postEl);
      }
      sessionStats.skipped += skippedByScore.length;

      if (onProgress) {
        onProgress({
          phase: 'queue',
          queue: scoredQueue,
          actionable: actionableQueue.length,
          skipped: skippedByScore.length,
          stats: { ...sessionStats },
        });
      }

      console.log('[FeedEngagement] Scored queue:',
        scoredQueue.length, 'total |',
        actionableQueue.length, 'actionable |',
        skippedByScore.length, 'skipped by score');

      // ════════════════════════════════════════════════════════════════
      // PASS 3: Engage posts from scored queue
      // ════════════════════════════════════════════════════════════════
      for (let i = 0; i < actionableQueue.length; i++) {
        if (abortController?.signal?.aborted) {
          console.log('[FeedEngagement] Engagement aborted');
          break;
        }

        const { post, postEl, scoreResult, scoredAction, engageReason } = actionableQueue[i];

        // Expand "see more" for posts we'll actually engage with
        const fullPost = await window.linkedInAutoApply.feed.parsePost(postEl, true) || post;

        console.log('[FeedEngagement] Engaging with post:', {
          author: fullPost?.author || 'unknown',
          reason: engageReason,
          score: scoreResult?.score ?? null,
          action: scoredAction,
        });

        // Check session limits
        if (sessionStats.liked >= maxLikes) {
          console.log('[FeedEngagement] Reached max likes for session');
          break;
        }

        // Track which actions were performed on this post for the single cooldown
        const actionsPerformed = [];

        // Helper: fire progress with a countdown message during long waits
        const emitWaiting = (action, tick) => {
          if (!onProgress) return;
          const secs = Math.ceil(tick.remaining / 1000);
          onProgress({
            phase: 'engaging',
            currentPost: i + 1,
            totalPosts: actionableQueue.length,
            stats: { ...sessionStats },
            rateLimits: getRateLimitStatus(),
            waiting: `${action} cooldown ${secs}s`,
          });
        };

        // ── Like ── (always like if queued)
        if (sessionStats.liked < maxLikes) {
          if (scoredAction === 'like_only' || scoredAction === 'like_comment' || scoredAction === 'like_comment_follow') {
            const liked = await likePost(postEl, fullPost);
            if (liked) actionsPerformed.push('like');
          }
        }

        // ── Comment ── (always comment if queued as like_comment or like_comment_follow)
        let commentedOnThisPost = false;
        if ((scoredAction === 'like_comment' || scoredAction === 'like_comment_follow') && enableComments && sessionStats.commented < maxComments) {
          const comment = await generateComment(fullPost);
          if (comment) {
            let commented = false;
            const MAX_COMMENT_RETRIES = 3;
            for (let retry = 0; retry < MAX_COMMENT_RETRIES; retry++) {
              commented = await commentOnPost(postEl, comment, fullPost);
              if (commented) {
                commentedOnThisPost = true;
                actionsPerformed.push('comment');
                break;
              }
              if (retry < MAX_COMMENT_RETRIES - 1) {
                await delay(randomDelay(2000, 4000));
              }
            }
          }
        }

        // ── Reply / Thread replies — expand comments once for both ──
        const needReply = !commentedOnThisPost && enableReplies && sessionStats.replied < maxReplies;
        const needThread = enableReplies && replyToThreads && sessionStats.replied < maxReplies;
        let commentsExpanded = false;

        if (needReply || needThread) {
          commentsExpanded = await expandComments(postEl);
          if (commentsExpanded) {
            await delay(randomDelay(500, 1000));
          }
        }

        // Reply to a comment (skip if we just commented to avoid self-reply)
        if (needReply && commentsExpanded) {
            try {
              const comments = scrapeComments(postEl);
              const postLang = detectTextLanguage(fullPost?.content);
              const othersComments = comments.filter(c => {
                if (isSelfName(c.author)) return false;
                return detectTextLanguage(c.text) === postLang;
              });

              if (othersComments.length > 0) {
                const target = selectBestComment(othersComments);
                if (target) {
                  const reply = await generateReply(fullPost, target.author, target.text);
                  if (reply) {
                    const MAX_REPLY_RETRIES = 2;
                    for (let retry = 0; retry < MAX_REPLY_RETRIES; retry++) {
                      const replied = await replyToComment(postEl, target.element, reply);
                      if (replied) {
                        actionsPerformed.push('reply');
                        break;
                      }
                      if (retry < MAX_REPLY_RETRIES - 1) {
                        await delay(randomDelay(2000, 4000));
                      }
                    }
                  }
                }
              }
            } catch (replyErr) {
              console.error('[FeedEngagement] Reply block error:', replyErr.message);
            }
        }

        // Reply to conversation threads (people who replied to YOUR comments)
        if (needThread && commentsExpanded && sessionStats.replied < maxReplies) {
          try {
            const threadTargets = findRepliesToOwnComments(postEl);
            const postLang = detectTextLanguage(fullPost?.content);

            for (const thread of threadTargets) {
              if (abortController?.signal?.aborted) break;
              if (sessionStats.replied >= maxReplies) break;
              if (!checkRateLimit('reply').allowed) break;
              if (detectTextLanguage(thread.replyText) !== postLang) continue;

              const threadReply = await generateReply(fullPost, thread.replyAuthor, thread.replyText);
              if (threadReply) {
                const replied = await replyToComment(postEl, thread.replyElement, threadReply);
                if (replied) {
                  actionsPerformed.push('threadReply');
                }
              }
            }
          } catch (threadErr) {
            console.warn('[FeedEngagement] Thread reply error:', threadErr.message);
          }
        }

        // ── Follow ── (queue-driven or probability-based fallback)
        if (enableFollows) {
          const shouldFollow = scoredAction === 'like_comment_follow';
          if (shouldFollow) {
            const followed = await followAuthor(postEl, fullPost);
            if (followed) actionsPerformed.push('follow');
          }
        }

        // Mark DOM element as processed regardless of actions
        processedElements.add(postEl);

        // ── Single cooldown per post (only if we did something) ──
        if (actionsPerformed.length > 0) {
          // Mark post ID as engaged so we never process it again (persisted)
          if (post.id) {
            engagedPostIds.add(post.id);
            saveEngagedPostIds(engagedPostIds); // fire-and-forget
          }

          // Cooldown between posts — use user-configurable setting
          const cooldownMs = actionCooldownSec * 1000;
          // Add ±20% jitter for human-like behavior
          const minCooldown = Math.round(cooldownMs * 0.8);
          const maxCooldown = Math.round(cooldownMs * 1.2);

          const actions = actionsPerformed.join('+');
          console.log(`[FeedEngagement] Post done (${actions}), cooldown ${actionCooldownSec}s...`);
          await delayWithProgress(
            randomDelay(minCooldown, maxCooldown),
            abortController?.signal,
            (tick) => emitWaiting(actions, tick),
          );
        }

        // Progress callback
        if (onProgress) {
          onProgress({
            phase: 'engaging',
            currentPost: i + 1,
            totalPosts: actionableQueue.length,
            stats: { ...sessionStats },
            rateLimits: getRateLimitStatus(),
          });
        }
      }

      console.log(`[FeedEngagement] Round ${roundNum} complete:`, sessionStats);

      // Track consecutive empty rounds — stop after 3 to avoid infinite scrolling
      if (actionableQueue.length === 0) {
        emptyRounds = (emptyRounds || 0) + 1;
        console.log(`[FeedEngagement] No actionable posts this round (${emptyRounds}/3), scrolling for more...`);
        if (emptyRounds >= 3) {
          console.log('[FeedEngagement] 3 empty rounds in a row, stopping');
          break;
        }
      } else {
        emptyRounds = 0;
      }

      // Scroll down to load fresh posts for the next round
      if (!abortController?.signal?.aborted && sessionStats.liked < maxLikes) {
        if (onProgress) {
          onProgress({
            phase: 'scrolling',
            message: `Scrolling for more posts (round ${roundNum + 1})...`,
            stats: { ...sessionStats },
          });
        }
        // Scroll several times to get past already-processed posts
        for (let s = 0; s < 3; s++) {
          window.scrollBy(0, CONFIG.SCROLL_PIXELS);
          await delay(randomDelay(CONFIG.MIN_SCROLL_DELAY, CONFIG.MAX_SCROLL_DELAY));
        }
      }

      } // end while (continuous engagement loop)

      console.log('[FeedEngagement] Auto-engagement complete:', sessionStats);

      // Notify background script (guard against invalidated extension context)
      try {
        chrome.runtime?.sendMessage?.({
          action: 'feedEngagementComplete',
          stats: sessionStats,
        });
      } catch (msgErr) {
        console.warn('[FeedEngagement] Could not notify background:', msgErr.message);
      }

    } catch (err) {
      if (err.message !== 'Aborted') {
        console.error('[FeedEngagement] Auto-engage error:', err.message, err.stack);
      }
      sessionStats.errors++;
    }

    isEngaging = false;
    sessionStats.endTime = new Date().toISOString();

    return sessionStats;
  }

  /**
   * Stop ongoing engagement
   */
  function stopEngagement() {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    isEngaging = false;
    console.log('[FeedEngagement] Engagement stopped');
  }

  /**
   * Get current engagement stats
   * @returns {Object}
   */
  function getStats() {
    return {
      session: { ...sessionStats },
      rateLimits: getRateLimitStatus(),
    };
  }

  /**
   * Reset session stats
   */
  function resetSession() {
    sessionStats = {
      liked: 0,
      commented: 0,
      replied: 0,
      followed: 0,
      skipped: 0,
      errors: 0,
      startTime: null,
      endTime: null,
    };
  }

  // ── Public API ─────────────────────────────────────────────────────────

  window.linkedInAutoApply.feedEngagement = {
    // Core actions
    likePost,
    isAlreadyLiked,
    findLikeButton,
    commentOnPost,
    findCommentButton,
    findCommentInput,
    generateComment,
    replyToComment,
    scrapeComments,
    scrapeCommentThreads,
    findRepliesToOwnComments,
    expandComments,
    generateReply,
    scoreComment,
    selectBestComment,
    followAuthor,
    findFollowButton,

    // Auto engagement
    autoEngage,
    stopEngagement,

    // Stats & limits
    getStats,
    resetSession,
    getRateLimitStatus,
    checkRateLimit,

    // Configuration
    getConfig: () => ({ ...CONFIG }),

    // Self-detection
    getCurrentUserName,
    isSelfName,

    // Persistence
    saveDailyStats,
    resetDailyStats,
  };

  console.log('[FeedEngagement] Module loaded successfully');
})();
