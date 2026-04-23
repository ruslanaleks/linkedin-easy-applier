// feed/profileVisitor.js — Injected into influencer profile/activity tabs by background.js
// Scrapes recent posts, likes them, generates AI comments via messaging to the
// feed tab (which has feedAI loaded), and posts those comments.
// Communicates results back to background.js via chrome.runtime.sendMessage.
//
// Engagement pattern is identical to feedEngagement.js (proven working on feed page).

(async function profileVisitor() {
  'use strict';

  const LOG = (...args) => console.log('[ProfileVisitor]', ...args);
  const WARN = (...args) => console.warn('[ProfileVisitor]', ...args);

  // ── Safe DOM helpers (same pattern as feedEngagement.js) ────────────────

  function safeQuerySelector(root, selector) {
    try { return root ? root.querySelector(selector) : null; } catch { return null; }
  }
  function safeQuerySelectorAll(root, selector) {
    try { return root ? Array.from(root.querySelectorAll(selector)) : []; } catch { return []; }
  }
  function safeGetAttr(el, attr) {
    try { return el ? el.getAttribute(attr) : null; } catch { return null; }
  }
  function safeGetText(el) {
    try { return el ? (el.innerText || el.textContent || '').trim() : ''; } catch { return ''; }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  const delay = ms => new Promise(r => setTimeout(r, ms));
  const randomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  function sendToBackground(msg) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(msg, resp => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(resp);
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  // ── Wait for page to fully load ─────────────────────────────────────────

  // Selectors for post containers — no element-type restriction (activity page
  // may use li, article, section, etc. instead of div)
  const POST_SELECTORS = [
    '[data-urn^="urn:li:activity"]',
    '[data-urn^="urn:li:ugcPost"]',
    '[class*="profile-creator-shared-feed-update"]',
    '[data-testid="main-feed-activity-card"]',
    '.feed-shared-update-v2',
    '[data-id][class*="update"]',
    '[class*="occludable-update"]',
    '[class*="feed-shared-update"]',
  ].join(', ');

  // Clickable elements selector — LinkedIn sometimes uses span/div instead of button
  const CLICKABLE = 'button, [role="button"], span[tabindex="0"], div[tabindex="0"]';

  function queryPosts() {
    // Strategy 1: known selectors
    let posts = safeQuerySelectorAll(document, POST_SELECTORS);
    if (posts.length > 0) {
      LOG(`queryPosts strategy 1 (selectors): ${posts.length} posts`);
      return posts;
    }

    // Strategy 2: any element with data-urn that looks like a post
    const urnEls = safeQuerySelectorAll(document, '[data-urn]');
    const urnPosts = urnEls.filter(el => {
      const urn = safeGetAttr(el, 'data-urn') || '';
      return urn.includes('activity') || urn.includes('ugcPost');
    });
    if (urnPosts.length > 0) {
      LOG(`queryPosts strategy 2 (data-urn): ${urnPosts.length} posts`);
      return urnPosts;
    }

    // Strategy 3: main content area heuristic
    const main = safeQuerySelector(document, 'main, [role="main"], .scaffold-layout__main, .scaffold-layout__content');
    if (main) {
      // On activity page, posts are often in a list structure
      const listItems = safeQuerySelectorAll(main, 'li, article, section, div[class]');
      const filtered = listItems.filter(el => {
        const hasButtons = safeQuerySelectorAll(el, 'button').length >= 2;
        const text = safeGetText(el);
        const hasText = text.length > 50;
        try {
          const rect = el.getBoundingClientRect();
          return hasButtons && hasText && rect.height > 100;
        } catch {
          return hasButtons && hasText;
        }
      });
      if (filtered.length > 0) {
        LOG(`queryPosts strategy 3 (main heuristic): ${filtered.length} posts`);
        return filtered;
      }

      // Strategy 4: deeper scan — grandchildren of main
      const deeper = safeQuerySelectorAll(main, ':scope > div > div > div, :scope > div > div, :scope > div > ul > li');
      const deepFiltered = deeper.filter(el => {
        const hasLikeBtn = safeQuerySelector(el, '[aria-label*="like" i], [aria-label*="react" i], [aria-label*="me gusta" i], [aria-label*="no reaction" i], [aria-label*="нравится" i]');
        return !!hasLikeBtn;
      });
      if (deepFiltered.length > 0) {
        LOG(`queryPosts strategy 4 (deep like-btn heuristic): ${deepFiltered.length} posts`);
        return deepFiltered;
      }
    }

    LOG('queryPosts: no posts found with any strategy');
    return [];
  }

  async function waitForContent(maxWait = 20000) {
    const start = Date.now();
    let scrolledOnce = false;
    while (Date.now() - start < maxWait) {
      const posts = queryPosts();
      if (posts.length > 0) return posts;

      // After 8 seconds with no posts, try scrolling once to trigger lazy loading
      if (!scrolledOnce && Date.now() - start > 8000) {
        LOG('No posts after 8s, scrolling to trigger lazy load...');
        window.scrollTo({ top: 600, behavior: 'smooth' });
        scrolledOnce = true;
      }

      await delay(1000);
    }
    return queryPosts();
  }

  // ── Scroll to load more posts ───────────────────────────────────────────

  async function scrollToLoadPosts(targetCount = 15, maxScrolls = 8) {
    let lastCount = 0;
    let staleRounds = 0;
    for (let i = 0; i < maxScrolls; i++) {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      await delay(randomDelay(2000, 3500));

      const posts = queryPosts();
      LOG(`Scroll ${i + 1}/${maxScrolls}: ${posts.length} posts found`);
      if (posts.length >= targetCount) break;
      if (posts.length === lastCount && posts.length > 0) {
        // Only count as stale if we already have SOME posts
        staleRounds++;
        if (staleRounds >= 3) break;
      } else if (posts.length === lastCount && posts.length === 0) {
        // Still 0 posts — keep scrolling but cap at 5 attempts
        if (i >= 4) break;
      } else {
        staleRounds = 0;
      }
      lastCount = posts.length;
    }
  }

  // ── Parse a single post element ─────────────────────────────────────────

  function parsePostElement(el) {
    const urn = safeGetAttr(el, 'data-urn') || '';
    const dataId = safeGetAttr(el, 'data-id') || '';
    const testId = safeGetAttr(el, 'data-testid') || '';
    const id = urn || dataId || testId || Math.random().toString(36).slice(2);

    // Author — multiple strategies
    let author = '';
    const authorSelectors = [
      '[class*="update-components-actor__name"] span[aria-hidden="true"]',
      '[class*="feed-shared-actor__name"] span[aria-hidden="true"]',
      'a[data-testid="actor-name"]',
      '[class*="actor__name"] span[aria-hidden="true"]',
      '[class*="actor__name"]',
      '[class*="actor-name"]',
      'a[class*="app-aware-link"][href*="/in/"] span',
    ];
    for (const sel of authorSelectors) {
      const authorEl = safeQuerySelector(el, sel);
      if (authorEl) {
        author = safeGetText(authorEl);
        if (author) break;
      }
    }

    // Headline
    let headline = '';
    const headlineEl = safeQuerySelector(el,
      '[class*="update-components-actor__description"], ' +
      '[class*="feed-shared-actor__description"], ' +
      '[class*="actor__description"]'
    );
    if (headlineEl) headline = safeGetText(headlineEl);

    // Content — multiple strategies with innerText fallback
    let content = '';
    const contentSelectors = [
      '[class*="update-components-text"]',
      '[class*="feed-shared-text"]',
      '[data-testid="main-feed-activity-card__commentary"]',
      '[class*="break-words"]',
      '[class*="commentary"]',
      'span[dir="ltr"]',
    ];
    for (const sel of contentSelectors) {
      const contentEl = safeQuerySelector(el, sel);
      if (contentEl) {
        content = safeGetText(contentEl);
        if (content.length > 20) break;
      }
    }

    // "See more" expansion
    const seeMore = safeQuerySelector(el,
      'button[class*="see-more"], button[aria-label*="see more" i], ' +
      'button[aria-label*="más" i], button[aria-label*="ещё" i]'
    );
    if (seeMore) {
      try { seeMore.click(); } catch {}
      for (const sel of contentSelectors) {
        const expanded = safeQuerySelector(el, sel);
        if (expanded) {
          const expandedText = safeGetText(expanded);
          if (expandedText.length > content.length) {
            content = expandedText;
            break;
          }
        }
      }
    }

    // Fallback: use element's innerText if content extraction failed
    if (!content || content.length < 30) {
      const rawText = safeGetText(el);
      if (rawText.length > 50) {
        // Extract a meaningful portion — skip author/button text by taking
        // text after the first ~100 chars (which are usually author/metadata)
        content = rawText.slice(0, 3000);
      }
    }

    const hashtagEls = safeQuerySelectorAll(el, 'a[href*="hashtag"]');
    const hashtags = hashtagEls.map(a => safeGetText(a)).filter(Boolean);

    // Timestamp
    let timestamp = '';
    const timeSelectors = [
      'time',
      '[class*="actor__sub-description"] span[aria-hidden="true"]',
      '[class*="update-components-actor__sub-description"]',
      '[class*="sub-description"] span',
      'time[datetime]',
    ];
    for (const sel of timeSelectors) {
      const timeEl = safeQuerySelector(el, sel);
      if (timeEl) {
        timestamp = safeGetText(timeEl);
        if (timestamp) break;
      }
    }

    // Reactions & comments count
    let reactions = 0, comments = 0;
    const reactionEl = safeQuerySelector(el, '[class*="social-details__social-counts"] span, [class*="social-counts"] span');
    if (reactionEl) {
      const num = safeGetText(reactionEl).replace(/[^\d]/g, '');
      reactions = parseInt(num, 10) || 0;
    }
    const commentCountEl = safeQuerySelector(el, 'button[aria-label*="comment" i]');
    if (commentCountEl) {
      const num = safeGetText(commentCountEl).replace(/[^\d]/g, '');
      comments = parseInt(num, 10) || 0;
    }

    // Media detection — broader selectors
    const hasMedia = !!(
      safeQuerySelector(el, 'img[class*="update-components-image"], img[class*="feed-shared-image"]') ||
      safeQuerySelector(el, 'video') ||
      safeQuerySelector(el, '[class*="feed-shared-image"]') ||
      safeQuerySelector(el, 'img[src*="media"]') ||
      safeQuerySelector(el, '[class*="update-components-image"]') ||
      safeQuerySelector(el, 'article img, [class*="media"] img')
    );

    return {
      id, author, headline, content, hashtags, timestamp,
      reactions, comments, hasMedia,
      media: { images: [], videos: [] },
    };
  }

  // ── Is this post from the current week? ─────────────────────────────────

  function isThisWeek(timestampText) {
    if (!timestampText) return true;
    const t = timestampText.toLowerCase();
    if (/\d+\s*(mo|yr|año|мес|год|лет)/i.test(t)) return false;
    if (/\d+\s*w/i.test(t)) {
      const weeks = parseInt(t.match(/(\d+)\s*w/i)?.[1] || '0', 10);
      return weeks < 1;
    }
    if (/\d+\s*d/i.test(t)) {
      const days = parseInt(t.match(/(\d+)\s*d/i)?.[1] || '0', 10);
      return days <= 7;
    }
    return true;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ENGAGEMENT — identical pattern to feedEngagement.js (proven working)
  // ══════════════════════════════════════════════════════════════════════════

  // ── Like ────────────────────────────────────────────────────────────────

  function isAlreadyLiked(postEl) {
    // "no reaction" button means NOT liked
    const noReaction = safeQuerySelector(postEl,
      'button[aria-label*="no reaction" i], [role="button"][aria-label*="no reaction" i]'
    );
    if (noReaction) return false;

    const btns = safeQuerySelectorAll(postEl, 'button[aria-label], [role="button"][aria-label]');
    for (const b of btns) {
      const label = (safeGetAttr(b, 'aria-label') || '').toLowerCase();
      if (label.includes('like') || label.includes('react') || label.includes('me gusta') || label.includes('нравится')) {
        if (label.includes('unlike') || label.includes('liked')) return true;
        if (safeGetAttr(b, 'aria-pressed') === 'true') return true;
        if (safeGetAttr(b, 'aria-pressed') === 'false') return false;
      }
    }
    return false;
  }

  function findLikeButton(postEl) {
    // Strategy 1: "no reaction" state (newer LinkedIn)
    const noReactionBtn = safeQuerySelector(postEl,
      'button[aria-label*="no reaction" i], [role="button"][aria-label*="no reaction" i]'
    );
    if (noReactionBtn) return noReactionBtn;

    // Strategy 2: Button with "Like"/"React" in aria-label
    const allBtns = safeQuerySelectorAll(postEl, CLICKABLE);
    for (const b of allBtns) {
      const label = (safeGetAttr(b, 'aria-label') || '').toLowerCase();
      const pressed = safeGetAttr(b, 'aria-pressed');
      if ((label.includes('like') || label.includes('react') || label.includes('me gusta') || label.includes('нравится')) &&
          !label.includes('liked') && !label.includes('unlike') && !label.includes('already') &&
          pressed !== 'true') {
        return b;
      }
    }

    // Strategy 3: First button in social actions bar
    const actionBarSelectors = [
      '[class*="social-actions"]',
      '[class*="feed-shared-social-action"]',
      '[class*="social-action"]',
      '[class*="feed-shared-social"]',
      '[data-testid*="social-action"]',
    ];
    for (const sel of actionBarSelectors) {
      const actionBar = safeQuerySelector(postEl, sel);
      if (actionBar) {
        const firstBtn = safeQuerySelector(actionBar, CLICKABLE);
        if (firstBtn) {
          const label = (safeGetAttr(firstBtn, 'aria-label') || '').toLowerCase();
          const pressed = safeGetAttr(firstBtn, 'aria-pressed');
          if (pressed !== 'true' && !label.includes('liked') && !label.includes('unlike')) {
            return firstBtn;
          }
        }
        break;
      }
    }
    return null;
  }

  async function likePost(postEl) {
    if (isAlreadyLiked(postEl)) {
      LOG('Post already liked');
      return false;
    }
    const likeBtn = findLikeButton(postEl);
    if (!likeBtn) {
      LOG('Like button not found');
      // Diagnostic: dump aria-labels of all buttons in post
      const btns = safeQuerySelectorAll(postEl, 'button, [role="button"]');
      LOG(`  Post has ${btns.length} buttons. Labels: ${btns.slice(0, 5).map(b => (safeGetAttr(b, 'aria-label') || safeGetText(b)).slice(0, 30)).join(' | ')}`);
      return false;
    }
    LOG(`Like btn: "${(safeGetAttr(likeBtn, 'aria-label') || '').slice(0, 40)}"`);
    await delay(randomDelay(200, 500));
    likeBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await delay(300);
    likeBtn.click();
    await delay(1000);
    LOG('Liked post');
    return true;
  }

  // ── Comment ─────────────────────────────────────────────────────────────

  function findCommentButton(postEl) {
    const commentPatterns = ['comment', 'comentar', 'comentario', 'комментир', 'комментарий', 'комментировать'];
    const countPattern = /^\d+\s+(comment|comentario|комментари)/i;
    const likePatterns = ['like', 'react', 'me gusta', 'нравится', 'no reaction'];

    // Broader action bar selectors
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

    // Strategy 1: Search by label (action bar first, then full post)
    const searchRoots = actionBar ? [actionBar, postEl] : [postEl];
    for (const root of searchRoots) {
      const btns = safeQuerySelectorAll(root, CLICKABLE);
      for (const b of btns) {
        const label = (safeGetAttr(b, 'aria-label') || '').toLowerCase();
        const text = safeGetText(b).toLowerCase();
        const match = commentPatterns.some(p => label.includes(p) || text.includes(p));
        if (match && !countPattern.test(text)) return b;
      }
      if (root === actionBar) continue;
    }

    // Strategy 2: Positional — Comment is 2nd in social actions bar
    if (actionBar) {
      const barItems = safeQuerySelectorAll(actionBar, ':scope > *');
      const barBtns = barItems.length >= 3 ? barItems : safeQuerySelectorAll(actionBar, CLICKABLE);
      for (let i = 0; i < barBtns.length; i++) {
        const el = barBtns[i];
        const target = el.matches?.('button, [role="button"]') ? el : safeQuerySelector(el, 'button, [role="button"]') || el;
        const label = (safeGetAttr(target, 'aria-label') || '').toLowerCase();
        const text = safeGetText(target).toLowerCase();
        const isLike = likePatterns.some(p => label.includes(p) || text.includes(p));
        if (isLike) {
          const nextItem = barBtns[i + 1];
          if (nextItem) {
            const nextBtn = nextItem.matches?.('button, [role="button"]') ? nextItem : safeQuerySelector(nextItem, 'button, [role="button"]');
            return nextBtn || nextItem;
          }
        }
      }
      if (barItems.length >= 3) {
        const second = barItems[1];
        return safeQuerySelector(second, 'button, [role="button"]') || second;
      }
    }

    // Strategy 3: SVG icon detection (comment = chat/speech-bubble icon)
    const svgs = safeQuerySelectorAll(postEl, 'svg');
    for (const svg of svgs) {
      const use = safeQuerySelector(svg, 'use');
      const href = safeGetAttr(use, 'href') || safeGetAttr(use, 'xlink:href') || '';
      if (href.includes('comment') || href.includes('speech') || href.includes('chat')) {
        let parent = svg.parentElement;
        for (let d = 0; d < 5 && parent && parent !== postEl; d++) {
          if (parent.matches?.('button, [role="button"]') || parent.tagName === 'BUTTON') {
            return parent;
          }
          parent = parent.parentElement;
        }
      }
    }

    return null;
  }

  function findCommentInput(postEl, commentBtn) {
    // Search postEl then ancestors up to 3 levels
    const searchRoots = [postEl];
    let ancestor = postEl.parentElement;
    for (let lvl = 0; lvl < 3 && ancestor; lvl++) {
      searchRoots.push(ancestor);
      ancestor = ancestor.parentElement;
    }

    for (const root of searchRoots) {
      const tb = safeQuerySelector(root, '[role="textbox"][contenteditable]');
      if (tb) return tb;
      const composerSelectors = [
        '[class*="comment-compose"]',
        '[class*="comments-comment-box"]',
        '[class*="comment-texteditor"]',
        '[class*="comments-comment-texteditor"]',
        '[class*="comment-box"]',
        '[class*="ql-editor"]',
      ];
      for (const sel of composerSelectors) {
        const composer = safeQuerySelector(root, sel);
        if (composer) {
          const editable = safeQuerySelector(composer, '[contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"]');
          if (editable) return editable;
        }
      }
      const editable = safeQuerySelector(root, 'div[contenteditable="true"], div[contenteditable="plaintext-only"]');
      if (editable) return editable;
    }

    // Check activeElement
    if (document.activeElement) {
      const ce = document.activeElement.getAttribute?.('contenteditable');
      if (ce === 'true' || ce === 'plaintext-only') return document.activeElement;
    }

    // Look in modal/dialog
    const modal = document.querySelector('[role="dialog"], .artdeco-modal');
    if (modal) {
      const modalInput = safeQuerySelector(modal, '[role="textbox"][contenteditable], div[contenteditable="true"], div[contenteditable="plaintext-only"]');
      if (modalInput) return modalInput;
    }

    // Broad scan: closest contenteditable to the comment button
    if (commentBtn) {
      const allEditable = safeQuerySelectorAll(document, '[role="textbox"][contenteditable], div[contenteditable="true"], div[contenteditable="plaintext-only"]');
      if (allEditable.length > 0) {
        const btnRect = commentBtn.getBoundingClientRect();
        let bestDist = Infinity, best = null;
        for (const el of allEditable) {
          try {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            const dist = Math.abs(rect.top - btnRect.bottom);
            if (dist < bestDist) { bestDist = dist; best = el; }
          } catch {}
        }
        if (bestDist <= 500) return best;
      }
    }

    return null;
  }

  // Submit button labels (multi-locale)
  const SUBMIT_LABELS = ['post', 'post comment', 'submit comment', 'reply',
    'publicar', 'comentar', 'responder', 'comment',
    'опубликовать', 'ответить', 'комментировать'];

  function isSubmitButton(btn) {
    const text = safeGetText(btn).toLowerCase();
    const label = (safeGetAttr(btn, 'aria-label') || '').toLowerCase();
    return SUBMIT_LABELS.includes(text) || SUBMIT_LABELS.includes(label) ||
           label.includes('post a comment');
  }

  function findSubmitButton(postEl) {
    function searchIn(root) {
      const btns = safeQuerySelectorAll(root, 'button');
      for (const btn of btns) {
        if (isSubmitButton(btn)) return btn;
      }
      return null;
    }

    // Strategy 1: Walk up from contenteditable input
    const input = safeQuerySelector(postEl, '[role="textbox"][contenteditable="true"], div[contenteditable="true"], textarea');
    if (input) {
      let parent = input.parentElement;
      for (let depth = 0; depth < 8 && parent && parent !== postEl; depth++) {
        const btn = searchIn(parent);
        if (btn) return btn;
        parent = parent.parentElement;
      }
    }

    // Strategy 2: Comment composer area
    const composer = safeQuerySelector(postEl, '[class*="comments-comment-box"], [class*="comment-compose"], [class*="comments-comment-texteditor"]');
    if (composer) {
      const btn = searchIn(composer);
      if (btn) return btn;
    }

    // Strategy 3: Full post element
    const btn = searchIn(postEl);
    if (btn) return btn;

    // Strategy 4: Modal/dialog
    const modal = document.querySelector('[role="dialog"], .artdeco-modal');
    if (modal) {
      const modalBtn = searchIn(modal);
      if (modalBtn) return modalBtn;
    }

    return null;
  }

  /**
   * Comment on a post — uses EXACT same pattern as feedEngagement.js
   */
  async function commentOnPost(postEl, commentText) {
    // 1. Click comment button to open composer
    let commentBtn = findCommentButton(postEl);
    if (!commentBtn && postEl.parentElement) {
      commentBtn = findCommentButton(postEl.parentElement);
    }
    if (!commentBtn) {
      WARN('No comment button found');
      const btns = safeQuerySelectorAll(postEl, 'button, [role="button"]');
      WARN(`  Post has ${btns.length} buttons. Labels: ${btns.slice(0, 5).map(b => (safeGetAttr(b, 'aria-label') || safeGetText(b)).slice(0, 30)).join(' | ')}`);
      return false;
    }

    LOG('Opening comment field...');
    commentBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await delay(300);
    commentBtn.click();
    await delay(randomDelay(1500, 2500));

    // 2. Find comment input (8 attempts, re-click at attempt 3)
    let input = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      input = findCommentInput(postEl, commentBtn);
      if (input) break;
      if (attempt === 2) {
        LOG('Re-clicking comment button...');
        commentBtn.click();
        await delay(randomDelay(1500, 2500));
      } else {
        await delay(1000);
      }
    }
    if (!input) { WARN('No comment input found'); return false; }

    LOG('Comment input found, typing...');

    // 3. Focus and clear
    input.focus();
    input.dispatchEvent(new Event('focus', { bubbles: true }));
    await delay(300);

    if (input.hasAttribute('contenteditable')) {
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
    }
    await delay(200);

    // 4. Type — EXACT feedEngagement pattern:
    //    keydown → keypress → execCommand → beforeinput → input → keyup
    input.focus();
    for (let i = 0; i < commentText.length; i++) {
      const char = commentText[i];

      input.dispatchEvent(new KeyboardEvent('keydown', { key: char, code: 'Key' + char.toUpperCase(), bubbles: true, cancelable: true }));
      input.dispatchEvent(new KeyboardEvent('keypress', { key: char, code: 'Key' + char.toUpperCase(), bubbles: true, cancelable: true }));

      document.execCommand('insertText', false, char);

      input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: char }));
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: char }));

      input.dispatchEvent(new KeyboardEvent('keyup', { key: char, code: 'Key' + char.toUpperCase(), bubbles: true }));

      await delay(randomDelay(50, 150));
    }

    // Post-typing events (same as feedEngagement)
    input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: commentText }));
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: commentText }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: commentText }));

    LOG('Comment typed, waiting for submit button...');
    await delay(randomDelay(800, 1500));

    // 5. Find submit button and wait for it to become enabled (10 attempts)
    let submitBtn = null;
    let submitReady = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      submitBtn = findSubmitButton(postEl);

      if (submitBtn) {
        const isDisabled = submitBtn.disabled || submitBtn.hasAttribute('disabled');
        const isAriaDisabled = safeGetAttr(submitBtn, 'aria-disabled') === 'true';

        LOG(`Submit attempt ${attempt + 1}: "${safeGetText(submitBtn)}" disabled=${isDisabled} aria-disabled=${isAriaDisabled}`);

        if (!isDisabled && !isAriaDisabled) {
          submitReady = true;
          break;
        }

        // Nudge — same as feedEngagement: append+remove space to force state cycle
        input.focus();
        document.execCommand('insertText', false, ' ');
        await delay(100);
        document.execCommand('delete', false, null);
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
        await delay(100);
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: commentText }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        LOG(`Submit attempt ${attempt + 1}: not found`);
      }

      await delay(600);
    }

    if (!submitReady) {
      WARN('Submit button not ready after 10 attempts');
      return false;
    }

    // 6. Click submit — full pointer + mouse event sequence (same as feedEngagement)
    LOG('Clicking submit...');
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

    LOG('Comment posted');
    return true;
  }

  // ── AI comment generation via background relay ──────────────────────────

  async function requestAIComment(post) {
    try {
      const resp = await sendToBackground({
        action: 'profileVisitorGenerateComment',
        post: {
          author: post.author,
          headline: post.headline,
          content: (post.content || '').slice(0, 2000),
          hashtags: post.hashtags,
          hasMedia: post.hasMedia,
          reactions: post.reactions,
          comments: post.comments,
          timestamp: post.timestamp,
        },
      });
      return resp?.comment || null;
    } catch (err) {
      WARN('AI comment request failed:', err.message);
      return null;
    }
  }

  // ── Main flow ───────────────────────────────────────────────────────────

  async function run() {
    LOG('Starting profile visit...');
    LOG('URL:', location.href);
    LOG('Document title:', document.title);

    sendToBackground({ action: 'profileVisitorStatus', status: 'started', url: location.href }).catch(() => {});

    // 1. Wait for content to load
    await delay(randomDelay(2000, 4000));
    let postEls = await waitForContent();
    LOG(`Found ${postEls.length} initial posts`);

    if (postEls.length === 0) {
      // Diagnostic: dump page structure
      const main = safeQuerySelector(document, 'main, [role="main"]');
      if (main) {
        const children = safeQuerySelectorAll(main, ':scope > *');
        LOG(`Page <main> has ${children.length} direct children: ${children.map(c => `${c.tagName}.${(c.className || '').toString().slice(0, 30)}`).join(', ')}`);
        const allBtns = safeQuerySelectorAll(main, 'button');
        LOG(`Page has ${allBtns.length} buttons in main. Sample labels: ${allBtns.slice(0, 8).map(b => (safeGetAttr(b, 'aria-label') || safeGetText(b)).slice(0, 25)).join(' | ')}`);
      } else {
        LOG('No <main> element found on page');
      }
      const urnEls = safeQuerySelectorAll(document, '[data-urn]');
      LOG(`Page has ${urnEls.length} elements with data-urn. Tags: ${urnEls.slice(0, 5).map(e => `${e.tagName}[${(safeGetAttr(e, 'data-urn') || '').slice(0, 30)}]`).join(', ')}`);
    }

    // 2. Scroll to load more
    await scrollToLoadPosts(15, 6);
    postEls = queryPosts();
    LOG(`After scrolling: ${postEls.length} posts`);

    // 3. Parse posts — keep all that have social action buttons or meaningful content
    const allPosts = [];
    let filteredCount = 0;
    for (const el of postEls) {
      const post = parsePostElement(el);

      // Only filter out truly empty elements (no content, no media, no buttons)
      const hasSocialButtons = !!(
        safeQuerySelector(el, '[aria-label*="like" i], [aria-label*="react" i], [aria-label*="no reaction" i], [aria-label*="нравится" i]') ||
        safeQuerySelector(el, '[aria-label*="comment" i], [aria-label*="комментир" i]')
      );

      if (!post.content && !post.hasMedia && !hasSocialButtons) {
        filteredCount++;
        continue;
      }

      post._el = el;
      allPosts.push(post);
    }
    if (filteredCount > 0) {
      LOG(`Filtered out ${filteredCount} empty posts (no content, no media, no social buttons)`);
    }

    const weeklyPosts = allPosts.filter(p => isThisWeek(p.timestamp));
    LOG(`This week's posts: ${weeklyPosts.length} / ${allPosts.length} total`);

    // Diagnostic: log why posts were filtered
    if (allPosts.length > weeklyPosts.length) {
      const oldPosts = allPosts.filter(p => !isThisWeek(p.timestamp));
      for (const p of oldPosts.slice(0, 3)) {
        LOG(`  Filtered old post: "${p.author}" ts="${p.timestamp}" id=${p.id.slice(0, 30)}`);
      }
    }
    // Log sample of kept posts
    for (const p of weeklyPosts.slice(0, 3)) {
      LOG(`  Keeping post: "${p.author}" ts="${p.timestamp}" content=${p.content.length}chars hasMedia=${p.hasMedia}`);
    }

    // 4. Load already-engaged post IDs
    let engagedPostIds = new Set();
    try {
      const data = await chrome.storage.local.get(['profileVisitorEngaged', 'profileVisitorSeen']);
      if (data?.profileVisitorEngaged) {
        engagedPostIds = new Set(data.profileVisitorEngaged);
        LOG(`Loaded ${engagedPostIds.size} previously engaged post IDs`);
      } else if (data?.profileVisitorSeen) {
        LOG('Clearing stale profileVisitorSeen data');
        await chrome.storage.local.remove('profileVisitorSeen');
      }
    } catch {}

    const results = {
      url: location.href,
      totalPosts: allPosts.length,
      weeklyPosts: weeklyPosts.length,
      liked: 0,
      commented: 0,
      skipped: 0,
      errors: 0,
      posts: [],
    };

    // 5. Engage with each weekly post: LIKE then COMMENT, 20-30s cooldown
    //    Max 5 posts per profile to stay within timeout and avoid spam detection
    const MAX_POSTS_PER_VISIT = 5;
    const postsToEngage = weeklyPosts.slice(0, MAX_POSTS_PER_VISIT);
    LOG(`Will engage with up to ${postsToEngage.length} posts (max ${MAX_POSTS_PER_VISIT})`);

    for (let idx = 0; idx < postsToEngage.length; idx++) {
      const post = postsToEngage[idx];
      const postResult = { id: post.id, author: post.author, liked: false, commented: false, skipped: false };

      if (engagedPostIds.has(post.id)) {
        LOG(`Skipping already-engaged: ${post.id}`);
        postResult.skipped = true;
        results.skipped++;
        results.posts.push(postResult);
        continue;
      }

      LOG(`\n── Engaging post ${idx + 1}/${postsToEngage.length}: "${post.author}" id=${post.id.slice(0, 30)} ──`);

      // Scroll post into view
      post._el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await delay(randomDelay(2000, 3000));

      // ── LIKE ──
      try {
        const liked = await likePost(post._el);
        postResult.liked = liked;
        if (liked) results.liked++;
        LOG(`Like result: ${liked}`);
      } catch (err) {
        WARN('Like failed:', err.message);
        results.errors++;
      }

      // Pause between like and comment
      const likeToComment = randomDelay(8000, 12000);
      LOG(`Waiting ${Math.round(likeToComment / 1000)}s before commenting...`);
      await delay(likeToComment);

      // ── COMMENT ──
      try {
        LOG('Requesting AI comment...');
        const comment = await requestAIComment(post);
        if (comment) {
          LOG(`AI comment (${comment.length} chars): "${comment.slice(0, 80)}..."`);
          const commented = await commentOnPost(post._el, comment);
          postResult.commented = commented;
          if (commented) results.commented++;
          LOG(`Comment result: ${commented}`);
        } else {
          LOG('No AI comment generated (check if feed tab is open with feedAI loaded)');
        }
      } catch (err) {
        WARN('Comment failed:', err.message);
        results.errors++;
      }

      // Mark engaged only if something worked
      if (postResult.liked || postResult.commented) {
        engagedPostIds.add(post.id);
        LOG(`Marked as engaged: ${post.id.slice(0, 30)}`);
      }
      results.posts.push(postResult);

      // ── 20-30s COOLDOWN before next post ──
      if (idx < postsToEngage.length - 1) {
        const cooldown = randomDelay(20000, 30000);
        LOG(`Cooldown: ${Math.round(cooldown / 1000)}s before next post...`);
        await delay(cooldown);
      }
    }

    // 6. Persist engaged IDs (keep last 500)
    try {
      const arr = [...engagedPostIds].slice(-500);
      await chrome.storage.local.set({ profileVisitorEngaged: arr });
    } catch {}

    // 7. Report results
    LOG('Profile visit complete:', JSON.stringify(results, null, 2));
    sendToBackground({
      action: 'profileVisitorComplete',
      results,
    }).catch(() => {});

    return results;
  }

  // Run
  run().catch(err => {
    WARN('Profile visit failed:', err);
    sendToBackground({
      action: 'profileVisitorComplete',
      results: { error: err.message },
    }).catch(() => {});
  });
})();
