import test from "node:test";
import assert from "node:assert/strict";
import { checkChanges, checkPath } from "../agent/lib/self/policy.ts";

const skill = "agent/skills/example/SKILL.md";
const skillContent = "---\ndescription: Example skill\n---\nA useful body.\n";
const tool = "agent/tools/example.ts";
const ordinaryTs = "export const value: string = 'ok';";
const payload = (content) => ({ path: "agent/lib/payload-1.txt", content });
const accepted = (changes) => assert.deepEqual(checkChanges(changes), []);
const rejectedPath = (path, reason) => {
  const verdict = checkPath(path);
  assert.equal(verdict.ok, false, `${path} should be rejected`);
  assert.match(verdict.reason, reason);
  const problems = checkChanges([{ path, content: "harmless content" }]);
  assert.ok(problems.some((problem) => problem.includes(reason.source)), problems.join("\n"));
};
const rejectedContent = (content, reason, path = "agent/lib/example.ts") => {
  const problems = checkChanges([{ path, content }]);
  assert.ok(problems.some((problem) => reason.test(problem)), problems.join("\n"));
};

test("allowed skill write accepts checkPath and described SKILL.md", () => {
  assert.deepEqual(checkPath(skill), { ok: true });
  accepted([{ path: skill, content: skillContent }]);
});

test("allowed tool write accepts checkPath and valid TypeScript", () => {
  assert.deepEqual(checkPath(tool), { ok: true });
  accepted([{ path: tool, content: ordinaryTs }]);
});

for (const [name, path] of [
  ["protected self library", "agent/lib/self/policy.ts"],
  ["protected self tool prefix", "agent/tools/self_example.ts"],
  ["protected live skill loader", "agent/skills/live.ts"],
  ["protected self-modify skill", "agent/skills/self-modify/SKILL.md"],
  ["protected web-auth channel", "agent/channels/eve.ts"],
]) {
  test(`${name} rejects through checkPath and checkChanges`, () =>
    rejectedPath(path, /protected/));
}

for (const [name, path] of [
  ["package", "package.json"],
  ["workflow", ".github/workflows/example.yml"],
]) {
  test(`outside allowlist ${name} rejects through checkPath and checkChanges`, () =>
    rejectedPath(path, /outside the writable paths/));
}

for (const path of ["agent/tools/../example.ts", "agent/./tools/example.ts", "../agent/tools/example.ts"]) {
  test(`traversal path ${path} rejects through checkPath and checkChanges`, () =>
    rejectedPath(path, /must not contain empty/));
}

test("invalid TypeScript reports a syntax error", () =>
  rejectedContent("export const value = ;", /TypeScript syntax error/));
test("enum TypeScript is accepted", () =>
  accepted([{ path: tool, content: "export enum Status { Ready }" }]));
test("parameter property TypeScript is accepted", () =>
  accepted([{ path: tool, content: "export class Example { constructor(public value: string) {} }" }]));

for (const [name, content, reason] of [
  ["self-connector configuration reference", "export const connector = process.env.SELF_GITHUB_CONNECTOR;", /reference self-connector configuration/],
  ["GitHub API reference", "export const url = 'https://api.github.com';", /reference the GitHub API/],
  ["self internals reference", "export const path = 'lib/self/policy';", /reference the self-modification internals/],
]) {
  test(`${name} is rejected in valid TypeScript`, () => {
    assert.doesNotThrow(() => checkChanges([{ path: tool, content }]));
    rejectedContent(content, reason, tool);
  });
}

