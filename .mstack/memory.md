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
- 2026-10-23: GitHub auth was a fine-grained PAT scoped to this one repo
  (Contents read/write, no Workflows). We chose it over the Vercel Connect
  GitHub app because it was simpler to set up and the token itself was a hard
  boundary. **Superseded 2026-10-30 by Miguel's Connect-only decision in #10:**
  use a dedicated Vercel Connect GitHub App connector restricted to this repo;
  no PAT fallback and no deployer-created or copied token.
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

- 2026-10-27: Baseline commit `ede854c` pushed to `main`. Commits need
  `git -c user.signingkey=$HOME/.ssh/id_ed25519` because the SSH agent has no
  identities loaded.
- 2026-10-27: Vercel project `vot` on team `miguelalcalde-vtest314`
  (`prj_CJtL76ze2oFC8lbNjeTBO6qiKgzs`), Git-connected to this repo. Vercel
  Connect connector `vercel/vercel` attached (MCP). No deployments yet.
- 2026-10-27: Blob store creation fails on this team: Vercel API
  `POST /v1/storage/stores/blob` returns 404 (via `eve integration setup
  file-memory` and `vercel blob create-store`). The team has no Blob stores.
  File memory cannot work on this team until that is resolved.
- 2026-10-28: The Blob 404 is team-specific. The documented `POST
  /storage/stores/blob` (with or without `projectId`) also returns 404
  `not_found` on `miguelalcalde-vtest314`, while the same request on
  `miguel-unbundled-vtest314` returned 200 (probe store deleted). Tracked in
  issue #1. The Vercel CLI version (59.11.7) is not the cause.
- 2026-10-28: Stories #1-#10 created in GitHub Issues. #2 (policy tests) is
  the only one ready to implement now; #3-#5 wait on a deployment and
  `GITHUB_TOKEN`.
- 2026-10-28: The template ships without any token; each deployer supplies
  their own. Issue #10 explores replacing the PAT with Vercel Connect.
- 2026-10-27: mstack uses GitHub Issues (labels applied and verified), herdr
  session `default`, codex workers. high = `gpt-6.1-sol`; low = `gpt-6-luna`,
  then `gpt-5.6-luna`. All three verified via `codex exec`. Runs: 120 min,
  drain.

- 2026-10-28: Project moved to team `miguel-unbundled-vtest314`
  (`prj_XaPws1TE6EzjvDuLUvNrLBsRxdW2`), Git-connected, Blob memory set up,
  connector `vercel/vercel` attached. Production: https://vot-iota.vercel.app.
  Memory verified across sessions. The old project on `miguelalcalde-vtest314`
  is disconnected from Git, not deleted.
- 2026-10-28 decisions (Miguel): GitHub access via a Vercel Connect GitHub
  connection, not a PAT (#10, high priority); Slack in a test workspace with
  only Miguel as approver; Teams deferred; `main` protected against
  force-push/delete only; shared memory only (people deploy this themselves).
- 2026-10-28: The repo is public (Miguel's decision; history scanned for
  secrets first). Ruleset `protect-main-history` (id 26169674) blocks
  force-push and deletion of `main`; fast-forward pushes still work.
- Test the deployed agent with
  `pnpm exec eve invoke -u https://vot-iota.vercel.app --scope miguel-unbundled-vtest314 '<prompt>'`.

- 2026-10-29 run `vot-run-20261028-a` (23:26-23:39Z, herdr + codex): #10
  and #6 research passed and wait in refinement for Miguel's choices; #2
  refinement and implementation passed (PR #11), QA waits on #12. New stories
  #12 (fresh `pnpm install` fails) and #13 (Node 26 breaks the policy syntax
  gate).
- Codex `workspace-write` keeps `.git` read-only even when listed in
  `writable_roots`, so codex workers in a worktree cannot commit. The
  controller commits for them; credit the worker in the commit trailer and PR.
- First codex launch in a new folder asks to trust it (Miguel approved
  `vot`). herdr may label an idle codex as `working`; use `herdr agent wait`
  instead of polling `agent read --lines` (that fails while working).
- Fresh `pnpm install` exits 1 (`ERR_PNPM_IGNORED_BUILDS` for
  `@mongodb-js/zstd`, `node-liblzma` via `just-bash`) and dirties
  `pnpm-workspace.yaml`; pnpm then also fails `pnpm test` in its pre-script
  check. Tracked as #12.
- Under Node 26, `stripTypeScriptTypes` rejects `mode: "transform"`; the
  policy would reject every `.ts` write. Production is Node 24. Tracked as #13.

- 2026-10-30 run `vot-run-20261030-b` was interrupted before dispatch (its
  idle workers were stopped later). Run `vot-run-20261030-c` (07:55-08:31Z):
  #12 refined, implemented (PR #14) and QA PASS on AC1-AC5, with merge
  proposed; #10 refined and implemented (draft PR #15), to be rebased after
  #14 and #11; #6 refined, blocked on Miguel's Slack install and two
  confirmations; #2 still waits on #12.
- Codex's sandbox blocks file watchers (`eve dev` fails with EMFILE even at
  `ulimit -n 65536`). Use an unsandboxed independent actor (for example an fx
  subagent) for QA scenarios that need `eve dev`.
- Workers' shell defaults to Node 26 / pnpm 12. Always pin
  `/Users/miguel/.dotfiles/configs/.nvm/versions/node/v24.15.0/bin` in mandates.
- Vercel Preview deployments are behind Deployment Protection; only the
  production alias is reachable with `eve invoke`. Specs must not gate QA on
  production checks that need a merge first.
- PR #11's policy suite asserts the `GITHUB_TOKEN` tripwire that #10 removes.
  Merge order: #14, then #11, then rebase #10 and update that one case.
- 2026-10-30: Miguel confirmed the fx session in herdr pane `w1J:p2` is the
  only backlog controller. The fx session in `w1J:pF` is an informational
  observer (it read state and suggested merges; no merge command found in its
  history). PRs #14 and #11 were merged from Miguel's account; #11 merged
  before its QA verdict (recorded on #2).
- 2026-10-30: Connectors linked to the project: `github/vot`, `slack/vot`,
  `vercel/vercel`. #10 verification uses `SELF_GITHUB_CONNECTOR=github/vot`.
- 2026-10-30 decision (Miguel): Slack requires an @-mention everywhere except
  DMs with the bot (in or out of a thread).

## Open questions

- None open right now. See the GitHub issues for story-level questions.
