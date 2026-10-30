import test from "node:test";
import assert from "node:assert/strict";
import { resolveSelfRepoFrom, requireSelfRepo, SELF_BRANCH } from "../agent/lib/self/config.ts";
import { authFailure, connectorUid, resolveConnectorUid, selfAuthRepo, selfProvider, selfToken, tokenParams, toolRepo } from "../agent/lib/self/auth.ts";
import { checkChanges, PROTECTED, WRITABLE } from "../agent/lib/self/policy.ts";
import { boundedLoadLiveSkills, loadLiveSkills, resetLiveSkillCacheForTests, resilientLoadLiveSkills, resolveLiveSkillsForTurn } from "../agent/skills/live.ts";
import commitTool from "../agent/tools/self_commit.ts";
import revertTool from "../agent/tools/self_revert.ts";
import readTool from "../agent/tools/self_read.ts";
import historyTool from "../agent/tools/self_history.ts";
import { getHeadSha, commitToMain, GitHubError } from "../agent/lib/self/github.ts";

const REPO = { owner: "org", name: "agent" };
const authRepo = (repo, token = "bearer") => ({ ...repo, token, onUnauthorized() {} });
const sha = "a".repeat(40);

async function withEnv(values, fn) {
  const old = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) value === undefined ? delete process.env[key] : process.env[key] = value;
  try { return await fn(); } finally { for (const [key, value] of old) value === undefined ? delete process.env[key] : process.env[key] = value; }
}

test("AC1: identity precedence, metadata, missing/malformed identity, connector UID and fixed main", async () => {
  assert.deepEqual(resolveSelfRepoFrom({ SELF_REPO: " explicit/name ", VERCEL_GIT_PROVIDER: "github", VERCEL_GIT_REPO_OWNER: "other", VERCEL_GIT_REPO_SLUG: "repo" }), { owner: "explicit", name: "name" });
  assert.deepEqual(resolveSelfRepoFrom({ VERCEL_GIT_PROVIDER: "github", VERCEL_GIT_REPO_OWNER: " org ", VERCEL_GIT_REPO_SLUG: " repo " }), { owner: "org", name: "repo" });
  assert.equal(resolveSelfRepoFrom({ VERCEL_GIT_PROVIDER: "gitlab", VERCEL_GIT_REPO_OWNER: "org", VERCEL_GIT_REPO_SLUG: "agent" }), null);
  assert.throws(() => resolveSelfRepoFrom({ SELF_REPO: "org/agent/extra" }), /SELF_REPO must look like/);
  assert.equal(resolveSelfRepoFrom({}), null);
  const previous = { repo: process.env.SELF_REPO, provider: process.env.VERCEL_GIT_PROVIDER };
  delete process.env.SELF_REPO;
  delete process.env.VERCEL_GIT_PROVIDER;
  try { assert.throws(() => requireSelfRepo(), /Self-repository identity is missing/); }
  finally {
    previous.repo === undefined ? delete process.env.SELF_REPO : process.env.SELF_REPO = previous.repo;
    previous.provider === undefined ? delete process.env.VERCEL_GIT_PROVIDER : process.env.VERCEL_GIT_PROVIDER = previous.provider;
  }
  assert.equal(SELF_BRANCH, "main");
  assert.equal(resolveConnectorUid(), "github/self");
  assert.equal(resolveConnectorUid("  "), "github/self");
  assert.equal(resolveConnectorUid(" github/custom-agent "), "github/custom-agent");
  assert.throws(() => resolveConnectorUid("github/"), /SELF_GITHUB_CONNECTOR/);
  assert.throws(() => resolveConnectorUid("not-a-github-uid"), /SELF_GITHUB_CONNECTOR/);
  await withEnv({ SELF_GITHUB_CONNECTOR: "bad", SELF_REPO: "org/agent" }, async () => {
    let calls = 0;
    await assert.rejects(toolRepo({ getToken: async () => { calls++; return { token: "x" }; }, requireAuth() {} }, REPO), /SELF_GITHUB_CONNECTOR/);
    assert.equal(calls, 0);
  });
});

