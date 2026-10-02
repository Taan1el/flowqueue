/**
 * Picks the singular or plural form of a noun for a count. Pass an explicit
 * plural for irregular nouns ("miss" / "misses"); regular nouns just get an
 * "s" appended.
 */
export function pluralize(count: number, singular: string, plural: string = `${singular}s`): string {
  return Math.abs(count) === 1 ? singular : plural;
}

/**
 * Formats a count with its correctly pluralized noun, e.g.
 * formatCount(1, 'key') -> "1 key", formatCount(2, 'key') -> "2 keys".
 */
export function formatCount(count: number, singular: string, plural?: string): string {
  return `${count} ${pluralize(count, singular, plural)}`;
}
