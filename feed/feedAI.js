// feed/feedAI.js - AI-генерация комментариев через LLM API
// Поддержка xAI Grok 4 (по умолчанию), Qwen 2.5/3.0/3.5+, через различные провайдеры (xAI, DashScope, OpenRouter, локальный сервер)

window.linkedInAutoApply = window.linkedInAutoApply || {};

(function () {
  'use strict';

  // ── Configuration ──────────────────────────────────────────────────────
  const CONFIG = {
    // Providers
    PROVIDERS: {
      DASHSCOPE: 'dashscope',      // Alibaba Cloud (официальный Qwen API)
      OPENROUTER: 'openrouter',    // OpenRouter (доступ к Qwen, Grok)
      XAI: 'xai',                  // xAI Grok (официальный API)
      LOCAL: 'local',              // Локальный сервер (Ollama, vLLM, etc.)
    },

    // Models
    MODELS: {
      QWEN_2_5_72B: 'qwen-2.5-72b',
      QWEN_3_72B: 'qwen-3-72b',
      QWEN_3_5_72B: 'qwen-3.5-72b',  // Рекомендуемый
      QWEN_PLUS: 'qwen-plus',
      QWEN_TURBO: 'qwen-turbo',
      GROK_4_FAST: 'grok-4-fast',   // xAI Grok 4 Fast
      GROK_4: 'grok-4',             // xAI Grok 4
      GROK_BETA: 'grok-beta',       // xAI Grok Beta
    },

    // Endpoints
    ENDPOINTS: {
      dashscope: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      openrouter: 'https://openrouter.ai/api/v1/chat/completions',
      xai: 'https://api.x.ai/v1/chat/completions',
      local: 'http://localhost:11434/v1/chat/completions', // Ollama по умолчанию
    },
    
    // Limits
    MAX_CONTENT_LENGTH: 2000,      // Обрезать пост до 2000 символов
    MAX_COMMENT_LENGTH: 80,        // Short comments: 1-8 words
    MAX_REPLY_LENGTH: 200,         // Replies are longer: 5-20 words, need more room
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
   * Sanitize text for safe inclusion in JSON API requests.
   * Strips control characters, lone surrogates, and stray backslash-escape
   * sequences that break strict JSON parsers.
   */
  function sanitizeForAPI(text) {
    if (!text) return '';
    return text
      // Remove control characters (U+0000–U+001F, U+007F–U+009F) except newlines/tabs
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')
      // Replace stray backslash-hex/unicode patterns that break some JSON parsers
      .replace(/\\x[0-9a-fA-F]{0,2}/g, ' ')
      .replace(/\\u[0-9a-fA-F]{0,4}/g, ' ')
      // Remove lone surrogates (invalid in JSON)
      .replace(/[\uD800-\uDFFF]/g, '')
      // Collapse multiple whitespace
      .replace(/\s{3,}/g, '  ')
      .trim();
  }

  /**
   * Topics to skip — commenting on these can damage professional reputation
   */
  const SKIP_TOPIC_PATTERNS = /\b(politic|politician|election|democrat|republican|liberal|conservative|left-wing|right-wing|congress|senate|parliament|geopolitic|sanctions|trump|biden|nato|referendum|propaganda|coup|regime|war\b|warfare|militar|army|troops|soldier|weapon|missile|drone strike|artillery|combat|invasion|occupation|ceasefire|nuclear|airstrike|casualties|bombing|conflict zone|политик|выборы|партия|санкции|пропаганда|режим|война|военн|армия|солдат|оружие|ракет|артиллери|бомбардировк|вторжение|оккупац|ядерн|конфликт|боевы|наступлени|мобилизаци|фронт)\b/i;

  /**
   * Check if post content is about a sensitive topic that should be skipped
   */
  function isSensitiveTopic(post) {
    const text = (post?.content || '') + ' ' + (post?.hashtags || []).join(' ');
    return SKIP_TOPIC_PATTERNS.test(text);
  }

  /**
   * Priority topics — world impact & innovation get exclusive, deeper comments
   */
  const WORLD_IMPACT_PATTERNS = /\b(climate|sustainability|renewable|green energy|carbon|emission|global warming|clean energy|ESG|social impact|humanitarian|poverty|inequality|education access|public health|pandemic|epidemic|food security|water crisis|biodiversity|deforestation|ocean|pollution|SDG|united nations|WHO|world bank|global challenge|future of|digital divide|affordable|universal access|climate change|net zero|circular economy|impact invest|social enterprise|change.?maker|климат|устойчив|возобновляем|зелёная энергия|углерод|выбросы|глобальное потепление|социальный эффект|гуманитар|бедность|неравенство|доступ к образованию|здравоохранение|пандемия|продовольств|биоразнообразие|загрязнение|экология|углеродный след|цели развития)\b/i;

  const INNOVATION_PATTERNS = /\b(innovat|disrupt|breakthrough|AI\b|artificial intelligence|machine learning|deep learning|LLM|GPT|neural|quantum|biotech|nanotech|blockchain|web3|autonomous|robotics|self-driving|CRISPR|gene editing|fusion energy|space tech|satellite|3D print|augmented reality|virtual reality|metaverse|edge computing|digital twin|no-code|low-code|open source|startup|moonshot|R&D|patent|prototype|first.of.its.kind|state.of.the.art|cutting.edge|next.gen|инновац|прорыв|искусственный интеллект|машинное обучение|нейросет|квант|биотех|блокчейн|робот|автоном|стартап|прототип|технологи|цифров)\b/i;

  /**
   * Detect if post is about a priority topic (world impact or innovation)
   * @returns {'world_impact'|'innovation'|null}
   */
  function detectPriorityTopic(post) {
    const text = (post?.content || '') + ' ' + (post?.hashtags || []).join(' ');
    if (WORLD_IMPACT_PATTERNS.test(text)) return 'world_impact';
    if (INNOVATION_PATTERNS.test(text)) return 'innovation';
    return null;
  }

  /**
   * Extract key information from post for AI context
   */
  function extractPostContext(post) {
    const context = {
      author: sanitizeForAPI(post?.author || 'Unknown'),
      headline: sanitizeForAPI(post?.headline || ''),
      content: sanitizeForAPI(truncate(post?.content || '', CONFIG.MAX_CONTENT_LENGTH)),
      hashtags: post?.hashtags || [],
      hasMedia: post?.hasMedia || false,
      mediaType: null,
      mediaDescription: null,
      article: post?.article ? sanitizeForAPI(post.article.title || '') : '',
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
  // Comment angle strategies — randomly picked per post to force variety
  const COMMENT_ANGLES = [
    'Express genuine excitement about a specific detail',
    'Share how this emotionally resonates with you',
    'React with heartfelt appreciation for the insight',
    'Show passionate agreement with the core message',
    'Express how deeply this connects with your experience',
    'Convey authentic enthusiasm about what stands out',
    'Share a warm, personal reaction to one aspect',
    'Express sincere admiration for the perspective shared',
  ];

  /**
   * Detect if text is primarily Russian (Cyrillic).
   * Strips URLs, hashtags, and @mentions before counting so that
   * English technical terms / links don't skew the ratio.
   */
  function isRussianText(text) {
    if (!text) return false;
    const clean = text
      .replace(/https?:\/\/\S+/g, '')
      .replace(/#\w+/g, '')
      .replace(/@\w+/g, '');
    const cyrillic = (clean.match(/[\u0400-\u04FF]/g) || []).length;
    const latin = (clean.match(/[a-zA-Z]/g) || []).length;
    // Trigger on any meaningful Cyrillic presence (≥ 10 chars)
    // even if Latin chars dominate (common in tech posts with English jargon)
    return cyrillic > 10 && cyrillic > latin * 0.3;
  }

  // Russian comment angles for variety
  const COMMENT_ANGLES_RU = [
    'Вырази искренний восторг от конкретной детали',
    'Покажи как это эмоционально откликается',
    'Отреагируй с душевной благодарностью за мысль',
    'Вырази горячее согласие с главным посылом',
    'Покажи как глубоко это перекликается с твоим опытом',
    'Передай подлинный энтузиазм от того, что зацепило',
    'Поделись тёплой, личной реакцией',
    'Вырази искреннее восхищение точкой зрения',
  ];

  // Exclusive angles for world impact topics
  const WORLD_IMPACT_ANGLES = [
    'Name the specific ripple effect this could trigger',
    'Connect this to a concrete downstream consequence',
    'Point out what most people overlook about this impact',
    'Identify the hidden leverage point in this initiative',
    'Note the second-order effect nobody talks about',
    'Tie this to a real-world outcome you have seen',
  ];
  const WORLD_IMPACT_ANGLES_RU = [
    'Назови конкретный каскадный эффект, который это запустит',
    'Свяжи с реальным последствием для отрасли',
    'Укажи что именно упускают большинство',
    'Найди скрытый рычаг в этой инициативе',
    'Отметь эффект второго порядка',
    'Привяжи к реальному результату, который наблюдал',
  ];

  // Exclusive angles for innovation topics
  const INNOVATION_ANGLES = [
    'Name the specific constraint this technology removes',
    'Point out what becomes possible now that was not before',
    'Identify the non-obvious application of this',
    'Connect to a concrete problem this solves differently',
    'Note the inflection point this represents',
    'Highlight the underestimated part of this approach',
  ];
  const INNOVATION_ANGLES_RU = [
    'Назови конкретное ограничение, которое эта технология снимает',
    'Укажи что теперь стало возможным',
    'Найди неочевидное применение',
    'Свяжи с конкретной проблемой, которую это решает иначе',
    'Отметь точку перелома, которую это означает',
    'Выдели недооценённую сторону подхода',
  ];

  function buildPrompt(postContext, priorityTopic) {
    const { author, headline, content, hashtags, mediaType, mediaCount, mediaDescription } = postContext;

    // Detect language
    const isRussian = isRussianText(content);

    // Pick angle based on topic type
    let angles;
    if (priorityTopic === 'world_impact') {
      angles = isRussian ? WORLD_IMPACT_ANGLES_RU : WORLD_IMPACT_ANGLES;
    } else if (priorityTopic === 'innovation') {
      angles = isRussian ? INNOVATION_ANGLES_RU : INNOVATION_ANGLES;
    } else {
      angles = isRussian ? COMMENT_ANGLES_RU : COMMENT_ANGLES;
    }
    const angle = angles[Math.floor(Math.random() * angles.length)];

    // Random style modifier
    const stylesEN = ['passionate', 'warm and heartfelt', 'deeply moved', 'genuinely inspired', 'emotionally engaged'];
    const stylesRU = ['с душой', 'тепло и от сердца', 'глубоко тронуто', 'с искренним вдохновением', 'эмоционально вовлечённо'];
    const styles = isRussian ? stylesRU : stylesEN;
    const style = styles[Math.floor(Math.random() * styles.length)];

    // Exclusive-comment rule for priority topics
    const exclusiveRuleEN = priorityTopic
      ? `\n11. CRITICAL: Your comment must offer a unique, non-obvious perspective. Think like a domain expert. Never state the obvious. Name a specific mechanism, consequence, or connection that adds NEW insight beyond what the post says.`
      : '';
    const exclusiveRuleRU = priorityTopic
      ? `\n11. КРИТИЧНО: Комментарий обязан содержать уникальную, неочевидную мысль. Думай как эксперт в теме. Не повторяй очевидное. Назови конкретный механизм, последствие или связь, которая добавляет НОВЫЙ инсайт к тому, что сказано в посте.`
      : '';

    let systemPrompt = isRussian
      ? `Ты профессионал, пишущий короткие эмоциональные комментарии в LinkedIn на русском. Твои комментарии должны быть живыми, с чувством и искренностью.

Строгие правила:
1. ТОЛЬКО на русском языке, ТОЛЬКО кириллицей. Никакой латиницы и транслитерации
2. От 1 до 10 слов, не больше
3. Из знаков препинания используй точку, запятую и восклицательный знак. Никаких "?", ":", ";", тире, длинных тире, кавычек
4. Никаких эмодзи
5. Не используй шаблоны: "Отличный пост", "Спасибо", "Согласен", "Класс", "Огонь", "Топ"
6. Не начинай с "Это" или с имени автора
7. Комментарий ОБЯЗАН ссылаться на конкретный факт, деталь или мысль из текста поста. НЕ придумывай темы, которых нет в посте
8. Тон: ${style}, эмоциональный, искренний
9. Подход: ${angle}
10. Выводи одну строку без переносов${exclusiveRuleRU}`
      : `You are a professional writing short, emotionally engaging LinkedIn comments. Your comments should feel alive, heartfelt, and genuine.

Strict rules:
1. CRITICAL: Write in the EXACT SAME language and script as the post. If the post is in Russian (Cyrillic), reply ONLY in Russian Cyrillic. If in English, reply in English. NEVER transliterate
2. 1 to 10 words only, no more
3. Use ".", ",", and "!" as punctuation. NO "?", ":", ";", dashes, em dashes, quotes
4. No emojis
5. NEVER use generic phrases: "Great post", "Thanks for sharing", "Love this", "Well said"
6. NEVER start with "This" or the author's name
7. Your comment MUST reference a specific detail, fact, or idea from the post content. Do NOT invent topics not mentioned in the post
8. Tone: ${style}, emotionally authentic
9. Approach: ${angle}
10. Output a single line, no line breaks${exclusiveRuleEN}`;

    const { article } = postContext;

    let userPrompt = isRussian
      ? `Пост от ${author}${headline ? ` (${headline})` : ''}:

"${content}"

${article ? `Статья: ${article}` : ''}
${hashtags.length > 0 ? `Хештеги: ${hashtags.join(' ')}` : ''}
${mediaType ? `Прикреплено: ${mediaType} (${mediaCount})` : ''}
${mediaDescription ? `На изображении: ${mediaDescription}` : ''}

Напиши ОДИН комментарий на русском кириллицей, от 1 до 10 слов. Эмоционально и искренне. Без эмодзи. Без латиницы. Подход: ${angle}.
Выведи только текст комментария.`
      : `Post by ${author}${headline ? ` (${headline})` : ''}:

"${content}"

${article ? `Shared article: ${article}` : ''}
${hashtags.length > 0 ? `Hashtags: ${hashtags.join(' ')}` : ''}
${mediaType ? `Attached: ${mediaType} (${mediaCount})` : ''}
${mediaDescription ? `Image shows: ${mediaDescription}` : ''}

Write ONE comment, 1 to 10 words. Emotionally authentic and heartfelt. No emojis. Approach: ${angle}.
Output only the comment text.`;

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
      case CONFIG.PROVIDERS.XAI:
        headers['Authorization'] = `Bearer ${apiKey}`;
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
   * Call LLM API (xAI Grok, Qwen, or local)
   */
  async function callLLMAPI(messages, settings) {
    const { provider, apiKey, model, endpoint } = settings;

    const requestBody = {
      model: model || CONFIG.MODELS.GROK_4_FAST,
      messages: messages,
      temperature: 0.7,
      max_tokens: 200,
      top_p: 0.9,
    };

    // xAI Grok does not support frequency_penalty / presence_penalty
    if (provider !== CONFIG.PROVIDERS.XAI) {
      requestBody.frequency_penalty = 0.3;
      requestBody.presence_penalty = 0.3;
    }

    const apiEndpoint = endpoint || CONFIG.ENDPOINTS[provider];

    console.log('[FeedAI] Calling API:', {
      provider,
      model: requestBody.model,
      endpoint: apiEndpoint,
      messagesCount: messages.length,
    });

    let response;
    try {
      response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: getAPIHeaders(provider, apiKey),
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(CONFIG.API_TIMEOUT),
      });
    } catch (fetchErr) {
      throw new Error(`API fetch failed: ${fetchErr.message}`);
    }

    if (!response.ok) {
      let errorText;
      try {
        errorText = await response.text();
      } catch {
        errorText = response.statusText;
      }
      throw new Error(`API Error ${response.status}: ${errorText}`);
    }

    let data;
    try {
      data = await response.json();
    } catch (jsonErr) {
      throw new Error(`API returned invalid JSON: ${jsonErr.message}`);
    }

    // Check for API-level error in response body (some providers return 200 with error)
    if (data.error) {
      throw new Error(`API returned error: ${data.error.message || JSON.stringify(data.error)}`);
    }

    // Extract response based on provider format
    let content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('Empty response from API');
    }

    // Strip xAI Grok <think>...</think> blocks that precede the actual comment
    content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    return content;
  }

  /**
   * Analyze image using Qwen-VL (Vision Language model)
   */
  async function analyzeImage(imageUrl, settings) {
    try {
      // Almost ALL images scraped from LinkedIn are served from CDN domains
      // (*.licdn.com, dms.licdn.com, media-exp*.licdn.com) using temporary
      // signed URLs that external LLM APIs cannot download.  Block anything
      // that looks LinkedIn-related or otherwise un-fetchable by the API.
      if (!imageUrl || !imageUrl.startsWith('http') ||
          /\bexpires=\d+\b/i.test(imageUrl) ||
          /licdn/i.test(imageUrl) ||
          /linkedin/i.test(imageUrl) ||
          /media-exp/i.test(imageUrl) ||
          /dms\./i.test(imageUrl) ||
          /\.gif(\?|$)/i.test(imageUrl)) {
        console.log('[FeedAI] Skipping image analysis: URL likely un-downloadable by API');
        return null;
      }

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

      const description = await callLLMAPI(messages, settings);
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

    // Check if AI is explicitly disabled
    if (settings?.enableAI === false) {
      console.log('[FeedAI] AI comments explicitly disabled, using fallback');
      return null;
    }

    // Check that API key is configured
    if (!settings?.apiKey) {
      console.warn('[FeedAI] No API key configured. Set your xAI API key in Feed Settings → AI Settings.');
      return null;
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

      // Refuse to generate when there is truly nothing — prevents hallucinated
      // comments about "blank pages". Allow short text if post has media, hashtags,
      // article, or author headline context.
      const hasContext = postContext.hasMedia || postContext.hashtags.length > 0 ||
                         postContext.headline || postContext.article;
      if (postContext.content.length < 10 && !hasContext) {
        console.warn('[FeedAI] Post has no meaningful content, skipping AI generation');
        return null;
      }

      // Skip political and military topics — commenting can damage professional reputation
      if (isSensitiveTopic(post)) {
        console.log('[FeedAI] Sensitive topic (politics/military) detected, skipping');
        return null;
      }

      // Analyze image if present and enabled.
      // LinkedIn image URLs are almost always temporary/signed CDN URLs that
      // external LLM APIs cannot fetch, so skip image analysis entirely to
      // avoid "Unable to download all specified images" API errors.
      if (postContext.hasMedia && postContext.mediaType === 'image' &&
          post.media?.images?.[0] && options.analyzeImage !== false) {
        try {
          const imageDesc = await analyzeImage(post.media.images[0], settings);
          if (imageDesc) {
            postContext.mediaDescription = truncate(imageDesc, CONFIG.MAX_IMAGE_DESCRIPTION);
          }
        } catch (imgErr) {
          // Swallow — image analysis is best-effort, never block comment generation
          console.warn('[FeedAI] Image analysis failed, continuing without it:', imgErr.message);
        }
      }

      // Detect priority topic for exclusive comment generation
      const priorityTopic = detectPriorityTopic(post);
      if (priorityTopic) {
        console.log('[FeedAI] Priority topic detected:', priorityTopic);
      }

      // Build prompt
      const { systemPrompt, userPrompt } = buildPrompt(postContext, priorityTopic);

      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ];

      // Call API with retries
      let comment = null;
      for (let attempt = 0; attempt <= CONFIG.RETRY_COUNT; attempt++) {
        try {
          comment = await callLLMAPI(messages, settings);
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
        .replace(/[\r\n]+/g, ' ')      // Flatten newlines into spaces (no blank lines in reply)
        .replace(/[\u2014\u2013\u2012\u2015—–-]{2,}/g, ',')  // Long dashes to comma
        .replace(/[!?:;()\[\]{}"'«»""'']/g, '')               // Strip forbidden punctuation
        .replace(/[\u{1F600}-\u{1F9FF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1FA00}-\u{1FAFF}\u{200D}\u{20E3}]/gu, '')  // Strip emojis
        .replace(/\s{2,}/g, ' ')       // Collapse whitespace
        .trim();

      // Enforce word limit: keep only first 10 words
      const words = comment.split(/\s+/);
      if (words.length > 10) {
        comment = words.slice(0, 10).join(' ');
      }

      // Ensure trailing punctuation is only . or ,
      comment = comment.replace(/[.,]+$/, '').trim();

      // Validate length
      if (comment.length > CONFIG.MAX_COMMENT_LENGTH) {
        comment = truncate(comment, CONFIG.MAX_COMMENT_LENGTH);
      }

      // Reject obvious word fragments (e.g. "onality", "ement", "ption")
      const FRAGMENT_RE = /^(tion|tions|sion|sions|ment|ments|ness|ality|ility|ance|ence|ious|eous|nable|nible|ative|ution|ption|ction|onality|uality|ement|ament|ling|ding|ning|ying|ering|ting|ical|ular|ular)$/i;
      const commentWords = comment.split(/\s+/);
      if (commentWords.some(w => w.length >= 3 && FRAGMENT_RE.test(w))) {
        console.warn('[FeedAI] Rejected comment with word fragment:', comment);
        return null;
      }

      // Reject language mismatch: comment must be in the same script as the post
      const postIsRussian = isRussianText(postContext.content);
      const commentHasCyrillic = /[\u0400-\u04FF]/.test(comment);
      if (postIsRussian && !commentHasCyrillic) {
        console.warn('[FeedAI] Rejected comment: Russian post got Latin reply:', comment);
        return null;
      }
      if (!postIsRussian && commentHasCyrillic) {
        console.warn('[FeedAI] Rejected comment: non-Russian post got Cyrillic reply:', comment);
        return null;
      }

      console.log('[FeedAI] Generated comment:', comment);
      return comment;

    } catch (err) {
      console.error('[FeedAI] generateAIComment error:', err.message);
      return null;
    }
  }

  /**
   * Load API settings from storage
   */
  async function loadAPISettings() {
    // Defaults: xAI Grok 4 Fast, AI enabled
    const defaults = {
      enableAI: true,
      provider: CONFIG.PROVIDERS.XAI,
      model: CONFIG.MODELS.GROK_4_FAST,
      endpoint: CONFIG.ENDPOINTS.xai,
      apiKey: '',
      analyzeImages: true,
    };

    try {
      if (typeof chrome === 'undefined' || !chrome.storage) {
        console.warn('[FeedAI] chrome.storage not available');
        apiSettings = defaults;
        return apiSettings;
      }

      const data = await chrome.storage.local.get('feedAISettings');
      // Merge stored settings over defaults so enableAI=true unless explicitly disabled
      apiSettings = { ...defaults, ...(data?.feedAISettings || {}) };

      console.log('[FeedAI] Settings loaded:', {
        provider: apiSettings.provider,
        model: apiSettings.model,
        enableAI: apiSettings.enableAI,
      });

      return apiSettings;
    } catch (err) {
      console.warn('[FeedAI] Failed to load settings:', err.message);
      apiSettings = defaults;
      return apiSettings;
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

      const response = await callLLMAPI(testMessages, settings);
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
          { value: 'x-ai/grok-4-fast', label: 'xAI Grok 4 Fast ⚡' },
          { value: 'x-ai/grok-4', label: 'xAI Grok 4' },
          { value: 'x-ai/grok-beta', label: 'xAI Grok Beta' },
        ];
      case CONFIG.PROVIDERS.XAI:
        return [
          { value: CONFIG.MODELS.GROK_4_FAST, label: 'Grok 4 Fast ⚡ (Recommended)' },
          { value: CONFIG.MODELS.GROK_4, label: 'Grok 4' },
          { value: CONFIG.MODELS.GROK_BETA, label: 'Grok Beta' },
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

  // ── Reply Generation ──────────────────────────────────────────────────

  // Reply angle strategies — randomly picked per comment to force variety
  const REPLY_ANGLES = [
    'Challenge the commenter with a sharp counter-point they may not have considered',
    'Share a surprising real-world example that flips their perspective',
    'Ask a bold follow-up question that pushes the idea further',
    'Point out a hidden implication or risk they overlooked',
    'Connect their idea to a bigger trend and explain why it matters now',
    'Respectfully disagree with one part and explain your reasoning',
    'Add a contrarian data point or fact that sparks debate',
    'Highlight what most people miss about this exact topic',
    'Reframe the commenter\'s point in a way that makes it even stronger',
    'Share a brief personal take that reveals genuine expertise',
  ];

  const REPLY_ANGLES_RU = [
    'Выдвини острый контраргумент, который комментатор мог не учесть',
    'Приведи неожиданный пример из практики, который переворачивает их ракурс',
    'Задай смелый уточняющий вопрос, который двигает мысль дальше',
    'Укажи на скрытый риск или последствие, которое упустили',
    'Свяжи их идею с большим трендом и объясни почему это важно сейчас',
    'Вежливо не согласись с одним аспектом и объясни почему',
    'Добавь неочевидный факт или цифру, которая провоцирует дискуссию',
    'Подсвети то, что большинство упускает в этой теме',
    'Переформулируй мысль комментатора так, чтобы она зазвучала ещё сильнее',
    'Поделись кратким личным мнением, которое показывает экспертизу',
  ];

  /**
   * Build prompt for reply to a comment
   */
  function buildReplyPrompt(postContext, commentAuthor, commentText) {
    const isRussian = isRussianText(commentText) || isRussianText(postContext.content);

    const angles = isRussian ? REPLY_ANGLES_RU : REPLY_ANGLES;
    const angle = angles[Math.floor(Math.random() * angles.length)];

    const stylesEN = ['direct and confident', 'witty but professional', 'bold and insightful', 'provocative but respectful', 'sharp and energetic'];
    const stylesRU = ['уверенно и прямо', 'остроумно но профессионально', 'смело и проницательно', 'провокационно но уважительно', 'остро и энергично'];
    const styles = isRussian ? stylesRU : stylesEN;
    const style = styles[Math.floor(Math.random() * styles.length)];

    let systemPrompt = isRussian
      ? `Ты эксперт, пишущий яркие, запоминающиеся ответы на комментарии в LinkedIn на русском. Твои ответы должны привлекать внимание и провоцировать дискуссию.

Строгие правила:
1. ТОЛЬКО на русском языке, ТОЛЬКО кириллицей. Никакой латиницы и транслитерации
2. От 5 до 20 слов. Ответ должен быть содержательным, не отписка
3. Допустимые знаки: точка, запятая, восклицательный и вопросительный знак. Без тире, кавычек, скобок
4. Никаких эмодзи
5. ЗАПРЕЩЕНЫ шаблоны: "Отличный комментарий", "Спасибо", "Согласен", "Класс", "Точно", "Хорошо сказано"
6. Не начинай с имени комментатора или с "Это"
7. Ответ ОБЯЗАН ссылаться на конкретную мысль из комментария. НЕ придумывай темы, которых нет
8. Тон: ${style}
9. Подход: ${angle}
10. Стремись вызвать реакцию. Добавь свою экспертную позицию, спорное мнение или неочевидный факт
11. Выводи одну строку без переносов`
      : `You are an expert writing punchy, memorable replies to LinkedIn comments. Your replies should grab attention, spark discussion, and make people want to respond.

Strict rules:
1. CRITICAL: Write in the EXACT SAME language and script as the comment. If the comment is in Russian (Cyrillic), reply ONLY in Russian Cyrillic. If in English, reply in English. NEVER transliterate
2. 5 to 20 words. Be substantive, not a throwaway line
3. Allowed punctuation: period, comma, exclamation mark, question mark. NO dashes, quotes, colons, semicolons
4. No emojis
5. NEVER use generic phrases: "Great point", "Thanks for sharing", "Love this", "Well said", "Exactly", "So true"
6. NEVER start with the commenter's name or "This"
7. Your reply MUST reference a specific detail or idea from the comment. Do NOT invent topics not mentioned
8. Tone: ${style}
9. Approach: ${angle}
10. Aim to provoke a response. Add your expert stance, a contrarian take, or a non-obvious fact
11. Output a single line, no line breaks`;

    let userPrompt = isRussian
      ? `Исходный пост от ${postContext.author}:
"${truncate(postContext.content, 500)}"

Комментарий от ${commentAuthor}:
"${truncate(commentText, 500)}"

Напиши ОДИН яркий ответ на комментарий на русском кириллицей, от 5 до 20 слов. Точки, запятые, ! и ? допустимы. Без эмодзи. Без латиницы. Подход: ${angle}.
Ответ должен цеплять и провоцировать дискуссию.
Выведи только текст ответа.`
      : `Original post by ${postContext.author}:
"${truncate(postContext.content, 500)}"

Comment by ${commentAuthor}:
"${truncate(commentText, 500)}"

Write ONE punchy reply to the comment, 5 to 20 words. Periods, commas, ! and ? are allowed. No emojis. Approach: ${angle}.
Make it eye-catching and discussion-provoking.
Output only the reply text.`;

    return { systemPrompt, userPrompt };
  }

  /**
   * Generate AI reply to a comment
   * @param {Object} post - Parent post data
   * @param {string} commentAuthor - Comment author name
   * @param {string} commentText - Comment text to reply to
   * @returns {Promise<string|null>}
   */
  async function generateAIReply(post, commentAuthor, commentText) {
    const settings = apiSettings || await loadAPISettings();

    if (settings?.enableAI === false) {
      console.log('[FeedAI] AI replies disabled');
      return null;
    }

    if (!settings?.apiKey) {
      console.warn('[FeedAI] No API key configured for replies');
      return null;
    }

    try {
      const postContext = extractPostContext(post);

      // Skip if comment is too short to reply meaningfully
      if ((commentText || '').trim().length < 10) {
        console.log('[FeedAI] Comment too short to reply to');
        return null;
      }

      // Skip sensitive topics
      if (isSensitiveTopic(post) || SKIP_TOPIC_PATTERNS.test(commentText)) {
        console.log('[FeedAI] Sensitive topic in comment, skipping reply');
        return null;
      }

      const { systemPrompt, userPrompt } = buildReplyPrompt(postContext, commentAuthor, commentText);

      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];

      // Call API with retries
      let reply = null;
      for (let attempt = 0; attempt <= CONFIG.RETRY_COUNT; attempt++) {
        try {
          reply = await callLLMAPI(messages, settings);
          break;
        } catch (err) {
          console.warn(`[FeedAI] Reply attempt ${attempt + 1} failed:`, err.message);
          if (attempt < CONFIG.RETRY_COUNT) {
            await delay(CONFIG.RETRY_DELAY * (attempt + 1));
          }
        }
      }

      if (!reply) {
        throw new Error('All API attempts failed for reply');
      }

      // Clean up reply — keep ! and ? for expressiveness
      reply = reply
        .replace(/^["']|["']$/g, '')
        .replace(/^\s*-\s*/, '')
        .replace(/[\r\n]+/g, ' ')
        .replace(/[\u2014\u2013\u2012\u2015—–-]{2,}/g, ',')
        .replace(/[:;()\[\]{}"'«»""'']/g, '')
        .replace(/[\u{1F600}-\u{1F9FF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1FA00}-\u{1FAFF}\u{200D}\u{20E3}]/gu, '')
        .replace(/\s{2,}/g, ' ')
        .trim();

      // Enforce word limit (20 for replies)
      const words = reply.split(/\s+/);
      if (words.length > 20) {
        reply = words.slice(0, 20).join(' ');
      }

      // Clean trailing punctuation but keep ! and ? at end
      reply = reply.replace(/[.,]+$/, '').trim();

      if (reply.length > CONFIG.MAX_REPLY_LENGTH) {
        reply = truncate(reply, CONFIG.MAX_REPLY_LENGTH);
      }

      // Reject word fragments
      const FRAGMENT_RE = /^(tion|tions|sion|sions|ment|ments|ness|ality|ility|ance|ence|ious|eous|nable|nible|ative|ution|ption|ction|onality|uality|ement|ament|ling|ding|ning|ying|ering|ting|ical|ular|ular)$/i;
      const replyWords = reply.split(/\s+/);
      if (replyWords.some(w => w.length >= 3 && FRAGMENT_RE.test(w))) {
        console.warn('[FeedAI] Rejected reply with word fragment:', reply);
        return null;
      }

      // Reject language mismatch: reply must match the script of the comment
      const commentIsRussian = isRussianText(commentText);
      const replyHasCyrillic = /[\u0400-\u04FF]/.test(reply);
      if (commentIsRussian && !replyHasCyrillic) {
        console.warn('[FeedAI] Rejected reply: Russian comment got Latin reply:', reply);
        return null;
      }
      if (!commentIsRussian && replyHasCyrillic) {
        console.warn('[FeedAI] Rejected reply: non-Russian comment got Cyrillic reply:', reply);
        return null;
      }

      console.log('[FeedAI] Generated reply:', reply);
      return reply;

    } catch (err) {
      console.error('[FeedAI] generateAIReply error:', err.message);
      return null;
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────

  window.linkedInAutoApply.feedAI = {
    // Core functions
    generateAIComment,
    generateAIReply,
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
    buildReplyPrompt,
    isSensitiveTopic,
    detectPriorityTopic,

    // Config
    getConfig: () => ({ ...CONFIG }),

    // State
    isInitialized: () => isInitialized,
  };

  console.log('[FeedAI] Module loaded successfully');
})();
