// feed/autoLike.js - Standalone auto-like engine with human-like behavior
// Session management, breaks, working hours, security detection.
// Reuses DOM helpers from feedEngagement/feedScraper.

window.linkedInAutoApply = window.linkedInAutoApply || {};

(function () {
  'use strict';

  // ── Configuration ──────────────────────────────────────────────────────
  const CONFIG = {
    // Daily limits
    MAX_LIKES_PER_DAY: 100,
    DAILY_LIMIT_PERCENT: 0.65,       // 65% → 65 likes/day
    WEEKEND_MULTIPLIER: 0.20,        // 20% on weekends → ~13 likes/day

    // Session structure
    SESSION_SIZE: 25,
    MINI_BREAK_EVERY: 5,

    // Timing (ms)
    LIKE_PAUSE_MIN: 8000,            // 8s between likes
    LIKE_PAUSE_MAX: 25000,           // 25s between likes
    READ_SIMULATE_MIN: 3000,         // 3s reading simulation
    READ_SIMULATE_MAX: 12000,        // 12s reading simulation
    MINI_BREAK_MIN: 30000,           // 30s mini-break
    MINI_BREAK_MAX: 60000,           // 60s mini-break
    BIG_BREAK_MIN: 30 * 60 * 1000,  // 30 min big break
    BIG_BREAK_MAX: 90 * 60 * 1000,  // 90 min big break

    // Working hours
    WORK_HOUR_START: 8,              // 8:00 AM
    WORK_HOUR_END: 20,               // 8:00 PM

    // Human behavior
    RANDOM_SKIP_RATE: 0.15,          // 15% random skip
    SCROLL_AMOUNT: 400,

    // Security
    SECURITY_SCAN_INTERVAL: 5000,    // 5s

    // Persistence
    STATE_KEY: 'autoLikeDailyState',
  };

  // ── Security Patterns ──────────────────────────────────────────────────
  const SECURITY_TEXT_PATTERNS = [
    'unusual activity',
    'security verification',
    "you've reached the limit",
    'you have reached the limit',
    'verify your identity',
    'confirm your identity',
    'suspicious activity',
    'account restricted',
    'account has been restricted',
    'temporarily restricted',
  ];

  const SECURITY_SELECTORS = [
    'iframe[src*="captcha"]',
    'iframe[src*="challenge"]',
    'iframe[src*="recaptcha"]',
    'iframe[src*="hcaptcha"]',
    '#captcha-challenge',
    '[data-testid="challenge"]',
    '.challenge-dialog',
    '#cf-challenge-running',
    '.arkose-challenge',
  ];

  const SECURITY_URL_PATTERNS = [
    '/checkpoint/',
    '/challenge/',
    '/authwall',
  ];

  // ── State ──────────────────────────────────────────────────────────────
  let state = {
    status: 'idle',        // idle | running | reading | mini_break | big_break | paused | security_stop | daily_limit
    todayLikes: 0,
    sessionLikes: 0,
    sessionNumber: 0,
    dailyLimit: 65,
    securityDetected: null,
    startedAt: null,
  };

  let abortController = null;
  let securityInterval = null;

  // ── Helpers ────────────────────────────────────────────────────────────

  function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function delayWithAbort(ms, signal) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(resolve, ms);
      if (signal) {
        if (signal.aborted) { clearTimeout(timeout); reject(new Error('Aborted')); return; }
        signal.addEventListener('abort', () => {
          clearTimeout(timeout);
          reject(new Error('Aborted'));
        }, { once: true });
      }
    });
  }

  function getTodayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function isWeekend() {
    const day = new Date().getDay();
    return day === 0 || day === 6;
  }

  function isWithinWorkingHours() {
    const hour = new Date().getHours();
    return hour >= CONFIG.WORK_HOUR_START && hour < CONFIG.WORK_HOUR_END;
  }

  function computeDailyLimit() {
    const base = Math.floor(CONFIG.MAX_LIKES_PER_DAY * CONFIG.DAILY_LIMIT_PERCENT);
    return isWeekend() ? Math.floor(base * CONFIG.WEEKEND_MULTIPLIER) : base;
  }

  // ── Persistence ────────────────────────────────────────────────────────

  async function loadState() {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage) return;
      const data = await chrome.storage.local.get(CONFIG.STATE_KEY);
      const saved = data?.[CONFIG.STATE_KEY];
      if (saved && saved.date === getTodayKey()) {
        state.todayLikes = saved.todayLikes || 0;
        state.sessionNumber = saved.sessionNumber || 0;
      } else {
        // New day — reset
        state.todayLikes = 0;
        state.sessionNumber = 0;
      }
    } catch (err) {
      if (!err.message?.includes('Extension context invalidated')) {
        console.warn('[AutoLike] Failed to load state:', err.message);
      }
    }
  }

  async function saveState() {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage) return;
      await chrome.storage.local.set({
        [CONFIG.STATE_KEY]: {
          date: getTodayKey(),
          todayLikes: state.todayLikes,
          sessionNumber: state.sessionNumber,
        },
      });
    } catch (err) {
      if (!err.message?.includes('Extension context invalidated')) {
        console.warn('[AutoLike] Failed to save state:', err.message);
      }
    }
  }

  // ── Status Change Callback ─────────────────────────────────────────────

  let _onStatusChange = null;

  function fireStatusChange(message) {
    console.log(`[AutoLike] [${state.status}] ${message}`);
    if (_onStatusChange) {
      _onStatusChange({ ...state }, message);
    }
  }

  // ── Security Scanner ───────────────────────────────────────────────────

  function scanForSecurity() {
    // Check URL
    const url = window.location.href;
    for (const pattern of SECURITY_URL_PATTERNS) {
      if (url.includes(pattern)) return `URL redirect: ${pattern}`;
    }

    // Check DOM selectors
    for (const sel of SECURITY_SELECTORS) {
      try {
        if (document.querySelector(sel)) return `Security element: ${sel}`;
      } catch { /* ignore invalid selector */ }
    }

    // Check text in dialogs/modals/alerts, then body
    const scanTargets = [
      ...document.querySelectorAll('[role="dialog"], [role="alert"], [role="alertdialog"], .artdeco-modal, .artdeco-toast-item'),
    ];
    for (const target of scanTargets) {
      const text = (target?.innerText || '').toLowerCase();
      for (const pattern of SECURITY_TEXT_PATTERNS) {
        if (text.includes(pattern)) return `Detected: "${pattern}"`;
      }
    }

    return null;
  }

  function startSecurityScanner() {
    stopSecurityScanner();
    securityInterval = setInterval(() => {
      const threat = scanForSecurity();
      if (threat) emergencyStop(threat);
    }, CONFIG.SECURITY_SCAN_INTERVAL);
  }

  function stopSecurityScanner() {
    if (securityInterval) {
      clearInterval(securityInterval);
      securityInterval = null;
    }
  }

  function emergencyStop(reason) {
    console.error('[AutoLike] SECURITY DETECTED:', reason);
    state.status = 'security_stop';
    state.securityDetected = reason;
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    stopSecurityScanner();
    fireStatusChange(`SECURITY STOP: ${reason}`);

    try {
      chrome.runtime?.sendMessage?.({
        action: 'autoLikeSecurityStop',
        reason,
        stats: { todayLikes: state.todayLikes, sessionNumber: state.sessionNumber },
      });
    } catch { /* ignore */ }
  }

  // ── Targeting Filters ──────────────────────────────────────────────────

  function parseFilters(settings) {
    const targetHeadlines = settings.targetHeadlines || '';
    const authorBlacklist = settings.authorBlacklist || '';
    const contentBlacklist = settings.contentBlacklist || '';

    return {
      minReactions: settings.minReactions ?? 0,
      maxPostAgeHours: settings.maxPostAgeHours ?? 48,
      skipReposts: settings.skipReposts ?? true,
      skipVacancies: settings.skipVacancies ?? true,
      targetHeadlinesList: targetHeadlines
        ? targetHeadlines.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
        : [],
      authorBlacklistSet: authorBlacklist
        ? new Set(authorBlacklist.split(',').map(s => s.trim().toLowerCase()).filter(Boolean))
        : new Set(),
      contentBlacklistList: contentBlacklist
        ? contentBlacklist.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
        : [],
    };
  }

  // ── Post Selection ─────────────────────────────────────────────────────

  async function findCandidatePosts(engagedPostIds, filters) {
    const fe = window.linkedInAutoApply.feedEngagement;
    const fs = window.linkedInAutoApply.feed;
    if (!fe || !fs) return [];

    const postElements = fs.findPostElements();
    const candidates = [];

    for (const postEl of postElements) {
      const post = await fs.parsePost(postEl, false);
      if (!post) continue;

      // Self-posts
      if (post.author && fe.isSelfName(post.author)) continue;

      // Already engaged (persistent)
      if (post.id && engagedPostIds.has(post.id)) continue;

      // Already liked (DOM)
      if (fe.isAlreadyLiked(postEl)) continue;

      // No like button
      if (!fe.findLikeButton(postEl)) continue;

      // Min reactions
      if ((post.reactions || 0) < (filters.minReactions ?? 0)) continue;

      // Max age
      if (filters.maxPostAgeHours && fe._parseTimestampToHours) {
        const ageHours = fe._parseTimestampToHours(post.timestamp);
        if (ageHours !== null && ageHours > filters.maxPostAgeHours) continue;
      }

      // Skip reposts
      if (filters.skipReposts && fe._isRepost && fe._isRepost(postEl)) continue;

      // Skip vacancies
      if (filters.skipVacancies && fe._isVacancy && fe._isVacancy(post)) continue;

      // Author blacklist
      if (filters.authorBlacklistSet.size > 0 && post.author) {
        if (filters.authorBlacklistSet.has(post.author.toLowerCase().trim())) continue;
      }

      // Headline targeting
      if (filters.targetHeadlinesList.length > 0) {
        const headlineLower = (post.headline || '').toLowerCase();
        if (!filters.targetHeadlinesList.some(kw => headlineLower.includes(kw))) continue;
      }

      // Content blacklist
      if (filters.contentBlacklistList.length > 0) {
        const contentLower = (post.content || '').toLowerCase();
        if (filters.contentBlacklistList.some(kw => contentLower.includes(kw))) continue;
      }

      candidates.push({ postEl, post });
    }

    return candidates;
  }

  // ── Session Loop ───────────────────────────────────────────────────────

  async function runSession(engagedPostIds, filters) {
    const signal = abortController?.signal;
    let likesThisSession = 0;
    let consecutiveEmpty = 0;

    while (!signal?.aborted &&
           likesThisSession < CONFIG.SESSION_SIZE &&
           state.todayLikes < state.dailyLimit) {

      // Working hours check mid-session
      if (!isWithinWorkingHours()) {
        fireStatusChange('Outside working hours, pausing...');
        break;
      }

      // Security check
      const threat = scanForSecurity();
      if (threat) { emergencyStop(threat); return; }

      // Find candidates
      const candidates = await findCandidatePosts(engagedPostIds, filters);

      if (candidates.length === 0) {
        consecutiveEmpty++;
        if (consecutiveEmpty >= 6) {
          fireStatusChange('No more posts found after scrolling, ending session');
          break;
        }
        fireStatusChange('Scrolling for more posts...');
        for (let s = 0; s < 4; s++) {
          window.scrollBy(0, CONFIG.SCROLL_AMOUNT);
          await delayWithAbort(randomBetween(1500, 3000), signal);
        }
        continue;
      }
      consecutiveEmpty = 0;

      for (const { postEl, post } of candidates) {
        if (signal?.aborted) break;
        if (likesThisSession >= CONFIG.SESSION_SIZE) break;
        if (state.todayLikes >= state.dailyLimit) break;

        // Random skip (15%)
        if (Math.random() < CONFIG.RANDOM_SKIP_RATE) {
          fireStatusChange(`Skipped post by ${post.author || 'unknown'} (random)`);
          continue;
        }

        // ── Simulate reading ──
        state.status = 'reading';
        postEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const readTime = randomBetween(CONFIG.READ_SIMULATE_MIN, CONFIG.READ_SIMULATE_MAX);
        fireStatusChange(`Reading post by ${post.author || 'unknown'}... (${Math.round(readTime / 1000)}s)`);
        await delayWithAbort(readTime, signal);

        // ── Like the post ──
        state.status = 'running';
        const fe = window.linkedInAutoApply.feedEngagement;
        const liked = await fe.likePost(postEl, post);

        if (liked) {
          likesThisSession++;
          state.sessionLikes = likesThisSession;
          state.todayLikes++;

          // Track in shared engaged-posts set
          if (post.id && fe._saveEngagedPostIds) {
            engagedPostIds.add(post.id);
            fe._saveEngagedPostIds(engagedPostIds);
          }

          await saveState();
          fireStatusChange(`Liked! ${post.author || 'unknown'} (${state.todayLikes}/${state.dailyLimit} today, ${likesThisSession}/${CONFIG.SESSION_SIZE} session)`);

          // ── Mini-break every 5 likes ──
          if (likesThisSession % CONFIG.MINI_BREAK_EVERY === 0 && likesThisSession < CONFIG.SESSION_SIZE) {
            const miniBreak = randomBetween(CONFIG.MINI_BREAK_MIN, CONFIG.MINI_BREAK_MAX);
            state.status = 'mini_break';
            fireStatusChange(`Mini-break: ${Math.round(miniBreak / 1000)}s (after ${likesThisSession} likes)`);
            await delayWithAbort(miniBreak, signal);
            state.status = 'running';
          }

          // ── Pause between likes (8-25s) ──
          if (likesThisSession < CONFIG.SESSION_SIZE && state.todayLikes < state.dailyLimit) {
            const pauseMs = randomBetween(CONFIG.LIKE_PAUSE_MIN, CONFIG.LIKE_PAUSE_MAX);
            fireStatusChange(`Waiting ${Math.round(pauseMs / 1000)}s before next like...`);
            await delayWithAbort(pauseMs, signal);
          }
        }
      }

      // Scroll for more after processing current batch
      window.scrollBy(0, CONFIG.SCROLL_AMOUNT);
      await delayWithAbort(randomBetween(1500, 3000), signal);
    }
  }

  // ── Wait Until Working Hours ───────────────────────────────────────────

  async function waitUntilWorkingHours(signal) {
    while (!isWithinWorkingHours() && !signal?.aborted) {
      await delayWithAbort(60000, signal); // check every minute
    }
  }

  // ── Main Entry ─────────────────────────────────────────────────────────

  async function startAutoLike(settings = {}) {
    const fe = window.linkedInAutoApply.feedEngagement;
    const fs = window.linkedInAutoApply.feed;

    if (!fe || !fs) throw new Error('Required modules not loaded.');

    // Mutual exclusion with autoEngage
    if (fe.isEngaging && fe.isEngaging()) {
      throw new Error('Auto Engage is running. Stop it first.');
    }

    if (state.status === 'running' || state.status === 'reading' ||
        state.status === 'mini_break' || state.status === 'big_break') {
      throw new Error('Auto Like is already running.');
    }

    // Working hours check
    if (!isWithinWorkingHours()) {
      throw new Error(`Outside working hours (${CONFIG.WORK_HOUR_START}:00-${CONFIG.WORK_HOUR_END}:00).`);
    }

    // Load persisted state
    await loadState();

    // Compute daily limit
    state.dailyLimit = computeDailyLimit();

    // Daily limit check
    if (state.todayLikes >= state.dailyLimit) {
      state.status = 'daily_limit';
      fireStatusChange(`Daily limit reached (${state.todayLikes}/${state.dailyLimit})`);
      throw new Error(`Daily limit reached (${state.todayLikes}/${state.dailyLimit}).`);
    }

    // Reset runtime state
    state.status = 'running';
    state.sessionLikes = 0;
    state.securityDetected = null;
    state.startedAt = Date.now();
    abortController = new AbortController();

    // Start security scanner
    startSecurityScanner();

    // Load engaged post IDs
    let engagedPostIds;
    if (fe._loadEngagedPostIds) {
      engagedPostIds = await fe._loadEngagedPostIds();
    } else {
      engagedPostIds = new Set();
    }

    // Parse targeting filters
    const filters = parseFilters(settings);

    console.log('[AutoLike] Starting auto-like:', {
      dailyLimit: state.dailyLimit,
      todayLikes: state.todayLikes,
      isWeekend: isWeekend(),
      filters: {
        minReactions: filters.minReactions,
        maxPostAgeHours: filters.maxPostAgeHours,
        headlines: filters.targetHeadlinesList.length,
        authorBlacklist: filters.authorBlacklistSet.size,
        contentBlacklist: filters.contentBlacklistList.length,
      },
    });

    fireStatusChange('Auto Like started');

    try {
      // ── Daily loop: sessions with big breaks ──
      while (!abortController.signal.aborted && state.todayLikes < state.dailyLimit) {

        // Working hours gate
        if (!isWithinWorkingHours()) {
          state.status = 'paused';
          fireStatusChange('Outside working hours, waiting...');
          await waitUntilWorkingHours(abortController.signal);
          if (abortController.signal.aborted) break;
          state.status = 'running';
          // Re-check date (might be next day after waiting)
          const newLimit = computeDailyLimit();
          if (getTodayKey() !== (await loadState(), getTodayKey())) {
            // New day after sleeping
            state.todayLikes = 0;
            state.sessionNumber = 0;
            state.dailyLimit = newLimit;
          }
        }

        // ── Run one session (up to 25 likes) ──
        state.sessionLikes = 0;
        state.sessionNumber++;
        state.status = 'running';
        fireStatusChange(`Session #${state.sessionNumber} starting`);

        await runSession(engagedPostIds, filters);

        // If aborted or security stop, break out
        if (abortController.signal.aborted || state.status === 'security_stop') break;

        // Daily limit reached?
        if (state.todayLikes >= state.dailyLimit) {
          state.status = 'daily_limit';
          fireStatusChange(`Daily limit reached! (${state.todayLikes}/${state.dailyLimit})`);
          break;
        }

        // ── Big break between sessions ──
        const bigBreak = randomBetween(CONFIG.BIG_BREAK_MIN, CONFIG.BIG_BREAK_MAX);
        state.status = 'big_break';
        fireStatusChange(`Big break: ${Math.round(bigBreak / 60000)} minutes`);
        await delayWithAbort(bigBreak, abortController.signal);
      }
    } catch (err) {
      if (err.message !== 'Aborted') {
        console.error('[AutoLike] Error:', err.message);
      }
    } finally {
      stopSecurityScanner();
      if (state.status !== 'security_stop' && state.status !== 'daily_limit') {
        state.status = 'idle';
      }
      await saveState();
      fireStatusChange(state.status === 'security_stop'
        ? `Stopped: ${state.securityDetected}`
        : state.status === 'daily_limit'
          ? `Done for today (${state.todayLikes} likes)`
          : 'Stopped');
      abortController = null;
    }
  }

  // ── Stop ────────────────────────────────────────────────────────────────

  function stopAutoLike() {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    stopSecurityScanner();
    if (state.status !== 'security_stop' && state.status !== 'daily_limit') {
      state.status = 'idle';
    }
    fireStatusChange('Stopped by user');
    console.log('[AutoLike] Stopped');
  }

  // ── Public API ─────────────────────────────────────────────────────────

  window.linkedInAutoApply.autoLike = {
    start: startAutoLike,
    stop: stopAutoLike,
    getState: () => ({ ...state }),
    getConfig: () => ({ ...CONFIG }),
    isRunning: () => ['running', 'reading', 'mini_break', 'big_break', 'paused'].includes(state.status),
    set onStatusChange(fn) { _onStatusChange = fn; },
    get onStatusChange() { return _onStatusChange; },
    // Expose for testing
    scanForSecurity,
    loadState,
  };

  // Load state on module init
  loadState();

  console.log('[AutoLike] Module loaded');
})();
