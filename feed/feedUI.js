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
      background: #fff; color: #222; border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.2);
      z-index: 10001; width: 90vw; max-width: 700px;
      max-height: 85vh; display: flex; flex-direction: column;
      color-scheme: light;
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

  // ── Theme ──────────────────────────────────────────────────────────────

  const UI_SETTINGS_KEY = 'feedUiSettings';
  const DEFAULT_UI_SETTINGS = { theme: 'auto' };

  async function loadUiSettings() {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage) return { ...DEFAULT_UI_SETTINGS };
      const data = await chrome.storage.local.get(UI_SETTINGS_KEY);
      return { ...DEFAULT_UI_SETTINGS, ...(data?.[UI_SETTINGS_KEY] || {}) };
    } catch {
      return { ...DEFAULT_UI_SETTINGS };
    }
  }

  async function saveUiSettings(partial) {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage) return;
      const current = await loadUiSettings();
      await chrome.storage.local.set({ [UI_SETTINGS_KEY]: { ...current, ...partial } });
    } catch {}
  }

  function resolveTheme(pref) {
    if (pref === 'light' || pref === 'dark') return pref;
    try {
      return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  }

  // Inject a single global <style> with rules for both panels; selectors are
  // scoped to panel IDs + [data-theme="dark"] so light stays untouched.
  function ensureThemeStyle() {
    if (document.getElementById('feed-panel-theme-style')) return;
    const style = document.createElement('style');
    style.id = 'feed-panel-theme-style';
    style.textContent = `
      #feed-settings-panel[data-theme="dark"],
      #feed-queue-panel[data-theme="dark"],
      #feed-analysis-panel[data-theme="dark"],
      #feed-weekly-report-panel[data-theme="dark"] {
        background: #1b1f23 !important;
        color: #e6e6e6 !important;
        color-scheme: dark !important;
      }
      #feed-settings-panel[data-theme="dark"] h1,
      #feed-settings-panel[data-theme="dark"] h2,
      #feed-settings-panel[data-theme="dark"] h3,
      #feed-settings-panel[data-theme="dark"] h4,
      #feed-settings-panel[data-theme="dark"] label,
      #feed-settings-panel[data-theme="dark"] strong,
      #feed-settings-panel[data-theme="dark"] span,
      #feed-settings-panel[data-theme="dark"] div,
      #feed-settings-panel[data-theme="dark"] p {
        color: #e6e6e6;
      }
      #feed-settings-panel[data-theme="dark"] input[type="text"],
      #feed-settings-panel[data-theme="dark"] input[type="password"],
      #feed-settings-panel[data-theme="dark"] input[type="number"],
      #feed-settings-panel[data-theme="dark"] textarea,
      #feed-settings-panel[data-theme="dark"] select {
        background: #2a3036 !important;
        color: #e6e6e6 !important;
        border-color: #4a5056 !important;
      }
      #feed-settings-panel[data-theme="dark"] input::placeholder,
      #feed-settings-panel[data-theme="dark"] textarea::placeholder {
        color: #8892a0 !important;
      }
      #feed-settings-panel[data-theme="dark"] .inf-tier-block,
      #feed-settings-panel[data-theme="dark"] .hashtag-cat-row,
      #feed-settings-panel[data-theme="dark"] #settings-rate-status > div,
      #feed-settings-panel[data-theme="dark"] #scoring-settings-container,
      #feed-settings-panel[data-theme="dark"] #hashtag-categories-container,
      #feed-settings-panel[data-theme="dark"] #day-keywords-container {
        background: #262b30 !important;
      }
      #feed-settings-panel[data-theme="dark"] .inf-row {
        border-bottom-color: #3a4146 !important;
      }
      #feed-settings-panel[data-theme="dark"] hr {
        border-color: #3a4146 !important;
      }
      /* Queue cards: override light pastel backgrounds with dark equivalents,
         keep the colored left-border accent untouched. */
      #feed-queue-panel[data-theme="dark"] > div > div[style*="background: #f5f0ff"],
      #feed-queue-panel[data-theme="dark"] > div > div[style*="background: #fff5f5"],
      #feed-queue-panel[data-theme="dark"] > div > div[style*="background: #fff8f0"],
      #feed-queue-panel[data-theme="dark"] > div > div[style*="background: #fffdf0"],
      #feed-queue-panel[data-theme="dark"] > div > div[style*="background: #f8f9fa"] {
        background: #262b30 !important;
        color: #e6e6e6 !important;
      }
      /* Weekly report dark overrides */
      #feed-weekly-report-panel[data-theme="dark"] div[style*="background:#f0f4ff"],
      #feed-weekly-report-panel[data-theme="dark"] div[style*="background:#f0fff4"],
      #feed-weekly-report-panel[data-theme="dark"] div[style*="background:#fff8e1"],
      #feed-weekly-report-panel[data-theme="dark"] div[style*="background:#fce4ec"],
      #feed-weekly-report-panel[data-theme="dark"] div[style*="background:#f8f9fa"] {
        background: #262b30 !important;
      }
      #feed-weekly-report-panel[data-theme="dark"] table tr {
        border-color: #3a4146 !important;
      }
      #feed-weekly-report-panel[data-theme="dark"] div[style*="background:#fff"] {
        background: #2a3036 !important;
      }
      #feed-weekly-report-panel[data-theme="dark"] th,
      #feed-weekly-report-panel[data-theme="dark"] td,
      #feed-weekly-report-panel[data-theme="dark"] strong,
      #feed-weekly-report-panel[data-theme="dark"] span,
      #feed-weekly-report-panel[data-theme="dark"] div {
        color: #e6e6e6;
      }
    `;
    document.head.appendChild(style);
  }

  async function applyPanelTheme(panelEl) {
    if (!panelEl) return;
    ensureThemeStyle();
    const uiSettings = await loadUiSettings();
    const theme = resolveTheme(uiSettings.theme);
    panelEl.dataset.theme = theme;
    // Also set color-scheme inline so native form controls follow, even if
    // the panel's own cssText still hard-codes color-scheme: light.
    panelEl.style.colorScheme = theme;
    if (theme === 'dark') {
      panelEl.style.background = '#1b1f23';
      panelEl.style.color = '#e6e6e6';
    }
  }

  // React to OS theme changes while a panel is open (auto mode only)
  try {
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', async () => {
      const uiSettings = await loadUiSettings();
      if (uiSettings.theme !== 'auto') return;
      ['feed-settings-panel', 'feed-queue-panel', 'feed-analysis-panel', 'feed-weekly-report-panel'].forEach(id => {
        const el = document.getElementById(id);
        if (el) applyPanelTheme(el);
      });
    });
  } catch {}

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
   * Create the "Auto Like" button
   */
  function createAutoLikeButton() {
    const existing = document.getElementById('linkedin-autolike-btn');
    if (existing) existing.remove();

    const button = document.createElement('button');
    button.id = 'linkedin-autolike-btn';
    button.innerText = '👍 Auto Like';
    button.style.cssText = `${STYLES.button}
      bottom: 120px; right: 20px;
      background-color: #e91e63; color: #fff;
    `;

    button.addEventListener('mouseenter', () => {
      button.style.backgroundColor = '#c2185b';
      button.style.transform = 'scale(1.05)';
    });
    button.addEventListener('mouseleave', () => {
      if (!autoLikeRunning) {
        button.style.backgroundColor = '#e91e63';
      }
      button.style.transform = 'scale(1)';
    });
    button.addEventListener('click', toggleAutoLike);

    document.body.appendChild(button);
    return button;
  }

  let autoLikeRunning = false;

  async function toggleAutoLike() {
    const btn = document.getElementById('linkedin-autolike-btn');
    if (!btn) return;

    if (autoLikeRunning) {
      window.linkedInAutoApply.autoLike.stop();
      autoLikeRunning = false;
      btn.innerText = '👍 Auto Like';
      btn.style.backgroundColor = '#e91e63';
      hideAutoLikeDashboard();
      return;
    }

    // Mutual exclusion
    if (engagementRunning) {
      alert('Auto Engage is currently running. Stop it before starting Auto Like.');
      return;
    }

    autoLikeRunning = true;
    btn.innerText = '⏹️ Stop Likes';
    btn.style.backgroundColor = '#c62828';

    showAutoLikeDashboard();

    // Wire up status callback
    window.linkedInAutoApply.autoLike.onStatusChange = (st, message) => {
      updateAutoLikeDashboard(st, message);

      if (st.status === 'idle' || st.status === 'security_stop' || st.status === 'daily_limit') {
        autoLikeRunning = false;
        btn.innerText = '👍 Auto Like';
        btn.style.backgroundColor = '#e91e63';
      }
    };

    const settings = await getEngagementSettings();

    try {
      await window.linkedInAutoApply.autoLike.start({
        minReactions: settings.minReactions ?? 10,
        maxPostAgeHours: settings.maxPostAgeHours ?? 48,
        skipReposts: settings.skipReposts ?? true,
        skipVacancies: settings.skipVacancies ?? true,
        targetHeadlines: settings.targetHeadlines || '',
        authorBlacklist: settings.authorBlacklist || '',
        contentBlacklist: settings.contentBlacklist || '',
      });
    } catch (err) {
      console.error('[FeedUI] Auto Like error:', err.message);
      if (err.message && !err.message.includes('Aborted')) {
        alert('Auto Like: ' + err.message);
      }
    }

    autoLikeRunning = false;
    btn.innerText = '👍 Auto Like';
    btn.style.backgroundColor = '#e91e63';
    hideAutoLikeDashboard();
  }

  function showAutoLikeDashboard() {
    hideAutoLikeDashboard();

    const panel = document.createElement('div');
    panel.id = 'autolike-dashboard';
    panel.style.cssText = `
      position: fixed; top: 70px; right: 20px;
      width: 280px; background: #fff; border-radius: 10px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.15);
      z-index: 10000; font-family: -apple-system, system-ui, sans-serif;
      overflow: hidden;
    `;

    const autoLikeState = window.linkedInAutoApply.autoLike?.getState?.() || {};
    const dailyLimit = autoLikeState.dailyLimit || 65;

    panel.innerHTML = `
      <div style="background: linear-gradient(135deg, #e91e63, #c2185b); color: #fff;
                  padding: 12px 16px; font-weight: 700; font-size: 14px;
                  display: flex; justify-content: space-between; align-items: center;">
        <span>Auto Like</span>
        <span id="autolike-status-badge" style="
          background: rgba(255,255,255,0.2); padding: 2px 8px; border-radius: 10px;
          font-size: 11px; font-weight: 600;">STARTING</span>
      </div>
      <div style="padding: 14px 16px;">
        <div style="margin-bottom: 12px;">
          <div style="display: flex; justify-content: space-between; font-size: 12px; color: #666; margin-bottom: 4px;">
            <span>Today</span>
            <span id="autolike-today-count">${autoLikeState.todayLikes || 0}/${dailyLimit}</span>
          </div>
          <div style="width: 100%; height: 6px; background: #e0e0e0; border-radius: 3px;">
            <div id="autolike-today-bar" style="width: 0%; height: 100%;
                 background: linear-gradient(90deg, #e91e63, #f06292);
                 border-radius: 3px; transition: width 0.3s;"></div>
          </div>
        </div>
        <div style="margin-bottom: 12px;">
          <div style="display: flex; justify-content: space-between; font-size: 12px; color: #666; margin-bottom: 4px;">
            <span>Session <span id="autolike-session-num">#${autoLikeState.sessionNumber || 0}</span></span>
            <span id="autolike-session-count">0/25</span>
          </div>
          <div style="width: 100%; height: 6px; background: #e0e0e0; border-radius: 3px;">
            <div id="autolike-session-bar" style="width: 0%; height: 100%;
                 background: linear-gradient(90deg, #4caf50, #81c784);
                 border-radius: 3px; transition: width 0.3s;"></div>
          </div>
        </div>
        <div id="autolike-security" style="
          padding: 6px 10px; background: #e8f5e9; border-radius: 6px;
          font-size: 12px; color: #2e7d32; margin-bottom: 10px;
          display: flex; align-items: center; gap: 6px;">
          <span>&#x2714;</span> <span>Security: OK</span>
        </div>
        <div id="autolike-message" style="
          font-size: 12px; color: #666; min-height: 32px;
          line-height: 1.4; word-break: break-word;">
          Starting...
        </div>
      </div>
    `;

    document.body.appendChild(panel);
  }

  function updateAutoLikeDashboard(st, message) {
    const badge = document.getElementById('autolike-status-badge');
    if (badge) {
      const labels = {
        idle: 'IDLE', running: 'RUNNING', reading: 'READING',
        paused: 'PAUSED', mini_break: 'MINI BREAK', big_break: 'BIG BREAK',
        security_stop: 'SECURITY!', daily_limit: 'DONE',
      };
      badge.textContent = labels[st.status] || st.status.toUpperCase();
      const colors = {
        running: 'rgba(76,175,80,0.3)', reading: 'rgba(33,150,243,0.3)',
        mini_break: 'rgba(255,193,7,0.3)', big_break: 'rgba(255,152,0,0.3)',
        security_stop: '#f44336', daily_limit: 'rgba(76,175,80,0.5)',
      };
      badge.style.background = colors[st.status] || 'rgba(255,255,255,0.2)';
    }

    const todayCount = document.getElementById('autolike-today-count');
    const todayBar = document.getElementById('autolike-today-bar');
    if (todayCount) todayCount.textContent = `${st.todayLikes}/${st.dailyLimit}`;
    if (todayBar) todayBar.style.width = `${Math.min(100, (st.todayLikes / st.dailyLimit) * 100)}%`;

    const sessionNum = document.getElementById('autolike-session-num');
    const sessionCount = document.getElementById('autolike-session-count');
    const sessionBar = document.getElementById('autolike-session-bar');
    if (sessionNum) sessionNum.textContent = `#${st.sessionNumber}`;
    if (sessionCount) sessionCount.textContent = `${st.sessionLikes}/25`;
    if (sessionBar) sessionBar.style.width = `${Math.min(100, (st.sessionLikes / 25) * 100)}%`;

    const secEl = document.getElementById('autolike-security');
    if (secEl) {
      if (st.securityDetected) {
        secEl.style.background = '#ffebee';
        secEl.style.color = '#c62828';
        secEl.innerHTML = `<span>&#x26A0;</span> <span>${escapeHtml(st.securityDetected)}</span>`;
      } else {
        secEl.style.background = '#e8f5e9';
        secEl.style.color = '#2e7d32';
        secEl.innerHTML = '<span>&#x2714;</span> <span>Security: OK</span>';
      }
    }

    const msgEl = document.getElementById('autolike-message');
    if (msgEl && message) msgEl.textContent = message;
  }

  function hideAutoLikeDashboard() {
    document.getElementById('autolike-dashboard')?.remove();
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
      bottom: 170px; right: 20px;
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

  /**
   * Create the "Weekly Report" button
   */
  function createWeeklyReportButton() {
    const existing = document.getElementById('linkedin-feed-report-btn');
    if (existing) existing.remove();

    const button = document.createElement('button');
    button.id = 'linkedin-feed-report-btn';
    button.innerText = 'Weekly Report';
    button.style.cssText = `${STYLES.button}
      bottom: 220px; right: 20px;
      background-color: #e65100; color: #fff;
    `;

    button.addEventListener('mouseenter', () => {
      button.style.backgroundColor = '#bf360c';
      button.style.transform = 'scale(1.05)';
    });
    button.addEventListener('mouseleave', () => {
      button.style.backgroundColor = '#e65100';
      button.style.transform = 'scale(1)';
    });
    button.addEventListener('click', showWeeklyReportPanel);

    document.body.appendChild(button);
    return button;
  }

  // ── Badge Indicators ─────────────────────────────────────────────────

  function ensureBadge(button, badgeId, color) {
    let badge = document.getElementById(badgeId);
    if (!badge) {
      badge = document.createElement('span');
      badge.id = badgeId;
      badge.style.cssText = `
        position: absolute; top: -6px; right: -6px;
        background: ${color}; color: #fff; font-size: 11px; font-weight: 700;
        min-width: 18px; height: 18px; line-height: 18px; text-align: center;
        border-radius: 50%; display: none; padding: 0 4px; pointer-events: none;
      `;
      // position:fixed already acts as containing block for position:absolute children
      button.appendChild(badge);
    }
    return badge;
  }

  function setBadgeCount(badge, count) {
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }

  /**
   * Update badge indicators on all floating buttons based on unseen
   * influencer posts in monitor state.
   */
  async function updateBadges() {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage) return;
      const data = await chrome.storage.local.get('influencerMonitorState');
      const state = data?.influencerMonitorState || { newPosts: [] };
      const unseen = (state.newPosts || []).filter(p => !p.seen);

      const tier1Count = unseen.filter(p => p.tier === 1).length;
      const tier12Count = unseen.filter(p => p.tier <= 2).length;
      const totalCount = unseen.length;

      // Analyze button: Tier 1 (red)
      const analyzeBtn = document.getElementById('linkedin-feed-analyze-btn');
      if (analyzeBtn) {
        const badge = ensureBadge(analyzeBtn, 'feed-badge-analyze', '#dc3545');
        setBadgeCount(badge, tier1Count);
      }

      // Auto Engage button: Tier 1+2 (orange)
      const engageBtn = document.getElementById('linkedin-feed-engage-btn');
      if (engageBtn) {
        const badge = ensureBadge(engageBtn, 'feed-badge-engage', '#e65100');
        setBadgeCount(badge, tier12Count);
      }

      // Weekly Report button: total unseen
      const reportBtn = document.getElementById('linkedin-feed-report-btn');
      if (reportBtn) {
        const badge = ensureBadge(reportBtn, 'feed-badge-report', '#dc3545');
        setBadgeCount(badge, totalCount);
      }
    } catch {}
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

      // Notify background (guard against invalidated extension context)
      try {
        chrome.runtime?.sendMessage?.({
          action: 'feedAnalysisComplete',
          summary: analysis.summary,
        });
      } catch (_) { /* extension context invalidated */ }

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
        enableHashtags: settings.enableHashtags,
        hashtagCategories: settings.hashtagCategories,
        enableDayKeywords: settings.enableDayKeywords,
        dayKeywords: settings.dayKeywords,
        actionCooldownSec: settings.actionCooldownSec || 60,
        minReactions: settings.minReactions ?? 10,
        maxPostAgeHours: settings.maxPostAgeHours ?? 48,
        skipReposts: settings.skipReposts ?? true,
        skipVacancies: settings.skipVacancies ?? true,
        targetHeadlines: settings.targetHeadlines || '',
        authorBlacklist: settings.authorBlacklist || '',
        contentBlacklist: settings.contentBlacklist || '',
        onProgress: (progress) => {
          if (progress.phase === 'scraping') {
            updateProgress(
              `📥 Scraping: ${progress.scrollIteration}/${progress.totalScrolls} ` +
              `(${progress.postsFound} posts)`
            );
            updateProgressBar((progress.scrollIteration / progress.totalScrolls) * 100);
          } else if (progress.phase === 'filtering') {
            updateProgress(
              `🔍 Pre-filtering: ${progress.currentPost}/${progress.totalPosts} ` +
              `(${progress.passed} passed)`
            );
            updateProgressBar(
              progress.totalPosts > 0 ? (progress.currentPost / progress.totalPosts) * 50 : 0
            );
          } else if (progress.phase === 'scoring') {
            updateProgress(
              `🧠 AI Scoring: batch ${progress.scored}/${progress.total} posts...`
            );
            updateProgressBar(
              progress.total > 0 ? 50 + (progress.scored / progress.total) * 25 : 50
            );
          } else if (progress.phase === 'queue') {
            updateProgress(
              `📋 Queue ready: ${progress.actionable} to engage, ${progress.skipped} skipped`
            );
            updateProgressBar(75);
            // Render queue panel
            showQueuePanel(progress.queue);
          } else if (progress.phase === 'scrolling') {
            updateProgress(
              `📜 ${progress.message}\n` +
              `❤️ ${progress.stats.liked} | 💬 ${progress.stats.commented} | 🔁 ${progress.stats.replied} | ➕ ${progress.stats.followed}`
            );
          } else if (progress.phase === 'engaging') {
            const rateStatus = progress.rateLimits;
            let statusLine =
              `💬 Engaging ${progress.currentPost}/${progress.totalPosts}... ` +
              `❤️ ${progress.stats.liked} | 💬 ${progress.stats.commented} | 🔁 ${progress.stats.replied} | ➕ ${progress.stats.followed}`;
            if (progress.waiting) {
              statusLine += `\n⏳ ${progress.waiting}`;
            } else if (progress.skipping) {
              statusLine += `\n⏭️ Skipped: ${progress.skipping}`;
            }
            updateProgress(statusLine);
            updateProgressBar(
              progress.totalPosts > 0
                ? 75 + (progress.currentPost / progress.totalPosts) * 25
                : 75
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
      actionCooldownSec: 60,
      enableHashtags: true,  // Monitor hashtags by category
      hashtagCategories: {
        'FinTech/Payments': ['#fintech', '#payments', '#openbanking', '#embeddedfinance', '#digitalbanking'],
        'AI': ['#artificialIntelligence', '#aiagents', '#llm', '#generativeAI', '#agenticAI'],
        'Startups': ['#venturecapital', '#startups', '#seedfunding', '#seriesa', '#fundraising'],
        'Engineering': ['#microservices', '#systemdesign', '#softwarearchitecture'],
      },
      enableDayKeywords: false, // Filter posts by day-of-week keywords
      dayKeywords: {
        0: [],  // Sunday
        1: ['AI agents production', 'raised seed round', 'fintech funding'],          // Monday
        2: ['payment infrastructure', 'fintech lessons', 'startup pivot'],             // Tuesday
        3: ['built AI pipeline', 'startup CTO', 'microservices scale'],                // Wednesday
        4: ['series A fintech', 'AI startup', 'payment processing'],                   // Thursday
        5: ['AI ROI', 'payment compliance', 'PCI DSS', 'engineering culture'],         // Friday
        6: [],  // Saturday
      },
      // Targeting filters
      minReactions: 10,
      maxPostAgeHours: 48,
      skipReposts: true,
      skipVacancies: true,
      targetHeadlines: '',
      authorBlacklist: '',
      contentBlacklist: '',
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
    applyPanelTheme(analysisPanel);

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
    applyPanelTheme(analysisPanel);
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
    const scoringSettings = window.linkedInAutoApply.feedScoring
      ? await window.linkedInAutoApply.feedScoring.loadSettings()
      : window.linkedInAutoApply.feedScoring?.getDefaultSettings?.() || {};

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
      <h3 style="margin: 0 0 10px 0; color: #333; font-size: 17px;">Appearance</h3>
      <div style="display:flex; gap:14px; align-items:center; margin-bottom:18px; font-size:14px;">
        <span style="color:#666;">Theme:</span>
        <label style="cursor:pointer;">
          <input type="radio" name="ui-theme" value="light" style="vertical-align:middle; margin-right:4px;"> Light
        </label>
        <label style="cursor:pointer;">
          <input type="radio" name="ui-theme" value="dark" style="vertical-align:middle; margin-right:4px;"> Dark
        </label>
        <label style="cursor:pointer;">
          <input type="radio" name="ui-theme" value="auto" style="vertical-align:middle; margin-right:4px;"> Auto (system)
        </label>
      </div>

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

      <h3 style="margin: 22px 0 14px 0; color: #333; font-size: 17px;"># Hashtag Monitoring</h3>
      <div style="padding: 14px; background: #e8f4fd; border-radius: 6px; margin-bottom: 16px; font-size: 14px; line-height: 1.6;">
        Engage with posts containing specific hashtags. Organized by category. Comma-separated, include the # symbol.
      </div>

      <label style="display: block; margin: 12px 0; font-size: 15px; line-height: 1.5;">
        <input type="checkbox" id="setting-enable-hashtags" ${settings.enableHashtags ? 'checked' : ''}
          style="width: 18px; height: 18px; vertical-align: middle; margin-right: 6px;">
        <strong>Enable hashtag monitoring</strong>
      </label>

      <div id="hashtag-categories-container" style="margin-left: 8px; ${settings.enableHashtags ? '' : 'opacity: 0.5; pointer-events: none;'}">
        <div id="hashtag-categories-list">
          ${Object.entries(settings.hashtagCategories || {}).map(([cat, tags], idx) => `
            <div class="hashtag-cat-row" style="margin: 10px 0; padding: 10px; background: #f8f9fa; border-radius: 6px; border-left: 3px solid #0073b1;">
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                <input type="text" class="hashtag-cat-name" value="${escapeHtml(cat)}"
                  placeholder="Category name"
                  style="flex: 1; padding: 5px 8px; font-size: 14px; font-weight: bold; border: 1px solid #ccc; border-radius: 4px;">
                <button class="remove-cat-btn" data-idx="${idx}" style="
                  background: #dc3545; color: #fff; border: none; border-radius: 4px;
                  padding: 4px 10px; cursor: pointer; font-size: 13px;">✕</button>
              </div>
              <input type="text" class="hashtag-cat-tags" value="${escapeHtml(tags.join(', '))}"
                placeholder="#fintech, #payments, #openbanking"
                style="width: 95%; padding: 6px 10px; font-size: 14px; border: 1px solid #ccc; border-radius: 4px;">
            </div>
          `).join('')}
        </div>
        <button id="add-hashtag-cat-btn" style="
          margin-top: 8px; padding: 6px 14px; background: #0073b1; color: #fff;
          border: none; border-radius: 4px; cursor: pointer; font-size: 13px;">+ Add Category</button>
      </div>

      <h3 style="margin: 22px 0 14px 0; color: #333; font-size: 17px;">📅 Day-of-Week Keywords</h3>
      <div style="padding: 14px; background: #e8f4fd; border-radius: 6px; margin-bottom: 16px; font-size: 14px; line-height: 1.6;">
        Filter posts by topic keywords that change each day. Comma-separated. Leave empty to skip that day.
      </div>

      <label style="display: block; margin: 12px 0; font-size: 15px; line-height: 1.5;">
        <input type="checkbox" id="setting-enable-day-keywords" ${settings.enableDayKeywords ? 'checked' : ''}
          style="width: 18px; height: 18px; vertical-align: middle; margin-right: 6px;">
        <strong>Enable day-of-week keyword filtering</strong>
      </label>

      <div id="day-keywords-container" style="margin-left: 8px; ${settings.enableDayKeywords ? '' : 'opacity: 0.5; pointer-events: none;'}">
        ${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day, idx) => {
          const dayNum = idx === 6 ? 0 : idx + 1; // Sunday=0, Mon=1..Sat=6
          const kws = (settings.dayKeywords && settings.dayKeywords[dayNum]) || [];
          return `
            <label style="display: block; margin: 8px 0; font-size: 14px; line-height: 1.5;">
              <strong>${day}:</strong>
              <input type="text" id="day-kw-${dayNum}" value="${escapeHtml(kws.join(', '))}"
                placeholder="e.g. AI agents, fintech funding"
                style="display: block; width: 95%; margin-top: 4px; padding: 6px 10px; font-size: 14px; border: 1px solid #ccc; border-radius: 4px;">
            </label>
          `;
        }).join('')}
      </div>

      <h3 style="margin: 22px 0 14px 0; color: #333; font-size: 17px;">Targeting Filters</h3>
      <div style="padding: 14px; background: #e8f4fd; border-radius: 6px; margin-bottom: 16px; font-size: 14px; line-height: 1.6;">
        Control which posts pass pre-filtering before scoring. These run first for fast rejection.
      </div>

      <label style="display: block; margin: 12px 0; font-size: 15px; line-height: 1.5;">
        Min reactions:
        <input type="number" id="setting-min-reactions" value="${settings.minReactions}"
          min="0" max="1000" style="margin-left: 10px; padding: 6px 10px; width: 80px; font-size: 15px;">
        <span style="font-size: 12px; color: #888; display: block; margin-top: 4px;">
          Posts with fewer reactions are skipped (default: 10)
        </span>
      </label>

      <label style="display: block; margin: 12px 0; font-size: 15px; line-height: 1.5;">
        Max post age (hours):
        <input type="number" id="setting-max-post-age" value="${settings.maxPostAgeHours}"
          min="1" max="720" style="margin-left: 10px; padding: 6px 10px; width: 80px; font-size: 15px;">
        <span style="font-size: 12px; color: #888; display: block; margin-top: 4px;">
          Posts older than this are skipped (default: 48)
        </span>
      </label>

      <label style="display: block; margin: 12px 0; font-size: 15px; line-height: 1.5;">
        <input type="checkbox" id="setting-skip-reposts" ${settings.skipReposts ? 'checked' : ''}
          style="width: 18px; height: 18px; vertical-align: middle; margin-right: 6px;">
        Skip reposted/shared content
      </label>

      <label style="display: block; margin: 12px 0; font-size: 15px; line-height: 1.5;">
        <input type="checkbox" id="setting-skip-vacancies" ${settings.skipVacancies ? 'checked' : ''}
          style="width: 18px; height: 18px; vertical-align: middle; margin-right: 6px;">
        Skip vacancy/hiring posts
      </label>

      <label style="display: block; margin: 12px 0; font-size: 15px; line-height: 1.5;">
        Target author headlines:
        <input type="text" id="setting-target-headlines" value="${escapeHtml(settings.targetHeadlines)}"
          placeholder="CTO, Founder, VP Engineering, Head of Product"
          style="display: block; width: 95%; margin-top: 4px; padding: 6px 10px; font-size: 14px; border: 1px solid #ccc; border-radius: 4px;">
        <span style="font-size: 12px; color: #888; display: block; margin-top: 4px;">
          Only engage posts from authors whose headline contains one of these keywords (comma-separated). Leave empty to engage all.
        </span>
      </label>

      <label style="display: block; margin: 12px 0; font-size: 15px; line-height: 1.5;">
        Author blacklist:
        <input type="text" id="setting-author-blacklist" value="${escapeHtml(settings.authorBlacklist)}"
          placeholder="John Doe, Jane Smith"
          style="display: block; width: 95%; margin-top: 4px; padding: 6px 10px; font-size: 14px; border: 1px solid #ccc; border-radius: 4px;">
        <span style="font-size: 12px; color: #888; display: block; margin-top: 4px;">
          Never engage with posts from these authors (comma-separated, full names as shown on LinkedIn)
        </span>
      </label>

      <label style="display: block; margin: 12px 0; font-size: 15px; line-height: 1.5;">
        Content blacklist:
        <input type="text" id="setting-content-blacklist" value="${escapeHtml(settings.contentBlacklist)}"
          placeholder="crypto, NFT, dropshipping, MLM"
          style="display: block; width: 95%; margin-top: 4px; padding: 6px 10px; font-size: 14px; border: 1px solid #ccc; border-radius: 4px;">
        <span style="font-size: 12px; color: #888; display: block; margin-top: 4px;">
          Skip posts containing any of these keywords (comma-separated, case-insensitive)
        </span>
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

      <label style="display: block; margin: 12px 0; font-size: 15px; line-height: 1.5;">
        Cooldown between posts (seconds):
        <input type="number" id="setting-action-cooldown" value="${settings.actionCooldownSec}"
          min="10" max="300" style="margin-left: 10px; padding: 6px 10px; width: 70px; font-size: 15px;">
        <span style="font-size: 12px; color: #888; display: block; margin-top: 4px;">
          Wait time between engaging each post (10-300s, default 60s)
        </span>
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

      <h3 style="margin: 22px 0 14px 0; color: #333; font-size: 17px;">🧠 AI Post Scoring (Claude)</h3>
      <div style="padding: 14px; background: #f0e8fd; border-radius: 6px; margin-bottom: 16px; font-size: 14px; line-height: 1.6;">
        Every pre-filtered post is scored 0-100 by Claude. Score drives action:
        <strong>like+comment</strong> / <strong>like only</strong> / <strong>skip</strong>.
      </div>

      <label style="display: block; margin: 12px 0; font-size: 15px; line-height: 1.5;">
        <input type="checkbox" id="scoring-enable" ${scoringSettings.enableScoring ? 'checked' : ''}
          style="width: 18px; height: 18px; vertical-align: middle; margin-right: 6px;">
        <strong>Enable AI scoring</strong> (requires Claude API key)
      </label>

      <div id="scoring-settings-container" style="margin-left: 8px; ${scoringSettings.enableScoring ? '' : 'opacity: 0.5; pointer-events: none;'}">
        <label style="display: block; margin: 10px 0; font-size: 15px; line-height: 1.5;">
          Claude API Key:
          <input type="password" id="scoring-api-key" value="${escapeHtml(scoringSettings.claudeApiKey || '')}"
            placeholder="sk-ant-..."
            style="display: block; width: 95%; margin-top: 4px; padding: 6px 10px; font-size: 14px; border: 1px solid #ccc; border-radius: 4px;">
        </label>

        <label style="display: block; margin: 10px 0; font-size: 15px; line-height: 1.5;">
          Model:
          <select id="scoring-model" style="margin-left: 10px; padding: 6px 10px; font-size: 15px;">
            <option value="claude-sonnet-4-20250514" ${scoringSettings.claudeModel === 'claude-sonnet-4-20250514' ? 'selected' : ''}>Claude Sonnet 4 (recommended)</option>
            <option value="claude-haiku-4-5-20251001" ${scoringSettings.claudeModel === 'claude-haiku-4-5-20251001' ? 'selected' : ''}>Claude Haiku 4.5 (faster/cheaper)</option>
          </select>
        </label>

        <div style="display: flex; gap: 16px; flex-wrap: wrap;">
          <label style="display: block; margin: 10px 0; font-size: 14px; line-height: 1.5;">
            Like+Comment+Follow (85+):
            <input type="number" id="scoring-threshold-lcf" value="${scoringSettings.thresholdLikeCommentFollow ?? 85}"
              min="0" max="100" style="margin-left: 6px; padding: 5px 8px; width: 60px; font-size: 14px;">
          </label>
          <label style="display: block; margin: 10px 0; font-size: 14px; line-height: 1.5;">
            Like + Comment (70-84):
            <input type="number" id="scoring-threshold-lc" value="${scoringSettings.thresholdLikeComment ?? 70}"
              min="0" max="100" style="margin-left: 6px; padding: 5px 8px; width: 60px; font-size: 14px;">
          </label>
          <label style="display: block; margin: 10px 0; font-size: 14px; line-height: 1.5;">
            Like only (40-69):
            <input type="number" id="scoring-threshold-lo" value="${scoringSettings.thresholdLikeOnly ?? 40}"
              min="0" max="100" style="margin-left: 6px; padding: 5px 8px; width: 60px; font-size: 14px;">
          </label>
        </div>
        <div style="font-size:12px;color:#888;margin-bottom:12px;">0-39 = skip</div>

        <label style="display: block; margin: 10px 0; font-size: 14px; line-height: 1.5;">
          Target niches (comma-separated):
          <input type="text" id="scoring-niches" value="${escapeHtml((scoringSettings.niches || []).join(', '))}"
            placeholder="AI agents, payments, fintech"
            style="display: block; width: 95%; margin-top: 4px; padding: 6px 10px; font-size: 14px; border: 1px solid #ccc; border-radius: 4px;">
        </label>

        <div id="influencer-section" style="margin: 14px 0 6px 0;">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; flex-wrap:wrap; gap:4px;">
            <strong style="font-size:14px; color:#333;">Influencers</strong>
            <div style="display:flex; gap:4px;">
              <button type="button" id="inf-visit-profiles-btn" style="
                padding: 5px 10px; background: #28a745; color: #fff; border: none;
                border-radius: 4px; cursor: pointer; font-size: 12px;">🚀 Visit Profiles</button>
              <button type="button" id="inf-export-csv-btn" style="
                padding: 5px 10px; background: #6c757d; color: #fff; border: none;
                border-radius: 4px; cursor: pointer; font-size: 12px;">📥 Export CSV</button>
              <button type="button" id="inf-import-csv-btn" style="
                padding: 5px 10px; background: #6c757d; color: #fff; border: none;
                border-radius: 4px; cursor: pointer; font-size: 12px;">📤 Import CSV</button>
              <button type="button" id="inf-add-btn" style="
                padding: 5px 10px; background: #0073b1; color: #fff; border: none;
                border-radius: 4px; cursor: pointer; font-size: 12px;">➕ Add influencer</button>
            </div>
          </div>
          <div id="inf-tier-container"><!-- populated by renderInfluencerSection() --></div>
          <div id="inf-visit-status" style="display:none; margin-top:8px; padding:8px 12px; background:#e8f5e9; border-radius:6px; font-size:13px; color:#2e7d32;"></div>
        </div>

        <button id="scoring-test-btn" style="
          margin-top: 10px; padding: 8px 16px; background: #6c757d; color: #fff;
          border: none; border-radius: 4px; cursor: pointer; font-size: 14px;
        ">🧪 Test Claude Connection</button>
        <div id="scoring-test-result" style="margin-top: 8px; font-size: 14px;"></div>
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

    // Apply saved theme to this panel
    applyPanelTheme(analysisPanel);

    // Update rate status
    updateSettingsRateStatus();

    // Render influencer section (per-tier containers, live stats)
    renderInfluencerSection(scoringSettings.influencerList || []);
    document.getElementById('inf-add-btn')?.addEventListener('click', () => addInfluencerRow(null));
    document.getElementById('inf-export-csv-btn')?.addEventListener('click', () => exportInfluencersCsv());
    document.getElementById('inf-import-csv-btn')?.addEventListener('click', () => importInfluencersCsv());
    document.getElementById('inf-visit-profiles-btn')?.addEventListener('click', () => startProfileVisits());
    refreshProfileVisitStatus();

    // Theme toggle wiring
    const uiSettings = await loadUiSettings();
    document.querySelectorAll('input[name="ui-theme"]').forEach(r => {
      r.checked = r.value === uiSettings.theme;
      r.addEventListener('change', async () => {
        if (!r.checked) return;
        await saveUiSettings({ theme: r.value });
        applyPanelTheme(analysisPanel);
      });
    });

    // Event listeners
    document.getElementById('save-settings-btn').addEventListener('click', saveSettings);
    document.getElementById('reset-limits-btn').addEventListener('click', resetLimits);
    document.getElementById('ai-test-btn')?.addEventListener('click', testAIConnection);
    document.getElementById('ai-provider')?.addEventListener('change', onProviderChange);

    // Scoring section listeners
    document.getElementById('scoring-enable')?.addEventListener('change', (e) => {
      const container = document.getElementById('scoring-settings-container');
      if (container) {
        container.style.opacity = e.target.checked ? '1' : '0.5';
        container.style.pointerEvents = e.target.checked ? 'auto' : 'none';
      }
    });
    document.getElementById('scoring-test-btn')?.addEventListener('click', async () => {
      const resultEl = document.getElementById('scoring-test-result');
      if (!resultEl) return;
      resultEl.style.color = '#666';
      resultEl.innerText = '🔄 Testing Claude connection...';
      const testSettings = {
        claudeApiKey: document.getElementById('scoring-api-key')?.value || '',
        claudeModel: document.getElementById('scoring-model')?.value || 'claude-sonnet-4-20250514',
      };
      if (!window.linkedInAutoApply.feedScoring?.testConnection) {
        resultEl.style.color = '#dc3545';
        resultEl.innerText = '❌ Scoring module not loaded';
        return;
      }
      const result = await window.linkedInAutoApply.feedScoring.testConnection(testSettings);
      resultEl.style.color = result.success ? '#28a745' : '#dc3545';
      resultEl.innerText = result.success ? '✅ ' + result.message : '❌ ' + result.message;
    });

    // Toggle hashtag categories container visibility
    document.getElementById('setting-enable-hashtags')?.addEventListener('change', (e) => {
      const container = document.getElementById('hashtag-categories-container');
      if (container) {
        container.style.opacity = e.target.checked ? '1' : '0.5';
        container.style.pointerEvents = e.target.checked ? 'auto' : 'none';
      }
    });

    // Add new hashtag category
    document.getElementById('add-hashtag-cat-btn')?.addEventListener('click', () => {
      const list = document.getElementById('hashtag-categories-list');
      if (!list) return;
      const idx = list.querySelectorAll('.hashtag-cat-row').length;
      const row = document.createElement('div');
      row.className = 'hashtag-cat-row';
      row.style.cssText = 'margin: 10px 0; padding: 10px; background: #f8f9fa; border-radius: 6px; border-left: 3px solid #0073b1;';
      row.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
          <input type="text" class="hashtag-cat-name" value=""
            placeholder="Category name"
            style="flex: 1; padding: 5px 8px; font-size: 14px; font-weight: bold; border: 1px solid #ccc; border-radius: 4px;">
          <button class="remove-cat-btn" style="
            background: #dc3545; color: #fff; border: none; border-radius: 4px;
            padding: 4px 10px; cursor: pointer; font-size: 13px;">✕</button>
        </div>
        <input type="text" class="hashtag-cat-tags" value=""
          placeholder="#fintech, #payments, #openbanking"
          style="width: 95%; padding: 6px 10px; font-size: 14px; border: 1px solid #ccc; border-radius: 4px;">
      `;
      list.appendChild(row);
      row.querySelector('.remove-cat-btn').addEventListener('click', () => row.remove());
    });

    // Remove hashtag category buttons
    document.querySelectorAll('.remove-cat-btn').forEach(btn => {
      btn.addEventListener('click', () => btn.closest('.hashtag-cat-row')?.remove());
    });

    // Toggle day-keywords container visibility
    document.getElementById('setting-enable-day-keywords')?.addEventListener('change', (e) => {
      const container = document.getElementById('day-keywords-container');
      if (container) {
        container.style.opacity = e.target.checked ? '1' : '0.5';
        container.style.pointerEvents = e.target.checked ? 'auto' : 'none';
      }
    });
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

  // ── Influencer Section ─────────────────────────────────────────────────

  const TIER_META = {
    1: { color: '#7c3aed', label: 'Tier 1', goal: '2 comments/week' },
    2: { color: '#0073b1', label: 'Tier 2', goal: '1 comment/week' },
    3: { color: '#6c757d', label: 'Tier 3', goal: 'tracked only' },
  };

  function formatRelativeTime(ts) {
    if (!ts) return 'never';
    const diff = Date.now() - ts;
    if (diff < 0) return 'just now';
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h ago';
    const days = Math.floor(hours / 24);
    return days + 'd ago';
  }

  function statusBadge(status, tier, targetMet) {
    const labels = { new: 'new', ok: 'ok', commented: '1 comment' };
    const bg = targetMet ? '#28a745' : (status === 'commented' ? '#28a745' : status === 'ok' ? '#ffc107' : '#adb5bd');
    const fg = status === 'ok' && !targetMet ? '#333' : '#fff';
    return `<span style="background:${bg}; color:${fg}; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:600;">${labels[status] || status}</span>`;
  }

  function renderInfluencerSection(list) {
    const container = document.getElementById('inf-tier-container');
    if (!container) return;

    const summary = window.linkedInAutoApply.feedScoring?.getTierSummary
      ? window.linkedInAutoApply.feedScoring.getTierSummary({ influencerList: list })
      : null;

    container.innerHTML = '';
    for (const tier of [1, 2, 3]) {
      const meta = TIER_META[tier];
      const tierInfs = list.filter(i => i.tier === tier);
      const tierSum = summary?.[tier] || { weekComments: 0, target: 0, targetMet: true, totalPostsSeen: 0 };
      const pct = tierSum.target > 0 ? Math.min(100, Math.round((tierSum.weekComments / tierSum.target) * 100)) : 100;

      const tierBlock = document.createElement('div');
      tierBlock.className = 'inf-tier-block';
      tierBlock.dataset.tier = String(tier);
      tierBlock.style.cssText = `margin: 10px 0; padding: 10px; background: #f8f9fa; border-radius: 6px; border-left: 3px solid ${meta.color};`;
      tierBlock.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <div>
            <strong style="color:${meta.color}; font-size:13px;">${meta.label}</strong>
            <span style="color:#666; font-size:11px; margin-left:6px;">goal: ${meta.goal}</span>
          </div>
          <div style="font-size:11px; color:#666;">
            week: <strong>${tierSum.weekComments}</strong>/${tierSum.target || '∞'} comments ·
            ${tierInfs.length} ppl · ${tierSum.totalPostsSeen} posts
          </div>
        </div>
        <div style="background:#e9ecef; border-radius:6px; height:6px; overflow:hidden; margin-bottom:8px;">
          <div style="background:${tierSum.targetMet ? '#28a745' : meta.color}; width:${pct}%; height:100%; transition:width .3s;"></div>
        </div>
        <div class="inf-rows"></div>
      `;
      container.appendChild(tierBlock);

      const rowsEl = tierBlock.querySelector('.inf-rows');
      if (tierInfs.length === 0) {
        rowsEl.innerHTML = `<div style="color:#999; font-size:12px; font-style:italic; padding:6px 0;">No influencers in ${meta.label}. Click "Add influencer" to create one.</div>`;
      } else {
        for (const inf of tierInfs) buildInfluencerRow(rowsEl, inf, tierSum.targetMet);
      }
    }
  }

  function buildInfluencerRow(parentEl, inf, targetMet) {
    const row = document.createElement('div');
    row.className = 'inf-row';
    row.dataset.id = inf.id;
    row.style.cssText = 'display:flex; align-items:center; gap:6px; padding:6px 4px; border-bottom:1px solid #e9ecef; flex-wrap:wrap;';

    const stats = inf.stats || {};
    const lastSeen = formatRelativeTime(stats.lastSeenAt);
    const weekStatus = stats.weekStatus || 'new';

    row.innerHTML = `
      <input type="checkbox" class="inf-enabled" ${inf.enabled !== false ? 'checked' : ''} title="Enabled">
      <input type="text" class="inf-name" value="${escapeHtml(inf.name || '')}" placeholder="Name"
        style="flex:1 1 130px; min-width:100px; padding:4px 6px; font-size:12px; border:1px solid #ccc; border-radius:3px;">
      <input type="text" class="inf-title" value="${escapeHtml(inf.title || '')}" placeholder="Title / role"
        style="flex:1 1 140px; min-width:100px; padding:4px 6px; font-size:12px; border:1px solid #ccc; border-radius:3px;">
      <select class="inf-tier" style="padding:4px 6px; font-size:12px; border:1px solid #ccc; border-radius:3px;">
        <option value="1" ${inf.tier === 1 ? 'selected' : ''}>T1</option>
        <option value="2" ${inf.tier === 2 ? 'selected' : ''}>T2</option>
        <option value="3" ${inf.tier === 3 ? 'selected' : ''}>T3</option>
      </select>
      ${statusBadge(weekStatus, inf.tier, targetMet)}
      <span style="font-size:11px; color:#666;">${lastSeen}</span>
      <button type="button" class="inf-del-btn" title="Delete" style="
        background:#dc3545; color:#fff; border:none; border-radius:3px;
        padding:3px 8px; cursor:pointer; font-size:11px;">✕</button>
      <input type="hidden" class="inf-id" value="${escapeHtml(inf.id || '')}">
      <input type="hidden" class="inf-reason" value="${escapeHtml(inf.reason || '')}">
      <input type="hidden" class="inf-profile-url" value="${escapeHtml(inf.profileUrl || '')}">
      <div style="flex-basis:100%; display:flex; gap:6px; margin-top:4px;">
        <input type="text" class="inf-reason-visible" value="${escapeHtml(inf.reason || '')}" placeholder="Why influencer (shown in queue)"
          style="flex:2; padding:4px 6px; font-size:11px; border:1px dashed #ccc; border-radius:3px; color:#555;">
        <input type="text" class="inf-profile-url-visible" value="${escapeHtml(inf.profileUrl || '')}" placeholder="https://www.linkedin.com/in/handle/"
          style="flex:2; padding:4px 6px; font-size:11px; border:1px dashed #ccc; border-radius:3px; color:#555;">
      </div>
    `;
    parentEl.appendChild(row);

    row.querySelector('.inf-del-btn').addEventListener('click', () => {
      if (confirm(`Delete influencer "${inf.name}"?`)) row.remove();
    });

    // When tier changes, move the row to the matching tier block on next re-render
    row.querySelector('.inf-tier').addEventListener('change', () => {
      const newList = readInfluencerSection();
      renderInfluencerSection(newList);
    });
  }

  function addInfluencerRow(preset) {
    // Pop a minimal inline form at the top of the influencer section; on save,
    // push into state and re-render.
    const name = prompt('Influencer name (e.g. "Jane Doe"):', preset?.name || '');
    if (!name || !name.trim()) return;
    const title = prompt('Title / who is he? (e.g. "CTO at Foo")', preset?.title || '') || '';
    const reason = prompt('Why influencer? (shown on queued posts)', preset?.reason || '') || '';
    const profileUrl = prompt('LinkedIn profile URL (optional, for scheduled polling)', preset?.profileUrl || '') || '';
    const tierStr = prompt('Tier (1, 2, or 3):', String(preset?.tier || 2)) || '2';
    const tier = [1, 2, 3].includes(parseInt(tierStr, 10)) ? parseInt(tierStr, 10) : 2;

    const current = readInfluencerSection();
    const normalize = window.linkedInAutoApply.feedScoring?.normalizeInfluencer
      || (raw => ({ ...raw, id: 'inf_' + Math.random().toString(36).slice(2, 10), enabled: true, stats: {} }));
    current.push(normalize({ name: name.trim(), title: title.trim(), reason: reason.trim(), profileUrl: profileUrl.trim(), tier, enabled: true }));
    renderInfluencerSection(current);
  }

  function escapeCsvField(value) {
    const str = String(value ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  function exportInfluencersCsv() {
    const list = readInfluencerSection();
    if (list.length === 0) {
      alert('No influencers to export.');
      return;
    }
    const headers = ['name', 'title', 'tier', 'enabled', 'reason', 'profileUrl'];
    const rows = [headers.join(',')];
    for (const inf of list) {
      rows.push(headers.map(h => escapeCsvField(h === 'enabled' ? (inf[h] !== false) : inf[h])).join(','));
    }
    const csv = rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'influencers.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function parseCsvLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else { current += ch; }
      } else {
        if (ch === '"') { inQuotes = true; }
        else if (ch === ',') { fields.push(current); current = ''; }
        else { current += ch; }
      }
    }
    fields.push(current);
    return fields;
  }

  function importInfluencersCsv() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,text/csv';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = reader.result;
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) { alert('CSV file is empty or has no data rows.'); return; }

        const headers = parseCsvLine(lines[0]).map(h => h.trim().toLowerCase());
        const nameIdx = headers.indexOf('name');
        if (nameIdx === -1) { alert('CSV must have a "name" column.'); return; }

        const normalize = window.linkedInAutoApply.feedScoring?.normalizeInfluencer
          || (raw => ({ ...raw, id: 'inf_' + Math.random().toString(36).slice(2, 10), enabled: true, stats: {} }));

        const imported = [];
        for (let i = 1; i < lines.length; i++) {
          const fields = parseCsvLine(lines[i]);
          const name = (fields[nameIdx] || '').trim();
          if (!name) continue;
          const get = key => { const idx = headers.indexOf(key); return idx >= 0 ? (fields[idx] || '').trim() : ''; };
          const tierRaw = parseInt(get('tier'), 10);
          const tier = [1, 2, 3].includes(tierRaw) ? tierRaw : 2;
          const enabledStr = get('enabled').toLowerCase();
          const enabled = enabledStr === '' || enabledStr === 'true' || enabledStr === '1';
          imported.push(normalize({
            name,
            title: get('title'),
            reason: get('reason'),
            profileUrl: get('profileurl') || get('profile_url') || get('url'),
            tier,
            enabled
          }));
        }

        if (imported.length === 0) { alert('No valid influencers found in CSV.'); return; }

        const mode = confirm(
          `Found ${imported.length} influencer(s) in CSV.\n\nOK = Merge with existing list\nCancel = Replace entire list`
        );
        let finalList;
        if (mode) {
          const current = readInfluencerSection();
          const existingNames = new Set(current.map(i => i.name.toLowerCase()));
          let skipped = 0;
          for (const inf of imported) {
            if (existingNames.has(inf.name.toLowerCase())) { skipped++; continue; }
            current.push(inf);
            existingNames.add(inf.name.toLowerCase());
          }
          finalList = current;
          if (skipped > 0) alert(`Merged. ${skipped} duplicate(s) skipped (same name).`);
        } else {
          finalList = imported;
        }
        renderInfluencerSection(finalList);
      };
      reader.readAsText(file);
    });
    input.click();
  }

  async function refreshProfileVisitStatus() {
    const statusEl = document.getElementById('inf-visit-status');
    if (!statusEl) return;
    try {
      const data = await new Promise(r => chrome.storage.local.get('profileVisitLastRun', r));
      const lastRun = data?.profileVisitLastRun;
      if (lastRun) {
        statusEl.style.display = 'block';
        statusEl.style.background = '#f5f5f5';
        statusEl.style.color = '#666';
        const ago = formatRelativeTime(lastRun);
        statusEl.innerHTML = `<span style="font-size:12px;">Auto-visits active (every ~4h, 8:00–22:00) · Last run: <strong>${ago}</strong></span>`;
      }
    } catch {}
  }

  async function startProfileVisits() {
    const btn = document.getElementById('inf-visit-profiles-btn');
    const statusEl = document.getElementById('inf-visit-status');

    // Check if already running
    const monitor = window.linkedInAutoApply.feedMonitor;
    if (!monitor?.visitInfluencerProfiles) {
      alert('Feed monitor module not available.');
      return;
    }

    const status = await monitor.getProfileVisitStatus();
    if (status.running) {
      alert('Profile visits are already running.');
      return;
    }

    // Confirm
    const infCount = readInfluencerSection().filter(i => i.profileUrl).length;
    if (infCount === 0) {
      alert('No influencers have a profile URL set. Add profile URLs first.');
      return;
    }
    if (!confirm(`Visit ${infCount} influencer profile(s) to like & comment on their recent posts?\n\nA background tab will open for each profile.`)) {
      return;
    }

    // Update UI
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Visiting...';
      btn.style.background = '#aaa';
    }
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.textContent = 'Starting profile visits...';
    }

    try {
      await monitor.visitInfluencerProfiles();
    } catch (err) {
      if (statusEl) {
        statusEl.style.background = '#ffebee';
        statusEl.style.color = '#c62828';
        statusEl.textContent = 'Profile visits failed: ' + err.message;
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '🚀 Visit Profiles';
        btn.style.background = '#28a745';
      }
    }
  }

  function updateProfileVisitProgress(data) {
    const statusEl = document.getElementById('inf-visit-status');
    if (!statusEl) return;
    statusEl.style.display = 'block';
    statusEl.style.background = '#e8f5e9';
    statusEl.style.color = '#2e7d32';
    statusEl.textContent = `Visiting ${data.influencerName}... (${data.current}/${data.total})`;
  }

  function onProfileVisitsComplete(results) {
    const statusEl = document.getElementById('inf-visit-status');
    const btn = document.getElementById('inf-visit-profiles-btn');
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🚀 Visit Profiles';
      btn.style.background = '#28a745';
    }
    if (!statusEl) return;
    statusEl.style.display = 'block';

    if (!Array.isArray(results)) {
      statusEl.textContent = 'Profile visits completed.';
      return;
    }

    const totalLiked = results.reduce((s, r) => s + (r.liked || 0), 0);
    const totalCommented = results.reduce((s, r) => s + (r.commented || 0), 0);
    const errors = results.filter(r => r.error).length;

    statusEl.style.background = errors > 0 ? '#fff3e0' : '#e8f5e9';
    statusEl.style.color = errors > 0 ? '#e65100' : '#2e7d32';
    statusEl.innerHTML = `<strong>Done!</strong> ${results.length} profiles visited: ` +
      `${totalLiked} liked, ${totalCommented} commented` +
      (errors > 0 ? `, ${errors} errors` : '');
  }

  function readInfluencerSection() {
    const rows = document.querySelectorAll('#inf-tier-container .inf-row');
    const list = [];
    rows.forEach(row => {
      const name = row.querySelector('.inf-name')?.value?.trim() || '';
      if (!name) return;
      const id = row.querySelector('.inf-id')?.value || '';
      const title = row.querySelector('.inf-title')?.value?.trim() || '';
      // Prefer visible reason/url inputs if present (they are the user-editable ones)
      const reason = row.querySelector('.inf-reason-visible')?.value?.trim()
        || row.querySelector('.inf-reason')?.value?.trim() || '';
      const profileUrl = row.querySelector('.inf-profile-url-visible')?.value?.trim()
        || row.querySelector('.inf-profile-url')?.value?.trim() || '';
      const tier = parseInt(row.querySelector('.inf-tier')?.value || '2', 10);
      const enabled = !!row.querySelector('.inf-enabled')?.checked;
      // Preserve original stats when possible (look up from the last-loaded list)
      const originalStats = window.linkedInAutoApply.__lastInfluencerStats?.[id] || {};
      list.push({ id, name, title, reason, profileUrl, tier, enabled, stats: originalStats });
    });
    return list;
  }

  /**
   * Save engagement settings
   */
  async function saveSettings() {
    // Parse hashtag categories from DOM rows
    const hashtagCategories = {};
    document.querySelectorAll('.hashtag-cat-row').forEach(row => {
      const name = row.querySelector('.hashtag-cat-name')?.value?.trim();
      const tagsRaw = row.querySelector('.hashtag-cat-tags')?.value || '';
      if (name) {
        hashtagCategories[name] = tagsRaw.split(',').map(s => s.trim()).filter(Boolean);
      }
    });

    // Parse day-of-week keywords from text inputs
    const dayKeywords = {};
    for (let d = 0; d <= 6; d++) {
      const input = document.getElementById(`day-kw-${d}`);
      const raw = input?.value || '';
      dayKeywords[d] = raw.split(',').map(s => s.trim()).filter(Boolean);
    }

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
      actionCooldownSec: parseInt(document.getElementById('setting-action-cooldown')?.value || '60', 10),
      enableHashtags: document.getElementById('setting-enable-hashtags')?.checked || false,
      hashtagCategories,
      enableDayKeywords: document.getElementById('setting-enable-day-keywords')?.checked || false,
      dayKeywords,
      minReactions: parseInt(document.getElementById('setting-min-reactions')?.value || '10', 10),
      maxPostAgeHours: parseInt(document.getElementById('setting-max-post-age')?.value || '48', 10),
      skipReposts: document.getElementById('setting-skip-reposts')?.checked || false,
      skipVacancies: document.getElementById('setting-skip-vacancies')?.checked || false,
      targetHeadlines: document.getElementById('setting-target-headlines')?.value?.trim() || '',
      authorBlacklist: document.getElementById('setting-author-blacklist')?.value?.trim() || '',
      contentBlacklist: document.getElementById('setting-content-blacklist')?.value?.trim() || '',
    };

    // Save AI settings
    await saveAISettings();

    // Save scoring settings
    if (window.linkedInAutoApply.feedScoring) {
      const nichesRaw = document.getElementById('scoring-niches')?.value || '';
      // Merge edited rows with the stored list so we preserve stats fields
      // (seenPostIds, weekStatus, lastSeenAt) that aren't bound to DOM inputs.
      const stored = await window.linkedInAutoApply.feedScoring.loadSettings();
      const storedById = new Map((stored.influencerList || []).map(i => [i.id, i]));
      const editedList = readInfluencerSection().map(edited => {
        const original = storedById.get(edited.id);
        const stats = original?.stats || edited.stats || {};
        const normalize = window.linkedInAutoApply.feedScoring.normalizeInfluencer;
        return normalize({ ...edited, stats });
      });

      await window.linkedInAutoApply.feedScoring.saveSettings({
        enableScoring: document.getElementById('scoring-enable')?.checked || false,
        claudeApiKey: document.getElementById('scoring-api-key')?.value || '',
        claudeModel: document.getElementById('scoring-model')?.value || 'claude-sonnet-4-20250514',
        thresholdLikeCommentFollow: parseInt(document.getElementById('scoring-threshold-lcf')?.value || '85', 10),
        thresholdLikeComment: parseInt(document.getElementById('scoring-threshold-lc')?.value || '70', 10),
        thresholdLikeOnly: parseInt(document.getElementById('scoring-threshold-lo')?.value || '40', 10),
        niches: nichesRaw.split(',').map(s => s.trim()).filter(Boolean),
        influencerList: editedList,
      });
    }

    try {
      await chrome.storage.local.set({ feedEngagementSettings: settings });
    } catch (err) {
      if (err.message?.includes('Extension context invalidated')) {
        alert('⚠️ Extension was reloaded. Please refresh the page and try again.');
        return;
      }
      throw err;
    }
    // Refresh background alarms (influencer list may have changed)
    try {
      chrome.runtime.sendMessage({ action: 'refreshInfluencerAlarms' });
    } catch {}

    alert('Settings saved! AI comments will be generated based on post context.');
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
        return getDefaultAISettings();
      }
      const data = await chrome.storage.local.get('feedAISettings');
      return data?.feedAISettings || getDefaultAISettings();
    } catch (err) {
      if (!err.message?.includes('Extension context invalidated')) {
        console.warn('[FeedUI] Failed to load AI settings:', err.message);
      }
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

    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        await chrome.storage.local.set({ feedAISettings: settings });
      }
    } catch (err) {
      if (!err.message?.includes('Extension context invalidated')) {
        console.warn('[FeedUI] Failed to save AI settings:', err.message);
      }
    }

    return settings;
  }

  // ── Queue Panel ─────────────────────────────────────────────────────────

  /**
   * Render the scored post queue as a visual panel.
   * @param {Array} queue - scored queue from feedEngagement
   */
  function showQueuePanel(queue) {
    // Remove any existing queue panel
    document.getElementById('feed-queue-panel')?.remove();

    if (!queue || !queue.length) return;

    const panel = document.createElement('div');
    panel.id = 'feed-queue-panel';
    panel.style.cssText = `
      position: fixed; top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      background: #fff; color: #222; border-radius: 10px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.25);
      z-index: 10002; width: 92vw; max-width: 520px;
      max-height: 80vh; display: flex; flex-direction: column;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color-scheme: light;
    `;

    const actionable = queue.filter(q => q.scoredAction !== 'skip');
    const likeCommentFollow = queue.filter(q => q.scoredAction === 'like_comment_follow');
    const likeComment = queue.filter(q => q.scoredAction === 'like_comment');
    const likeOnly = queue.filter(q => q.scoredAction === 'like_only');
    const skipped = queue.filter(q => q.scoredAction === 'skip');

    // Header
    const header = document.createElement('div');
    header.style.cssText = `
      padding: 14px 18px; border-bottom: 1px solid #e8e8e8;
      display: flex; justify-content: space-between; align-items: center;
      background: #f8f9fa; border-radius: 10px 10px 0 0;
    `;
    header.innerHTML = `
      <div>
        <span style="font-size: 17px; font-weight: 700; color: #1a1a1a;">
          QUEUE (${actionable.length})
        </span>
        <span style="font-size: 13px; color: #888; margin-left: 8px;">
          ${likeCommentFollow.length} follow &middot; ${likeComment.length} comment &middot; ${likeOnly.length} like &middot; ${skipped.length} skip
        </span>
      </div>
    `;
    const closeBtn = document.createElement('button');
    closeBtn.innerText = '×';
    closeBtn.style.cssText = 'background:none;border:none;font-size:22px;cursor:pointer;color:#666;';
    closeBtn.addEventListener('click', () => panel.remove());
    header.appendChild(closeBtn);
    panel.appendChild(header);
    makeDraggable(panel, header);

    // Body
    const body = document.createElement('div');
    body.style.cssText = 'padding: 10px 14px; overflow-y: auto; flex: 1;';

    // Render each post card (sorted by score desc)
    const sorted = [...queue].sort((a, b) => (b.scoreResult?.score ?? 0) - (a.scoreResult?.score ?? 0));

    for (const item of sorted) {
      const { post, scoreResult, scoredAction, isTier1, influencer } = item;
      const score = scoreResult?.score ?? '?';
      const themes = scoreResult?.themes || [];
      const rationale = scoreResult?.rationale || '';
      const lang = scoreResult?.language || '';

      // Color coding
      let color, actionLabel, bgColor;
      if (scoredAction === 'like_comment_follow') {
        color = '#7c3aed';
        actionLabel = 'like+comment+follow';
        bgColor = '#f5f0ff';
      } else if (scoredAction === 'like_comment') {
        color = score >= 80 ? '#dc3545' : '#fd7e14';
        actionLabel = 'like+comment';
        bgColor = score >= 80 ? '#fff5f5' : '#fff8f0';
      } else if (scoredAction === 'like_only') {
        color = '#ffc107';
        actionLabel = 'only like';
        bgColor = '#fffdf0';
      } else {
        color = '#adb5bd';
        actionLabel = 'skip';
        bgColor = '#f8f9fa';
      }

      const ageStr = item.ageHours !== null
        ? (item.ageHours < 1 ? Math.round(item.ageHours * 60) + 'min' : Math.round(item.ageHours) + 'h')
        : '';

      const card = document.createElement('div');
      card.style.cssText = `
        margin: 8px 0; padding: 12px 14px;
        background: ${bgColor}; border-radius: 8px;
        border-left: 4px solid ${color};
      `;

      const tierColors = { 1: '#7c3aed', 2: '#0073b1', 3: '#6c757d' };
      const tier1Badge = influencer
        ? `<span style="background:${tierColors[influencer.tier] || '#6c757d'};color:#fff;font-size:10px;padding:1px 6px;border-radius:8px;margin-left:6px;font-weight:600;">TIER-${influencer.tier}</span>`
        : (isTier1
            ? '<span style="background:#7c3aed;color:#fff;font-size:10px;padding:1px 6px;border-radius:8px;margin-left:6px;font-weight:600;">TIER-1</span>'
            : '');

      const influencerPill = influencer ? `
        <div style="margin-top:6px; padding:6px 8px; background:#fff; border:1px dashed ${tierColors[influencer.tier] || '#6c757d'}; border-radius:6px; font-size:12px;">
          🌟 <strong>${escapeHtml(influencer.name)}</strong>
          ${influencer.title ? `<span style="color:#555;"> · ${escapeHtml(influencer.title)}</span>` : ''}
          ${influencer.reason ? `<div style="color:#777; font-size:11px; margin-top:2px; font-style:italic;">${escapeHtml(influencer.reason)}</div>` : ''}
        </div>
      ` : '';

      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
              <span style="font-size:22px;font-weight:800;color:${color};">${score}</span>
              <span style="font-size:12px;font-weight:600;color:${color};text-transform:uppercase;">${actionLabel}</span>
              ${tier1Badge}
            </div>
            <div style="margin-top:4px;font-size:14px;font-weight:600;color:#1a1a1a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${escapeHtml(post.author || 'Unknown')}
              <span style="font-weight:400;color:#666;font-size:13px;margin-left:4px;">
                ${escapeHtml(truncate(post.headline || '', 30))}
              </span>
              ${ageStr ? `<span style="color:#999;font-size:12px;margin-left:6px;">${ageStr} ago</span>` : ''}
            </div>
          </div>
        </div>
        <div style="margin-top:6px;font-size:13px;color:#444;line-height:1.4;max-height:40px;overflow:hidden;">
          "${escapeHtml(truncate(post.content || '', 120))}"
        </div>
        <div style="margin-top:6px;display:flex;align-items:center;gap:12px;font-size:12px;color:#888;">
          <span>❤️ ${post.reactions || 0}</span>
          <span>💬 ${post.comments || 0}</span>
          ${lang ? `<span>🌐 ${escapeHtml(lang)}</span>` : ''}
        </div>
        ${themes.length ? `
          <div style="margin-top:6px;">
            ${themes.map(t => `<span style="display:inline-block;padding:1px 8px;margin:2px;background:#e8f0fe;border-radius:10px;font-size:11px;color:#0073b1;">${escapeHtml(t)}</span>`).join('')}
          </div>
        ` : ''}
        ${rationale ? `
          <div style="margin-top:5px;font-size:12px;color:#555;font-style:italic;">
            AI: "${escapeHtml(truncate(rationale, 120))}"
          </div>
        ` : ''}
        ${influencerPill}
      `;

      body.appendChild(card);
    }

    panel.appendChild(body);
    document.body.appendChild(panel);
    applyPanelTheme(panel);
  }

  // ── Utility Functions ──────────────────────────────────────────────────

  // ── Weekly Report Panel ──────────────────────────────────────────────

  async function showWeeklyReportPanel() {
    closePanel();

    const _monitor = window.linkedInAutoApply.feedMonitor;
    if (!_monitor) {
      console.warn('[FeedUI] feedMonitor module not loaded');
      return;
    }

    const report = await _monitor.getWeeklyReport();
    if (!report) {
      console.warn('[FeedUI] Could not generate weekly report');
      return;
    }

    const panel = document.createElement('div');
    panel.id = 'feed-weekly-report-panel';
    panel.style.cssText = STYLES.panel;

    // Header
    const header = document.createElement('div');
    header.style.cssText = STYLES.panelHeader;
    header.innerHTML = `
      <span style="cursor:grab;" class="drag-handle">Weekly Influencer Report (${escapeHtml(report.currentWeek)})</span>
      <button id="close-report-panel" style="${STYLES.closeButton}">&times;</button>
    `;
    panel.appendChild(header);
    makeDraggable(panel, header.querySelector('.drag-handle'));

    const body = document.createElement('div');
    body.style.cssText = STYLES.panelBody;

    // Summary stats row
    const totalTracked = report.rows.length;
    const totalWeekPosts = report.rows.reduce((s, r) => s + (r.weekPostsSeen || 0), 0);
    const totalComments = report.rows.reduce((s, r) => s + r.weekCommentCount, 0);
    const totalUnseen = report.unseenPosts.length;

    // Overall progress: combine all tier targets
    const overallTarget = report.rows.reduce((s, r) => s + (r.target || 0), 0);
    const overallPct = overallTarget > 0
      ? Math.min(100, Math.round((totalComments / overallTarget) * 100))
      : (totalComments > 0 ? 100 : 0);

    body.innerHTML = `
      <div style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:16px;">
        <div style="flex:1; min-width:80px; background:#f0f4ff; padding:10px; border-radius:6px; text-align:center;">
          <div style="font-size:22px; font-weight:700; color:#0073b1;">${totalTracked}</div>
          <div style="font-size:11px; color:#666;">Tracked</div>
        </div>
        <div style="flex:1; min-width:80px; background:#f0fff4; padding:10px; border-radius:6px; text-align:center;">
          <div style="font-size:22px; font-weight:700; color:#2e7d32;">${totalWeekPosts}</div>
          <div style="font-size:11px; color:#666;">Posts This Week</div>
        </div>
        <div style="flex:1; min-width:80px; background:#fff8e1; padding:10px; border-radius:6px; text-align:center;">
          <div style="font-size:22px; font-weight:700; color:#e65100;">${totalComments}</div>
          <div style="font-size:11px; color:#666;">Comments</div>
        </div>
        <div style="flex:1; min-width:80px; background:#fce4ec; padding:10px; border-radius:6px; text-align:center;">
          <div style="font-size:22px; font-weight:700; color:#dc3545;">${totalUnseen}</div>
          <div style="font-size:11px; color:#666;">Unseen</div>
        </div>
      </div>

      <div style="margin-bottom:16px; padding:12px; background:#f8f9fa; border-radius:8px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <strong style="font-size:13px; color:#333;">Overall Weekly Progress</strong>
          <span style="font-size:13px; font-weight:700; color:${overallPct >= 100 ? '#28a745' : '#e65100'};">${overallPct}%</span>
        </div>
        <div style="background:#e9ecef; border-radius:8px; height:10px; overflow:hidden;">
          <div style="background:${overallPct >= 100 ? '#28a745' : overallPct >= 50 ? '#ffc107' : '#dc3545'};
            width:${overallPct}%; height:100%; transition:width .3s; border-radius:8px;"></div>
        </div>
        <div style="font-size:11px; color:#888; margin-top:4px;">${totalComments} / ${overallTarget} comments completed</div>
      </div>
    `;

    // Last check times
    const formatCheckTime = (ts) => {
      if (!ts) return 'never';
      const diff = Date.now() - ts;
      if (diff < 60000) return 'just now';
      if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
      if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
      return Math.floor(diff / 86400000) + 'd ago';
    };

    const checkTimesHtml = `
      <div style="margin-bottom:16px; font-size:12px; color:#666; display:flex; gap:16px; flex-wrap:wrap;">
        <span>Last checks: T1: <strong>${formatCheckTime(report.lastCheckTimes?.[1])}</strong></span>
        <span>T2: <strong>${formatCheckTime(report.lastCheckTimes?.[2])}</strong></span>
        <span>T3: <strong>${formatCheckTime(report.lastCheckTimes?.[3])}</strong></span>
      </div>
    `;
    body.insertAdjacentHTML('beforeend', checkTimesHtml);

    // Per-tier sections with tier-specific descriptions
    const tierMeta = {
      1: { color: '#7c3aed', label: 'Tier 1', desc: 'Comment on every post', rule: 'REQUIRED' },
      2: { color: '#0073b1', label: 'Tier 2', desc: '2-3 comments per week', rule: 'WEEKLY' },
      3: { color: '#6c757d', label: 'Tier 3', desc: 'Optional commenting', rule: 'OPTIONAL' },
    };

    for (const tier of [1, 2, 3]) {
      const meta = tierMeta[tier];
      const tierSum = report.tierSummary?.[tier];
      const tierRows = report.rows.filter(r => r.tier === tier);
      if (tierRows.length === 0) continue;

      const tierPct = tierSum?.pct || 0;
      const tierTarget = tierSum?.effectiveTarget || 0;
      const tierComments = tierSum?.weekCommentsMade || 0;
      const tierMet = tierSum?.targetMet || false;

      // Tier-specific progress label
      let progressLabel;
      if (tier === 1) {
        const weekPosts = tierSum?.weekPostsSeen || 0;
        progressLabel = `${tierComments}/${weekPosts} posts commented`;
      } else if (tier === 2) {
        progressLabel = `${tierComments}/${tierTarget} weekly comments`;
      } else {
        progressLabel = `${tierComments} comments (optional)`;
      }

      // Progress bar color
      let barColor;
      if (tier === 3) {
        barColor = '#6c757d';
      } else if (tierMet) {
        barColor = '#28a745';
      } else if (tierPct >= 50) {
        barColor = '#ffc107';
      } else {
        barColor = '#dc3545';
      }

      let sectionHtml = `
        <div style="margin:12px 0; padding:12px; background:#f8f9fa; border-radius:8px; border-left:4px solid ${meta.color};">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <div>
              <strong style="color:${meta.color}; font-size:14px;">${meta.label}</strong>
              <span style="background:${meta.color}20; color:${meta.color}; font-size:10px; padding:2px 8px;
                border-radius:10px; margin-left:8px; font-weight:600;">${meta.rule}</span>
            </div>
            <span style="font-size:13px; font-weight:700; color:${tierMet ? '#28a745' : (tier === 3 ? '#6c757d' : '#e65100')};">
              ${tier === 3 ? (tierComments > 0 ? tierComments + ' done' : '--') : tierPct + '%'}
            </span>
          </div>
          <div style="color:#888; font-size:11px; margin-bottom:8px;">${meta.desc}</div>
          <div style="background:#e9ecef; border-radius:8px; height:8px; overflow:hidden; margin-bottom:4px;">
            <div style="background:${barColor}; width:${tier === 3 ? (tierComments > 0 ? 100 : 0) : tierPct}%;
              height:100%; transition:width .3s; border-radius:8px;"></div>
          </div>
          <div style="font-size:11px; color:#888; margin-bottom:10px;">${progressLabel}</div>

          <table style="width:100%; font-size:12px; border-collapse:collapse;">
            <tr style="color:#888; text-align:left; border-bottom:1px solid #dee2e6;">
              <th style="padding:6px;">Name</th>
              <th style="padding:6px; text-align:center;">Week Posts</th>
              <th style="padding:6px; text-align:center;">Comments</th>
              <th style="padding:6px;">Progress</th>
              <th style="padding:6px;">Last Seen</th>
            </tr>
      `;

      for (const row of tierRows) {
        const lastSeen = formatCheckTime(row.lastSeenAt);
        const rowPct = row.pct || 0;
        const rowTarget = row.target || 0;
        const rowMet = tier === 3 ? true : rowPct >= 100;

        // Per-influencer progress label
        let rowProgressLabel;
        if (tier === 1) {
          rowProgressLabel = `${row.weekCommentCount}/${row.weekPostsSeen || 0}`;
        } else if (tier === 2) {
          rowProgressLabel = `${row.weekCommentCount}/${rowTarget}`;
        } else {
          rowProgressLabel = row.weekCommentCount > 0 ? String(row.weekCommentCount) : '--';
        }

        // Per-influencer bar color
        let rowBarColor;
        if (tier === 3) {
          rowBarColor = '#6c757d';
        } else if (rowMet) {
          rowBarColor = '#28a745';
        } else if (rowPct >= 50) {
          rowBarColor = '#ffc107';
        } else {
          rowBarColor = '#dc3545';
        }

        sectionHtml += `
          <tr style="border-top:1px solid #e9ecef;">
            <td style="padding:6px;">
              <strong>${escapeHtml(row.name)}</strong>
              ${row.title ? `<div style="color:#888; font-size:11px;">${escapeHtml(truncate(row.title, 40))}</div>` : ''}
            </td>
            <td style="padding:6px; text-align:center;">${row.weekPostsSeen || 0}</td>
            <td style="padding:6px; text-align:center; font-weight:600;">${row.weekCommentCount}</td>
            <td style="padding:6px; min-width:100px;">
              <div style="display:flex; align-items:center; gap:6px;">
                <div style="flex:1; background:#e9ecef; border-radius:6px; height:6px; overflow:hidden;">
                  <div style="background:${rowBarColor}; width:${tier === 3 ? (row.weekCommentCount > 0 ? 100 : 0) : rowPct}%;
                    height:100%; border-radius:6px;"></div>
                </div>
                <span style="font-size:10px; font-weight:600; color:${rowMet ? '#28a745' : '#888'}; min-width:32px;">
                  ${tier === 3 ? (row.weekCommentCount > 0 ? 'done' : '--') : rowPct + '%'}
                </span>
              </div>
              <div style="font-size:10px; color:#aaa; margin-top:2px;">${rowProgressLabel}</div>
            </td>
            <td style="padding:6px; color:#888; font-size:11px;">${lastSeen}</td>
          </tr>
        `;
      }

      sectionHtml += '</table></div>';
      body.insertAdjacentHTML('beforeend', sectionHtml);
    }

    // New (unseen) posts section
    if (report.unseenPosts.length > 0) {
      let unseenHtml = `
        <div style="margin-top:16px;">
          <h3 style="margin:0 0 8px 0; font-size:15px; color:#333;">
            New Influencer Posts (${report.unseenPosts.length})
          </h3>
      `;

      for (const p of report.unseenPosts.slice(0, 20)) {
        const tierColor = tierMeta[p.tier]?.color || '#6c757d';
        const ago = formatCheckTime(p.foundAt);
        unseenHtml += `
          <div style="padding:8px; margin:4px 0; background:#fff; border:1px solid #e9ecef;
            border-left:3px solid ${tierColor}; border-radius:4px; font-size:12px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <strong>${escapeHtml(p.influencerName)}</strong>
              <span style="background:${tierColor}; color:#fff; font-size:10px; padding:1px 6px;
                border-radius:8px; font-weight:600;">T${p.tier}</span>
            </div>
            <div style="color:#555; margin-top:4px;">${escapeHtml(truncate(p.contentSnippet, 120))}</div>
            <div style="color:#999; font-size:11px; margin-top:2px;">Found ${ago}</div>
          </div>
        `;
      }
      unseenHtml += '</div>';
      body.insertAdjacentHTML('beforeend', unseenHtml);
    }

    // Footer buttons
    const footer = document.createElement('div');
    footer.style.cssText = 'padding:10px 16px; border-top:1px solid #e9ecef; display:flex; gap:10px; justify-content:flex-end;';

    const markAllBtn = document.createElement('button');
    markAllBtn.textContent = 'Mark All Seen';
    markAllBtn.style.cssText = 'padding:8px 16px; background:#0073b1; color:#fff; border:none; border-radius:6px; cursor:pointer; font-size:13px;';
    markAllBtn.addEventListener('click', async () => {
      if (window.linkedInAutoApply.feedMonitor) {
        await window.linkedInAutoApply.feedMonitor.markAllSeen();
        markAllBtn.textContent = 'Done!';
        markAllBtn.disabled = true;
        setTimeout(() => updateBadges(), 100);
      }
    });

    const exportBtn = document.createElement('button');
    exportBtn.textContent = 'Export Report';
    exportBtn.style.cssText = 'padding:8px 16px; background:#6c757d; color:#fff; border:none; border-radius:6px; cursor:pointer; font-size:13px;';
    exportBtn.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `influencer-report-${report.currentWeek}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

    footer.appendChild(markAllBtn);
    footer.appendChild(exportBtn);

    panel.appendChild(body);
    panel.appendChild(footer);
    document.body.appendChild(panel);
    applyPanelTheme(panel);

    document.getElementById('close-report-panel')?.addEventListener('click', () => panel.remove());
  }

  /**
   * Close panel
   */
  function closePanel() {
    const existing = document.getElementById('feed-analysis-panel');
    if (existing) existing.remove();
    existing?.remove();
    const settingsPanel = document.getElementById('feed-settings-panel');
    if (settingsPanel) settingsPanel.remove();
    document.getElementById('feed-queue-panel')?.remove();
    document.getElementById('feed-weekly-report-panel')?.remove();
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
    createAutoLikeButton,
    createSettingsButton,
    createWeeklyReportButton,
    startAnalysis,
    toggleAutoEngage,
    toggleAutoLike,
    showAnalysisResults,
    showSettingsPanel,
    showQueuePanel,
    showWeeklyReportPanel,
    closePanel,
    updateProgress,
    updateProgressBar,
    updateBadges,
    updateProfileVisitProgress,
    onProfileVisitsComplete,
  };

  console.log('[FeedUI] Module loaded successfully');
})();
  