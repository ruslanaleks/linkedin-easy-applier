import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../common/prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { normalizeSlug } from '../common/utils/slug.util';

@Processor('topic-extraction')
export class TopicExtractionProcessor extends WorkerHost {
  private readonly logger = new Logger(TopicExtractionProcessor.name);

  constructor(
    private prisma: PrismaService,
    private llm: LlmService,
  ) {
    super();
  }

  async process(job: Job<{ postId: string }>) {
    const { postId } = job.data;
    this.logger.log(`Extracting topics for post ${postId}`);

    const post = await this.prisma.post.findUnique({
      where: { id: postId },
    });

    if (!post || post.content.length < 30) {
      this.logger.warn(`Post ${postId} not found or too short, skipping`);
      return;
    }

    // Skip if topics already extracted
    const existingCount = await this.prisma.postTopic.count({
      where: { postId },
    });
    if (existingCount > 0) {
      this.logger.log(`Post ${postId} already has topics, skipping`);
      return;
    }

    const topics = await this.llm.extractTopics(post.content);
    if (topics.length === 0) {
      this.logger.warn(`No topics extracted for post ${postId}`);
      return;
    }

    for (const { label, confidence } of topics) {
      const slug = normalizeSlug(label);
      if (!slug) continue;

      // Upsert topic by slug
      const topic = await this.prisma.topic.upsert({
        where: { slug },
        create: {
          slug,
          label,
          lastSeenAt: new Date(),
        },
        update: {
          lastSeenAt: new Date(),
        },
      });

      // Create post-topic link
      await this.prisma.postTopic.upsert({
        where: {
          postId_topicId: { postId: post.id, topicId: topic.id },
        },
        create: {
          postId: post.id,
          topicId: topic.id,
          confidence,
        },
        update: {
          confidence,
        },
      });
    }

    this.logger.log(
      `Extracted ${topics.length} topics for post ${postId}: ${topics.map((t) => t.label).join(', ')}`,
    );
  }
}
