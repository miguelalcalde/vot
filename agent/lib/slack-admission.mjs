/** Return true only for a human Slack author with an authenticated user id. */
export function isHumanSlackAuthor(author) {
  return Boolean(author?.userId && author.isBot !== true);
}

/** Group DMs may produce mentions but are outside this channel's admission policy. */
export function isSupportedSlackMention(author, raw) {
  return isHumanSlackAuthor(author) && raw?.channel_type !== "mpim";
}
