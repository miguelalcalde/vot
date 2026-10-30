/** Protected repository identity and branch configuration. */
export const SELF_BRANCH = "main";
export interface SelfRepo { readonly owner: string; readonly name: string }

export function resolveSelfRepoFrom(env: NodeJS.ProcessEnv): SelfRepo | null {
  const explicit = env.SELF_REPO?.trim();
  if (explicit) {
    const parts = explicit.split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error(`SELF_REPO must look like "owner/name", got "${explicit}".`);
    }
    return { owner: parts[0], name: parts[1] };
  }
  const owner = env.VERCEL_GIT_REPO_OWNER?.trim();
  const name = env.VERCEL_GIT_REPO_SLUG?.trim();
  if (env.VERCEL_GIT_PROVIDER === "github" && owner && name) return { owner, name };
  return null;
}

export function resolveSelfRepo(): SelfRepo | null { return resolveSelfRepoFrom(process.env); }

export function requireSelfRepo(): SelfRepo {
  const repo = resolveSelfRepo();
  if (!repo) throw new Error("Self-repository identity is missing. Set SELF_REPO=owner/name or deploy from GitHub on Vercel.");
  return repo;
}

export function deployedSha(): string | null { return process.env.VERCEL_GIT_COMMIT_SHA?.trim() || null; }
