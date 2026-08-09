# AI Fix Tasks — Fix Exceptions with a Pull Request

OneUptime AI turns an unresolved exception into a reviewable pull request. On any unresolved exception, click **Fix with AI**: a [Runner](/docs/runbooks/agents) picks the task up, reads the exception (type, error message, and stack trace), clones the GitHub repository linked to the service that threw it, writes a fix on a new branch, and opens a pull request.

Every pull request is reviewed and merged by a human. The Runner never merges its own changes — it can push branches and open PRs, nothing more.

## How a fix run works

1. You click **Fix with AI** on an unresolved exception.
2. A fix task is created and picked up by an available Runner with the **Runs AI Code Fixes** capability.
3. The Runner fetches the exception details — exception type, error message, and stack trace.
4. It clones the linked repository into an ephemeral workspace and creates a branch (named `oneuptime-fix-exception-` followed by the first characters of the run id).
5. A code agent, powered by your project's LLM provider, analyzes the codebase and writes the fix. The LLM calls are executed by the OneUptime server — the Runner container never holds your provider's API key — and every call is metered and logged in the AI logs.
6. If the repository has verification commands configured, the Runner builds and tests the fix before anything is committed, feeding any failure back to the code agent for repair (see **Verification before the pull request** below).
7. The Runner commits, pushes the branch, opens a pull request, and deletes the workspace.

The exception page shows the task's live status. The task's detail page (under **AI** > **Tasks**) keeps the full run log — including a line for every file the Runner read or wrote and every command it ran — and links to every pull request the task opened.

Each fix run is capped by server-enforced loop budgets: at most **40 LLM calls** and **100,000 output tokens** per run. A run that hits its budget finishes with a summary of the work done so far instead of looping forever. Fix runs also count against the project's daily autonomous AI token budget, if one is set.

## Verification before the pull request

A code repository can carry up to three verification commands — **Setup Command**, **Build Command**, and **Test Command** (for example `npm ci`, `npm run build`, `npm test`) — on its **Settings** page under **Code Repositories**. When any are configured, every fix run verifies its changes before the pull request opens:

1. After the code agent finishes, the configured commands run in order (setup → build → test) at the repository root, on the Runner, inside the cloned workspace. Each command gets up to 15 minutes and runs with `CI=true` so nothing waits on an interactive prompt; the first failure stops the pass.
2. On a failure, the tail of the failing command's output is handed back to the same code agent as a repair task — with instructions to fix its own changes, not to weaken or skip tests — and the commands run again. At most **2** repair attempts are made; repair passes share the run's LLM budget, and their edits land in the same commit as the fix.
3. The outcome — **Passed**, **Failed**, or **Skipped** (no commands configured) — is stated in a **Verification** section of the pull request body and recorded on the task's pull request record.

A fix that still fails verification is not thrown away: the pull request opens anyway, as a draft, with a clearly-marked **Verification failed** section in its body carrying the failing command and the tail of its output — the work is preserved, and the human reviewer decides. A repository with no commands configured is reported as **Skipped**, honestly, rather than implying a green build.

The commands are operator-authored repository configuration executed on your own Runner — the same trust model as runbook Bash steps. The AI never writes or modifies them.

## Prerequisites

Three things must be in place before a fix task can run. The exception page checks all of them up front and shows a readiness checklist, so you can see exactly what is missing before a task is created.

### 1. An LLM provider

- **OneUptime Cloud**: zero-config — if your project has no LLM provider of its own, agent tasks use the shared global provider and the usage is billed as metered AI tokens, exactly like every other AI feature. To use your own keys instead, configure a provider under **Project Settings** > **AI** > **LLM Providers** — a project-owned provider always takes precedence.
- **Self-hosted**: a project-owned provider works the same way, but the zero-config path is to set the `GLOBAL_LLM_PROVIDER_*` environment variables once on your OneUptime server (in `config.env` for Docker Compose, or via Helm values) — a global provider is registered automatically at startup, and every project's AI features, including agent tasks, use it. For a local Ollama:

```bash
GLOBAL_LLM_PROVIDER_TYPE=Ollama
GLOBAL_LLM_PROVIDER_BASE_URL=http://your-ollama-host:11434
GLOBAL_LLM_PROVIDER_MODEL_NAME=llama3
# No GLOBAL_LLM_PROVIDER_API_KEY needed — Ollama is keyless.
```

Any supported provider works — see [LLM Providers](/docs/ai/llm-provider) for all providers and the full list of environment variables.

### 2. GitHub connected through the GitHub App

Connect GitHub under **Code Repositories** using **Connect with GitHub App** — installing the app imports all of its repositories automatically and keeps them in sync. The GitHub App is the only connection the Runner can push through (GitLab is on the roadmap).

You do **not** map repositories to services: OneUptime resolves the right repository at fix time by matching the exception's stack-trace file paths against your connected repositories (falling back to repository-name matching and, when the project has exactly one repository, to that repository). The readiness checklist on the exception page shows which repository resolved.

### 3. A Runner with AI code fixes enabled

