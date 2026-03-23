# 🤖 AI Comments Guide - Qwen Integration

## Обзор

Расширение теперь поддерживает **AI-генерацию комментариев** с использованием модели **Qwen 3.5+** от Alibaba. AI анализирует контекст поста и генерирует уникальные, релевантные комментарии.

## Возможности

✅ **Контекстная генерация** - анализ текста поста, хэштегов, медиа  
✅ **Мультиязычность** - автоматическое определение языка поста  
✅ **Анализ изображений** - Qwen-VL для описания картинок (опционально)  
✅ **Профессиональный тон** - комментарии в стиле LinkedIn  
✅ **Кэширование** - избежание повторной генерации для похожих постов  
✅ **Fallback** - возврат к библиотеке шаблонов при ошибке API  

## Настройка

### 1. Получение API ключа

#### Вариант A: Alibaba DashScope (официальный)
1. Зарегистрируйтесь на https://dashscope.aliyun.com/
2. Создайте API key в личном кабинете
3. Тарифы: ~$0.002-0.02 за 1K токенов (зависит от модели)

#### Вариант B: OpenRouter
1. Зарегистрируйтесь на https://openrouter.ai/
2. Получите API key
3. Тарифы: pay-as-you-go, ~$0.0004-0.002 за 1K токенов

#### Вариант C: Локальный сервер (бесплатно)
1. Установите Ollama: https://ollama.ai/
2. Скачайте модель: `ollama pull qwen2.5:72b`
3. Запустите сервер: `ollama serve`

### 2. Настройка в расширении

1. Откройте LinkedIn Feed
2. Нажмите **⚙️ Feed Settings**
3. Прокрутите до секции **🤖 AI Comments (Qwen)**
4. Заполните:
   - ☑ **Enable AI-generated comments**
   - **API Provider**: выберите провайдера
   - **API Key**: вставьте ключ
   - **Model**: выберите модель (рекомендуется Qwen 3.5 72B)
   - ☑ **Analyze images in posts** (опционально)
5. Нажмите **🧪 Test Connection** для проверки
6. Нажмите **💾 Save Settings**

## Использование

### Автоматическая генерация

После настройки AI комментарии генерируются автоматически при включенной опции `Enable auto-comments`.

**Приоритет генерации:**
1. Пользовательские комментарии (из настроек)
2. **AI-генерация (Qwen)** ← новое
3. Библиотека шаблонов (fallback)

### Примеры генерации

**Пост 1 (Hiring):**
```
We're hiring! Join our team as a Senior JavaScript Developer. 
Requirements: 5+ years React, Node.js, AWS experience.
#hiring #javascript #remote
```

**AI комментарий:**
> "Отличная возможность для React-разработчиков с опытом в AWS! 🚀 Особенно привлекает возможность работать с распределённой командой. Удачи в поиске талантов!"

---

**Пост 2 (Achievement):**
```
Proud to announce that our team has reached 1M users! 
Thank you to everyone who supported us on this journey.
#milestone #startup #growth
```

**AI комментарий:**
> "Поздравляю с этой впечатляющей вехой! 🎉 1 миллион пользователей — это результат отличной работы команды и правильного продукта. Желаю дальнейшего роста!"

---

**Пост 3 (Learning, Spanish):**
```
5 lecciones que aprendí liderando equipos remotos:
1. Comunicación clara es clave
2. Herramientas adecuadas
3. Confianza en el equipo
...
```

**AI комментарий (на испанском):**
> "¡Excelentes lecciones! La comunicación clara es fundamental en equipos remotos. Yo añadiría la importancia de establecer expectativas claras desde el inicio. ¡Gracias por compartir! 🙏"

## Технические детали

### Архитектура

```
feed/feedAI.js
├── generateAIComment(post)     ← основная функция
├── analyzeImage(imageUrl)      ← анализ изображений
├── buildPrompt(postContext)    ← формирование промпта
├── callQwenAPI(messages)       ← вызов API
└── testAPIConnection(settings) ← тест подключения
```

### Промпт для генерации

**System prompt:**
```
Ты - профессиональный ассистент для написания комментариев в LinkedIn.
Твоя задача: создавать осмысленные, релевантные и профессиональные комментарии к постам.

Правила:
1. Комментарий должен быть на том же языке, что и основной контент поста
2. Максимум 280 символов
3. Будь конкретным - ссылайся на детали из поста
4. Избегай общих фраз вроде "Great post!"
5. Добавляй ценность: инсайт, вопрос, опыт, поддержку
6. Используй 0-2 эмодзи уместно
7. Будь искренним и человечным
...
```

**User prompt:**
```
Напиши профессиональный комментарий к этому LinkedIn посту:

**Автор:** John Doe (Senior Recruiter at Tech Corp)

**Контент поста:**
We're hiring! Join our team as a Senior JavaScript Developer...

**Хэштеги:** #hiring #javascript #remote

**Медиа:** нет

**Требования к комментарию:**
- Язык: определи по основному контенту
- Стиль: профессиональный, но дружелюбный
- Длина: 1-3 предложения, макс 280 символов
- Добавь 0-2 уместных эмодзи
- Будь конкретным, ссылайся на детали поста
```

