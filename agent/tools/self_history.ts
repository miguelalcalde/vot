import { defineTool } from "eve/tools";
import { z } from "zod";
import { SELF_BRANCH, deployedSha, requireSelfRepo } from "../lib/self/config";
import { listCommits } from "../lib/self/github";
import { LIMITS, PROTECTED, WRITABLE } from "../lib/self/policy";

export default defineTool({
  description:
    `Show recent commits on your own ${SELF_BRANCH} branch, the commit you are currently running ` +
    "(deployedSha), and the rules that limit what you may change about yourself.",
  inputSchema: z.object({ limit: z.number().int().min(1).max(30).default(10) }),
  label: { start: () => "Check own history" },
  async execute({ limit }) {
    const repo = requireSelfRepo();
    const commits = await listCommits(repo, limit);
    const running = deployedSha();
    return {
      repo: `${repo.owner}/${repo.name}`,
      branch: SELF_BRANCH,
      headSha: commits[0]?.sha ?? null,
      deployedSha: running,
      deployedIsHead: running !== null && running === commits[0]?.sha,
      commits: commits.map((c) => ({ ...c, message: c.message.split("\n")[0] })),
      policy: { writable: WRITABLE, protected: PROTECTED, limits: LIMITS },
    };
  },
});
