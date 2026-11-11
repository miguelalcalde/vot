import { defineTool } from "eve/tools";
import { toolRepo } from "../lib/self/auth";
import { z } from "zod";
import { always } from "eve/tools/approval";
import { selfWriteResponse, requester } from "../lib/self/approval";
import { SELF_BRANCH, requireSelfRepo } from "../lib/self/config";
import { commitToMain, getHeadSha, getTree } from "../lib/self/github";
import { LIMITS, checkChanges, checkResultingTree, type FileChange } from "../lib/self/policy";

const fileChange = z.union([
  z.object({
    path: z.string().min(1),
    content: z.string().describe("The complete new file content (not a diff)."),
  }),
  z.object({ path: z.string().min(1), delete: z.literal(true) }),
]);

export default defineTool({
  description:
    `Commit behavior-only Markdown to your own repository on ${SELF_BRANCH}. Only agent/instructions.md and eligible skill Markdown are writable; capabilities, integrations, architecture and runtime schedules are owner-controlled. A human must approve every call. ` +
    "Skill changes apply on your next turn; identity changes apply after deployment. " +
    "Provide full file contents. baseSha must be the headSha you read; if main has moved, read again. " +
    `Max ${LIMITS.maxFiles} files. Load the self-modify skill before using this.`,
  inputSchema: z.object({
    baseSha: z.string().regex(/^[0-9a-f]{40}$/, "Use the 40-character headSha from self_read."),
    message: z.string().min(10).max(LIMITS.maxMessageChars).describe("What changed and why, imperative mood."),
    files: z.array(fileChange).min(1).max(LIMITS.maxFiles),
  }),
  label: { start: ({ files }) => `Commit ${files.length} file(s) to ${SELF_BRANCH}` },
  approval: { request: always(), response: selfWriteResponse },
  async execute({ baseSha, message, files }, ctx) {
    // Validate before touching GitHub. Approval does not bypass policy.
    const preliminaryProblems = checkChanges(files as FileChange[]);
    if (preliminaryProblems.length > 0) {
      throw new Error(`Rejected by self-modification policy:\n- ${preliminaryProblems.join("\n- ")}`);
    }
    const repo = requireSelfRepo();
    const authed = await toolRepo(ctx, repo);
    const head = await getHeadSha(authed);
    if (head !== baseSha) throw new Error(`main is at ${head}, not ${baseSha}. Re-read the files before retrying.`);
    const currentTree = await getTree(authed, head);
    const problems = checkResultingTree(files as FileChange[], currentTree.filter((e) => e.type === "blob").map((e) => e.path));
    if (problems.length > 0) {
      throw new Error(`Rejected by self-modification policy:\n- ${problems.join("\n- ")}`);
    }

    const fullMessage =
      `agent: ${message.trim()}\n\n` + `Eve-Session: ${ctx.session.id}\n` + `Eve-Requested-By: ${requester(ctx.session)}\n`;
    const commit = await commitToMain(authed, baseSha, files, fullMessage);
    return {
      committed: commit.sha,
      url: commit.url,
      files: files.map((f) => ("delete" in f ? `deleted ${f.path}` : f.path)),
      next:
        "Skills under agent/skills apply on your next turn. Anything else applies once Vercel deploys this commit; " +
        "call self_deployments with sha equal to the exact full committed SHA. At most three checks " +
        "(initial plus two retries, including transient failures); stop early on READY, ERROR/CANCELED/BLOCKED " +
        "or setup/auth/permission failure. Only exact SHA matches count; report the newest match and target. " +
        "READY proves readiness, not live production aliases. Recheck missing/pending within the bound, then " +
        "report committed SHA and pending verification. On access/transport failure say cannot inspect with " +
        "the reason. Never substitute an unrelated commit or revert because inspection failed or results " +
        "are absent. For an observed ERROR inspect self_build_log, then follow self_revert guidance with " +
        "human approval. Report canceled/blocked as such. Skill-only changes need no deployment check.",
    };
  },
});
