---
description: Use when someone wants to connect, check, or fix the shipped Slack channel.
---

# Connect the shipped Slack channel

`agent/channels/slack.ts` already uses connector `slack/vot`. Connect that
installation; do not re-scaffold or replace the channel file. A human must
install the Slack app, with workspace administrator consent where needed.

## 1. Check the existing wiring

Use `self_read` on `agent/channels/slack.ts` to confirm the shipped UID.
Use `self_deployments` and `self_build_log` for deployment/build health, not
runtime logs. For webhook errors on `/eve/v1/slack`, ask a human to inspect
Vercel runtime logs. Build logs do not contain runtime webhook output.
A channel file or successful build does not verify installation or ingress;
an arriving conversation establishes ingress for that conversation only.

## 2. Connect Slack in the dashboard

Ask a human to:

1. Open [team Connect](https://vercel.com/d?to=/%5Bteam%5D/~/connect&title=Go+to+Connect)
   for the owning Vercel team. Create/check Slack connector `vot` (`slack/vot`)
   and install it in the intended workspace. If that UID belongs to another
   installation, stop and select the intended dedicated installation;
   never silently rename it or attach an unrelated one.
2. Follow the [dashboard trigger procedure](https://vercel.com/docs/connect/concepts/triggers#use-the-dashboard):
   add a trigger destination for this project, Production, at `/eve/v1/slack`.
   Review connector project/environment access.
3. Invite the bot where needed, including private channels.

## 3. Preserve access and approvals

One-to-one DMs need no mention. Everywhere else, require an explicit bot mention,
including public and private channels, group DMs and their threads. Only human
authors are admitted; do not loosen these rules to troubleshoot setup.

Set `SELF_APPROVERS` in the project's Production environment settings to the
allowed principal IDs (`slack:<team-id>:<user-id>`), then redeploy. For Miguel
as sole approver, use exactly his confirmed Slack team and user IDs. If unset,
any reachable principal can approve a write; set allowed principals before
shared use. Every write still requires human approval. Approval prompts
stay in the requesting thread. Never ask for secrets in chat.
