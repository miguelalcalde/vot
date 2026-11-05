import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import deploymentsTool from "../agent/tools/self_deployments.ts";
import logTool from "../agent/tools/self_build_log.ts";
import { listDeployments, readBuildLog } from "../agent/lib/self/vercel.ts";
import { checkChanges, checkPath } from "../agent/lib/self/policy.ts";

const A = "a".repeat(40), B = "b".repeat(40);
const TOKEN = "synthetic-private-credential";
const project = { id: "prj_example", accountId: "team_example" };
const detail = { id: "dpl_example", projectId: project.id };
const deployment = (overrides = {}) => ({ uid: "dpl_example", url: "example.test", state: "READY", target: "production", created: 1, meta: { githubCommitSha: A }, ...overrides });
async function fixture(run, responses = [], env = {}) {
  const saved = { fetch: globalThis.fetch, token: process.env.SELF_VERCEL_TOKEN, project: process.env.VERCEL_PROJECT_ID };
  process.env.SELF_VERCEL_TOKEN = TOKEN;
  process.env.VERCEL_PROJECT_ID = project.id;
  for (const [k, v] of Object.entries(env)) v === undefined ? delete process.env[k] : process.env[k] = v;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: new URL(url), init });
    const next = responses.shift();
    assert.notEqual(next, undefined, "unexpected request");
    if (typeof next === "function") return next(url, init);
    return next instanceof Response ? next : Response.json(next);
  };
  try { await run(calls); }
  finally {
    globalThis.fetch = saved.fetch;
    for (const [k, v] of [["SELF_VERCEL_TOKEN", saved.token], ["VERCEL_PROJECT_ID", saved.project]]) v === undefined ? delete process.env[k] : process.env[k] = v;
  }
}
const executeList = (input = {}) => deploymentsTool.execute(input, {});
const executeLog = (input = { deploymentId: detail.id }) => logTool.execute(input, {});

test("AC1: shared configuration setup is actionable, blank/missing config makes no requests", async () => {
  for (const token of [undefined, "", "   "]) await fixture(async (calls) => {
    for (const result of [await executeList(), await executeLog()]) {
      assert.equal(result.kind, "setup");
      assert.equal(result.message, "Deployment inspection is not configured. Ask the operator to set SELF_VERCEL_TOKEN to a Vercel token scoped to this project.");
    }
    assert.equal(calls.length, 0);
  }, [], { SELF_VERCEL_TOKEN: token });
  for (const id of [undefined, " ", "../project", "name"]) await fixture(async (calls) => {
    assert.equal((await executeList()).kind, "setup"); assert.equal(calls.length, 0);
  }, [], { VERCEL_PROJECT_ID: id });
});

test("AC2: fixed-origin GET, no team on lookup, derived team/project, changed configuration never reuses identity", async () => {
  for (const suffix of ["example", "second"]) await fixture(async (calls) => {
    const result = await executeList();
    assert.equal(result.ok, true); assert.equal(result.projectId, `prj_${suffix}`); assert.equal(result.teamId, `team_${suffix}`);
    assert.equal(calls[0].url.pathname, `/v9/projects/prj_${suffix}`); assert.equal(calls[0].url.search, "");
    assert.equal(calls[1].url.pathname, "/v7/deployments");
    assert.deepEqual(Object.fromEntries(calls[1].url.searchParams), { projectId: `prj_${suffix}`, teamId: `team_${suffix}`, limit: "5" });
    for (const { url, init } of calls) {
      assert.equal(url.origin, "https://api.vercel.com"); assert.equal(init.method, "GET"); assert.equal(init.redirect, "error");
      assert.equal(init.headers.Authorization, `Bearer ${TOKEN}-${suffix}`);
    }
    assert.equal(result.secretMetadata, undefined);
  }, [{ id: `prj_${suffix}`, accountId: `team_${suffix}`, secretMetadata: "hidden" }, { deployments: [] }], { VERCEL_PROJECT_ID: `prj_${suffix}`, SELF_VERCEL_TOKEN: `${TOKEN}-${suffix}` });
});

