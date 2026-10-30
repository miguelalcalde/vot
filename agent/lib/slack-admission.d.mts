export function isHumanSlackAuthor(
  author: { userId?: string; isBot?: boolean } | null | undefined,
): boolean;
export function isSupportedSlackMention(
  author: { userId?: string; isBot?: boolean } | null | undefined,
  raw: Record<string, unknown>,
): boolean;
