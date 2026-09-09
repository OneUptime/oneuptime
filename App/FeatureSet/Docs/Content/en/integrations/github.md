# GitHub Integration

Connect GitHub to your incident response with the OneUptime GitHub App. Comments on issues and pull requests, reviews, issue changes, CI results, releases, and deployments can start a OneUptime workflow. The same workflow can create an incident or alert, send a notification, and write back to GitHub.

You choose the actions in a workflow. Installing the App imports its repositories and keeps repository access synchronized; it does not automatically turn comments into incidents or start AI tasks.

## Connect GitHub

1. Open **Products > Code Repositories** in your OneUptime project.
2. Select **Connect with GitHub App** and install or update the App for the repositories you want to use.
3. Complete the GitHub authorization and return to OneUptime. Repositories in the installation are imported automatically.
4. On self-hosted OneUptime, configure the App and its event subscriptions using the [self-hosted setup guide](/docs/self-hosted/github-integration).

GitHub actions use the connected App's installation credentials. You do not need to create a personal access token or put GitHub secrets in workflow variables. A workflow can access only repositories connected to its own project through an active installation.

Removing repository access or uninstalling the App disconnects those repositories while preserving their configuration. Restoring access reconnects the existing records, so workflows that reference them can resume without being recreated.

## Start with a template

The **Put GitHub events to work** panel on Code Repositories opens these templates directly. You can also find them under **Workflows > Create Workflow > Integrations**, or search the template picker for GitHub.

| Template                                         | Trigger                                                                            | Result                                                   |
| ------------------------------------------------ | ---------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Declare an incident from a GitHub comment        | A new issue or pull request conversation comment begins with `@oneuptime incident` | Create an incident and reply on GitHub with its link     |
| Escalate a labeled GitHub issue to an incident   | Your selected label is added to an issue                                           | Create an incident and reply with its link               |
| Open a GitHub issue when an incident is declared | A OneUptime incident is created                                                    | Create an issue containing the incident summary and link |

The wizard asks for the repository as `owner/repository` or a connected Code Repository ID. Incident creation also asks for an **Incident severity ID** from the same project's incident settings. Copy the project's **Incidents page URL**, without a trailing slash, to generate links back to OneUptime.

Templates are created **switched off**. Review the generated graph, verify the configuration, and enable the workflow when it is ready. The incident-to-issue template runs for every new incident in the project; add a condition first if only certain incidents should create issues.

### Example: declare an incident from a comment

After enabling the comment template, a GitHub user with current write access to the connected repository can leave this comment on an issue or a pull request's conversation:

```text
@oneuptime incident Checkout errors in production
```

OneUptime uses `Checkout errors in production` as the incident title and includes the GitHub source link in its description. It then posts a conversation reply linking to the incident. A command without a title receives a usage reply and does not create an incident.

The starter only accepts **new** comments, ignores bots, and checks the sender's current repository write permission against GitHub. Editing an old comment does not execute the command again. Each new matching comment is a separate request; submitting the same command in a new comment creates another incident.

### Example: escalate an issue with a label

Choose a dedicated label such as `oneuptime-incident`. The label template listens for that label being added, so adding an unrelated label to an already labeled issue does not create another incident. Removing and reapplying the chosen label is a new event and creates another incident.

To act when an issue is opened with a label, change the trigger's **Actions** to `opened` and keep the **Label** filter. Choose one event policy deliberately to avoid creating an incident for both opening and later labeling the same issue.

## Receive the right GitHub events

A workflow filter does not subscribe your GitHub App to an event. An App administrator must also enable the relevant subscription under the GitHub App's **Permissions & events**. Existing installations must approve additional requested permissions before new actions can work.

| GitHub subscription         | Workflow event name           | Typical actions                                                           |
| --------------------------- | ----------------------------- | ------------------------------------------------------------------------- |
| Issues                      | `issues`                      | `opened`, `edited`, `closed`, `reopened`, `labeled`, `unlabeled`          |
| Issue comment               | `issue_comment`               | `created`, `edited`, `deleted`                                            |
| Pull request                | `pull_request`                | `opened`, `synchronize`, `closed`, `reopened`, `labeled`                  |
| Pull request review         | `pull_request_review`         | `submitted`, `edited`, `dismissed`                                        |
| Pull request review comment | `pull_request_review_comment` | `created`, `edited`, `deleted`                                            |
| Push                        | `push`                        | `pushed` (normalized by OneUptime)                                        |
| Workflow run                | `workflow_run`                | `requested`, `in_progress`, `completed`                                   |
| Check run / Check suite     | `check_run`, `check_suite`    | `created`, `completed`, `requested`, `rerequested`, depending on event    |
| Release                     | `release`                     | `published`, `released`, `edited`                                         |
| Deployment status           | `deployment_status`           | Deployment state such as `success` or `failure` (normalized by OneUptime) |

