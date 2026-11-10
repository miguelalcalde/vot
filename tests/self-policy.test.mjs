import test from "node:test";
import assert from "node:assert/strict";
import { checkChangeSet, checkChanges, checkPath, PROTECTED, WRITABLE } from "../agent/lib/self/policy.ts";

const instructions = "You are an assistant learning the user's preferred role, personality, tone and response style over time.";
const entry = "---\ndescription: Use when an example behavior procedure applies.\n---\nUseful steps.\n";
const packageEntry = "agent/skills/example/SKILL.md";
const skill = "agent/skills/example.md";
const ok = (changes, tree = ["agent/instructions.md"]) => assert.deepEqual(checkChangeSet(changes, tree), []);

test("policy exposes only behavior Markdown and protects operating rules", () => {
  assert.deepEqual(WRITABLE, ["agent/instructions.md", "agent/skills/"]);
  assert.ok(PROTECTED.includes("agent/instructions/operating-rules.md"));
  for (const path of ["agent/instructions.md", skill, packageEntry, "agent/skills/example/references/guide.md"]) assert.equal(checkPath(path).ok, true);
  for (const path of ["agent/tools/new.ts", "agent/lib/new.ts", "agent/channels/new.ts", "agent/connections/new.ts", "agent/schedules/new.ts", "agent/subagents/new.ts", "README.md", "agent/agent.ts", "agent/instructions/operating-rules.md", "agent/skills/example/script.ts", "agent/skills/example/readme.txt", "agent/skills/Example.md", "agent/skills/example.MD"]) assert.equal(checkPath(path).ok, false, path);
});

test("flat and packaged skill entry points require nonempty descriptions", () => {
  ok([{ path: skill, content: entry }]);
  ok([{ path: packageEntry, content: entry }]);
  for (const content of ["Body only", "---\ndescription:   \n---\nBody"]) {
    assert.match(checkChanges([{ path: skill, content }]).join("\n"), /nonempty description/);
    assert.match(checkChanges([{ path: packageEntry, content }]).join("\n"), /nonempty description/);
  }
});

test("resulting tree accepts Markdown references and rejects orphans and representation collisions", () => {
  ok([{ path: packageEntry, content: entry }, { path: "agent/skills/example/references/guide.md", content: "Guide" }]);
  assert.deepEqual(checkChanges([{ path: "agent/skills/example/references/guide.md", content: "Guide" }]), [], "path/content preflight does not assume the package is absent");
  assert.match(checkChangeSet([{ path: "agent/skills/example/references/guide.md", content: "Guide" }], ["agent/instructions.md"]).join("\n"), /no SKILL.md entry point/);
  const tree = ["agent/instructions.md", skill];
  assert.match(checkChangeSet([{ path: packageEntry, content: entry }], tree).join("\n"), /conflicts with another spelling/);
  assert.match(checkChangeSet([{ path: packageEntry, content: entry }, { path: "agent/skills/example/SKILL.md/references/guide.md", content: "bad tree" }], ["agent/instructions.md"]).join("\n"), /file\/directory path conflict/);
});

test("reserved owner identities are blocked in flat and package spellings", () => {
  for (const name of ["self-modify", "add-channel", "live"]) {
    assert.match(checkChanges([{ path: `agent/skills/${name}.md`, content: entry }]).join("\n"), /owner-maintained/);
    assert.match(checkChanges([{ path: `agent/skills/${name}/SKILL.md`, content: entry }]).join("\n"), /owner-maintained|protected/);
    assert.match(checkChanges([{ path: `agent/skills/${name}/references/a.md`, content: "x" }]).join("\n"), /owner-maintained|protected/);
  }
});

test("reserved identities stay blocked when their owner-maintained forms already exist", () => {
  const ownerTree = ["agent/instructions.md", "agent/skills/self-modify/SKILL.md", "agent/skills/add-channel.md", "agent/skills/live.ts"];
  for (const path of ["agent/skills/self-modify.md", "agent/skills/add-channel/SKILL.md", "agent/skills/live/SKILL.md"]) {
    assert.ok(checkChangeSet([{ path, content: entry }], ownerTree).length > 0, path);
  }
});

test("invalid mixed transaction and duplicate paths reject as a whole", () => {
  assert.ok(checkChanges([{ path: skill, content: entry }, { path: "agent/tools/backdoor.ts", content: "bad" }]).length > 0);
  assert.match(checkChanges([{ path: skill, content: entry }, { path: skill, content: entry }]).join("\n"), /listed more than once/);
});

test("instructions cannot be deleted or emptied and required file must remain", () => {
  assert.match(checkChanges([{ path: "agent/instructions.md", delete: true }]).join("\n"), /cannot be deleted/);
  assert.match(checkChanges([{ path: "agent/instructions.md", content: "   " }]).join("\n"), /nonempty character layer/);
  assert.match(checkChangeSet([{ path: skill, content: entry }], []).join("\n"), /cannot be deleted or absent/);
  ok([{ path: "agent/instructions.md", content: instructions }]);
});

test("historical content gets current secret, size and skill rules", () => {
  assert.match(checkChanges([{ path: skill, content: "synthetic ghp_ABCDEFGHIJKLMNOPQRST" }]).join("\n"), /GitHub token/);
  assert.match(checkChanges([{ path: packageEntry, content: "---\ndescription: ok\n---\n" + "x".repeat(65_537) }]).join("\n"), /exceeds 65536/);
  assert.match(checkChanges([{ path: "agent/instructions.md", content: "short" }]).join("\n"), /nonempty character layer/);
});

test("path traversal, extension tricks and reserved variants do not pass", () => {
  for (const path of ["agent/skills/../escape.md", "agent/skills/example/../../tools/x.ts", "agent/skills/self-modify.md", "agent/skills/add-channel/SKILL.md"]) assert.equal(checkPath(path).ok, false);
});
