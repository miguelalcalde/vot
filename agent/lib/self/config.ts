/**
 * Where the agent's own source lives. The model never chooses the repo or the
 * branch: both are resolved here from the deployment environment.
 *
 * This file is protected: the agent cannot change it through self_commit.
 */

/** The only branch the agent reads from and writes to. */
export const SELF_BRANCH = "main";

export interface SelfRepo {
  readonly owner: string;
  readonly name: string;
  readonly token: string;
}

/**
 * Resolve the agent's own repository.
 *
 * - `SELF_REPO=owner/name` wins when set.
 * - Otherwise Vercel's Git system variables identify the repo the deployment
 *   was built from, so a cloned template points at itself with no config.
 * - `GITHUB_TOKEN` must be a fine-grained token scoped to this single repo with
 *   Contents: read and write. Do not grant Workflows or Administration.
 */
export function resolveSelfRepo(): SelfRepo | null {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) return null;

  const explicit = process.env.SELF_REPO?.trim();
  if (explicit) {
    const [owner, name, ...rest] = explicit.split("/");
    if (!owner || !name || rest.length > 0) {
      throw new Error(`SELF_REPO must look like "owner/name", got "${explicit}".`);
    }
    return { owner, name, token };
  }

  const owner = process.env.VERCEL_GIT_REPO_OWNER?.trim();
  const name = process.env.VERCEL_GIT_REPO_SLUG?.trim();
  if (process.env.VERCEL_GIT_PROVIDER === "github" && owner && name) {
    return { owner, name, token };
  }
  return null;
}

export function requireSelfRepo(): SelfRepo {
  const repo = resolveSelfRepo();
  if (!repo) {
    throw new Error(
      "Self-modification is not configured. Set GITHUB_TOKEN (fine-grained, this repo only, " +
        "Contents: read and write) and either deploy from GitHub on Vercel or set SELF_REPO=owner/name.",
    );
  }
  return repo;
}

/** Commit SHA of the code that is running right now, when deployed on Vercel. */
export function deployedSha(): string | null {
  return process.env.VERCEL_GIT_COMMIT_SHA?.trim() || null;
}
