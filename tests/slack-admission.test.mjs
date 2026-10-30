import test from "node:test";
import assert from "node:assert/strict";
import { isHumanSlackAuthor } from "../agent/lib/slack-admission.mjs";

test("admits an authenticated human author", () => {
  assert.equal(isHumanSlackAuthor({ userId: "U123", isBot: false }), true);
});

test("rejects missing, unidentified, and bot authors", () => {
  for (const author of [undefined, null, {}, { isBot: false }, { userId: "U123", isBot: true }]) {
    assert.equal(isHumanSlackAuthor(author), false);
  }
});

test("mention admission depends only on the author, matching real app_mention payloads without channel_type", () => {
  const human = { userId: "U123", isBot: false };
  const bot = { userId: "U999", isBot: true };
  // Real app_mention events (public channel, private channel or group DM) carry no channel_type.
  for (const raw of [{ type: "app_mention", channel: "C1" }, { type: "app_mention", channel: "G1" }, { type: "app_mention", channel: "G2", thread_ts: "1.2" }]) {
    assert.equal(isHumanSlackAuthor(human), true, JSON.stringify(raw));
    assert.equal(isHumanSlackAuthor(bot), false, JSON.stringify(raw));
  }
});
