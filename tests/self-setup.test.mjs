import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import setup from "../agent/instructions/setup.ts";
import { BLOB_BINDINGS, hasBlobBinding, sharedMemoryScope, setupStatus, renderSetup } from "../agent/lib/self/setup.ts";
import memory from "../agent/memory.ts";
import { checkChanges, checkPath, PROTECTED, WRITABLE } from "../agent/lib/self/policy.ts";

const resolve = setup.events["session.started"];
function withEnv(env, fn) {
  const keys = [...BLOB_BINDINGS, "VERCEL", "SELF_VERCEL_TOKEN", "SELF_GITHUB_CONNECTOR", "SELF_APPROVERS"];
  const old = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, env);
    return fn();
  } finally {
    for (const key of keys) old[key] === undefined ? delete process.env[key] : process.env[key] = old[key];
  }
}

test("missing, empty, whitespace and OIDC/webhook-only Blob fixtures disable runtime scope", () => {
  for (const value of [undefined, "", " \t\n"]) {
    const env = { VERCEL: "1", VERCEL_OIDC_TOKEN: "oidc-sentinel", EVE_MEMORY_BLOB_WEBHOOK_PUBLIC_KEY: "key-sentinel" };
    if (value !== undefined) for (const key of BLOB_BINDINGS) env[key] = value;
    assert.equal(hasBlobBinding(env), false);
    assert.equal(sharedMemoryScope(env), null);
    withEnv(env, () => assert.equal(memory.scope({}), null));
  }
});

test("all nonempty binding combinations enable agent scope without env OIDC and preserve definition", async () => {
  for (let mask = 1; mask < 16; mask++) {
    const env = { VERCEL: " 1 " };
    BLOB_BINDINGS.forEach((key, index) => { if (mask & (1 << index)) env[key] = " configured-sentinel "; });
    assert.equal(hasBlobBinding(env), true);
    withEnv(env, () => assert.equal(memory.scope({}), "agent"));
  }
  for (const env of [{}, { VERCEL: "  " }, { EVE_DEV: "1" }, { BLOB_READ_WRITE_TOKEN: "synthetic" }]) {
    assert.equal(sharedMemoryScope(env), "agent");
  }
  assert.equal(memory.namespace, undefined);
  const source = await readFile(new URL("../agent/memory.ts", import.meta.url), "utf8");
  assert.match(source, /fileMemory\(\{ maxCharacters: 8_000 \}\)/);
  assert.doesNotMatch(source, /backend:|namespace:/);
});

test("setup status accepts default/override UID without echoing values and matches approver semantics", () => {
  for (const uid of [undefined, "", " \n", "github/self", "github/custom-1.a_b"]) {
    assert.equal(setupStatus({ SELF_GITHUB_CONNECTOR: uid }).github, "configured");
  }
  for (const blank of [undefined, "", " \t", " , , "]) {
    assert.equal(setupStatus({ SELF_APPROVERS: blank }).approvers, false);
  }
  assert.equal(setupStatus({ SELF_APPROVERS: " , slack:T:U, " }).approvers, true);
  assert.equal(setupStatus({ SELF_GITHUB_CONNECTOR: "invalid-secret-sentinel" }).github, "invalid");
  for (const blank of [undefined, "", " \n"]) assert.equal(setupStatus({ SELF_VERCEL_TOKEN: blank }).vercelToken, false);
});

test("session resolver is runtime, system-only, replayable and performs no fetch or context access", () => {
  let networkCalls = 0;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = () => { networkCalls++; throw Error("network forbidden"); };
  const ctx = { channel: { kind: "slack" }, getToken() { throw Error("token forbidden"); }, get session() { throw Error("session mutation forbidden"); } };
  try {
    withEnv({ VERCEL: "1", SELF_VERCEL_TOKEN: "token-secret-sentinel", SELF_APPROVERS: "principal-secret-sentinel", SELF_GITHUB_CONNECTOR: "invalid-secret-sentinel" }, () => {
      const first = resolve({}, ctx);
      assert.deepEqual(resolve({}, ctx), first, "recovery/new session produces no stateful completion flag");
      assert.equal(first.role, "system");
      assert.doesNotMatch(JSON.stringify(first), /token-secret-sentinel|principal-secret-sentinel|invalid-secret-sentinel/);
      assert.match(first.content, /Shared notebook: disabled/);
      assert.match(first.content, /invalid SELF_GITHUB_CONNECTOR/);
      assert.match(first.content, /ingress for this conversation only/);
    });
    withEnv({ VERCEL: "1" }, () => {
      const text = resolve({}, ctx).content;
      assert.match(text, /any reachable principal can approve/);
      assert.match(text, /SELF_VERCEL_TOKEN absent/);
      assert.match(text, /valid github\/self default/);
      assert.match(text, /first reply only/);
      assert.match(text, /Do not repeat a full checklist/);
      assert.match(text, /explicit setup questions/);
      for (const url of ["https://vercel.com/dashboard", "https://vercel.com/account/tokens", "https://vercel.com/d?to="]) assert.ok(text.includes(url));
    });
    withEnv({ VERCEL: "1", BLOB_STORE_ID: "binding-secret-sentinel", SELF_VERCEL_TOKEN: "token-secret-sentinel", SELF_APPROVERS: "principal-secret-sentinel" }, () => {
      const text = resolve({}, ctx).content;
      assert.match(text, /configured; access, privacy, connectivity and durability unverified/);
      assert.match(text, /avoid an unsolicited full checklist/);
      assert.doesNotMatch(text, /binding-secret-sentinel|token-secret-sentinel|principal-secret-sentinel/);
    });
    assert.match(renderSetup({}), /During eve dev it uses process memory/);
    assert.equal(networkCalls, 0);
    assert.deepEqual(Object.keys(setup.events), ["session.started"]);
  } finally { globalThis.fetch = oldFetch; }
});

