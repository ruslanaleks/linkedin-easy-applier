import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';

interface WeeklyTopicRow {
  topic_id: string;
  iso_year: number;
  iso_week: number;
  posts_count: bigint;
  total_reactions: bigint;
  total_comments: bigint;
  unique_authors: bigint;
  tier1_authors_count: bigint;
  slug: string;
  label: string;
  category: string[];
}

@Injectable()
export class TopicsService {
  private readonly logger = new Logger(TopicsService.name);

  constructor(private prisma: PrismaService) {}

  async getWeeklyTopics(
    accountId: string,
    week: 'current' | 'previous' | 'both',
  ) {
    // Compute current and previous ISO week boundaries
    const now = new Date();
    const { isoYear: curYear, isoWeek: curWeek } = this.getIsoWeek(now);

    const prevDate = new Date(now);
    prevDate.setDate(prevDate.getDate() - 7);
    const { isoYear: prevYear, isoWeek: prevWeek } =
      this.getIsoWeek(prevDate);

    let weekFilter: Prisma.Sql;
    if (week === 'current') {
      weekFilter = Prisma.sql`AND w.iso_year = ${curYear} AND w.iso_week = ${curWeek}`;
    } else if (week === 'previous') {
      weekFilter = Prisma.sql`AND w.iso_year = ${prevYear} AND w.iso_week = ${prevWeek}`;
    } else {
      weekFilter = Prisma.sql`AND (
        (w.iso_year = ${curYear} AND w.iso_week = ${curWeek})
        OR (w.iso_year = ${prevYear} AND w.iso_week = ${prevWeek})
      )`;
    }

    // Query the materialized view joined with topics, filtered by account's posts
    const rows = await this.prisma.$queryRaw<WeeklyTopicRow[]>(Prisma.sql`
      SELECT
        w.topic_id,
        w.iso_year,
        w.iso_week,
        w.posts_count,
        w.total_reactions,
        w.total_comments,
        w.unique_authors,
        w.tier1_authors_count,
        t.slug,
        t.label,
        t.category
      FROM weekly_topic_stats w
      JOIN topics t ON t.id = w.topic_id
      WHERE w.topic_id IN (
        SELECT DISTINCT pt.topic_id
        FROM post_topics pt
        JOIN posts p ON p.id = pt.post_id
        WHERE p.account_id = ${accountId}
      )
      ${weekFilter}
      ORDER BY w.posts_count DESC
      LIMIT 30
    `);

    // Group by topic, compute growth
    const topicMap = new Map<
      string,
      {
        topicId: string;
        slug: string;
        label: string;
        category: string[];
        weeks: Record<
          string,
          {
            isoYear: number;
            isoWeek: number;
            postsCount: number;
            totalReactions: number;
            totalComments: number;
            uniqueAuthors: number;
            tier1AuthorsCount: number;
          }
        >;
      }
    >();

    for (const row of rows) {
      if (!topicMap.has(row.topic_id)) {
        topicMap.set(row.topic_id, {
          topicId: row.topic_id,
          slug: row.slug,
          label: row.label,
          category: row.category,
          weeks: {},
        });
      }
      const topic = topicMap.get(row.topic_id)!;
      const weekKey = `${row.iso_year}-W${row.iso_week}`;
      topic.weeks[weekKey] = {
        isoYear: Number(row.iso_year),
        isoWeek: Number(row.iso_week),
        postsCount: Number(row.posts_count),
        totalReactions: Number(row.total_reactions),
        totalComments: Number(row.total_comments),
        uniqueAuthors: Number(row.unique_authors),
        tier1AuthorsCount: Number(row.tier1_authors_count),
      };
    }

    // Compute growth and combined score
    const curKey = `${curYear}-W${curWeek}`;
    const prevKey = `${prevYear}-W${prevWeek}`;

    const result = Array.from(topicMap.values()).map((topic) => {
      const cur = topic.weeks[curKey];
      const prev = topic.weeks[prevKey];

      const growthVsPrevWeek =
        cur && prev && prev.postsCount > 0
          ? Math.round(
              ((cur.postsCount - prev.postsCount) / prev.postsCount) * 100,
            )
          : cur && !prev
            ? 100
            : 0;

      const best = cur || prev;
      const combinedScore = best
        ? best.postsCount * 0.3 +
          best.totalReactions * 0.001 +
          Math.max(growthVsPrevWeek, 0) * 0.2 +
          best.tier1AuthorsCount * 5
        : 0;

      return {
        topicId: topic.topicId,
        slug: topic.slug,
        label: topic.label,
        category: topic.category,
        current: cur || null,
        previous: prev || null,
        growthVsPrevWeek,
        combinedScore: Math.round(combinedScore * 100) / 100,
      };
    });

    result.sort((a, b) => b.combinedScore - a.combinedScore);

    return result;
  }

  async getTopicPosts(accountId: string, topicId: string) {
    const posts = await this.prisma.post.findMany({
      where: {
        accountId,
        postTopics: { some: { topicId } },
      },
      orderBy: { reactions: 'desc' },
      take: 20,
      select: {
        id: true,
        authorName: true,
        authorHeadline: true,
        content: true,
        reactions: true,
        comments: true,
        postedAt: true,
        hashtags: true,
        score: true,
      },
    });

    return posts;
  }

  @Cron(CronExpression.EVERY_HOUR)
  async refreshMaterializedView() {
    try {
      await this.prisma.$executeRawUnsafe(
        'REFRESH MATERIALIZED VIEW CONCURRENTLY weekly_topic_stats',
      );
      this.logger.log('Refreshed weekly_topic_stats materialized view');
    } catch (err) {
      this.logger.error('Failed to refresh materialized view', err instanceof Error ? err.message : String(err));
    }
  }

  private getIsoWeek(date: Date): { isoYear: number; isoWeek: number } {
    const d = new Date(
      Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
    );
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const isoWeek = Math.ceil(
      ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
    );
    return { isoYear: d.getUTCFullYear(), isoWeek };
  }
}