test("AC2: bad identity and redirects fail closed without subsequent reads", async () => {
  for (const value of [{ ...project, id: "prj_other" }, { id: project.id }, { ...project, accountId: "user_owner" }, null, []]) await fixture(async (calls) => {
    assert.equal((await executeList()).kind, "inspection"); assert.equal(calls.length, 1);
  }, [value]);
  await fixture(async (calls) => { assert.equal((await executeList()).ok, false); assert.equal(calls.length, 1); }, [new Response("private", { status: 302, headers: { Location: "https://foreign.test" } })]);
});

test("AC2–4: exported schemas reject extra properties and invalid parameters, helpers also reject before fetch", async () => {
  assert.equal(deploymentsTool.approval, undefined); assert.equal(logTool.approval, undefined);
  for (const input of [{ teamId: "team_other" }, { projectId: project.id }, { token: "x" }, { host: "x" }, { path: "x" }, { query: {} }, { limit: 0 }, { limit: 21 }, { limit: 1.5 }, { sha: "short" }]) {
    assert.equal(deploymentsTool.inputSchema.safeParse(input).success, false);
    await fixture(async (calls) => { assert.equal((await listDeployments(input)).kind, "input"); assert.equal(calls.length, 0); });
  }
  for (const input of [{ deploymentId: "https://example.test" }, { deploymentId: "dpl_x/../y" }, { deploymentId: "dpl_" }, { deploymentId: detail.id, limit: 201 }, { deploymentId: detail.id, limit: 0 }, { deploymentId: detail.id, limit: 1.5 }, { deploymentId: detail.id, teamId: "team_other" }]) {
    assert.equal(logTool.inputSchema.safeParse(input).success, false);
    await fixture(async (calls) => { assert.equal((await readBuildLog(input)).kind, "input"); assert.equal(calls.length, 0); });
  }
});

test("AC3: list preserves state/nulls, sorts newest, bounds count and reports pagination", async () => {
  const states = ["READY", "BUILDING", "ERROR", "CANCELED", "BLOCKED", "NEW_UNKNOWN"];
  await fixture(async () => {
    const r = await executeList({ limit: 5 });
    assert.equal(r.ok, true); assert.equal(r.possiblyMore, true); assert.equal(r.deployments.length, 5);
    assert.deepEqual(r.deployments.map((d) => d.state), states.slice(1).reverse());
    assert.equal(r.deployments[0].target, null); assert.equal(r.deployments[0].gitCommitSha, null);
    assert.equal(r.deployments[0].createdAt, 5);
    assert.deepEqual(Object.keys(r.deployments[0]), ["id", "url", "state", "target", "createdAt", "gitCommitSha"]);
  }, [project, { deployments: states.map((state, i) => deployment({ state, uid: `dpl_${i}`, created: i, ...(i === 5 ? { target: undefined, meta: undefined } : {}) })), pagination: { next: 2 } }]);
  await fixture(async () => assert.deepEqual((await executeList()).deployments, []), [project, { deployments: [] }]);
  for (const bad of [{ projectId: "prj_foreign" }, { project: { id: "prj_foreign" } }, { state: null }, { created: "bad" }]) await fixture(async () => assert.equal((await executeList()).ok, false), [project, { deployments: [deployment(bad)] }]);
});

test("AC3,7: ignored SHA filter cannot substitute newer B for A; newest exact A wins", async () => {
  const rows = [deployment({ uid: "dpl_newerB", created: 9, meta: { githubCommitSha: B } }), deployment(), deployment({ uid: "dpl_newA", created: 3 }), deployment({ meta: {} })];
  await fixture(async (calls) => {
    const r = await executeList({ sha: A, limit: 1 }); assert.equal(calls[1].url.searchParams.get("sha"), A);
    assert.deepEqual(r.deployments.map((d) => d.id), ["dpl_newA"]);
  }, [project, { deployments: rows }]);
  await fixture(async () => assert.deepEqual((await executeList({ sha: A })).deployments, []), [project, { deployments: [rows[0]] }]);
});

