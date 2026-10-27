import { defineTool } from "eve/tools";
import { z } from "zod";
import { selfWriteApproval, requester } from "../lib/self/approval";
import { SELF_BRANCH, requireSelfRepo } from "../lib/self/config";
import { commitToMain, getHeadSha } from "../lib/self/github";
import { LIMITS, checkChanges, type FileChange } from "../lib/self/policy";

const fileChange = z.union([
  z.object({
    path: z.string().min(1),
    content: z.string().describe("The complete new file content (not a diff)."),
  }),
  z.object({ path: z.string().min(1), delete: z.literal(true) }),
]);

export default defineTool({
  description:
    `Commit a change to your own source on ${SELF_BRANCH}. A human must approve every call. ` +
    "Skill changes apply on your next turn; code changes apply after Vercel finishes the deploy. " +
    "Provide full file contents. baseSha must be the headSha you read; if main has moved, read again. " +
    `Max ${LIMITS.maxFiles} files. Load the self-modify skill before using this.`,
  inputSchema: z.object({
    baseSha: z.string().regex(/^[0-9a-f]{40}$/, "Use the 40-character headSha from self_read."),
    message: z.string().min(10).max(LIMITS.maxMessageChars).describe("What changed and why, imperative mood."),
    files: z.array(fileChange).min(1).max(LIMITS.maxFiles),
  }),
  label: { start: ({ files }) => `Commit ${files.length} file(s) to ${SELF_BRANCH}` },
  approval: selfWriteApproval,
  async execute({ baseSha, message, files }, ctx) {
    // Validate before touching GitHub. Approval does not bypass policy.
    const problems = checkChanges(files as FileChange[]);
    if (problems.length > 0) {
      throw new Error(`Rejected by self-modification policy:\n- ${problems.join("\n- ")}`);
    }

    const repo = requireSelfRepo();
    const head = await getHeadSha(repo);
    if (head !== baseSha) {
      throw new Error(
        `main is at ${head}, not ${baseSha}. Someone (maybe you, in a replayed step) changed it. ` +
          "Re-read the files and check self_history before retrying.",
      );
    }

    const fullMessage =
      `agent: ${message.trim()}\n\n` + `Eve-Session: ${ctx.session.id}\n` + `Eve-Requested-By: ${requester(ctx.session)}\n`;
    const commit = await commitToMain(repo, baseSha, files, fullMessage);
    return {
      committed: commit.sha,
      url: commit.url,
      files: files.map((f) => ("delete" in f ? `deleted ${f.path}` : f.path)),
      next:
        "Skills under agent/skills apply on your next turn. Anything else applies once Vercel deploys this commit; " +
        "check the deployment through the Vercel connection and self_revert if it fails.",
    };
  },
});
