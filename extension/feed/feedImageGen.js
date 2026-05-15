// feed/feedImageGen.js - AI image generation for LinkedIn posts
// Supports xAI (grok-2-image) and OpenAI (dall-e-3)
// Reuses feedAI settings for API key when provider matches

window.linkedInAutoApply = window.linkedInAutoApply || {};

(function () {
  'use strict';

  // ── Configuration ───────────────────────────────────────────────────
  const CONFIG = {
    PROVIDERS: {
      XAI: 'xai',
      OPENAI: 'openai',
    },

    MODELS: {
      GROK_2_IMAGE: 'grok-2-image',
      DALL_E_3: 'dall-e-3',
    },

    ENDPOINTS: {
      xai: 'https://api.x.ai/v1/images/generations',
      openai: 'https://api.openai.com/v1/images/generations',
    },

    // For generating image prompts from post text via LLM
    LLM_ENDPOINTS: {
      xai: 'https://api.x.ai/v1/chat/completions',
      openai: 'https://api.openai.com/v1/chat/completions',
    },

    LLM_MODELS: {
      xai: 'grok-4-fast',
      openai: 'gpt-4o-mini',
    },

    SIZES: ['1024x1024', '1024x1536', '1536x1024'],

    STYLES: {
      professional: 'Clean, modern, corporate-style illustration suitable for LinkedIn. Minimalist design with professional color palette.',
      creative: 'Bold, colorful, eye-catching illustration with dynamic composition. Modern graphic design style.',
      minimalist: 'Simple, elegant, single-concept illustration with lots of white space. Flat design aesthetic.',
      infographic: 'Data-visualization style with charts, icons, and structured layout. Information-rich visual.',
      photorealistic: 'Photorealistic image with natural lighting and composition. High quality stock photo style.',
    },

    API_TIMEOUT: 60000,   // 60s — image generation is slow
    RETRY_COUNT: 1,
    STORAGE_KEY: 'feedImageGenSettings',
  };

  // ── State ───────────────────────────────────────────────────────────
  let settings = null;

  // ── Settings Management ─────────────────────────────────────────────

  function getDefaults() {
    return {
      provider: CONFIG.PROVIDERS.XAI,
      model: CONFIG.MODELS.GROK_2_IMAGE,
      apiKey: '',           // separate key; empty = reuse feedAI key
      reuseAIKey: true,     // reuse feedAI API key for matching provider
      style: 'professional',
      size: '1024x1024',
    };
  }

  async function loadSettings() {
    const defaults = getDefaults();
    try {
      if (typeof chrome === 'undefined' || !chrome.storage) {
        settings = defaults;
        return settings;
      }
      const data = await chrome.storage.local.get(CONFIG.STORAGE_KEY);
      settings = { ...defaults, ...(data?.[CONFIG.STORAGE_KEY] || {}) };
      return settings;
    } catch (err) {
      console.warn('[FeedImageGen] Failed to load settings:', err.message);
      settings = defaults;
      return settings;
    }
  }

  async function saveSettings(newSettings) {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage) return false;
      settings = { ...settings, ...newSettings };
      await chrome.storage.local.set({ [CONFIG.STORAGE_KEY]: settings });
      console.log('[FeedImageGen] Settings saved');
      return true;
    } catch (err) {
      console.error('[FeedImageGen] Failed to save settings:', err.message);
      return false;
    }
  }

  /**
   * Resolve the API key: use own key or fall back to feedAI key
   */
  async function resolveApiKey() {
    if (!settings) await loadSettings();

    // Use dedicated image gen key if set
    if (settings.apiKey) return settings.apiKey;

    // Reuse feedAI key if enabled and provider matches
    if (settings.reuseAIKey) {
      const feedAI = window.linkedInAutoApply.feedAI;
      if (feedAI && typeof feedAI.loadAPISettings === 'function') {
        const aiSettings = await feedAI.loadAPISettings();
        // xAI image gen can reuse xAI text key
        if (settings.provider === CONFIG.PROVIDERS.XAI &&
            aiSettings.provider === 'xai' && aiSettings.apiKey) {
          return aiSettings.apiKey;
        }
      }
    }

    return null;
  }

  // ── Image Prompt Generation ─────────────────────────────────────────

  /**
   * Generate an image prompt from post text using LLM
   */
  async function generateImagePrompt(postText, style) {
    const apiKey = await resolveApiKey();
    if (!apiKey) throw new Error('No API key configured for image generation');
    if (!settings) await loadSettings();

    const provider = settings.provider;
    const llmEndpoint = CONFIG.LLM_ENDPOINTS[provider];
    const llmModel = CONFIG.LLM_MODELS[provider];

    if (!llmEndpoint) throw new Error('LLM endpoint not available for provider: ' + provider);

    const styleDesc = CONFIG.STYLES[style] || CONFIG.STYLES.professional;

    const systemPrompt = [
      'You are an expert at creating image generation prompts for professional LinkedIn posts.',
      'Given a LinkedIn post text, create a concise image generation prompt that would produce a compelling visual to accompany the post.',
      '',
      'Rules:',
      '- The image must be professional and suitable for LinkedIn',
      '- Focus on the core message/theme of the post',
      '- Be specific about composition, colors, and visual elements',
      '- Do NOT include any text/words/letters in the image — pure visual only',
      '- Do NOT depict specific real people',
      '- Keep the prompt under 200 words',
      '- Apply this style direction: ' + styleDesc,
      '',
      'Respond with ONLY the image prompt, nothing else. No quotes, no explanation.',
    ].join('\n');

    const truncatedPost = postText.length > 1500 ? postText.slice(0, 1500) + '...' : postText;

    const requestBody = {
      model: llmModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'LinkedIn post:\n\n' + truncatedPost },
      ],
      temperature: 0.8,
      max_tokens: 300,
    };

    const response = await fetch(llmEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText);
      throw new Error('LLM prompt generation failed (' + response.status + '): ' + errText);
    }

    const data = await response.json();
    let prompt = data.choices?.[0]?.message?.content;
    if (!prompt) throw new Error('Empty response from LLM');

    // Clean up: strip thinking blocks, quotes, extra whitespace
    prompt = prompt
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/^["']|["']$/g, '')
      .trim();

    return prompt;
  }

  // ── Image Generation ────────────────────────────────────────────────

  /**
   * Generate an image from a prompt
   * Returns { url, revisedPrompt }
   */
  async function generateImage(prompt, options = {}) {
    const apiKey = await resolveApiKey();
    if (!apiKey) throw new Error('No API key configured for image generation');
    if (!settings) await loadSettings();

    const provider = settings.provider;
    const endpoint = CONFIG.ENDPOINTS[provider];
    const model = settings.model || (provider === CONFIG.PROVIDERS.XAI
      ? CONFIG.MODELS.GROK_2_IMAGE
      : CONFIG.MODELS.DALL_E_3);
    const size = options.size || settings.size || '1024x1024';

    const requestBody = {
      model,
      prompt,
      n: 1,
    };

    // xAI grok-2-image doesn't support size parameter in the same way
    if (provider === CONFIG.PROVIDERS.OPENAI) {
      requestBody.size = size;
      requestBody.quality = 'standard';
    }

    // Request URL format for display
    requestBody.response_format = 'url';

    console.log('[FeedImageGen] Generating image:', {
      provider, model, size,
      promptLength: prompt.length,
    });

    let response;
    for (let attempt = 0; attempt <= CONFIG.RETRY_COUNT; attempt++) {
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKey,
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(CONFIG.API_TIMEOUT),
        });

        if (response.ok) break;

        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          // Client error — don't retry
          const errText = await response.text().catch(() => response.statusText);
          throw new Error('Image API error (' + response.status + '): ' + errText);
        }

        // Retry on 5xx / 429
        if (attempt < CONFIG.RETRY_COUNT) {
          console.warn('[FeedImageGen] Retrying after ' + response.status + '...');
          await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
        }
      } catch (err) {
        if (err.name === 'AbortError' || err.name === 'TimeoutError') {
          throw new Error('Image generation timed out (60s)');
        }
        if (attempt >= CONFIG.RETRY_COUNT) throw err;
        console.warn('[FeedImageGen] Fetch error, retrying:', err.message);
        await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
      }
    }

    if (!response || !response.ok) {
      const errText = await response?.text().catch(() => '') || 'Unknown error';
      throw new Error('Image generation failed: ' + errText);
    }

    const data = await response.json();

    // Both xAI and OpenAI return { data: [{ url, revised_prompt }] }
    const result = data.data?.[0];
    if (!result) throw new Error('No image data in API response');

    return {
      url: result.url || null,
      b64: result.b64_json || null,
      revisedPrompt: result.revised_prompt || prompt,
    };
  }

  /**
   * Full pipeline: post text -> image prompt -> generated image
   * Returns { url, b64, prompt, revisedPrompt }
   */
  async function generateImageForPost(postText, options = {}) {
    const style = options.style || settings?.style || 'professional';

    // Step 1: Generate image prompt from post text
    const imagePrompt = options.customPrompt || await generateImagePrompt(postText, style);

    // Step 2: Generate image from prompt
    const result = await generateImage(imagePrompt, options);

    return {
      ...result,
      prompt: imagePrompt,
    };
  }

  /**
   * Download an image from URL as a blob and trigger browser download
   */
  async function downloadImage(url, filename) {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename || 'linkedin-post-image.png';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();

      setTimeout(() => {
        URL.revokeObjectURL(blobUrl);
        a.remove();
      }, 1000);

      return true;
    } catch (err) {
      console.error('[FeedImageGen] Download failed:', err.message);
      return false;
    }
  }

  // ── Public API ──────────────────────────────────────────────────────

  loadSettings();

  window.linkedInAutoApply.feedImageGen = {
    // Settings
    loadSettings,
    saveSettings,
    getDefaults,

    // Generation
    generateImagePrompt,
    generateImage,
    generateImageForPost,

    // Utility
    downloadImage,

    // Constants
    PROVIDERS: CONFIG.PROVIDERS,
    MODELS: CONFIG.MODELS,
    STYLES: CONFIG.STYLES,
    SIZES: CONFIG.SIZES,
  };

  console.log('[FeedImageGen] Module loaded');
})();