test("AC4: ownership verified on every invocation before events GET, foreign/missing/mismatched detail stops", async () => {
  for (const bad of [{ ...detail, projectId: "prj_foreign" }, { id: detail.id }, { ...detail, id: "dpl_other" }, {}]) await fixture(async (calls) => {
    assert.equal((await executeLog()).kind, "inspection"); assert.equal(calls.length, 2);
  }, [project, bad]);
  await fixture(async (calls) => {
    for (let i = 0; i < 2; i++) assert.equal((await executeLog()).ok, true);
    assert.deepEqual(calls.map((c) => c.url.pathname), Array(2).fill([`/v9/projects/${project.id}`, `/v13/deployments/${detail.id}`, `/v3/deployments/${detail.id}/events`]).flat());
    assert.deepEqual(Object.fromEntries(calls[2].url.searchParams), { teamId: project.accountId, builds: "1", follow: "0", direction: "backward", limit: "100" });
  }, [project, detail, [], project, detail, []]);
});

test("AC4: actual chronological text/type/time, empty logs and provider-limit signal", async () => {
  await fixture(async () => {
    const r = await executeLog({ deploymentId: detail.id, limit: 2 });
    assert.deepEqual(r.events, [{ timestamp: 1, type: "stdout", text: "first\nline" }, { timestamp: 2, type: "stderr", text: "last" }]);
    assert.equal(r.truncated, false); assert.equal(r.possiblyMore, true); assert.equal(r.untrustedContent, true);
  }, [project, detail, [{ created: 2, type: "stderr", text: "last" }, { created: 1, type: "stdout", text: "first\nline" }]]);
  await fixture(async () => { const r = await executeLog(); assert.deepEqual(r.events, []); assert.equal(r.possiblyMore, false); }, [project, detail, []]);
});

test("AC4–5: local event and UTF-8 tail caps cover multibyte, multiline and single oversized events", async () => {
  for (const rows of [Array.from({ length: 205 }, (_, i) => ({ created: 205 - i, text: "line\n" })), [{ created: 1, text: "🦊\n".repeat(14000) }], Array.from({ length: 200 }, (_, i) => ({ created: 200 - i, text: "é".repeat(300) }))]) await fixture(async () => {
    const r = await executeLog({ deploymentId: detail.id, limit: 200 });
    assert.equal(r.ok, true); assert.equal(r.truncated, true); assert.ok(r.events.length <= 200);
    assert.ok(r.events.reduce((n, e) => n + Buffer.byteLength(e.text), 0) <= 32768);
    assert.equal(r.events.some((e) => e.text.includes("�")), false);
    assert.ok(r.events.every((e, i, all) => !i || e.timestamp >= all[i - 1].timestamp));
  }, [project, detail, rows]);
});

for (const [status, kind] of [[401, "auth"], [403, "permission"], [404, "not_found"], [410, "unavailable"], [429, "rate_limit"], [500, "temporary"]]) test(`AC5: HTTP ${status} maps safely at every request stage`, async () => {
  for (const stage of [0, 1, 2]) await fixture(async (calls) => {
    const r = await executeLog(); assert.equal(r.kind, kind); assert.equal(r.ok, false); assert.equal(calls.length, stage + 1);
    assert.doesNotMatch(JSON.stringify(r), /raw-secret|synthetic-private-credential/);
  }, [...[project, detail].slice(0, stage), new Response(`raw-secret ${TOKEN}`, { status })]);
});

