/**
 * Normalize a topic label into a dedup slug.
 * Lowercase, strip non-letter/number/space, collapse whitespace to hyphens, cap at 100 chars.
 */
export function normalizeSlug(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, '-')
    .slice(0, 100);
}
