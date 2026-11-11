# vot

A self-modifying [eve](https://eve.dev) agent template. Its code lives in
GitHub, Vercel deploys it from `main`, and the agent can inspect deployments and change its source,
behind a human approval and a code-enforced policy.

It ships with the minimum needed to improve itself:

| Piece                | What it is                                                  | Changes apply           |
| -------------------- | ----------------------------------------------------------- | ----------------------- |
| Memory               | One shared notebook (`fileMemory`, private Vercel Blob)     | Next turn, no commit    |
| Live skills          | `agent/skills/` loaded from `main` on every turn            | Next turn after commit  |
| Self-repo tools      | `self_read`, `self_history`, `self_commit`, `self_revert`   | -                       |
| Deployment reads    | `self_deployments`, `self_build_log`: own project only      | -                       |
| Slack channel        | Shipped channel; dashboard installation required             | After setup and deploy  |
| Setup guidance       | Settings-only session-start instructions                     | New session after deploy |

Everything else (instructions, tools, channels) is code: the agent commits it
and Vercel's Git integration deploys it.

## Set up

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fmiguelalcalde%2Fvot&project-name=vot&repository-name=vot&stores=%5B%7B%22type%22%3A%22blob%22%2C%22access%22%3A%22private%22%7D%5D)

### Browser route

The first conversation follows stages 1–3. Completing all capabilities needs
stages 4–6 and any provider or administrator approvals. Deployment alone
provides no web chat. Repository and project names in the button are defaults
you can adjust; the normal success screen returns you to this README.

1. **Deploy the clone.**
   1. Sign in to GitHub and Vercel. You need permission to create a repository
      and Vercel project, connect storage, manage environment settings and
      install provider Apps. Organization policies may require administrators.
   2. Use the button; select GitHub ownership and the owning Vercel team, name
      the repository/project, accept private Blob creation and deploy from `main`.
      Private Blob is offered; automatic OIDC binding is not guaranteed. See the
      conditional repair in stage 6 if no binding is attached.
   3. Ensure the project can use the selected model through AI Gateway and
      Vercel Sandbox. Dynamic skills require a sandbox. Deployment is separate
      from channel installation and provider consent.

