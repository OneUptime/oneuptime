# Publishing the OneUptime Meetings Zoom app

This is the runbook for maintainers and AI agents who change **OneUptime
Meetings**, the Zoom app behind one-click **Connect** for Zoom on OneUptime
Cloud: its settings in the Zoom App Marketplace, its Marketplace listing, or
what the code expects of it (scopes, redirect URLs, events). Follow the
repository's [AGENTS.md](../../../../../AGENTS.md) as well.

It does not cover self-hosted installations: a self-hosted server that wants
one-click Connect for Zoom creates a Zoom app of its own
([One-click connect on a self-hosted server](../../../../App/FeatureSet/Docs/Content/en/workspace-connections/video-calls.md#one-click-connect-on-a-self-hosted-server)).
Keep that section in step when you change what the code needs from the app,
since self-hosters copy their settings from it. Nor does it cover a
project's own Zoom Server-to-Server OAuth app (**Use your own Zoom app**),
which the project creates for itself.

The state below was verified on **17 November 2026**, four days after Zoom
returned the update that added the call transcript scopes. Both servers ran
14.3.0. Recheck the live state before acting: the dates and versions here are
history, not instructions to repeat.

## How a change reaches customers

The app's settings live in the Zoom App Marketplace, not in this repository.
Merging code changes none of them, and changing them changes no code.

| What                                                                           | Where it lives                                                                                             | When it takes effect                                                                                                                                             |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The scopes a person grants when they connect                                   | The app's **Scopes** page. The code asks for none: the authorize URL in `ZoomOAuthApp` sends no `scope`    | Development: at once. Production: only once Zoom has approved the update. A person who connected earlier keeps the scopes they granted until they **Reconnect**. |
| Redirect URLs, the OAuth allow list, the deauthorization endpoint, the listing | The app's pages in the Zoom App Marketplace                                                                | Development: at once. Production: through Zoom's review of the update, like the scopes.                                                                          |
| What OneUptime does with the scopes and events                                 | The server code (below)                                                                                    | When the release containing it is deployed.                                                                                                                      |
| Which app a server uses, and its secrets                                       | The server's `ZOOM_APP_*` environment variables ([The servers' configuration](#the-servers-configuration)) | When the server restarts with them.                                                                                                                              |

So the order matters:

- **Code that needs a new scope**: merge the code first, written so that a
  connection without the scope still works and says what to do (as
  `ZoomTranscriptClient` does: a sign-in without the transcript scopes still
  starts calls, and **Get from Zoom** asks for **Reconnect**). Let it reach
  both servers. Then add the scope to the app, test it on test.oneuptime.com
  and submit the update ([Submitting an update](#submitting-an-update-so-it-passes-review)).
  Every existing connection lacks the scope until someone reconnects it, so
  the code must cope with that forever, not only until Zoom approves.
- **Code that needs less**: deploy the code first, then remove the scope.
- **A new URL or secret**: change the app and the server's configuration
  together. A Secret Token that differs between the two refuses every event.

## The app

| What          | Value                                                                                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name          | **OneUptime Meetings**                                                                                                                                                 |
| App ID        | `Ss8g78dtSy6uOu3wehhqtA`                                                                                                                                               |
| Type          | **General app**, managed by **users** (user-managed): each Zoom user who connects authorizes it for their own Zoom user, rather than an admin for the whole account    |
| Where         | The Zoom App Marketplace's build console ([marketplace.zoom.us](https://marketplace.zoom.us/)), signed in to the Zoom account that owns the app                        |
| Listing       | Published. Installed **From your site**, with the Direct landing URL `https://oneuptime.com/dashboard/connect-return?provider=zoom`                                    |
| Documentation | The listing's Documentation URL points at [Connect in one click](../../../../App/FeatureSet/Docs/Content/en/workspace-connections/video-calls.md#connect-in-one-click) |

Do not create a replacement app: every customer's sign-in belongs to this
one, and a new app would start without any of them and need Zoom's full
review.

The Direct landing URL is where Zoom sends someone who adds the app from the
listing. For someone signed in to oneuptime.com,
`/dashboard/connect-return?provider=zoom` opens **Project Settings** >
**Workspace** > **Video Calls** in the project they have open
(`getConnectReturnPath` in the Dashboard's `ConnectCallbackMessage.ts`). It
always opens production. A reviewer of an update works on
test.oneuptime.com instead, so the review instructions must say so
([the test plan](#the-reviewers-test-plan)).

### The code that uses it

- [OAuth/ZoomOAuthApp.ts](OAuth/ZoomOAuthApp.ts): the authorize URL, the code
  exchange (it refuses a grant without `meeting:write`), `GET /users/me`,
  refreshing, and revoking when a connection is deleted. Zoom answers each
  refresh with a new refresh token. The worker refreshes every sign-in at
  least once a week (`VideoCallOAuthTokenStore`), so Zoom's 90-day expiry of
  an unused refresh token never comes.
- [OAuth/ZoomOAuthEvents.ts](OAuth/ZoomOAuthEvents.ts): checks the signature
  of each event with the Secret Token, answers Zoom's endpoint validation,
  and reads `app_deauthorized`.
- [API/VideoCallOAuthAPI.ts](../../API/VideoCallOAuthAPI.ts): the routes,
  under `/api/video-call-oauth/zoom/`: `authorize-url`, `callback` and
  `events`. On `app_deauthorized` it deletes the sign-in from every
  connection signed in as that Zoom user, which then shows **Not working**.
- [Providers/ZoomMeetingClient.ts](Providers/ZoomMeetingClient.ts): creates
  the meetings.
- [Transcripts/ZoomTranscriptClient.ts](Transcripts/ZoomTranscriptClient.ts):
  reads a meeting's transcript.
- The scope names are constants in
  [VideoCallProviderCatalog.ts](../../../Types/VideoCall/VideoCallProviderCatalog.ts)
  (`ZOOM_OAUTH_*`).
- The user docs are
  [video-calls.md](../../../../App/FeatureSet/Docs/Content/en/workspace-connections/video-calls.md),
  and the privacy policy's **Connected Services** section is in
  [privacy.ejs](../../../../Home/Views/privacy.ejs).

## The two environments

Zoom gives the app two sets of credentials, **Development** and
**Production**. OneUptime runs one on each server:

|                          | Development                                                     | Production                                                 |
| ------------------------ | --------------------------------------------------------------- | ---------------------------------------------------------- |
| Server                   | test.oneuptime.com                                              | oneuptime.com                                              |
| Client ID                | `9jqiv0sYQtei9MlJNWFtuA`                                        | `g7iOncHoRkKOkHhwHKbw`                                     |
| OAuth Redirect URL       | `https://test.oneuptime.com/api/video-call-oauth/zoom/callback` | `https://oneuptime.com/api/video-call-oauth/zoom/callback` |
| Deauthorization endpoint | Not recorded                                                    | `https://oneuptime.com/api/video-call-oauth/zoom/events`   |
| Who can connect          | Zoom users of the account that owns the app                     | Any Zoom user                                              |
| What it is for           | Our own tests, and Zoom's review of every update                | Customers                                                  |

Shared by both: the **OAuth allow list**, which holds both redirect URLs,
with strict mode on (Zoom compares a redirect URL exactly), and the scopes.

What each server must be set to:

- `ZOOM_APP_CLIENT_ID` and `ZOOM_APP_CLIENT_SECRET` are the client ID and
  client secret of **one** environment: Development on test.oneuptime.com,
  Production on oneuptime.com. A server with one environment's ID and the
  other's secret fails every sign-in at the code exchange.
- The server sends `https://<its host>/api/video-call-oauth/zoom/callback` as
  the redirect URL (`VideoCallOAuthApps.getRedirectUri`). It must be that
  environment's OAuth Redirect URL and be on the allow list, or Zoom refuses
  the sign-in before it starts.
- `ZOOM_APP_WEBHOOK_SECRET_TOKEN` is the app's **Secret Token**, under
  **Features** > **Access**. Zoom signs the events it sends to the
  deauthorization endpoint with it.

Check a server without signing in. Nothing below writes anything:

```bash
# The client ID the server uses: the Development one on test.oneuptime.com.
curl -s https://test.oneuptime.com/dashboard/env.js | tr ',' '\n' | grep -E 'ZOOM_APP_CLIENT_ID|APP_VERSION|GIT_SHA'

# An unsigned event. "This event is not signed by Zoom." means the client ID and
# the Secret Token are both set; "Zoom events are not set up on this server"
# means at least one of them is missing.
curl -s -X POST -H 'Content-Type: application/json' -d '{}' https://test.oneuptime.com/api/video-call-oauth/zoom/events

# The callback without a state: it should redirect to
# https://test.oneuptime.com/dashboard/connect-return?provider=zoom&error=link-invalid
curl -s -o /dev/null -w '%{redirect_url}\n' 'https://test.oneuptime.com/api/video-call-oauth/zoom/callback?state=&code=probe'
```

On 17 November 2026 both servers answered all three as expected, each with
its own client ID. The client secret cannot be checked this way: a server
without it offers no **Continue to Zoom** sign-in that can finish, and says
"Connecting Zoom by signing in is not set up on this OneUptime server" when
someone clicks **Connect**.

## The servers' configuration

| Variable                        | Helm value                   | What it is                                                                 | Public                                                                                   |
| ------------------------------- | ---------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `ZOOM_APP_CLIENT_ID`            | `zoomApp.clientId`           | The client ID of the server's environment                                  | Yes: the Dashboard reads it from `/dashboard/env.js` to offer one-click Connect for Zoom |
| `ZOOM_APP_CLIENT_SECRET`        | `zoomApp.clientSecret`       | The client secret of the same environment                                  | No                                                                                       |
| `ZOOM_APP_WEBHOOK_SECRET_TOKEN` | `zoomApp.webhookSecretToken` | The app's Secret Token, which verifies `/api/video-call-oauth/zoom/events` | No                                                                                       |

Where they are wired:

- [config.example.env](../../../../../config.example.env): documented for
  Docker Compose, with the redirect URL and the events endpoint.
- [docker-compose.base.yml](../../../../../docker-compose.base.yml): the
  client ID in `x-common-variables`, the client secret and the Secret Token in
  `x-common-runtime-variables`.
- [\_helpers.tpl](../../../../../HelmChart/Public/oneuptime/templates/_helpers.tpl):
  the client ID in `oneuptime.env.common`, the other two in
  `oneuptime.env.runtime`, each read from `zoomApp.existingSecret` when one is
  named (keys `clientIdKey`, `clientSecretKey`, `webhookSecretTokenKey`).
  The values are `zoomApp` in
  [values.yaml](../../../../../HelmChart/Public/oneuptime/values.yaml), and
  `HelmChart/Public/oneuptime/tests/video-call-apps_test.yaml` tests them.
- [EnvironmentConfig.ts](../../EnvironmentConfig.ts) reads them
  (`ZoomAppClientId`, `ZoomAppClientSecret`, `ZoomAppWebhookSecretToken`) and
  lists `ZOOM_APP_CLIENT_ID` among the values sent to the Dashboard.

The app and the worker both need the client ID and secret: the worker's
daily keep-alive refreshes the sign-ins. A server offers one-click Connect
for Zoom only when both are set (`VideoCallOAuthApps.getCredentials`).

The secrets are only in each deployment's configuration and in the Zoom App
Marketplace. Never write them here, in a pull request, an issue or a chat.
To change one, change it in Zoom and in the server's configuration in one go,
then check the server with the commands above and a fresh connect.

## The scopes, and why each exists

Keep this table equal to the app's **Scopes** page, and use its reasons
wherever Zoom asks why the app needs a scope.

| Scope                                       | Why OneUptime needs it                                                                                                                                                                                                                                                     | Without it                                                                                                                                                                      |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `meeting:write:meeting`                     | To create a Zoom meeting for an incident or alert, hosted by the Zoom user who connected (`POST /users/{userId}/meetings` in `ZoomMeetingClient`). While a project has **Record and transcribe incident calls** on, the meeting is created with cloud recording turned on. | Nothing works. `ZoomOAuthApp.exchangeCode` refuses a grant without it, so the connection is never saved.                                                                        |
| `user:read:user`                            | To learn who connected (`GET /users/me`): the user ID that hosts the meetings and that an `app_deauthorized` event names, and the email shown on the connection's row.                                                                                                     | Every sign-in fails with "Zoom did not say who signed in".                                                                                                                      |
| `cloud_recording:read:list_recording_files` | For **Get from Zoom** on an incident's **Video Call** card, and the automatic fetch after the call: lists the meeting's cloud recording files and downloads its audio transcript (`GET /meetings/{meetingId}/recordings` in `ZoomTranscriptClient`).                       | Calls still start. A transcript kept with the cloud recording cannot be read.                                                                                                   |
| `cloud_recording:read:meeting_transcript`   | For the same, when the meeting has no recording transcript: reads the transcript that AI Companion's meeting summary keeps (`GET /meetings/{meetingId}/transcript`).                                                                                                       | Calls still start. A transcript kept by AI Companion cannot be read. With neither transcript scope, **Get from Zoom** tells the person to reconnect (`getMissingScopeMessage`). |

The two `cloud_recording` scopes came with call transcripts (PR #4959,
October 2026), and were the update Zoom returned in November 2026. A sign-in
made before them still starts calls, and cannot read transcripts until it is
reconnected ([user docs](../../../../App/FeatureSet/Docs/Content/en/workspace-connections/video-calls.md#connect-in-one-click)).

When a scope changes, change all of these together:

1. The app's **Scopes** page.
2. This table.
3. The user docs: the Zoom row of the table under **Connect in one click**,
   and the Zoom item under **One-click connect on a self-hosted server**.
4. The privacy policy's **Connected Services** section
   ([privacy.ejs](../../../../Home/Views/privacy.ejs)), which names each
   scope and says what OneUptime does with the data.
5. The comments on the Zoom app in `config.example.env` and `values.yaml`.
6. The listing's long description, and the release notes of the update.

## Submitting an update so it passes review

An update to the published app (a scope, a redirect URL, the deauthorization
endpoint, the listing) reaches customers only after Zoom reviews it. Zoom
reviews an update **with the Development client ID**, on a staging
environment that is not on localhost and has its own redirect URL, separate
from production's: for OneUptime, that is test.oneuptime.com. Zoom wants a
test plan for every new scope, and release notes for users, because a scope
change asks every existing user to authorize the app again.

### Before you submit

1. **The code is on both servers.** `APP_VERSION` and `GIT_SHA` in each
   server's `/dashboard/env.js` are the running release; check that it holds
   your change with
   `git merge-base --is-ancestor <merge commit> <GIT_SHA>`.
2. **The Development side is complete**, and you have run the whole test plan
   yourself on test.oneuptime.com with a Zoom user of the account that owns
   the app. The reviewer does exactly that, with nobody to ask.
3. **The reviewer has a ready staging account.** A review must not depend on
   email delivery:
   - test.oneuptime.com runs with `BILLING_ENABLED=true`, so an account made
     at `https://test.oneuptime.com/accounts/register` cannot sign in until
     its owner clicks the link in a confirmation email
     (`isEmailVerified = !IsBillingEnabled` in the `/signup` route of
     [Authentication.ts](../../../../App/FeatureSet/Identity/API/Authentication.ts)).
     Staging has no Continue with Google or Microsoft either: its `env.js`
     has empty `GOOGLE_SIGN_IN_CLIENT_ID` and `MICROSOFT_SIGN_IN_CLIENT_ID`.
   - So a maintainer makes the account and the project before submitting: a
     user with an address the team reads (Admin Dashboard > **Users** >
     **Create User**), marked verified (the user's page > **Edit User** > **Email
     Verified** on, which only a master admin can do), and a project the
     user owns or administers. Connecting a video call provider needs
     **Project Owner**, **Project Admin**, **Settings Admin** or **Create
     Video Call Connection**; **Project Member** is not enough. Admin Dashboard >
     **Projects** > **Create Project** asks for no payment details, makes the
     admin its owner, and the project's **Users** page adds the reviewer's
     account to **Owners**. Then sign in as the account once, connect your
     own Zoom user, and delete that connection.
   - Still check that email works: sign up at
     `https://test.oneuptime.com/accounts/register` with an address outside
     OneUptime (a Gmail address, say) and confirm the confirmation email
     arrives within a few minutes and is not in spam. A reviewer may sign up
     on their own instead of using the account, and that sign-up depends on
     it. An unverified account that signs in with its password is emailed a
     fresh link (the `isEmailVerified` check in the `login()` handler of
     `Authentication.ts`), so a reviewer stuck on an unverified sign-up can
     also be unblocked by a master admin turning **Email Verified** on.
4. **The test plan** names the environment, the account and every new
   scope, and starts from test.oneuptime.com. The listing's Direct landing
   URL opens production, where the Development client ID is not used. Use
   [the template below](#the-reviewers-test-plan).
5. **The release notes** say what the update does for users and that people
   who connected before it must reconnect to get it. Use the template below.
6. **The listing matches the app.** The long description says what the app
   does with every scope (with the transcript scopes, that OneUptime reads
   the transcripts of the meetings it started). The Documentation URL opens
   a section that names the scopes. The privacy policy covers the data the
   new scopes read ([Known gaps](#known-gaps)).
7. **A maintainer submits it** and adds a row to
   [Review history](#review-history).

While Zoom reviews the update, keep test.oneuptime.com on a release that
passes the test plan, keep the reviewer's account and project as they are,
and keep the Development settings unchanged.

### The reviewer's test plan

Copy this into the submission, fill in the lines in `>>> <<<`, and drop the
sections the update does not touch. The account and password go only into
Zoom's form, typed by a maintainer.

```text
>>> TEST ACCOUNT: email, password, and project name on https://test.oneuptime.com <<<

ENVIRONMENT
This update is reviewed on our development environment, https://test.oneuptime.com.
It uses the app's Development client ID (9jqiv0sYQtei9MlJNWFtuA) and redirect URL
https://test.oneuptime.com/api/video-call-oauth/zoom/callback. Our production site,
https://oneuptime.com, uses the Production client ID; the listing's Add button opens
production, so please start from the links below instead.

The test account above is ready: its email address is verified, so no confirmation
email is needed. Please use it rather than signing up. Sign in at
https://test.oneuptime.com/accounts/login.

WHAT THE APP DOES
OneUptime is an incident management and observability platform. OneUptime Meetings
starts a dedicated Zoom meeting for every incident or alert, hosted by the Zoom user
who connected it, posts its Join call link wherever the incident's updates go, and
reads the transcript of a meeting it started, so responders keep a record of the
call. Documentation: https://oneuptime.com/docs/workspace-connections/video-calls#connect-in-one-click

CONNECT (authorize the app)
1. Sign in, open the project >>> name <<<, then Project Settings > Workspace > Video
   Calls (or open https://test.oneuptime.com/dashboard/connect-return?provider=zoom).
2. Click Connect on Zoom, then Continue to Zoom. Sign in with your Zoom user and
   click Allow.
3. You return to Video Calls. The Zoom connection is listed with your Zoom user's
   email (user:read:user).

meeting:write:meeting
4. Click Start a test meeting on the connection: a Zoom meeting is created on your
   Zoom user and its link opens it.
5. Open Incidents, click Declare Incident and declare one. On the incident's page,
   the Video Call card has Start call: pick the Zoom connection. A meeting is
   created and its Join call link appears on the card.

cloud_recording:read:list_recording_files
6. Start the meeting from step 5 as its host (you are, as the Zoom user who
   connected), record it to the cloud with its audio transcript on (this needs a
   Zoom user with cloud recording), speak for a minute, and end it.
7. Once Zoom has prepared the transcript (usually within about twice the meeting's
   length), click Get from Zoom on the incident's Video Call card. The transcript
   appears on the card.

cloud_recording:read:meeting_transcript
8. Start another call on the incident (Video Call card > Start another), hold it
   with AI Companion's meeting summary on and without cloud recording, and end it.
   Once Zoom has the summary, Get from Zoom reads the transcript the summary keeps.

AUTOMATIC TRANSCRIPTS (optional)
9. In Project Settings > Workspace > Video Calls, turn on Record and transcribe
   incident calls. New incident meetings are recorded to the cloud, and OneUptime
   fetches the transcript by itself once the call is over.

REMOVE
10. Delete the connection on the Video Calls page: OneUptime revokes its token,
    which removes the app from your Zoom account.

WHAT CHANGED IN THIS UPDATE
>>> each new or changed scope or setting, and the steps above that test it <<<
```

The release notes for users, for a scope change:

```text
OneUptime Meetings can now >>> what the update does, for example: read the
transcript of an incident call it started (Get from Zoom on the incident's
Video Call card) <<<. It asks for >>> the new scopes <<<.

If you connected Zoom before this update, calls keep starting as before.
To >>> use the new feature <<<, open Project Settings > Workspace > Video Calls
in OneUptime and click Reconnect on the Zoom connection.
```

## What only a maintainer can do

Everything at Zoom needs a sign-in to the Zoom account that owns the app,
and some of it a password. No agent can do these from the repository:

1. Sign in to the Zoom App Marketplace and change the app: scopes, redirect
   URLs, allow list, deauthorization endpoint, Secret Token, listing. Get a
   second maintainer's approval for the exact change to the Production side:
   it reaches every customer.
2. Read, copy or regenerate the client secrets and the Secret Token, and put
   them into the servers' configuration.
3. Create the reviewer's staging account and project, set its password, and
   turn **Email Verified** on (a master admin). Granting the account
   **Owners** is a permission grant, which an agent's browser tools refuse.
4. Type the test account's password into the submission, press **Submit**,
   and answer Zoom's reviewers.
5. Delete anything: a connection a customer made, the reviewer's account or
   project after the review, the app.

An agent can do the rest: read the code and the docs, run the checks under
[The two environments](#the-two-environments), keep this guide and the docs
in step, and draft the test plan, the release notes, the scope reasons and
the long description for a maintainer to paste.

## Review history

| Date       | Update                                                                                                                           | Outcome                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-13 | Added `cloud_recording:read:list_recording_files` and `cloud_recording:read:meeting_transcript`, for call transcripts (PR #4959) | Rejected. The app and staging were set up correctly, but the reviewer could not get in: the confirmation email of their sign-up at `https://test.oneuptime.com/accounts/register` never arrived (the email provider, Microsoft, had an outage that day), and the submission never said that test.oneuptime.com is the development environment. The checklist under [Before you submit](#before-you-submit) comes from this review. |

Add a row for every submission.

## Known gaps

Found while writing this guide on 17 November 2026:

- The privacy policy's **Connected Services** section names only
  `user:read:user` and `meeting:write:meeting` for Zoom, and says the data is
  used only to create meetings. It does not mention the `cloud_recording`
  scopes, reading transcripts, or OneUptime AI reading them. Update it before
  the transcript scopes are submitted again.
- The comments on the Zoom app in `config.example.env` and `values.yaml` list
  only `meeting:write:meeting` and `user:read:user`; the user docs list all
  four scopes. So does the header comment of `ZoomOAuthApp.ts`.
- This guide does not record which Zoom account owns the app, or whether the
  Development side has a deauthorization endpoint. Add both the next time a
  maintainer signs in.