### Кэширование

AI запросы дорогие, поэтому включено кэширование:
- **TTL:** 10 минут
- **Max size:** 100 комментариев
- **Ключ:** хэш от контента поста

```javascript
// Проверка кэша перед запросом
const cached = commentCache.get(contentHash);
if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
  return cached.comment; // Используем кэш
}
```

### Обработка ошибок

```javascript
try {
  const aiComment = await generateAIComment(post);
  if (aiComment) {
    return aiComment; // Успех
  }
} catch (aiErr) {
  console.warn('AI comment failed, falling back to library');
  // Возврат к библиотеке шаблонов
}
```

## API Reference

### feedAI.js

#### `generateAIComment(post, options)`
Генерирует комментарий с помощью AI.

**Параметры:**
- `post` {Object} - данные поста (content, author, hashtags, media)
- `options` {Object} - опции:
  - `analyzeImage` {boolean} - анализировать изображения

**Возвращает:** `Promise<string|null>`

**Пример:**
```javascript
const post = {
  content: "We're hiring!...",
  author: "John Doe",
  hashtags: ["#hiring"],
  media: { images: ["https://..."] }
};

const comment = await window.linkedInAutoApply.feedAI.generateAIComment(post, {
  analyzeImage: true
});
```

---

#### `testAPIConnection(settings)`
Тестирует подключение к API.

**Параметры:**
- `settings` {Object}:
  - `provider` {'dashscope'|'openrouter'|'local'}
  - `apiKey` {string}
  - `model` {string}

**Возвращает:** `Promise<{success: boolean, message: string}>`

---

#### `getAvailableModels(provider)`
Возвращает доступные модели для провайдера.

**Параметры:**
- `provider` {string}

**Возвращает:** `Array<{value: string, label: string}>`

---

#### `analyzeImage(imageUrl, settings)`
Анализирует изображение с помощью Qwen-VL.

**Параметры:**
- `imageUrl` {string}
- `settings` {Object}

**Возвращает:** `Promise<string|null>` - описание изображения

## Лимиты и стоимость

### DashScope (Alibaba)
| Модель | Цена (за 1K токенов) | Лимит |
|--------|---------------------|-------|
| Qwen 3.5 72B | ~$0.02 | 100 запросов/мин |
| Qwen 3 72B | ~$0.015 | 100 запросов/мин |
| Qwen Plus | ~$0.008 | 200 запросов/мин |
| Qwen Turbo | ~$0.002 | 500 запросов/мин |

### OpenRouter
| Модель | Цена (за 1K токенов) | Лимит |
|--------|---------------------|-------|
| Qwen 3.5 72B | ~$0.0004 | Зависит от провайдера |
| Qwen 2.5 72B | ~$0.0003 | Зависит от провайдера |

### Локальный (Ollama)
- **Цена:** Бесплатно (ваше железо)
- **Лимиты:** Зависят от GPU/CPU
- **Рекомендуется:** NVIDIA GPU с 16GB+ VRAM для 72B моделей

## Troubleshooting

### "API Error 401: Invalid API key"
**Решение:** Проверьте API key в настройках. Убедитесь, что ключ активен.

### "API Error 429: Rate limit exceeded"
**Решение:** Подождите 1 минуту или уменьшите частоту комментариев в настройках.

### "Empty response from API"
**Решение:** Проверьте, что модель существует и доступна для вашего аккаунта.

### AI генерирует комментарии на английском, хотя пост на русском
**Решение:** Это редкая ошибка. Убедитесь, что в посте достаточно русского текста для определения языка.

### "Extension context invalidated"
**Решение:** Перезагрузите расширение. Это нормально при обновлении.

## Best Practices

1. **Используйте кэш** - AI дорогой, кэш экономит деньги
2. **Выбирайте Turbo для скорости** - если не нужно качество 72B
3. **Отключите анализ изображений** - если не критично (экономит токены)
4. **Мониторьте лимиты** - проверяйте расход в личном кабинете провайдера
5. **Fallback на шаблоны** - не полагайтесь только на AI

## Безопасность

⚠️ **Важно:**
- API ключи хранятся локально в `chrome.storage.local`
- Ключи не передаются третьим лицам
- Используйте отдельные ключи для разных проектов
- Регулярно ротируйте ключи

## Будущие улучшения

🔮 В планах:
- [ ] Поддержка других моделей (GPT-4, Claude, Llama)
- [ ] Кастомизация тона комментариев
- [ ] Обучение на ваших предыдущих комментариях
- [ ] A/B тестирование комментариев
- [ ] Анализ тональности поста перед генерацией

## Поддержка

При проблемах:
1. Проверьте логи в DevTools Console
2. Протестируйте подключение через кнопку 🧪 Test Connection
3. Убедитесь, что баланс аккаунта положительный
4. Проверьте, что модель доступна в вашем регионе

---

**Версия:** 1.0  
**Qwen:** 2.5/3.0/3.5+  
**Последнее обновление:** Март 2026
