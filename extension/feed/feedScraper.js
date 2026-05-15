// feed/feedScraper.js - Scrapes and analyzes LinkedIn feed posts
// Enhanced version with improved error handling, caching, performance, and resilience
// LinkedIn uses obfuscated/numbered CSS classes. This scraper relies on
// data-testid, aria-label, componentkey, and text-pattern matching instead.

window.linkedInAutoApply = window.linkedInAutoApply || {};

(function () {
  'use strict';

  // ── Configuration ──────────────────────────────────────────────────────
  const CONFIG = {
    // Hiring detection signals (multi-language)
    HIRING_SIGNALS: [
      'hiring', "we're hiring", 'we are hiring', 'join our team', 'open position',
      'open role', 'job opening', 'looking for', 'apply now', 'come work with us',
      'talent acquisition', 'new opportunity', 'career opportunity',
      'estamos contratando', 'buscamos', 'vacante', 'oportunidad laboral',
      'únete a nuestro equipo', 'puesto abierto',
      '#hiring', '#opentowork', '#jobalert', '#nowhiring',
    ],
    // Direct post-container selectors (most stable — LinkedIn rarely changes data-urn)
    POST_CONTAINER_SELECTORS: [
      'div[data-urn^="urn:li:activity"]',
      'div[data-urn^="urn:li:ugcPost"]',
      'div[data-urn^="urn:li:aggregate"]',
      '.feed-shared-update-v2',
      '[data-id][class*="feed"]',
      '[data-id][class*="update"]',
      '[data-testid="main-feed-activity-card"]',
    ],
    // Child-element selector strategies (fallback — find a child then walk up)
    SELECTOR_STRATEGIES: [
      { name: 'main-card', selector: '[data-testid="main-feed-activity-card"]' },
      { name: 'commentary', selector: '[data-testid="main-feed-activity-card__commentary"]' },
      { name: 'data-testid', selector: '[data-testid="expandable-text-box"]' },
      { name: 'ad-preview', selector: '[data-ad-preview="message"]' },
      { name: 'aria-profile', selector: '[aria-label*="Profile"]' },
      { name: 'componentkey', selector: '[componentkey^="auto-component-"]' },
      { name: 'reaction-count', selector: '[aria-label*="reaction"]' },
      { name: 'social-actions', selector: '[data-testid*="social-action"]' },
      { name: 'feed-text', selector: '.feed-shared-text' },
      { name: 'break-words', selector: '.break-words' },
      { name: 'update-text', selector: '.update-components-text' },
      { name: 'actor-name', selector: '[data-testid="actor-name"]' },
      { name: 'like-button', selector: 'button[aria-label*="like" i], button[aria-label*="reaction" i]' },
      { name: 'comment-button', selector: 'button[aria-label*="comment" i]' },
    ],
    // Scraping limits
    MAX_SCROLL_COUNT: 10,
    MIN_SCROLL_DELAY: 1500,
    MAX_SCROLL_DELAY: 3000,
    // Cache settings
    CACHE_TTL_MS: 5 * 60 * 1000, // 5 minutes
    MAX_CACHE_SIZE: 500,
    // Content extraction
    MIN_CONTENT_LENGTH: 30,
    MAX_AUTHOR_LENGTH: 100,
  };

  // ── Cache & State ──────────────────────────────────────────────────────
  const postCache = new Map(); // postId -> { post, timestamp }
  const seenIds = new Set();
  let scrapeSessionId = `session-${Date.now()}`;

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
   * Generate stable post ID from content + author
   * @param {string} author
   * @param {string} content
   * @param {string} [componentkey]
   * @returns {string}
   */
  function generatePostId(author, content, componentkey = null, dataUrn = null) {
    // Prefer data-urn (most stable, globally unique)
    if (dataUrn) {
      return dataUrn;
    }
    if (componentkey && componentkey.startsWith('auto-component-')) {
      return componentkey;
    }
    // Fallback: hash of author + content snippet
    const snippet = (content || '').slice(0, 100);
    const str = `${author}|${snippet}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `post-${Date.now()}-${Math.abs(hash).toString(36)}`;
  }

  /**
   * Parse a count string like "1,234" or "1.2K" into a number
   * @param {string} text
   * @returns {number}
   */
  function parseCount(text) {
    if (!text) return 0;
    const cleaned = text.replace(/,/g, '').trim().toLowerCase();
    if (cleaned.includes('k')) return Math.round(parseFloat(cleaned) * 1000);
    if (cleaned.includes('m')) return Math.round(parseFloat(cleaned) * 1000000);
    return parseInt(cleaned, 10) || 0;
  }

  /**
   * Safe text extraction with null checks
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
   * @param {Element|string} root
   * @param {string} selector
   * @returns {Element|null}
   */
  function safeQuerySelector(root, selector) {
    try {
      const scope = typeof root === 'string' ? document.querySelector(root) : root;
      return scope ? scope.querySelector(selector) : null;
    } catch {
      return null;
    }
  }

  /**
   * Query selector all with error handling
   * @param {Element|string} root
   * @param {string} selector
   * @returns {Element[]}
   */
  function safeQuerySelectorAll(root, selector) {
    try {
      const scope = typeof root === 'string' ? document.querySelector(root) : root;
      return scope ? Array.from(scope.querySelectorAll(selector)) : [];
    } catch {
      return [];
    }
  }

  // ── Cache Management ───────────────────────────────────────────────────

  /**
   * Get post from cache if not expired
   * @param {string} postId
   * @returns {Object|null}
   */
  function getCachedPost(postId) {
    const cached = postCache.get(postId);
    if (!cached) return null;
    if (Date.now() - cached.timestamp > CONFIG.CACHE_TTL_MS) {
      postCache.delete(postId);
      return null;
    }
    return cached.post;
  }

  /**
   * Add post to cache
   * @param {string} postId
   * @param {Object} post
   */
  function cachePost(postId, post) {
    // Evict oldest if cache is full
    if (postCache.size >= CONFIG.MAX_CACHE_SIZE) {
      const oldestKey = postCache.keys().next().value;
      if (oldestKey) postCache.delete(oldestKey);
    }
    postCache.set(postId, { post, timestamp: Date.now() });
  }

  /**
   * Clear expired cache entries
   */
  function cleanupCache() {
    const now = Date.now();
    for (const [key, value] of postCache.entries()) {
      if (now - value.timestamp > CONFIG.CACHE_TTL_MS) {
        postCache.delete(key);
      }
    }
  }

  /**
   * Persist cache to storage (optional, for cross-session)
   */
  async function persistCache() {
    try {
      // Check if chrome.storage is available
      if (typeof chrome === 'undefined' || !chrome.storage) {
        return;
      }

      const cacheData = Array.from(postCache.entries()).map(([id, data]) => ({
        id,
        ...data.post,
      }));
      await chrome.storage.local.set({ feedPostCache: cacheData });
    } catch (err) {
      // Ignore extension context errors - they happen on reload
      if (!err.message?.includes('Extension context invalidated') &&
          !err.message?.includes('context invalidated')) {
        console.warn('Failed to persist feed cache:', err);
      }
    }
  }

  /**
   * Load cache from storage
   */
  async function loadCache() {
    try {
      // Check if chrome.storage is available
      if (typeof chrome === 'undefined' || !chrome.storage) {
        console.warn('[FeedScraper] chrome.storage not available, skipping cache load');
        return;
      }

      const data = await chrome.storage.local.get('feedPostCache');
      if (data?.feedPostCache && Array.isArray(data.feedPostCache)) {
        const now = Date.now();
        data.feedPostCache.forEach(item => {
          const id = item.id;
          delete item.id;
          postCache.set(id, { post: item, timestamp: now });
        });
      }
    } catch (err) {
      if (err.message?.includes('Extension context invalidated')) {
        // Extension was reloaded, ignore
      } else {
        console.warn('Failed to load feed cache:', err);
      }
    }
  }

  // Initialize cache on load
  loadCache();

  // ── Feed Container Detection ───────────────────────────────────────────

  /**
   * Find the main feed container element with multiple strategies
   * @returns {Element|null}
   */
  function findFeedContainer() {
    const strategies = [
      () => document.querySelector('[data-testid="mainFeed"]'),
      () => document.querySelector('div.scaffold-layout__main'),
      () => document.querySelector('div.scaffold-layout__list'),
      () => document.querySelector('main'),
      () => document.querySelector('[role="main"]'),
      () => document.querySelector('.feed-container'),
      () => document.querySelector('.core-rail'),
      // Newer LinkedIn layouts
      () => document.querySelector('[data-testid="main-feed"]'),
      () => document.querySelector('div.scaffold-layout__content'),
      // Fallback: any element containing data-urn posts
      () => {
        const post = document.querySelector('div[data-urn^="urn:li:activity"], div[data-urn^="urn:li:ugcPost"]');
        return post?.closest('[role="main"]') || post?.parentElement?.parentElement || null;
      },
    ];

    for (const strategy of strategies) {
      try {
        const el = strategy();
        if (el) {
          console.log('[FeedScraper] Feed container found via strategy:', strategy.toString().slice(0, 50));
          return el;
        }
      } catch (err) {
        console.warn('[FeedScraper] Strategy failed:', err.message);
      }
    }

    console.warn('[FeedScraper] Feed container not found');
    return null;
  }

  // ── Post Element Detection ─────────────────────────────────────────────

  /**
   * Walk up from a child element to find the post root container
   * @param {Element} child
   * @param {Element} feedRoot
   * @returns {Element|null}
   */
  function findPostRoot(child, feedRoot) {
    if (!child || !feedRoot) return null;

    let el = child;
    const maxDepth = 10;
    let depth = 0;

    // Strategy 1: Look for componentkey
    while (el && el !== feedRoot && depth < maxDepth) {
      const ck = safeGetAttr(el, 'componentkey');
      if (ck && ck.startsWith('auto-component-')) {
        return el;
      }
      el = el.parentElement;
      depth++;
    }

    // Strategy 2: Look for post-specific data attributes
    el = child;
    depth = 0;
    while (el && el !== feedRoot && depth < maxDepth) {
      const urn = safeGetAttr(el, 'data-urn') || '';
      if ((urn.includes('urn:li:activity') || urn.includes('urn:li:ugcPost') || urn.includes('urn:li:aggregate')) ||
          safeGetAttr(el, 'data-id') ||
          el.classList?.contains('feed-shared-update-v2') ||
          el.classList?.contains('update-components') ||
          safeGetAttr(el, 'data-testid')?.includes('feed-activity-card')) {
        return el;
      }
      el = el.parentElement;
      depth++;
    }

    // Strategy 3: Heuristic - stop at typical nesting depth
    el = child;
    depth = 0;
    while (el && el.parentElement && el.parentElement !== feedRoot && depth < maxDepth) {
      if (el.parentElement.parentElement === feedRoot ||
          el.parentElement.parentElement?.parentElement === feedRoot) {
        return el;
      }
      el = el.parentElement;
      depth++;
    }

    return child;
  }

  /**
   * Remove duplicate post root elements from an array
   * @param {Element[]} roots
   * @returns {Element[]}
   */
  function dedupePostRoots(roots) {
    const seen = new Set();
    return roots.filter(el => {
      if (!el || seen.has(el)) return false;
      seen.add(el);
      return true;
    });
  }

  /**
   * Find all feed post container elements with multiple strategies
   * @returns {Element[]}
   */
  function findPostElements() {
    const feed = findFeedContainer();
    if (!feed) {
      console.warn('[FeedScraper] No feed container, returning empty');
      return [];
    }

    // Strategy 1: Direct post-container selectors (most reliable)
    for (const selector of CONFIG.POST_CONTAINER_SELECTORS) {
      try {
        const elements = safeQuerySelectorAll(feed, selector);
        if (elements.length > 0) {
          console.log(`[FeedScraper] Found ${elements.length} posts via direct selector: ${selector}`);
          return dedupePostRoots(elements);
        }
      } catch (err) {
        console.warn(`[FeedScraper] Direct selector ${selector} failed:`, err.message);
      }
    }

    // Strategy 2: Child-element selectors — find a child then walk up to post root
    for (const { name, selector } of CONFIG.SELECTOR_STRATEGIES) {
      try {
        const elements = safeQuerySelectorAll(feed, selector);
        if (elements.length > 0) {
          console.log(`[FeedScraper] Found ${elements.length} posts via child strategy: ${name}`);
          const roots = dedupePostRoots(elements.map(el => findPostRoot(el, feed)));
          return roots.filter(Boolean);
        }
      } catch (err) {
        console.warn(`[FeedScraper] Strategy ${name} failed:`, err.message);
      }
    }

    // Strategy 3: Heuristic — direct children of feed that look like posts
    // (large divs with minimum height/content, containing links and buttons)
    try {
      const candidates = safeQuerySelectorAll(feed, ':scope > div');
      const posts = candidates.filter(el => {
        // Must have some substance: links, text content, and interactive elements
        const hasLinks = el.querySelectorAll('a[href]').length >= 2;
        const hasButtons = el.querySelectorAll('button').length >= 1;
        const hasText = (el.innerText || '').length > 50;
        return hasLinks && hasButtons && hasText;
      });
      if (posts.length > 0) {
        console.log(`[FeedScraper] Found ${posts.length} posts via heuristic (direct children)`);
        return posts;
      }
    } catch (err) {
      console.warn('[FeedScraper] Heuristic strategy failed:', err.message);
    }

    // Strategy 4: Deep heuristic — look 2 levels deep for post-like containers
    try {
      const candidates = safeQuerySelectorAll(feed, ':scope > div > div');
      const posts = candidates.filter(el => {
        const hasLinks = el.querySelectorAll('a[href]').length >= 2;
        const hasButtons = el.querySelectorAll('button').length >= 1;
        const hasText = (el.innerText || '').length > 50;
        // Must also be reasonably tall (real posts are >100px)
        const rect = el.getBoundingClientRect();
        return hasLinks && hasButtons && hasText && rect.height > 100;
      });
      if (posts.length > 0) {
        console.log(`[FeedScraper] Found ${posts.length} posts via deep heuristic (grandchildren)`);
        return posts;
      }
    } catch (err) {
      console.warn('[FeedScraper] Deep heuristic strategy failed:', err.message);
    }

    // Not a warning — normal when tab is in background (LinkedIn unloads feed DOM)
    console.log('[FeedScraper] No posts found with any strategy (tab may be hidden)');
    return [];
  }

  // ── Content Extraction ─────────────────────────────────────────────────

  /**
   * Extract author name from a post element with multiple strategies
   * @param {Element} postEl
   * @returns {string}
   */
  function extractAuthor(postEl) {
    try {
      // Strategy 1: Actor name container (LinkedIn's actor component)
      const actorSelectors = [
        '.update-components-actor__name span[aria-hidden="true"]',
        '.update-components-actor__name span',
        '.update-components-actor__name',
        '.feed-shared-actor__name span[aria-hidden="true"]',
        '.feed-shared-actor__name span',
        '.feed-shared-actor__name',
        '[data-testid="actor-name"]',
      ];
      for (const sel of actorSelectors) {
        const el = safeQuerySelector(postEl, sel);
        if (el) {
          const text = safeGetText(el);
          if (text && text.length > 1 && text.length < CONFIG.MAX_AUTHOR_LENGTH) {
            return text.split('\n')[0].trim();
          }
        }
      }

      // Strategy 2: aria-label containing "Profile"
      const profileCard = safeQuerySelector(postEl, '[aria-label*="Profile"]');
      if (profileCard) {
        const label = safeGetAttr(profileCard, 'aria-label');
        if (label) {
          const nameMatch = label.match(/^(.+?)(?:\s+(?:Verified|Premium|Open to work|,))/i);
          if (nameMatch) return nameMatch[1].trim().slice(0, CONFIG.MAX_AUTHOR_LENGTH);
        }
        const firstP = safeQuerySelector(profileCard, 'p');
        if (firstP) return safeGetText(firstP).slice(0, CONFIG.MAX_AUTHOR_LENGTH);
        return (label || '').trim().slice(0, CONFIG.MAX_AUTHOR_LENGTH);
      }

      // Strategy 3: "View X's profile" aria-label
      const viewProfileLink = safeQuerySelector(postEl, 'a[aria-label*="profile"]');
      if (viewProfileLink) {
        const label = safeGetAttr(viewProfileLink, 'aria-label');
        if (label) {
          const m = label.match(/View\s+(.+?)(?:'s)?\s+profile/i);
          if (m) return m[1].trim().slice(0, CONFIG.MAX_AUTHOR_LENGTH);
        }
      }

      // Strategy 4: Profile link text (first link to /in/ or /company/)
      const profileLinks = safeQuerySelectorAll(postEl, 'a[href*="/in/"], a[href*="/company/"]');
      for (const profileLink of profileLinks) {
        const text = safeGetText(profileLink);
        if (text && text.length > 1 && text.length < CONFIG.MAX_AUTHOR_LENGTH && !/^\d/.test(text)) {
          return text.split('\n')[0].trim();
        }
      }
    } catch (err) {
      console.warn('[FeedScraper] extractAuthor error:', err.message);
    }

    return '';
  }

  /**
   * Extract author headline from the profile card
   * @param {Element} postEl
   * @returns {string}
   */
  function extractHeadline(postEl) {
    try {
      // Strategy 1: Actor description component
      const descSelectors = [
        '.update-components-actor__description span[aria-hidden="true"]',
        '.update-components-actor__description',
        '.feed-shared-actor__description span[aria-hidden="true"]',
        '.feed-shared-actor__description',
        '[data-testid="actor-description"]',
      ];
      for (const sel of descSelectors) {
        const el = safeQuerySelector(postEl, sel);
        if (el) {
          const text = safeGetText(el);
          if (text && text.length > 2 && !/^[•·]\s*(1st|2nd|3rd|Following)/.test(text)) {
            return text;
          }
        }
      }

      // Strategy 2: Profile card paragraphs
      const profileCard = safeQuerySelector(postEl, '[aria-label*="Profile"]');
      if (profileCard) {
        const paragraphs = safeQuerySelectorAll(profileCard, 'p');
        if (paragraphs.length >= 3) {
          const text = safeGetText(paragraphs[2]);
          if (text) return text;
        }
        if (paragraphs.length >= 2) {
          const text = safeGetText(paragraphs[1]);
          if (text && !/^[•·]\s*(1st|2nd|3rd|Following)/.test(text)) {
            return text;
          }
        }
      }
    } catch (err) {
      console.warn('[FeedScraper] extractHeadline error:', err.message);
    }

    return '';
  }

  /**
   * Click "See more" to expand full post content
   * @param {Element} postEl
   * @returns {Promise<boolean>}
   */
  async function expandPostContent(postEl) {
    try {
      // Look for "See more" / "…more" / "показать ещё" / "ver más" buttons
      const buttons = safeQuerySelectorAll(postEl, 'button, [role="button"]');
      for (const btn of buttons) {
        const text = safeGetText(btn).toLowerCase();
        const aria = safeGetAttr(btn, 'aria-label')?.toLowerCase() || '';
        const combined = text + ' ' + aria;
        if (/(see more|show more|\.{2,}more|\u2026more|ver más|mostrar más|показать ещё|показать больше|leer más|mehr anzeigen|voir plus)/.test(combined)) {
          btn.click();
          await delay(500);
          return true;
        }
      }
    } catch (err) {
      console.warn('[FeedScraper] expandPostContent error:', err.message);
    }
    return false;
  }

  /**
   * Extract main post content text with expansion support
   * @param {Element} postEl
   * @param {boolean} expand - Whether to expand "see more"
   * @returns {Promise<string>}
   */
  async function extractContent(postEl, expand = false) {
    try {
      // Expand if requested
      if (expand) {
        await expandPostContent(postEl);
      }

      // Try specific content selectors in priority order
      // LinkedIn periodically renames classes; keep multiple generations of selectors
      const contentSelectors = [
        '[data-testid="main-feed-activity-card__commentary"]',
        '[data-testid="expandable-text-box"]',
        '[data-ad-preview="message"]',
        '.feed-shared-text',
        '.feed-shared-inline-show-more-text',
        '.feed-shared-update-v2__description',
        '.update-components-text',
        '.update-components-text__text-view',
        '[class*="feed-shared-text"]',
        '[class*="update-components-text"]',
        '.break-words',
      ];

      for (const sel of contentSelectors) {
        const el = safeQuerySelector(postEl, sel);
        if (el) {
          const text = safeGetText(el);
          if (text.length >= CONFIG.MIN_CONTENT_LENGTH) {
            return text;
          }
        }
      }

      // Strategy 2: Find content by dir="ltr" spans that are inside the post body
      // (LinkedIn wraps user text in dir="ltr" spans)
      const dirLtrSpans = safeQuerySelectorAll(postEl, 'span[dir="ltr"]');
      for (const span of dirLtrSpans) {
        // Skip spans inside the social actions bar or header
        const parent = span.closest?.('[class*="social-actions"], [class*="actor"], [class*="header"]');
        if (parent) continue;
        const text = safeGetText(span);
        if (text.length >= CONFIG.MIN_CONTENT_LENGTH) {
          return text;
        }
      }

      // Fallback: longest text block that isn't the whole post
      const postText = safeGetText(postEl);
      let longestText = '';
      const candidates = safeQuerySelectorAll(postEl, 'span[dir="ltr"], span.break-words, div[dir="ltr"], span, p, div');
      for (const el of candidates) {
        const text = safeGetText(el);
        if (text.length > longestText.length &&
            text.length >= CONFIG.MIN_CONTENT_LENGTH &&
            text.length < postText.length * 0.8) {
          longestText = text;
        }
      }
      return longestText;
    } catch (err) {
      console.warn('[FeedScraper] extractContent error:', err.message);
      return '';
    }
  }

  /**
   * Extract engagement counts with improved pattern matching
   * @param {Element} postEl
   * @returns {{ reactions: number, comments: number, reposts: number }}
   */
  function extractEngagement(postEl) {
    const result = { reactions: 0, comments: 0, reposts: 0 };

    try {
      // Strategy 1: aria-label on social count buttons/spans
      const socialSelectors = [
        '[class*="social-details"]',
        '[class*="social-count"]',
        '.social-details-social-counts',
      ];
      for (const sel of socialSelectors) {
        const container = safeQuerySelector(postEl, sel);
        if (container) {
          // Reactions: button/span with aria-label containing count + "reaction"
          const reactionEl = safeQuerySelector(container, '[aria-label*="reaction"]');
          if (reactionEl) {
            const label = safeGetAttr(reactionEl, 'aria-label') || safeGetText(reactionEl);
            const m = label.match(/(\d[\d,.]*[km]?)/i);
            if (m) result.reactions = parseCount(m[1]);
          }
          // Comments
          const commentEl = safeQuerySelector(container, '[aria-label*="comment"]');
          if (commentEl) {
            const label = safeGetAttr(commentEl, 'aria-label') || safeGetText(commentEl);
            const m = label.match(/(\d[\d,.]*[km]?)/i);
            if (m) result.comments = parseCount(m[1]);
          }
          // Reposts
          const repostEl = safeQuerySelector(container, '[aria-label*="repost"]');
          if (repostEl) {
            const label = safeGetAttr(repostEl, 'aria-label') || safeGetText(repostEl);
            const m = label.match(/(\d[\d,.]*[km]?)/i);
            if (m) result.reposts = parseCount(m[1]);
          }
          if (result.reactions > 0 || result.comments > 0 || result.reposts > 0) break;
        }
      }

      // Strategy 2: Fallback - scan all text for patterns
      if (result.reactions === 0 && result.comments === 0 && result.reposts === 0) {
        const text = safeGetText(postEl);

        const reactionMatch = text.match(/(\d[\d,.]*[km]?)\s*reaction/i);
        if (reactionMatch) result.reactions = parseCount(reactionMatch[1]);

        const commentMatch = text.match(/(\d[\d,.]*[km]?)\s*comment/i);
        if (commentMatch) result.comments = parseCount(commentMatch[1]);

        const repostMatch = text.match(/(\d[\d,.]*[km]?)\s*repost/i);
        if (repostMatch) result.reposts = parseCount(repostMatch[1]);
      }
    } catch (err) {
      console.warn('[FeedScraper] extractEngagement error:', err.message);
    }

    return result;
  }

  /**
   * Extract timestamp from post
   * @param {Element} postEl
   * @returns {string}
   */
  function extractTimestamp(postEl) {
    try {
      // <time> element
      const timeEl = safeQuerySelector(postEl, 'time');
      if (timeEl) {
        return safeGetAttr(timeEl, 'datetime') || safeGetText(timeEl);
      }

      // Scan <p> and <span> for relative time
      const candidates = safeQuerySelectorAll(postEl, 'p, span');
      for (const el of candidates) {
        const text = safeGetText(el);
        // Match: "1h", "2d", "3w", "1mo", "5m", "30s", "1y"
        if (/^\d+\s*(h|d|w|mo|m|s|y)$/i.test(text)) return text;
        // Match: "1 hour ago", "2 days ago"
        if (/^\d+\s+(second|minute|hour|day|week|month|year)s?\s*ago$/i.test(text)) return text;
        // Match with bullet: "1h •"
        if (/^\d+\s*(h|d|w|mo|m|s|y)\s*[•·]$/i.test(text)) return text.replace(/\s*[•·]$/, '');
      }

      // Fallback: aria-labels
      const labeled = safeQuerySelectorAll(postEl, '[aria-label]');
      for (const el of labeled) {
        const label = safeGetAttr(el, 'aria-label');
        if (label && /\d+\s*(hour|day|week|month|minute|second|year)s?\s*ago/i.test(label)) {
          return label;
        }
      }
    } catch (err) {
      console.warn('[FeedScraper] extractTimestamp error:', err.message);
    }

    return '';
  }

  /**
   * Extract hashtags from post
   * @param {Element} postEl
   * @returns {string[]}
   */
  function extractHashtags(postEl) {
    const tags = new Set();

    try {
      // Links to hashtag pages
      const hashtagLinks = safeQuerySelectorAll(postEl, 'a[href*="hashtag"]');
      hashtagLinks.forEach(a => {
        const tag = safeGetText(a);
        if (tag) tags.add(tag);
      });

      // Parse #hashtags from content
      const content = safeGetText(safeQuerySelector(postEl, '[data-testid="expandable-text-box"]'));
      if (content) {
        const matches = content.match(/#[\w\u00C0-\u024F]+/g);
        if (matches) matches.forEach(tag => tags.add(tag));
      }
    } catch (err) {
      console.warn('[FeedScraper] extractHashtags error:', err.message);
    }

    return Array.from(tags);
  }

  /**
   * Extract shared article if present
   * @param {Element} postEl
   * @returns {{ title: string, url: string } | null}
   */
  function extractArticle(postEl) {
    try {
      const links = safeQuerySelectorAll(postEl, 'a[href]');
      for (const link of links) {
        const href = safeGetAttr(link, 'href') || '';
        // Skip LinkedIn internal links
        if (/linkedin\.com\/(in|company|feed|search|hashtag|notifications|messaging)/.test(href)) continue;
        if (href === '#' || href.startsWith('javascript:')) continue;

        const title = safeGetAttr(link, 'aria-label') || safeGetText(link);
        if (title && title.length > 10 && title.length < 300) {
          return { title: title.split('\n')[0].trim(), url: href };
        }
      }
    } catch (err) {
      console.warn('[FeedScraper] extractArticle error:', err.message);
    }

    return null;
  }

  /**
   * Extract media information from post
   * @param {Element} postEl
   * @returns {{ images: string[], videos: string[], hasMedia: boolean }}
   */
  function extractMedia(postEl) {
    const result = { images: [], videos: [], hasMedia: false };

    try {
      // Images (check multiple attribute patterns)
      const images = safeQuerySelectorAll(postEl, 'img[data-delayed-url], img[src*="media"], img[src*="dms.licdn"]');
      images.forEach(img => {
        const src = safeGetAttr(img, 'data-delayed-url') || safeGetAttr(img, 'src');
        if (src && !src.includes('transparent.gif') && !src.includes('data:image') &&
            !src.includes('/profile-displayphoto') && !src.includes('/company-logo')) {
          result.images.push(src);
        }
      });

      // Videos
      const videos = safeQuerySelectorAll(postEl, 'video, [data-video-url]');
      videos.forEach(vid => {
        const src = safeGetAttr(vid, 'src') || safeGetAttr(vid, 'data-video-url');
        if (src) result.videos.push(src);
      });

      result.hasMedia = result.images.length > 0 || result.videos.length > 0;
    } catch (err) {
      console.warn('[FeedScraper] extractMedia error:', err.message);
    }

    return result;
  }

  // ── Post Parsing ───────────────────────────────────────────────────────

  /**
   * Parse a single feed post element into structured data
   * @param {Element} postEl
   * @param {boolean} expandContent - Whether to expand "see more"
   * @returns {Promise<Object|null>}
   */
  async function parsePost(postEl, expandContent = false) {
    if (!postEl) return null;

    try {
      const author = extractAuthor(postEl);
      const content = await extractContent(postEl, expandContent);

      // Skip only if completely empty — author OR content is enough
      if (!content && !author) {
        // Last resort: check if the element has any substantial text at all
        const fullText = safeGetText(postEl);
        if (fullText.length < 50) return null;
      }

      const componentkey = safeGetAttr(postEl, 'componentkey');
      const dataUrn = safeGetAttr(postEl, 'data-urn');
      const id = generatePostId(author, content, componentkey, dataUrn);

      // Check cache
      const cached = getCachedPost(id);
      if (cached && !expandContent) {
        return { ...cached, fromCache: true };
      }

      const engagement = extractEngagement(postEl);
      const hashtags = extractHashtags(postEl);
      const article = extractArticle(postEl);
      const media = extractMedia(postEl);
      const headline = extractHeadline(postEl);
      const timestamp = extractTimestamp(postEl);

      const post = {
        id,
        author,
        headline,
        content,
        reactions: engagement.reactions,
        comments: engagement.comments,
        reposts: engagement.reposts,
        timestamp,
        hashtags,
        article,
        media,
        hasMedia: media.hasMedia,
        scrapedAt: new Date().toISOString(),
        sessionId: scrapeSessionId,
      };

      // Cache the post
      cachePost(id, post);

      return post;
    } catch (err) {
      console.error('[FeedScraper] parsePost error:', err.message, err.stack);
      return null;
    }
  }

  /**
   * Scrape all currently visible feed posts
   * @param {boolean} expandContent - Expand "see more" for full content
   * @returns {Promise<Object[]>}
   */
  async function scrapeVisiblePosts(expandContent = false) {
    const postEls = findPostElements();
    const posts = [];
    const sessionSeenIds = new Set();

    console.log(`[FeedScraper] Scraping ${postEls.length} post elements...`);

    for (const el of postEls) {
      try {
        const post = await parsePost(el, expandContent);
        if (post && !sessionSeenIds.has(post.id)) {
          sessionSeenIds.add(post.id);
          posts.push(post);
        }
      } catch (err) {
        console.warn('[FeedScraper] Failed to parse post:', err.message);
      }
    }

    console.log(`[FeedScraper] Scraped ${posts.length} unique posts`);
    return posts;
  }

  /**
   * Scroll down to load more posts, then scrape them
   * @param {Object} options
   * @param {number} options.scrollCount - Number of scroll iterations
   * @param {number} options.scrollDelay - Base delay between scrolls
   * @param {boolean} options.expandContent - Expand "see more"
   * @param {function} options.onProgress - Progress callback
   * @param {AbortSignal} options.signal - Abort signal
   * @returns {Promise<Object[]>}
   */
  async function scrapeWithScroll({
    scrollCount = CONFIG.MAX_SCROLL_COUNT,
    scrollDelay = CONFIG.MIN_SCROLL_DELAY,
    expandContent = false,
    onProgress = null,
    signal = null,
  } = {}) {
    const allPosts = new Map();
    let previousCount = 0;
    let noNewPostsCount = 0;

    console.log('[FeedScraper] Starting scroll scrape...', { scrollCount, scrollDelay });

    // Initial scrape
    try {
      const initialPosts = await scrapeVisiblePosts(expandContent);
      initialPosts.forEach(p => allPosts.set(p.id, p));
      previousCount = allPosts.size;
    } catch (err) {
      console.error('[FeedScraper] Initial scrape failed:', err.message);
    }

    // Scroll loop
    for (let i = 0; i < scrollCount; i++) {
      // Check abort
      if (signal?.aborted) {
        console.log('[FeedScraper] Scrape aborted');
        break;
      }

      // Scroll down
      window.scrollBy(0, window.innerHeight);

      // Random delay for human-like behavior
      const jitter = scrollDelay + Math.random() * (CONFIG.MAX_SCROLL_DELAY - CONFIG.MIN_SCROLL_DELAY);
      await delay(jitter, signal);

      // Scrape new posts
      try {
        const newPosts = await scrapeVisiblePosts(expandContent);
        newPosts.forEach(p => allPosts.set(p.id, p));

        // Check if we got new unique posts (compare total accumulated)
        const currentTotal = allPosts.size;
        if (currentTotal <= previousCount) {
          noNewPostsCount++;
          if (noNewPostsCount >= 3) {
            console.log('[FeedScraper] No new posts for 3 scrolls, stopping');
            break;
          }
        } else {
          noNewPostsCount = 0;
        }

        previousCount = currentTotal;
      } catch (err) {
        console.warn('[FeedScraper] Scroll iteration failed:', err.message);
      }

      // Progress callback
      if (onProgress) {
        onProgress({
          scrollIteration: i + 1,
          totalScrolls: scrollCount,
          postsFound: allPosts.size,
          status: 'scrolling',
        });
      }
    }

    // Scroll back to top
    window.scrollTo(0, 0);

    // Cleanup cache
    cleanupCache();

    console.log('[FeedScraper] Scroll scrape complete:', allPosts.size, 'posts');

    if (onProgress) {
      onProgress({
        scrollIteration: scrollCount,
        totalScrolls: scrollCount,
        postsFound: allPosts.size,
        status: 'complete',
      });
    }

    return Array.from(allPosts.values());
  }

  // ── Analysis Functions ─────────────────────────────────────────────────

  /**
   * Detect hiring signals in a post
   * @param {Object} post
   * @returns {string[]}
   */
  function detectHiringSignals(post) {
    const text = ((post?.content || '') + ' ' + (post?.article?.title || '')).toLowerCase();
    return CONFIG.HIRING_SIGNALS.filter(signal => text.includes(signal.toLowerCase()));
  }

  /**
   * Filter posts by keywords
   * @param {Object[]} posts
   * @param {string[]} keywords
   * @returns {Object[]}
   */
  function filterByKeywords(posts, keywords) {
    if (!keywords || keywords.length === 0) return [];

    return posts
      .map(post => {
        const text = ((post?.content || '') + ' ' + (post?.author || '') + ' ' + (post?.article?.title || '')).toLowerCase();
        const matched = keywords.filter(kw => text.includes(kw.toLowerCase()));
        return matched.length > 0 ? { ...post, matchedKeywords: matched } : null;
      })
      .filter(Boolean);
  }

  /**
   * Extract trending hashtags from posts
   * @param {Object[]} posts
   * @returns {{ tag: string, count: number }[]}
   */
  function extractTrendingHashtags(posts) {
    const counts = {};
    posts.forEach(post => {
      (post?.hashtags || []).forEach(tag => {
        const normalized = tag.toLowerCase();
        counts[normalized] = (counts[normalized] || 0) + 1;
      });
    });
    return Object.entries(counts)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Get top posts by engagement
   * @param {Object[]} posts
   * @param {number} limit
   * @returns {Object[]}
   */
  function getTopByEngagement(posts, limit = 10) {
    return posts
      .map(p => ({ ...p, totalEngagement: (p.reactions || 0) + (p.comments || 0) + (p.reposts || 0) }))
      .sort((a, b) => b.totalEngagement - a.totalEngagement)
      .slice(0, limit);
  }

  /**
   * Analyze all posts
   * @param {Object[]} posts
   * @returns {Object}
   */
  function analyzePosts(posts) {
    const keywords = (window.linkedInAutoApply?.settings?.jobKeywords) || [];

    const hiringPosts = posts
      .filter(p => detectHiringSignals(p).length > 0)
      .map(p => ({ ...p, hiringSignals: detectHiringSignals(p) }));

    const keywordMatches = filterByKeywords(posts, keywords);
    const trendingHashtags = extractTrendingHashtags(posts);
    const topEngaged = getTopByEngagement(posts);

    const totalReactions = posts.reduce((sum, p) => sum + (p.reactions || 0), 0);
    const totalComments = posts.reduce((sum, p) => sum + (p.comments || 0), 0);

    return {
      summary: {
        totalPosts: posts.length,
        totalReactions,
        totalComments,
        avgReactions: posts.length ? Math.round(totalReactions / posts.length) : 0,
        avgComments: posts.length ? Math.round(totalComments / posts.length) : 0,
        hiringPostsCount: hiringPosts.length,
        keywordMatchCount: keywordMatches.length,
        uniqueAuthors: new Set(posts.map(p => p.author).filter(Boolean)).size,
        postsWithMedia: posts.filter(p => p.hasMedia).length,
      },
      hiringPosts,
      keywordMatches,
      trendingHashtags: trendingHashtags.slice(0, 20),
      topEngaged,
      allPosts: posts,
      analyzedAt: new Date().toISOString(),
      sessionId: scrapeSessionId,
    };
  }

  // ── Public API ─────────────────────────────────────────────────────────

  /**
   * Start a new scrape session (generates new session ID)
   */
  function startNewSession() {
    scrapeSessionId = `session-${Date.now()}`;
    console.log('[FeedScraper] New session started:', scrapeSessionId);
  }

  /**
   * Get cache statistics
   * @returns {Object}
   */
  function getCacheStats() {
    return {
      size: postCache.size,
      maxSize: CONFIG.MAX_CACHE_SIZE,
      ttl: CONFIG.CACHE_TTL_MS,
    };
  }

  /**
   * Clear the post cache
   */
  function clearCache() {
    postCache.clear();
    seenIds.clear();
    console.log('[FeedScraper] Cache cleared');
  }

  // Expose to global namespace
  window.linkedInAutoApply.feed = {
    // Core functions
    findFeedContainer,
    findPostElements,
    parsePost,
    scrapeVisiblePosts,
    scrapeWithScroll,

    // Analysis
    detectHiringSignals,
    filterByKeywords,
    extractTrendingHashtags,
    getTopByEngagement,
    analyzePosts,

    // Cache management
    getCacheStats,
    clearCache,
    persistCache,

    // Session management
    startNewSession,

    // Config (read-only)
    getConfig: () => ({ ...CONFIG }),
  };

  console.log('[FeedScraper] Module loaded successfully');
})();
