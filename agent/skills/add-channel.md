---
description: Use when someone wants to talk to you from Slack or Microsoft Teams, or asks to add, check, or fix a messaging channel.
---

# Adding a channel

A channel needs two things: a channel file in your repo, and a connector a
human authorizes (installing a Slack app or consenting to a Teams bot needs a
workspace admin, so you cannot finish it alone). Be upfront about that.

## 1. Check what exists

`self_read` with path `agent/channels`. If `slack.ts` or `teams.ts` is already
there, the channel is wired; use the Vercel connection to check recent
deployment logs for errors on `/eve/v1/slack` or `/eve/v1/teams`.

## 2. Ask a human to create the connector

Ask the user to run this from a clone of your repo, signed in to Vercel:

| Channel | Command                         | Creates                                  |
| ------- | ------------------------------- | ---------------------------------------- |
| Slack   | `npx eve add channel/slack`     | Slack connector, trigger, `slack.ts`     |
| Teams   | `npx eve add channel/teams`     | Azure bot connector, trigger, `teams.ts` |

The guided setup writes the channel file locally. Ask them to commit and push
it to `main`, or to give you the connector ID it printed (like `slack/my-agent`)
so you can commit the file yourself.

## 3. Commit the channel file (if they gave you the connector ID)

Slack, `agent/channels/slack.ts`:

```ts
import { connectSlackCredentials } from "@vercel/connect/eve";
import { slackChannel } from "eve/channels/slack";

export default slackChannel({
  credentials: connectSlackCredentials("<connector-id>"),
});
```

Teams without Connect, `agent/channels/teams.ts` (needs `MICROSOFT_APP_ID`,
`MICROSOFT_APP_PASSWORD`, and optionally `MICROSOFT_TENANT_ID` set in Vercel):

```ts
import { teamsChannel } from "eve/channels/teams";

export default teamsChannel();
```

Follow the self-modify skill to commit, then confirm the deployment succeeded.

## 4. Slack access and approvals

In Slack, public and private channel messages require an explicit bot mention;
one-to-one DMs do not. The app must be invited to each channel. Set
`SELF_APPROVERS` in Vercel to the principal IDs allowed to approve your
changes (Slack looks like `slack:<team-id>:<user-id>`). For Miguel as sole
approver, use exactly his confirmed Slack team and user IDs. Approval prompts
stay in the requesting thread.

In Teams, anyone in the approval thread can click Approve unless the project
configures its own approver restriction.
