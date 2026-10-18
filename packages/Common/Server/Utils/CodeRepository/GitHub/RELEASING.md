# Running the OneUptime GitHub Apps

This is the runbook for maintainers and AI agents who change the GitHub Apps
that OneUptime Cloud customers install, their settings on GitHub, or what the
code expects of them. Follow the repository's
[AGENTS.md](../../../../../../AGENTS.md) as well.

It does not cover self-hosted installations: every self-hosted server registers
a GitHub App of its own
([self-hosted GitHub integration](../../../../../App/FeatureSet/Docs/Content/en/self-hosted/github-integration.md)).
Keep that guide in step when you change what the code needs from an app, since
self-hosters copy their settings from it.

The state below was verified on **18 October 2026**, after an end-to-end test of
release 14.0.64 on test.oneuptime.com. Recheck the live state before acting:
the dates and versions here are history, not instructions to repeat.

## How a change reaches customers

A GitHub App's settings live on GitHub, not in this repository. Merging code
changes none of them, and changing them changes no code. Know which of these
your change touches.

| What                                                                  | Where it lives                                                                                      | When it takes effect                                                                                                                                                                                                                   |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Permissions and webhook events                                        | The app's **Permissions & events** page on GitHub                                                   | New installations get them at once. Every existing installation keeps its old permissions **and its old events** until an owner of the account accepts the new set; GitHub emails them and shows the request on the installation page. |
| Callback URL, OAuth during installation, webhook URL and secret, logo | The app's **General** page on GitHub                                                                | At once, for every installation.                                                                                                                                                                                                       |
| Which accounts may install it                                         | The app's **Advanced** page (public or private)                                                     | At once.                                                                                                                                                                                                                               |
| What OneUptime does with webhooks, tokens and the install callback    | The server code (below)                                                                             | When the release containing it is deployed.                                                                                                                                                                                            |
| Which app a server uses, and its secrets                              | The server's `GITHUB_APP_*` environment variables (Helm `gitHubApp.*`, `config.env` `GITHUB_APP_*`) | When the server restarts with them.                                                                                                                                                                                                    |

So the order matters:

- **Code that needs more from the app** (a new permission, a new event): change
  the app first, then deploy the code. Asking GitHub for a token permission the
  app does not hold fails with 422. Existing installations still lack it until
  they accept, so the code must cope with that (see how
  `SyncPullRequestStates` retries without `checks: read`).
- **Code that needs less**: deploy the code first, then remove the permission
  or event.
- **A new URL or secret**: change the app and the server's configuration
  together. A secret that differs between the two refuses every webhook.

## Apps and identifiers

