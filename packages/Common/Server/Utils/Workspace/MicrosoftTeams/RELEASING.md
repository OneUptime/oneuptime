# Publishing the OneUptime Microsoft Teams app

This is the runbook for maintainers and AI agents who change the **OneUptime**
Microsoft Teams app that OneUptime Cloud customers install from the Teams store:
its manifest, its Microsoft Graph permissions, or its store listing. Follow the
repository's [AGENTS.md](../../../../../../AGENTS.md) as well.

It does not cover self-hosted installations: every self-hosted server registers
its own Entra app and uploads the manifest its server generates
([self-hosted Microsoft Teams integration](https://oneuptime.com/docs/self-hosted/microsoft-teams-integration)).

The state below was verified on **15 October 2026**, when version **14.0.59** was
submitted to the Teams store. Recheck the live state before acting: the
versions here are history, not instructions to repeat.

## How a change reaches customers

The app has three parts on Microsoft's side, and each changes on its own:

| Part                                     | What it holds                                                                                                                                 | How a change reaches customers                                                                                                                                                         |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The Teams app package in the store       | `manifest.json` and two icons, built by `MicrosoftTeamsAPI.getTeamsAppManifest()`: bot, commands, resource-specific consent (RSC) permissions | Only after a new package is uploaded to Partner Center and passes Microsoft's certification. Teams then asks each team and chat to accept an update that adds permissions.             |
| The Entra app registration **OneUptime** | The bot's identity and the Microsoft Graph permissions (application and delegated) OneUptime calls with                                       | As soon as the permission is added, for new admin consents. A customer that consented earlier gets it only after an admin grants consent again (**Grant Admin Consent** in OneUptime). |
| The server code                          | What the bot does                                                                                                                             | When the release containing it is deployed.                                                                                                                                            |

Code that changes `getTeamsAppManifest()` therefore needs a store update after
it is released, and code that calls a new Graph endpoint needs the permission
added to the Entra app first.

## Identifiers

| Item                                                             | Value                                                                                         |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Microsoft tenant                                                 | **HackerBay** (`oneuptimehq.onmicrosoft.com`)                                                 |
| Account used for Entra and Partner Center                        | `NawazDhandala@oneuptimehq.onmicrosoft.com`                                                   |
| Entra app **OneUptime** (client ID = Teams app ID = bot ID)      | `0e5480fd-a9c5-4ad3-9c0b-9f6045318daf`                                                        |
| Entra app **OneUptime Meetings** (video calls)                   | `b7805806-13a4-4ecd-bdfc-8d91944b5a46`                                                        |
| Entra app **OneUptime Sign-in** (Sign in with Microsoft)         | `c6386dbb-d994-4a14-81ce-5e8a64a79506`                                                        |
| Verified publisher each of the three must show (Partner Network) | **HackerBay Inc**, MPN ID `7025026`                                                           |
| Partner Center offer **OneUptime**                               | Apps and agents for Microsoft 365 and Copilot, product `46ee157b-5751-49f9-8fdd-e323534d700a` |
| Teams Developer Portal                                           | No app is registered there. Do not create one: the store app lives in Partner Center.         |

The client IDs are public: `MICROSOFT_TEAMS_APP_CLIENT_ID` and
`MICROSOFT_TEAMS_MEETINGS_APP_CLIENT_ID` in `https://oneuptime.com/dashboard/env.js`.

Entry points:

- [Partner Center offer](https://partner.microsoft.com/dashboard/v2/marketplace-offers/office/products/46ee157b-5751-49f9-8fdd-e323534d700a/overview)
  ([Packages](https://partner.microsoft.com/dashboard/v2/marketplace-offers/office/products/46ee157b-5751-49f9-8fdd-e323534d700a/packages),
  [Review and submit](https://partner.microsoft.com/dashboard/v2/marketplace-offers/office/products/46ee157b-5751-49f9-8fdd-e323534d700a/submit))
- [Entra: OneUptime API permissions](https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/~/CallAnAPI/appId/0e5480fd-a9c5-4ad3-9c0b-9f6045318daf)
- [Entra: OneUptime Meetings API permissions](https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/~/CallAnAPI/appId/b7805806-13a4-4ecd-bdfc-8d91944b5a46)

Partner Center may open a personal Microsoft account first and show a "We're
updating our terms" page. That is the wrong account, not a blocker: sign in
with the work account above.

## Publisher verification

Certification checks that every Microsoft consent screen a reviewer meets
shows the blue "verified" badge (policy 1140.6.1). Reviewers meet three Entra
apps, not one: **OneUptime** when an admin grants consent, **OneUptime
Meetings** when they start a video call, and **OneUptime Sign-in** when they
use **Sign in with Microsoft** on the OneUptime sign-in page - which they do
when they sign up to test. 14.0.59 failed this check on **OneUptime Sign-in**
alone: it was created on 16 October 2026 for Sign in with Microsoft and never
verified, so its consent screen said "unverified".

Every Entra app a customer can consent to must, on **Branding & properties**:

1. have **Publisher domain** `oneuptime.com` (a DNS-verified domain of the
   tenant; an `onmicrosoft.com` domain cannot be verified);
2. have **Home page URL** `https://oneuptime.com`, **Terms of service URL**
   `https://oneuptime.com/legal/terms` and **Privacy statement URL**
   `https://oneuptime.com/legal/privacy` - the consent screen says "The
   publisher has not provided links to their terms" without them;
3. be verified: **Add MPN ID to verify publisher**, MPN ID `7025026`, tick
   the Microsoft Platform Policies box (a maintainer's decision), **Verify and
   save**. The consent screen then names **HackerBay Inc** with the badge.

Check all of them at once (read-only):

```bash
for app in 0e5480fd-a9c5-4ad3-9c0b-9f6045318daf b7805806-13a4-4ecd-bdfc-8d91944b5a46 c6386dbb-d994-4a14-81ce-5e8a64a79506; do az rest --method get --url "https://graph.microsoft.com/v1.0/applications(appId='$app')?\$select=displayName,publisherDomain,verifiedPublisher"; done
```

On 25 October 2026 **OneUptime** (since October 2025) and **OneUptime
Meetings** were verified. **OneUptime Sign-in** was given its publisher domain
and URLs that day; its MPN ID step waits for a maintainer to accept the
Microsoft Platform Policies. A new multitenant Entra app is verified the same
way before it ships.

## Releasing a new store package

1. **Confirm the code is live.** `APP_VERSION` in
   `https://oneuptime.com/dashboard/env.js` is the running release; check that
   it contains your manifest change.
2. **Get the package production generates.** `GET
https://oneuptime.com/api/microsoft-teams/app-manifest-zip` returns it
   without sign-in; it is the same file as **Project Settings** > **Workspace**
   > **Microsoft Teams** > **Download App Manifest Zip**. To build it from a
   > commit instead, run a throwaway Jest test in `packages/Common` that writes
   > `getTeamsAppManifest()` to a file, with
   > `MICROSOFT_TEAMS_APP_CLIENT_ID=0e5480fd-a9c5-4ad3-9c0b-9f6045318daf`,
   > `HOST=oneuptime.com`, `HTTP_PROTOCOL=https` and `APP_VERSION=<version>` set,
   > set `icons.color` and `icons.outline` to `color.png` and `outline.png` as the
   > route does, and zip `manifest.json` with
   > `packages/Common/Server/Images/MicrosoftTeams/color.png` and `outline.png`.
   > Delete the test file afterwards.
3. **Check the version.** It must be higher than the version on Partner
   Center's **Packages** page. Release builds use `APP_VERSION`, so this holds
   for any newer release.
4. **Validate** `manifest.json` against Microsoft's schema for its
   `manifestVersion` (`https://developer.microsoft.com/json-schemas/teams/v<version>/MicrosoftTeams.schema.json`),
   for example with the `ajv` package in the repo's `node_modules`.
5. **Upload.** On the offer's **Packages** page, drop the zip on "Drag your
   packages here". It replaces the package in the draft. Wait for "Manifest
   checks passed", then **Save draft**. The built-in browser cannot attach
   files: save the zip to `~/Downloads` and ask a human to drop it in.
6. **Review and publish.** The page lists every section with changes. **Notes
   for certification** are required and are not kept from the last submission:
   use the template below, and have a human add the test account's sign-in.
   Never type a password yourself.
7. **Publish** is a maintainer's decision. The offer's overview then shows
   Pre-processing, Certification and Publish. Certification of the first
   version took four days.
8. **After it is live**, customers' Teams asks each team and chat to accept the
   update when it adds permissions. Say so in the release notes.

### Validation messages seen so far

| Message                                                | Kind    | Meaning                                                                                                                                                                                               |
| ------------------------------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SubmissionContextMissingSupportsChannelFeatures`      | Error   | Partner Center requires `"supportsChannelFeatures": "tier1"`, which needs manifest v1.25 or later. The manifest declares both since 14.0.59; the tests in `MicrosoftTeamsManifest.test.ts` hold them. |
| `WebApplicationInfoAppIdDiffersFromBotIdSsoSuggestion` | Warning | A suggestion for bot single sign-on (`api://botid-…`). OneUptime does not use bot SSO; the warning does not block a submission and was present on the certified 9.1.2 package.                        |

### Notes for certification template

Reviewers test with the account the notes give them, or else sign up and
create a project of their own - one with no AI credits, no on-call schedule
and the Free plan, where `ask`, `oncall` and `page` cannot work (14.0.59's
`ask` failed that way). Give them a test project that has, and keep it so
while the app is listed: **AI credits** (Project Settings > AI > AI Credits),
the **Growth plan** (paging needs it), an **on-call policy** with an
**on-call schedule** the test user is on, and a monitor or two. Attach the
steps as a PDF under **Additional certification info** too: it is kept for
later submissions, and it is what reviewers look for.

```text
>>> TEST ACCOUNT: sign-in email and password for https://oneuptime.com, and the project to use <<<

OneUptime (https://oneuptime.com) is an observability and incident management platform. This Teams app is a bot: it posts incident, alert and scheduled maintenance notifications to the channels and chats a project picks, and lets people act on them from Teams.

How to test:
1. Sign in to OneUptime with the test account and open Project Settings > Workspace > Microsoft Teams to see the connection. Before an organization is connected, "help" says what the app does and how to get started.
2. Add the OneUptime app to a team and to a personal chat. It can also be added to a shared or private channel.
3. In the personal chat, type "help" to list the commands, or "home" for the Home card. The first time, the bot shows a Connect button to link your Microsoft Teams account to the OneUptime test account.
4. In a channel, mention @OneUptime with a command: incident <title>, maintenance <title>, oncall, page @someone <message>, ask <question>, show active incidents, show active alerts, show scheduled maintenance, show ongoing maintenance.
5. "oncall": lists who is on call now in each on-call schedule of the project, until when, and who is next.
6. "page @someone <message>" in a channel or group chat pages the people mentioned (an alert, then a call, SMS, push or email by their notification rules) and posts a card that shows who was paged and who acknowledged. "page" alone opens a card to pick a person, a team, an on-call schedule or an on-call policy.
7. "ask <question>" (or any question) is answered by OneUptime AI from the project's data, for example "ask which monitors are down right now?" or "ask what changed before the last incident?". Answers are labelled AI generated, end with a line asking you to check them, and have thumbs-up/down buttons to report an answer.

OneUptime AI: a generative AI assistant (a large language model) that answers questions from the project's logs, traces, metrics, incidents and monitors, read with the asking user's own permissions. It never changes anything. Admins can turn it off per project. Reports of wrong or inappropriate answers come from the thumbs-down button or support@oneuptime.com and reach the OneUptime team.

Changes since the last version:
- <what changed in the manifest: commands, permissions, channel support>
```

### Store history

| Submitted  | Version | What changed                                                                                                                                                                                                                                                     | Outcome                                                          |
| ---------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 2025-12-05 | 9.1.2   | First listing: 3 RSC permissions, 7 commands.                                                                                                                                                                                                                    | Certified and published 2025-12-09.                              |
| 2026-10-15 | 14.0.59 | Manifest v1.25 with `supportsChannelFeatures: tier1`; RSC `ChatMessage.Read.Chat`, `ChatMember.Read.Chat`, `ChatSettings.Read.Chat`, `TeamsAppInstallation.Read.Group` added; commands became incident, maintenance, oncall, page, ask, the show lists and help. | Certification failed 2026-10-25: four Must-fix items, see below. |

Add a row for every submission.

### Certification feedback for 14.0.59

Microsoft's report for 14.0.59 (25 October 2026, ticket 5877223, by email
from teamsubm@microsoft.com and in Partner Center) had four Must-fix items.
Its email asks not to resubmit until they approve the fixes in that thread,
and to send any changed manifest there first.

| Policy                                           | What they saw                                                                         | Root cause and fix                                                                                                                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1140.4.3.4 Bots - Bot Welcome Message            | "help" before connecting answered "Sorry, I couldn't find your project configuration" | The tenant had to resolve before any command. The help now works before connecting, says what the app is for, and ends with a way forward (MicrosoftTeamsCommands.replyHelp).                           |
| 100.14.1 Testing Instructions                    | `ask` said "Please try again later"; no test steps for ask, oncall and page           | Their own new project had no AI credits; the bot checked the AI switch and the daily limits but not the credits, and hid the refusal (WorkspaceAiRefusal). Test steps: the template above.              |
| 1140.4.1.24 General - App Description            | `ask` names OneUptime AI; nothing described it                                        | The description now says what OneUptime AI does, that answers can be wrong and how to report one; each answer carries Teams' AI label, a "check it" line and feedback buttons (MicrosoftTeamsAiAnswer). |
| 1140.6.1 Publisher Attestation - M365 Compliance | "OneUptime Sign-in unverified" on a consent screen                                    | That Entra app was never publisher-verified. See [Publisher verification](#publisher-verification).                                                                                                     |

A 👍 or 👎 on an AI answer reaches the operator's Slack channel set with
`NOTIFICATION_SLACK_WEBHOOK_ON_AI_FEEDBACK` (Helm
`notifications.webhooks.slack.onAiFeedback`). OneUptime Cloud must set it:
reports of inappropriate AI content must reach the team, who act on them.

## Microsoft Graph permissions

The Entra app **OneUptime** had these on 15 October 2026, all with admin
consent granted for HackerBay:

| Type        | Permissions                                                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Delegated   | `User.Read`, `Team.ReadBasic.All`, `Channel.ReadBasic.All`, `ChannelMessage.Send`                                             |
| Application | `Team.ReadBasic.All`, `Channel.ReadBasic.All`, `Channel.Create`, `TeamworkTag.ReadWrite.All` (on-call tags, added 2026-10-15) |

The self-hosted guide also lists two optional application permissions that are
not on the Cloud app: `TeamsAppInstallation.ReadForTeam.All` and
`Chat.ReadBasic.WhereInstalled`. The manifest's RSC permissions
`TeamsAppInstallation.Read.Group` and `ChatSettings.Read.Chat` cover the same
needs per team and chat.

**OneUptime Meetings** has delegated `openid`, `profile`, `email`,
`offline_access`, `User.Read` and `OnlineMeetings.ReadWrite`, matching
`MICROSOFT_TEAMS_MEETINGS_SIGN_IN_SCOPES`.

A sign-in for a project that records and transcribes its incident calls also
asks for the delegated `Calendars.ReadWrite` and
`OnlineMeetingTranscript.Read.All` (`MICROSOFT_TEAMS_MEETINGS_RECORDING_SCOPES`,
added in October 2026). Microsoft asks for them at sign-in whether or not the
app registration lists them, but add both to **OneUptime Meetings** as
delegated permissions all the same: a customer's administrator who grants
consent for the organization from **Enterprise applications** grants only the
permissions the app registration lists. `OnlineMeetingTranscript.Read.All`
always needs an administrator's consent. Check the live app before assuming
they are there.

To add a permission: **API permissions** > **Add a permission** > **Microsoft
Graph** > **Application** (or **Delegated**) **permissions**, tick it, **Add
permissions**, then **Grant admin consent for HackerBay**. Granting consent only
affects OneUptime's own tenant. Customers' admins grant it in their tenants with
OneUptime's **Grant Admin Consent**, which asks for `https://graph.microsoft.com/.default`,
that is every permission configured here. Update the permission lists in
`packages/App/FeatureSet/Docs/Content/*/self-hosted/microsoft-teams-integration.md`
and `MicrosoftTeamsIntegrationDocumentation.tsx` in the same change.
`MicrosoftTeamsManifest.test.ts` fails when their lists of RSC permissions
differ from the manifest's.

## Notes for agents driving the browser

- The Entra admin center renders very small in the built-in browser. Work from
  `read_page` and `find` references, not coordinates. In **Request API
  permissions**, the checkbox is the "Selected/Unselected" image in a row's
  first cell, not the permission's label.
- Partner Center pages take several seconds to fill in; wait before reading.
- The browser pane can lose its tabs; reopen Partner Center by URL.