test("AC2: provider and root SDK token use app subject and the same one-repo Contents grant", async () => {
  const expected = { subject: { type: "app" }, authorizationDetails: [{ type: "github_app_installation", org: "org", repositories: ["agent"], permissions: ["contents:write"] }] };
  assert.deepEqual(tokenParams(REPO), expected);
  await withEnv({ SELF_GITHUB_CONNECTOR: "github/custom" }, async () => {
    const provider = selfProvider(REPO);
    assert.equal(provider.principalType, "app");
    assert.deepEqual(provider.vercelConnect, { connector: "github/custom" });
    let args;
    const token = await selfToken(REPO, async (...params) => { args = params; return "fresh-bearer"; });
    assert.equal(token, "fresh-bearer");
    assert.deepEqual(args, ["github/custom", expected]);
    let eviction;
    const liveRepo = await selfAuthRepo(REPO, async (...params) => { args = params; return "live-bearer"; }, (...params) => { eviction = params; });
    assert.equal(liveRepo.token, "live-bearer");
    await liveRepo.onUnauthorized();
    assert.deepEqual(eviction, ["github/custom", expected]);
    let providerSeen;
    const authed = await toolRepo({ getToken: async (p) => { providerSeen = p; return { token: "tool-bearer" }; }, requireAuth() {} }, REPO);
    assert.equal(providerSeen.principalType, "app");
    assert.deepEqual(providerSeen.vercelConnect, provider.vercelConnect);
    assert.equal(authed.token, "tool-bearer");
    assert.equal(JSON.stringify({ result: "ok" }).includes("tool-bearer"), false);
  });
  for (const [tool, expectedKeys] of [[readTool, ["path"]], [historyTool, ["limit"]], [commitTool, ["baseSha", "message", "files"]], [revertTool, ["targetSha", "baseSha", "reason"]]]) {
    assert.deepEqual(Object.keys(tool.inputSchema._zod.def.shape), expectedKeys);
  }
});

test("AC3: setup failures have safe remedies; token failure never reaches GitHub", async () => {
  const cases = [
    ["connector_not_found", "Create/check the Connect connector"],
    ["project not linked", "Link the Vercel project"],
    ["installation_required", "Install and approve the GitHub App"],
    ["OIDC credentials missing", "Check the Connect connector"],
    ["token service exploded", "Check the Connect connector"],
    ["insufficient grant", "Check the Connect connector"],
  ];
  for (const [message, remedy] of cases) {
    const error = authFailure(new Error(`${message} secret-sentinel`), "github/self", REPO);
    assert.match(error.message, /github\/self.*org\/agent/);
    assert.ok(error.message.includes(remedy), error.message);
    assert.doesNotMatch(error.message, /secret-sentinel/);
  }
  const oldIdentity = process.env.SELF_REPO;
  process.env.SELF_REPO = "org/agent";
  const failedCtx = { getToken: async () => { throw new Error("token service secret-sentinel"); }, requireAuth() {}, session: { id: "s", auth: {} } };
  let githubCalls = 0;
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => { githubCalls++; return Response.json({}); };
  try {
    await assert.rejects(toolRepo(failedCtx, REPO), /Connect authorization failed/);
    for (const [tool, input] of [[readTool, { path: "agent" }], [historyTool, { limit: 5 }], [commitTool, { baseSha: sha, message: "Update instructions safely", files: [{ path: "agent/instructions.md", content: "This is sufficiently long to keep the required identity, purpose, and detailed response guidance intact." }] }], [revertTool, { targetSha: "b".repeat(40), baseSha: sha, reason: "Restore the earlier valid version" }]]) {
      await assert.rejects(tool.execute(input, failedCtx), /Connect authorization failed/);
    }
    assert.equal(githubCalls, 0, "none of the four tools may call GitHub after Connect fails");
  } finally {
    globalThis.fetch = savedFetch;
    oldIdentity === undefined ? delete process.env.SELF_REPO : process.env.SELF_REPO = oldIdentity;
  }

  let evictions = 0;
  const auth = { owner: REPO.owner, name: REPO.name, token: "sentinel-bearer", onUnauthorized: () => { evictions++; } };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { githubCalls++; return new Response("private detail", { status: 401 }); };
  try {
    await assert.rejects(getHeadSha(auth), (error) => error instanceof GitHubError && /authorization/i.test(error.message) && !error.message.includes("sentinel-bearer"));
    assert.equal(evictions, 1);
    assert.equal(githubCalls, 1, "401 must not replay the GitHub request");
  } finally { globalThis.fetch = originalFetch; }
  const originalFetch403 = globalThis.fetch;
  globalThis.fetch = async () => new Response("forbidden", { status: 403 });
  try { await assert.rejects(getHeadSha(auth), (error) => error instanceof GitHubError && error.status === 403 && /forbidden/.test(error.message)); }
  finally { globalThis.fetch = originalFetch403; }
  let patchCalls = 0;
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url);
    if (path.endsWith("/git/commits/base")) return Response.json({ tree: { sha: "tree" } });
    if (path.endsWith("/git/trees")) return Response.json({ sha: "new-tree" });
    if (path.endsWith("/git/commits")) return Response.json({ sha: "new-commit", html_url: "https://example.test/commit" });
    if (init.method === "PATCH") { patchCalls++; return new Response("unauthorized", { status: 401 }); }
    return Response.json({});
  };
  try { await assert.rejects(commitToMain(auth, "base", [{ path: "agent/instructions.md", content: "text" }], "message"), /authorization/i); }
  finally { globalThis.fetch = originalFetch; }
  assert.equal(patchCalls, 1, "a rejected ref update is never replayed");
});

