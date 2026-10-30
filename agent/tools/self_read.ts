import { defineTool } from "eve/tools";
import { toolRepo } from "../lib/self/auth";
import { z } from "zod";
import { SELF_BRANCH, requireSelfRepo } from "../lib/self/config";
import { getBlobText, getHeadSha, getTree } from "../lib/self/github";
import { checkPath } from "../lib/self/policy";

export default defineTool({
  description:
    `Read your own source code from GitHub (${SELF_BRANCH} branch). Pass a file path to get its content, ` +
    "or a directory path (or nothing) to list files under it. Always returns headSha: pass it as baseSha " +
    "to self_commit so you never overwrite a change you did not see.",
  inputSchema: z.object({
    path: z.string().default("agent").describe('Repo-relative path, e.g. "agent/skills" or "agent/instructions.md".'),
  }),
  label: { start: ({ path }) => `Read ${path}` },
  async execute({ path }, ctx) {
    const repo = requireSelfRepo();
    const authed = await toolRepo(ctx, repo);
    const clean = path.replace(/^\/+|\/+$/g, "");
    const headSha = await getHeadSha(authed);
    const tree = await getTree(authed, headSha);

    const file = tree.find((e) => e.type === "blob" && e.path === clean);
    if (file) {
      return {
        headSha,
        path: clean,
        type: "file" as const,
        writable: checkPath(clean).ok,
        content: await getBlobText(authed, file.sha),
      };
    }

    const prefix = clean === "" ? "" : `${clean}/`;
    const files = tree
      .filter((e) => e.type === "blob" && e.path.startsWith(prefix))
      .map((e) => ({ path: e.path, size: e.size ?? 0, writable: checkPath(e.path).ok }));
    if (files.length === 0) throw new Error(`No file or directory at "${clean}" on ${SELF_BRANCH}.`);
    return { headSha, path: clean, type: "directory" as const, files: files.slice(0, 300) };
  },
});
