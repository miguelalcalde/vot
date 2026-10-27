---
description: Use before changing anything about yourself - your skills, instructions, tools, channels, connections, or schedules - or when asked to learn a procedure, fix your own behavior, or roll back a change.
---

# Changing yourself

Your code lives in GitHub on `main`, and Vercel deploys every push to `main`.
You read it with `self_read` and `self_history`, and you change it with
`self_commit` and `self_revert`. A human approves every write, and code-level
policy rejects anything outside the rules no matter who approves.

## Pick the smallest surface

| The need                                        | Change                                   | Takes effect              |
| ----------------------------------------------- | ---------------------------------------- | ------------------------- |
| A fact, preference, or name to remember         | Memory (`memory__save_memory`), not code | Next turn, no commit      |
| A repeatable procedure or checklist             | `agent/skills/<name>.md`                 | Next turn                 |
| Who you are, tone, always-on rules              | `agent/instructions.md`                  | After deploy (~1 min)     |
| A new typed capability calling an API           | `agent/tools/<name>.ts`                  | After deploy              |
| A messaging surface (Slack, Teams)              | Load the `add-channel` skill             | After setup and deploy    |

Prefer memory over a skill and a skill over code. Not every gap is a skill
issue: a one-line fact belongs in memory.

## Procedure

1. `self_history` to see the head, what is deployed, and the policy.
2. `self_read` every file you will touch. Keep the `headSha` it returns.
3. Write the complete new content of each file. Keep changes small and focused:
   one purpose per commit.
4. Tell the user in one or two sentences what you will change and why, then
   call `self_commit` with `baseSha` = that `headSha`.
5. If the commit touched anything other than `agent/skills/`, check the
   deployment for that commit through the Vercel connection. If the build
   fails, `self_revert` to the previous commit and report what happened.
6. If `self_commit` says main moved, read again. Never retry blindly.

## Writing a skill

A flat skill is `agent/skills/<name>.md`. Name: lowercase letters, digits,
`-` or `_`. Start with frontmatter so routing works:

```md
---
description: Use when <the situation that should trigger this skill>.
---

Steps, in order, with the exact tools to call.
```

Write the description as the trigger, not a label.

## Writing a tool

Follow the eve tool shape: `defineTool` from `eve/tools`, a Zod `inputSchema`,
and `execute`. Read an existing tool with `self_read` first and match it. Put
secrets in environment variables and tell the user which ones to set in Vercel.
Gate external side effects with `approval: always()` from `eve/tools/approval`.

## Hard rules

- Never try to work around the policy, the approval, or protected paths. If a
  change needs a protected file, explain it and ask a human to make it.
- Never put secrets, tokens, or personal data in the repo.
- Never claim a change is live until the commit exists (and, for code, the
  deployment succeeded).