test("AC4: live skills cache only complete loads, fall back for the same repo, and time out before late GitHub work", async () => {
  resetLiveSkillCacheForTests();
  let tokenCalls = 0;
  assert.equal(await resolveLiveSkillsForTurn(false, async () => { tokenCalls++; return {}; }), null);
  assert.equal(tokenCalls, 0, "disabled live loading must not call the token loader");
  const repo = { ...REPO };
  assert.equal(await loadLiveSkills({ repo: null, getAuthRepo: async () => { tokenCalls++; return authRepo(repo); } }), null);
  assert.equal(tokenCalls, 0, "missing repository identity must not call Connect");
  const deps = {
    repo,
    getAuthRepo: async (r) => authRepo(r),
    head: async () => "head-1",
    tree: async () => [{ type: "blob", path: "agent/skills/example.md", sha: "blob-1", size: 12 }],
    blob: async () => "A useful live skill.",
  };
  const skills = await loadLiveSkills(deps);
  assert.ok(skills?.example);
  let liveBearer;
  const refreshed = await loadLiveSkills({ ...deps, head: async (authed) => { liveBearer = authed.token; return "head-1"; }, getAuthRepo: async (r) => authRepo(r, "refreshed-bearer") });
  assert.equal(refreshed, skills);
  assert.equal(liveBearer, "refreshed-bearer");
  const prior = await resilientLoadLiveSkills({ ...deps, getAuthRepo: async () => { throw new Error("Connect denied"); } }, 20);
  assert.equal(prior, skills);
  const githubFailure = await resilientLoadLiveSkills({ ...deps, head: async () => { throw new Error("GitHub unavailable"); } }, 20);
  assert.equal(githubFailure, skills);
  const otherRepo = await resilientLoadLiveSkills({ ...deps, repo: { owner: "other", name: "repo" }, getAuthRepo: async () => { throw Error("denied"); } }, 20);
  assert.equal(otherRepo, null);

  resetLiveSkillCacheForTests();
  let resolveLate;
  let githubCalls = 0;
  const pending = new Promise((resolve) => { resolveLate = resolve; });
  const timed = await resilientLoadLiveSkills({ repo, getAuthRepo: () => pending, head: async () => { githubCalls++; return "late"; } }, 20);
  assert.equal(timed, null);
  resolveLate(authRepo(repo, "late-bearer"));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(githubCalls, 0);
  await assert.rejects(boundedLoadLiveSkills({ repo, getAuthRepo: async () => { throw Error("offline"); } }, 20), /offline/);

  resetLiveSkillCacheForTests();
  let finishBlob;
  let blobCalls = 0;
  const slowDeps = { ...deps, blob: () => { blobCalls++; return new Promise((resolve) => { finishBlob = resolve; }); } };
  assert.equal(await resilientLoadLiveSkills(slowDeps, 20), null);
  finishBlob("late skill content");
  await new Promise((resolve) => setTimeout(resolve, 0));
  const recovered = await loadLiveSkills({ ...deps, blob: async () => { blobCalls++; return "new content"; } });
  assert.ok(recovered?.example);
  assert.equal(blobCalls, 2, "late results must not enter the reusable blob cache");
});

