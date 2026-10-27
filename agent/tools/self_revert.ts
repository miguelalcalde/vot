import { defineTool } from "eve/tools";
import { z } from "zod";
import { selfWriteApproval, requester } from "../lib/self/approval";
import { SELF_BRANCH, requireSelfRepo } from "../lib/self/config";
import { commitToMain, compare, getHeadSha, getTree, type TreeChange } from "../lib/self/github";
import { checkPath } from "../lib/self/policy";

const MAX_FILES = 300;

export default defineTool({
  description:
    `Roll your writable files back to how they were at an earlier commit on ${SELF_BRANCH}, as a new commit ` +
    "(history is never rewritten). Protected files are left alone. A human must approve. Use this when a change " +
    "you made broke a deploy or a behavior. Find targetSha with self_history.",
  inputSchema: z.object({
    targetSha: z.string().regex(/^[0-9a-f]{40}$/),
    baseSha: z.string().regex(/^[0-9a-f]{40}$/).describe("Current headSha from self_history."),
    reason: z.string().min(10).max(300),
  }),
  label: { start: ({ targetSha }) => `Roll back to ${targetSha.slice(0, 7)}` },
  approval: selfWriteApproval,
  async execute({ targetSha, baseSha, reason }, ctx) {
    const repo = requireSelfRepo();
    const head = await getHeadSha(repo);
    if (head !== baseSha) throw new Error(`main is at ${head}, not ${baseSha}. Check self_history and retry.`);
    if (targetSha === head) throw new Error("targetSha is already the head of main.");

    // targetSha must be a recent ancestor of main.
    const diff = await compare(repo, targetSha, head);
    if (diff.status !== "ahead") throw new Error(`${targetSha} is not an ancestor of ${SELF_BRANCH}.`);
    // GitHub's compare API lists at most 300 files; refuse rather than half-revert.
    if (diff.files.length >= MAX_FILES) throw new Error("Too many changes since that commit to roll back safely.");

    const targetTree = new Map(
      (await getTree(repo, targetSha)).filter((e) => e.type === "blob").map((e) => [e.path, e.sha]),
    );

    const changes: TreeChange[] = [];
    const skipped: string[] = [];
    const restore = (path: string) => {
      if (!checkPath(path).ok) return skipped.push(path);
      const sha = targetTree.get(path);
      changes.push(sha ? { path, blobSha: sha } : { path, delete: true });
    };
    for (const file of diff.files) {
      restore(file.filename);
      if (file.previous_filename) restore(file.previous_filename);
    }
    if (changes.length === 0) throw new Error("Nothing writable changed since that commit.");

    const message =
      `agent: roll back to ${targetSha.slice(0, 7)}\n\n${reason.trim()}\n\n` +
      `Eve-Session: ${ctx.session.id}\nEve-Requested-By: ${requester(ctx.session)}\n`;
    const commit = await commitToMain(repo, head, changes, message);
    return { committed: commit.sha, url: commit.url, restored: changes.map((c) => c.path), skippedProtected: skipped };
  },
});
