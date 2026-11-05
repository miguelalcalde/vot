import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Exercise the installed provider's lazy backend selection with only the Blob
// backend factory doubled. No SDK/provider request can leave this process.
test("installed memory preserves backend precedence, local process storage and 8,000-character bound", () => {
  const script = `
    import { mock } from 'node:test';
    import assert from 'node:assert/strict';
    import { fileURLToPath } from 'node:url';
    const memoryUrl = import.meta.resolve('eve/memory/file');
    const backendUrl = new URL('./backends/vercel-blob.js', memoryUrl);
    const selected = [];
    let reads = 0;
    mock.module(fileURLToPath(backendUrl), { namedExports: {
      vercelBlob: (options) => {
        selected.push(options);
        return { read: async () => { reads++; return null; }, write: async () => { throw Error('unexpected Blob write'); } };
      }
    }});
    const { fileMemory } = await import('eve/memory/file');
    const keys = ['EVE_MEMORY_BLOB_STORE_ID', 'EVE_MEMORY_BLOB_READ_WRITE_TOKEN', 'BLOB_STORE_ID', 'BLOB_READ_WRITE_TOKEN'];
    const ctx = { abortSignal: new AbortController().signal, memory: { scope: { key: 'fixture' }, slot: 'memory' } };
    globalThis.fetch = () => { throw Error('network forbidden'); };
    delete process.env.VERCEL_OIDC_TOKEN;
    process.env.VERCEL = '1';
    for (let mask = 1; mask < 16; mask++) {
      keys.forEach((key, i) => { delete process.env[key]; if (mask & (1 << i)) process.env[key] = ' value-' + i + ' '; });
      const provider = fileMemory({ maxCharacters: 8000 });
      await provider.recall['turn.started'](ctx);
      const first = keys.findIndex((_, i) => mask & (1 << i));
      assert.deepEqual(selected.at(-1), first % 2 === 0 ? { storeId: 'value-' + first } : { token: 'value-' + first });
      assert.deepEqual(Object.keys(await provider.tools(ctx)).sort(), ['remove_memory', 'save_memory']);
    }
    assert.equal(reads, 15);
    delete process.env.VERCEL;
    keys.forEach(key => delete process.env[key]);
    process.env.EVE_DEV = '1';
    const provider = fileMemory({ maxCharacters: 8000 });
    const tools = await provider.tools(ctx);
    for (let i = 0; i < 3; i++) await tools.save_memory.execute({ text: String(i) + 'x'.repeat(1990) }, ctx);
    const recalled = await fileMemory().recall['turn.started'](ctx);
    assert.match(recalled.messages[0].content, /0xxx/);
    assert.ok(recalled.messages[0].content.length < 8000);
    await assert.rejects(tools.save_memory.execute({ text: 'fourth' + 'y'.repeat(1990) }, ctx), /8,000-character limit/);
    delete process.env.EVE_DEV;
    await assert.rejects(fileMemory().recall['turn.started'](ctx), /explicit backend outside Vercel and eve dev/);
    assert.equal(reads, 15);
  `;
  const result = spawnSync(process.execPath, ["--experimental-test-module-mocks", "--input-type=module", "-e", script], {
    cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
