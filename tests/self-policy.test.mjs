import test from "node:test";
import assert from "node:assert/strict";
import moduleBuiltin, { syncBuiltinESMExports } from "node:module";
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

for (const extension of ["ts", "mts", "tsx"]) {
  for (const [name, content] of [
    ["typed export", ordinaryTs],
    ["enum", "export enum Status { Ready }"],
    ["parameter property", "export class Example { constructor(public value: string) {} }"],
  ]) {
    test(`${name} passes in .${extension}`, () =>
      accepted([{ path: `agent/tools/example.${extension}`, content }]));
  }
}

const malformedAroundDeclarations = [
  ...["export enum Status { Ready }", "export class Example { constructor(public value: string) {} }"].flatMap((declaration) => [
    [`invalid expression before ${declaration.startsWith("export enum") ? "enum" : "parameter property"}`, `const broken = ;\n${declaration}`],
    [`invalid expression after ${declaration.startsWith("export enum") ? "enum" : "parameter property"}`, `${declaration}\nconst broken = ;`],
  ]),
  ["invalid expression inside parameter-property constructor", "export class Example { constructor(public value: string) { const broken = ; } }"],
  ["invalid expression inside enum initializer", "enum E { A = (() => { const broken = ; })() }"],
];
for (const [name, content] of [
  ["missing expression", "export const value = ;"],
  ["malformed enum initializer", "export enum Status { Ready = }"],
  ["malformed parameter type", "export class Example { constructor(public value: ) {} }"],
  ...malformedAroundDeclarations,
]) {
  test(`${name} is rejected as TypeScript syntax`, () => {
    const path = "agent/tools/example.ts";
    const problems = checkChanges([{ path, content }]);
    assert.ok(problems.some((problem) => problem.includes(`${path}: TypeScript syntax error:`)), problems.join("\n"));
  });
}

test("runtime namespace and import alias remain accepted", () => {
  accepted([{ path: tool, content: "namespace N { export const value = 1; }" }]);
  accepted([{ path: tool, content: "import fs = require('node:fs');" }]);
});

function withStripper(replacement, run) {
  const original = moduleBuiltin.stripTypeScriptTypes;
  try {
    moduleBuiltin.stripTypeScriptTypes = replacement;
    syncBuiltinESMExports();
    run();
  } finally {
    moduleBuiltin.stripTypeScriptTypes = original;
    syncBuiltinESMExports();
  }
}

test("only exact unsupported TypeScript syntax code passes after a strip failure", () => {
  withStripper(() => { throw Object.assign(new Error("anything"), { code: "ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX" }); }, () =>
    accepted([{ path: tool, content: ordinaryTs }]),
  );
  withStripper(() => { throw Object.assign(new Error("unsupported but invalid"), { code: "ERR_INVALID_TYPESCRIPT_SYNTAX" }); }, () =>
    rejectedContent(ordinaryTs, /TypeScript syntax error/, tool),
  );
  for (const error of [new SyntaxError("unsupported"), Object.assign(new Error("unsupported"), { code: "OTHER" })]) {
    withStripper(() => { throw error; }, () =>
      rejectedContent(ordinaryTs, /TypeScript syntax validation could not be completed/, tool),
    );
  }
});

test("unexpected stripper failures fail closed with safe bounded detail", () => {
  const failures = [
    Object.assign(new Error("bad options"), { code: "ERR_INVALID_ARG_VALUE" }),
    new Error("ordinary failure"), "string failure", null, {}, new Error("x".repeat(500)),
  ];
  for (const failure of failures) {
    withStripper(() => { throw failure; }, () => {
      let problems;
      assert.doesNotThrow(() => { problems = checkChanges([{ path: tool, content: ordinaryTs }]); });
      const diagnostic = problems.find((problem) => problem.includes(`${tool}: TypeScript syntax validation could not be completed:`));
      assert.ok(diagnostic, problems.join("\n"));
      const detail = diagnostic.slice(diagnostic.indexOf("completed:") + "completed: ".length);
      assert.ok(detail.length <= 300, `diagnostic detail was ${detail.length} characters`);
    });
  }
});

test("non-erasable syntax does not bypass reference or secret checks", () => {
  rejectedContent("export enum Status { Ready }\nexport const url = 'https://api.github.com';", /reference the GitHub API/, tool);
  rejectedContent("export class Example { constructor(public value: string) {} }\n// synthetic ghp_ABCDEFGHIJKLMNOPQRST", /GitHub token/, tool);
});

test("candidate TypeScript is parsed without executing it", () => {
  const sentinel = "__vot_policy_syntax_gate_sentinel__";
  delete globalThis[sentinel];
  accepted([{ path: tool, content: `globalThis.${sentinel} = true;\nexport const value: string = 'ok';` }]);
  accepted([{ path: tool, content: "throw new Error('MUST NOT EXECUTE');\nexport const value: string = 'ok';" }]);
  assert.equal(globalThis[sentinel], undefined);
  assert.equal(checkPath("agent/lib/self/policy.ts").ok, false);
});

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
