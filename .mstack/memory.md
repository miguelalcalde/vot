# Project memory

## Goal

A clone-and-go eve agent template that improves itself: code in GitHub,
deployed on Vercel from `main`, with access to its own repo and its own
deployment. Ship the bare minimum: self-modification with strict guardrails,
dynamic memory and skills (no deploy needed), and Slack and Teams channels.

## Confirmed decisions

- 2026-10-23: The agent writes to its own `main` through `self_commit` and
  `self_revert` only (fast-forward, never forced, human-approved). Guardrails
  live in `agent/lib/self/policy.ts`, which is protected. See README "How
  self-modification stays safe".
- 2026-10-23: GitHub auth is a fine-grained PAT scoped to this one repo
  (Contents read/write, no Workflows). We chose it over the Vercel Connect
  GitHub app because it is simpler to set up and the token itself is a hard
  boundary.
- 2026-10-23: Live skills come from a dynamic skill resolver
  (`agent/skills/live.ts`) reading `agent/skills/` from `main` each turn,
  cached by commit SHA. It falls back to the deployed skills.
- 2026-10-23: Memory is the built-in `fileMemory` with one shared slot
  (`scope: "agent"`), stored in Vercel Blob.
- 2026-10-23: Slack and Teams cannot be created end to end by the agent; a
  workspace admin must authorize the connector once. Shipped as the
  `add-channel` skill.

## Facts and gotchas

- eve 0.54.x expects `microsandbox@^0.5`; `eve dev` auto-installs 0.7.x, which
  crashes with `t.isInstalled is not a function`. Pinned to `0.5.5`.
- Dynamic skills force a sandbox to start on every turn, even when the
  resolver returns null.
- On Miguel's machine, `~/.microsandbox` was migrated by a newer microsandbox,
  so 0.5.5 cannot open it locally. Use Docker or just-bash locally. Left
  untouched on purpose.
- Node `stripTypeScriptTypes` must use `mode: "transform"` in the policy
  syntax gate; `strip` rejects enums and parameter properties.
- Full conversation, commit/revert against a real repo, and live skills on
  Vercel are not yet verified (no AI Gateway credentials, project not linked).

## Open questions

- Shared memory vs per-person memory (`byPrincipal`) for Slack and Teams.
- Do humans and dev agents use PRs on `main` while the deployed agent
  pushes directly? Branch protection that requires PRs would block
  `self_commit`.
