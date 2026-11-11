/** Human-approved behavior-only self-write policy. This file is protected. */

export const WRITABLE = ["agent/instructions.md", "agent/skills/"] as const;
export const PROTECTED = [
  "agent/instructions/setup.ts", "agent/instructions/operating-rules.md", "agent/lib/self/", "agent/tools/self_", "agent/skills/live.ts",
  "agent/skills/self-modify/", "agent/channels/eve.ts",
] as const;
export const LIMITS = { maxFiles: 10, maxFileBytes: 64 * 1024, maxTotalBytes: 256 * 1024, maxMessageChars: 500 } as const;
export const SELF_WRITE_POLICY = {
  instructionFile: "agent/instructions.md",
  skillLayouts: ["agent/skills/<name>.md", "agent/skills/<name>/SKILL.md", "agent/skills/<name>/**/*.md"],
  skillNamePattern: "^[a-z0-9][a-z0-9_-]{0,63}$",
  skillEntryDescriptionRequired: true,
  reservedSkills: ["self-modify", "add-channel", "live"],
} as const;
const SAFE_PATH = /^[A-Za-z0-9._\-/]+$/;
const SECRET_PATTERNS: readonly [string, RegExp][] = [
  ["GitHub token", /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/], ["OpenAI/Anthropic key", /\bsk-(ant-)?[A-Za-z0-9_-]{20,}/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/], ["Vercel token", /\bvc[pk]_[A-Za-z0-9]{20,}/],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];
const SKILL_ROOT = "agent/skills/";
const SKILL_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const RESERVED_SKILLS: ReadonlySet<string> = new Set(SELF_WRITE_POLICY.reservedSkills);
export type PathVerdict = { ok: true } | { ok: false; reason: string };

function isProtected(path: string) { return PROTECTED.some((p) => (p.endsWith("/") || p.endsWith("_") ? path.startsWith(p) : path === p)); }
export function checkPath(path: string): PathVerdict {
  if (!SAFE_PATH.test(path)) return { ok: false, reason: "contains invalid path characters" };
  if (path.startsWith("/") || path.endsWith("/") || path.split("/").some((p) => !p || p === "." || p === "..")) return { ok: false, reason: "must be a relative file path without dot segments" };
  if (isProtected(path)) return { ok: false, reason: "is protected; only a human can change it" };
  if (path === "agent/instructions.md") return { ok: true };
  if (!path.startsWith(SKILL_ROOT)) return { ok: false, reason: "is outside the behavior-only writable paths" };
  const rest = path.slice(SKILL_ROOT.length), parts = rest.split("/");
  const name = parts.length === 1 && rest.endsWith(".md") ? rest.slice(0, -3) : parts[0]!;
  if (!SKILL_NAME.test(name)) return { ok: false, reason: `invalid skill name "${name}"` };
  if (RESERVED_SKILLS.has(name)) return { ok: false, reason: `skill identity "${name}" is owner-maintained` };
  if (parts.length === 1) return rest.endsWith(".md") ? { ok: true } : { ok: false, reason: "flat skills must be Markdown files" };
  if (parts.length >= 2 && parts.slice(1, -1).every((p) => p.length > 0) && parts.at(-1)!.endsWith(".md") && parts.at(-1)!.length > 3) return { ok: true };
  return { ok: false, reason: "skill packages may contain Markdown files only" };
}

export type FileChange = { path: string; content: string } | { path: string; delete: true };
/** Validate paths, duplicate inputs, content, and transaction size without assuming a tree. */
export function checkChanges(changes: readonly FileChange[]): string[] {
  const problems: string[] = [];
  if (!changes.length) problems.push("No files to change.");
  if (changes.length > LIMITS.maxFiles) problems.push(`At most ${LIMITS.maxFiles} files per commit.`);
  const seen = new Set<string>(); let total = 0;
  for (const change of changes) {
    const { path } = change;
    if (seen.has(path)) problems.push(`${path}: listed more than once.`); seen.add(path);
    const verdict = checkPath(path);
    if (!verdict.ok) { problems.push(`${path}: ${verdict.reason}.`); continue; }
    if ("delete" in change) { if (path === "agent/instructions.md") problems.push(`${path}: cannot be deleted.`); continue; }
    const bytes = Buffer.byteLength(change.content, "utf8"); total += bytes;
    if (bytes > LIMITS.maxFileBytes) problems.push(`${path}: ${bytes} bytes exceeds ${LIMITS.maxFileBytes}.`);
    problems.push(...checkContent(path, change.content).map((p) => `${path}: ${p}`));
  }
  if (total > LIMITS.maxTotalBytes) problems.push(`Commit is ${total} bytes; limit is ${LIMITS.maxTotalBytes}.`);
  return [...new Set(problems)];
}

/** Validate structural invariants against the actual resulting repository tree. */
export function checkResultingTree(changes: readonly FileChange[], existingPaths: readonly string[]): string[] {
  const problems: string[] = [];
  const finalPaths = new Set(existingPaths);
  for (const c of changes) if ("delete" in c) finalPaths.delete(c.path); else finalPaths.add(c.path);
  if (!finalPaths.has("agent/instructions.md")) problems.push("agent/instructions.md: cannot be deleted or absent.");
  for (const path of finalPaths) if ([...finalPaths].some((other) => other.startsWith(`${path}/`))) {
    problems.push(`${path}: file/directory path conflict in resulting tree.`);
  }
  const skillPaths = [...finalPaths].filter((p) => p.startsWith(SKILL_ROOT) && !isProtected(p));
  const names = new Map<string, string>();
  for (const path of skillPaths) {
    const rest = path.slice(SKILL_ROOT.length), parts = rest.split("/");
    const name = parts.length === 1 ? rest.slice(0, -3) : parts[0]!;
    const shape = parts.length === 1 ? "flat" : "package";
    const old = names.get(name);
    if (old && old !== shape) problems.push(`${path}: conflicts with another spelling of skill "${name}".`);
    names.set(name, shape);
    if (parts.length > 1 && !finalPaths.has(`${SKILL_ROOT}${name}/SKILL.md`)) problems.push(`${path}: package reference has no SKILL.md entry point.`);
  }
  return [...new Set(problems)];
}

export function checkChangeSet(changes: readonly FileChange[], existingPaths: readonly string[]): string[] {
  return [...new Set([...checkChanges(changes), ...checkResultingTree(changes, existingPaths)])];
}

function checkContent(path: string, content: string): string[] {
  const problems: string[] = [];
  if (content.includes("\u0000")) problems.push("binary content is not allowed.");
  for (const [label, pattern] of SECRET_PATTERNS) if (pattern.test(content)) problems.push(`looks like it contains a ${label}. Use an environment variable.`);
  if (path === "agent/instructions.md" && content.trim().length < 50) problems.push("instructions must preserve a nonempty character layer (at least 50 characters).");
  if (path.startsWith(SKILL_ROOT)) {
    const rest = path.slice(SKILL_ROOT.length), parts = rest.split("/");
    if (parts.length === 1 || parts.at(-1) === "SKILL.md") {
      const { description } = parseFrontmatter(content);
      if (!description?.trim()) problems.push("new skill entry points need frontmatter with a nonempty description.");
    }
  }
  return problems;
}
export function parseFrontmatter(source: string): { description?: string; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) return { body: source };
  const fields: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) { const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line); if (kv) fields[kv[1]!] = kv[2]!.replace(/^['"]|['"]$/g, "").trim(); }
  return { description: fields.description || undefined, body: source.slice(match[0].length) };
}
