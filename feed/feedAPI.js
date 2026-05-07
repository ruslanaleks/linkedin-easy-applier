// feed/feedAPI.js - Server API client for topic collection and post generation
// Handles auth tokens, batch post upload, topic/generation endpoints

window.linkedInAutoApply = window.linkedInAutoApply || {};

(function () {
  'use strict';

  // ── Configuration ───────────────────────────────────────────────────
  const CONFIG = {
    // Change this to your server URL when deployed
    SERVER_URL: 'http://localhost:3000/api/v1',

    // chrome.storage.local keys
    TOKEN_KEY: 'feedServerAccessToken',
    REFRESH_KEY: 'feedServerRefreshToken',
    EXPIRY_KEY: 'feedServerTokenExpiry',

    // Timers
    TOKEN_REFRESH_THRESHOLD_MS: 5 * 60 * 1000, // refresh 5 min before expiry
    BATCH_UPLOAD_INTERVAL_MS: 30 * 1000,        // flush every 30s
    MAX_BATCH_SIZE: 50,

    // Retry
    RETRY_COUNT: 3,
    RETRY_BASE_DELAY: 2000,
  };

  // ── State ───────────────────────────────────────────────────────────
  let accessToken = null;
  let refreshToken = null;
  let tokenExpiry = null;
  let batchTimer = null;
  let pendingPosts = [];
  let authStateCallback = null;
  let isRefreshing = false;

  // ── Token Management ────────────────────────────────────────────────

  async function loadTokens() {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage) return false;
      const data = await chrome.storage.local.get([
        CONFIG.TOKEN_KEY,
        CONFIG.REFRESH_KEY,
        CONFIG.EXPIRY_KEY,
      ]);
      accessToken = data[CONFIG.TOKEN_KEY] || null;
      refreshToken = data[CONFIG.REFRESH_KEY] || null;
      tokenExpiry = data[CONFIG.EXPIRY_KEY] || null;
      return !!accessToken;
    } catch (err) {
      console.warn('[FeedAPI] Failed to load tokens:', err.message);
      return false;
    }
  }

  async function saveTokens(access, refresh, expiresInMs) {
    try {
      accessToken = access;
      refreshToken = refresh;
      tokenExpiry = Date.now() + expiresInMs;
      await chrome.storage.local.set({
        [CONFIG.TOKEN_KEY]: accessToken,
        [CONFIG.REFRESH_KEY]: refreshToken,
        [CONFIG.EXPIRY_KEY]: tokenExpiry,
      });
    } catch (err) {
      console.warn('[FeedAPI] Failed to save tokens:', err.message);
    }
  }

  async function clearTokens() {
    accessToken = null;
    refreshToken = null;
    tokenExpiry = null;
    try {
      await chrome.storage.local.remove([
        CONFIG.TOKEN_KEY,
        CONFIG.REFRESH_KEY,
        CONFIG.EXPIRY_KEY,
      ]);
    } catch (err) {
      // ignore
    }
    if (authStateCallback) authStateCallback(false);
  }

  function isAuthenticated() {
    return !!accessToken;
  }

  function isTokenExpired() {
    if (!tokenExpiry) return true;
    return Date.now() >= tokenExpiry;
  }

  function isTokenNearExpiry() {
    if (!tokenExpiry) return true;
    return Date.now() >= tokenExpiry - CONFIG.TOKEN_REFRESH_THRESHOLD_MS;
  }

  async function getValidToken() {
    if (!accessToken) {
      await loadTokens();
    }
    if (!accessToken) return null;

    if (isTokenNearExpiry() && refreshToken && !isRefreshing) {
      const refreshed = await doRefreshToken();
      if (!refreshed) return null;
    }

    if (isTokenExpired()) return null;
    return accessToken;
  }

  // ── Auth Endpoints ──────────────────────────────────────────────────

  async function login(email, password) {
    const res = await rawFetch('POST', '/auth/login', { email, password });
    if (res.ok && res.data) {
      const { accessToken: at, refreshToken: rt } = res.data;
      await saveTokens(at, rt, 14 * 60 * 1000); // 14 min (slightly less than 15)
      if (authStateCallback) authStateCallback(true);
      return { ok: true, data: res.data };
    }
    return res;
  }

  async function register(email, password) {
    const res = await rawFetch('POST', '/auth/register', { email, password });
    if (res.ok && res.data) {
      const { accessToken: at, refreshToken: rt } = res.data;
      await saveTokens(at, rt, 14 * 60 * 1000);
      if (authStateCallback) authStateCallback(true);
      return { ok: true, data: res.data };
    }
    return res;
  }

  async function doRefreshToken() {
    if (!refreshToken || isRefreshing) return false;
    isRefreshing = true;

    try {
      const res = await rawFetch('POST', '/auth/refresh', {
        refreshToken: refreshToken,
      });
      if (res.ok && res.data) {
        await saveTokens(res.data.accessToken, res.data.refreshToken, 14 * 60 * 1000);
        return true;
      }
      // Refresh failed — session is invalid
      await clearTokens();
      return false;
    } catch (err) {
      console.warn('[FeedAPI] Token refresh failed:', err.message);
      return false;
    } finally {
      isRefreshing = false;
    }
  }

  async function logout() {
    await clearTokens();
  }

  // ── Generic Request Wrapper ─────────────────────────────────────────

  async function apiRequest(method, path, body, retryCount) {
    const token = await getValidToken();
    if (!token) {
      return { ok: false, error: 'Not authenticated', authRequired: true };
    }

    const maxRetries = retryCount ?? CONFIG.RETRY_COUNT;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await rawFetchWithAuth(method, path, body, token);

        if (res.status === 401 && attempt === 0) {
          // Try refreshing token once
          const refreshed = await doRefreshToken();
          if (refreshed) {
            return apiRequest(method, path, body, 0); // retry with new token, no more retries
          }
          return { ok: false, error: 'Authentication expired', authRequired: true };
        }

        if (res.ok) {
          return { ok: true, data: res.data };
        }

        // Don't retry client errors (4xx) except 429
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          return { ok: false, error: res.error || res.message, status: res.status };
        }

        // Retry on 5xx and 429
        if (attempt < maxRetries) {
          const delay = CONFIG.RETRY_BASE_DELAY * Math.pow(2, attempt);
          console.warn(`[FeedAPI] ${method} ${path} failed (${res.status}), retrying in ${delay}ms...`);
          await sleep(delay);
        } else {
          return { ok: false, error: res.error || 'Server error', status: res.status };
        }
      } catch (err) {
        if (attempt < maxRetries) {
          const delay = CONFIG.RETRY_BASE_DELAY * Math.pow(2, attempt);
          console.warn(`[FeedAPI] Network error on ${method} ${path}, retrying in ${delay}ms:`, err.message);
          await sleep(delay);
        } else {
          return { ok: false, error: 'Network error: ' + err.message };
        }
      }
    }

    return { ok: false, error: 'Max retries exceeded' };
  }

  // Route fetches through background service worker to avoid mixed-content blocking
  async function bgFetch(method, url, headers, body) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { action: 'serverApiProxy', method, url, headers, body },
        (resp) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, status: 0, body: null, error: chrome.runtime.lastError.message });
          } else {
            resolve(resp);
          }
        }
      );
    });
  }

  async function rawFetch(method, path, body) {
    const url = CONFIG.SERVER_URL + path;
    const headers = { 'Content-Type': 'application/json' };
    const rawBody = (body && method !== 'GET') ? JSON.stringify(body) : undefined;

    const resp = await bgFetch(method, url, headers, rawBody);
    if (resp.error) {
      return { ok: false, status: resp.status || 0, data: null, error: resp.error };
    }

    const json = resp.body ? JSON.parse(resp.body) : null;
    const data = json?.data ?? json;

    return {
      ok: resp.ok,
      status: resp.status,
      data: resp.ok ? data : null,
      error: !resp.ok ? (data?.message || data?.error || `HTTP ${resp.status}`) : null,
      message: data?.message,
    };
  }

  async function rawFetchWithAuth(method, path, body, token) {
    let url = CONFIG.SERVER_URL + path;
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token,
    };
    let rawBody;
    if (body && method !== 'GET') {
      rawBody = JSON.stringify(body);
    }
    if (method === 'GET' && body) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(body)) {
        if (v !== undefined && v !== null) params.append(k, String(v));
      }
      const qs = params.toString();
      if (qs) url = url + '?' + qs;
    }

    const resp = await bgFetch(method, url, headers, rawBody);
    if (resp.error) {
      return { ok: false, status: resp.status || 0, data: null, error: resp.error };
    }

    const json = resp.body ? JSON.parse(resp.body) : null;
    const data = json?.data ?? json;

    return {
      ok: resp.ok,
      status: resp.status,
      data: resp.ok ? data : null,
      error: !resp.ok ? (data?.message || data?.error || `HTTP ${resp.status}`) : null,
      message: data?.message,
    };
  }

  // ── Post Collection ─────────────────────────────────────────────────

  function queuePostForUpload(post, scoreResult) {
    if (!post || !post.id || !post.content) return;

    // Transform to server format
    const serverPost = {
      externalId: post.id,
      authorName: post.author || 'Unknown',
      authorHeadline: post.headline || null,
      authorProfileUrl: post.authorProfileUrl || null,
      authorTier: scoreResult?.authorTier || null,
      content: post.content,
      language: scoreResult?.language || null,
      postedAt: post.postedAtISO || null,
      reactions: post.reactions || 0,
      comments: post.comments || 0,
      reposts: post.reposts || 0,
      hashtags: post.hashtags || [],
      mentions: [],
      media: post.media ? { hasMedia: true, article: post.article || null } : null,
      score: scoreResult?.score || null,
      scoreBreakdown: scoreResult?.breakdown || null,
      assignedCategories: scoreResult?.themes || [],
      scrapedAt: post.scrapedAt || new Date().toISOString(),
      scrapedBySession: post.sessionId || null,
      rawPayload: post,
    };

    pendingPosts.push(serverPost);

    if (pendingPosts.length >= CONFIG.MAX_BATCH_SIZE) {
      flushPosts();
    }
  }

  async function flushPosts() {
    if (pendingPosts.length === 0) return;
    if (!isAuthenticated()) return;

    const batch = pendingPosts.splice(0); // take all and clear
    console.log(`[FeedAPI] Flushing ${batch.length} posts to server...`);

    const res = await apiRequest('POST', '/posts/batch', { posts: batch });
    if (res.ok) {
      console.log(`[FeedAPI] Batch upload success:`, res.data);
    } else if (res.authRequired) {
      // Put posts back for later retry
      pendingPosts.unshift(...batch);
      console.warn('[FeedAPI] Batch upload skipped — not authenticated');
    } else {
      // Put posts back for later retry
      pendingPosts.unshift(...batch);
      console.warn('[FeedAPI] Batch upload failed:', res.error);
    }
  }

  function startBatchUploadTimer() {
    if (batchTimer) return;
    batchTimer = setInterval(() => {
      flushPosts().catch(err => {
        console.warn('[FeedAPI] Batch flush error:', err.message);
      });
    }, CONFIG.BATCH_UPLOAD_INTERVAL_MS);
    console.log('[FeedAPI] Batch upload timer started (30s interval)');
  }

  function stopBatchUploadTimer() {
    if (batchTimer) {
      clearInterval(batchTimer);
      batchTimer = null;
    }
  }

  // ── Topic Endpoints ─────────────────────────────────────────────────

  async function getWeeklyTopics(week) {
    const path = '/topics/weekly' + (week ? '?week=' + week : '');
    return apiRequest('GET', path);
  }

  async function getTopicPosts(topicId) {
    return apiRequest('GET', '/topics/' + topicId + '/posts');
  }

  // ── Generation Endpoints ────────────────────────────────────────────

  async function generatePost(params) {
    // params: { mode, topicIds, toneSettings, extraContext }
    return apiRequest('POST', '/generate', {
      mode: params.mode,
      topicIds: params.topicIds || [],
      toneSettings: params.toneSettings,
      extraContext: params.extraContext || undefined,
    });
  }

  async function getMyDrafts(status, limit, offset) {
    let path = '/generated?';
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    if (limit) params.append('limit', String(limit));
    if (offset) params.append('offset', String(offset));
    return apiRequest('GET', '/generated?' + params.toString());
  }

  async function updateDraft(id, updates) {
    return apiRequest('PATCH', '/generated/' + id, updates);
  }

  // ── Settings Endpoints (stage 2 prep) ───────────────────────────────

  async function getServerSettings() {
    return apiRequest('GET', '/me/settings');
  }

  async function saveServerSettings(settings) {
    return apiRequest('PUT', '/me/settings', settings);
  }

  // ── Label Endpoint ──────────────────────────────────────────────────

  async function labelPost(postId, label) {
    return apiRequest('POST', '/posts/' + postId + '/label', { label });
  }

  // ── Utility ─────────────────────────────────────────────────────────

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function onAuthStateChange(callback) {
    authStateCallback = callback;
  }

  function getServerUrl() {
    return CONFIG.SERVER_URL;
  }

  function setServerUrl(url) {
    CONFIG.SERVER_URL = url.replace(/\/$/, '');
  }

  // ── Initialize ──────────────────────────────────────────────────────

  // Load tokens on module init (non-blocking)
  loadTokens().then(hasToken => {
    if (hasToken) {
      console.log('[FeedAPI] Loaded auth token from storage');
    }
  });

  // ── Public API ──────────────────────────────────────────────────────

  window.linkedInAutoApply.feedAPI = {
    // Auth
    login,
    register,
    logout,
    isAuthenticated,
    getValidToken,
    onAuthStateChange,

    // Posts
    queuePostForUpload,
    flushPosts,
    startBatchUploadTimer,
    stopBatchUploadTimer,

    // Topics
    getWeeklyTopics,
    getTopicPosts,

    // Generation
    generatePost,
    getMyDrafts,
    updateDraft,

    // Labels
    labelPost,

    // Settings
    getServerSettings,
    saveServerSettings,

    // Config
    getServerUrl,
    setServerUrl,
  };

  console.log('[FeedAPI] Module loaded');
})();
