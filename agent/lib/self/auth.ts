/** Protected, app-scoped Vercel Connect authorization for this repository. */
import { connect } from "@vercel/connect/eve";
import { deleteTokenCacheEntry, getToken } from "@vercel/connect";
import type { SelfRepo } from "./config";

export function resolveConnectorUid(value?: string): string {
  const trimmed = value?.trim();
  const uid = trimmed || "github/self";
  if (!/^github\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(uid)) {
    throw new Error("SELF_GITHUB_CONNECTOR must be a GitHub connector UID such as github/self. See README dashboard setup.");
  }
  return uid;
}

export function connectorUid(): string { return resolveConnectorUid(process.env.SELF_GITHUB_CONNECTOR); }

export function tokenParams(repo: Pick<SelfRepo, "owner" | "name">) {
  return {
    subject: { type: "app" as const },
    authorizationDetails: [{ type: "github_app_installation" as const, org: repo.owner, repositories: [repo.name], permissions: ["contents:write"] }],
  };
}

export function selfProvider(repo: Pick<SelfRepo, "owner" | "name">) {
  return connect({ connector: connectorUid(), principalType: "app", autoProvision: false, tokenParams: tokenParams(repo) });
}

export async function selfToken(repo: Pick<SelfRepo, "owner" | "name">, fetchToken: typeof getToken = getToken): Promise<string> {
  const uid = connectorUid();
  try { return await fetchToken(uid, tokenParams(repo)); }
  catch (error) { throw authFailure(error, uid, repo); }
}

export async function selfAuthRepo(
  repo: Pick<SelfRepo, "owner" | "name">,
  fetchToken: typeof getToken = getToken,
  evict: typeof deleteTokenCacheEntry = deleteTokenCacheEntry,
) {
  const uid = connectorUid();
  const params = tokenParams(repo);
  try {
    const token = await fetchToken(uid, params);
    return { ...repo, token, onUnauthorized: () => evict(uid, params) };
  } catch (error) { throw authFailure(error, uid, repo); }
}

export function authFailure(error: unknown, uid: string, repo: Pick<SelfRepo, "owner" | "name">): Error {
  const message = error instanceof Error ? `${(error as Error & { code?: string }).code ?? ""} ${error.message}`.toLowerCase() : "";
  let remedy = "Check the Connect connector, project link, executing environment, GitHub installation, and repository grant in README dashboard setup.";
  if (/connector.*(not found|unknown)|connector_not_found/.test(message)) remedy = "Create/check the Connect connector in the Vercel dashboard, then see README dashboard setup.";
  else if (/project.*(not linked|unlinked)|not_linked|environment.*disabled/.test(message)) remedy = "Link the Vercel project and enable the executing environment in connector settings; see README dashboard setup.";
  else if (/installation.*(required|missing|pending)|not installed|installation_required/.test(message)) remedy = "Install and approve the GitHub App for this repository; see README dashboard setup.";
  return new Error(`Connect authorization failed for ${uid} and ${repo.owner}/${repo.name}. ${remedy}`);
}

export async function toolRepo(ctx: {
  getToken: (provider: ReturnType<typeof selfProvider>) => Promise<{ token: string }>;
  requireAuth: (provider: ReturnType<typeof selfProvider>) => never;
}, repo: Pick<SelfRepo, "owner" | "name">) {
  const uid = connectorUid();
  const provider = selfProvider(repo);
  try {
    const { token } = await ctx.getToken(provider);
    return { ...repo, token, onUnauthorized: () => ctx.requireAuth(provider) };
  } catch (error) { throw authFailure(error, uid, repo); }
}
