/** Protected server-side, own-project Vercel reads. No caller identity or input controls scope. */
import { z } from "zod";

export const deploymentsInput = z.object({
  limit: z.number().int().min(1).max(20).default(5),
  sha: z.string().regex(/^[a-fA-F0-9]{40}$/).optional(),
}).strict();
export const buildLogInput = z.object({
  deploymentId: z.string().regex(/^dpl_[A-Za-z0-9_]+$/),
  limit: z.number().int().min(1).max(200).default(100),
}).strict();
const BODY_BYTES = 1024 * 1024;
const LOG_BYTES = 32 * 1024;
class InspectionError extends Error {
  readonly kind: string;
  constructor(kind: string, message: string) { super(message); this.kind = kind; }
}
function malformed(): never { throw new InspectionError("inspection", "Cannot inspect: malformed response or mismatched project/deployment identity."); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return malformed();
  return value as Record<string, unknown>;
}
function requiredString(value: unknown): string {
  if (typeof value !== "string" || !value) return malformed();
  return value;
}
function optionalString(value: unknown): string | null {
  return value == null ? null : requiredString(value);
}
function timestamp(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return malformed();
  return value;
}
const statusMessages: Record<number, [string, string]> = {
  401: ["auth", "Cannot inspect: invalid or expired SELF_VERCEL_TOKEN. Ask the operator to replace it."],
  403: ["permission", "Cannot inspect: token lacks permission. Ask the operator to check this project's token scope."],
  404: ["not_found", "Cannot inspect: project, deployment or build log not found or inaccessible."],
  410: ["unavailable", "Cannot inspect: build logs are unavailable or expired."],
  429: ["rate_limit", "Cannot inspect: Vercel rate limit reached. Try later."],
};
async function request(path: string, token: string, query: Record<string, string> = {}): Promise<unknown> {
  const url = new URL(path, "https://api.vercel.com");
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      void reader?.cancel().catch(() => {});
      reject(new InspectionError("temporary", "Cannot inspect: temporary inspection unavailability (request timed out)."));
    }, 10_000);
  });
  try {
    return await Promise.race([timeout, (async () => {
      const response = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: controller.signal });
      if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); throw new InspectionError("temporary", "Cannot inspect: request timed out."); }
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        const [kind, message] = statusMessages[response.status] ?? [response.status >= 500 ? "temporary" : "inspection", "Cannot inspect: temporary inspection unavailability or unexpected provider response."];
        throw new InspectionError(kind, message);
      }
      if (response.redirected) { void response.body?.cancel().catch(() => {}); return malformed(); }
      if (!response.body) return malformed();
      reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (controller.signal.aborted) throw new InspectionError("temporary", "Cannot inspect: request timed out.");
        if (done) break;
        size += value.byteLength;
        if (size > BODY_BYTES) {
          controller.abort();
          void reader.cancel().catch(() => {});
          throw new InspectionError("inspection", "Cannot inspect: response exceeds the 1 MiB inspection limit.");
        }
        chunks.push(value);
      }
      try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
      catch { return malformed(); }
    })()]);
  } finally { clearTimeout(timer); }
}
type Identity = { projectId: string; teamId: string };
async function inspect<S extends z.ZodType>(input: unknown, schema: S, action: (input: z.output<S>, identity: Identity, token: string) => Promise<unknown>) {
  const token = process.env.SELF_VERCEL_TOKEN?.trim();
  try {
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new InspectionError("input", "Cannot inspect: invalid tool input or unknown properties.");
    if (!token) throw new InspectionError("setup", "Deployment inspection is not configured. Ask the operator to set SELF_VERCEL_TOKEN to a Vercel token scoped to this project.");
    const projectId = process.env.VERCEL_PROJECT_ID?.trim();
    if (!projectId || !/^prj_[A-Za-z0-9_]+$/.test(projectId)) throw new InspectionError("setup", "Deployment inspection is not configured. Ask the operator to enable system environment variables, or explicitly set VERCEL_PROJECT_ID for local development with the same project's token.");
    const project = record(await request(`/v9/projects/${projectId}`, token));
    if (project.id !== projectId || typeof project.accountId !== "string" || !/^team_[A-Za-z0-9_]+$/.test(project.accountId)) return malformed();
    const result = await action(parsed.data, { projectId, teamId: project.accountId }, token);
    // Log text was already redacted before byte bounding; do not expand it twice.
    // Redact every other projected provider string here. No raw metadata is returned.
    return JSON.parse(JSON.stringify(result, (key, value) => key !== "text" && typeof value === "string" ? value.split(token).join("[REDACTED]") : value));
  } catch (error) {
    return { ok: false, kind: error instanceof InspectionError ? error.kind : "temporary", message: error instanceof InspectionError ? error.message : "Cannot inspect: temporary inspection unavailability (network or transport failure)." };
  }
}
export async function listDeployments(input: unknown) {
  return inspect(input, deploymentsInput, async ({ limit, sha }: z.infer<typeof deploymentsInput>, identity, token) => {
    const data = record(await request("/v7/deployments", token, { ...identity, limit: String(limit), ...(sha ? { sha } : {}) }));
    if (!Array.isArray(data.deployments)) return malformed();
    const deployments = data.deployments.map((item) => {
      const d = record(item);
      if (d.projectId != null && d.projectId !== identity.projectId) return malformed();
      if (d.project != null && record(d.project).id !== identity.projectId) return malformed();
      const meta = d.meta == null ? {} : record(d.meta);
      return { id: requiredString(d.uid ?? d.id), url: requiredString(d.url), state: requiredString(d.state), target: optionalString(d.target), createdAt: timestamp(d.createdAt ?? d.created), gitCommitSha: optionalString(meta.githubCommitSha) };
    }).filter((d) => !sha || d.gitCommitSha === sha).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
    const pagination = data.pagination == null ? {} : record(data.pagination);
    return { ok: true, ...identity, deployments, possiblyMore: pagination.next != null };
  });
}
export async function readBuildLog(input: unknown) {
  return inspect(input, buildLogInput, async ({ deploymentId, limit }: z.infer<typeof buildLogInput>, identity, token) => {
    const detail = record(await request(`/v13/deployments/${deploymentId}`, token, { teamId: identity.teamId }));
    if (detail.id !== deploymentId || detail.projectId !== identity.projectId) return malformed();
    const data = await request(`/v3/deployments/${deploymentId}/events`, token, { teamId: identity.teamId, builds: "1", follow: "0", direction: "backward", limit: String(limit) });
    if (!Array.isArray(data)) return malformed();
    const events = data.map((item) => {
      const e = record(item);
      return { timestamp: e.created == null ? null : timestamp(e.created), type: optionalString(e.type), text: e.text == null ? "" : (typeof e.text === "string" ? e.text : malformed()) };
    });
    // The provider returns backward order. Stable reversal also handles missing timestamps.
    events.reverse();
    events.sort((a, b) => a.timestamp != null && b.timestamp != null ? a.timestamp - b.timestamp : 0);
    let truncated = events.length > limit;
    const selected = events.slice(-limit);
    let remaining = LOG_BYTES;
    const tail: { timestamp: number | null; type: string | null; text: string }[] = [];
    for (const e of selected.reverse()) {
      const safe = e.text.split(token).join("[REDACTED]");
      let text = safe;
      if (Buffer.byteLength(text, "utf8") > remaining) {
        // Keep a UTF-8-valid suffix, including for one oversized multiline event.
        const points = Array.from(text);
        let bytes = 0; let start = points.length;
        while (start > 0 && bytes + Buffer.byteLength(points[start - 1]!, "utf8") <= remaining) bytes += Buffer.byteLength(points[--start]!, "utf8");
        text = points.slice(start).join(""); truncated = true;
      }
      remaining -= Buffer.byteLength(text, "utf8");
      tail.unshift({ timestamp: e.timestamp, type: e.type, text });
      if (remaining === 0) { if (tail.length < selected.length) truncated = true; break; }
    }
    return { ok: true, ...identity, deploymentId, events: tail, truncated, possiblyMore: data.length >= limit, untrustedContent: true };
  });
}
