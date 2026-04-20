// feed/profileVisitor.js — Injected into influencer profile/activity tabs by background.js
// Scrapes recent posts, likes them, generates AI comments via messaging to the
// feed tab (which has feedAI loaded), and posts those comments.
// Communicates results back to background.js via chrome.runtime.sendMessage.

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
    // Heuristic fallback: look for divs with like+comment buttons inside main
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

    // Author (on a profile page the author is usually the profile owner)
    let author = '';
    const authorEl = el.querySelector(
      '[class*="update-components-actor__name"] span[aria-hidden="true"], ' +
      '[class*="feed-shared-actor__name"] span[aria-hidden="true"], ' +
      'a[data-testid="actor-name"], ' +
      '[class*="actor__name"]'
    );
    if (authorEl) author = authorEl.textContent.trim();

    // Headline
    let headline = '';
    const headlineEl = el.querySelector(
      '[class*="update-components-actor__description"], ' +
      '[class*="feed-shared-actor__description"], ' +
      '[class*="actor__description"]'
    );
    if (headlineEl) headline = headlineEl.textContent.trim();

    // Content text
    let content = '';
    const contentEl = el.querySelector(
      '[class*="update-components-text"], ' +
      '[class*="feed-shared-text"], ' +
      '[data-testid="main-feed-activity-card__commentary"]'
    );
    if (contentEl) content = contentEl.textContent.trim();

    // Expand "see more" if present
    const seeMore = el.querySelector(
      'button[class*="see-more"], button[aria-label*="see more"], ' +
      'button[aria-label*="más"], button[aria-label*="ещё"]'
    );
    if (seeMore) {
      seeMore.click();
      // Re-read content after expansion
      const expanded = el.querySelector(
        '[class*="update-components-text"], [class*="feed-shared-text"]'
      );
      if (expanded) content = expanded.textContent.trim();
    }

    // Hashtags
    const hashtagEls = el.querySelectorAll('a[href*="hashtag"]');
    const hashtags = [...hashtagEls].map(a => a.textContent.trim()).filter(Boolean);

    // Timestamp
    let timestamp = '';
    const timeEl = el.querySelector(
      'time, [class*="actor__sub-description"] span[aria-hidden="true"], ' +
      '[class*="update-components-actor__sub-description"]'
    );
    if (timeEl) timestamp = timeEl.textContent.trim();

    // Engagement counts
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

    // Media
    const hasMedia = !!(el.querySelector('img[class*="update-components-image"], video, [class*="feed-shared-image"]'));

    return {
      id, author, headline, content, hashtags, timestamp,
      reactions, comments, hasMedia,
      media: { images: [], videos: [] },
    };
  }

  // ── Is this post from the current week? ─────────────────────────────────

  function isThisWeek(timestampText) {
    if (!timestampText) return true; // assume yes if we can't parse
    const t = timestampText.toLowerCase();
    // LinkedIn shows "Xh", "Xd" for recent, "Xw" for weeks, "Xmo" for months
    if (/\d+\s*(mo|yr|año|мес|год|год|лет)/i.test(t)) return false;
    if (/\d+\s*w/i.test(t)) {
      const weeks = parseInt(t.match(/(\d+)\s*w/i)?.[1] || '0', 10);
      return weeks < 1; // "1w" is borderline — include it
    }
    // "Xd" where X <= 7 is this week
    if (/\d+\s*d/i.test(t)) {
      const days = parseInt(t.match(/(\d+)\s*d/i)?.[1] || '0', 10);
      return days <= 7;
    }
    // Hours, minutes, "just now" → definitely this week
    return true;
  }

  // ── Like a post ─────────────────────────────────────────────────────────

  function isAlreadyLiked(postEl) {
    const btns = postEl.querySelectorAll('button[aria-label], [role="button"][aria-label]');
    for (const b of btns) {
      const label = (b.getAttribute('aria-label') || '').toLowerCase();
      if (label.includes('like') || label.includes('react') || label.includes('me gusta') || label.includes('нравится')) {
        if (label.includes('unlike') || label.includes('liked')) return true;
        if (b.getAttribute('aria-pressed') === 'true') return true;
      }
    }
    return false;
  }

  function findLikeButton(postEl) {
    // "no reaction" button = not yet liked
    const noReaction = postEl.querySelector(
      'button[aria-label*="no reaction" i], [role="button"][aria-label*="no reaction" i]'
    );
    if (noReaction) return noReaction;

    const btns = postEl.querySelectorAll('button, [role="button"]');
    for (const b of btns) {
      const label = (b.getAttribute('aria-label') || '').toLowerCase();
      const pressed = b.getAttribute('aria-pressed');
      if ((label.includes('like') || label.includes('react') || label.includes('me gusta') || label.includes('нравится')) &&
          !label.includes('liked') && !label.includes('unlike') &&
          pressed !== 'true') {
        return b;
      }
    }
    return null;
  }

  async function likePost(postEl) {
    if (isAlreadyLiked(postEl)) return false;
    const btn = findLikeButton(postEl);
    if (!btn) return false;
    btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await delay(randomDelay(300, 600));
    btn.click();
    LOG('Liked post');
    return true;
  }

  // ── Comment on a post ───────────────────────────────────────────────────

  function findCommentButton(postEl) {
    const btns = postEl.querySelectorAll('button, [role="button"]');
    for (const b of btns) {
      const label = (b.getAttribute('aria-label') || '').toLowerCase();
      const text = (b.textContent || '').toLowerCase().trim();
      if (label.includes('comment') || label.includes('comentar') || label.includes('комментир') ||
          text === 'comment' || text === 'comentar' || text === 'комментировать') {
        return b;
      }
    }
    // Fallback: second action button in social bar
    const actionBar = postEl.querySelector('[class*="social-actions"], [data-testid*="social-action"]');
    if (actionBar) {
      const actionBtns = actionBar.querySelectorAll('button, [role="button"]');
      if (actionBtns.length >= 2) return actionBtns[1];
    }
    return null;
  }

  function findCommentInput(postEl, commentBtn) {
    // Search inside postEl, then ancestors up to 3 levels
    const searchRoots = [postEl];
    let ancestor = postEl.parentElement;
    for (let lvl = 0; lvl < 3 && ancestor; lvl++) {
      searchRoots.push(ancestor);
      ancestor = ancestor.parentElement;
    }

    for (const root of searchRoots) {
      const inputs = root.querySelectorAll(
        '[role="textbox"][contenteditable="true"], ' +
        '[role="textbox"][contenteditable="plaintext-only"], ' +
        'div[contenteditable="true"], ' +
        '[class*="comment-compose"] [contenteditable="true"], ' +
        '[class*="comments-comment-box"] [contenteditable="true"], ' +
        '.ql-editor[contenteditable="true"]'
      );
      if (inputs.length > 0) return inputs[inputs.length - 1];
    }

    // Check document.activeElement (clicking Comment may have focused the input)
    if (document.activeElement) {
      const active = document.activeElement;
      const ce = active.getAttribute?.('contenteditable');
      if (ce === 'true' || ce === 'plaintext-only') return active;
    }

    // Broad document scan: find the most recently visible contenteditable
    // that appeared near the comment button's viewport position
    if (commentBtn) {
      const allEditable = document.querySelectorAll(
        '[role="textbox"][contenteditable], div[contenteditable="true"], div[contenteditable="plaintext-only"]'
      );
      if (allEditable.length > 0) {
        const btnRect = commentBtn.getBoundingClientRect();
        let bestDist = Infinity;
        let best = null;
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

  async function typeText(input, text) {
    input.focus();
    input.dispatchEvent(new Event('focus', { bubbles: true }));
    await delay(300);

    // Clear existing content
    if (input.hasAttribute('contenteditable')) {
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
    } else {
      input.innerHTML = '';
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    }
    await delay(200);

    // Type character by character with full keystroke simulation
    for (const char of text) {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: char, code: 'Key' + char.toUpperCase(), bubbles: true, cancelable: true }));
      input.dispatchEvent(new KeyboardEvent('keypress', { key: char, code: 'Key' + char.toUpperCase(), bubbles: true, cancelable: true }));
      document.execCommand('insertText', false, char);
      input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: char }));
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: char }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: char, code: 'Key' + char.toUpperCase(), bubbles: true }));
      await delay(randomDelay(50, 150));
    }

    // Post-typing events so LinkedIn's framework picks up the change
    input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: text }));
    await delay(300);
  }

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

    // Strategy 1: Walk up from the contenteditable input
    const input = postEl.querySelector(
      '[role="textbox"][contenteditable="true"], div[contenteditable="true"], textarea'
    );
    if (input) {
      let parent = input.parentElement;
      for (let depth = 0; depth < 8 && parent && parent !== postEl; depth++) {
        const btn = searchIn(parent);
        if (btn) return btn;
        parent = parent.parentElement;
      }
    }

    // Strategy 2: Look inside comment composer area
    const composer = postEl.querySelector(
      '[class*="comments-comment-box"], [class*="comment-compose"], [class*="comments-comment-texteditor"]'
    );
    if (composer) {
      const btn = searchIn(composer);
      if (btn) return btn;
    }

    // Strategy 3: Search the full post element
    const btn = searchIn(postEl);
    if (btn) return btn;

    // Strategy 4: Look in modal/dialog
    const modal = document.querySelector('[role="dialog"], .artdeco-modal');
    if (modal) {
      const modalBtn = searchIn(modal);
      if (modalBtn) return modalBtn;
    }

    return null;
  }

  async function commentOnPost(postEl, commentText) {
    // 1. Click comment button to open composer
    let commentBtn = findCommentButton(postEl);
    if (!commentBtn && postEl.parentElement) {
      commentBtn = findCommentButton(postEl.parentElement);
    }
    if (!commentBtn) { WARN('No comment button found'); return false; }
    commentBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await delay(randomDelay(300, 600));
    commentBtn.click();
    await delay(randomDelay(1500, 2500));

    // 2. Find the comment input with retries
    let input = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      input = findCommentInput(postEl, commentBtn);
      if (input) break;
      // After 2 failed attempts, re-click comment button (toggle issue)
      if (attempt === 2) {
        LOG('Re-clicking comment button...');
        commentBtn.click();
        await delay(randomDelay(1500, 2500));
      } else {
        await delay(1000);
      }
    }
    if (!input) { WARN('No comment input found'); return false; }

    // 3. Type the comment
    await typeText(input, commentText);
    await delay(randomDelay(800, 1500));

    // 4. Find submit button and wait for it to become enabled
    let submitBtn = null;
    let submitReady = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      submitBtn = findSubmitButton(postEl);
      if (submitBtn) {
        const isDisabled = submitBtn.disabled || submitBtn.hasAttribute('disabled');
        const isAriaDisabled = submitBtn.getAttribute('aria-disabled') === 'true';
        if (!isDisabled && !isAriaDisabled) {
          submitReady = true;
          break;
        }
        // Button disabled — nudge LinkedIn's editor by typing and deleting a space
        input.focus();
        document.execCommand('insertText', false, ' ');
        await delay(100);
        document.execCommand('delete', false, null);
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
        await delay(100);
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: commentText }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await delay(600);
    }

    if (!submitReady) { WARN('No submit button found'); return false; }

    // 5. Click submit with full pointer + mouse event sequence
    submitBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await delay(200);
    submitBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    submitBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await delay(50);
    submitBtn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
    submitBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    submitBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    submitBtn.click(); // fallback native click
    await delay(randomDelay(1000, 2000));
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

    // Notify background we started
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

    // 4. Load already-seen post IDs from state
    let seenPostIds = new Set();
    try {
      const data = await chrome.storage.local.get('profileVisitorSeen');
      const arr = data?.profileVisitorSeen || [];
      seenPostIds = new Set(arr);
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

    // 5. Engage with each weekly post
    for (const post of weeklyPosts) {
      const postResult = { id: post.id, author: post.author, liked: false, commented: false, skipped: false };

      if (seenPostIds.has(post.id)) {
        LOG(`Skipping already-seen post: ${post.id}`);
        postResult.skipped = true;
        results.skipped++;
        results.posts.push(postResult);
        continue;
      }

      // Scroll post into view
      post._el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await delay(randomDelay(1000, 2000));

      // Like
      try {
        const liked = await likePost(post._el);
        postResult.liked = liked;
        if (liked) results.liked++;
      } catch (err) {
        WARN('Like failed:', err.message);
        results.errors++;
      }

      await delay(randomDelay(2000, 4000));

      // Generate AI comment and post it
      try {
        const comment = await requestAIComment(post);
        if (comment) {
          LOG(`AI comment for "${post.author}": ${comment}`);
          const commented = await commentOnPost(post._el, comment);
          postResult.commented = commented;
          if (commented) results.commented++;
        } else {
          LOG('No AI comment generated, skipping comment');
        }
      } catch (err) {
        WARN('Comment failed:', err.message);
        results.errors++;
      }

      // Mark as seen
      seenPostIds.add(post.id);
      results.posts.push(postResult);

      // Human-like delay between posts
      await delay(randomDelay(5000, 12000));
    }

    // 6. Persist seen IDs (keep last 500)
    try {
      const arr = [...seenPostIds].slice(-500);
      await chrome.storage.local.set({ profileVisitorSeen: arr });
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