test("AC4–5: malformed/incomplete JSON, invalid UTF-8, network exceptions and oversized chunked body are errors", async () => {
  let canceled = false;
  const stream = new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(600000)); }, cancel() { canceled = true; } });
  for (const response of [new Response('{"id":'), new Response(new Uint8Array([0xff])), () => { throw Error(`raw-secret ${TOKEN}`); }, new Response(stream)]) await fixture(async () => {
    const r = await executeList(); assert.equal(r.ok, false); assert.doesNotMatch(JSON.stringify(r), /raw-secret|synthetic-private-credential/);
  }, [response]);
  assert.equal(canceled, true);
  await fixture(async () => assert.equal((await executeLog()).kind, "inspection"), [project, detail, { text: "not an events array" }]);
});

test("AC4: 10-second deadline includes slow body consumption and cancels it", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let canceled = false, signal;
  try {
    await fixture(async () => {
      const pending = executeList();
      for (let i = 0; i < 10; i++) await Promise.resolve();
      t.mock.timers.tick(10000);
      const r = await pending; assert.equal(r.kind, "temporary"); assert.match(r.message, /timed out/); assert.equal(canceled, true); assert.equal(signal.aborted, true);
    }, [(_url, init) => { signal = init.signal; return new Response(new ReadableStream({ pull() {}, cancel() { canceled = true; } })); }]);
    await fixture(async () => {
      const pending = executeList(); t.mock.timers.tick(10000); assert.equal((await pending).kind, "temporary");
    }, [() => new Promise(() => {})]);
  } finally { t.mock.timers.reset(); }
});

test("AC5: exact credential echo redacted in projected provider fields and log text", async () => {
  await fixture(async () => {
    const r = await executeList(); assert.equal(r.ok, true); assert.doesNotMatch(JSON.stringify(r), new RegExp(TOKEN)); assert.match(r.deployments[0].url, /REDACTED/);
  }, [project, { deployments: [deployment({ url: TOKEN })] }]);
  await fixture(async () => {
    const r = await executeLog(); assert.equal(r.ok, true); assert.equal(r.events[0].text, "echo [REDACTED]");
  }, [project, detail, [{ text: `echo ${TOKEN}` }]]);
});

test("AC6: all new paths reject add/edit/delete; literal credential forms rejected in ts/mts/tsx", () => {
  for (const path of ["agent/lib/self/vercel.ts", "agent/tools/self_deployments.ts", "agent/tools/self_build_log.ts"]) {
    assert.equal(checkPath(path).ok, false);
    for (const change of [{ path, content: "export const x = 1;" }, { path, delete: true }]) assert.match(checkChanges([change]).join("\n"), /protected/);
  }
  for (const ext of ["ts", "mts", "tsx"]) for (const content of ["process.env.SELF_VERCEL_TOKEN;", "process.env['SELF_VERCEL_TOKEN'];", "const { SELF_VERCEL_TOKEN } = process.env;", "const key = 'SELF_VERCEL_TOKEN';"]) {
    assert.match(checkChanges([{ path: `agent/tools/ordinary.${ext}`, content }]).join("\n"), /deployment inspection credential/);
  }
  assert.deepEqual(checkChanges([{ path: "agent/tools/ordinary.ts", content: "export const x = 1;" }]), []);
});

test("AC7 source guidance retains exact SHA, three checks, honest pending/cannot-inspect and approved ERROR rollback", async () => {
  const skill = await readFile(new URL("../agent/skills/self-modify/SKILL.md", import.meta.url), "utf8");
  const commit = await readFile(new URL("../agent/tools/self_commit.ts", import.meta.url), "utf8");
  for (const source of [skill, commit]) {
    for (const pattern of [/self_deployments/, /exact full/, /three checks/, /two retries/, /transient failures/, /READY/, /ERROR/, /CANCELED/, /BLOCKED/, /pending verification/, /cannot inspect/, /self_build_log/, /human approval/, /[Ss]kill-only/]) assert.match(source, pattern);
    assert.doesNotMatch(source, /Vercel connection/);
  }
});
