-- CreateMaterializedView: weekly_topic_stats
-- This migration must run AFTER the initial Prisma migration creates the tables.

CREATE MATERIALIZED VIEW IF NOT EXISTS weekly_topic_stats AS
SELECT
  pt.topic_id,
  EXTRACT(ISOYEAR FROM p.posted_at)::int AS iso_year,
  EXTRACT(WEEK FROM p.posted_at)::int AS iso_week,
  COUNT(DISTINCT p.id) AS posts_count,
  COALESCE(SUM(p.reactions), 0) AS total_reactions,
  COALESCE(SUM(p.comments), 0) AS total_comments,
  COUNT(DISTINCT p.author_name) AS unique_authors,
  COUNT(DISTINCT CASE WHEN p.author_tier = 1 THEN p.author_name END) AS tier1_authors_count
FROM post_topics pt
JOIN posts p ON p.id = pt.post_id
WHERE p.posted_at IS NOT NULL
GROUP BY pt.topic_id, iso_year, iso_week;

CREATE UNIQUE INDEX IF NOT EXISTS idx_weekly_topic_stats_pk
  ON weekly_topic_stats (topic_id, iso_year, iso_week);
