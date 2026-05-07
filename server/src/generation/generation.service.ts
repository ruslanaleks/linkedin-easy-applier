import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GeneratedPostStatus, GenerationMode } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { ToneSettings } from '../common/llm/llm.types';
import { GeneratePostDto } from './dto/generate-post.dto';
import { UpdateGeneratedDto } from './dto/update-generated.dto';

@Injectable()
export class GenerationService {
  private readonly logger = new Logger(GenerationService.name);

  constructor(
    private prisma: PrismaService,
    private llm: LlmService,
    private config: ConfigService,
  ) {}

  async generate(accountId: string, dto: GeneratePostDto) {
    let topicIds = dto.topicIds || [];
    let topicLabels: string[] = [];

    // If aggregated mode with no topics, use top 5 from current week
    if (dto.mode === GenerationMode.aggregated && topicIds.length === 0) {
      const topTopics = await this.prisma.topic.findMany({
        where: {
          postTopics: {
            some: {
              post: { accountId },
            },
          },
        },
        orderBy: { lastSeenAt: 'desc' },
        take: 5,
      });
      topicIds = topTopics.map((t) => t.id);
      topicLabels = topTopics.map((t) => t.label);
    } else if (topicIds.length > 0) {
      const topics = await this.prisma.topic.findMany({
        where: { id: { in: topicIds } },
      });
      topicLabels = topics.map((t) => t.label);
    }

    // Fetch source posts for selected topics (last 2 weeks, max 20)
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    const sourcePosts = await this.prisma.post.findMany({
      where: {
        accountId,
        postTopics: topicIds.length > 0
          ? { some: { topicId: { in: topicIds } } }
          : undefined,
        postedAt: { gte: twoWeeksAgo },
      },
      orderBy: { reactions: 'desc' },
      take: 20,
      select: {
        authorName: true,
        content: true,
        reactions: true,
      },
    });

    const toneSettings: ToneSettings = {
      serious: dto.toneSettings.serious,
      humor: dto.toneSettings.humor,
      personal: dto.toneSettings.personal,
      provocative: dto.toneSettings.provocative,
      length: dto.toneSettings.length,
    };

    // Build the prompt for logging
    const prompt = this.buildPromptSummary(
      dto.mode,
      topicLabels,
      toneSettings,
      dto.extraContext,
    );

    // Generate variants via LLM
    const variants = await this.llm.generatePost({
      mode: dto.mode,
      sourcePosts,
      toneSettings,
      extraContext: dto.extraContext,
      topicLabels,
    });

    const model =
      this.config.get('ANTHROPIC_GENERATION_MODEL') ||
      'claude-opus-4-0-20250414';

    // Save all variants as draft
    const saved = await Promise.all(
      variants.map((text) =>
        this.prisma.generatedPost.create({
          data: {
            accountId,
            topicId:
              dto.mode === GenerationMode.single_topic && topicIds.length === 1
                ? topicIds[0]
                : null,
            mode: dto.mode,
            toneSettings: dto.toneSettings as object,
            prompt,
            model,
            provider: 'anthropic',
            outputText: text,
            status: GeneratedPostStatus.draft,
          },
        }),
      ),
    );

    return saved;
  }

  async listGenerated(
    accountId: string,
    status?: GeneratedPostStatus,
    limit = 20,
    offset = 0,
  ) {
    const where = {
      accountId,
      ...(status ? { status } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.generatedPost.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          topic: { select: { label: true, slug: true } },
        },
      }),
      this.prisma.generatedPost.count({ where }),
    ]);

    return { items, total };
  }

  async updateGenerated(
    accountId: string,
    id: string,
    dto: UpdateGeneratedDto,
  ) {
    const post = await this.prisma.generatedPost.findFirst({
      where: { id, accountId },
    });

    if (!post) {
      throw new NotFoundException('Generated post not found');
    }

    const data: Record<string, unknown> = {};
    if (dto.status) data.status = dto.status;
    if (dto.myEditedText !== undefined) data.myEditedText = dto.myEditedText;
    if (dto.publishedAt) {
      data.publishedAt = new Date(dto.publishedAt);
    } else if (
      dto.status === GeneratedPostStatus.published &&
      !post.publishedAt
    ) {
      data.publishedAt = new Date();
    }

    return this.prisma.generatedPost.update({
      where: { id },
      data,
      include: {
        topic: { select: { label: true, slug: true } },
      },
    });
  }

  private buildPromptSummary(
    mode: string,
    topicLabels: string[],
    tone: ToneSettings,
    extraContext?: string,
  ): string {
    return JSON.stringify({
      mode,
      topics: topicLabels,
      tone,
      extraContext: extraContext || null,
    });
  }
}
