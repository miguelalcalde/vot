/**
 * Return true only for a human Slack author with an authenticated user id.
 * Used for app mentions (public channels, private channels and group DMs,
 * at roots and in threads) and for one-to-one DMs, which need no mention.
 * Slack's `app_mention` payload carries no `channel_type`, so admission must
 * not depend on it.
 */
export function isHumanSlackAuthor(author) {
  return Boolean(author?.userId && author.isBot !== true);
}
