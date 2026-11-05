/** Human-maintained setup context. Settings are evidence of configuration only. */
import { resolveConnectorUid } from "./auth";

export const BLOB_BINDINGS = [
  "EVE_MEMORY_BLOB_STORE_ID",
  "EVE_MEMORY_BLOB_READ_WRITE_TOKEN",
  "BLOB_STORE_ID",
  "BLOB_READ_WRITE_TOKEN",
] as const;

export function hasBlobBinding(env: NodeJS.ProcessEnv): boolean {
  return BLOB_BINDINGS.some((key) => Boolean(env[key]?.trim()));
}

export function sharedMemoryScope(env: NodeJS.ProcessEnv): "agent" | null {
  return env.VERCEL?.trim() && !hasBlobBinding(env) ? null : "agent";
}

export function setupStatus(env: NodeJS.ProcessEnv) {
  let github: "configured" | "invalid" = "configured";
  try { resolveConnectorUid(env.SELF_GITHUB_CONNECTOR); }
  catch { github = "invalid"; }
  return {
    memory: env.VERCEL?.trim()
      ? hasBlobBinding(env) ? "configured-unverified" : "disabled"
      : "local-backend",
    github,
    vercelToken: Boolean(env.SELF_VERCEL_TOKEN?.trim()),
    approvers: (env.SELF_APPROVERS ?? "").split(",").some((entry) => Boolean(entry.trim())),
  } as const;
}

const PROJECTS = "https://vercel.com/dashboard";
const CONNECT = "https://vercel.com/d?to=/%5Bteam%5D/~/connect&title=Go+to+Connect";
const TOKENS = "https://vercel.com/account/tokens";

// Fixed safe text only: never interpolate an environment value or caught error.
export function renderSetup(env: NodeJS.ProcessEnv, channelKind?: string): string {
  const status = setupStatus(env);
  const memory = status.memory === "disabled"
    ? `Shared notebook: disabled until Blob is connected. Cross-session memory is off. Open ${PROJECTS}, select the project → Storage, connect a private Blob store (prefer OIDC), redeploy.`
    : status.memory === "configured-unverified"
      ? "Shared notebook: Blob binding configured; access, privacy, connectivity and durability unverified. Do not disable a configured but inaccessible store silently."
      : "Shared notebook: local backend selection unchanged. During eve dev it uses process memory, lost on restart; outside eve dev an explicit backend is required. Local settings do not establish durable Blob memory.";
  return `Session-start setup context (settings only; no remote checks).
Answer the incoming request. In the first reply only, briefly explain actionable gaps below with their impact, dashboard link and next steps. Include the GitHub installation/link reminder because a UID alone cannot verify access. Do not repeat a full checklist on subsequent ordinary turns. If all settings exist, avoid an unsolicited full checklist and never claim verified connectivity or that everything works. For explicit setup questions, use the complete browser procedure below without claiming a fresh remote check. Configuration changes need redeployment and a new session for refreshed automatic guidance. Never request secrets in chat, expose raw errors or persist a setup completion flag.
${channelKind === "slack" ? "This arriving Slack conversation establishes ingress for this conversation only; other workspaces/channels remain unverified." : "Conversation readiness requires working ingress; deployment alone provides no web chat."}
${memory}
GitHub connector: ${status.github === "invalid" ? `invalid SELF_GITHUB_CONNECTOR syntax; repository tools need a valid dedicated UID such as github/self. Correct it in project environment settings at ${PROJECTS} and redeploy.` : "configured UID (unset/blank uses the valid github/self default); installation, project link, environment access and repository grants unverified."} Complete/check the dedicated installation and Production project link at ${CONNECT}.
Vercel diagnostics: ${status.vercelToken ? "SELF_VERCEL_TOKEN configured; scope, expiry, permissions and connectivity unverified." : `SELF_VERCEL_TOKEN absent; deployment diagnostics need setup. Create an expiring individual-project token at ${TOKENS}, store it only in Production project environment settings at ${PROJECTS}, enable system environment variables and redeploy. Never send it in chat.`}
Write approvers: ${status.approvers ? "SELF_APPROVERS configured; principal values omitted." : `SELF_APPROVERS unset; any reachable principal can approve a write. Before shared use set allowed principals in project environment settings at ${PROJECTS} and redeploy.`} Every write still requires human approval. Setup status never authorizes a write.
Browser setup procedure (on request):
1. Deploy the clone from main, choosing GitHub ownership, Vercel team and repository/project names; accept private Blob creation. Accounts, administrator/provider consent, model access and sandbox prerequisites apply. No web chat is supplied.
2. Open team Connect at ${CONNECT}; create Slack connector vot (slack/vot), install in the intended workspace with admin consent as needed. Add a Production trigger destination for this project at /eve/v1/slack and review project/environment access. Invite the bot where needed. If that UID belongs to another installation, stop and select the intended dedicated installation, never silently rename it or attach an unrelated one. DMs need no mention; elsewhere a bot mention is required.
3. At ${PROJECTS}, select the project → Settings → Environment Variables; set SELF_APPROVERS using slack:<team-id>:<user-id>, redeploy via Deployments → Redeploy, then send a human DM. Slack profile → Copy member ID gives your user ID; the workspace URL's /client/T… segment gives the team ID. First conversation follows stages 1–3; the reply can guide remaining setup without Blob, GitHub access or Vercel diagnostics. If skipped, any reachable principal can approve, but every write still requires human approval.
4. At ${CONNECT}, create GitHub connector self with Contents read/write only (Metadata implicit), no unrelated permissions or triggers. Install the App for exactly this clone (organization/admin approval may be needed). In Projects attach this project for Production only. Default UID is github/self; a different dedicated UID can be set through validated SELF_GITHUB_CONNECTOR and redeployment. A setting alone proves no installation or access.
5. At ${TOKENS}, create an expiring token scoped to the owning team's individual project. Store SELF_VERCEL_TOKEN only in Production settings at ${PROJECTS}; enable system environment variables for trusted VERCEL_PROJECT_ID and redeploy. Do not invent a team variable. The provider token can read/write within the project; protected self_deployments/self_build_log expose reads only, not provider-enforced read-only permission. No Vercel connector or per-user OAuth is needed. Rotate by replacement, redeploy, read verification, then revocation of the old token. Local diagnostics also need this project's VERCEL_PROJECT_ID.
6. Check private Blob bindings at ${PROJECTS}. Conditional repair if absent: Project → Storage → create/select a private store → store Projects → Connect to Project for the intended environment, preferably OIDC, then redeploy. Supported bindings in precedence order: EVE_MEMORY_BLOB_STORE_ID, EVE_MEMORY_BLOB_READ_WRITE_TOKEN, BLOB_STORE_ID, BLOB_READ_WRITE_TOKEN. Preserve existing EVE bindings, stores and notebooks. Never copy VERCEL_OIDC_TOKEN; request-context OIDC is supported, and a webhook public key alone is no binding. Ask for harmless cross-session recall, self_read/self_history and a permitted deployment-read operation; do not test a self-write. All capabilities require the remaining stages and provider/admin approvals; settings alone never verify access.`;
}
