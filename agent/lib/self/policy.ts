/**
 * What the agent may change about itself, enforced in code before anything
 * reaches GitHub. The model cannot widen these rules: this file, the GitHub
 * client, the self_* tools, and the self-modify skill are all protected.
 *
 * Defense in depth, outermost first:
 *   1. The GitHub token is scoped to this one repo, without Workflows access.
 *   2. Every write needs human approval (optionally from SELF_APPROVERS only).
 *   3. This policy: path allowlist, protected paths, size and content checks.
 *   4. Commits are fast-forward only on main, never forced.
 *   5. Vercel only promotes a deployment whose build succeeds, so a broken
 *      code change leaves the previous production deployment serving.
 */
import { stripTypeScriptTypes } from "node:module";

/** Paths the agent may create, edit, or delete. Prefixes end with "/". */
export const WRITABLE = [
  "agent/instructions.md",
  "agent/skills/",
  "agent/tools/",
  "agent/lib/",
  "agent/channels/",
  "agent/connections/",
  "agent/schedules/",
  "agent/subagents/",
  "README.md",
] as const;

/** Paths inside WRITABLE that stay human-only. These win over WRITABLE. */
export const PROTECTED = [
  "agent/lib/self/",
  "agent/tools/self_",
  "agent/skills/live.ts",
  "agent/skills/self-modify/",
  "agent/channels/eve.ts",
] as const;

export const LIMITS = {
  maxFiles: 10,
  maxFileBytes: 64 * 1024,
  maxTotalBytes: 256 * 1024,
  maxMessageChars: 500,
} as const;

const SAFE_PATH = /^[A-Za-z0-9._\-/]+$/;

const SECRET_PATTERNS: readonly [string, RegExp][] = [
  ["GitHub token", /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["OpenAI/Anthropic key", /\bsk-(ant-)?[A-Za-z0-9_-]{20,}/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Vercel token", /\bvc[pk]_[A-Za-z0-9]{20,}/],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];

/**
 * Code the agent writes must not reach for the credential or client that
 * powers self-modification; otherwise a new tool could bypass this policy.
 */
const FORBIDDEN_IN_CODE: readonly [string, RegExp][] = [
  ["the GitHub token", /GITHUB_TOKEN/],
  ["the GitHub API", /api\.github\.com/],
  ["the self-modification internals", /lib\/self\b/],
];

export type PathVerdict = { ok: true } | { ok: false; reason: string };

export function checkPath(path: string): PathVerdict {
  if (!SAFE_PATH.test(path)) return { ok: false, reason: "contains characters outside [A-Za-z0-9._-/]" };
  if (path.startsWith("/") || path.endsWith("/")) return { ok: false, reason: "must be a relative file path" };
  if (path.split("/").some((part) => part === "" || part === "." || part === "..")) {
    return { ok: false, reason: "must not contain empty, '.' or '..' segments" };
  }
  if (PROTECTED.some((p) => (p.endsWith("/") || p.endsWith("_") ? path.startsWith(p) : path === p))) {
    return { ok: false, reason: "is protected; only a human can change it" };
  }
  if (!WRITABLE.some((p) => (p.endsWith("/") ? path.startsWith(p) : path === p))) {
    return { ok: false, reason: `is outside the writable paths (${WRITABLE.join(", ")})` };
  }
  return { ok: true };
}

export type FileChange = { path: string; content: string } | { path: string; delete: true };

/** Validate a whole change set. Returns every problem, not just the first. */
export function checkChanges(changes: readonly FileChange[]): string[] {
  const problems: string[] = [];
  if (changes.length === 0) problems.push("No files to change.");
  if (changes.length > LIMITS.maxFiles) problems.push(`At most ${LIMITS.maxFiles} files per commit.`);

  const seen = new Set<string>();
  let total = 0;
  for (const change of changes) {
    const { path } = change;
    if (seen.has(path)) problems.push(`${path}: listed more than once.`);
    seen.add(path);

    const verdict = checkPath(path);
    if (!verdict.ok) {
      problems.push(`${path}: ${verdict.reason}.`);
      continue;
    }
    if ("delete" in change) {
      if (path === "agent/instructions.md") problems.push(`${path}: cannot be deleted.`);
      continue;
    }

    const bytes = Buffer.byteLength(change.content, "utf8");
    total += bytes;
    if (bytes > LIMITS.maxFileBytes) problems.push(`${path}: ${bytes} bytes exceeds ${LIMITS.maxFileBytes}.`);
    problems.push(...checkContent(path, change.content).map((p) => `${path}: ${p}`));
  }
  if (total > LIMITS.maxTotalBytes) problems.push(`Commit is ${total} bytes; limit is ${LIMITS.maxTotalBytes}.`);
  return problems;
}

function checkContent(path: string, content: string): string[] {
  const problems: string[] = [];
  if (content.includes("\u0000")) problems.push("binary content is not allowed.");
  for (const [label, pattern] of SECRET_PATTERNS) {
    if (pattern.test(content)) problems.push(`looks like it contains a ${label}. Use an environment variable.`);
  }

  if (path === "agent/instructions.md" && content.trim().length < 50) {
    problems.push("instructions must keep a real identity (at least 50 characters).");
  }

  if (path.startsWith("agent/skills/")) problems.push(...checkSkill(path, content));

  if (/\.(ts|mts|tsx)$/.test(path)) {
    for (const [label, pattern] of FORBIDDEN_IN_CODE) {
      if (pattern.test(content)) problems.push(`code must not reference ${label}.`);
    }
    try {
      // "transform" also accepts enums and parameter properties; it still rejects bad syntax.
      stripTypeScriptTypes(content, { mode: "transform" });
    } catch (error) {
      problems.push(`TypeScript syntax error: ${(error as Error).message.slice(0, 300)}`);
    }
  }

  if (path.endsWith(".json")) {
    try {
      JSON.parse(content);
    } catch (error) {
      problems.push(`invalid JSON: ${(error as Error).message}`);
    }
  }
  return problems;
}

const SKILL_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function checkSkill(path: string, content: string): string[] {
  const rest = path.slice("agent/skills/".length);
  const parts = rest.split("/");
  const name = parts.length === 1 ? rest.replace(/\.(md|ts)$/, "") : parts[0]!;
  if (!SKILL_NAME.test(name)) return [`skill name "${name}" must match ${SKILL_NAME}.`];
  if (parts.length === 1 && !/\.(md|ts)$/.test(rest)) return ["flat skills must be .md files."];
  if (parts.length === 2 && parts[1] === "SKILL.md" && !parseFrontmatter(content).description) {
    return ["SKILL.md needs frontmatter with a description (it is the routing hint)."];
  }
  return [];
}

/** Tiny frontmatter reader: `---\nkey: value\n---\nbody`. */
export function parseFrontmatter(source: string): { description?: string; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) return { body: source };
  const fields: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv) fields[kv[1]!] = kv[2]!.replace(/^["']|["']$/g, "").trim();
  }
  return { description: fields.description || undefined, body: source.slice(match[0].length) };
}
