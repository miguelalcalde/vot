# vot

A self-modifying [eve](https://eve.dev) agent template. Its code lives in
GitHub, Vercel deploys it from `main`, and the agent can read and change both,
behind a human approval and a code-enforced policy.

It ships with the minimum needed to improve itself:

| Piece                | What it is                                                  | Changes apply           |
| -------------------- | ----------------------------------------------------------- | ----------------------- |
| Memory               | One shared notebook (`fileMemory`, private Vercel Blob)     | Next turn, no commit    |
| Live skills          | `agent/skills/` loaded from `main` on every turn            | Next turn after commit  |
| Self-repo tools      | `self_read`, `self_history`, `self_commit`, `self_revert`   | -                       |
| Vercel connection    | Vercel MCP: its own deployments, build status, logs         | -                       |
| Channel skill        | Guides adding Slack or Microsoft Teams                      | After setup and deploy  |

Everything else (instructions, tools, channels) is code: the agent commits it
and Vercel's Git integration deploys it.

## Set up

### Run the local policy tests

Use Node 24.x, install dependencies with `pnpm install`, then run:

```bash
pnpm test
```

The policy suite runs locally and needs no service setup, credentials, or app
process.

1. **Clone and push** this template to your own GitHub repo, then install:

   ```bash
   pnpm install
   ```

2. **Create a Vercel project from the GitHub repo** (Git integration, production
   branch `main`), then link it locally:

   ```bash
   pnpm exec eve link
   ```

3. **Set up GitHub access in Vercel Connect** (browser setup; no token is copied).
   1. Identify the existing Vercel team, project, and GitHub repository for this
      agent. You need a team member with connector/project access and someone
      allowed to install GitHub Apps. Organization approval may require a
      GitHub administrator.
   2. Open that team's Vercel Connect dashboard, choose **Create Connector** →
      **GitHub**, and name it `self`. In Advanced, grant only Contents read/write
      (Metadata read is implicit), with no Workflows, Administration, unrelated
      issue/PR grants, or event triggers. Connect manages the App credentials.
   3. Complete **Install** in GitHub, choose **Only select repositories**, and
      select exactly this agent repository. Confirm installation and any org
      approval are complete.
   4. In connector **Projects**, attach the existing Vercel project and enable
      **Production** only. This is separate from the project's existing Git
      integration, which still deploys commits from `main`.
   5. Confirm the connector UID is `github/self`; that is the default. If you
      use another dedicated connector, set `SELF_GITHUB_CONNECTOR` to its full
      UID (for example `github/my-agent`) in the project's Production variables.
      This identifier is not a credential. Never copy an App key or access token.
      Apply configuration through the existing deployment flow; engineers using
      the CLI must use eve for project linking/deployment.
   6. Verify with `self_read` and `self_history`. If authorization fails, check
      connector creation, project/environment linking, GitHub installation and
      the one-repository grant. See the optional developer prerequisites below.

4. **Provision memory** (creates a private Blob store and connects it with OIDC):

   ```bash
   pnpm exec eve integration setup file-memory
   ```

5. **Connect Vercel** so the agent can see its own deployments:

   ```bash
   pnpm exec eve integration connect vercel vercel vercel --connection-method mcp
   ```

6. **Deploy** by pushing to `main` (or `pnpm exec eve deploy`).

7. **Optional: add channels.** Each needs a workspace admin once:

   ```bash
   pnpm exec eve add channel/slack
   pnpm exec eve add channel/teams
   ```

   Commit the generated `agent/channels/*.ts` and push. In shared channels, set
   `SELF_APPROVERS` (see `.env.example`) so only named people can approve the
   agent's changes.

For local development, copy `.env.example` to `.env.local`, then run
`pnpm exec eve dev`. To exercise the real `main`, explicitly enable Development
for the connector and provide valid Vercel OIDC credentials; this grants real
repository access. The connector variable alone does not authorize access.
Without those prerequisites, tools fail safely and live skills fall back to
deployed skills. Set `SELF_REPO=owner/name` when Vercel Git metadata is absent.

## How self-modification stays safe

Every write goes through six layers:

1. **Connect restriction.** The requested GitHub App token is restricted to
   this one repository and Contents write. The dedicated connector must itself
   be installed only on this repository; this is defense in depth, not a sandbox.
2. **Human approval.** `self_commit` and `self_revert` pause for approval on
   every call. With `SELF_APPROVERS` set, only those principals can approve.
3. **Policy in code** (`agent/lib/self/policy.ts`), checked before any GitHub
   call:
   - Writable: `agent/instructions.md`, `agent/{skills,tools,lib,channels,connections,schedules,subagents}/`, `README.md`
   - Protected: the policy and GitHub client (`agent/lib/self/`), the
     `self_*` tools, the live skill loader, the `self-modify` skill, and web
     auth (`agent/channels/eve.ts`)
   - Off-limits: `package.json`, the lockfile, `agent/agent.ts`, memory config,
     `.github/`, and anything else not listed above
   - Up to 10 files and 64 KB per file, no secrets, valid TypeScript syntax and
     JSON, no references to self-connector configuration, GitHub API, or
     self-auth helpers in new code,
     skills need a description, instructions cannot be emptied

   The code-content checks are tripwires, not a sandbox: agent-written tools
   run with the app's environment. For code changes, the approval in layer 2
   is the real gate, so read the diff before you approve.
4. **Fast-forward only.** Commits go on top of the `headSha` the agent read and
   are never forced, so a concurrent human change is never overwritten.
5. **Build gate.** Vercel only promotes a deployment whose build succeeds. A
   broken code change leaves the previous production deployment serving.
6. **Rollback.** `self_revert` restores writable files from an earlier commit,
   as a new commit.

Commits carry `Eve-Session` and `Eve-Requested-By` trailers for audit.

To change what the agent may touch, edit `agent/lib/self/policy.ts` yourself.
The agent cannot.

## Layout

```text
agent/
  agent.ts                  model
  instructions.md           identity (agent-writable)
  memory.ts                 shared notebook
  connections/vercel.ts     own deployment via Vercel MCP
  channels/eve.ts           HTTP/TUI channel (protected)
  skills/
    live.ts                 loads skills from main every turn (protected)
    self-modify/SKILL.md    how to change itself (protected)
    add-channel.md          Slack / Teams setup
  tools/self_*.ts           read, history, commit, revert (protected)
  lib/self/                 config, GitHub client, policy, approval (protected)
```

## Notes

- Live skills override deployed skills with the same name. A skill deleted on
  `main` disappears once the next deploy finishes.
- Dynamic skills need a sandbox, so each session starts one: Vercel Sandbox when
  deployed, or Docker, microsandbox, or just-bash locally.
- `microsandbox` is pinned to `0.5.5` because eve 0.54 expects the 0.5 API.
