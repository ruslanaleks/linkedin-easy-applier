import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma, RelevanceLabel } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { PostDto } from './dto/batch-upload.dto';

@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue('topic-extraction') private topicQueue: Queue,
  ) {}

  async batchUpload(accountId: string, posts: PostDto[]) {
    let created = 0;
    let updated = 0;

    for (const dto of posts) {
      const data = {
        accountId,
        externalId: dto.externalId,
        authorName: dto.authorName,
        authorHeadline: dto.authorHeadline || null,
        authorProfileUrl: dto.authorProfileUrl || null,
        authorTier: dto.authorTier || null,
        content: dto.content,
        language: dto.language || null,
        postedAt: dto.postedAt ? new Date(dto.postedAt) : new Date(),
        reactions: dto.reactions || 0,
        comments: dto.comments || 0,
        reposts: dto.reposts || 0,
        hashtags: dto.hashtags || [],
        mentions: dto.mentions || [],
        media: dto.media ? (dto.media as Prisma.InputJsonValue) : Prisma.JsonNull,
        score: dto.score || null,
        scoreBreakdown: dto.scoreBreakdown
          ? (dto.scoreBreakdown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        assignedCategories: dto.assignedCategories || [],
        scrapedAt: dto.scrapedAt ? new Date(dto.scrapedAt) : new Date(),
        scrapedBySession: dto.scrapedBySession || null,
        rawPayload: dto.rawPayload
          ? (dto.rawPayload as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      };

      const result = await this.prisma.post.upsert({
        where: {
          accountId_externalId: {
            accountId,
            externalId: dto.externalId,
          },
        },
        create: data,
        update: {
          // Update engagement metrics and score on re-scrape
          reactions: data.reactions,
          comments: data.comments,
          reposts: data.reposts,
          score: data.score,
          scoreBreakdown: data.scoreBreakdown,
        },
      });

      // Check if this was a new insertion by comparing createdAt
      const isNew =
        result.createdAt.getTime() > Date.now() - 5000; // within last 5s
      if (isNew) {
        created++;
        // Queue topic extraction only for new posts
        await this.topicQueue.add(
          'extract-topics',
          { postId: result.id },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: 100,
            removeOnFail: 50,
          },
        );
      } else {
        updated++;
      }
    }

    this.logger.log(
      `Batch upload: ${created} created, ${updated} updated (account: ${accountId})`,
    );

    return { created, updated, total: posts.length };
  }

  async labelPost(accountId: string, postId: string, label: RelevanceLabel) {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, accountId },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    const updated = await this.prisma.post.update({
      where: { id: postId },
      data: { relevanceLabel: label },
      select: { id: true, relevanceLabel: true },
    });

    return updated;
  }
}
