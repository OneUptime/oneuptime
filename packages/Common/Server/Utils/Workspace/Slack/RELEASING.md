# Publishing the OneUptime Slack app

This is the runbook for maintainers and AI agents who change the **OneUptime**
Slack app that OneUptime Cloud customers install, its configuration (the app
manifest), or its Slack Marketplace listing. Follow the repository's
[AGENTS.md](../../../../../../AGENTS.md) as well.

It does not cover self-hosted installations: every self-hosted server creates
its own Slack app from the manifest its server generates
([self-hosted Slack integration](https://oneuptime.com/docs/self-hosted/slack-integration)).

The state below was verified on **15 October 2026**, when the production and
staging apps were brought up to date with `app-manifest.json` and the Slack
Marketplace resubmission was prepared. Recheck the live state before acting:
the dates and versions here are history, not instructions to repeat.

## How a change reaches customers

Three different things change at three different times. Know which one your
change needs.

| What                                                                                                        | Where it comes from                                                                                                            | When customers get it                                                                                                              |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| The scopes OneUptime asks for                                                                               | `oauth_config.scopes` in [app-manifest.json](app-manifest.json), read by `SlackAPI` `/slack/install-url` when someone connects | New connections get them as soon as the code is deployed. A workspace that connected earlier keeps its scopes until it reconnects. |
| Slash commands, shortcuts, event subscriptions, the Home tab, interactivity and redirect URLs, display info | The Slack app's own configuration at api.slack.com                                                                             | Only after someone updates the app's configuration (below). Code alone changes nothing here.                                       |
| What the app does with them                                                                                 | The server code                                                                                                                | When the release containing it is deployed.                                                                                        |

So the order for a change that touches the manifest is:

1. Merge the code (with `app-manifest.json` and its tests) and let it be released.
2. Confirm production runs that release.
3. Update the production app's configuration to the manifest production serves.
4. Do the same for the staging app if it is in use.
5. If the app is listed in the Slack Marketplace, the change also goes through Slack review (see [Slack Marketplace](#slack-marketplace)).

`https://oneuptime.com/api/slack/app-manifest` serves the manifest with
`{{SERVER_URL}}` replaced by `https://oneuptime.com`. That response is the
target for the production app. It needs no sign-in.

## Apps and identifiers

The customer-facing app is **OneUptime**, App ID **`A08CBJX7KBJ`**. Do not
create a replacement app: every connected workspace is tied to this one.

| App                                   | App ID        | Client ID                     | Points at                    | Notes                                                                                                 |
| ------------------------------------- | ------------- | ----------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| OneUptime (production)                | `A08CBJX7KBJ` | `7205733110631.8419643257392` | `https://oneuptime.com`      | Publicly distributed, not (yet) listed in the Slack Marketplace.                                      |
| OneUptime (staging)                   | `A08JW21RJ64` | see its Basic Information     | `https://test.oneuptime.com` | Publicly distributed. In October 2026 staging had no `SLACK_APP_CLIENT_ID`, so nothing used this app. |
| OneUptime (internal, not distributed) | `A0775KG03B2` | —                             | —                            | An internal bot (for example sign-up notifications). Not the customer app; leave it alone.            |

All three are owned by the Slack workspace **HackerBay**, `hackerbayhq.slack.com`,
team ID **`T0761MK38JK`**. Sign in to it with **nawazdhandala@oneuptime.com**,
an app collaborator. Watch out for look-alikes:

- Another workspace is also named **HackerBay** (`hackerbaycompany.slack.com`,
  `T033XTX49`). It owns the legacy CloudBoost and Fyipe apps, not OneUptime.
- **OneUptime Customer Support** (`oneuptimesupport.slack.com`) and **OneUptime
  OpenSource Development** (`oneuptimedev.slack.com`) only have apps _installed_.
  oneuptimedev's "OneUptime Slack" (`A05P03QRS78`) and "OneUptime Test App"
  (`A0550ARNN7K`) are other apps, not production.
- If `https://api.slack.com/apps` does not list `A08CBJX7KBJ`, you are signed in
  to the wrong workspaces, not missing permissions. The production client ID is
  public (`SLACK_APP_CLIENT_ID` in `https://oneuptime.com/dashboard/env.js`), and
  the app's install page (`https://slack.com/oauth/v2/authorize?client_id=…&scope=commands`)
  shows its App ID in the page data.

Entry points (they need the HackerBay `hackerbayhq` sign-in):

- [App manifest (production)](https://app.slack.com/app-settings/T0761MK38JK/A08CBJX7KBJ/app-manifest)
- [Basic information (production)](https://api.slack.com/apps/A08CBJX7KBJ/general)
- [Marketplace submission (production)](https://app.slack.com/app-settings/T0761MK38JK/A08CBJX7KBJ/submission)
- [App manifest (staging)](https://app.slack.com/app-settings/T0761MK38JK/A08JW21RJ64/app-manifest)

## Updating the app's configuration

1. **Confirm the code is live.** `APP_VERSION` in
   `https://oneuptime.com/dashboard/env.js` is the running release. Check that
   it contains your change, for example
   `git merge-base --is-ancestor <your commit> <release tag>`, and that
   `git diff <release tag> master -- packages/Common/Server/Utils/Workspace/Slack/app-manifest.json`
   is empty.
2. **Fetch the target**: `curl -s https://oneuptime.com/api/slack/app-manifest`.
3. **Read the live configuration** on the App Manifest page (JSON tab) and
   compare the two structurally: scopes, events and command lists as sets, the
   rest field by field. Keep the keys Slack adds itself, with their live values:
   `oauth_config.pkce_enabled`, `settings.app_level_token_rotation_enabled`,
   `settings.is_mcp_enabled`, and `features.app_home.agent_tasks_enabled`
   (Slack sets it to `true` once the Home tab is on).
4. **Get a maintainer's approval for the exact diff.** This is a production
   change for every connected workspace.
5. **Edit and save.** The editor is CodeMirror 5 with no auto-closing brackets:
   click into it, select all, and type the compact JSON. Read the editor's
   contents back and compare them with the target before you press **Save
   Changes**. Slack reformats the JSON on save. Reload the page and compare once
   more.
6. **Staging**: do the same on `A08JW21RJ64`, with `https://test.oneuptime.com`
   URLs (`https://test.oneuptime.com/api/slack/app-manifest`). While staging
   has no Slack secrets, Slack shows its events URL as "isn't verified". That is
   expected and does not stop the save.

After a save:

- The yellow "You've changed the permission scopes your app uses. Please
  reinstall your app" banner is about the app's own installation in the
  HackerBay workspace. Customers are not reinstalled by it.
- Workspaces that connected before a scope was added get it only when someone
  connects again from **Project Settings** > **Workspace** > **Slack**. Say so
  in the release notes.
- Removing a slash command takes effect at once for every workspace.

### Configuration history

| Date       | Apps                | Change                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-15 | production, staging | From the September 2025 manifest to the repo's: Home tab on; `/incident` and `/maintenance` removed; `/oneuptime` gained its full description and usage hint and `should_escape: true` (needed for `page @someone`); bot scopes `files:write`, `pins:read`, `users:read.email`, `usergroups:read`, `usergroups:write` added; events `pin_added`, `app_home_opened`, `member_joined_channel` added. |

Add a row whenever you change a live app's configuration.

## Slack Marketplace

### Why list the app

- Since **3 March 2026**, Slack limits `conversations.history` and
  `conversations.replies` to **1 request per minute and 15 messages per call**
  for commercially distributed apps that are not in the Marketplace
  ([Slack changelog](https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps)).
  OneUptime reads them to save pinned or 📌 messages as notes
  (`SlackSavedMessage`), for OneUptime AI's thread context
  (`SlackAPI.getConversationHistory`, `SlackUtil.getThreadReplies`), and in the
  paged channel-history reader in `Slack.ts`.
- An unlisted app's install screen says "This app is not approved by Slack".

### What listing costs

Once the app is listed, every change to its scopes, events, redirect URLs or
other reviewed settings has to be resubmitted, and is staged until Slack
approves it. Batch manifest changes and allow for review time. Read this before
merging anything that touches `app-manifest.json`.

### State in October 2026

- The app has never been listed. Its first submission (2025) was returned on
  **22 May 2025** with 9 items, below.
- The resubmission was being prepared on 15 October 2026: the code changes
  Slack asked for, the security and compliance answers, the testing
  instructions and the reviewer project were done. The listing screenshots, the
  install-flow video and the final **Resubmit App** were still open.

### The submission, section by section

The pages live under **Submit to Slack Marketplace** in the app settings. Each
page saves only through its **Next** button, and Slack refuses to save a page
with a required field missing. Text typed into a page is lost if you leave it
without saving, so finish a page in one go.

1. **Your App Listing**: name, icon, short and long description, 1–6
   screenshots of exactly **1600×1000** px (required: the page will not save
   without them), category (Developer Tools), installation landing page
   (`https://oneuptime.com/docs/workspace-connections/slack`, which must link
   to the privacy policy), privacy policy (`https://oneuptime.com/legal/privacy`),
   support URL (`https://oneuptime.com/support`), support email
   (`slacksupport@oneuptime.com`), pricing "Free and paid plans available".
   Screenshots must be real Slack screenshots of the app. The images in
   `.github/pr-assets/` are test renderings and will not pass.
2. **Review scopes**: a reason for every scope. Use the table below.
3. **Security and compliance**: company **HackerBay, Inc.**, United States;
   terms `https://oneuptime.com/legal/terms`; retention, archival/removal,
   storage and deletion-request policies written out (Slack rejects a link);
   hosting **Google Cloud, United States**; sub-processors
   `https://oneuptime.com/legal/subprocessors`; the LLM answers (OneUptime AI
   runs only on the model provider a customer connects to their own project;
   OneUptime provides no model); certifications and the security questions. Every
   answer is a company fact: take it from a maintainer or a public OneUptime
   page, never from guesswork. Slack shows these answers on the listing.
4. **Testing information**: who Slack notifies, test-account details, how to
   test, and a **video or screenshots URL** of the full install flow
   (required). Never put a password in this form. Point the reviewers at their
   own account instead.
5. **Automated checks**: Slack's own checks, then **Resubmit App**. Pressing
   it is a maintainer's decision.

### The reviewers' OneUptime project

Slack's reviewers cannot use our Slack workspace; they install the app into
their own and need a OneUptime project to connect it to.

| Item             | Value                                                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Reviewer account | `slack-app-reviews@salesforce.com` (exists in OneUptime as "Slack Test")                                                    |
| Project          | **Slack Marketplace Review**, ID `c311af4d-dd8c-4ecf-8e5b-b3715537ed25`                                                     |
| Plan             | Enterprise; trial extended to **15 December 2026** (Admin Dashboard > Projects > the project > Subscription > Extend Trial) |
| Reviewer's team  | **Members**, enough to connect Slack, create notification rules and act on incidents                                        |
| Slack connection | None, so the reviewers can connect their own workspace (a project connects to one workspace)                                |

Create a project like this from the **Admin Dashboard** (`/admin/projects` >
**Create Project**, plan **Enterprise**); it asks for no payment details.
Notification rules, which create incident channels, need the Growth plan or
higher on OneUptime Cloud.

### Reasons for each scope

Keep this table equal to `oauth_config.scopes.bot` and paste it into **Review
scopes**. A scope that no code uses has no reason: remove it instead (Slack
returned the first submission partly for unused scopes).

| Scope                    | Why OneUptime needs it                                                                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `commands`               | The `/oneuptime` slash command, and the Create New Incident and Create Scheduled Event shortcuts.                                                                      |
| `app_mentions:read`      | To answer people who mention @OneUptime in a channel with a command or a question for OneUptime AI.                                                                    |
| `chat:write`             | To post incident, alert and maintenance notifications, answers to commands, and confirmations of actions.                                                              |
| `channels:read`          | To list public channels when a project picks where notifications go, and to look up a channel's name and members.                                                      |
| `groups:read`            | The same, for private channels OneUptime has been added to.                                                                                                            |
| `im:read`                | To confirm that a direct message conversation with the app belongs to the person who sent a command.                                                                   |
| `mpim:read`              | To look up a group DM OneUptime has been added to when someone mentions it there.                                                                                      |
| `channels:join`          | To join the public channel a project chose for notifications, so OneUptime can post there.                                                                             |
| `channels:manage`        | To create a public channel for each incident when a project turns on incident channels, and to archive it afterwards.                                                  |
| `groups:write`           | The same for private incident channels, and to invite the people involved into them.                                                                                   |
| `channels:write.invites` | To invite the people on call and the incident's owners into an incident channel.                                                                                       |
| `channels:history`       | To read the thread a person asks OneUptime AI about, and the message someone pins or marks with 📌 to save it as an incident note, in public channels OneUptime is in. |
| `groups:history`         | The same, in private channels OneUptime is a member of.                                                                                                                |
| `im:history`             | To read what people send OneUptime in its Messages tab, so it can answer them.                                                                                         |
| `mpim:history`           | To read messages addressed to OneUptime in group DMs it was added to.                                                                                                  |
| `users:read`             | To show people's names and timezones, and to match Slack users with OneUptime users for paging and on-call.                                                            |
| `users:read.email`       | To find the Slack member who is a OneUptime user (by email) when paging someone or keeping an on-call user group up to date.                                           |
| `usergroups:read`        | To list user groups so a project can connect one to an on-call schedule.                                                                                               |
| `usergroups:write`       | To keep a connected user group equal to whoever is on call in its schedule.                                                                                            |
| `pins:read`              | To receive the `pin_added` event, so a pinned message can be saved as an incident note.                                                                                |
| `reactions:read`         | To receive the `reaction_added` event, so a 📌 or 📣 reaction saves a message as a note.                                                                               |
| `files:write`            | To attach a synthetic monitor's screenshot to the incident message it belongs to.                                                                                      |

### The first review's feedback (May 2025) and how it was answered

| #   | Slack's item                                                                                | Answer                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | The Messages tab must answer people and send a welcome on `app_home_opened` the first time. | The bot answers direct messages (`message.im`); a one-time welcome is sent when someone first opens the Messages tab.                                        |
| 2   | Reviewers could not test the web app, incident channels or on-call; add their account.      | The reviewers' project above, with instructions in Testing information.                                                                                      |
| 3   | The OAuth `state` must be unique and unguessable.                                           | `WorkspaceOAuthState`: 32 random bytes, single use, expiring, bound to the user.                                                                             |
| 4   | The landing page must link to the privacy policy.                                           | The Slack docs page has a section on the data the app reads, linking the privacy policy.                                                                     |
| 5   | The landing page must describe the integration.                                             | `https://oneuptime.com/docs/workspace-connections/slack`.                                                                                                    |
| 6   | The long description must say how the app works in Slack.                                   | Rewritten in October 2026.                                                                                                                                   |
| 7   | Minimum scopes: drop `im:read`/`im:write` and the user-token `users:read` if unused.        | Removed the unused `im:write`, `mpim:write`, `channels:write.topic` and the user-token `users:read`. `im:read` stays: `conversations.info` on a DM needs it. |
| 8   | `oneuptime.com` must not accept TLS 1.0 or 1.1.                                             | Verified in October 2026 with `nmap --script ssl-enum-ciphers -p 443 oneuptime.com`: TLS 1.2 only.                                                           |
| 9   | Write the data policies out instead of linking to them.                                     | Written out in Security and compliance.                                                                                                                      |

## Notes for agents driving the browser

- Use the in-app (built-in) browser. It cannot attach files, so a human uploads
  screenshots and other files; save them to `~/Downloads` for them.
- In Slack's forms, set a textarea with a form-fill tool rather than
  select-all and typing, which can splice the new text into the old.
- Inviting an outside address as **Owners** of a OneUptime project is refused as
  a permission grant; **Members** is enough for Slack's reviewers.
