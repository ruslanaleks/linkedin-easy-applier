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

  async function waitForContent(maxWait = 15000) {
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      // Look for post containers on the activity page
      const posts = document.querySelectorAll(
        'div[data-urn^="urn:li:activity"], div[data-urn^="urn:li:ugcPost"], ' +
        '[class*="profile-creator-shared-feed-update"], ' +
        '[data-testid="main-feed-activity-card"]'
      );
      if (posts.length > 0) return posts;
      await delay(1000);
    }
    return document.querySelectorAll(
      'div[data-urn^="urn:li:activity"], div[data-urn^="urn:li:ugcPost"], ' +
      '[class*="profile-creator-shared-feed-update"], ' +
      '[data-testid="main-feed-activity-card"]'
    );
  }

  // ── Scroll to load more posts ───────────────────────────────────────────

  async function scrollToLoadPosts(targetCount = 15, maxScrolls = 8) {
    let lastCount = 0;
    let staleRounds = 0;
    for (let i = 0; i < maxScrolls; i++) {
      const posts = document.querySelectorAll(
        'div[data-urn^="urn:li:activity"], div[data-urn^="urn:li:ugcPost"], ' +
        '[class*="profile-creator-shared-feed-update"], ' +
        '[data-testid="main-feed-activity-card"]'
      );
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

  function findCommentInput(postEl) {
    // Wait for the comment composer to appear
    const inputs = postEl.querySelectorAll('[role="textbox"][contenteditable="true"]');
    if (inputs.length > 0) return inputs[inputs.length - 1]; // last = newest
    // Broader search
    const composerAreas = postEl.querySelectorAll(
      '[class*="comment-compose"] [contenteditable="true"], ' +
      '[class*="comments-comment-box"] [contenteditable="true"], ' +
      '.ql-editor[contenteditable="true"]'
    );
    if (composerAreas.length > 0) return composerAreas[composerAreas.length - 1];
    return null;
  }

  async function typeText(input, text) {
    input.focus();
    await delay(200);

    // Clear any existing content
    input.innerHTML = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await delay(100);

    // Type character by character
    for (const char of text) {
      document.execCommand('insertText', false, char);
      await delay(randomDelay(40, 120));
    }

    // Fire final events
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await delay(300);
  }

  function findSubmitButton(postEl) {
    const btns = postEl.querySelectorAll('button, [role="button"]');
    for (const b of btns) {
      const label = (b.getAttribute('aria-label') || '').toLowerCase();
      const text = (b.textContent || '').toLowerCase().trim();
      if (label.includes('post comment') || label.includes('submit') ||
          text === 'post' || text === 'publicar' || text === 'опубликовать' ||
          text === 'post comment' || text === 'submit') {
        if (!b.disabled && b.getAttribute('aria-disabled') !== 'true') return b;
      }
    }
    return null;
  }

  async function commentOnPost(postEl, commentText) {
    // 1. Click comment button to open composer
    const commentBtn = findCommentButton(postEl);
    if (!commentBtn) { WARN('No comment button found'); return false; }
    commentBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await delay(randomDelay(300, 600));
    commentBtn.click();
    await delay(randomDelay(1500, 2500));

    // 2. Find the comment input
    let input = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      input = findCommentInput(postEl);
      if (input) break;
      await delay(800);
    }
    if (!input) {
      // Try broader search (comment composer might be outside post element)
      input = document.querySelector(
        '[role="textbox"][contenteditable="true"][aria-label*="comment" i], ' +
        '[role="textbox"][contenteditable="true"][aria-label*="коммент" i]'
      );
    }
    if (!input) { WARN('No comment input found'); return false; }

    // 3. Type the comment
    await typeText(input, commentText);

    // 4. Find and click submit
    await delay(randomDelay(500, 1000));
    let submitBtn = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      submitBtn = findSubmitButton(postEl);
      if (!submitBtn) {
        // Search near the input
        let ancestor = input;
        for (let up = 0; up < 8 && ancestor; up++) {
          ancestor = ancestor.parentElement;
          if (ancestor) {
            const btn = findSubmitButton(ancestor);
            if (btn) { submitBtn = btn; break; }
          }
        }
      }
      if (submitBtn) break;
      await delay(500);
    }

    if (!submitBtn) { WARN('No submit button found'); return false; }

    submitBtn.click();
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
    postEls = document.querySelectorAll(
      'div[data-urn^="urn:li:activity"], div[data-urn^="urn:li:ugcPost"], ' +
      '[class*="profile-creator-shared-feed-update"], ' +
      '[data-testid="main-feed-activity-card"]'
    );
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
