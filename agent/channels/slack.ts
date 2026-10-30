import { connectSlackCredentials } from "@vercel/connect/eve";
import { defaultSlackAuth, slackChannel } from "eve/channels/slack";
import { isHumanSlackAuthor, isSupportedSlackMention } from "../lib/slack-admission.mjs";

export default slackChannel({
  credentials: connectSlackCredentials("slack/vot"),
  onAppMention(ctx, message) {
    if (!isSupportedSlackMention(message.author, message.raw)) return null;
    return { auth: defaultSlackAuth(message, ctx) };
  },
  onDirectMessage(ctx, message) {
    if (!isHumanSlackAuthor(message.author)) return null;
    return { auth: defaultSlackAuth(message, ctx) };
  },
});
