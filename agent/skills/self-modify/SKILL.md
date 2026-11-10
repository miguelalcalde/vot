---
description: Use when learning a procedure, changing behavior Markdown, or rolling back a behavior change.
---

# Changing yourself

Owner-maintained code lives in GitHub on `main`, and Vercel deploys changes
from `main`. You can improve behavior through human-approved Markdown writes;
you cannot add or change executable capabilities, integrations, architecture,
or runtime schedules. If a capability is missing, refer it to the owner.
You read it with `self_read` and `self_history`, and you change it with
`self_commit` and `self_revert`. A human approves every write, and code-level
policy rejects anything outside the rules no matter who approves.

## Pick the smallest surface

| The need                                        | Change                                   | Takes effect              |
| ----------------------------------------------- | ---------------------------------------- | ------------------------- |
| A fact, preference, or name to remember         | Memory (`memory__save_memory`), not code | Next turn, no commit      |
| A repeatable procedure or checklist             | `agent/skills/<name>.md` or `<name>/SKILL.md` with Markdown references | Next turn |
| Character, role, tone, preferences               | `agent/instructions.md`                  | After deploy              |
| A new capability or integration                 | Refer the gap to the owner               | Owner change and deploy   |
| A messaging surface (Slack, Teams)              | Load the owner-maintained `add-channel` skill | Owner setup and deploy |

Runtime schedules are managed separately from source. Prefer memory for a
durable fact, and a Markdown skill for a repeatable procedure.

## Procedure

1. `self_history` to see the head, what is deployed, and the policy.
2. `self_read` every file you will touch. Keep the `headSha` it returns.
3. Write the complete new content of each file. Keep changes small and focused:
   one purpose per commit.
4. Tell the user in one or two sentences what you will change and why, then
   call `self_commit` with `baseSha` = that `headSha`.
5. If the commit touched anything outside `agent/skills/`, call
   `self_deployments` with `sha` equal to the exact full `committed` SHA.
   Make at most three checks in this verification attempt (initial call plus
   two retries); transient failures count against this bound. Only exact full
   SHA equality establishes a match. If several match, report the newest
   matching deployment and its target, never a newer unrelated commit.
   Stop early on READY, ERROR, CANCELED or BLOCKED, or a setup/auth/permission
   failure. READY establishes readiness, not that production aliases serve it.
   Missing or pending results may be rechecked within the bound; after exhaustion
   report the committed SHA and pending verification. On access or transport
   failure report “cannot inspect” with the reason. Never treat absence as a
   failed build or automatically undo a change because inspection failed.
   For an observed ERROR, inspect `self_build_log` with that deployment ID,
   then follow `self_revert` guidance to restore the previous commit with
   human approval. Report canceled/blocked as such. Skill-only changes retain
   the next-turn exemption and need no deployment check.
6. If `self_commit` says main moved, read again. Never retry blindly.

## Writing a skill

A flat skill is `agent/skills/<name>.md`. A package uses
`agent/skills/<name>/SKILL.md` plus Markdown references below that directory.
Names use lowercase letters, digits, `-` or `_`; entry points need a nonempty
description. Other assets and executable files are not writable:

```md
---
description: Use when <the situation that should trigger this skill>.
---

Steps, in order, with the exact tools to call.
```

Write the description as the trigger, not a label.

## Hard rules

- Only edit `agent/instructions.md` and eligible skill Markdown. Never try to
  work around policy, approval, or protected paths. If a capability or
  integration needs code, explain the gap and refer it to the owner.
- Never put secrets, tokens, or personal data in the repo.
- Never claim a change is live until the commit exists (and, for code, the
  deployment succeeded).
