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

  const POST_SELECTORS = [
    'div[data-urn^="urn:li:activity"]',
    'div[data-urn^="urn:li:ugcPost"]',
    '[class*="profile-creator-shared-feed-update"]',
    '[data-testid="main-feed-activity-card"]',
    '.feed-shared-update-v2',
    '[data-id][class*="update"]',
  ].join(', ');

  function queryPosts() {
    let posts = document.querySelectorAll(POST_SELECTORS);
    if (posts.length > 0) return posts;
    const main = document.querySelector('main, [role="main"], .scaffold-layout__main');
    if (main) {
      const candidates = main.querySelectorAll(':scope > div > div, :scope > div');
      const filtered = [...candidates].filter(el => {
        const hasButtons = el.querySelectorAll('button').length >= 2;
        const hasText = (el.innerText || '').length > 50;
        const rect = el.getBoundingClientRect();
        return hasButtons && hasText && rect.height > 100;
      });
      if (filtered.length > 0) return filtered;
    }
    return posts;
  }

  async function waitForContent(maxWait = 15000) {
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      const posts = queryPosts();
      if (posts.length > 0) return posts;
      await delay(1000);
    }
    return queryPosts();
  }

  // ── Scroll to load more posts ───────────────────────────────────────────

  async function scrollToLoadPosts(targetCount = 15, maxScrolls = 8) {
    let lastCount = 0;
    let staleRounds = 0;
    for (let i = 0; i < maxScrolls; i++) {
      const posts = queryPosts();
      if (posts.length >= targetCount) break;
      if (posts.length === lastCount) {
        staleRounds++;
        if (staleRounds >= 3) break;
      } else {
        staleRounds = 0;
      }
      lastCount = posts.length;
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      await delay(randomDelay(2000, 3500));
    }
  }

  // ── Parse a single post element ─────────────────────────────────────────

  function parsePostElement(el) {
    const urn = el.getAttribute('data-urn') || '';
    const id = urn || el.getAttribute('data-testid') || Math.random().toString(36).slice(2);

    let author = '';
    const authorEl = el.querySelector(
      '[class*="update-components-actor__name"] span[aria-hidden="true"], ' +
      '[class*="feed-shared-actor__name"] span[aria-hidden="true"], ' +
      'a[data-testid="actor-name"], ' +
      '[class*="actor__name"]'
    );
    if (authorEl) author = authorEl.textContent.trim();

    let headline = '';
    const headlineEl = el.querySelector(
      '[class*="update-components-actor__description"], ' +
      '[class*="feed-shared-actor__description"], ' +
      '[class*="actor__description"]'
    );
    if (headlineEl) headline = headlineEl.textContent.trim();

    let content = '';
    const contentEl = el.querySelector(
      '[class*="update-components-text"], ' +
      '[class*="feed-shared-text"], ' +
      '[data-testid="main-feed-activity-card__commentary"]'
    );
    if (contentEl) content = contentEl.textContent.trim();

    const seeMore = el.querySelector(
      'button[class*="see-more"], button[aria-label*="see more"], ' +
      'button[aria-label*="más"], button[aria-label*="ещё"]'
    );
    if (seeMore) {
      seeMore.click();
      const expanded = el.querySelector(
        '[class*="update-components-text"], [class*="feed-shared-text"]'
      );
      if (expanded) content = expanded.textContent.trim();
    }

    const hashtagEls = el.querySelectorAll('a[href*="hashtag"]');
    const hashtags = [...hashtagEls].map(a => a.textContent.trim()).filter(Boolean);

    let timestamp = '';
    const timeEl = el.querySelector(
      'time, [class*="actor__sub-description"] span[aria-hidden="true"], ' +
      '[class*="update-components-actor__sub-description"]'
    );
    if (timeEl) timestamp = timeEl.textContent.trim();

    let reactions = 0, comments = 0;
    const reactionEl = el.querySelector('[class*="social-details__social-counts"] span');
    if (reactionEl) {
      const num = reactionEl.textContent.replace(/[^\d]/g, '');
      reactions = parseInt(num, 10) || 0;
    }
    const commentCountEl = el.querySelector('button[aria-label*="comment" i]');
    if (commentCountEl) {
      const num = commentCountEl.textContent.replace(/[^\d]/g, '');
      comments = parseInt(num, 10) || 0;
    }

    const hasMedia = !!(el.querySelector('img[class*="update-components-image"], video, [class*="feed-shared-image"]'));

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
    const noReaction = postEl.querySelector(
      'button[aria-label*="no reaction" i], [role="button"][aria-label*="no reaction" i]'
    );
    if (noReaction) return false;

    const btns = postEl.querySelectorAll('button[aria-label], [role="button"][aria-label]');
    for (const b of btns) {
      const label = (b.getAttribute('aria-label') || '').toLowerCase();
      if (label.includes('like') || label.includes('react') || label.includes('me gusta') || label.includes('нравится')) {
        if (label.includes('unlike') || label.includes('liked')) return true;
        if (b.getAttribute('aria-pressed') === 'true') return true;
        if (b.getAttribute('aria-pressed') === 'false') return false;
      }
    }
    return false;
  }

  function findLikeButton(postEl) {
    // Strategy 1: "no reaction" state
    const noReactionBtn = postEl.querySelector(
      'button[aria-label*="no reaction" i], [role="button"][aria-label*="no reaction" i]'
    );
    if (noReactionBtn) return noReactionBtn;

    // Strategy 2: Button with "Like"/"React" in aria-label
    const allBtns = postEl.querySelectorAll('button, [role="button"]');
    for (const b of allBtns) {
      const label = (b.getAttribute('aria-label') || '').toLowerCase();
      const pressed = b.getAttribute('aria-pressed');
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
      '[data-testid*="social-action"]',
    ];
    for (const sel of actionBarSelectors) {
      const actionBar = postEl.querySelector(sel);
      if (actionBar) {
        const firstBtn = actionBar.querySelector('button, [role="button"]');
        if (firstBtn) {
          const label = (firstBtn.getAttribute('aria-label') || '').toLowerCase();
          const pressed = firstBtn.getAttribute('aria-pressed');
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
      return false;
    }
    LOG(`Like btn: "${(likeBtn.getAttribute('aria-label') || '').slice(0, 40)}"`);
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

    // Strategy 1: Button with comment-related aria-label or text
    const btns = postEl.querySelectorAll('button, [role="button"]');
    for (const b of btns) {
      const label = (b.getAttribute('aria-label') || '').toLowerCase();
      const text = (b.textContent || '').trim().toLowerCase();
      const match = commentPatterns.some(p => label.includes(p) || text.includes(p));
      if (match && !countPattern.test(text)) return b;
    }

    // Strategy 2: Positional — Comment is 2nd in social actions bar
    const actionBarSelectors = [
      '[class*="social-actions"]',
      '[class*="feed-shared-social-action"]',
      '[class*="social-action"]',
      '[data-testid*="social-action"]',
    ];
    for (const sel of actionBarSelectors) {
      const actionBar = postEl.querySelector(sel);
      if (!actionBar) continue;
      const barItems = actionBar.querySelectorAll(':scope > *');
      const barBtns = barItems.length >= 3 ? barItems : actionBar.querySelectorAll('button, [role="button"]');
      for (let i = 0; i < barBtns.length; i++) {
        const el = barBtns[i];
        const target = el.matches?.('button, [role="button"]') ? el : el.querySelector('button, [role="button"]') || el;
        const label = (target.getAttribute('aria-label') || '').toLowerCase();
        const text = (target.textContent || '').toLowerCase();
        if (likePatterns.some(p => label.includes(p) || text.includes(p))) {
          const nextItem = barBtns[i + 1];
          if (nextItem) {
            return nextItem.matches?.('button, [role="button"]') ? nextItem : nextItem.querySelector('button, [role="button"]') || nextItem;
          }
        }
      }
      if (barItems.length >= 3) {
        const second = barItems[1];
        return second.querySelector('button, [role="button"]') || second;
      }
      break;
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
      const tb = root.querySelector('[role="textbox"][contenteditable]');
      if (tb) return tb;
      const composerSelectors = [
        '[class*="comment-compose"]',
        '[class*="comments-comment-box"]',
        '[class*="comment-texteditor"]',
        '[class*="comments-comment-texteditor"]',
      ];
      for (const sel of composerSelectors) {
        const composer = root.querySelector(sel);
        if (composer) {
          const editable = composer.querySelector('[contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"]');
          if (editable) return editable;
        }
      }
      const editable = root.querySelector('div[contenteditable="true"], div[contenteditable="plaintext-only"]');
      if (editable) return editable;
    }

    // Check activeElement
    if (document.activeElement) {
      const ce = document.activeElement.getAttribute?.('contenteditable');
      if (ce === 'true' || ce === 'plaintext-only') return document.activeElement;
    }

    // Broad scan: closest contenteditable to the comment button
    if (commentBtn) {
      const allEditable = document.querySelectorAll('[role="textbox"][contenteditable], div[contenteditable="true"], div[contenteditable="plaintext-only"]');
      if (allEditable.length > 0) {
        const btnRect = commentBtn.getBoundingClientRect();
        let bestDist = Infinity, best = null;
        for (const el of allEditable) {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          const dist = Math.abs(rect.top - btnRect.bottom);
          if (dist < bestDist) { bestDist = dist; best = el; }
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
    const text = (btn.textContent || '').trim().toLowerCase();
    const label = (btn.getAttribute('aria-label') || '').toLowerCase();
    return SUBMIT_LABELS.includes(text) || SUBMIT_LABELS.includes(label) ||
           label.includes('post a comment');
  }

  function findSubmitButton(postEl) {
    function searchIn(root) {
      const btns = root.querySelectorAll('button');
      for (const btn of btns) {
        if (isSubmitButton(btn)) return btn;
      }
      return null;
    }

    // Strategy 1: Walk up from contenteditable input
    const input = postEl.querySelector('[role="textbox"][contenteditable="true"], div[contenteditable="true"], textarea');
    if (input) {
      let parent = input.parentElement;
      for (let depth = 0; depth < 8 && parent && parent !== postEl; depth++) {
        const btn = searchIn(parent);
        if (btn) return btn;
        parent = parent.parentElement;
      }
    }

    // Strategy 2: Comment composer area
    const composer = postEl.querySelector('[class*="comments-comment-box"], [class*="comment-compose"], [class*="comments-comment-texteditor"]');
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
    if (!commentBtn) { WARN('No comment button found'); return false; }

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
        const isAriaDisabled = submitBtn.getAttribute('aria-disabled') === 'true';

        LOG(`Submit attempt ${attempt + 1}: "${(submitBtn.textContent || '').trim()}" disabled=${isDisabled} aria-disabled=${isAriaDisabled}`);

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

    sendToBackground({ action: 'profileVisitorStatus', status: 'started', url: location.href }).catch(() => {});

    // 1. Wait for content to load
    await delay(randomDelay(2000, 4000));
    let postEls = await waitForContent();
    LOG(`Found ${postEls.length} initial posts`);

    // 2. Scroll to load more
    await scrollToLoadPosts(15, 6);
    postEls = queryPosts();
    LOG(`After scrolling: ${postEls.length} posts`);

    // 3. Parse and filter to this week's posts
    const allPosts = [];
    for (const el of postEls) {
      const post = parsePostElement(el);
      if (!post.content && !post.hasMedia) continue;
      post._el = el;
      allPosts.push(post);
    }

    const weeklyPosts = allPosts.filter(p => isThisWeek(p.timestamp));
    LOG(`This week's posts: ${weeklyPosts.length} / ${allPosts.length} total`);

    // 4. Load already-engaged post IDs
    let engagedPostIds = new Set();
    try {
      const data = await chrome.storage.local.get(['profileVisitorEngaged', 'profileVisitorSeen']);
      if (data?.profileVisitorEngaged) {
        engagedPostIds = new Set(data.profileVisitorEngaged);
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

      // Scroll post into view
      post._el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await delay(randomDelay(2000, 3000));

      // ── LIKE ──
      try {
        const liked = await likePost(post._el);
        postResult.liked = liked;
        if (liked) results.liked++;
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
        const comment = await requestAIComment(post);
        if (comment) {
          LOG(`AI comment: "${comment.slice(0, 80)}..."`);
          const commented = await commentOnPost(post._el, comment);
          postResult.commented = commented;
          if (commented) results.commented++;
        } else {
          LOG('No AI comment generated');
        }
      } catch (err) {
        WARN('Comment failed:', err.message);
        results.errors++;
      }

      // Mark engaged only if something worked
      if (postResult.liked || postResult.commented) {
        engagedPostIds.add(post.id);
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
    LOG('Profile visit complete:', results);
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