All three apps are owned by the GitHub organization **OneUptime**. Manage them at
[github.com/organizations/OneUptime/settings/apps](https://github.com/organizations/OneUptime/settings/apps).
Any organization owner can; GitHub asks them to re-authenticate (security key or
password) before it shows an app's settings. Do not create replacement apps:
every customer installation belongs to one of these.

| App                | Slug             | App ID    | Client ID              | Points at                          | Visibility | Server                                                              |
| ------------------ | ---------------- | --------- | ---------------------- | ---------------------------------- | ---------- | ------------------------------------------------------------------- |
| **OneUptime**      | `oneuptime`      | `2488661` | `Iv23liN2DP9Q1XWj2aWD` | `https://oneuptime.com`            | Public     | oneuptime.com (`GITHUB_APP_NAME=oneuptime`)                         |
| **OneUptime Test** | `oneuptime-test` | `2488605` | `Iv23liqQOsBffh7nSMJs` | `https://test.oneuptime.com`       | Public     | test.oneuptime.com (`GITHUB_APP_NAME=oneuptime-test`)               |
| **OneUptime Dev**  | `oneuptime-dev`  | `2464862` | `Iv23li5zbpG7UXXV9NQC` | `https://oneuptimedev.genosyn.com` | Private    | A development server. Not reviewed in October 2026; see Known gaps. |

- The public install pages are `https://github.com/apps/oneuptime` and
  `https://github.com/apps/oneuptime-test`. Installing from there connects
  nothing to a project by itself: customers start from **Code Repositories** in
  OneUptime, or, if they installed from GitHub first, use **Connect an existing
  installation** there.
- A server's `GITHUB_APP_NAME` and `GITHUB_APP_CLIENT_ID` are public: read them
  from `https://<host>/dashboard/env.js`, next to `GIT_SHA` and `APP_VERSION`.
  The other four values (App ID, client secret, private key, webhook secret) are
  only in the deployment's configuration.
- OneUptime Test is also installed on the **OneUptime** organization itself
  (installation `166557892`, repository `OneUptime/oneuptime` only). Leave it
  alone unless you are testing with it.

## What the code needs from an app

Every row below is something a live app was once missing, and what broke.

| Setting                                                    | Required value                                                                                                    | Without it                                                                                                                                                                                                                                           |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Request user authorization (OAuth) during installation** | On                                                                                                                | GitHub sends no `code` back after an install, and `GitHubAPI` refuses every connection ("GitHub did not confirm who installed the app"). Turning it on greys out **Setup URL** and **Redirect on update**; that is expected.                         |
| **Callback URL**                                           | Exactly `https://<host>/api/github/auth/callback`, with **Allow wildcard matching** off                           | Installs, and the "Connect an existing installation" sign-in (`/github/connect-existing-url` sends `redirect_uri`, which must match exactly), cannot come back.                                                                                      |
| **Webhook**                                                | Active; URL `https://<host>/api/github/webhook`; secret equal to `GITHUB_APP_WEBHOOK_SECRET`; SSL verification on | Repository sync, uninstall clean-up and every `@mention` stop. Until 16 October 2026 the production app's URL was the docs placeholder `https://your-oneuptime-domain.com/api/github/webhook`, and every delivery failed.                            |
| **Repository permissions**                                 | Contents: write · Pull requests: write · Issues: write · Checks: read · Metadata: read. Nothing else              | Missing Issues: the bot hears mentions and cannot answer (pull request comments go through the issues API). Missing Checks: fix pull requests' CI stays unverified. Extra permissions only make the install screen ask for more than OneUptime uses. |
| **Webhook events**                                         | Issue comment · Issues · Pull request · Pull request review · Pull request review comment                         | The bot never hears mentions, assignments, trigger labels or review requests. `installation` and `installation_repositories` arrive without subscribing. Push and Workflow run are not used: do not subscribe them.                                  |
| **Where can this GitHub App be installed?**                | Any account (public)                                                                                              | A private app installs only on the OneUptime organization, which already has it, so **Connect with GitHub App** leads nowhere.                                                                                                                       |
| **GitHub App name**                                        | Anything; the slug is derived from it                                                                             | Nothing breaks: the install link uses the slug GitHub reports (`GET /app`), and mentions use it too. Don't rename a live app: if its slug changes, so does every customer's `@mention` handle and the app's install link.                            |

The code reads these through `GitHubAPI` (`/github/install-url`,
`/github/connect-existing-url`, `/github/auth/callback`, `/github/webhook`), the
token requests in `GitHub.ts`, `GitHubConversation.ts`, `AIAgentDataAPI` and
`SyncPullRequestStates`, and the events in `GitHubWebhookEvents.ts`. A change to
any of them that needs a new permission or event must update the table above,
the self-hosted guide, and both live apps.

### How connecting works, so you can tell what broke

1. **Connect with GitHub App** (`/github/install-url`) sends the browser to
   `github.com/apps/<slug>/installations/new` with a one-use state.
2. After **Install & Authorize**, GitHub redirects to the callback with
   `installation_id` and an OAuth `code`. OneUptime trades the code for the
   person's GitHub identity and connects the installation only if that account
   administers it: the account itself for a personal account, or admin on every
   repository the installation can access for an organization.
3. An account that already has the app cannot come back through step 2: GitHub
   opens the existing installation's settings, drops the state and sends nobody
   back. **Connect an existing installation** (`/github/connect-existing-url`)
   signs the person in to GitHub instead. One installation they administer is
   connected; several are offered in a picker.
4. Webhooks then keep the repositories in sync: added and removed repositories,
   and an uninstall, which disconnects the project's repositories. Connecting
   again reattaches them.

## Changing an app's settings

1. **Read the live settings first.** The settings pages show input values only
   to scripts, so read them in the page (see
   [Notes for agents driving the browser](#notes-for-agents-driving-the-browser)).
   Compare them with [What the code needs from an app](#what-the-code-needs-from-an-app).
2. **Get a maintainer's approval for the exact change** to the production app.
   It applies to every customer installation.
3. **Change the test app first**, test it (below), then the production app.
4. **Permissions or events:** on **Permissions & events**, write a note in
   **Add a note to users**. GitHub shows it to every installation owner with the
   approval request. Say what is added and why, and what is removed.
5. **Save, reload, and read the settings back.**
6. **Check deliveries.** On **Advanced**, **Recent Deliveries** lists every
   webhook and its response. A green check is a 2xx from OneUptime. After a
   webhook URL or secret change, wait for a new delivery or redeliver one, and
   open it: the response should be `{"success":true,"message":"Webhook received",…}`.
   Deliveries hold customers' repository names and payloads: read only what you
   need.
7. Add a row to [Configuration history](#configuration-history).

### Rotating a secret

The client secret, private key and webhook secret are each set in two places:
the app on GitHub and the server's configuration. Change both in one go, then
check Recent Deliveries (webhook secret) and a fresh connect (client secret,
private key). GitHub keeps more than one client secret and private key at a
time, so add the new one, deploy it, then delete the old one.

## Testing end to end

Use **OneUptime Test** and test.oneuptime.com. In October 2026 the test used the
project **OneUptime Kubernetes** (`689f90f9-8e97-494a-8d16-23519981d04d`), which
has the plan Code Repositories needs, and a private scratch repository on a
maintainer's personal account. Its **AI Tasks** page showed the shared
**OneUptime AI** provider and the **Global AI Agent** online, so AI runs needed
no setup; check that page first.

1. Confirm the server runs the release under test:
   `git merge-base --is-ancestor <merge commit> <GIT_SHA from env.js>`.
2. **Install**: Code Repositories → **Connect with GitHub App** → the scratch
   account → **Only select repositories** → the scratch repository →
   **Install & Authorize**. Expect "GitHub connected" and the repository listed
   with Connection **GitHub App**.
3. **Mentions**: on an issue, `@oneuptime-test help` gets the command list within
   seconds.
4. **AI run**: `@oneuptime-test implement this` on a small issue gets 👀 and
   "On it", then, within a couple of minutes, "✅ Done — Opened #N". The AI task's
   **Pull Requests** tab lists the pull request.
5. **Existing installation**: **Connect an existing installation**. With several
   installations, pick the scratch account; expect "GitHub connected" and no
   duplicate row.
6. **Uninstall and reconnect**: uninstall the app from the account on GitHub.
   The repository's Connection changes to "Access Token". Install again from
   Code Repositories: the same row is back to **GitHub App**, and a mention
   still gets an answer.
7. **Clean up**: uninstall the app, delete the scratch repository, and delete
   its row in Code Repositories. The two deletions are permanent, so a person
   does them.

## Verification and the GitHub Marketplace

Customers do not need the Marketplace: a public app installs from Code
Repositories. Listing it only adds a page on GitHub Marketplace where people can
discover it.

- **Publisher verification** (organization settings → **Publisher
  Verification**) needs the organization's profile (picture, name, location,
  verified email), two-factor authentication required for members, and a
  verified domain. All were done by 18 October 2026: location set, `hello@oneuptime.com`
  verified, `oneuptime.com` verified (the organization now shows "Verified").
  Verification was requested on **18 October 2026** and was pending GitHub's
  review. GitHub emails the outcome.
- The verified-publisher badge shows on Marketplace listings only. It does not
  change the app's install page.
- **A free listing** needs a public app, a description, a logo, screenshots,
  working privacy policy and support links, and webhook handling for plan
  changes (`marketplace_purchase` events; OneUptime acknowledges them and does
  nothing).
- **Paid plans elsewhere:** GitHub requires a product that sells a paid version
  outside the Marketplace to offer a paid plan in the Marketplace once its free
  listing meets the paid-app requirements (100 installations). That means
  GitHub billing and handling `marketplace_purchase` for real. Decide that
  before listing.
- The app was not listed in October 2026.

## Configuration history

| Date       | App                       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-10-16 | OneUptime, OneUptime Test | **Request user authorization (OAuth) during installation** turned on: every connect had been refused without it. Callback wildcard matching turned off. Events Issue comment, Issues, Pull request review, Pull request review comment subscribed; Push and Workflow run unsubscribed. Permissions set to the documented five (Checks: read added; Actions, Commit statuses, Members, Email addresses removed), with a note to installers. |
| 2026-10-16 | OneUptime                 | Webhook URL changed from the docs placeholder `https://your-oneuptime-domain.com/api/github/webhook` to `https://oneuptime.com/api/github/webhook`. Deliveries succeed since; the webhook secret already matched.                                                                                                                                                                                                                          |
| 2026-10-16 | OneUptime Test            | Made public, so it can be installed outside the OneUptime organization.                                                                                                                                                                                                                                                                                                                                                                    |

Add a row whenever you change a live app.

### Code changes that came with it

Released in **14.0.64** (PR #4886, with docs in #4889 and #4890 and the Runner
reporting in #4894 and #4897):

- `AIAgentTaskPullRequest.pullRequestId` became a `bigint`. GitHub's pull request
  IDs had passed 2^31, so every pull request the agent opened failed to record
  ("Failed to record pull request").
- **Connect an existing installation**, and connecting only by an account that
  administers the installation.
- The install link uses the app's slug, not `GITHUB_APP_NAME`; connecting again
  reattaches the project's repositories; editing a comment that already
  mentioned the app does not start another run.

## Known gaps

- A repository whose installation was removed shows Connection **Access Token**
  in Code Repositories. No such connection exists any more; it means "not
  connected".
- **OneUptime Dev** still has **Request user authorization (OAuth) during
  installation** off and was not otherwise reviewed. Its server cannot connect
  installations until that is on.

## Notes for agents driving the browser

- Use the in-app (built-in) browser. A person must complete GitHub's **Confirm
  access** screen (security key or password); it lasts a few hours.
- The built-in browser drops native confirmation dialogs, so buttons with
  `data-confirm` — **Make public**, **Uninstall** — seem to do nothing. Once a
  person has asked for the action, accept it in the page:
  `window.confirm = () => true`, then click the button, and check the flash
  message ("The GitHub App is now public", "A job has been queued to uninstall").
  Never do this for a deletion: deleting data is a person's click.
- Read the **General** page's values with
  `document.querySelectorAll('form input')` (`integration[request_oauth_on_install]`,
  `integration[application_callback_urls_attributes][0][matching_strategy]`,
  `integration[hook_attributes][url]`, …).
- On **Permissions & events**, the selected level of each permission is in the
  hidden inputs `integration[default_permissions][<name>]`, and the events are
  checkboxes named `integration[default_events][]`. Each level is a menu item
  with the id `integration_permission_<name>_<level>`, so clicking
  `#integration_permission_checks_read` sets Checks to read. Read the hidden
  inputs back before you save, and again after a reload.
- **Recent Deliveries** rows are `li.hook-delivery-item`; the icon in
  `.item-status` is `octicon-check` (delivered) or `octicon-alert` (failed). A
  row's request and response load from its `data-deferred-details-content-url`.
- The **Configure** link that GitHub's account picker shows for an account that
  already has the app drops the `state`. That is why **Connect an existing
  installation** exists. Don't try to connect through it.
