import test from "node:test";
import assert from "node:assert/strict";
import { isHumanSlackAuthor, isSupportedSlackMention } from "../agent/lib/slack-admission.mjs";

test("admits an authenticated human author", () => {
  assert.equal(isHumanSlackAuthor({ userId: "U123", isBot: false }), true);
});

test("rejects missing, unidentified, and bot authors", () => {
  for (const author of [undefined, null, {}, { isBot: false }, { userId: "U123", isBot: true }]) {
    assert.equal(isHumanSlackAuthor(author), false);
  }
});

test("admits mentioned humans in public and private channels but rejects group DMs", () => {
  const human = { userId: "U123", isBot: false };
  assert.equal(isSupportedSlackMention(human, { channel_type: "channel" }), true);
  assert.equal(isSupportedSlackMention(human, { channel_type: "group" }), true);
  assert.equal(isSupportedSlackMention(human, { channel_type: "mpim" }), false);
});
