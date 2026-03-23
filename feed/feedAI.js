// feed/feedAI.js - AI-генерация комментариев через Qwen API
// Поддержка Qwen 2.5/3.0/3.5+ через различные провайдеры (DashScope, OpenRouter, локальный сервер)

window.linkedInAutoApply = window.linkedInAutoApply || {};

(function () {
  'use strict';

  // ── Configuration ──────────────────────────────────────────────────────
  const CONFIG = {
    // Providers
    PROVIDERS: {
      DASHSCOPE: 'dashscope',      // Alibaba Cloud (официальный Qwen API)
      OPENROUTER: 'openrouter',    // OpenRouter (доступ к Qwen)
      LOCAL: 'local',              // Локальный сервер (Ollama, vLLM, etc.)
    },
    
    // Models
    MODELS: {
      QWEN_2_5_72B: 'qwen-2.5-72b',
      QWEN_3_72B: 'qwen-3-72b',
      QWEN_3_5_72B: 'qwen-3.5-72b',  // Рекомендуемый
      QWEN_PLUS: 'qwen-plus',
      QWEN_TURBO: 'qwen-turbo',
    },
    
    // Endpoints
    ENDPOINTS: {
      dashscope: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      openrouter: 'https://openrouter.ai/api/v1/chat/completions',
      local: 'http://localhost:11434/v1/chat/completions', // Ollama по умолчанию
    },
    
    // Limits
    MAX_CONTENT_LENGTH: 2000,      // Обрезать пост до 2000 символов
    MAX_COMMENT_LENGTH: 280,       // LinkedIn limit ~280 символов
    MAX_IMAGE_DESCRIPTION: 200,    // Описание картинки для контекста
    
    // Timeouts
    API_TIMEOUT: 15000,            // 15 секунд на ответ API
    RETRY_COUNT: 2,                // Количество повторных попыток
    RETRY_DELAY: 1000,             // Задержка между попытками (мс)
    
    // Cache
    CACHE_TTL_MS: 10 * 60 * 1000,  // 10 минут кэш для похожих постов
    MAX_CACHE_SIZE: 100,
  };

  // ── State ──────────────────────────────────────────────────────────────
  const commentCache = new Map(); // contentHash -> { comment, timestamp }
  let isInitialized = false;
  let apiSettings = null;

  // ── Utility Functions ──────────────────────────────────────────────────

  /**
   * Safe delay
   */
  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Generate hash for caching
   */
  function generateContentHash(content) {
    const normalized = (content || '').toLowerCase().replace(/\s+/g, ' ').trim();
    let hash = 0;
    for (let i = 0; i < Math.min(normalized.length, 500); i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `hash-${Math.abs(hash).toString(36)}`;
  }

  /**
   * Truncate text to max length
   */
  function truncate(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - 3) + '...';
  }

  /**
   * Extract key information from post for AI context
   */
  function extractPostContext(post) {
    const context = {
      author: post?.author || 'Unknown',
      headline: post?.headline || '',
      content: truncate(post?.content || '', CONFIG.MAX_CONTENT_LENGTH),
      hashtags: post?.hashtags || [],
      hasMedia: post?.hasMedia || false,
      mediaType: null,
      mediaDescription: null,
      engagement: {
        reactions: post?.reactions || 0,
        comments: post?.comments || 0,
      },
      timestamp: post?.timestamp || '',
    };

    // Determine media type
    if (post?.media) {
      if (post.media.images?.length > 0) {
        context.mediaType = 'image';
        context.mediaCount = post.media.images.length;
      } else if (post.media.videos?.length > 0) {
        context.mediaType = 'video';
        context.mediaCount = post.media.videos.length;
      }
    }

    return context;
  }

  /**
   * Build prompt for Qwen
   */
  function buildPrompt(postContext) {
    const { author, headline, content, hashtags, mediaType, mediaCount } = postContext;

    let systemPrompt = `Ты - профессиональный ассистент для написания комментариев в LinkedIn.
Твоя задача: создавать осмысленные, релевантные и профессиональные комментарии к постам.

Правила:
1. Комментарий должен быть на том же языке, что и основной контент поста
2. Максимум ${CONFIG.MAX_COMMENT_LENGTH} символов
3. Будь конкретным - ссылайся на детали из поста
4. Избегай общих фраз вроде "Great post!"
5. Добавляй ценность: инсайт, вопрос, опыт, поддержку
6. Используй 0-2 эмодзи уместно
7. Будь искренним и человечным
8. Если пост на русском - пиши на русском
9. Если пост на испанском - пиши на испанском
10. Избегай спамных фраз`;

    let userPrompt = `Напиши профессиональный комментарий к этому LinkedIn посту:

**Автор:** ${author}${headline ? ` (${headline})` : ''}

**Контент поста:**
${content}

${hashtags.length > 0 ? `**Хэштеги:** ${hashtags.join(' ')}` : ''}

${mediaType ? `**Медиа:** ${mediaType} (${mediaCount} файл(ов))` : '**Медиа:** нет'}

**Требования к комментарию:**
- Язык: определи по основному контенту
- Стиль: профессиональный, но дружелюбный
- Длина: 1-3 предложения, макс ${CONFIG.MAX_COMMENT_LENGTH} символов
- Добавь 0-2 уместных эмодзи
- Будь конкретным, ссылайся на детали поста

Напиши только текст комментария, без кавычек и объяснений.`;

    return { systemPrompt, userPrompt };
  }

  /**
   * Build prompt for image analysis (if image is present)
   */
  function buildImageAnalysisPrompt(imageUrl) {
    return {
      systemPrompt: `Ты - ассистент для анализа изображений в LinkedIn постах.
Опиши изображение кратко и профессионально (макс ${CONFIG.MAX_IMAGE_DESCRIPTION} символов).
Выдели ключевые элементы: люди, объекты, текст, цвета, контекст.
Пиши на русском языке.`,
      
      userPrompt: `Опиши это изображение из LinkedIn поста:
${imageUrl}

Дай краткое описание на русском языке, только факты.`,
    };
  }

  /**
   * Get API headers based on provider
   */
  function getAPIHeaders(provider, apiKey) {
    const headers = {
      'Content-Type': 'application/json',
    };

    switch (provider) {
      case CONFIG.PROVIDERS.DASHSCOPE:
        headers['Authorization'] = `Bearer ${apiKey}`;
        break;
      case CONFIG.PROVIDERS.OPENROUTER:
        headers['Authorization'] = `Bearer ${apiKey}`;
        headers['HTTP-Referer'] = 'https://linkedin-applier.com';
        headers['X-Title'] = 'LinkedIn Auto Apply';
        break;
      case CONFIG.PROVIDERS.LOCAL:
        // Local servers typically don't need auth
        if (apiKey) {
          headers['Authorization'] = `Bearer ${apiKey}`;
        }
        break;
    }

    return headers;
  }

  /**
   * Call Qwen API
   */
  async function callQwenAPI(messages, settings) {
    const { provider, apiKey, model, endpoint } = settings;

    const requestBody = {
      model: model || CONFIG.MODELS.QWEN_3_5_72B,
      messages: messages,
      temperature: 0.7,
      max_tokens: 150,
      top_p: 0.9,
      frequency_penalty: 0.3,
      presence_penalty: 0.3,
    };

    const apiEndpoint = endpoint || CONFIG.ENDPOINTS[provider];

    console.log('[FeedAI] Calling API:', {
      provider,
      model: requestBody.model,
      endpoint: apiEndpoint,
      messagesCount: messages.length,
    });

    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: getAPIHeaders(provider, apiKey),
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(CONFIG.API_TIMEOUT),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    
    // Extract response based on provider format
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      throw new Error('Empty response from API');
    }

    return content.trim();
  }

  /**
   * Analyze image using Qwen-VL (Vision Language model)
   */
  async function analyzeImage(imageUrl, settings) {
    try {
      console.log('[FeedAI] Analyzing image:', imageUrl);

      const { systemPrompt, userPrompt } = buildImageAnalysisPrompt(imageUrl);
      
      const messages = [
        { role: 'system', content: systemPrompt },
        { 
          role: 'user', 
          content: [
            { type: 'text', text: userPrompt },
            { type: 'image_url', image_url: { url: imageUrl } }
          ]
        }
      ];

      const description = await callQwenAPI(messages, settings);
      console.log('[FeedAI] Image analysis complete:', description.slice(0, 100) + '...');
      
      return description;
    } catch (err) {
      console.warn('[FeedAI] Image analysis failed:', err.message);
      return null;
    }
  }

  /**
   * Generate comment using AI
   */
  async function generateAIComment(post, options = {}) {
    const settings = apiSettings || await loadAPISettings();

    // Check if AI is enabled
    if (!settings?.enableAI) {
      console.log('[FeedAI] AI comments disabled, using fallback');
      return null;
    }

    // Check cache
    const contentHash = generateContentHash(post?.content);
    const cached = commentCache.get(contentHash);
    if (cached && Date.now() - cached.timestamp < CONFIG.CACHE_TTL_MS) {
      console.log('[FeedAI] Using cached comment');
      return cached.comment;
    }

    try {
      // Extract post context
      const postContext = extractPostContext(post);
      console.log('[FeedAI] Post context:', {
        author: postContext.author,
        contentLength: postContext.content.length,
        hasMedia: postContext.hasMedia,
        hashtagsCount: postContext.hashtags.length,
      });

      // Analyze image if present and enabled
      if (postContext.hasMedia && postContext.mediaType === 'image' && 
          post.media?.images?.[0] && options.analyzeImage !== false) {
        const imageDesc = await analyzeImage(post.media.images[0], settings);
        if (imageDesc) {
          postContext.mediaDescription = truncate(imageDesc, CONFIG.MAX_IMAGE_DESCRIPTION);
        }
      }

      // Build prompt
      const { systemPrompt, userPrompt } = buildPrompt(postContext);

      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ];

      // Call API with retries
      let comment = null;
      for (let attempt = 0; attempt <= CONFIG.RETRY_COUNT; attempt++) {
        try {
          comment = await callQwenAPI(messages, settings);
          break;
        } catch (err) {
          console.warn(`[FeedAI] Attempt ${attempt + 1} failed:`, err.message);
          if (attempt < CONFIG.RETRY_COUNT) {
            await delay(CONFIG.RETRY_DELAY * (attempt + 1));
          }
        }
      }

      if (!comment) {
        throw new Error('All API attempts failed');
      }

      // Clean up comment
      comment = comment
        .replace(/^["']|["']$/g, '')  // Remove quotes
        .replace(/^\s*-\s*/, '')       // Remove bullet points
        .trim();

      // Validate length
      if (comment.length > CONFIG.MAX_COMMENT_LENGTH) {
        comment = truncate(comment, CONFIG.MAX_COMMENT_LENGTH);
      }

      // Cache result
      commentCache.set(contentHash, { comment, timestamp: Date.now() });
      
      // Cleanup cache
      if (commentCache.size > CONFIG.MAX_CACHE_SIZE) {
        const oldestKey = commentCache.keys().next().value;
        if (oldestKey) commentCache.delete(oldestKey);
      }

      console.log('[FeedAI] Generated comment:', comment);
      return comment;

    } catch (err) {
      console.error('[FeedAI] generateAIComment error:', err.message);
      throw err;
    }
  }

  /**
   * Load API settings from storage
   */
  async function loadAPISettings() {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage) {
        console.warn('[FeedAI] chrome.storage not available');
        return null;
      }

      const data = await chrome.storage.local.get('feedAISettings');
      apiSettings = data?.feedAISettings || null;
      
      if (apiSettings) {
        console.log('[FeedAI] Settings loaded:', {
          provider: apiSettings.provider,
          model: apiSettings.model,
          enableAI: apiSettings.enableAI,
        });
      }
      
      return apiSettings;
    } catch (err) {
      console.warn('[FeedAI] Failed to load settings:', err.message);
      return null;
    }
  }

  /**
   * Save API settings
   */
  async function saveAPISettings(settings) {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage) {
        console.warn('[FeedAI] chrome.storage not available');
        return false;
      }

      await chrome.storage.local.set({ feedAISettings: settings });
      apiSettings = settings;
      console.log('[FeedAI] Settings saved');
      return true;
    } catch (err) {
      console.error('[FeedAI] Failed to save settings:', err.message);
      return false;
    }
  }

  /**
   * Test API connection
   */
  async function testAPIConnection(settings) {
    try {
      const testMessages = [
        { role: 'system', content: 'Ты тестовый ассистент. Отвечай кратко.' },
        { role: 'user', content: 'Напиши "OK" если получаешь это сообщение.' }
      ];

      const response = await callQwenAPI(testMessages, settings);
      return {
        success: true,
        message: `Connected successfully. Response: "${response}"`,
      };
    } catch (err) {
      return {
        success: false,
        message: `Connection failed: ${err.message}`,
      };
    }
  }

  /**
   * Get available models for provider
   */
  function getAvailableModels(provider) {
    switch (provider) {
      case CONFIG.PROVIDERS.DASHSCOPE:
        return [
          { value: CONFIG.MODELS.QWEN_3_5_72B, label: 'Qwen 3.5 72B (Recommended)' },
          { value: CONFIG.MODELS.QWEN_3_72B, label: 'Qwen 3 72B' },
          { value: CONFIG.MODELS.QWEN_2_5_72B, label: 'Qwen 2.5 72B' },
          { value: CONFIG.MODELS.QWEN_PLUS, label: 'Qwen Plus' },
          { value: CONFIG.MODELS.QWEN_TURBO, label: 'Qwen Turbo (Fast)' },
        ];
      case CONFIG.PROVIDERS.OPENROUTER:
        return [
          { value: 'qwen/qwen-3.5-72b-instruct', label: 'Qwen 3.5 72B Instruct' },
          { value: 'qwen/qwen-3-72b-instruct', label: 'Qwen 3 72B Instruct' },
          { value: 'qwen/qwen-2.5-72b-instruct', label: 'Qwen 2.5 72B Instruct' },
        ];
      case CONFIG.PROVIDERS.LOCAL:
        return [
          { value: 'qwen2.5:72b', label: 'Qwen 2.5 72B (Ollama)' },
          { value: 'qwen2.5:32b', label: 'Qwen 2.5 32B (Ollama)' },
          { value: 'qwen2.5:7b', label: 'Qwen 2.5 7B (Ollama)' },
        ];
      default:
        return [];
    }
  }

  /**
   * Clear cache
   */
  function clearCache() {
    commentCache.clear();
    console.log('[FeedAI] Cache cleared');
  }

  /**
   * Get cache stats
   */
  function getCacheStats() {
    return {
      size: commentCache.size,
      maxSize: CONFIG.MAX_CACHE_SIZE,
      ttl: CONFIG.CACHE_TTL_MS,
    };
  }

  // ── Initialization ─────────────────────────────────────────────────────

  // Load settings on module load
  loadAPISettings();

  // ── Public API ─────────────────────────────────────────────────────────

  window.linkedInAutoApply.feedAI = {
    // Core functions
    generateAIComment,
    analyzeImage,
    
    // Settings
    loadAPISettings,
    saveAPISettings,
    testAPIConnection,
    
    // Cache
    clearCache,
    getCacheStats,
    
    // Utils
    getAvailableModels,
    extractPostContext,
    buildPrompt,
    
    // Config
    getConfig: () => ({ ...CONFIG }),
    
    // State
    isInitialized: () => isInitialized,
  };

  console.log('[FeedAI] Module loaded successfully');
})();