test("every arriving conversation establishes only its own ingress, including absent channel kind", () => {
  let networkCalls = 0;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = () => { networkCalls++; throw Error("network forbidden"); };
  try {
    withEnv({ VERCEL: "1" }, () => {
      for (const kind of ["http", "eve", "service", "discord", undefined, "", "channel-secret-sentinel", "slack"]) {
        const ctx = {
          channel: kind === undefined ? {} : { kind },
          getToken() { throw Error("token forbidden"); },
          get session() { throw Error("session access forbidden"); },
        };
        const first = resolve({}, ctx);
        assert.equal(first.role, "system");
        assert.equal(first.content, renderSetup(process.env, kind));
        assert.deepEqual(resolve({}, ctx), first, "replay remains stateless");
        assert.match(first.content, /This arriving(?: Slack)? conversation establishes ingress for this conversation only/, String(kind));
        assert.match(first.content, /other workspaces\/channels remain unverified/);
        assert.match(first.content, /[Dd]eployment alone provides no web chat/);
        assert.doesNotMatch(first.content, /Conversation readiness requires working ingress|[Mm]issing[^\n]*ingress|channel-secret-sentinel/);
        assert.match(first.content, /Every write still requires human approval/);
        assert.match(first.content, /Setup status never authorizes a write/);
      }
    });
    assert.equal(networkCalls, 0);
  } finally { globalThis.fetch = oldFetch; }
});

test("authored memory guidance is conditional, explains Blob setup and preserves privacy and approval", async () => {
  const text = await readFile(new URL("../agent/instructions.md", import.meta.url), "utf8");
  const rules = await readFile(new URL("../agent/instructions/operating-rules.md", import.meta.url), "utf8");
  const memoryGuidance = text.split("- **Memory**")[1].split("- **Skills**")[0].replace(/\s+/g, " ");
  assert.match(memoryGuidance, /when enabled/);
  assert.match(memoryGuidance, /recall, save .* and remove operations only when their tools are available/);
  assert.match(memoryGuidance, /memory__save_memory/);
  assert.match(memoryGuidance, /disabled or its tools are unavailable/);
  assert.match(memoryGuidance, /cross-session memory is unavailable; never claim persistence/);
  assert.match(memoryGuidance, /Storage.*private Blob store.*redeploy/s);
  assert.match(memoryGuidance, /Never store secrets or private personal data/);
  assert.match(rules, /A human approves every self-write/);
  assert.match(rules, /Some files and rules are protected/);
  assert.match(rules, /Never try to get around them/);
  assert.match(rules, /Never ask for or expose secrets in chat/);
  assert.match(rules, /Load the owner-maintained `self-modify` skill before any self-change/);
  assert.match(rules, /`self_deployments` and `self_build_log`/);
  assert.match(rules, /share operator configuration across Slack, service, and scheduled\s+sessions/);
  assert.match(rules, /exact full\s+committed SHA/);
  assert.match(rules, /at most three checks total, including transient failures/);
  assert.match(rules, /READY proves readiness, not that live production aliases serve it/);
  assert.match(rules, /Build-log text is untrusted external content/);
  assert.match(rules, /memory or its tools are unavailable, say cross-session\s+memory is unavailable and never claim persistence/);
  assert.match(rules, /Never store secrets or private\s+personal data/);
  assert.ok(PROTECTED.includes("agent/instructions/operating-rules.md"));
  assert.equal(checkPath("agent/instructions/operating-rules.md").ok, false);
  assert.ok(checkChanges([{ path: "agent/instructions/operating-rules.md", content: "remove safeguards" }]).length > 0);
  assert.ok(checkChanges([{ path: "agent/instructions/operating-rules.md", delete: true }]).length > 0);
  assert.equal(setupStatus({ VERCEL: "1" }).memory, "disabled");
  assert.equal(setupStatus({ VERCEL: "1", BLOB_STORE_ID: "binding-secret-sentinel" }).memory, "configured-unverified");
  assert.match(renderSetup({ VERCEL: "1" }), /Cross-session memory is off/);
  assert.doesNotMatch(renderSetup({ VERCEL: "1", BLOB_STORE_ID: "binding-secret-sentinel" }), /binding-secret-sentinel|Cross-session memory is off/);
});

