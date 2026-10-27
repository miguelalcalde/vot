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
import { getBlobText, getHeadSha, getTree } from "../lib/self/github";
import { parseFrontmatter } from "../lib/self/policy";

const ROOT = "agent/skills/";
const SKILL_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MAX_SIBLING_BYTES = 64 * 1024;
const TEXT_FILE = /\.(md|txt|json|ya?ml|csv|sh|py|ts|js)$/;

let cached: { sha: string; skills: Record<string, SkillDefinition> } | null = null;
const blobs = new Map<string, string>();

function enabled(): boolean {
  const flag = process.env.SELF_LIVE_SKILLS;
  if (flag === "0") return false;
  if (flag === "1") return true;
  return Boolean(process.env.VERCEL_ENV);
}

async function loadLiveSkills(): Promise<Record<string, SkillDefinition> | null> {
  const repo = resolveSelfRepo();
  if (!repo) return null;
  const signal = AbortSignal.timeout(5_000);

  const sha = await getHeadSha(repo, signal);
  if (cached?.sha === sha) return cached.skills;

  const entries = (await getTree(repo, sha, signal)).filter((e) => e.type === "blob" && e.path.startsWith(ROOT));
  const text = async (blobSha: string) => {
    let value = blobs.get(blobSha);
    if (value === undefined) {
      value = await getBlobText(repo, blobSha, signal);
      blobs.set(blobSha, value);
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

  cached = { sha, skills };
  return skills;
}

export default defineDynamic({
  events: {
    "turn.started": async () => {
      if (!enabled()) return null;
      try {
        return await loadLiveSkills();
      } catch (error) {
        console.warn("[live skills] falling back to deployed skills:", (error as Error).message);
        return cached?.skills ?? null;
      }
    },
  },
});