test("AC5: legacy credential reads are absent, guard paths remain aligned, and protections reject internals", async () => {
  const config = await (await import("node:fs/promises")).readFile(new URL("../agent/lib/self/config.ts", import.meta.url), "utf8");
  const readme = await (await import("node:fs/promises")).readFile(new URL("../README.md", import.meta.url), "utf8");
  const env = await (await import("node:fs/promises")).readFile(new URL("../.env.example", import.meta.url), "utf8");
  const policy = await (await import("node:fs/promises")).readFile(new URL("../agent/lib/self/policy.ts", import.meta.url), "utf8");
  assert.doesNotMatch(config + readme + env, /GITHUB_TOKEN/);
  assert.ok(PROTECTED.includes("agent/lib/self/"));
  assert.ok(PROTECTED.includes("agent/tools/self_"));
  assert.ok(PROTECTED.includes("agent/skills/live.ts"));
  assert.ok(PROTECTED.includes("agent/skills/self-modify/"));
  assert.ok(PROTECTED.includes("agent/channels/eve.ts"));
  assert.match(policy, /SELF_GITHUB_CONNECTOR/);
  assert.equal(checkChanges([{ path: "agent/lib/self/auth.ts", content: "human" }]).length > 0, true);
  assert.equal(checkChanges([{ path: "agent/instructions.md", content: "A permitted instruction change that keeps the identity and detailed response guidance intact." }]).length, 0);
  assert.ok(checkChanges([{ path: "agent/tools/new.ts", content: "process.env.SELF_GITHUB_CONNECTOR;" }]).some((p) => p.includes("self-connector configuration")));
  assert.ok(checkChanges([{ path: "agent/tools/new.ts", content: "import x from '../lib/self/policy';" }]).some((p) => p.includes("self-modification internals")));
  assert.ok(checkChanges([{ path: "agent/tools/new.ts", content: "const connector = 'github/self';" }]).some((p) => p.includes("default self connector")));
  assert.ok(checkChanges([{ path: "agent/tools/new.ts", content: "const detail = 'github_app_installation';" }]).some((p) => p.includes("GitHub App installation authorization")));
  assert.ok(checkChanges([{ path: "agent/tools/new.ts", content: "fetch('https://api.github.com');" }]).some((p) => p.includes("GitHub API")));
  assert.ok(checkChanges([{ path: "agent/tools/new.ts", content: "const key = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';" }]).some((p) => p.includes("GitHub token")));
  assert.deepEqual(checkChanges([{ path: "agent/channels/slack.ts", content: 'import { connectSlackCredentials } from "@vercel/connect/eve";\nconst auth = connectSlackCredentials({ connector: "slack/my-agent" });' }]), []);
  assert.ok(WRITABLE.includes("README.md"));
});