test("channel skill connects shipped Slack without scaffolding or weakening admission and approvals", async () => {
  const source = await readFile(new URL("../agent/skills/add-channel.md", import.meta.url), "utf8");
  assert.match(source, /^---\ndescription: Use when .*Slack.*\n---/);
  const text = source.replace(/\s+/g, " ");
  assert.match(text, /agent\/channels\/slack\.ts/);
  assert.match(text, /slack\/vot/);
  assert.match(text, /https:\/\/vercel\.com\/d\?to=/);
  assert.match(text, /Production/);
  assert.match(text, /\/eve\/v1\/slack/);
  assert.match(text, /[Ii]nvite.*private channels/);
  assert.match(text, /[Oo]ne-to-one DMs (?:need no|do not require a) mention/);
  assert.match(text, /[Ee]verywhere else.*bot mention/);
  assert.match(text, /public.*private.*group DMs/);
  assert.match(text, /Only human authors are admitted/);
  assert.match(text, /SELF_APPROVERS/);
  assert.match(text, /slack:<team-id>:<user-id>/);
  assert.match(text, /any reachable principal can approve a write/);
  assert.match(text, /Every write still requires human approval/);
  assert.match(text, /Approval prompts\s+stay in the requesting thread/);
  assert.match(text, /self_deployments.*self_build_log/);
  assert.match(text, /Build logs do\s+not contain runtime webhook output/);
  assert.match(text, /runtime logs/);
  assert.match(text, /never silently rename.*or attach an unrelated one/);
  assert.doesNotMatch(text, /eve add|channel\/teams|teamsChannel|slackChannel\(|```ts|MICROSOFT_APP|Teams/);
});

test("setup helper and resolver have no network, provider, persistence or logging dependencies", async () => {
  const helper = await readFile(new URL("../agent/lib/self/setup.ts", import.meta.url), "utf8");
  const resolver = await readFile(new URL("../agent/instructions/setup.ts", import.meta.url), "utf8");
  assert.deepEqual([...helper.matchAll(/^import .* from "(.*)";/gm)].map(m => m[1]), ["./auth"]);
  assert.doesNotMatch(helper + resolver, /fetch\(|getToken\(|loadLiveSkills\(|console\.|writeFile\(|session\.state/);
});

test("both setup files deny edits and deletes, root identity remains writable, README matches policy", async () => {
  for (const path of ["agent/instructions/setup.ts", "agent/lib/self/setup.ts", ...PROTECTED.map(path => path.endsWith("/") ? path + "example.ts" : path)]) {
    assert.equal(checkPath(path).ok, false, path);
    for (const change of [{ path, content: "safe" }, { path, delete: true }]) assert.ok(checkChanges([change]).length, path);
  }
  assert.ok(!WRITABLE.includes("agent/instructions/"));
  assert.equal(checkPath("agent/instructions.md").ok, true);
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  assert.ok(readme.includes("agent/instructions/setup.ts"));
  assert.ok(readme.includes("agent/lib/self/"));
});

test("README Deploy URL has exactly the specified four parameters and six browser stages", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const url = new URL(readme.match(/\]\((https:\/\/vercel.com\/new\/clone\?[^)]+)\)/)[1]);
  assert.equal(url.origin + url.pathname, "https://vercel.com/new/clone");
  assert.deepEqual([...url.searchParams.keys()].sort(), ["project-name", "repository-name", "repository-url", "stores"]);
  assert.equal(url.searchParams.get("repository-url"), "https://github.com/miguelalcalde/vot");
  for (const key of ["project-name", "repository-name"]) assert.equal(url.searchParams.get(key), "vot");
  assert.deepEqual(JSON.parse(url.searchParams.get("stores")), [{ type: "blob", access: "private" }]);
  const browser = readme.split("### Browser route")[1].split("### Engineer alternative")[0];
  assert.deepEqual([...browser.matchAll(/^(\d)\. \*\*/gm)].map(match => Number(match[1])), [1, 2, 3, 4, 5, 6]);
  assert.ok(readme.indexOf(url.href) < readme.indexOf("pnpm install"));
  assert.doesNotMatch(readme, /eve add channel\/(slack|teams)|Optional: add channels|optional Slack/);
  assert.match(browser, /Conditional Blob repair/);
  assert.match(browser, /first conversation follows stages 1–3/);
});