for (const prefix of ["ghp_", "gho_", "ghu_", "ghs_", "ghr_", "github_pat_"]) {
  test(`GitHub secret pattern ${prefix} is rejected`, () =>
    rejectedContent(`synthetic ${prefix}${"A".repeat(20)}`, /GitHub token/, "agent/lib/payload-1.txt"));
}
for (const prefix of ["xoxa-", "xoxb-", "xoxp-", "xoxr-", "xoxs-"]) {
  test(`Slack secret pattern ${prefix} is rejected`, () =>
    rejectedContent(`synthetic ${prefix}${"A".repeat(10)}`, /Slack token/, "agent/lib/payload-1.txt"));
}
for (const prefix of ["sk-", "sk-ant-"]) {
  test(`OpenAI/Anthropic secret pattern ${prefix} is rejected`, () =>
    rejectedContent(`synthetic ${prefix}${"A".repeat(20)}`, /OpenAI\/Anthropic key/, "agent/lib/payload-1.txt"));
}
test("AWS secret pattern AKIA is rejected", () =>
  rejectedContent(`AKIA${"A".repeat(16)}`, /AWS access key/, "agent/lib/payload-1.txt"));
for (const prefix of ["vcp_", "vck_"]) {
  test(`Vercel secret pattern ${prefix} is rejected`, () =>
    rejectedContent(`synthetic ${prefix}${"A".repeat(20)}`, /Vercel token/, "agent/lib/payload-1.txt"));
}
test("private-key pattern is rejected", () =>
  rejectedContent("-----BEGIN PRIVATE KEY-----", /private key/, "agent/lib/payload-1.txt"));

for (const [name, content] of [
  ["no frontmatter", "A skill without frontmatter."],
  ["empty description", "---\ndescription:   \n---\nBody."],
]) {
  test(`skill missing description with ${name} is rejected`, () =>
    rejectedContent(content, /needs frontmatter with a description/, skill));
}
for (const [name, content] of [["empty", ""], ["whitespace-only", " \n\t "]]) {
  test(`${name} instructions fail the minimum identity length`, () =>
    rejectedContent(content, /instructions must keep a real identity/, "agent/instructions.md"));
}
test("instructions cannot be deleted", () => {
  const problems = checkChanges([{ path: "agent/instructions.md", delete: true }]);
  assert.ok(problems.some((problem) => /cannot be deleted/.test(problem)), problems.join("\n"));
});

const harmlessFiles = (count, content = "ok") =>
  Array.from({ length: count }, (_, i) => ({ path: `agent/lib/payload-${i + 1}.txt`, content }));
test("file count at fixed limit of 10 is accepted", () => accepted(harmlessFiles(10)));
test("file count over fixed limit of 10 rejects 11 files", () => {
  const problems = checkChanges(harmlessFiles(11));
  assert.ok(problems.some((problem) => /At most 10 files/.test(problem)), problems.join("\n"));
});
test("file bytes at fixed limit of 65536 are accepted", () => {
  const content = "a".repeat(65_536);
  assert.equal(Buffer.byteLength(content, "utf8"), 65_536);
  accepted([payload(content)]);
});
test("file bytes over fixed limit of 65536 reject 65537 bytes", () => {
  const content = "a".repeat(65_537);
  assert.equal(Buffer.byteLength(content, "utf8"), 65_537);
  const problems = checkChanges([payload(content)]);
  assert.ok(problems.some((problem) => /exceeds 65536/.test(problem)), problems.join("\n"));
});
test("aggregate bytes at fixed limit of 262144 are accepted", () => {
  const files = harmlessFiles(4, "a".repeat(65_536));
  assert.ok(files.every(({ content }) => Buffer.byteLength(content, "utf8") === 65_536));
  accepted(files);
});
test("aggregate bytes over fixed limit reject 262145 bytes", () => {
  const files = [...harmlessFiles(4, "a".repeat(65_536)), { path: "agent/lib/payload-5.txt", content: "a" }];
  assert.equal(files.reduce((sum, { content }) => sum + Buffer.byteLength(content, "utf8"), 0), 262_145);
  const problems = checkChanges(files);
  assert.ok(problems.some((problem) => /Commit is 262145 bytes; limit is 262144/.test(problem)), problems.join("\n"));
});
test("UTF-8 byte measurement rejects 32769 copies of é at 65538 bytes", () => {
  const content = "é".repeat(32_769);
  assert.equal(content.length, 32_769);
  assert.equal(Buffer.byteLength(content, "utf8"), 65_538);
  const problems = checkChanges([payload(content)]);
  assert.ok(problems.some((problem) => /exceeds 65536/.test(problem)), problems.join("\n"));
});
