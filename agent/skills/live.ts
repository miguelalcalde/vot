/**
 * Live skills: on every turn, load agent/skills/ from the tip of main on GitHub
 * so a committed skill applies on the next turn without waiting for a deploy.
 *
 * - Flat skills: agent/skills/<name>.md
 * - Packaged skills: agent/skills/<name>/SKILL.md (+ sibling text files)
 *
 * A live skill overrides the deployed skill with the same name. If GitHub is
 * unreachable or self-modification is not configured, this returns nothing and
 * the deployed (compiled) skills are used. In `eve dev`, local files already
 * hot-reload, so live loading is off unless SELF_LIVE_SKILLS=1.
 *
 * This file is protected: the agent cannot change it through self_commit.
 */
import { defineDynamic, defineSkill, type SkillDefinition } from "eve/skills";
import { resolveSelfRepo } from "../lib/self/config";
import { selfAuthRepo } from "../lib/self/auth";
import { getBlobText, getHeadSha, getTree } from "../lib/self/github";
import { parseFrontmatter } from "../lib/self/policy";

const ROOT = "agent/skills/";
const SKILL_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MAX_SIBLING_BYTES = 64 * 1024;
const TEXT_FILE = /\.(md|txt|json|ya?ml|csv|sh|py|ts|js)$/;

let cached: { repo: string; sha: string; skills: Record<string, SkillDefinition> } | null = null;
const blobs = new Map<string, string>();

function enabled(): boolean {
  const flag = process.env.SELF_LIVE_SKILLS;
  if (flag === "0") return false;
  if (flag === "1") return true;
  return Boolean(process.env.VERCEL_ENV);
}

export async function loadLiveSkills(deps: {
  repo?: ReturnType<typeof resolveSelfRepo>;
  resolveRepo?: typeof resolveSelfRepo;
  getAuthRepo?: typeof selfAuthRepo;
  head?: typeof getHeadSha;
  tree?: typeof getTree;
  blob?: typeof getBlobText;
  now?: () => number;
} = {}, budgetMs = 5_000): Promise<Record<string, SkillDefinition> | null> {
  const resolveRepo = deps.resolveRepo ?? resolveSelfRepo;
  const repo = deps.repo === undefined ? resolveRepo() : deps.repo;
  if (!repo) return null;
  const now = deps.now ?? Date.now;
  const getAuthRepo = deps.getAuthRepo ?? selfAuthRepo;
  const headRequest = deps.head ?? getHeadSha;
  const treeRequest = deps.tree ?? getTree;
  const blobRequest = deps.blob ?? getBlobText;
  const key = `${repo.owner}/${repo.name}`;
  const deadline = now() + budgetMs;
  const authed = await getAuthRepo(repo);
  if (now() >= deadline) throw new Error("Live skill loading timed out.");
  const signal = AbortSignal.timeout(Math.max(1, deadline - now()));
  const ensureTime = () => { if (now() >= deadline || signal.aborted) throw new Error("Live skill loading timed out."); };

  const sha = await headRequest(authed, signal);
  ensureTime();
  if (cached?.repo === key && cached.sha === sha) return cached.skills;

  const entries = (await treeRequest(authed, sha, signal)).filter((e) => e.type === "blob" && e.path.startsWith(ROOT));
  ensureTime();
  const pendingBlobs = new Map<string, string>();
  const text = async (blobSha: string) => {
    let value = blobs.get(blobSha);
    if (value === undefined) {
      ensureTime();
      value = await blobRequest(authed, blobSha, signal);
      ensureTime();
      pendingBlobs.set(blobSha, value);
    }
    return value;
  };

  const skills: Record<string, SkillDefinition> = {};
  for (const entry of entries) {
    const rest = entry.path.slice(ROOT.length);
    const parts = rest.split("/");

    if (parts.length === 1 && rest.endsWith(".md")) {
      const name = rest.slice(0, -3);
      if (!SKILL_NAME.test(name)) continue;
      const { description, body } = parseFrontmatter(await text(entry.sha));
      const fallback = body.split("\n").find((l) => l.trim() && !l.startsWith("```"));
      skills[name] = defineSkill({
        description: description ?? fallback?.replace(/^[#>*\-\s]+/, "").trim() ?? `Instructions for ${name}.`,
        markdown: body,
      });
      continue;
    }

    if (parts.length === 2 && parts[1] === "SKILL.md") {
      const name = parts[0]!;
      if (!SKILL_NAME.test(name)) continue;
      const { description, body } = parseFrontmatter(await text(entry.sha));
      if (!description) continue;
      const files: Record<string, string> = {};
      for (const sibling of entries) {
        const rel = sibling.path.slice(`${ROOT}${name}/`.length);
        if (!sibling.path.startsWith(`${ROOT}${name}/`) || rel === "SKILL.md") continue;
        if (!TEXT_FILE.test(rel) || (sibling.size ?? 0) > MAX_SIBLING_BYTES) continue;
        files[rel] = await text(sibling.sha);
      }
      skills[name] = defineSkill({ description, markdown: body, files });
    }
  }

  if (now() > deadline) throw new Error("Live skill loading timed out.");
  for (const [blobSha, value] of pendingBlobs) blobs.set(blobSha, value);
  cached = { repo: key, sha, skills };
  return skills;
}

export async function boundedLoadLiveSkills(deps: Parameters<typeof loadLiveSkills>[0] = {}, budgetMs = 5_000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      loadLiveSkills(deps, budgetMs),
      new Promise<null>((_, reject) => { timer = setTimeout(() => reject(new Error("Live skill loading timed out.")), budgetMs); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

export function resetLiveSkillCacheForTests() { cached = null; blobs.clear(); }

export async function resilientLoadLiveSkills(deps: Parameters<typeof loadLiveSkills>[0] = {}, budgetMs = 5_000) {
  const repo = deps.repo === undefined ? (deps.resolveRepo ?? resolveSelfRepo)() : deps.repo;
  try { return await boundedLoadLiveSkills({ ...deps, repo }, budgetMs); }
  catch {
    return repo && cached?.repo === `${repo.owner}/${repo.name}` ? cached.skills : null;
  }
}

export async function resolveLiveSkillsForTurn(shouldLoad: boolean, loader = resilientLoadLiveSkills) {
  if (!shouldLoad) return null;
  try { return await loader(); }
  catch {
    const repo = resolveSelfRepo();
    return repo && cached?.repo === `${repo.owner}/${repo.name}` ? cached.skills : null;
  }
}

export default defineDynamic({
  events: {
    "turn.started": async () => {
      if (!enabled()) return null;
      try {
        return await resolveLiveSkillsForTurn(true);
      } catch (error) {
        const repo = resolveSelfRepo();
        console.warn("[live skills] falling back to deployed skills: authorization or loading failure");
        return repo && cached?.repo === `${repo.owner}/${repo.name}` ? cached.skills : null;
      }
    },
  },
});