test("AC6: invalid commits make no auth/network call; stale base rejects; commits stay fast-forward only", async () => {
  const prior = { SELF_REPO: process.env.SELF_REPO, SELF_GITHUB_CONNECTOR: process.env.SELF_GITHUB_CONNECTOR, SELF_APPROVERS: process.env.SELF_APPROVERS };
  process.env.SELF_REPO = "org/agent";
  process.env.SELF_GITHUB_CONNECTOR = "github/self";
  let tokenCalls = 0;
  let githubCalls = 0;
  const ctx = { getToken: async () => { tokenCalls++; return { token: "test-bearer" }; }, requireAuth() {}, session: { id: "test", auth: {} } };
  try {
    await assert.rejects(commitTool.execute({ baseSha: sha, message: "invalid protected write", files: [{ path: "agent/lib/self/auth.ts", content: "bad" }] }, ctx), /Rejected by self-modification policy/);
    assert.equal(tokenCalls, 0);
    assert.equal(githubCalls, 0);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { githubCalls++; return Response.json({ object: { sha: "b".repeat(40) } }); };
    try {
      await assert.rejects(commitTool.execute({ baseSha: sha, message: "valid instruction update", files: [{ path: "agent/instructions.md", content: "This is a sufficiently long instruction update describing the identity, purpose, and response guidelines." }] }, ctx), /main is at/);
      assert.equal(tokenCalls, 1);
      assert.equal(githubCalls, 1, "stale base is rejected before creating a commit");
      globalThis.fetch = async () => { githubCalls++; return Response.json({ object: { sha: "c".repeat(40) } }); };
      await assert.rejects(revertTool.execute({ targetSha: "d".repeat(40), baseSha: sha, reason: "Restore after a regression" }, ctx), /main is at/);
      assert.equal(tokenCalls, 2);
      assert.equal(githubCalls, 2, "stale revert stops before compare or write");

      const revertRequests = [];
      globalThis.fetch = async (url, init = {}) => {
        const path = String(url);
        revertRequests.push({ path, init });
        if (path.endsWith("/git/ref/heads/main")) return Response.json({ object: { sha } });
        if (path.includes("/compare/")) return Response.json({ status: "ahead", files: [{ filename: "agent/lib/self/auth.ts" }, { filename: "agent/instructions.md" }] });
        if (path.endsWith("/git/trees/tree-target?recursive=1")) return Response.json({ truncated: false, tree: [{ type: "blob", path: "agent/instructions.md", sha: "blob-safe" }] });
        if (path.includes("/git/commits/")) return Response.json({ tree: { sha: "tree-target" } });
        if (path.endsWith("/git/trees")) return Response.json({ sha: "rollback-tree" });
        if (path.endsWith("/git/commits")) return Response.json({ sha: "rollback-commit", html_url: "https://example.test/rollback" });
        return Response.json({});
      };
      const reverted = await revertTool.execute({ targetSha: "d".repeat(40), baseSha: sha, reason: "Restore the earlier good behavior" }, ctx);
      assert.deepEqual(reverted.skippedProtected, ["agent/lib/self/auth.ts"]);
      const revertPatch = revertRequests.find((r) => r.init.method === "PATCH");
      assert.deepEqual(JSON.parse(revertPatch.init.body), { sha: "rollback-commit", force: false });
    } finally { globalThis.fetch = originalFetch; }

    let requests = [];
    const originalFetch2 = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
      requests.push({ url: String(url), init });
      if (String(url).endsWith("/git/commits/base")) return Response.json({ tree: { sha: "tree" } });
      if (String(url).endsWith("/git/trees")) return Response.json({ sha: "new-tree" });
      if (String(url).endsWith("/git/commits")) return Response.json({ sha: "new-commit", html_url: "https://example.test/commit" });
      return Response.json({ ok: true });
    };
    try { await commitToMain({ ...REPO, token: "t" }, "base", [{ path: "agent/instructions.md", content: "ok" }], "message"); }
    finally { globalThis.fetch = originalFetch2; }
    const patch = requests.find((r) => r.init.method === "PATCH");
    assert.ok(patch);
    assert.deepEqual(JSON.parse(patch.init.body), { sha: "new-commit", force: false });
    process.env.SELF_APPROVERS = "approved-person";
    assert.equal(commitTool.approval.response({ responder: { principalId: "person" } }).status, "rejected");
    assert.equal(revertTool.approval.response({ responder: { principalId: "approved-person" } }).status, "allowed");
  } finally {
    prior.SELF_REPO === undefined ? delete process.env.SELF_REPO : process.env.SELF_REPO = prior.SELF_REPO;
    prior.SELF_GITHUB_CONNECTOR === undefined ? delete process.env.SELF_GITHUB_CONNECTOR : process.env.SELF_GITHUB_CONNECTOR = prior.SELF_GITHUB_CONNECTOR;
    prior.SELF_APPROVERS === undefined ? delete process.env.SELF_APPROVERS : process.env.SELF_APPROVERS = prior.SELF_APPROVERS;
  }
});

test("AC4 regression: a timed-out live load never publishes, even when the injected clock lags the timer", async () => {
  resetLiveSkillCacheForTests();
  const repo = { owner: "org", name: "agent" };
  let finishBlob;
  let blobCalls = 0;
  const deps = {
    repo,
    now: () => 1_000, // the injected clock never reaches the deadline
    getAuthRepo: async (r) => ({ ...r, token: "t", onUnauthorized() {} }),
    head: async () => "head-1",
    tree: async () => [{ type: "blob", path: "agent/skills/late.md", sha: "blob-late", size: 10 }],
  };
  const timedOut = await resilientLoadLiveSkills(
    { ...deps, blob: () => { blobCalls++; return new Promise((resolve) => { finishBlob = resolve; }); } },
    20,
  );
  assert.equal(timedOut, null);
  finishBlob("---\ndescription: late skill\n---\nlate body");
  await new Promise((resolve) => setTimeout(resolve, 10));
  const next = await loadLiveSkills({ ...deps, blob: async () => { blobCalls++; return "fresh"; } });
  assert.equal(blobCalls, 2, "the late blob must not have been published to the blob cache");
  assert.equal(next?.late?.markdown, "fresh");
  resetLiveSkillCacheForTests();
});
