/**
 * Minimal GitHub REST client bound to the agent's own repo and branch.
 *
 * Only the operations self-modification needs are exposed. There is no way to
 * pick another repo, another branch, or to force-update a ref.
 *
 * This file is protected: the agent cannot change it through self_commit.
 */
import { SELF_BRANCH, type SelfRepo } from "./config";

const API = "https://api.github.com";

export class GitHubError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function gh<T>(
  repo: SelfRepo,
  path: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const res = await fetch(`${API}/repos/${repo.owner}/${repo.name}${path}`, {
    method: init.method ?? "GET",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${repo.token}`,
      "x-github-api-version": "2022-11-28",
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: init.signal ?? AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new GitHubError(res.status, `GitHub ${init.method ?? "GET"} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export interface TreeEntry {
  path: string;
  mode: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
}

export interface CommitSummary {
  sha: string;
  message: string;
  author: string;
  date: string;
}

/** Current SHA at the tip of main. */
export async function getHeadSha(repo: SelfRepo, signal?: AbortSignal): Promise<string> {
  const ref = await gh<{ object: { sha: string } }>(repo, `/git/ref/heads/${SELF_BRANCH}`, { signal });
  return ref.object.sha;
}

export async function getCommitTreeSha(repo: SelfRepo, commitSha: string, signal?: AbortSignal): Promise<string> {
  const commit = await gh<{ tree: { sha: string } }>(repo, `/git/commits/${commitSha}`, { signal });
  return commit.tree.sha;
}

/** Full recursive tree for a commit. */
export async function getTree(repo: SelfRepo, commitSha: string, signal?: AbortSignal): Promise<TreeEntry[]> {
  const treeSha = await getCommitTreeSha(repo, commitSha, signal);
  const tree = await gh<{ tree: TreeEntry[]; truncated: boolean }>(repo, `/git/trees/${treeSha}?recursive=1`, {
    signal,
  });
  if (tree.truncated) throw new Error("Repository tree is too large to read in one request.");
  return tree.tree;
}

export async function getBlobText(repo: SelfRepo, blobSha: string, signal?: AbortSignal): Promise<string> {
  const blob = await gh<{ content: string; encoding: string }>(repo, `/git/blobs/${blobSha}`, { signal });
  if (blob.encoding !== "base64") throw new Error(`Unexpected blob encoding ${blob.encoding}.`);
  return Buffer.from(blob.content, "base64").toString("utf8");
}

export async function listCommits(repo: SelfRepo, limit: number): Promise<CommitSummary[]> {
  const commits = await gh<
    { sha: string; commit: { message: string; author: { name: string; date: string } | null } }[]
  >(repo, `/commits?sha=${SELF_BRANCH}&per_page=${limit}`);
  return commits.map((c) => ({
    sha: c.sha,
    message: c.commit.message,
    author: c.commit.author?.name ?? "unknown",
    date: c.commit.author?.date ?? "",
  }));
}

export interface CompareFile {
  filename: string;
  status: "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";
  previous_filename?: string;
}

/** Files changed between two commits, plus whether `base` is an ancestor of `head`. */
export async function compare(
  repo: SelfRepo,
  base: string,
  head: string,
): Promise<{ status: string; files: CompareFile[] }> {
  const res = await gh<{ status: string; files?: CompareFile[] }>(repo, `/compare/${base}...${head}`);
  return { status: res.status, files: res.files ?? [] };
}

export type TreeChange =
  | { path: string; content: string }
  | { path: string; blobSha: string }
  | { path: string; delete: true };

/**
 * Create one commit on top of `parentSha` and fast-forward main to it.
 *
 * The ref update uses `force: false`, so GitHub rejects it if main moved since
 * `parentSha` was read. Nothing is ever overwritten.
 */
export async function commitToMain(
  repo: SelfRepo,
  parentSha: string,
  changes: readonly TreeChange[],
  message: string,
): Promise<{ sha: string; url: string }> {
  const baseTree = await getCommitTreeSha(repo, parentSha);
  const tree = await gh<{ sha: string }>(repo, "/git/trees", {
    method: "POST",
    body: {
      base_tree: baseTree,
      tree: changes.map((c) =>
        "delete" in c
          ? { path: c.path, mode: "100644", type: "blob", sha: null }
          : "blobSha" in c
            ? { path: c.path, mode: "100644", type: "blob", sha: c.blobSha }
            : { path: c.path, mode: "100644", type: "blob", content: c.content },
      ),
    },
  });
  const commit = await gh<{ sha: string; html_url: string }>(repo, "/git/commits", {
    method: "POST",
    body: { message, tree: tree.sha, parents: [parentSha] },
  });
  try {
    await gh(repo, `/git/refs/heads/${SELF_BRANCH}`, {
      method: "PATCH",
      body: { sha: commit.sha, force: false },
    });
  } catch (error) {
    if (error instanceof GitHubError && error.status === 422) {
      throw new Error(`main moved while committing; nothing was changed. Re-read the files and try again.`);
    }
    throw error;
  }
  return { sha: commit.sha, url: commit.html_url };
}