- **OneUptime Cloud**: the shared Runner fleet is available automatically — there is nothing to run.
- **Self-hosted**: the Runner container runs by default — the Docker Compose install includes the `runner` service, and the Helm chart deploys it (`runner.enabled`, default `true`). It registers itself with your instance automatically (no credentials to copy) and works on AI code fixes out of the box. The Runner idles cheaply when no LLM provider is configured; tasks fail early with guidance until one is set up.

To run an additional Runner elsewhere (for example on a machine closer to your repositories):

1. Create a Runner under **Settings** > **Runners** and use **Show setup instructions** on its row for a pre-filled install command. The key is shown once — save it securely. The command looks like:

```bash
docker run --name oneuptime-runner --restart unless-stopped \
  -e ONEUPTIME_RUNNER_ID=<runner-id> \
  -e ONEUPTIME_RUNNER_KEY=<runner-key> \
  -e ONEUPTIME_URL=<your-oneuptime-url> \
  -d oneuptime/runner:release
```

2. Enable **Runs AI Code Fixes** on the Runner — the capability is off by default, and the Runner adopts the change on its next heartbeat (about a minute); no restart needed.

Any way of running the container works (Docker Compose, Kubernetes, and so on) as long as these environment variables are set and the container can reach your OneUptime instance over HTTPS:

| Variable               | Description                                                    |
| ---------------------- | -------------------------------------------------------------- |
| `ONEUPTIME_RUNNER_ID`  | The Runner id from the dashboard                               |
| `ONEUPTIME_RUNNER_KEY` | The Runner key shown when the Runner was created               |
| `ONEUPTIME_URL`        | Your OneUptime instance URL (`https://oneuptime.com` on Cloud) |

The Runner shows as connected on the **Settings** > **Runners** page within a minute or two. If it does not, check the container logs (`docker logs oneuptime-runner`) for credential or network errors.

> Before OneUptime 12, AI code fixes ran on a separate **AI Agent** component (the `oneuptime/ai-agent` image with `AI_AGENT_*` variables). That component merged into the Runner — if you still run one, see the [v11 → v12 upgrade guide](/docs/installation/upgrading) for how to replace it.

## When a fix fails

- **The run errors** (the fix could not be applied, the repository was unreachable, the LLM call failed): the task's error is shown on the exception page with the reason, and you can retry the fix from there. The full run log is on the task's detail page.
- **The Runner crashes mid-run**: a run whose heartbeat goes stale for more than about ten minutes is failed with an error. It is never requeued automatically — the Runner may already have pushed a partial fix branch — but you can retry the fix from the exception page.
- **No Runner is online**: a queued task that waits more than 30 minutes while no Runner with the **Runs AI Code Fixes** capability is connected is failed automatically, with guidance to check the Runner — it will not show "in progress" forever. (If a Runner is online but busy, queued tasks simply wait their turn.)

## Automatic code fixes from investigations

When an [AI investigation](/docs/ai/ai-sre) posts a root cause analysis on an incident or alert and its conservative classification recommends a repository code change, the investigation panel offers **Open Fix PR from this analysis** — a fix task whose entire context is the posted analysis. The action is hidden when the remedy is operational, infrastructure-only, external, an expected denial, a user error, or inconclusive. Projects that want eligible fixes to happen without the click can opt in with **Enable Automatic Code Fixes**, **off by default and configured independently**, under **Incidents > Settings > AI** or **Alerts > AI > Investigation**.

When enabled, an investigation that ends with a **confident, evidenced, code-fixable** root cause analysis automatically queues the same fix task the button creates. The gate is a constrained, server-verified classification, never a regex over the analysis prose: only a positive code-fix verdict opens a pull request. Missing evidence, non-code remedies and failed classifications all fail toward doing nothing.

Everything else matches the manual button: the pull request opens as a draft generated from the posted analysis, needs a GitHub-App-connected repository and a Runner with **Runs AI Code Fixes** enabled, counts against that signal type's **Daily AI Fix Task Limit** (default 25 per UTC day) and each repository's open-PR cap, and every trigger first checks for a fix task that is already queued or running for the same incident or alert — so an automatic trigger and a human click normally collapse into one task rather than two pull requests. (The check is a read before the write, not a lock, so two triggers that fire at the very same moment can still both get through.) The run is system-authored (no user attribution), and nothing merges automatically.

## Privacy

The repository clone lives in an ephemeral workspace inside the Runner container and is deleted when the run finishes, whether it succeeded or failed. The Runner container never holds your LLM provider's API key — LLM calls are executed by the OneUptime server on the Runner's behalf. OneUptime does not retain your repository and does not train on your code; the task's run log keeps a short preview of each step's output (a few hundred characters) so you can audit what the Runner did, and those previews can include code snippets. Run a self-hosted Runner with your own LLM provider (including local Ollama) and your code never leaves your infrastructure.

## On the roadmap

Planned, but **not available today**:

- **GitLab support** — repository connections are currently GitHub App only.
- **Richer telemetry context** — feeding related traces, logs, and metrics around the exception into the fix, beyond the stack trace.
