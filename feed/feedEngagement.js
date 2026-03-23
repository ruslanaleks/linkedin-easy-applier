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

    // Delay ranges (ms) for human-like behavior
    MIN_LIKE_DELAY: 3000,
    MAX_LIKE_DELAY: 8000,
    MIN_COMMENT_DELAY: 8000,
    MAX_COMMENT_DELAY: 15000,
    MIN_FOLLOW_DELAY: 5000,
    MAX_FOLLOW_DELAY: 10000,

    // Scroll behavior
    MIN_SCROLL_DELAY: 1500,
    MAX_SCROLL_DELAY: 3000,
    SCROLL_PIXELS: 600,

    // Engagement patterns (randomized)
    ENGAGEMENT_PROBABILITY: {
      like: 1.0,      // 100% chance to like qualifying posts
      comment: 0.5,   // 50% chance to comment (when enabled)
      follow: 0.3,    // 30% chance to follow author
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
    lastReset: Date.now(),
    lastHourReset: Date.now(),
  };

  // Current session stats
  let sessionStats = {
    liked: 0,
    commented: 0,
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
   * Find the comment submit button (Post/Comment/Reply button)
   * @param {Element} postEl
   * @returns {Element|null}
   */
  function findCommentSubmit(postEl) {
    try {
      console.log('[FeedEngagement] Searching for submit button...');
      
      // Strategy 1: Look in modal/dialog (LinkedIn opens comment box in overlay)
      const modal = document.querySelector('[role="dialog"], .artdeco-modal, [class*="comment-dialog"]');
      if (modal) {
        console.log('[FeedEngagement] Found modal, searching for submit button inside...');
        const modalBtns = safeQuerySelectorAll(modal, 'button');
        for (const btn of modalBtns) {
          const text = safeGetText(btn).trim().toLowerCase();
          const label = (safeGetAttr(btn, 'aria-label') || '').toLowerCase();
          const disabled = btn.disabled || btn.hasAttribute('disabled');
          
          console.log('[FeedEngagement] Checking modal button:', text, '|', label, '| disabled:', disabled);
          
          if (!disabled && (
            text === 'post' || 
            text === 'comment' || 
            text === 'reply' ||
            text === 'send' ||
            label.includes('post comment') || 
            label.includes('submit') ||
            label.includes('reply')
          )) {
            console.log('[FeedEngagement] Found submit button in modal:', text);
            return btn;
          }
        }
      }
      
      // Strategy 2: Look in the post element itself (inline comments)
      const btns = safeQuerySelectorAll(postEl, 'button');
      for (const btn of btns) {
        const text = safeGetText(btn).trim().toLowerCase();
        const label = (safeGetAttr(btn, 'aria-label') || '').toLowerCase();
        const disabled = btn.disabled || btn.hasAttribute('disabled');
        
        if (!disabled && (
          text === 'post' || 
          text === 'comment' || 
          text === 'reply' ||
          text === 'send' ||
          label.includes('post comment') || 
          label.includes('submit') ||
          label.includes('reply')
        )) {
          console.log('[FeedEngagement] Found submit button in post:', text);
          return btn;
        }
      }
      
      // Strategy 3: Look for any button with "Post" in aria-label anywhere on page
      const allBtns = document.querySelectorAll('button[aria-label]');
      for (const btn of allBtns) {
        const label = (safeGetAttr(btn, 'aria-label') || '').toLowerCase();
        const disabled = btn.disabled || btn.hasAttribute('disabled');
        
        if (!disabled && (
          label.includes('post') || 
          label.includes('comment') || 
          label.includes('reply')
        )) {
          console.log('[FeedEngagement] Found submit button globally:', label);
          return btn;
        }
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
      await delay(300);

      // Clear existing - use proper method based on element type
      if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (input.hasAttribute('contenteditable')) {
        // For contenteditable divs, use textContent for horizontal typing
        input.textContent = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      input.dispatchEvent(new Event('focus', { bubbles: true }));

      console.log('[FeedEngagement] Typing comment horizontally...');

      // Type using proper keyboard events for horizontal typing
      const eventType = input.tagName === 'TEXTAREA' || input.tagName === 'INPUT' ? 'value' : 'textContent';
      
      for (let i = 0; i < commentText.length; i++) {
        const char = commentText[i];
        
        if (eventType === 'value') {
          input.value += char;
        } else {
          input.textContent += char;
        }
        
        // Dispatch proper events for LinkedIn to detect input
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', {
          key: char,
          bubbles: true,
          cancelable: true,
        }));
        input.dispatchEvent(new KeyboardEvent('keyup', {
          key: char,
          bubbles: true,
          cancelable: true,
        }));
        
        await delay(randomDelay(50, 150)); // Typing speed
      }

      // Final events
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('blur', { bubbles: true }));
      
      console.log('[FeedEngagement] Comment typed, waiting for submit button to be enabled...');
      await delay(randomDelay(800, 1500));

      // Submit - find submit button with retries
      let submitBtn = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        submitBtn = findCommentSubmit(postEl);
        console.log('[FeedEngagement] Find submit button attempt', attempt + 1, ':', !!submitBtn);
        
        if (submitBtn) {
          // Check if button is actually clickable
          const isDisabled = submitBtn.disabled || submitBtn.hasAttribute('disabled');
          const ariaDisabled = submitBtn.getAttribute('aria-disabled');
          const isAriaDisabled = ariaDisabled === 'true';
          
          console.log('[FeedEngagement] Submit button state:', {
            disabled: isDisabled,
            ariaDisabled: isAriaDisabled,
            visible: submitBtn.offsetParent !== null,
          });
          
          if (!isDisabled && !isAriaDisabled && submitBtn.offsetParent !== null) {
            console.log('[FeedEngagement] Submit button is enabled and visible!');
            break;
          }
        }
        
        await delay(500);
      }

      if (!submitBtn) {
        console.error('[FeedEngagement] Comment submit button not found after 5 attempts');
        sessionStats.errors++;
        return false;
      }

      // Click submit with scroll into view
      console.log('[FeedEngagement] Clicking submit button...');
      submitBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await delay(300);
      submitBtn.click();
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
    // Hiring / Job posts
    hiring: [
      'Great opportunity! 🚀',
      'Exciting role! Best of luck with the hiring process.',
      'This sounds like a fantastic opportunity for the right candidate!',
      'Amazing team! Any candidate would be lucky to join. 🌟',
      'Great company culture! Hope you find the perfect fit.',
      'This role sounds challenging and rewarding! 💼',
      'Fantastic opportunity for growth! 📈',
      'Your team is doing amazing work! Good luck hiring!',
      'This position looks like a great fit for someone passionate!',
      'Exciting times ahead! Hope you find top talent! 🎯',
    ],

    // Achievement / Milestone posts
    achievement: [
      'Congratulations on this achievement! 🎉',
      'Well deserved! Keep up the great work!',
      'Amazing accomplishment! Inspiring to see.',
      'So happy for your success! You earned it! 👏',
      'Incredible milestone! Can\'t wait to see what\'s next!',
      'This is what dedication looks like! Bravo! 🌟',
      'Your hard work is paying off! Congratulations!',
      'What an inspiring journey! Well done! 💪',
      'Celebrating your success with you! 🥂',
      'Outstanding achievement! You\'re a role model! ⭐',
    ],

    // Learning / Educational posts
    learning: [
      'Thanks for sharing this insight!',
      'Great perspective! Thanks for the valuable content.',
      'Interesting take! Appreciate you sharing.',
      'This is gold! Saving for later reference. 💡',
      'Learned something new today! Thank you! 📚',
      'Such a valuable lesson! Thanks for breaking it down.',
      'Your posts always teach me something new! 🙏',
      'Brilliant explanation! Very clear and helpful.',
      'This resonates so much! Thanks for the wisdom.',
      'Bookmarked! This is exactly what I needed to read. ✨',
    ],

    // Company / Business updates
    company: [
      'Exciting news for your company! 🎊',
      'Congratulations on the growth! Well earned!',
      'This is huge! Wishing you continued success!',
      'Amazing progress! Your team is crushing it! 💪',
      'What a milestone! Here\'s to many more! 🥂',
      'Incredible journey! Proud to see your success!',
      'This is just the beginning! Onwards and upwards! 🚀',
      'Fantastic achievement! Your vision is inspiring!',
      'Big things happening! Excited to see what\'s next!',
      'Your company\'s growth is truly inspiring! 🌟',
    ],

    // Project / Product launches
    launch: [
      'Congrats on the launch! Looks amazing! 🎉',
      'This is incredible! Can\'t wait to try it out!',
      'So much hard work paid off! Well done! 👏',
      'Game changer! Excited to see this succeed! 🚀',
      'Brilliant execution! The details look perfect!',
      'What a release! Your team outdid themselves! 💯',
      'This is going to make waves! Congratulations! 🌊',
      'Impressive work! The market needs this! ✨',
      'Launch day magic! So proud of what you built! 🎊',
      'Revolutionary! This will help so many people! 🙌',
    ],

    // Industry insights / Thought leadership
    insight: [
      'Spot on analysis! You nailed it! 🎯',
      'This is the kind of insight we need more of!',
      'Brilliant perspective! Changed how I think about this.',
      'Your expertise really shows! Thanks for sharing! 📖',
      'This should be required reading! So true! 💡',
      'Wisdom right here! Bookmarking this! ⭐',
      'You have a gift for explaining complex topics! 🧠',
      'Industry leaders need to hear this! 📢',
      'This is why I follow you! Always insightful! 🙏',
      'Masterclass in understanding the market! 📊',
    ],

    // Gratitude / Thank you posts
    gratitude: [
      'Your gratitude is contagious! Spread the love! 💕',
      'Beautiful post! Gratitude is everything! 🙏',
      'This warmed my heart! Keep being amazing! ✨',
      'So wholesome! The world needs more positivity! 🌈',
      'Thank YOU for being such a positive influence! 💫',
      'Grateful for posts like this! Keep shining! ⭐',
      'Your appreciation shows your character! 🌟',
      'This is what community is about! Love it! 🤝',
      'Beautiful reminder to appreciate the little things! 💝',
      'Your kindness inspires others! Keep it up! 💖',
    ],

    // Event / Conference posts
    event: [
      'Looks like an amazing event! Wish I was there! 🎪',
      'So many great connections made! Enjoy! 🤝',
      'Events like this are pure gold! Have a blast! ✨',
      'The energy must be incredible! Live it up! 🎉',
      'Great speakers! You\'re in for a treat! 🎤',
      'Networking at its finest! Make great connections! 🌐',
      'This conference is legendary! Enjoy every moment! 🏆',
      'Learning and connecting! Best combination! 📚',
      'The insights from this event will be invaluable! 💡',
      'Have an incredible time! See you at the next one! 👋',
    ],

    // Personal story / Vulnerability posts
    personal: [
      'Thank you for your vulnerability! It matters! 💕',
      'Your story inspires others to share! Keep going! 🌟',
      'This took courage to share! Respect! 🙏',
      'Your honesty is refreshing! Thank you! ✨',
      'Stories like yours change lives! Keep sharing! 📖',
      'You\'re helping others by being open! Bravo! 👏',
      'This resonates deeply! You\'re not alone! 💪',
      'Your journey is powerful! Thanks for trusting us! 💫',
      'Vulnerability is strength! You prove it! 🌈',
      'Keep sharing your truth! It matters more than you know! 💖',
    ],

    // General / Universal comments (fallback)
    general: [
      'Great post! Thanks for sharing! 👍',
      'This made my day! Thank you! 😊',
      'Always love seeing your content! 🌟',
      'Quality content as always! 💯',
      'This is why I\'m on LinkedIn! For posts like this! ✨',
      'Bookmarked for later! So valuable! 📌',
      'You never disappoint! Excellent as always! 🎯',
      'This deserves more attention! Sharing! 📢',
      'Your posts brighten my feed! Keep it up! ☀️',
      'Absolutely agree with this! Well said! 💬',
      'This is the content I signed up for! 🙌',
      'Saving this for inspiration! Thanks! 💝',
      'Your perspective is always refreshing! 🌊',
      'Keep creating value! It shows! 💎',
      'This hit different! Thank you! 🎯',
    ],
  };

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

    // Hiring signals
    if (/(hiring|we'?re hiring|job|position|role|opportunity|join our team|vacancy|career|now hiring)/.test(text)) {
      return 'hiring';
    }

    // Achievement signals
    if (/(congrat|achiev|milestone|promot|anniversary|celebrat|proud|award|won|reached|goal|success)/.test(text)) {
      return 'achievement';
    }

    // Learning signals
    if (/(learn|article|insight|thought|perspective|teach|lesson|tip|advice|guide|tutorial|how to)/.test(text)) {
      return 'learning';
    }

    // Company/Business signals
    if (/(company|business|growth|revenue|funding|investment|expansion|team|office|new hire)/.test(text)) {
      return 'company';
    }

    // Launch signals
    if (/(launch|release|announce|new product|introducing|unveil|beta|version|ship)/.test(text)) {
      return 'launch';
    }

    // Industry insight signals
    if (/(industry|market|trend|analysis|prediction|forecast|future|state of|report|data|research)/.test(text)) {
      return 'insight';
    }

    // Gratitude signals
    if (/(thank|grateful|gratitude|appreciat|blessed|lucky|honored|privileged|thankful)/.test(text)) {
      return 'gratitude';
    }

    // Event signals
    if (/(event|conference|summit|webinar|workshop|meetup|convention|expo|seminar|panel)/.test(text)) {
      return 'event';
    }

    // Personal story signals
    if (/(story|journey|personal|experience|struggle|challenge|overcome|mental health|vulnerable|honest)/.test(text)) {
      return 'personal';
    }

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
      // User-configured comments (highest priority)
      const comments = window.linkedInAutoApply?.settings?.autoComments || [];
      if (comments && comments.length > 0) {
        return comments[Math.floor(Math.random() * comments.length)];
      }

      // Try AI generation if enabled
      const aiSettings = window.linkedInAutoApply?.feedAI ? 
        await window.linkedInAutoApply.feedAI.loadAPISettings() : null;
      
      if (aiSettings?.enableAI) {
        try {
          console.log('[FeedEngagement] Using AI to generate comment...');
          const aiComment = await window.linkedInAutoApply.feedAI.generateAIComment(post, {
            analyzeImage: aiSettings.analyzeImages !== false,
          });
          
          if (aiComment) {
            console.log('[FeedEngagement] ✓ AI comment generated:', aiComment.slice(0, 80) + '...');
            return aiComment;
          }
        } catch (aiErr) {
          console.warn('[FeedEngagement] AI comment failed, falling back to library:', aiErr.message);
          // Continue to library fallback
        }
      }

      // Detect post type
      const postType = detectPostType(post);

      // Get comments for this type
      const typeComments = COMMENT_LIBRARY[postType] || COMMENT_LIBRARY.general;

      // Select random comment
      const comment = typeComments[Math.floor(Math.random() * typeComments.length)];

      console.log(`[FeedEngagement] Generated ${postType} comment (library): "${comment}"`);
      return comment;

    } catch (err) {
      console.warn('[FeedEngagement] generateComment error:', err.message);
      // Fallback to general comment
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
    enableFollows = false,
    maxLikes = 20,
    maxComments = 5,
    onProgress = null,
  } = {}) {
    console.log('[FeedEngagement] autoEngage called with settings:', {
      likeAll,
      likeHiring,
      likeKeywordMatches,
      enableComments,
      enableFollows,
      maxLikes,
      maxComments,
      commentProbability: CONFIG.ENGAGEMENT_PROBABILITY.comment,
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
        const post = window.linkedInAutoApply.feed.parsePost(postEl);

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
