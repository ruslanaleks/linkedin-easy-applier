import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import {
  ExtractedTopic,
  GeneratePostParams,
  ToneSettings,
} from './llm.types';

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly client: Anthropic;
  private readonly topicModel: string;
  private readonly generationModel: string;

  constructor(private config: ConfigService) {
    this.client = new Anthropic({
      apiKey: this.config.getOrThrow('ANTHROPIC_API_KEY'),
    });
    this.topicModel =
      this.config.get('ANTHROPIC_TOPIC_MODEL') || 'claude-sonnet-4-20250514';
    this.generationModel =
      this.config.get('ANTHROPIC_GENERATION_MODEL') ||
      'claude-opus-4-0-20250414';
  }

  async extractTopics(content: string): Promise<ExtractedTopic[]> {
    const truncated = content.slice(0, 3000);

    const systemPrompt = `You are a LinkedIn topic extraction engine. Extract 1-5 semantic topics from this LinkedIn post.
A topic is a short phrase of 2-6 words describing what the post is about.
Do NOT simply repeat hashtags — extract the underlying themes.
Return a JSON array: [{"label": "...", "confidence": 0.0-1.0}]
Return ONLY valid JSON, no markdown fences, no explanation.`;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await this.client.messages.create({
          model: this.topicModel,
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: 'user', content: truncated }],
        });

        const text =
          response.content[0].type === 'text' ? response.content[0].text : '';
        const cleaned = text.replace(/```json\n?|```\n?/g, '').trim();
        const topics: ExtractedTopic[] = JSON.parse(cleaned);

        if (!Array.isArray(topics)) {
          throw new Error('Response is not an array');
        }

        return topics
          .filter(
            (t) =>
              t.label &&
              typeof t.label === 'string' &&
              typeof t.confidence === 'number',
          )
          .slice(0, 5);
      } catch (err) {
        this.logger.warn(
          `Topic extraction attempt ${attempt + 1} failed: ${err.message}`,
        );
        if (attempt < 2) {
          await this.sleep(2000 * Math.pow(2, attempt));
        }
      }
    }

    this.logger.error('Topic extraction failed after 3 attempts');
    return [];
  }

  async generatePost(params: GeneratePostParams): Promise<string[]> {
    const {
      mode,
      sourcePosts,
      toneSettings,
      extraContext,
      topicLabels,
    } = params;

    const systemPrompt = this.buildGenerationSystemPrompt(toneSettings);
    const userPrompt = this.buildGenerationUserPrompt(
      mode,
      sourcePosts,
      topicLabels,
      extraContext,
    );

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await this.client.messages.create({
          model: this.generationModel,
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        });

        const text =
          response.content[0].type === 'text' ? response.content[0].text : '';

        const variants = text
          .split(/---VARIANT---/i)
          .map((v) => v.trim())
          .filter((v) => v.length > 20);

        if (variants.length === 0) {
          return [text.trim()];
        }

        return variants.slice(0, 3);
      } catch (err) {
        this.logger.warn(
          `Post generation attempt ${attempt + 1} failed: ${err.message}`,
        );
        if (attempt < 2) {
          await this.sleep(3000 * Math.pow(2, attempt));
        }
      }
    }

    throw new Error('Post generation failed after 3 attempts');
  }

  private buildGenerationSystemPrompt(tone: ToneSettings): string {
    const lengthMap = { short: 50, medium: 150, long: 300 };
    const wordTarget = lengthMap[tone.length] || 150;

    return `You are a LinkedIn thought leader ghostwriter. Write original LinkedIn posts based on trending topics.

TONE CALIBRATION (each 0-100 scale):
- Seriousness: ${tone.serious}/100 ${tone.serious > 60 ? '(lean analytical, data-driven)' : tone.serious < 40 ? '(lean casual, conversational)' : '(balanced)'}
- Humor: ${tone.humor}/100 ${tone.humor > 60 ? '(include wit, wordplay, or ironic observations)' : tone.humor < 40 ? '(keep it straight-faced)' : '(light touches of humor only)'}
- Personal/First-person: ${tone.personal}/100 ${tone.personal > 60 ? '(use personal anecdotes, "I" statements, share experience)' : tone.personal < 40 ? '(stay observational, third-person)' : '(mix of personal and observational)'}
- Provocative: ${tone.provocative}/100 ${tone.provocative > 60 ? '(challenge conventional wisdom, use bold claims)' : tone.provocative < 40 ? '(safe, consensus-friendly)' : '(mildly challenge assumptions)'}

LENGTH: ~${wordTarget} words.

RULES:
- Write 3 distinct variants separated by ---VARIANT---
- Each variant should take a different angle on the topic(s)
- Use short paragraphs (2-3 sentences max)
- No hashtags unless they add real value (max 3)
- No self-promotional calls to action
- Sound like a real human, not an AI
- Write in the same language as the source material (if mostly Russian, write in Russian; if English, write in English)`;
  }

  private buildGenerationUserPrompt(
    mode: string,
    sourcePosts: GeneratePostParams['sourcePosts'],
    topicLabels: string[],
    extraContext?: string,
  ): string {
    const topicsStr = topicLabels.join(', ');

    let sourceSection = '';
    if (sourcePosts.length > 0) {
      const postsSummary = sourcePosts
        .slice(0, 15)
        .map(
          (p, i) =>
            `[${i + 1}] ${p.authorName} (${p.reactions} reactions):\n${p.content.slice(0, 500)}`,
        )
        .join('\n\n');
      sourceSection = `\n\nSOURCE POSTS (for context and inspiration, do NOT copy):\n${postsSummary}`;
    }

    let modeInstruction: string;
    if (mode === 'single_topic') {
      modeInstruction = `Write a post about this specific topic: ${topicsStr}`;
    } else {
      modeInstruction = `Write a post that synthesizes these trending topics into a cohesive meta-narrative: ${topicsStr}`;
    }

    let extra = '';
    if (extraContext) {
      extra = `\n\nADDITIONAL CONTEXT FROM THE AUTHOR: ${extraContext}`;
    }

    return `${modeInstruction}${sourceSection}${extra}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