**Issue comment** includes comments in a pull request's main conversation. Inline review comments use **Pull request review comment**; a submitted review uses **Pull request review**. See GitHub's [event and payload reference](https://docs.github.com/en/webhooks/webhook-events-and-payloads).

## Build your own workflow

Add the **GitHub Event** trigger from the **GitHub** category and connect its **Success** port to an action. You can use existing OneUptime components to create or update incidents and alerts, notify Slack or Teams, or add conditions before taking action.

| Trigger setting                 | Behavior                                                                                                                           |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Repository                      | An `owner/repository` name or connected Code Repository ID. Blank means all connected repositories in this project.                |
| Events                          | Required comma-separated GitHub event names. `*` explicitly accepts all supported events.                                          |
| Actions                         | Optional comma-separated actions. A comment command defaults to `created`, or `submitted` for reviews, when this is blank.         |
| Comment Command                 | Match the beginning of a comment, followed by whitespace or the end of the comment. The remaining text becomes `commandArguments`. |
| Comment Type                    | `all`, `issue`, or `pull_request`. The specific types apply to comments and reviews.                                               |
| Branch                          | Exact source branch or ref. Pull requests use the head branch; pushes omit the `refs/heads/` prefix.                               |
| Label                           | Match a label name, case insensitively. Label changes match the label being added or removed; other events match current labels.   |
| Senders                         | Optional comma-separated GitHub usernames.                                                                                         |
| Ignore Bots                     | Defaults to true. Turn off deliberately for CI events sent by bot accounts.                                                        |
| Require Repository Write Access | Defaults to true for comments and reviews. GitHub must confirm current write access before the workflow runs.                      |

Filter fields can use workflow variables such as `{{local.variables.githubRepository}}` or global variables such as `{{global.variables.repositoryName}}`. Configure these before enabling the workflow.

### Use event data in later steps

The trigger exposes common fields plus the original GitHub payload. With the trigger named `github-event-1`, references include:

```text
{{local.components.github-event-1.returnValues.repository}}
{{local.components.github-event-1.returnValues.codeRepositoryId}}
{{local.components.github-event-1.returnValues.issueNumber}}
{{local.components.github-event-1.returnValues.comment}}
{{local.components.github-event-1.returnValues.commandArguments}}
{{local.components.github-event-1.returnValues.sender}}
{{local.components.github-event-1.returnValues.url}}
{{local.components.github-event-1.returnValues.payload.pull_request.merged}}
```

Other outputs include `event`, `action`, `deliveryId`, `installationId`, `repositoryId`, `title`, `body`, `branch`, `labels`, `isPullRequest`, and `isBot`. Fields depend on the event: a push has no issue number, for example. Use a condition before reading event-specific payload fields if the trigger accepts multiple event types.

A closed pull request is not necessarily merged. Filter on `pull_request` and `closed`, then require `payload.pull_request.merged` to be true to react only to merges.

### Example: act on failed CI

Use a GitHub Event trigger with **Events** `workflow_run`, **Actions** `completed`, a repository, and optionally a branch. Set **Ignore Bots** to false if your CI sender is a bot. Connect an **If / Else** step comparing this value to `failure`:

```text
{{local.components.github-event-1.returnValues.payload.workflow_run.conclusion}}
```

Connect **Yes** to **Create One Incident** or **Create One Alert**, with the severity required by that model. Match the workflow name in an additional condition if only one CI workflow should alert. A rerun that fails is a new event, so add your own existing-incident lookup if multiple failures should update one incident.

## Write back to GitHub

All native GitHub actions use a **Repository** and existing-item actions also use a positive **Issue or Pull Request Number**. Use the trigger's `codeRepositoryId` and `issueNumber` to act on the source thread.

| Action                           | What it does                                                                |
| -------------------------------- | --------------------------------------------------------------------------- |
| Create GitHub Issue              | Set title, Markdown body, labels, and assignees                             |
| Get / Update GitHub Issue        | Read an issue, edit it, close or reopen it, or replace labels and assignees |
| Comment on GitHub Issue or PR    | Add a conversation comment to an issue or pull request                      |
| Add GitHub Labels                | Add labels while preserving existing labels                                 |
| Remove GitHub Label              | Remove one specified label                                                  |
| Get / Update GitHub Pull Request | Read a PR, edit title/body, change base branch, or close/reopen it          |
| Request GitHub Review            | Request reviewers by username or teams by slug                              |

Labels, assignees, reviewers, and team reviewers use JSON arrays, such as `["platform-team"]`. Updating an issue replaces its labels or assignees when those fields are supplied; an empty array clears them. Use **Add GitHub Labels** for an additive update. The comment action creates a main conversation comment, including when triggered by an inline review comment.

Connect both **Success** and **Error** ports. Successful actions return fields such as `number`, `url`, and `response-status`. The Error port returns an `error` description and the available HTTP status. A failed reply does not undo an incident that was already created.

Native GitHub actions target GitHub.com. The existing generic **API** components remain available for custom endpoints and separately configured authentication.

## Delivery, retries, and testing

OneUptime verifies the webhook signature and acknowledges a supported delivery after it is saved to the delivery queue. Processing runs asynchronously. Transient delivery-processing failures are retried up to eight total attempts, with increasing delays starting at five seconds. Handle failures inside the workflow through its actions' Error ports; delivery retries do not undo earlier actions. A suspended installation's activity is ignored until the installation is active again.

GitHub can [deliver events out of order](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/troubleshooting-webhooks#webhooks-deliveries-are-out-of-order). OneUptime prevents simultaneous processing for the same installation, but cannot reconstruct the order in which activity happened. A repository must already be connected when its event is processed; activity skipped before connection is not processed retroactively. Connect the repository before sending a test event.

Repeated deliveries use the GitHub delivery ID to avoid scheduling the same workflow twice while delivery markers or its workflow run log remain available. Completed delivery markers are retained for 30 days. This is not a guarantee that every external write occurs exactly once: a manual workflow rerun is a new run, and a network failure can leave the result of a GitHub write uncertain. Check the target issue and run logs before repeating a write.

1. Enable a workflow scoped to a test repository.
2. Send a matching comment or other event in GitHub.
3. Open the GitHub App's **Advanced > Recent Deliveries** and inspect the request and response.
4. Open the OneUptime workflow's **Logs** and follow the trigger and action results.
5. If ingestion failed or processing exhausted its retries, fix the cause and use GitHub's **Redeliver** action. A completed delivery is deduplicated; create a new test event to test a changed workflow.

A 2xx webhook response confirms acceptance, not that a workflow matched or that its actions succeeded. GitHub does not automatically redeliver failed deliveries; see its [redelivery guide](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/redelivering-webhooks).

**Run Workflow** also lets a project user with workflow write permission simulate a GitHub event by entering sample trigger values. The workflow must be enabled. Provide the fields your steps use, such as repository, issue number, command arguments, or a JSON payload. For the comment starter, enter the incident title directly in **Command Arguments**; a sample comment is not parsed into a command. This executes real downstream actions against their configured targets; use a test repository. Manual simulation does not validate a webhook signature, apply event filters, or check a sample sender's GitHub permissions. Use a real GitHub delivery to verify those parts of the integration.

## Troubleshooting

- **Delivery accepted but no workflow run:** ensure the workflow is enabled, the repository belongs to this project, and the event/action/filter matches. Check bot filtering and the sender's current write access for comments. An already completed delivery will not run again when redelivered.
- **PR comments never arrive:** subscribe to **Issue comment** for conversation comments and **Pull request review comment** for inline comments.
- **CI never triggers:** subscribe to Workflow run or Checks as appropriate, check Actions or Checks read permission, and review the Ignore Bots setting.
- **New GitHub actions return 403:** review the App's permissions and have the installation administrator approve any requested upgrade.
- **Repository not found or 404:** verify repository spelling, active installation access, and that the repository is connected to the workflow's project.
- **Incident created without a GitHub reply:** inspect the reply's Error port and permissions. Retry only the necessary action after checking the existing incident.
- **No delivery reaches OneUptime:** check public HTTPS access, the webhook secret, the GitHub subscription, and [self-hosted network setup](/docs/self-hosted/github-integration).

## Treat GitHub content as untrusted data

A valid signature proves the delivery came from GitHub; it does not make an issue body, review, comment, branch name, or raw payload trustworthy instructions. Keep comments in data fields. Pass them as arguments to custom code rather than interpolating them into executable code, and explicitly constrain any AI component that receives them. Keep bot filtering and current write-access checks enabled for command workflows unless you intentionally need a different policy.

See [Workflows](/docs/workflows/index) for the builder and [self-hosted GitHub setup](/docs/self-hosted/github-integration) for App configuration, permissions, and network access.
