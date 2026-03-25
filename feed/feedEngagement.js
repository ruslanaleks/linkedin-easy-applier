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
    MAX_LIKES_PER_HOUR: 15,
    MAX_LIKES_PER_DAY: 80,
    MAX_COMMENTS_PER_HOUR: 5,
    MAX_COMMENTS_PER_DAY: 20,
    MAX_FOLLOWS_PER_HOUR: 10,
    MAX_FOLLOWS_PER_DAY: 30,
    MAX_REPLIES_PER_HOUR: 4,
    MAX_REPLIES_PER_DAY: 15,

    // Delay ranges (ms) for human-like behavior
    MIN_LIKE_DELAY: 3000,
    MAX_LIKE_DELAY: 8000,
    MIN_COMMENT_DELAY: 8000,
    MAX_COMMENT_DELAY: 15000,
    MIN_FOLLOW_DELAY: 5000,
    MAX_FOLLOW_DELAY: 10000,
    MIN_REPLY_DELAY: 10000,
    MAX_REPLY_DELAY: 18000,

    // Scroll behavior
    MIN_SCROLL_DELAY: 1500,
    MAX_SCROLL_DELAY: 3000,
    SCROLL_PIXELS: 600,

    // Engagement patterns (randomized)
    ENGAGEMENT_PROBABILITY: {
      like: 1.0,      // 100% chance to like qualifying posts
      comment: 0.5,   // 50% chance to comment (when enabled)
      follow: 0.3,    // 30% chance to follow author
      reply: 0.4,     // 40% chance to reply to a comment (when enabled)
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
      // Unliked state: "Reaction button state: no reaction"
      const btn = safeQuerySelectorAll(postEl, 'button[aria-label*="Reaction button state: no reaction"]')[0];
      if (btn) return btn;

      // Alternative: button with aria-label containing "Like" that isn't already liked
      const allBtns = safeQuerySelectorAll(postEl, 'button[aria-label]');
      for (const b of allBtns) {
        const label = safeGetAttr(b, 'aria-label')?.toLowerCase() || '';
        if (label.includes('like') && !label.includes('liked') && !label.includes('unlike')) {
          return b;
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
      // If there's no "no reaction" button, it's likely already liked
      const noReaction = safeQuerySelectorAll(postEl, 'button[aria-label*="no reaction"]');
      return noReaction.length === 0;
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
      const btns = safeQuerySelectorAll(postEl, 'button');
      for (const btn of btns) {
        const label = (safeGetAttr(btn, 'aria-label') || '').toLowerCase();
        const text = safeGetText(btn).toLowerCase();
        if ((label.includes('comment') || text.includes('comment')) &&
            !/^\d+\s+comment/.test(text)) { // Skip "N comments" count
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
      console.log('[FeedEngagement] Searching for comment input...');

      // Strategy 1: LinkedIn uses div with role="textbox" and contenteditable
      const textbox = safeQuerySelector(postEl, '[role="textbox"][contenteditable="true"]');
      if (textbox) {
        console.log('[FeedEngagement] Found textbox via role="textbox"');
        return textbox;
      }

      // Strategy 2: Any contenteditable div within the comment composer
      const composer = safeQuerySelector(postEl, '[class*="comment-compose"]');
      if (composer) {
        const editable = safeQuerySelector(composer, '[contenteditable="true"]');
        if (editable) {
          console.log('[FeedEngagement] Found editable via composer');
          return editable;
        }
      }

      // Strategy 3: Any contenteditable div in post element
      const editable = safeQuerySelector(postEl, 'div[contenteditable="true"]');
      if (editable) {
        console.log('[FeedEngagement] Found generic contenteditable div');
        return editable;
      }

      // Strategy 4: Textarea (fallback)
      const textarea = safeQuerySelector(postEl, 'textarea');
      if (textarea) {
        console.log('[FeedEngagement] Found textarea');
        return textarea;
      }

      // Strategy 5: Look in modal/dialog if comment box opened in overlay
      const modal = document.querySelector('[role="dialog"], .artdeco-modal');
      if (modal) {
        const modalInput = safeQuerySelector(modal, '[role="textbox"][contenteditable="true"], div[contenteditable="true"], textarea');
        if (modalInput) {
          console.log('[FeedEngagement] Found input in modal');
          return modalInput;
        }
      }

      console.log('[FeedEngagement] No comment input found with any strategy');
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
   * Post a comment on a post
   * @param {Element} postEl
   * @param {string} commentText
   * @param {Object} post - Parsed post data
   * @returns {Promise<boolean>}
   */
  async function commentOnPost(postEl, commentText, post = null) {
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

      // Find comment button
      const commentBtn = findCommentButton(postEl);
      console.log('[FeedEngagement] Comment button found:', !!commentBtn);

      if (!commentBtn) {
        console.warn('[FeedEngagement] Comment button not found');
        sessionStats.errors++;
        return false;
      }

      // Click comment button
      console.log('[FeedEngagement] Clicking comment button...');
      commentBtn.click();
      await delay(randomDelay(1000, 2000));

      // Find input - try multiple times as it may take time to appear
      let input = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        input = findCommentInput(postEl);
        console.log('[FeedEngagement] Find comment input attempt', attempt + 1, ':', !!input);

        if (input) break;
        await delay(500);
      }

      if (!input) {
        console.error('[FeedEngagement] Comment input not found after 3 attempts');
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
      sessionStats.errors++;
      return false;
    }
  }

  // ── Comment Library ────────────────────────────────────────────────────
  // Extended library of professional comments for various post types

  const COMMENT_LIBRARY = {
    hiring: [
      'solid role, good luck finding someone.',
      'interesting position for the right person.',
      'strong team, candidates will notice.',
      'sounds like a rewarding role.',
      'good opportunity for growth.',
      'the role description looks clear.',
      'solid hiring, good fit ahead.',
      'promising position, well structured.',
    ],

    achievement: [
      'well earned, congrats.',
      'dedication shows in the result.',
      'impressive milestone, well done.',
      'hard work clearly paid off.',
      'earned it, keep going.',
      'solid achievement, congrats.',
      'the progress speaks for itself.',
      'notable result, well deserved.',
    ],

    learning: [
      'useful perspective, saved it.',
      'clear and practical breakdown.',
      'learned something new here.',
      'solid insight, appreciate it.',
      'practical advice, well explained.',
      'valuable takeaway from this.',
      'concise and to the point.',
      'good framing of the topic.',
    ],

    company: [
      'impressive growth, well earned.',
      'strong progress, team delivers.',
      'good momentum, keep building.',
      'solid trajectory for the company.',
      'visible results, well done.',
      'the team is clearly executing.',
      'meaningful progress, congrats.',
      'good direction, results show it.',
    ],

    launch: [
      'clean execution on the launch.',
      'market needs this, well timed.',
      'solid release, looks polished.',
      'good product, well built.',
      'the details look sharp.',
      'promising launch, congrats.',
      'well executed, looks solid.',
      'interesting product, good timing.',
    ],

    insight: [
      'sharp analysis, well framed.',
      'clear perspective on the topic.',
      'practical insight, well put.',
      'good read, solid reasoning.',
      'the data supports your point.',
      'nuanced take, appreciated.',
      'well structured argument.',
      'useful lens on the market.',
    ],

    gratitude: [
      'genuine words, appreciated.',
      'good reminder to be grateful.',
      'warm post, resonates.',
      'simple and honest, well said.',
      'gratitude goes a long way.',
      'positive energy in this.',
      'refreshing to read.',
      'the sincerity comes through.',
    ],

    event: [
      'solid lineup at the event.',
      'good networking opportunity.',
      'strong speakers this year.',
      'valuable event, good pick.',
      'looks like a productive gathering.',
      'good content coming from this.',
      'the agenda looks solid.',
      'useful connections ahead.',
    ],

    personal: [
      'honest share, respect.',
      'takes courage, well said.',
      'relatable story, resonates.',
      'genuine and grounded.',
      'real talk, appreciated.',
      'your openness helps others.',
      'honest perspective, valued.',
      'raw and real, respect.',
    ],

    world_impact: [
      'the ripple effect here is underestimated.',
      'second-order consequences matter most.',
      'scale changes the calculus entirely.',
      'systemic shift, not just incremental.',
      'the downstream effects will compound.',
      'structural change, not surface level.',
      'the leverage point is the key part.',
      'long-term compounding makes this work.',
    ],

    innovation: [
      'removes the core constraint entirely.',
      'the non-obvious application matters more.',
      'inflection point for the whole space.',
      'unlocks a class of problems at once.',
      'the architecture choice is what scales.',
      'solves the bottleneck, not the symptom.',
      'first-principles approach, rare to see.',
      'the timing aligns with adoption curves.',
    ],

    general: [
      'solid point, well put.',
      'interesting take on this.',
      'worth reading, saved.',
      'good content, appreciated.',
      'clear and well framed.',
      'resonates, good perspective.',
      'concise and valuable.',
      'well said, noted.',
      'good angle on the topic.',
      'practical and relevant.',
    ],
  };

  // ── Russian Comment Library ──────────────────────────────────────────────
  const COMMENT_LIBRARY_RU = {
    hiring: [
      'сильная позиция, удачи в поиске.',
      'интересная роль, кандидаты заметят.',
      'хорошая вакансия, описание чёткое.',
      'перспективная позиция.',
      'команда явно на уровне.',
      'роль звучит достойно.',
      'толковое описание, видно подход.',
      'хорошая возможность для роста.',
    ],

    achievement: [
      'заслуженный результат.',
      'усилия окупились, видно.',
      'достойный итог работы.',
      'результат говорит за себя.',
      'впечатляющий прогресс.',
      'серьёзное достижение.',
      'труд виден в результате.',
      'закономерный итог.',
    ],

    learning: [
      'полезный разбор, сохранил.',
      'чётко и по делу.',
      'дельный взгляд на тему.',
      'практичный материал.',
      'узнал новое, ценно.',
      'хорошее объяснение.',
      'полезно, буду применять.',
      'толковый инсайт.',
    ],

    company: [
      'рост впечатляет.',
      'команда явно работает.',
      'хорошая динамика.',
      'серьёзный прогресс.',
      'результаты видны.',
      'сильное направление.',
      'видно системный подход.',
      'уверенное развитие.',
    ],

    launch: [
      'чистый запуск, выглядит хорошо.',
      'рынку это пригодится.',
      'продукт выглядит зрело.',
      'хорошая реализация.',
      'детали проработаны.',
      'вовремя вышли.',
      'толковый релиз.',
      'видно внимание к деталям.',
    ],

    insight: [
      'точный анализ, по делу.',
      'хороший разбор темы.',
      'практичный взгляд.',
      'данные подтверждают мысль.',
      'чёткая аргументация.',
      'нюансы учтены, ценно.',
      'полезный ракурс.',
      'глубокий разбор.',
    ],

    gratitude: [
      'искренние слова, ценно.',
      'хорошее напоминание.',
      'тёплый пост.',
      'просто и честно.',
      'благодарность чувствуется.',
      'позитивная энергия.',
      'приятно читать.',
      'искренность видна.',
    ],

    event: [
      'сильный состав спикеров.',
      'полезное мероприятие.',
      'хорошая программа.',
      'ценные контакты впереди.',
      'продуктивное событие.',
      'контент оттуда будет полезен.',
      'повестка выглядит сильно.',
      'стоящее мероприятие.',
    ],

    personal: [
      'честно, уважаю.',
      'смело и по делу.',
      'откликается.',
      'искренне и просто.',
      'ценю открытость.',
      'реальный опыт, ценно.',
      'честный взгляд.',
      'жизненно.',
    ],

    world_impact: [
      'каскадный эффект тут недооценён.',
      'последствия второго порядка важнее.',
      'масштаб меняет расклад полностью.',
      'системный сдвиг, не косметика.',
      'эффект будет накапливаться.',
      'структурное изменение, не поверхностное.',
      'рычаг воздействия тут ключевой.',
      'долгосрочное накопление решает.',
    ],

    innovation: [
      'снимает ключевое ограничение.',
      'неочевидное применение важнее.',
      'точка перелома для всей области.',
      'разблокирует целый класс задач.',
      'архитектурный выбор и даёт масштаб.',
      'решает узкое место, не симптом.',
      'подход с нуля, редкость.',
      'тайминг совпадает с кривой принятия.',
    ],

    general: [
      'дельная мысль.',
      'интересный ракурс.',
      'ценное наблюдение.',
      'по делу, сохранил.',
      'чётко сформулировано.',
      'хороший взгляд на тему.',
      'коротко и ёмко.',
      'практично и актуально.',
      'толковая мысль.',
      'хорошо подмечено.',
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
      // Pick Russian or English library based on post language
      const russian = isRussianText(post?.content);
      const library = russian ? COMMENT_LIBRARY_RU : COMMENT_LIBRARY;
      console.log('[FeedEngagement] Using static comment library as fallback, lang:', russian ? 'ru' : 'en');
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
      // LinkedIn wraps each comment in an article or a div with data-testid
      const commentEls = safeQuerySelectorAll(postEl, 'article[class*="comment"], [data-testid*="comment"]');

      // Fallback: look for comment containers by structure
      const fallbackEls = commentEls.length > 0
        ? commentEls
        : safeQuerySelectorAll(postEl, '[class*="comments-comment-item"], [class*="comment-item"]');

      for (const el of fallbackEls) {
        // Extract author
        const authorEl = safeQuerySelector(el, '[class*="comment-item__inline-show-more-text"], a[class*="comment"] span[dir="ltr"], span[class*="hoverable-link-text"]');
        const author = safeGetText(authorEl) || 'Unknown';

        // Extract comment text
        const textEl = safeQuerySelector(el, '[class*="comment-item__main-content"], [class*="feed-shared-inline-show-more-text"], span[dir="ltr"][class*="break-words"]');
        const text = safeGetText(textEl);

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
      const existingComments = safeQuerySelectorAll(postEl, 'article[class*="comment"], [data-testid*="comment"], [class*="comments-comment-item"]');
      if (existingComments.length > 0) return true;

      // Click comment button to expand
      const commentBtn = findCommentButton(postEl);
      if (!commentBtn) return false;

      commentBtn.click();
      await delay(randomDelay(1500, 2500));
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
      const btns = safeQuerySelectorAll(commentEl, 'button');
      for (const btn of btns) {
        const text = safeGetText(btn).toLowerCase();
        const label = (safeGetAttr(btn, 'aria-label') || '').toLowerCase();
        if (text === 'reply' || text === 'responder' || text === 'ответить' ||
            label.includes('reply') || label.includes('responder') || label.includes('ответить')) {
          return btn;
        }
      }
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
      for (let attempt = 0; attempt < 3; attempt++) {
        // Look for the reply input near the comment
        input = safeQuerySelector(commentEl, '[role="textbox"][contenteditable="true"]')
             || safeQuerySelector(commentEl.parentElement, '[role="textbox"][contenteditable="true"]');

        // Broader fallback: the newest contenteditable in the post
        if (!input) {
          const allEditable = safeQuerySelectorAll(postEl, '[role="textbox"][contenteditable="true"], div[contenteditable="true"]');
          if (allEditable.length > 0) {
            input = allEditable[allEditable.length - 1]; // last one is likely the reply box
          }
        }

        if (input) break;
        await delay(500);
      }

      if (!input) {
        console.error('[FeedEngagement] Reply input not found');
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

      // FALLBACK: use generic comment library (match post type)
      const russian = isRussianText(commentText);
      const library = russian ? COMMENT_LIBRARY_RU : COMMENT_LIBRARY;
      const postType = detectPostType(post);
      const typeComments = library[postType] || library.general;
      return typeComments[Math.floor(Math.random() * typeComments.length)];
    } catch (err) {
      console.warn('[FeedEngagement] generateReply error:', err.message);
      return null;
    }
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
    enableFollows = false,
    maxLikes = 20,
    maxComments = 5,
    maxReplies = 3,
    onProgress = null,
  } = {}) {
    console.log('[FeedEngagement] autoEngage called with settings:', {
      likeAll,
      likeHiring,
      likeKeywordMatches,
      enableComments,
      enableReplies,
      enableFollows,
      maxLikes,
      maxComments,
      maxReplies,
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
        signal: abortController.signal,
      });

      const postElements = window.linkedInAutoApply.feed.findPostElements();
      const keywords = (window.linkedInAutoApply?.settings?.jobKeywords) || [];

      console.log('[FeedEngagement] Processing', postElements.length, 'posts');

      // Process each post
      for (let i = 0; i < postElements.length; i++) {
        if (abortController?.signal?.aborted) {
          console.log('[FeedEngagement] Engagement aborted');
          break;
        }

        const postEl = postElements[i];
        const post = await window.linkedInAutoApply.feed.parsePost(postEl, true);

        if (!post) {
          sessionStats.skipped++;
          console.log('[FeedEngagement] Skipped: parsePost returned null');
          continue;
        }

        // Determine if we should engage
        let shouldEngage = likeAll;
        let engageReason = 'likeAll';

        if (!shouldEngage && likeHiring) {
          const signals = window.linkedInAutoApply.feed.detectHiringSignals(post);
          if (signals.length > 0) {
            shouldEngage = true;
            engageReason = `hiring (${signals.length} signals)`;
          }
        }

        if (!shouldEngage && likeKeywordMatches && keywords.length > 0) {
          const text = ((post.content || '') + ' ' + (post.author || '')).toLowerCase();
          const matched = keywords.filter(kw => text.includes(kw.toLowerCase()));
          if (matched.length > 0) {
            shouldEngage = true;
            engageReason = `keywords (${matched.join(', ')})`;
          }
        }

        if (!shouldEngage) {
          sessionStats.skipped++;
          console.log('[FeedEngagement] Skipped post:', {
            author: post?.author || 'unknown',
            reason: 'No matching criteria',
            criteria: { likeAll, likeHiring, likeKeywordMatches, keywordsCount: keywords.length },
            postPreview: (post?.content || '').slice(0, 100) + '...',
          });
          continue;
        }

        console.log('[FeedEngagement] Engaging with post:', {
          author: post?.author || 'unknown',
          reason: engageReason,
        });

        // Check session limits
        if (sessionStats.liked >= maxLikes) {
          console.log('[FeedEngagement] Reached max likes for session');
          break;
        }

        // Like the post
        if (sessionStats.liked < maxLikes) {
          const prob = Math.random();
          if (prob <= CONFIG.ENGAGEMENT_PROBABILITY.like) {
            const liked = await likePost(postEl, post);
            if (liked) {
              // Random delay between actions
              await delay(randomDelay(CONFIG.MIN_LIKE_DELAY, CONFIG.MAX_LIKE_DELAY));
            }
          } else {
            console.log('[FeedEngagement] Skipped like (probability check failed)');
          }
        }

        // Comment on the post
        console.log('[FeedEngagement] Comment check:', {
          enableComments,
          commented: sessionStats.commented,
          maxComments,
          willCheck: enableComments && sessionStats.commented < maxComments,
        });

        if (enableComments && sessionStats.commented < maxComments) {
          const prob = Math.random();
          console.log('[FeedEngagement] Comment probability:', {
            prob,
            threshold: CONFIG.ENGAGEMENT_PROBABILITY.comment,
            willComment: prob <= CONFIG.ENGAGEMENT_PROBABILITY.comment,
          });

          if (prob <= CONFIG.ENGAGEMENT_PROBABILITY.comment) {
            console.log('[FeedEngagement] Generating comment...');
            const comment = await generateComment(post);
            console.log('[FeedEngagement] Generated comment:', comment);

            if (comment) {
              console.log('[FeedEngagement] Attempting to comment on post...');
              const commented = await commentOnPost(postEl, comment, post);
              if (commented) {
                console.log('[FeedEngagement] ✓ Comment posted successfully!');
                await delay(randomDelay(CONFIG.MIN_COMMENT_DELAY, CONFIG.MAX_COMMENT_DELAY));
              } else {
                console.log('[FeedEngagement] ✗ Comment failed (commentOnPost returned false)');
              }
            } else {
              console.log('[FeedEngagement] ✗ No comment generated');
            }
          } else {
            console.log('[FeedEngagement] Skipped comment (probability check failed)');
          }
        } else {
          console.log('[FeedEngagement] Skipped comment (disabled or max reached):', {
            enableComments,
            commented: sessionStats.commented,
            maxComments,
          });
        }

        // Reply to a comment on the post
        if (enableReplies && sessionStats.replied < maxReplies) {
          const prob = Math.random();
          console.log('[FeedEngagement] Reply probability:', {
            prob,
            threshold: CONFIG.ENGAGEMENT_PROBABILITY.reply,
            willReply: prob <= CONFIG.ENGAGEMENT_PROBABILITY.reply,
          });

          if (prob <= CONFIG.ENGAGEMENT_PROBABILITY.reply) {
            // Expand comments section
            const expanded = await expandComments(postEl);
            if (expanded) {
              const comments = scrapeComments(postEl);
              if (comments.length > 0) {
                // Pick a random comment to reply to
                const target = comments[Math.floor(Math.random() * comments.length)];
                console.log('[FeedEngagement] Generating reply to comment by:', target.author);

                const reply = await generateReply(post, target.author, target.text);
                if (reply) {
                  const replied = await replyToComment(postEl, target.element, reply);
                  if (replied) {
                    console.log('[FeedEngagement] Reply posted successfully');
                    await delay(randomDelay(CONFIG.MIN_REPLY_DELAY, CONFIG.MAX_REPLY_DELAY));
                  }
                }
              } else {
                console.log('[FeedEngagement] No comments found to reply to');
              }
            }
          }
        }

        // Follow the author
        if (enableFollows) {
          const prob = Math.random();
          if (prob <= CONFIG.ENGAGEMENT_PROBABILITY.follow) {
            await followAuthor(postEl, post);
            await delay(randomDelay(CONFIG.MIN_FOLLOW_DELAY, CONFIG.MAX_FOLLOW_DELAY));
          }
        }

        // Progress callback
        if (onProgress) {
          onProgress({
            phase: 'engaging',
            currentPost: i + 1,
            totalPosts: postElements.length,
            stats: { ...sessionStats },
            rateLimits: getRateLimitStatus(),
          });
        }
      }

      console.log('[FeedEngagement] Auto-engagement complete:', sessionStats);

      // Notify background script
      chrome.runtime.sendMessage({
        action: 'feedEngagementComplete',
        stats: sessionStats,
      });

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
    expandComments,
    generateReply,
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

    // Persistence
    saveDailyStats,
    resetDailyStats,
  };

  console.log('[FeedEngagement] Module loaded successfully');
})();
