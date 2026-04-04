// feed/feedUI.js - Enhanced UI for feed analysis and engagement
// Features: progress bars, rate limit status, real-time stats, settings panel

window.linkedInAutoApply = window.linkedInAutoApply || {};

(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────
  let analysisPanel = null;
  let isScanning = false;
  let engagementRunning = false;
  let currentProgressEl = null;

  // ── CSS Styles ─────────────────────────────────────────────────────────
  const STYLES = {
    button: `
      position: fixed; z-index: 9999;
      padding: 10px 15px; border: none; border-radius: 5px;
      cursor: pointer; font-weight: bold;
      box-shadow: 0 2px 5px rgba(0,0,0,0.2);
      transition: all 0.3s ease;
    `,
    panel: `
      position: fixed; top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      background: #fff; border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.2);
      z-index: 10001; width: 90vw; max-width: 700px;
      max-height: 85vh; display: flex; flex-direction: column;
    `,
    panelHeader: `
      display: flex; justify-content: space-between; align-items: center;
      padding: 14px 18px; border-bottom: 1px solid #eee;
    `,
    panelBody: `
      padding: 18px; overflow-y: auto; flex: 1;
    `,
    progressBar: `
      width: 100%; height: 8px; background: #e0e0e0;
      border-radius: 4px; overflow: hidden; margin: 10px 0;
    `,
    progressFill: `
      height: 100%; background: linear-gradient(90deg, #0073b1, #00a0dc);
      transition: width 0.3s ease;
    `,
    statCard: `
      display: inline-block; padding: 12px 16px; margin: 4px;
      background: #f8f9fa; border-radius: 6px; text-align: center;
      min-width: 100px;
    `,
    statValue: `
      font-size: 24px; font-weight: bold; color: #0073b1;
    `,
    statLabel: `
      font-size: 12px; color: #666; margin-top: 4px;
    `,
    rateLimitWarning: `
      padding: 10px 14px; background: #fff3cd; border-left: 4px solid #ffc107;
      border-radius: 4px; margin: 10px 0; font-size: 13px;
    `,
    rateLimitOk: `
      padding: 10px 14px; background: #d4edda; border-left: 4px solid #28a745;
      border-radius: 4px; margin: 10px 0; font-size: 13px;
    `,
    postCard: `
      margin-bottom: 10px; padding: 12px;
      background: #f8f9fa; border-radius: 6px;
      border-left: 3px solid #0073b1;
    `,
    badge: `
      display: inline-block; padding: 2px 8px; margin: 2px;
      background: #e8f0fe; border-radius: 12px; font-size: 11px;
      color: #0073b1;
    `,
  };

  // ── Drag Helper ────────────────────────────────────────────────────────

  /**
   * Make a panel draggable by its header.
   * Clears the centering transform on first drag so top/left work correctly.
   */
  function makeDraggable(panel, handle) {
    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;

    handle.style.cursor = 'grab';

    handle.addEventListener('mousedown', (e) => {
      // Ignore clicks on buttons inside the header (e.g. close)
      if (e.target.closest('button')) return;

      isDragging = true;
      handle.style.cursor = 'grabbing';

      // On first drag, convert centered position to explicit top/left
      if (panel.style.transform.includes('translate')) {
        const rect = panel.getBoundingClientRect();
        panel.style.top = rect.top + 'px';
        panel.style.left = rect.left + 'px';
        panel.style.transform = 'none';
      }

      const rect = panel.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;

      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const x = Math.max(0, Math.min(e.clientX - offsetX, window.innerWidth - panel.offsetWidth));
      const y = Math.max(0, Math.min(e.clientY - offsetY, window.innerHeight - 40));
      panel.style.left = x + 'px';
      panel.style.top = y + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        handle.style.cursor = 'grab';
      }
    });
  }

  // ── Button Creation ────────────────────────────────────────────────────

  /**
   * Create the "Analyze Feed" button
   */
  function createAnalyzeFeedButton() {
    // Remove if exists
    const existing = document.getElementById('linkedin-feed-analyze-btn');
    if (existing) existing.remove();

    const button = document.createElement('button');
    button.id = 'linkedin-feed-analyze-btn';
    button.innerText = '📊 Analyze Feed';
    button.style.cssText = `${STYLES.button}
      bottom: 20px; right: 20px;
      background-color: #0073b1; color: #fff;
    `;

    button.addEventListener('mouseenter', () => {
      button.style.backgroundColor = '#005582';
      button.style.transform = 'scale(1.05)';
    });
    button.addEventListener('mouseleave', () => {
      button.style.backgroundColor = '#0073b1';
      button.style.transform = 'scale(1)';
    });
    button.addEventListener('click', startAnalysis);

    document.body.appendChild(button);
    return button;
  }

  /**
   * Create the "Auto Engage" button
   */
  function createAutoEngageButton() {
    // Remove if exists
    const existing = document.getElementById('linkedin-feed-engage-btn');
    if (existing) existing.remove();

    const button = document.createElement('button');
    button.id = 'linkedin-feed-engage-btn';
    button.innerText = '❤️ Auto Engage';
    button.style.cssText = `${STYLES.button}
      bottom: 70px; right: 20px;
      background-color: #2e7d32; color: #fff;
    `;

    button.addEventListener('mouseenter', () => {
      button.style.backgroundColor = '#1b5e20';
      button.style.transform = 'scale(1.05)';
    });
    button.addEventListener('mouseleave', () => {
      button.style.backgroundColor = '#2e7d32';
      button.style.transform = 'scale(1)';
    });
    button.addEventListener('click', toggleAutoEngage);

    document.body.appendChild(button);
    return button;
  }

  /**
   * Create the "Feed Settings" button
   */
  function createSettingsButton() {
    // Remove if exists
    const existing = document.getElementById('linkedin-feed-settings-btn');
    if (existing) existing.remove();

    const button = document.createElement('button');
    button.id = 'linkedin-feed-settings-btn';
    button.innerText = '⚙️ Feed Settings';
    button.style.cssText = `${STYLES.button}
      bottom: 120px; right: 20px;
      background-color: #5f6368; color: #fff;
    `;

    button.addEventListener('mouseenter', () => {
      button.style.backgroundColor = '#3c4043';
      button.style.transform = 'scale(1.05)';
    });
    button.addEventListener('mouseleave', () => {
      button.style.backgroundColor = '#5f6368';
      button.style.transform = 'scale(1)';
    });
    button.addEventListener('click', showSettingsPanel);

    document.body.appendChild(button);
    return button;
  }

  // ── Analysis Functions ─────────────────────────────────────────────────

  /**
   * Start feed analysis
   */
  async function startAnalysis() {
    if (isScanning) return;
    isScanning = true;

    const btn = document.getElementById('linkedin-feed-analyze-btn');
    if (btn) {
      btn.innerText = '🔄 Scanning...';
      btn.disabled = true;
      btn.style.opacity = '0.7';
    }

    showProgressPanel('Feed Analysis', 'Starting scan...');

    try {
      // Start new session
      window.linkedInAutoApply.feed.startNewSession();

      const posts = await window.linkedInAutoApply.feed.scrapeWithScroll({
        scrollCount: 5,
        scrollDelay: 2000,
        expandContent: false,
        onProgress: (progress) => {
          updateProgress(
            `Scrolling ${progress.scrollIteration}/${progress.totalScrolls}... ` +
            `(${progress.postsFound} posts found)`
          );
          updateProgressBar(
            (progress.scrollIteration / progress.totalScrolls) * 100
          );
        },
      });

      const analysis = window.linkedInAutoApply.feed.analyzePosts(posts);

      // Save to storage
      await chrome.storage.local.set({ lastFeedAnalysis: analysis });

      // Notify background
      chrome.runtime.sendMessage({
        action: 'feedAnalysisComplete',
        summary: analysis.summary,
      });

      showAnalysisResults(analysis);
    } catch (err) {
      console.error('[FeedUI] Analysis error:', err);
      updateProgress('❌ Error: ' + err.message);
    }

    isScanning = false;
    if (btn) {
      btn.innerText = '📊 Analyze Feed';
      btn.disabled = false;
      btn.style.opacity = '1';
    }
  }

  // ── Engagement Functions ───────────────────────────────────────────────

  /**
   * Toggle auto engagement
   */
  async function toggleAutoEngage() {
    const btn = document.getElementById('linkedin-feed-engage-btn');
    if (!btn) return;

    if (engagementRunning) {
      // Stop
      window.linkedInAutoApply.feedEngagement.stopEngagement();
      engagementRunning = false;
      btn.innerText = '❤️ Auto Engage';
      btn.style.backgroundColor = '#2e7d32';
      closePanel();
      return;
    }

    // Start
    engagementRunning = true;
    btn.innerText = '⏹️ Stop';
    btn.style.backgroundColor = '#c62828';

    showProgressPanel('Auto Engagement', 'Initializing...');

    // Get settings
    const settings = await getEngagementSettings();

    try {
      const stats = await window.linkedInAutoApply.feedEngagement.autoEngage({
        likeAll: settings.likeAll,
        likeHiring: settings.likeHiring,
        likeKeywordMatches: settings.likeKeywordMatches,
        enableComments: settings.enableComments,
        enableReplies: settings.enableReplies,
        replyToThreads: settings.replyToThreads,
        enableFollows: settings.enableFollows,
        maxLikes: settings.maxLikes,
        maxComments: settings.maxComments,
        maxReplies: settings.maxReplies,
        onProgress: (progress) => {
          if (progress.phase === 'scraping') {
            updateProgress(
              `📥 Scraping: ${progress.scrollIteration}/${progress.totalScrolls} ` +
              `(${progress.postsFound} posts)`
            );
            updateProgressBar((progress.scrollIteration / progress.totalScrolls) * 100);
          } else if (progress.phase === 'engaging') {
            const rateStatus = progress.rateLimits;
            let statusLine =
              `💬 Processing ${progress.currentPost}/${progress.totalPosts}... ` +
              `❤️ ${progress.stats.liked} | 💬 ${progress.stats.commented} | 🔁 ${progress.stats.replied} | ➕ ${progress.stats.followed}`;
            if (progress.waiting) {
              statusLine += `\n⏳ ${progress.waiting}`;
            }
            updateProgress(statusLine);
            updateProgressBar(
              progress.totalPosts > 0
                ? (progress.currentPost / progress.totalPosts) * 100
                : 0
            );
            updateRateLimitStatus(rateStatus);
          }
        },
      });

      updateProgress(
        `✅ Complete! Liked: ${stats.liked}, Commented: ${stats.commented}, ` +
        `Replied: ${stats.replied}, Followed: ${stats.followed}, Skipped: ${stats.skipped}`
      );
      updateProgressBar(100);
    } catch (err) {
      if (err.message !== 'Aborted') {
        updateProgress('❌ Error: ' + err.message);
      }
    }

    engagementRunning = false;
    btn.innerText = '❤️ Auto Engage';
    btn.style.backgroundColor = '#2e7d32';
  }

  /**
   * Get engagement settings from storage or defaults
   */
  async function getEngagementSettings() {
    const defaults = {
      likeAll: true,        // Like all posts by default for better UX
      likeHiring: true,
      likeKeywordMatches: true,
      enableComments: true, // Enable comments by default (now has library)
      enableReplies: true,  // Enable replies by default (AI or library fallback)
      replyToThreads: true, // Reply to people who responded to your comments
      enableFollows: false,
      maxLikes: 30,
      maxComments: 15,
      maxReplies: 8,
    };

    try {
      // Check if chrome.storage is available
      if (typeof chrome === 'undefined' || !chrome.storage) {
        console.warn('[FeedUI] chrome.storage not available, using defaults');
        return defaults;
      }

      const data = await chrome.storage.local.get('feedEngagementSettings');
      if (data?.feedEngagementSettings) {
        return { ...defaults, ...data.feedEngagementSettings };
      }
    } catch (err) {
      if (err.message?.includes('Extension context invalidated')) {
        // Extension was reloaded, use defaults
      } else {
        console.warn('[FeedUI] Failed to load settings:', err);
      }
    }

    return defaults;
  }

  // ── Panel Functions ────────────────────────────────────────────────────

  /**
   * Show progress panel
   */
  function showProgressPanel(title, initialMessage) {
    closePanel();

    analysisPanel = document.createElement('div');
    analysisPanel.id = 'feed-analysis-panel';
    analysisPanel.style.cssText = STYLES.panel;

    // Header
    const header = document.createElement('div');
    header.style.cssText = STYLES.panelHeader;

    const titleEl = document.createElement('h2');
    titleEl.innerText = title;
    titleEl.style.cssText = 'margin: 0; color: #0073b1; font-size: 18px;';
    header.appendChild(titleEl);

    const closeBtn = document.createElement('button');
    closeBtn.innerText = '×';
    closeBtn.style.cssText = 'background: none; border: none; font-size: 22px; cursor: pointer; color: #666;';
    closeBtn.addEventListener('click', closePanel);
    header.appendChild(closeBtn);

    analysisPanel.appendChild(header);
    makeDraggable(analysisPanel, header);

    // Body
    const body = document.createElement('div');
    body.style.cssText = STYLES.panelBody;

    // Progress bar
    const progressContainer = document.createElement('div');
    progressContainer.style.cssText = STYLES.progressBar;

    const progressFill = document.createElement('div');
    progressFill.id = 'feed-progress-fill';
    progressFill.style.cssText = `${STYLES.progressFill} width: 0%;`;
    progressContainer.appendChild(progressFill);

    body.appendChild(progressContainer);

    // Progress text
    const progressText = document.createElement('p');
    progressText.id = 'feed-analysis-progress';
    progressText.style.cssText = 'color: #666; margin: 10px 0; font-size: 14px;';
    progressText.innerText = initialMessage || 'Starting...';
    body.appendChild(progressText);

    // Rate limit status container
    const rateLimitContainer = document.createElement('div');
    rateLimitContainer.id = 'feed-rate-limit-status';
    rateLimitContainer.style.cssText = 'margin-top: 15px;';
    body.appendChild(rateLimitContainer);

    analysisPanel.appendChild(body);
    document.body.appendChild(analysisPanel);

    currentProgressEl = progressText;
  }

  /**
   * Update progress text
   */
  function updateProgress(text) {
    if (currentProgressEl) {
      currentProgressEl.innerText = text;
    }
  }

  /**
   * Update progress bar
   */
  function updateProgressBar(percent) {
    const fill = document.getElementById('feed-progress-fill');
    if (fill) {
      fill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    }
  }

  /**
   * Update rate limit status display
   */
  function updateRateLimitStatus(rateStatus) {
    const container = document.getElementById('feed-rate-limit-status');
    if (!container) return;

    const isOk = (
      rateStatus.likes.hourly.split('/')[0] < rateStatus.likes.hourly.split('/')[1] &&
      rateStatus.likes.daily.split('/')[0] < rateStatus.likes.daily.split('/')[1]
    );

    container.innerHTML = `
      <div style="${isOk ? STYLES.rateLimitOk : STYLES.rateLimitWarning}">
        <strong>⏱️ Rate Limits:</strong><br>
        Likes: ${rateStatus.likes.hourly} (hour) | ${rateStatus.likes.daily} (day)<br>
        Comments: ${rateStatus.comments.hourly} (hour) | ${rateStatus.comments.daily} (day)<br>
        Replies: ${rateStatus.replies?.hourly || '0'} (hour) | ${rateStatus.replies?.daily || '0'} (day)<br>
        Follows: ${rateStatus.follows.hourly} (hour) | ${rateStatus.follows.daily} (day)<br>
        <small>Next hourly reset: ${new Date(rateStatus.nextReset).toLocaleTimeString()}</small>
      </div>
    `;
  }

  /**
   * Show analysis results
   */
  function showAnalysisResults(analysis) {
    closePanel();
    analysisPanel = document.createElement('div');
    analysisPanel.id = 'feed-analysis-panel';
    analysisPanel.style.cssText = STYLES.panel;

    // Header
    const header = document.createElement('div');
    header.style.cssText = STYLES.panelHeader;

    const titleEl = document.createElement('h2');
    titleEl.innerText = '📊 Feed Analysis Results';
    titleEl.style.cssText = 'margin: 0; color: #0073b1; font-size: 18px;';
    header.appendChild(titleEl);

    const closeBtn = document.createElement('button');
    closeBtn.innerText = '×';
    closeBtn.style.cssText = 'background: none; border: none; font-size: 22px; cursor: pointer; color: #666;';
    closeBtn.addEventListener('click', closePanel);
    header.appendChild(closeBtn);

    analysisPanel.appendChild(header);
    makeDraggable(analysisPanel, header);

    // Body
    const body = document.createElement('div');
    body.style.cssText = STYLES.panelBody;

    const s = analysis.summary;

    // Stats cards
    const statsContainer = document.createElement('div');
    statsContainer.style.cssText = 'text-align: center; margin-bottom: 20px;';
    statsContainer.innerHTML = `
      <div style="${STYLES.statCard}">
        <div style="${STYLES.statValue}">${s.totalPosts}</div>
        <div style="${STYLES.statLabel}">Posts</div>
      </div>
      <div style="${STYLES.statCard}">
        <div style="${STYLES.statValue}">${s.hiringPostsCount}</div>
        <div style="${STYLES.statLabel}">Hiring</div>
      </div>
      <div style="${STYLES.statCard}">
        <div style="${STYLES.statValue}">${s.keywordMatchCount}</div>
        <div style="${STYLES.statLabel}">Keyword Match</div>
      </div>
      <div style="${STYLES.statCard}">
        <div style="${STYLES.statValue}">${s.avgReactions}</div>
        <div style="${STYLES.statLabel}">Avg Reactions</div>
      </div>
      <div style="${STYLES.statCard}">
        <div style="${STYLES.statValue}">${s.uniqueAuthors}</div>
        <div style="${STYLES.statLabel}">Authors</div>
      </div>
    `;
    body.appendChild(statsContainer);

    // Hiring posts
    if (analysis.hiringPosts.length > 0) {
      addSectionHtml(
        body,
        `🔔 Hiring Posts (${analysis.hiringPosts.length})`,
        analysis.hiringPosts.slice(0, 10).map(p => createPostCard(p, 'hiring')).join('')
      );
    }

    // Keyword matches
    if (analysis.keywordMatches.length > 0) {
      addSectionHtml(
        body,
        `🎯 Keyword Matches (${analysis.keywordMatches.length})`,
        analysis.keywordMatches.slice(0, 10).map(p => createPostCard(p, 'keyword')).join('')
      );
    }

    // Trending hashtags
    if (analysis.trendingHashtags.length > 0) {
      const tagHtml = analysis.trendingHashtags.slice(0, 15).map(t =>
        `<span style="${STYLES.badge}">${escapeHtml(t.tag)} (${t.count})</span>`
      ).join('');
      addSectionHtml(body, '🏷️ Trending Hashtags', tagHtml);
    }

    // Action buttons
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display: flex; gap: 8px; margin-top: 15px; flex-wrap: wrap;';

    // Export button
    const exportBtn = document.createElement('button');
    exportBtn.innerText = '📥 Export JSON';
    exportBtn.style.cssText = `
      padding: 8px 16px; background: #0073b1; color: #fff;
      border: none; border-radius: 4px; cursor: pointer; font-size: 13px;
    `;
    exportBtn.addEventListener('click', () => exportAnalysis(analysis));
    btnRow.appendChild(exportBtn);

    // Like hiring posts button
    if (analysis.hiringPosts.length > 0) {
      const likeBtn = document.createElement('button');
      likeBtn.innerText = `❤️ Like Hiring (${analysis.hiringPosts.length})`;
      likeBtn.style.cssText = `
        padding: 8px 16px; background: #2e7d32; color: #fff;
        border: none; border-radius: 4px; cursor: pointer; font-size: 13px;
      `;
      likeBtn.addEventListener('click', async () => {
        likeBtn.disabled = true;
        likeBtn.innerText = '⏳ Liking...';
        const stats = await window.linkedInAutoApply.feedEngagement.autoEngage({
          likeHiring: true,
          likeAll: false,
          likeKeywordMatches: false,
          maxLikes: 30,
        });
        likeBtn.innerText = `✅ Done (${stats.liked})`;
      });
      btnRow.appendChild(likeBtn);
    }

    body.appendChild(btnRow);
    analysisPanel.appendChild(body);
    document.body.appendChild(analysisPanel);
  }

  /**
   * Create post card HTML
   */
  function createPostCard(post, type) {
    const borderColor = type === 'hiring' ? '#ffc107' : '#28a745';
    const signals = post.hiringSignals || post.matchedKeywords || [];

    return `
      <div style="${STYLES.postCard} border-left-color: ${borderColor};">
        <div style="display: flex; justify-content: space-between; align-items: start;">
          <div>
            <strong style="color: #333;">${escapeHtml(post.author || 'Unknown')}</strong>
            <span style="color: #666; font-size: 12px; margin-left: 8px;">
              ${escapeHtml(post.headline || '')}
            </span>
            <span style="color: #999; font-size: 11px; margin-left: 8px;">
              ${escapeHtml(post.timestamp || '')}
            </span>
          </div>
          <div style="font-size: 12px; color: #666;">
            ❤️ ${post.reactions || 0} | 💬 ${post.comments || 0} | ➕ ${post.reposts || 0}
          </div>
        </div>
        <div style="margin-top: 8px; font-size: 13px; color: #555; max-height: 60px; overflow: hidden;">
          ${escapeHtml(truncate(post.content, 200))}
        </div>
        ${signals.length > 0 ? `
          <div style="margin-top: 6px;">
            ${signals.map(s => `<span style="${STYLES.badge}">${escapeHtml(s)}</span>`).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }

  /**
   * Show settings panel
   */
  async function showSettingsPanel() {
    closePanel();

    const settings = await getEngagementSettings();
    const aiSettings = await getAISettings();

    analysisPanel = document.createElement('div');
    analysisPanel.id = 'feed-settings-panel';
    analysisPanel.style.cssText = STYLES.panel;

    // Header
    const header = document.createElement('div');
    header.style.cssText = STYLES.panelHeader;

    const titleEl = document.createElement('h2');
    titleEl.innerText = '⚙️ Feed Engagement Settings';
    titleEl.style.cssText = 'margin: 0; color: #0073b1; font-size: 18px;';
    header.appendChild(titleEl);

    const closeBtn = document.createElement('button');
    closeBtn.innerText = '×';
    closeBtn.style.cssText = 'background: none; border: none; font-size: 22px; cursor: pointer; color: #666;';
    closeBtn.addEventListener('click', closePanel);
    header.appendChild(closeBtn);

    analysisPanel.appendChild(header);
    makeDraggable(analysisPanel, header);

    // Body
    const body = document.createElement('div');
    body.style.cssText = STYLES.panelBody;

    // Engagement options
    body.innerHTML = `
      <h3 style="margin: 0 0 14px 0; color: #333; font-size: 17px;">Engagement Options</h3>

      <label style="display: block; margin: 12px 0; font-size: 15px; line-height: 1.5;">
        <input type="checkbox" id="setting-like-all" ${settings.likeAll ? 'checked' : ''}
          style="width: 18px; height: 18px; vertical-align: middle; margin-right: 6px;">
        Like all posts (recommended for maximum reach)
      </label>

      <label style="display: block; margin: 12px 0; font-size: 15px; line-height: 1.5;">
        <input type="checkbox" id="setting-like-hiring" ${settings.likeHiring ? 'checked' : ''}
          style="width: 18px; height: 18px; vertical-align: middle; margin-right: 6px;">
        Like hiring posts (extra engagement with job posts)
      </label>

      <label style="display: block; margin: 12px 0; font-size: 15px; line-height: 1.5;">
        <input type="checkbox" id="setting-like-keyword" ${settings.likeKeywordMatches ? 'checked' : ''}
          style="width: 18px; height: 18px; vertical-align: middle; margin-right: 6px;">
        Like keyword-matching posts (based on your job keywords)
      </label>

      <label style="display: block; margin: 12px 0; font-size: 15px; line-height: 1.5;">
        <input type="checkbox" id="setting-enable-comments" ${settings.enableComments ? 'checked' : ''}
          style="width: 18px; height: 18px; vertical-align: middle; margin-right: 6px;">
        Enable auto-comments 📝
      </label>

      <label style="display: block; margin: 12px 0; font-size: 15px; line-height: 1.5;">
        <input type="checkbox" id="setting-enable-replies" ${settings.enableReplies ? 'checked' : ''}
          style="width: 18px; height: 18px; vertical-align: middle; margin-right: 6px;">
        Enable auto-replies to comments 💬 (AI-generated via Grok)
      </label>

      <label style="display: block; margin: 12px 0 12px 24px; font-size: 14px; line-height: 1.5; color: #555;">
        <input type="checkbox" id="setting-reply-threads" ${settings.replyToThreads ? 'checked' : ''}
          style="width: 16px; height: 16px; vertical-align: middle; margin-right: 6px;">
        Reply to conversation threads 🔄 (respond when someone replies to YOUR comments)
      </label>

      <label style="display: block; margin: 12px 0; font-size: 15px; line-height: 1.5;">
        <input type="checkbox" id="setting-enable-follows" ${settings.enableFollows ? 'checked' : ''}
          style="width: 18px; height: 18px; vertical-align: middle; margin-right: 6px;">
        Follow authors of engaging posts
      </label>

      <h3 style="margin: 22px 0 14px 0; color: #333; font-size: 17px;">Session Limits</h3>

      <label style="display: block; margin: 12px 0; font-size: 15px; line-height: 1.5;">
        Max likes per session:
        <input type="number" id="setting-max-likes" value="${settings.maxLikes}"
          min="1" max="50" style="margin-left: 10px; padding: 6px 10px; width: 70px; font-size: 15px;">
      </label>

      <label style="display: block; margin: 12px 0; font-size: 15px; line-height: 1.5;">
        Max comments per session:
        <input type="number" id="setting-max-comments" value="${settings.maxComments}"
          min="0" max="20" style="margin-left: 10px; padding: 6px 10px; width: 70px; font-size: 15px;">
      </label>

      <label style="display: block; margin: 12px 0; font-size: 15px; line-height: 1.5;">
        Max replies per session:
        <input type="number" id="setting-max-replies" value="${settings.maxReplies}"
          min="0" max="15" style="margin-left: 10px; padding: 6px 10px; width: 70px; font-size: 15px;">
      </label>

      <h3 style="margin: 22px 0 14px 0; color: #333; font-size: 17px;">🤖 AI Comments (xAI Grok)</h3>
      <div style="padding: 14px; background: #e8f4fd; border-radius: 6px; margin-bottom: 16px; font-size: 15px; line-height: 1.6;">
        <div style="margin-bottom: 8px;">
          <strong>AI-generated comments</strong> — each comment is unique, based on the post context
        </div>
        <div style="color: #555; font-size: 14px; line-height: 1.6;">
          🔹 Reads post text, hashtags, engagement metrics<br>
          🔹 Analyzes images in the post (vision)<br>
          🔹 Generates comment in the post's language<br>
          🔹 Default model: xAI Grok 4 Fast ⚡
        </div>
      </div>

      <label style="display: block; margin: 12px 0; font-size: 15px; line-height: 1.5;">
        <input type="checkbox" id="ai-enable" ${aiSettings?.enableAI !== false ? 'checked' : ''}
          style="width: 18px; height: 18px; vertical-align: middle; margin-right: 6px;">
        <strong>Enable AI-generated comments</strong> (requires API key)
      </label>

      <div style="margin-left: 24px; margin-top: 12px;">
        <label style="display: block; margin: 10px 0; font-size: 15px; line-height: 1.5;">
          API Provider:
          <select id="ai-provider" style="margin-left: 10px; padding: 6px 10px; font-size: 15px;">
            <option value="xai" ${aiSettings?.provider === 'xai' ? 'selected' : ''}>xAI Grok (Official) ⚡</option>
            <option value="dashscope" ${aiSettings?.provider === 'dashscope' ? 'selected' : ''}>Alibaba DashScope (Qwen)</option>
            <option value="openrouter" ${aiSettings?.provider === 'openrouter' ? 'selected' : ''}>OpenRouter (Qwen + Grok)</option>
            <option value="local" ${aiSettings?.provider === 'local' ? 'selected' : ''}>Local (Ollama/vLLM)</option>
          </select>
        </label>

        <label style="display: block; margin: 10px 0; font-size: 15px; line-height: 1.5;">
          API Key:
          <input type="password" id="ai-apikey" value="${aiSettings?.apiKey || ''}"
            placeholder="xai-..." style="margin-left: 10px; padding: 6px 10px; width: 240px; font-size: 15px;">
        </label>

        <label style="display: block; margin: 10px 0; font-size: 15px; line-height: 1.5;">
          Model:
          <select id="ai-model" style="margin-left: 10px; padding: 6px 10px; font-size: 15px;">
            ${getModelOptions(aiSettings?.provider, aiSettings?.model)}
          </select>
        </label>

        <label style="display: block; margin: 10px 0; font-size: 15px; line-height: 1.5;">
          <input type="checkbox" id="ai-analyze-images" ${aiSettings?.analyzeImages !== false ? 'checked' : ''}
            style="width: 18px; height: 18px; vertical-align: middle; margin-right: 6px;">
          Analyze images in posts (vision model)
        </label>

        <button id="ai-test-btn" style="
          margin-top: 12px; padding: 8px 16px; background: #6c757d; color: #fff;
          border: none; border-radius: 4px; cursor: pointer; font-size: 14px;
        ">🧪 Test Connection</button>

        <div id="ai-test-result" style="margin-top: 10px; font-size: 14px; line-height: 1.5;"></div>
      </div>

      <h3 style="margin: 22px 0 14px 0; color: #333; font-size: 17px;">Rate Limit Status</h3>
      <div id="settings-rate-status" style="font-size: 14px;"></div>

      <div style="margin-top: 22px; display: flex; gap: 10px; flex-wrap: wrap;">
        <button id="save-settings-btn" style="
          padding: 10px 22px; background: #0073b1; color: #fff;
          border: none; border-radius: 4px; cursor: pointer; font-size: 15px;
        ">💾 Save Settings</button>
        <button id="reset-limits-btn" style="
          padding: 10px 22px; background: #6c757d; color: #fff;
          border: none; border-radius: 4px; cursor: pointer; font-size: 15px;
        ">🔄 Reset Limits</button>
      </div>
    `;

    analysisPanel.appendChild(body);
    document.body.appendChild(analysisPanel);

    // Update rate status
    updateSettingsRateStatus();

    // Event listeners
    document.getElementById('save-settings-btn').addEventListener('click', saveSettings);
    document.getElementById('reset-limits-btn').addEventListener('click', resetLimits);
    document.getElementById('ai-test-btn')?.addEventListener('click', testAIConnection);
    document.getElementById('ai-provider')?.addEventListener('change', onProviderChange);
  }

  /**
   * Update settings rate status display
   */
  function updateSettingsRateStatus() {
    const container = document.getElementById('settings-rate-status');
    if (!container) return;

    const status = window.linkedInAutoApply.feedEngagement.getRateLimitStatus();

    container.innerHTML = `
      <div style="padding: 12px; background: #f8f9fa; border-radius: 6px; font-size: 13px;">
        <div><strong>Likes:</strong> ${status.likes.hourly} (hour) | ${status.likes.daily} (day)</div>
        <div style="margin-top: 6px;"><strong>Comments:</strong> ${status.comments.hourly} (hour) | ${status.comments.daily} (day)</div>
        <div style="margin-top: 6px;"><strong>Replies:</strong> ${status.replies.hourly} (hour) | ${status.replies.daily} (day)</div>
        <div style="margin-top: 6px;"><strong>Follows:</strong> ${status.follows.hourly} (hour) | ${status.follows.daily} (day)</div>
        <div style="margin-top: 8px; color: #666; font-size: 12px;">
          Next hourly reset: ${new Date(status.nextReset).toLocaleTimeString()}
        </div>
      </div>
    `;
  }

  /**
   * Save engagement settings
   */
  async function saveSettings() {
    const settings = {
      likeAll: document.getElementById('setting-like-all')?.checked || false,
      likeHiring: document.getElementById('setting-like-hiring')?.checked || false,
      likeKeywordMatches: document.getElementById('setting-like-keyword')?.checked || false,
      enableComments: document.getElementById('setting-enable-comments')?.checked || false,
      enableReplies: document.getElementById('setting-enable-replies')?.checked || false,
      replyToThreads: document.getElementById('setting-reply-threads')?.checked || false,
      enableFollows: document.getElementById('setting-enable-follows')?.checked || false,
      maxLikes: parseInt(document.getElementById('setting-max-likes')?.value || '30', 10),
      maxComments: parseInt(document.getElementById('setting-max-comments')?.value || '15', 10),
      maxReplies: parseInt(document.getElementById('setting-max-replies')?.value || '8', 10),
    };

    // Save AI settings
    await saveAISettings();

    await chrome.storage.local.set({ feedEngagementSettings: settings });
    alert('✅ Settings saved! AI comments will be generated based on post context.');
    closePanel();
  }

  /**
   * Reset rate limits
   */
  async function resetLimits() {
    if (confirm('Are you sure you want to reset all rate limits?')) {
      window.linkedInAutoApply.feedEngagement.resetDailyStats();
      updateSettingsRateStatus();
      alert('✅ Rate limits reset!');
    }
  }

  /**
   * Get AI settings from storage
   */
  async function getAISettings() {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage) {
        return null;
      }
      const data = await chrome.storage.local.get('feedAISettings');
      return data?.feedAISettings || getDefaultAISettings();
    } catch (err) {
      console.warn('[FeedUI] Failed to load AI settings:', err.message);
      return getDefaultAISettings();
    }
  }

  /**
   * Get default AI settings
   */
  function getDefaultAISettings() {
    return {
      enableAI: true,
      provider: 'xai',          // xAI Grok 4 Fast по умолчанию
      apiKey: '',
      model: 'grok-4-fast',     // Grok 4 Fast
      analyzeImages: true,
      endpoint: '',
    };
  }

  /**
   * Get model options HTML for provider
   */
  function getModelOptions(provider, selectedModel) {
    if (!window.linkedInAutoApply?.feedAI) {
      return '<option value="grok-4-fast">Grok 4 Fast ⚡</option>';
    }

    const models = window.linkedInAutoApply.feedAI.getAvailableModels(provider || 'xai');
    return models.map(m => 
      `<option value="${m.value}" ${m.value === selectedModel ? 'selected' : ''}>${m.label}</option>`
    ).join('');
  }

  /**
   * Test AI connection
   */
  async function testAIConnection() {
    const resultEl = document.getElementById('ai-test-result');
    if (!resultEl) return;

    const provider = document.getElementById('ai-provider')?.value || 'xai';
    const apiKey = document.getElementById('ai-apikey')?.value || '';
    const model = document.getElementById('ai-model')?.value || 'grok-4-fast';

    resultEl.style.color = '#666';
    resultEl.innerText = '🔄 Testing connection...';

    const settings = {
      provider,
      apiKey,
      model,
      enableAI: true,
    };

    const result = await window.linkedInAutoApply.feedAI.testAPIConnection(settings);
    
    resultEl.style.color = result.success ? '#28a745' : '#dc3545';
    resultEl.innerText = result.success ? '✅ ' + result.message : '❌ ' + result.message;
  }

  /**
   * Handle provider change
   */
  function onProviderChange() {
    const provider = document.getElementById('ai-provider')?.value || 'xai';
    const modelSelect = document.getElementById('ai-model');
    if (modelSelect) {
      modelSelect.innerHTML = getModelOptions(provider, null);
    }
  }

  /**
   * Save AI settings
   */
  async function saveAISettings() {
    const settings = {
      enableAI: document.getElementById('ai-enable')?.checked !== false,
      provider: document.getElementById('ai-provider')?.value || 'xai',
      apiKey: document.getElementById('ai-apikey')?.value || '',
      model: document.getElementById('ai-model')?.value || 'grok-4-fast',
      analyzeImages: document.getElementById('ai-analyze-images')?.checked || true,
      endpoint: '',
    };

    if (typeof chrome !== 'undefined' && chrome.storage) {
      await chrome.storage.local.set({ feedAISettings: settings });
    }
    
    return settings;
  }

  // ── Utility Functions ──────────────────────────────────────────────────

  /**
   * Close panel
   */
  function closePanel() {
    const existing = document.getElementById('feed-analysis-panel');
    if (existing) existing.remove();
    existing?.remove();
    const settingsPanel = document.getElementById('feed-settings-panel');
    if (settingsPanel) settingsPanel.remove();
    analysisPanel = null;
    currentProgressEl = null;
  }

  /**
   * Export analysis as JSON
   */
  function exportAnalysis(analysis) {
    const blob = new Blob([JSON.stringify(analysis, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `linkedin-feed-analysis-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Escape HTML
   */
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  /**
   * Truncate string
   */
  function truncate(str, max) {
    if (!str) return '';
    return str.length > max ? str.slice(0, max) + '...' : str;
  }

  /**
   * Add section with HTML
   */
  function addSectionHtml(parent, title, html) {
    const section = document.createElement('div');
    section.style.marginBottom = '20px';

    const h3 = document.createElement('h3');
    h3.innerText = title;
    h3.style.cssText = 'margin: 0 0 10px 0; font-size: 15px; color: #333;';
    section.appendChild(h3);

    const content = document.createElement('div');
    content.innerHTML = html;
    section.appendChild(content);

    parent.appendChild(section);
  }

  // ── Public API ─────────────────────────────────────────────────────────

  window.linkedInAutoApply.feedUI = {
    createAnalyzeFeedButton,
    createAutoEngageButton,
    createSettingsButton,
    startAnalysis,
    toggleAutoEngage,
    showAnalysisResults,
    showSettingsPanel,
    closePanel,
    updateProgress,
    updateProgressBar,
  };

  console.log('[FeedUI] Module loaded successfully');
})();
  