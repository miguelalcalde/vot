import { defineTool } from "eve/tools";
import { toolRepo } from "../lib/self/auth";
import { z } from "zod";
import { always } from "eve/tools/approval";
import { selfWriteResponse, requester } from "../lib/self/approval";
import { SELF_BRANCH, requireSelfRepo } from "../lib/self/config";
import { commitToMain, compare, getBlobText, getHeadSha, getTree, type TreeChange } from "../lib/self/github";
import { checkChangeSet, checkPath, type FileChange } from "../lib/self/policy";

const MAX_FILES = 300;

export default defineTool({
  description:
    `Roll eligible behavior Markdown back to an earlier commit on ${SELF_BRANCH}, as a new commit (history is never rewritten). Current content policy is rechecked; newly nonwritable architecture paths are skipped, invalid Markdown restores are rejected atomically. A human must approve. Use this when a behavior change broke something; find targetSha with self_history.`,
  inputSchema: z.object({
    targetSha: z.string().regex(/^[0-9a-f]{40}$/),
    baseSha: z.string().regex(/^[0-9a-f]{40}$/).describe("Current headSha from self_history."),
    reason: z.string().min(10).max(300),
  }),
  label: { start: ({ targetSha }) => `Roll back to ${targetSha.slice(0, 7)}` },
  approval: { request: always(), response: selfWriteResponse },
  async execute({ targetSha, baseSha, reason }, ctx) {
    const repo = requireSelfRepo();
    const authed = await toolRepo(ctx, repo);
    const head = await getHeadSha(authed);
    if (head !== baseSha) throw new Error(`main is at ${head}, not ${baseSha}. Check self_history and retry.`);
    if (targetSha === head) throw new Error("targetSha is already the head of main.");

    // targetSha must be a recent ancestor of main.
    const diff = await compare(authed, targetSha, head);
    if (diff.status !== "ahead") throw new Error(`${targetSha} is not an ancestor of ${SELF_BRANCH}.`);
    // GitHub's compare API lists at most 300 files; refuse rather than half-revert.
    if (diff.files.length >= MAX_FILES) throw new Error("Too many changes since that commit to roll back safely.");

    const targetTree = new Map(
      (await getTree(authed, targetSha)).filter((e) => e.type === "blob").map((e) => [e.path, e.sha]),
    );

    const changes: TreeChange[] = [];
    const skipped: string[] = [];
    const planned = new Map<string, TreeChange>();
    const restore = async (path: string) => {
      if (!checkPath(path).ok) return skipped.push(path);
      const sha = targetTree.get(path);
      planned.set(path, sha ? { path, blobSha: sha } : { path, delete: true });
    };
    for (const file of diff.files) {
      await restore(file.filename);
      if (file.previous_filename) await restore(file.previous_filename);
    }
    changes.push(...planned.values());
    if (changes.length === 0) throw new Error("Nothing writable changed since that commit.");

    const currentTree = await getTree(authed, head);
    const currentPaths = currentTree.filter((e) => e.type === "blob").map((e) => e.path);
    const validationChanges: FileChange[] = [];
    for (const change of changes) {
      if ("delete" in change) validationChanges.push(change);
      else if ("blobSha" in change) validationChanges.push({ path: change.path, content: await getBlobText(authed, change.blobSha) });
      else validationChanges.push(change);
    }
    const problems = checkChangeSet(validationChanges, currentPaths);
    if (problems.length) throw new Error(`Rollback rejected by current self-modification policy:\n- ${problems.join("\n- ")}`);

    const message =
      `agent: roll back to ${targetSha.slice(0, 7)}\n\n${reason.trim()}\n\n` +
      `Eve-Session: ${ctx.session.id}\nEve-Requested-By: ${requester(ctx.session)}\n`;
    const commit = await commitToMain(authed, head, changes, message);
    return { committed: commit.sha, url: commit.url, restored: changes.map((c) => c.path), skippedNonwritable: [...new Set(skipped)] };
  },
});
