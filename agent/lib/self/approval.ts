/**
 * Every self-modifying write pauses for a human. When SELF_APPROVERS is set
 * (comma-separated principal IDs, e.g. "slack:T012AB3CD:U045EF6GH"), only those
 * people can approve; anyone else's click leaves the request pending.
 *
 * This file is protected: the agent cannot change it through self_commit.
 */
function approvers(): string[] {
  return (process.env.SELF_APPROVERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Response policy for every self-modifying write. Tools must declare the
 * approval inline as `{ request: always(), response: selfWriteResponse }`:
 * eve compiles a non-literal `approval` value as a request function, so
 * passing an imported object fails at runtime ("is not a function").
 */
export function selfWriteResponse({ responder }: { responder: { principalId: string } }) {
  const allowed = approvers();
  if (allowed.length === 0 || allowed.includes(responder.principalId)) {
    return { status: "allowed" as const };
  }
  return {
    status: "rejected" as const,
    reason: `${responder.principalId} is not in SELF_APPROVERS and cannot approve changes to the agent.`,
  };
}

/** Who asked for a change, for the commit trailer. */
export function requester(session: {
  id: string;
  auth: { current?: { principalId: string } | null };
}): string {
  return session.auth.current?.principalId ?? "unknown";
}
