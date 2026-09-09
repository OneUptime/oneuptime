GitHub components connect your workflow to repositories installed through the OneUptime GitHub App. The **GitHub Event** trigger receives activity, and the actions read or update GitHub issues and pull requests. Credentials come from the connected App; do not put a GitHub token in these components.

## Before you enable the workflow

Connect the repository in **Products > Code Repositories**. In GitHub, subscribe the App to the events you need and grant the relevant permissions. Existing installations must approve newly requested permissions. **Issue comment** receives comments on both issues and pull request conversations; **Pull request review comment** receives inline review comments.

The Code Repositories page offers starters for comment commands, labeled issues, and incident-to-issue creation. All templates start switched off. See the [integration guide](/docs/integrations/github) for setup and testing.

## GitHub Event filters

**Events** accepts comma-separated names: `issues`, `issue_comment`, `pull_request`, `pull_request_review`, `pull_request_review_comment`, `push`, `workflow_run`, `check_run`, `check_suite`, `release`, and `deployment_status`. Use `*` explicitly to accept all supported events. Only repositories connected to this workflow's project can trigger it.

**Repository** accepts `owner/repository` or a OneUptime Code Repository ID. Leaving it blank accepts all connected repositories in the project. **Actions** narrows the event, for example `opened`, `created`, or `completed`. Push uses the normalized action `pushed`; deployment status uses its state, such as `failure`.

**Comment Command** requires the comment to begin with the configured text followed by whitespace or the end of the comment. For `@oneuptime incident`, this matches `@oneuptime incident Checkout is down`, and exposes `Checkout is down` as `commandArguments`. It does not match `@oneuptime incidentally`. A command without an Actions filter defaults to newly created comments, or submitted reviews, so editing a comment does not execute the command again.

**Comment Type** accepts `all`, `issue`, or `pull_request` and applies to comment and review events. **Branch** matches the source branch or ref, including the head branch for pull requests. **Label** matches the label being changed for `labeled`/`unlabeled`, or a current label for other events. **Senders** accepts comma-separated usernames. Label and sender comparisons are case insensitive.

**Ignore Bots** defaults to true. Keep it on for commands and automatic replies to prevent loops. For `workflow_run` or check events sent by a CI bot, explicitly set it to false and filter the event, action, repository, and result.

**Require Repository Write Access** defaults to true for comments and reviews. OneUptime asks GitHub for the sender's current write permission before the workflow runs. An author association in a webhook does not replace that check. Set this to false only when a workflow is intended to accept comments from external contributors.

Filters support workflow variables such as `{{local.variables.githubRepository}}` and global variables such as `{{global.variables.repositoryName}}`.

## Read event values

The Returns panel shows the exact references for your component ID. With the trigger named `github-event-1`:

```text
{{local.components.github-event-1.returnValues.codeRepositoryId}}
{{local.components.github-event-1.returnValues.issueNumber}}
{{local.components.github-event-1.returnValues.comment}}
{{local.components.github-event-1.returnValues.commandArguments}}
{{local.components.github-event-1.returnValues.url}}
```

`payload` contains the original GitHub event. For example, `payload.pull_request.merged` distinguishes a merged PR from one closed without merging, and `payload.workflow_run.conclusion` identifies a failed CI run. Fields depend on the event; a push does not have an issue number.

GitHub comment, issue, and review content remains untrusted input even after signature validation. Keep it in data fields or pass it as arguments to custom code. Do not interpolate it into executable code or treat it as instructions for an AI component.

## GitHub actions

Every action requires a connected **Repository**. Actions on an existing item also require its positive GitHub **Number**. Use the trigger's `codeRepositoryId` and `issueNumber` to act on its source thread.

- **Create GitHub Issue** takes a title and optional body, labels, and assignees.
- **Get / Update GitHub Issue** reads or changes an issue. Updating labels and assignees replaces the supplied collection; `[]` clears it. `open` reopens and `closed` closes it.
- **Comment on GitHub Issue or PR** posts a conversation comment. It does not create an inline code-review reply.
- **Add GitHub Labels** preserves existing labels. **Remove GitHub Label** removes one named label.
- **Get / Update GitHub Pull Request** reads or changes title, body, state, or base branch.
- **Request GitHub Review** accepts GitHub usernames in `reviewers` and team slugs in `team-reviewers`. Supply at least one reviewer or team.

Collections are JSON arrays such as `["incident", "oneuptime"]`. A supplied empty body clears it when updating; an omitted body leaves it unchanged. Update actions require at least one field to change.

The **Success** port returns values including `number`, `url`, and `response-status`. Connect the **Error** port to a step that records or handles `error`. A failed GitHub action does not undo earlier workflow steps.

## Test and diagnose

**Run Workflow** accepts sample event values from a project user with workflow write permission. Enable the workflow and fill the fields your next steps reference, such as `repository`, `issueNumber`, `commandArguments`, or `payload`. For command templates, supply `commandArguments` directly: a sample `comment` is not parsed into a command. Enter `labels` as a JSON array and `payload` as a JSON object. Manual simulation executes real downstream actions and their normal project/repository access checks. It bypasses incoming webhook signatures, saved event filters, and checks of the sample sender's GitHub permissions, so use it to test workflow steps with a test repository, then verify the full connection with a real delivery.

Enable the workflow and send a matching event from GitHub. Inspect the App's **Advanced > Recent Deliveries**, then this workflow's **Logs**. A successful webhook response means the delivery was accepted for asynchronous processing; it does not guarantee a matching workflow or a successful action.

GitHub events can arrive out of order. Processing for each installation is serialized, but this does not restore the original event chronology. The repository must be connected when its event is processed; events skipped before connection are not replayed later.

Processing failures are retried with increasing delays. After fixing an exhausted delivery, use GitHub's **Redeliver**. Completed deliveries are deduplicated while their delivery marker or workflow run log remains available; use a new event to test a changed workflow. Manual workflow reruns and new comments are separate runs and can create additional issues or incidents. Inspect the target before repeating a write whose result is uncertain.