2. **Install the shipped Slack channel.**
   1. Open [team Connect](https://vercel.com/d?to=/%5Bteam%5D/~/connect&title=Go+to+Connect)
      for the owning team. Create Slack connector `vot` (`slack/vot`) and install
      it in the intended workspace, obtaining administrator consent where needed.
      If that UID belongs to another installation, stop and select the intended
      dedicated installation; do not attach an unrelated one or silently rename
      the shipped UID.
   2. Follow the [dashboard trigger procedure](https://vercel.com/docs/connect/concepts/triggers#use-the-dashboard):
      add a trigger destination for this project, **Production**, at
      `/eve/v1/slack`. Review connector project/environment access.
   3. Invite the bot where needed, including private channels. One-to-one DMs
      need no mention; public/private channel messages require a bot mention.

3. **Set approvers and start a DM.**
   1. Open [Vercel projects](https://vercel.com/dashboard), select the owning
      team/project → Settings → Environment Variables. Set `SELF_APPROVERS`
      for Production to comma-separated allowed principals in the format
      `slack:<team-id>:<user-id>`. In Slack, open your profile → **Copy member
      ID** for your user ID. Open the workspace in a browser: the `/client/T…/`
      URL segment contains its team ID. Use your own IDs.
   2. Redeploy through Deployments → Redeploy, then send the bot a human DM.
      Its first reply can guide remaining setup even without Blob, GitHub
      access or the Vercel diagnostics token. Missing Blob on Vercel disables
      the shared notebook, so conversation can continue without durable memory.
   3. If you skip approvers, any reachable principal can approve a write.
      Every write still requires human approval; set allowed principals before
      shared use. An arriving DM verifies ingress for that conversation only.

4. **Grant restricted GitHub access.**
   1. In [team Connect](https://vercel.com/d?to=/%5Bteam%5D/~/connect&title=Go+to+Connect),
      create GitHub connector `self`. In Advanced grant **Contents read/write**
      only (Metadata is implicit), with no Workflows, Administration, unrelated
      permissions or triggers. Connect manages the App credentials.
   2. Complete the GitHub App installation with **Only select repositories**,
      selecting exactly this clone. Complete any organization/admin approval.
   3. In connector **Projects**, attach this Vercel project for **Production
      only**. See [Connect project linking](https://vercel.com/kb/guide/vercel-connect#link-the-connector-to-a-project).
      This is separate from the Git integration that deploys `main`.
   4. The default UID is `github/self`; unset/blank `SELF_GITHUB_CONNECTOR` is
      valid. For another dedicated connector set its full UID, for example
      `github/my-agent`, in Production and redeploy. The validated syntax is
      `github/` followed by an ASCII letter/digit, then letters/digits, `.`, `_`
      or `-`. A UID alone proves neither installation nor project/environment
      access or repository grants. Never copy an App key or token.

5. **Configure Vercel diagnostics.**
   1. In [Vercel token settings](https://vercel.com/account/tokens), create an
      **expiring token scoped to the owning team's individual project**.
      Store it only as `SELF_VERCEL_TOKEN` in the project's Production
      environment settings. Never commit it or send it in chat. See
      [token scope](https://vercel.com/docs/accounts/access-tokens).
   2. Enable **Automatically expose System Environment Variables** so trusted
      `VERCEL_PROJECT_ID` is available; do not invent an automatic team variable.
      Redeploy. See [system variables](https://vercel.com/docs/environment-variables/system-environment-variables).
      The protected helper checks the matching project ID and team-shaped
      `accountId`, then uses that owner for subsequent reads.
   3. The provider token can read and write within this project. The protected
      `self_deployments` and `self_build_log` tools expose only reads; this is
      read-only intent, not provider-enforced read-only permission. One shared
      credential serves Slack, service and scheduled sessions, with no Vercel
      Connect/MCP installation or per-user OAuth consent.
   4. Rotate by replacing the environment secret with a new expiring token for
      the same project, redeploying, verifying reads, then revoking the old
      token. For local diagnostics also set this project's `VERCEL_PROJECT_ID`.
      Presence alone cannot verify scope, expiry, permissions or connectivity.

6. **Check memory and capabilities.**
   1. Inspect private Blob configuration in the project's Storage page.
      Supported bindings, in backend precedence order, are
      `EVE_MEMORY_BLOB_STORE_ID`, `EVE_MEMORY_BLOB_READ_WRITE_TOKEN`,
      `BLOB_STORE_ID`, `BLOB_READ_WRITE_TOKEN`. On Vercel, if all four are absent
      or blank, the memory slot and its tools are disabled before recall.
      A webhook public key alone is not a binding. A configured store remains
      enabled; an access failure needs troubleshooting, not silent disabling.
   2. **Conditional Blob repair — only if binding is absent:** in Project →
      Storage create/select a **private** store, then open the store's Projects
      → Connect to Project for the intended environment, preferably with OIDC,
      and redeploy. Generic `BLOB_STORE_ID` works. Preserve existing EVE
      bindings, stores and notebooks. Do not copy `VERCEL_OIDC_TOKEN`: OIDC may
      arrive through request context. See [Blob authentication](https://vercel.com/docs/vercel-blob/using-blob-sdk).
   3. Ask for harmless shared notebook recall in a second session, `self_read`
      and `self_history`, and a permitted deployment-read operation. Do not use
      a self-write as a setup test. A binding proves configuration, not storage
      access, privacy, connectivity or durability; these checks establish
      observed capabilities.

Setup is evaluated from settings at each new session, without network checks.
The first reply explains gaps once; explicit setup questions remain answerable
later. After configuration changes, redeploy and start a new session to refresh
automatic guidance. Settings alone never establish that everything works.

### Engineer alternative (CLI)

Use **Node 24.x**. Clone your deployed repository (or clone this template into
your own GitHub repository), then install and link the project with eve:

```bash
git clone https://github.com/YOUR-OWNER/vot.git
cd vot
pnpm install
pnpm exec eve link --non-interactive --project YOUR-PROJECT --team YOUR-TEAM
```

If you want CLI provisioning of file memory for the linked project:

```bash
pnpm exec eve integration setup file-memory
```

Complete the same dashboard consents and configuration in browser stages 2–6:
Slack installation/Production trigger, approvers, restricted GitHub installation
and project link, and the Vercel diagnostics token. CLI tooling does not remove
provider or administrator consent. Deploy with eve, then verify with the first
human DM and the harmless reads in stage 6:

```bash
pnpm exec eve deploy --non-interactive --yes --project YOUR-PROJECT
```

For local development, copy `.env.example` to `.env.local`, then run
`pnpm exec eve dev`. Its notebook uses process memory and is lost on restart;
other non-Vercel runtimes still need an explicit memory backend. To exercise
the real `main`, explicitly enable Development access on the dedicated GitHub
connector and provide valid Vercel OIDC credentials; this grants real repository
access. Without them, tools fail safely and live skills fall back to deployed
skills. Set `SELF_REPO=owner/name` when Vercel Git metadata is absent. Local
deployment diagnostics also require this project's `VERCEL_PROJECT_ID` and
`SELF_VERCEL_TOKEN`.

Run the deterministic suites with `pnpm test`; they need no credentials or
service setup.

## How self-modification stays safe

Every write goes through six layers:

1. **Connect restriction.** The requested GitHub App token is restricted to
   this one repository and Contents write. The dedicated connector must itself
   be installed only on this repository; this is defense in depth, not a sandbox.
2. **Human approval.** `self_commit` and `self_revert` pause for approval on
   every call. With `SELF_APPROVERS` set, only those principals can approve.
3. **Policy in code** (`agent/lib/self/policy.ts`), checked before a GitHub
   write:
   - Writable: `agent/instructions.md` and eligible Markdown skill entry points/references under `agent/skills/` only
   - Protected: owner operating rules (`agent/instructions/operating-rules.md`), all self helpers including GitHub and Vercel reads (`agent/lib/self/`), the
     `self_*` tools, the live skill loader, the `self-modify` skill, setup instructions (`agent/instructions/setup.ts`), and web
     auth (`agent/channels/eve.ts`)
   - All executable/configuration code, tools, channels, connections, schedules,
     subagents, README, model configuration and other paths are owner-controlled.
     Runtime schedules are independent runtime records, not source changes.
   - Skill names and resulting trees are checked for Markdown-only packages,
     required entry points, nonempty descriptions, collisions and reserved
     owner identities (`self-modify`, `add-channel`, and `live`). Instructions
     cannot be deleted or emptied. Up to 10 files and 64 KB per file; secrets
     are rejected. Rollback blobs receive the same current content checks.

   The code-content checks are tripwires, not a sandbox. Prompt instructions
   and skills are not the code-enforced security boundary.
4. **Fast-forward only.** Commits go on top of the `headSha` the agent read and
   are never forced, so a concurrent human change is never overwritten.
5. **Build gate.** Vercel only promotes a deployment whose build succeeds. A
   broken code change leaves the previous production deployment serving.
6. **Rollback.** `self_revert` restores eligible behavior Markdown from an
   earlier commit as a new commit; paths outside the current policy are skipped
   and invalid eligible restores are rejected atomically.

Commits carry `Eve-Session` and `Eve-Requested-By` trailers for audit.

Owner-maintained `agent/instructions/operating-rules.md` is always on and
independent of the mutable character layer in `agent/instructions.md`. To
change capabilities, integrations, operating rules, or what the agent may
touch, edit the protected implementation yourself. The agent cannot.

## Layout

```text
agent/
  agent.ts                  model
  instructions.md           character and preferences (agent-writable)
  instructions/operating-rules.md owner-maintained always-on rules
  instructions/setup.ts     settings-only setup guidance (protected)
  memory.ts                 shared notebook (disabled on Vercel without Blob)
  channels/eve.ts           HTTP/TUI channel (protected)
  skills/
    live.ts                 loads skills from main every turn (protected)
    self-modify/SKILL.md    how to change itself (protected)
    add-channel.md          Slack / Teams setup
  tools/self_*.ts           read, history, commit, revert, deployments, build log (protected)
  lib/self/                 config, setup, GitHub/Vercel reads, policy, approval (protected)
```

## Notes

- Live skills override deployed skills with the same name. A skill deleted on
  `main` disappears once the next deploy finishes.
- Dynamic skills need a sandbox, so each session starts one: Vercel Sandbox when
  deployed, or Docker, microsandbox, or just-bash locally.
- `microsandbox` is pinned to `0.5.5` because eve 0.54 expects the 0.5 API.
