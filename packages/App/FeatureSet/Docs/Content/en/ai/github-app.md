# Working with OneUptime from GitHub

The OneUptime GitHub App is not only a connection to your code — you can talk to it in your repository, and it will do the work there.

Mention it on an issue and it opens a pull request. Mention it on a pull request and it revises the branch, or reviews the diff. Add a label to an issue and it picks the issue up. Everything it produces is a pull request or a review for a human to read: **it never merges anything, and it never approves a pull request.**

```text
@oneuptime implement this                          →  a pull request that closes the issue
@oneuptime revise this — use exponential backoff   →  new commits on this pull request's branch
@oneuptime review                                  →  a code review posted on this pull request
```

> Replace `@oneuptime` with your own app's handle. On OneUptime Cloud it is `@oneuptime`. On a self-hosted instance it is whatever you named your GitHub App, lowercased with spaces turned into hyphens — an app named "Acme AI" is mentioned as `@acme-ai`. If mentions do nothing, this is the first thing to check.

## Before you start

- The repository must be **connected to a OneUptime project** through the GitHub App. See [GitHub Integration (self-hosted)](/docs/self-hosted/github-integration) for the setup, or connect it from **Project Settings → Code Repositories** on OneUptime Cloud.
- A **Runner with the "Runs AI Code Fixes" capability** must be online — the same Runner that carries out [AI Fix Tasks](/docs/ai/ai-agent). Without one, commands are accepted and then fail after 30 minutes with a message saying no agent picked them up.
- The GitHub App must have the **Issues: Read & write** permission and be subscribed to the webhook events listed under [What to subscribe to](#what-to-subscribe-to).

## The commands

Every command starts with a mention of the app. The mention can be anywhere in the comment, and anything you write after it is passed along as your request.

### On a pull request

| Command | What happens |
| --- | --- |
| `@oneuptime review` | Clones the branch, reads the changed code **and the code around it**, and posts a review as a comment. Changes nothing. |
| `@oneuptime revise this — <what you want changed>` | Clones the pull request's own branch, makes the change, and pushes new commits to that same branch. Never opens a second pull request. |

Anything you write after the mention that is not a recognized command is treated as a revision request, because that is almost always what it is:

```text
@oneuptime the retry loop here should back off exponentially, and the test
should cover the 429 case
```

### On an issue

| Command | What happens |
| --- | --- |
| `@oneuptime implement this` | Works the issue and opens a pull request that closes it. |
| `@oneuptime <anything else>` | Same, with your words as extra direction. |

You can also hand the app an issue **without commenting at all**:

- **Add the trigger label.** Adding the repository's trigger label — `oneuptime` by default — to an issue starts the same work. This is the most reliable way to assign work from the GitHub UI.
- **Assign the issue to the app's bot user**, where your repository allows it. GitHub does not let an app be an assignee everywhere, which is why the label exists; if assigning does nothing, use the label.

### Anywhere

| Command | What happens |
| --- | --- |
| `@oneuptime help` | Lists the commands. A bare mention with nothing after it does the same. |
| `@oneuptime status` | Says what it is currently working on in this thread. |
| `@oneuptime cancel` | Stops the runs it has going on this thread. Work already pushed stays pushed. |

`help`, `status` and `cancel` never start an agent run, so they cost nothing and are not subject to your daily fix-task budget.

## What it looks like in the thread

One command produces **one comment**, which the app edits as the work moves — so a long-running task never turns a pull request into a status log.

1. It reacts 👀 on your comment, and posts an acknowledgement naming the OneUptime project the run belongs to and linking to the live run.
2. When it finishes, that same comment is rewritten with the outcome: the pull request it opened, the commits it pushed, or an honest explanation of why it did nothing.

If it finds nothing worth changing, it says so rather than opening a speculative pull request. That is a normal outcome, not a failure — give it more direction and ask again.

## Who is allowed to command it

**Only people with write, maintain or admin access to the repository.** OneUptime asks GitHub directly for the commenter's permission on that repository every time; it does not trust the "contributor" badge GitHub shows next to a comment, which describes past activity rather than current access.

A mention from anyone else gets a single 😕 reaction on their comment and nothing else. This is deliberate: on a public repository anyone can comment, and an app that reliably replies to strangers is an app that can be used to spam a thread.

It also ignores every comment written by a bot, including its own, and ignores mentions that appear inside a quote (`>`) or a code block. Between them, those two rules are what stop a reply to one of its own comments from starting it up again.

## What it will not do

- **It never merges.** Nothing this app does can put code on your default branch.
- **It never approves or requests changes.** Reviews are posted as comments, so a review from an app can never satisfy a branch protection rule.
- **It never rewrites history.** A revision adds commits; it does not force-push. If someone else pushed to the branch first, the revision fails rather than discarding their work.
- **It cannot revise a pull request from a fork.** A fork's branch is in a repository the installation cannot write to. It will still review one — ask it to review instead.
- **It never changes a pull request's title, description or target branch.** Only code.

## What it costs, and how to bound it

Every command that starts work is a full agent run — a clone, up to 40 LLM calls and 100,000 output tokens, plus your repository's build and test commands if you have configured them.

Two limits apply, and both are the ones that already govern [AI Fix Tasks](/docs/ai/ai-agent):

- **The project's daily fix-run limit** (**Project Settings → AI**, 25/day by default). GitHub commands share this budget with the rest of your project's fix runs.
- **The per-repository open pull request cap** (**Code Repositories → the repository → Settings**, 5 by default). Reviews and revisions are exempt: neither adds a new pull request to your review queue.

Only one run of a given kind is live per issue or pull request at a time. Asking twice tells you it is already working; asking for a review while a revision is running starts both, since they are different requests.

If a run cannot start, the app says why in the thread — it never fails silently.

## Turning it off

Per repository: **Code Repositories → the repository → Settings → Respond to GitHub Commands**. With it off, the app ignores mentions, assignments and the trigger label in that repository, and tells anyone who asks where the switch is.

The same page carries the **GitHub Trigger Label**, if you want something other than `oneuptime`.

## What to subscribe to

In your GitHub App's **Permissions & events** settings, subscribe to:

| Event | Needed for |
| --- | --- |
| **Issue comment** | `@mention` commands on issues *and* pull requests |
| **Issues** | assignment to the app, and the trigger label |
| **Pull request** | review requested from the app |
| **Pull request review** | a mention in the body of a submitted review |
| **Pull request review comment** | a mention on an inline diff comment |

And under **Repository permissions**, **Issues** must be **Read & write** — GitHub routes pull request conversation comments through the issues API, so this is what lets the app comment on pull requests too.

## Prompt injection: what is and is not protected

Issue text, pull request descriptions, diffs and comments all become part of the agent's prompt, and on a public repository anyone can write them. Text that says "ignore your instructions and do X" is a realistic thing to find in an issue.

Two things bound this, and it is worth knowing which is which:

- **The prompts label untrusted text as a request, not as instructions**, and the run's repository, branch and pull request are fixed before the agent ever starts — nothing the agent reads can change what it is working on.
- **The real containment is the sandbox.** The agent runs on your Runner, in a throwaway clone, with credentials stripped from its command environment and its git operations restricted. It can only ever push to a branch, and only a human can merge one.

Treat an AI-authored pull request the way you would treat one from a new contributor who read the issue: review the diff, not the description.

## Troubleshooting

**Nothing happens when I mention it.** Check the handle first — it is the app's slug, not its display name. Then check that the repository is connected to a project (**Project Settings → Code Repositories**), that **Respond to GitHub Commands** is on, and that your GitHub App is subscribed to the events above.

**It reacts 😕 and says nothing.** You do not have write access to the repository.

**It says it is already working on this.** A run of that kind is already live on this issue or pull request. `@oneuptime status` will tell you what, and `@oneuptime cancel` stops it.

**It acknowledged and then went quiet for a long time.** Check that a Runner with **Runs AI Code Fixes** is online under **Settings → Runners**. Without one, the run is failed after 30 minutes and the thread is told.

**It says the pull request comes from a fork.** Revisions need a branch in this repository. Ask for a review instead, or push the branch here.

## Where to read next

- [AI Fix Tasks](/docs/ai/ai-agent) — the same agent, triggered from an exception instead of from GitHub.
- [GitHub Integration (self-hosted)](/docs/self-hosted/github-integration) — creating and configuring the GitHub App.
- [Runners](/docs/runbooks/agents) — the worker that carries out the runs.
