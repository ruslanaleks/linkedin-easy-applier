// feed/feedTopics.js - Topics & Post Generation UI
// Creates a floating button + 3-tab panel: Weekly Topics, Generate Post, My Drafts

window.linkedInAutoApply = window.linkedInAutoApply || {};

(function () {
  'use strict';

  // ── Styles (matches feedUI.js patterns) ─────────────────────────────
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
      z-index: 10001; width: 90vw; max-width: 750px;
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
  };

  // ── State ───────────────────────────────────────────────────────────
  let topicsPanel = null;
  let activeTab = 'topics';
  let selectedTopics = new Set();
  let currentWeekFilter = 'both';
  let cachedTopics = null;
  let cachedDrafts = null;
  let generationInProgress = false;
  let generatedVariants = [];

  // ── Dark Mode ───────────────────────────────────────────────────────

  function injectThemeStyles() {
    if (document.getElementById('feed-topics-theme-style')) return;
    const style = document.createElement('style');
    style.id = 'feed-topics-theme-style';
    style.textContent = `
      #feed-topics-panel[data-theme="dark"] {
        background: #1b1f23 !important;
        color: #e6e6e6 !important;
        color-scheme: dark !important;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5) !important;
      }
      #feed-topics-panel[data-theme="dark"] .topics-header {
        border-bottom-color: #333 !important;
      }
      #feed-topics-panel[data-theme="dark"] .topics-tab { background: #2d333b !important; color: #ccc !important; }
      #feed-topics-panel[data-theme="dark"] .topics-tab.active { background: #6a1b9a !important; color: #fff !important; }
      #feed-topics-panel[data-theme="dark"] .topic-card { background: #2d333b !important; border-color: #444 !important; }
      #feed-topics-panel[data-theme="dark"] input,
      #feed-topics-panel[data-theme="dark"] textarea,
      #feed-topics-panel[data-theme="dark"] select {
        background: #2d333b !important; color: #e6e6e6 !important;
        border-color: #444 !important;
      }
      #feed-topics-panel[data-theme="dark"] .variant-card { background: #2d333b !important; border-color: #444 !important; }
      #feed-topics-panel[data-theme="dark"] .draft-card { background: #2d333b !important; }
      #feed-topics-panel[data-theme="dark"] .btn-secondary { background: #444 !important; color: #e6e6e6 !important; }
    `;
    document.head.appendChild(style);
  }

  async function getTheme() {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage) return 'light';
      const data = await chrome.storage.local.get('feedUiSettings');
      const pref = data?.feedUiSettings?.theme || 'auto';
      if (pref === 'light' || pref === 'dark') return pref;
      return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  }

  // ── Button Creation ─────────────────────────────────────────────────

  function createTopicsButton() {
    const existing = document.getElementById('linkedin-feed-topics-btn');
    if (existing) existing.remove();

    const button = document.createElement('button');
    button.id = 'linkedin-feed-topics-btn';
    button.innerText = 'Topics & Post';
    button.style.cssText = `${STYLES.button}
      bottom: 270px; right: 20px;
      background-color: #6a1b9a; color: #fff;
    `;

    button.addEventListener('mouseenter', () => {
      button.style.backgroundColor = '#4a148c';
      button.style.transform = 'scale(1.05)';
    });
    button.addEventListener('mouseleave', () => {
      button.style.backgroundColor = '#6a1b9a';
      button.style.transform = 'scale(1)';
    });
    button.addEventListener('click', showTopicsPanel);

    document.body.appendChild(button);
    return button;
  }

  // ── Panel Management ────────────────────────────────────────────────

  async function showTopicsPanel() {
    const _api = window.linkedInAutoApply.feedAPI;
    if (!_api) {
      console.error('[FeedTopics] feedAPI module not loaded');
      return;
    }

    injectThemeStyles();

    if (!_api.isAuthenticated()) {
      showLoginPanel();
      return;
    }

    renderMainPanel();
  }

  function closePanel() {
    const panel = document.getElementById('feed-topics-panel');
    if (panel) panel.remove();
    topicsPanel = null;
  }

  // ── Login Panel ─────────────────────────────────────────────────────

  function showLoginPanel() {
    closePanel();

    const panel = document.createElement('div');
    panel.id = 'feed-topics-panel';
    panel.style.cssText = STYLES.panel;

    const theme = 'light'; // Will update async
    panel.setAttribute('data-theme', theme);

    panel.innerHTML = `
      <div class="topics-header" style="${STYLES.panelHeader}">
        <strong style="font-size: 16px;">Login to Topics & Post</strong>
        <button id="topics-close-btn" style="background:none;border:none;font-size:20px;cursor:pointer;color:inherit;">×</button>
      </div>
      <div style="${STYLES.panelBody}">
        <p style="margin-bottom:16px;color:#666;font-size:13px;">
          Sign in to your server account to access topic collection and post generation.
        </p>
        <div style="margin-bottom:12px;">
          <label style="display:block;margin-bottom:4px;font-size:13px;font-weight:600;">Email</label>
          <input id="topics-email" type="email" placeholder="your@email.com"
            style="width:100%;padding:8px 12px;border:1px solid #ccc;border-radius:4px;font-size:14px;box-sizing:border-box;" />
        </div>
        <div style="margin-bottom:16px;">
          <label style="display:block;margin-bottom:4px;font-size:13px;font-weight:600;">Password</label>
          <input id="topics-password" type="password" placeholder="Min 8 characters"
            style="width:100%;padding:8px 12px;border:1px solid #ccc;border-radius:4px;font-size:14px;box-sizing:border-box;" />
        </div>
        <div id="topics-auth-error" style="color:#d32f2f;font-size:13px;margin-bottom:12px;display:none;"></div>
        <div style="display:flex;gap:8px;">
          <button id="topics-login-btn" style="flex:1;padding:10px;background:#6a1b9a;color:#fff;border:none;border-radius:4px;font-size:14px;font-weight:600;cursor:pointer;">
            Login
          </button>
          <button id="topics-register-btn" style="flex:1;padding:10px;background:#f5f5f5;color:#333;border:1px solid #ccc;border-radius:4px;font-size:14px;cursor:pointer;">
            Register
          </button>
        </div>
        <div style="margin-top:16px;padding-top:12px;border-top:1px solid #eee;">
          <label style="display:block;margin-bottom:4px;font-size:12px;color:#666;">Server URL</label>
          <input id="topics-server-url" type="text" value="${window.linkedInAutoApply.feedAPI.getServerUrl()}"
            style="width:100%;padding:6px 10px;border:1px solid #ddd;border-radius:4px;font-size:12px;box-sizing:border-box;" />
        </div>
      </div>
    `;

    document.body.appendChild(panel);
    topicsPanel = panel;

    // Apply theme async
    getTheme().then(t => panel.setAttribute('data-theme', t));

    // Event handlers
    panel.querySelector('#topics-close-btn').addEventListener('click', closePanel);

    panel.querySelector('#topics-login-btn').addEventListener('click', async () => {
      await handleAuth('login');
    });

    panel.querySelector('#topics-register-btn').addEventListener('click', async () => {
      await handleAuth('register');
    });

    // Update server URL on change
    panel.querySelector('#topics-server-url').addEventListener('change', (e) => {
      window.linkedInAutoApply.feedAPI.setServerUrl(e.target.value);
    });

    // Enter key on password triggers login
    panel.querySelector('#topics-password').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleAuth('login');
    });
  }

  async function handleAuth(mode) {
    const email = document.getElementById('topics-email')?.value?.trim();
    const password = document.getElementById('topics-password')?.value;
    const errorEl = document.getElementById('topics-auth-error');

    if (!email || !password) {
      errorEl.textContent = 'Email and password are required';
      errorEl.style.display = 'block';
      return;
    }

    if (mode === 'register' && password.length < 8) {
      errorEl.textContent = 'Password must be at least 8 characters';
      errorEl.style.display = 'block';
      return;
    }

    // Update server URL before auth
    const urlInput = document.getElementById('topics-server-url');
    if (urlInput) window.linkedInAutoApply.feedAPI.setServerUrl(urlInput.value);

    const loginBtn = document.getElementById('topics-login-btn');
    const registerBtn = document.getElementById('topics-register-btn');
    if (loginBtn) loginBtn.disabled = true;
    if (registerBtn) registerBtn.disabled = true;
    errorEl.style.display = 'none';

    const _api = window.linkedInAutoApply.feedAPI;
    const res = mode === 'login'
      ? await _api.login(email, password)
      : await _api.register(email, password);

    if (res.ok) {
      closePanel();
      renderMainPanel();
    } else {
      errorEl.textContent = res.error || 'Authentication failed';
      errorEl.style.display = 'block';
      if (loginBtn) loginBtn.disabled = false;
      if (registerBtn) registerBtn.disabled = false;
    }
  }

  // ── Main 3-Tab Panel ────────────────────────────────────────────────

  async function renderMainPanel() {
    closePanel();

    const panel = document.createElement('div');
    panel.id = 'feed-topics-panel';
    panel.style.cssText = STYLES.panel;

    const theme = await getTheme();
    panel.setAttribute('data-theme', theme);

    panel.innerHTML = `
      <div class="topics-header" style="${STYLES.panelHeader}">
        <strong style="font-size: 16px;">Topics & Post Generation</strong>
        <div style="display:flex;align-items:center;gap:8px;">
          <button id="topics-logout-btn" style="background:none;border:none;font-size:12px;cursor:pointer;color:#999;text-decoration:underline;">Logout</button>
          <button id="topics-close-btn" style="background:none;border:none;font-size:20px;cursor:pointer;color:inherit;">×</button>
        </div>
      </div>
      <div style="display:flex;border-bottom:1px solid #eee;padding:0 18px;">
        <button class="topics-tab active" data-tab="topics" style="padding:10px 16px;border:none;cursor:pointer;font-size:13px;font-weight:600;border-bottom:2px solid #6a1b9a;background:none;color:#6a1b9a;">
          Weekly Topics
        </button>
        <button class="topics-tab" data-tab="generate" style="padding:10px 16px;border:none;cursor:pointer;font-size:13px;font-weight:500;border-bottom:2px solid transparent;background:none;color:#666;">
          Generate Post
        </button>
        <button class="topics-tab" data-tab="drafts" style="padding:10px 16px;border:none;cursor:pointer;font-size:13px;font-weight:500;border-bottom:2px solid transparent;background:none;color:#666;">
          My Drafts
        </button>
      </div>
      <div id="topics-panel-body" style="${STYLES.panelBody}"></div>
    `;

    document.body.appendChild(panel);
    topicsPanel = panel;

    // Tab switching
    panel.querySelectorAll('.topics-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        panel.querySelectorAll('.topics-tab').forEach(t => {
          t.classList.remove('active');
          t.style.borderBottom = '2px solid transparent';
          t.style.color = theme === 'dark' ? '#ccc' : '#666';
          t.style.fontWeight = '500';
        });
        tab.classList.add('active');
        tab.style.borderBottom = '2px solid #6a1b9a';
        tab.style.color = '#6a1b9a';
        tab.style.fontWeight = '600';
        activeTab = tab.dataset.tab;
        renderActiveTab();
      });
    });

    panel.querySelector('#topics-close-btn').addEventListener('click', closePanel);
    panel.querySelector('#topics-logout-btn').addEventListener('click', async () => {
      await window.linkedInAutoApply.feedAPI.logout();
      closePanel();
    });

    renderActiveTab();
  }

  function renderActiveTab() {
    const body = document.getElementById('topics-panel-body');
    if (!body) return;

    body.innerHTML = '<div style="text-align:center;padding:30px;color:#999;">Loading...</div>';

    switch (activeTab) {
      case 'topics':
        renderTopicsTab(body);
        break;
      case 'generate':
        renderGenerateTab(body);
        break;
      case 'drafts':
        renderDraftsTab(body);
        break;
    }
  }

  // ── Tab 1: Weekly Topics ────────────────────────────────────────────

  async function renderTopicsTab(container) {
    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <div style="display:flex;gap:6px;">
          <button class="week-filter btn-secondary ${currentWeekFilter === 'current' ? 'active' : ''}" data-week="current"
            style="padding:6px 12px;border:1px solid #ccc;border-radius:4px;cursor:pointer;font-size:12px;background:${currentWeekFilter === 'current' ? '#6a1b9a' : '#f5f5f5'};color:${currentWeekFilter === 'current' ? '#fff' : '#333'};">
            This Week
          </button>
          <button class="week-filter btn-secondary ${currentWeekFilter === 'previous' ? 'active' : ''}" data-week="previous"
            style="padding:6px 12px;border:1px solid #ccc;border-radius:4px;cursor:pointer;font-size:12px;background:${currentWeekFilter === 'previous' ? '#6a1b9a' : '#f5f5f5'};color:${currentWeekFilter === 'previous' ? '#fff' : '#333'};">
            Last Week
          </button>
          <button class="week-filter btn-secondary ${currentWeekFilter === 'both' ? 'active' : ''}" data-week="both"
            style="padding:6px 12px;border:1px solid #ccc;border-radius:4px;cursor:pointer;font-size:12px;background:${currentWeekFilter === 'both' ? '#6a1b9a' : '#f5f5f5'};color:${currentWeekFilter === 'both' ? '#fff' : '#333'};">
            Both
          </button>
        </div>
        <span style="font-size:12px;color:#999;">${selectedTopics.size} selected</span>
      </div>
      <div id="topics-list" style="text-align:center;padding:20px;color:#999;">Loading topics...</div>
      <div style="margin-top:14px;text-align:right;">
        <button id="topics-generate-selected" style="padding:8px 16px;background:#6a1b9a;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;display:none;">
          Generate from Selected
        </button>
      </div>
    `;

    // Week filter handlers
    container.querySelectorAll('.week-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        currentWeekFilter = btn.dataset.week;
        cachedTopics = null;
        renderTopicsTab(container);
      });
    });

    container.querySelector('#topics-generate-selected')?.addEventListener('click', () => {
      activeTab = 'generate';
      // Update tab visual
      const panel = document.getElementById('feed-topics-panel');
      if (panel) {
        panel.querySelectorAll('.topics-tab').forEach(t => {
          const isGen = t.dataset.tab === 'generate';
          t.classList.toggle('active', isGen);
          t.style.borderBottom = isGen ? '2px solid #6a1b9a' : '2px solid transparent';
          t.style.color = isGen ? '#6a1b9a' : '#666';
          t.style.fontWeight = isGen ? '600' : '500';
        });
      }
      renderActiveTab();
    });

    // Fetch topics
    const _api = window.linkedInAutoApply.feedAPI;
    const res = await _api.getWeeklyTopics(currentWeekFilter);

    const listEl = document.getElementById('topics-list');
    if (!listEl) return;

    if (!res.ok) {
      listEl.innerHTML = `<div style="color:#d32f2f;padding:10px;">Failed to load topics: ${res.error || 'Unknown error'}</div>`;
      return;
    }

    const topics = res.data || [];
    cachedTopics = topics;

    if (topics.length === 0) {
      listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#999;">No topics found. Start engaging with your feed to collect posts and extract topics.</div>';
      return;
    }

    listEl.innerHTML = '';
    for (const topic of topics) {
      const card = createTopicCard(topic);
      listEl.appendChild(card);
    }

    updateGenerateButton();
  }

  function createTopicCard(topic) {
    const card = document.createElement('div');
    card.className = 'topic-card';
    card.style.cssText = `
      padding: 10px 14px; margin-bottom: 8px;
      background: #f8f9fa; border-radius: 6px;
      border-left: 3px solid #6a1b9a;
      display: flex; align-items: center; gap: 10px;
    `;

    const isSelected = selectedTopics.has(topic.topicId);
    const stats = topic.current || topic.previous || {};
    const growth = topic.growthVsPrevWeek || 0;
    const trendIcon = growth > 10 ? '↑' : growth < -10 ? '↓' : '→';
    const trendColor = growth > 10 ? '#2e7d32' : growth < -10 ? '#d32f2f' : '#666';

    card.innerHTML = `
      <input type="checkbox" ${isSelected ? 'checked' : ''} style="flex-shrink:0;cursor:pointer;width:16px;height:16px;" />
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:13px;margin-bottom:2px;">${escapeHtml(topic.label)}</div>
        <div style="display:flex;gap:12px;font-size:11px;color:#666;">
          <span title="Posts count">${stats.postsCount || 0} posts</span>
          <span title="Total reactions">${stats.totalReactions || 0} reactions</span>
          <span title="Unique authors">${stats.uniqueAuthors || 0} authors</span>
          <span style="color:${trendColor};font-weight:600;" title="Growth vs prev week">${trendIcon} ${growth > 0 ? '+' : ''}${growth}%</span>
        </div>
      </div>
      <div style="font-size:11px;color:#999;text-align:right;">
        Score: ${topic.combinedScore}
      </div>
    `;

    // Checkbox handler
    const cb = card.querySelector('input[type="checkbox"]');
    cb.addEventListener('change', () => {
      if (cb.checked) {
        selectedTopics.add(topic.topicId);
      } else {
        selectedTopics.delete(topic.topicId);
      }
      updateGenerateButton();
    });

    return card;
  }

  function updateGenerateButton() {
    const btn = document.getElementById('topics-generate-selected');
    if (btn) {
      btn.style.display = selectedTopics.size > 0 ? 'inline-block' : 'none';
      btn.textContent = `Generate from ${selectedTopics.size} Selected`;
    }
  }

  // ── Tab 2: Generate Post ────────────────────────────────────────────

  async function renderGenerateTab(container) {
    container.innerHTML = `
      <div style="margin-bottom:16px;">
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:600;">Mode</label>
        <div style="display:flex;gap:8px;">
          <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:13px;">
            <input type="radio" name="gen-mode" value="single_topic" checked /> Single Topic
          </label>
          <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:13px;">
            <input type="radio" name="gen-mode" value="aggregated" /> Aggregated
          </label>
        </div>
      </div>

      ${selectedTopics.size > 0 ? `
        <div style="margin-bottom:14px;padding:8px 12px;background:#f3e5f5;border-radius:4px;font-size:12px;">
          Selected topics: ${getSelectedLabels().map(l => '<strong>' + escapeHtml(l) + '</strong>').join(', ')}
        </div>
      ` : '<div style="margin-bottom:14px;font-size:12px;color:#999;">No topics selected — aggregated mode will use top trending topics.</div>'}

      <div style="margin-bottom:14px;">
        <label style="display:block;margin-bottom:4px;font-size:13px;font-weight:600;">Seriousness: <span id="val-serious">40</span></label>
        <input type="range" id="slider-serious" min="0" max="100" value="40" style="width:100%;" />
      </div>
      <div style="margin-bottom:14px;">
        <label style="display:block;margin-bottom:4px;font-size:13px;font-weight:600;">Humor: <span id="val-humor">60</span></label>
        <input type="range" id="slider-humor" min="0" max="100" value="60" style="width:100%;" />
      </div>
      <div style="margin-bottom:14px;">
        <label style="display:block;margin-bottom:4px;font-size:13px;font-weight:600;">Personal: <span id="val-personal">70</span></label>
        <input type="range" id="slider-personal" min="0" max="100" value="70" style="width:100%;" />
      </div>
      <div style="margin-bottom:14px;">
        <label style="display:block;margin-bottom:4px;font-size:13px;font-weight:600;">Provocative: <span id="val-provocative">20</span></label>
        <input type="range" id="slider-provocative" min="0" max="100" value="20" style="width:100%;" />
      </div>

      <div style="margin-bottom:14px;">
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:600;">Length</label>
        <div style="display:flex;gap:8px;">
          <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:13px;">
            <input type="radio" name="gen-length" value="short" /> Short (~50w)
          </label>
          <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:13px;">
            <input type="radio" name="gen-length" value="medium" checked /> Medium (~150w)
          </label>
          <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:13px;">
            <input type="radio" name="gen-length" value="long" /> Long (~300w)
          </label>
        </div>
      </div>

      <div style="margin-bottom:16px;">
        <label style="display:block;margin-bottom:4px;font-size:13px;font-weight:600;">Additional Context (optional)</label>
        <textarea id="gen-extra-context" rows="3" placeholder="What do you want to emphasize in the post?"
          style="width:100%;padding:8px 12px;border:1px solid #ccc;border-radius:4px;font-size:13px;resize:vertical;box-sizing:border-box;"></textarea>
      </div>

      <button id="gen-submit-btn" style="width:100%;padding:12px;background:#6a1b9a;color:#fff;border:none;border-radius:4px;font-size:14px;font-weight:600;cursor:pointer;">
        Generate Post
      </button>

      <div id="gen-status" style="margin-top:12px;font-size:13px;color:#666;text-align:center;display:none;"></div>
      <div id="gen-results" style="margin-top:16px;"></div>
    `;

    // Wire up sliders
    ['serious', 'humor', 'personal', 'provocative'].forEach(name => {
      const slider = document.getElementById('slider-' + name);
      const val = document.getElementById('val-' + name);
      if (slider && val) {
        slider.addEventListener('input', () => { val.textContent = slider.value; });
      }
    });

    // Generate button
    container.querySelector('#gen-submit-btn').addEventListener('click', handleGenerate);

    // Re-render existing results if any
    if (generatedVariants.length > 0) {
      renderVariants(generatedVariants);
    }
  }

  async function handleGenerate() {
    if (generationInProgress) return;
    generationInProgress = true;

    const btn = document.getElementById('gen-submit-btn');
    const statusEl = document.getElementById('gen-status');
    const resultsEl = document.getElementById('gen-results');

    if (btn) { btn.disabled = true; btn.textContent = 'Generating...'; }
    if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = 'Calling AI to generate post variants... This may take 30-60 seconds.'; }
    if (resultsEl) resultsEl.innerHTML = '';

    const mode = document.querySelector('input[name="gen-mode"]:checked')?.value || 'aggregated';
    const length = document.querySelector('input[name="gen-length"]:checked')?.value || 'medium';
    const extraContext = document.getElementById('gen-extra-context')?.value || '';

    const toneSettings = {
      serious: parseInt(document.getElementById('slider-serious')?.value || '40', 10),
      humor: parseInt(document.getElementById('slider-humor')?.value || '60', 10),
      personal: parseInt(document.getElementById('slider-personal')?.value || '70', 10),
      provocative: parseInt(document.getElementById('slider-provocative')?.value || '20', 10),
      length: length,
    };

    const _api = window.linkedInAutoApply.feedAPI;
    const res = await _api.generatePost({
      mode,
      topicIds: Array.from(selectedTopics),
      toneSettings,
      extraContext: extraContext || undefined,
    });

    generationInProgress = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Generate Post'; }

    if (!res.ok) {
      if (statusEl) { statusEl.textContent = 'Generation failed: ' + (res.error || 'Unknown error'); statusEl.style.color = '#d32f2f'; }
      return;
    }

    if (statusEl) statusEl.style.display = 'none';

    generatedVariants = res.data || [];
    renderVariants(generatedVariants);
  }

  function renderVariants(variants) {
    const resultsEl = document.getElementById('gen-results');
    if (!resultsEl) return;

    resultsEl.innerHTML = '';

    if (variants.length === 0) {
      resultsEl.innerHTML = '<div style="color:#999;text-align:center;">No variants generated.</div>';
      return;
    }

    variants.forEach((variant, idx) => {
      const text = variant.outputText || variant;
      const card = document.createElement('div');
      card.className = 'variant-card';
      card.style.cssText = `
        margin-bottom: 14px; padding: 14px;
        background: #faf8fc; border: 1px solid #e0d4f0;
        border-radius: 6px;
      `;

      card.innerHTML = `
        <div style="font-size:11px;font-weight:600;color:#6a1b9a;margin-bottom:8px;">Variant ${idx + 1}</div>
        <div class="variant-text" style="font-size:13px;line-height:1.6;white-space:pre-wrap;margin-bottom:12px;">${escapeHtml(typeof text === 'string' ? text : text)}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button class="var-copy" style="padding:6px 12px;background:#6a1b9a;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;">
            Copy
          </button>
          <button class="var-accept" style="padding:6px 12px;background:#2e7d32;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;">
            Accept as Draft
          </button>
          <button class="var-discard" style="padding:6px 12px;background:#d32f2f;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;">
            Discard
          </button>
        </div>
      `;

      // Copy button
      card.querySelector('.var-copy').addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(typeof text === 'string' ? text : '');
          card.querySelector('.var-copy').textContent = 'Copied!';
          setTimeout(() => { card.querySelector('.var-copy').textContent = 'Copy'; }, 2000);
        } catch (err) {
          console.warn('[FeedTopics] Copy failed:', err);
        }
      });

      // Accept as draft (already saved on server, just confirm)
      card.querySelector('.var-accept').addEventListener('click', () => {
        card.querySelector('.var-accept').textContent = 'Saved as Draft';
        card.querySelector('.var-accept').disabled = true;
        card.querySelector('.var-accept').style.background = '#999';
      });

      // Discard
      card.querySelector('.var-discard').addEventListener('click', async () => {
        if (variant.id) {
          await window.linkedInAutoApply.feedAPI.updateDraft(variant.id, { status: 'discarded' });
        }
        card.style.opacity = '0.4';
        card.querySelector('.var-discard').textContent = 'Discarded';
        card.querySelector('.var-discard').disabled = true;
      });

      resultsEl.appendChild(card);
    });
  }

  // ── Tab 3: My Drafts ────────────────────────────────────────────────

  async function renderDraftsTab(container) {
    container.innerHTML = '<div style="text-align:center;padding:30px;color:#999;">Loading drafts...</div>';

    const _api = window.linkedInAutoApply.feedAPI;
    const res = await _api.getMyDrafts(null, 30, 0);

    if (!res.ok) {
      container.innerHTML = `<div style="color:#d32f2f;padding:10px;">Failed to load drafts: ${res.error || 'Unknown error'}</div>`;
      return;
    }

    const { items, total } = res.data || { items: [], total: 0 };
    cachedDrafts = items;

    if (items.length === 0) {
      container.innerHTML = '<div style="padding:20px;text-align:center;color:#999;">No drafts yet. Generate a post first!</div>';
      return;
    }

    container.innerHTML = `
      <div style="margin-bottom:10px;font-size:12px;color:#666;">${total} total drafts</div>
      <div id="drafts-list"></div>
    `;

    const listEl = document.getElementById('drafts-list');
    for (const draft of items) {
      listEl.appendChild(createDraftCard(draft));
    }
  }

  function createDraftCard(draft) {
    const card = document.createElement('div');
    card.className = 'draft-card';
    card.style.cssText = `
      margin-bottom: 10px; padding: 12px;
      background: #f8f9fa; border-radius: 6px;
      border-left: 3px solid ${getStatusColor(draft.status)};
    `;

    const text = draft.myEditedText || draft.outputText || '';
    const preview = text.slice(0, 200) + (text.length > 200 ? '...' : '');
    const topicLabel = draft.topic?.label || (draft.mode === 'aggregated' ? 'Aggregated' : 'Unknown');
    const dateStr = new Date(draft.createdAt).toLocaleDateString();

    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <span style="font-size:12px;font-weight:600;color:#6a1b9a;">${escapeHtml(topicLabel)}</span>
        <span style="font-size:11px;padding:2px 8px;border-radius:12px;background:${getStatusColor(draft.status)}22;color:${getStatusColor(draft.status)};font-weight:600;">
          ${draft.status}
        </span>
      </div>
      <div style="font-size:13px;line-height:1.5;color:#444;margin-bottom:10px;">${escapeHtml(preview)}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:11px;color:#999;">${dateStr}</span>
        <div style="display:flex;gap:6px;">
          <button class="draft-copy" style="padding:4px 10px;background:#6a1b9a;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;">Copy</button>
          ${draft.status !== 'published' ? `
            <button class="draft-publish" style="padding:4px 10px;background:#2e7d32;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;">Mark Published</button>
          ` : ''}
        </div>
      </div>
    `;

    // Copy full text
    card.querySelector('.draft-copy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(text);
        card.querySelector('.draft-copy').textContent = 'Copied!';
        setTimeout(() => { card.querySelector('.draft-copy').textContent = 'Copy'; }, 2000);
      } catch (err) {
        console.warn('[FeedTopics] Copy failed:', err);
      }
    });

    // Publish
    const publishBtn = card.querySelector('.draft-publish');
    if (publishBtn) {
      publishBtn.addEventListener('click', async () => {
        const res = await window.linkedInAutoApply.feedAPI.updateDraft(draft.id, { status: 'published' });
        if (res.ok) {
          publishBtn.textContent = 'Published';
          publishBtn.disabled = true;
          publishBtn.style.background = '#999';
          // Update status badge
          const badge = card.querySelector('span[style*="border-radius:12px"]');
          if (badge) { badge.textContent = 'published'; badge.style.color = '#2e7d32'; }
        }
      });
    }

    return card;
  }

  function getStatusColor(status) {
    switch (status) {
      case 'draft': return '#ff9800';
      case 'edited': return '#2196f3';
      case 'published': return '#2e7d32';
      case 'discarded': return '#999';
      default: return '#666';
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  function getSelectedLabels() {
    if (!cachedTopics) return [];
    return cachedTopics
      .filter(t => selectedTopics.has(t.topicId))
      .map(t => t.label);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Public API ──────────────────────────────────────────────────────

  window.linkedInAutoApply.feedTopics = {
    createTopicsButton,
    showTopicsPanel,
    showLoginPanel,
    closePanel,
  };

  console.log('[FeedTopics] Module loaded');
})();
