# Publishing the OneUptime Slack app

This is the runbook for maintainers and AI agents who change the **OneUptime**
Slack app that OneUptime Cloud customers install, its configuration (the app
manifest), or its Slack Marketplace listing. Follow the repository's
[AGENTS.md](../../../../../../AGENTS.md) as well.

It does not cover self-hosted installations: every self-hosted server creates
its own Slack app from the manifest its server generates
([self-hosted Slack integration](https://oneuptime.com/docs/self-hosted/slack-integration)).

The state below was verified on **16 October 2026**, when the production app's
scopes were trimmed to the manifest 14.0.61 serves and the Slack Marketplace
resubmission was sent. The production and staging apps had been brought up to
date with `app-manifest.json` the day before. Recheck the live state before
acting: the dates and versions here are history, not instructions to repeat.

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
| OneUptime (production)                | `A08CBJX7KBJ` | `7205733110631.8419643257392` | `https://oneuptime.com`      | Publicly distributed. Submitted to the Slack Marketplace on 16 October 2026, in review.               |
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
   (Slack sets it to `true` once the Home tab is on). Keep the live
   `display_information.long_description` too: it is the Marketplace listing's
   long description, rewritten on the listing page in October 2026, and
   `app-manifest.json` still has the older text.
4. **Get a maintainer's approval for the exact diff.** This is a production
   change for every connected workspace.
5. **Edit and save.** The editor is CodeMirror 5 with no auto-closing brackets:
   click into it, select all, and type the compact JSON. To remove one entry,
   put the cursor at the end of its line and delete it with Backspace instead,
   which leaves the long description alone. Read the editor's contents back and
   compare them with the target before you press **Save Changes**. Slack
   reformats the JSON on save, and drops a scope list left empty. Reload the
   page and compare once more.

   A scope can also be removed on **OAuth & Permissions**: its remove button
   saves at once, without asking. The button is disabled for a scope that a
   configured event or the slash command needs, and in October 2026 also for
   the user-token `users:read`, with no reason given. Remove such a scope in
   the manifest editor.

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
| 2026-10-16 | production          | Bot scopes `channels:write.topic`, `im:write`, `mpim:write` and the user-token `users:read` removed, to match the manifest 14.0.61 serves (PR #4860): the bot scopes on **OAuth & Permissions**, `users:read` in the manifest editor. Staging not changed.                                                                                                                                         |

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
- It was resubmitted on **16 October 2026**. Every item on the feedback page
  was marked **I have fixed it**, the production app's scopes were trimmed
  (see [Configuration history](#configuration-history)), and the install-flow
  video went into Testing information. A maintainer pressed **Submit App for
  Review**. Slack emails nawazdhandala@oneuptime.com once it has looked.
- While Slack reviews it, change nothing in the app's configuration. The pages
  under **Submit to Slack Marketplace** show "Your app has been submitted for
  review" instead, and **Keep Editing** or any configuration change voids the
  submission. That includes the `/oneuptime` usage hint
  `incident [title or number] | …`, merged after 14.0.61 (PR #4870): apply
  it once the app is approved, when it may need a review of its own.
- After approval, connect a second member of a project with **Connect my
  account with Slack**. It uses Sign in with Slack (`/slack/sign-in-url` in
  `SlackAPI`, scopes `openid profile email`), and those scopes are not among
  the app's configured scopes. Slack's Sign in with Slack guide asks only for a
  redirect URL and requests them in a flow of their own, but a listed app "will
  only be able to use permission scopes Slack has approved".

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
   own account instead. The October 2026 video,
   `https://youtu.be/ucgFztdCcHE`, installs the app into a fresh test
   workspace from a OneUptime project with no Slack connection: **Connect with
   Slack**, Slack's consent page, the connected cards, **Send Test** to a
   channel, the Home and Messages tabs, "help", and `/oneuptime incident`
   creating an incident that the Home tab then lists.
5. **Automated checks**: Slack's own checks, and **Submit App for Review**.
   In October 2026 the only finding was a warning that `users:read.email` needs
   people's consent before you email them. OneUptime sends no email with it (it
   only matches Slack members to OneUptime users), and the warning does not
   stop a submission. Pressing **Submit App for Review** is a maintainer's
   decision.

After a returned review, **Resubmit App** on the **Feedback from review** page
stays disabled until **I have fixed it** is pressed on every item.

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
returned the first submission partly for unused scopes). These are the reasons
submitted on 16 October 2026. Each one stands alone on that page, so none
leans on the row above it.

| Scope                    | Why OneUptime needs it                                                                                                                                                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `commands`               | The `/oneuptime` slash command, and the Create New Incident and Create Scheduled Event shortcuts.                                                                                                                                       |
| `app_mentions:read`      | To answer people who mention @OneUptime in a channel with a command or a question for OneUptime AI.                                                                                                                                     |
| `chat:write`             | To post incident, alert and maintenance notifications, answers to commands, and confirmations of actions.                                                                                                                               |
| `channels:read`          | To list public channels when a project picks where notifications go, and to look up a channel's name and members.                                                                                                                       |
| `groups:read`            | To list the private channels OneUptime has been added to when a project picks where notifications go, and to look up a channel's name and members.                                                                                      |
| `im:read`                | When someone runs `/oneuptime incident`, `maintenance` or `page` in the app's direct messages, OneUptime posts the confirmation there and first looks the conversation up (`conversations.info`, `conversations.members`).              |
| `mpim:read`              | When someone runs `/oneuptime incident`, `maintenance` or `page` in a group DM OneUptime has been added to, OneUptime posts the confirmation there and first looks the conversation up (`conversations.info`, `conversations.members`). |
| `channels:join`          | To join the public channel a project chose for notifications, so OneUptime can post there.                                                                                                                                              |
| `channels:manage`        | To create a public channel for each incident when a project turns on incident channels, and to archive it afterwards.                                                                                                                   |
| `groups:write`           | To create a private channel for each incident when a project uses private incident channels, to invite the people involved into it, and to archive it afterwards.                                                                       |
| `channels:write.invites` | To invite the people on call and the incident's owners into an incident channel.                                                                                                                                                        |
| `channels:history`       | To read the thread a person asks OneUptime AI about, and the message someone pins or marks with 📌 to save it as an incident note, in public channels OneUptime is in.                                                                  |
| `groups:history`         | To read the thread a person asks OneUptime AI about, and the message someone pins or marks with 📌 to save it as an incident note, in private channels OneUptime is a member of.                                                        |
| `im:history`             | To read what people send OneUptime in its Messages tab, so it can answer them.                                                                                                                                                          |
| `mpim:history`           | To read messages addressed to OneUptime in group DMs it was added to, so it can answer them.                                                                                                                                            |
| `users:read`             | To show people's names and timezones, and to match Slack users with OneUptime users for paging and on-call.                                                                                                                             |
| `users:read.email`       | To find the Slack member who is a OneUptime user (by email) when paging someone or keeping an on-call user group up to date.                                                                                                            |
| `usergroups:read`        | To list the workspace's user groups so a project can connect one to an on-call schedule.                                                                                                                                                |
| `usergroups:write`       | To keep a connected user group equal to whoever is on call in its schedule, so mentioning the group reaches them.                                                                                                                       |
| `pins:read`              | To receive the `pin_added` event, so a pinned message can be saved as an incident note.                                                                                                                                                 |
| `reactions:read`         | To receive the `reaction_added` event, so a 📌 or 📣 reaction saves a message as a note.                                                                                                                                                |
| `files:write`            | To attach a synthetic monitor's screenshot to the incident message it belongs to.                                                                                                                                                       |

### The first review's feedback (May 2025) and how it was answered

| #   | Slack's item                                                                                | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The Messages tab must answer people and send a welcome on `app_home_opened` the first time. | `SlackMessagesWelcome` welcomes someone the first time they open the Messages tab; `SlackDirectMessageHelp` answers "help" there with the commands, with no AI or connected account needed; other messages go to OneUptime AI. The welcome is remembered in the cache (Valkey), which keeps nothing across a restart, so a restart can welcome someone once more.                                                                                                                                               |
| 2   | Reviewers could not test the web app, incident channels or on-call; add their account.      | The reviewers' project above, with instructions in Testing information.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 3   | The OAuth `state` must be unique and unguessable.                                           | `WorkspaceOAuthState`: 32 random bytes, single use, expiring, bound to the user.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 4   | The landing page must link to the privacy policy.                                           | The Slack docs page has a section on the data the app reads, linking the privacy policy.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 5   | The landing page must describe the integration.                                             | `https://oneuptime.com/docs/workspace-connections/slack`.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 6   | The long description must say how the app works in Slack.                                   | Rewritten in October 2026.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 7   | Minimum scopes: drop `im:read`/`im:write` and the user-token `users:read` if unused.        | Removed the unused `im:write`, `mpim:write`, `channels:write.topic` and the user-token `users:read` from the manifest (PR #4860) and from the production app's configuration (16 October 2026). `im:read` and `mpim:read` stay, for the reason in the scope table. With no user scope Slack returns no user token, so `WorkspaceUserAuthTokenService` accepts an empty one; without that every install would fail. `SlackAppManifest.test.ts` fails if a scope is unused or a called method's scope is missing. |
| 8   | `oneuptime.com` must not accept TLS 1.0 or 1.1.                                             | Verified in October 2026 with `nmap --script ssl-enum-ciphers -p 443 oneuptime.com`, and again on 16 October with `openssl s_client -tls1` and `-tls1_1` (OpenSSL 3 offers them only with `-cipher 'DEFAULT:@SECLEVEL=0'`): the server refuses both with a protocol-version alert. TLS 1.2 and 1.3 connect.                                                                                                                                                                                                     |
| 9   | Write the data policies out instead of linking to them.                                     | Written out in Security and compliance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## Notes for agents driving the browser

- Use the in-app (built-in) browser. It cannot attach files, so a human uploads
  screenshots and other files; save them to `~/Downloads` for them.
- In Slack's forms, set a textarea with a form-fill tool rather than
  select-all and typing, which can splice the new text into the old.
- Inviting an outside address as **Owners** of a OneUptime project is refused as
  a permission grant; **Members** is enough for Slack's reviewers.
- Page-text tools do not see the App Manifest editor's contents. Read them with
  `document.querySelector('.CodeMirror').CodeMirror.getValue()`.
- The built-in browser does not let a page open a new tab (Slack's links to
  OneUptime, for example). Navigate the tab to the link's address instead.
