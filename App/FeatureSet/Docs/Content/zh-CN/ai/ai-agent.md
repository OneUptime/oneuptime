# AI Fix Tasks — Fix Exceptions with a Pull Request

<!-- TODO(i18n): Translate this page. English source: en/ai/ai-agent.md (rewritten for the v12 Runner merge; the previous translation described the retired standalone AI Agent). -->

OneUptime AI turns an unresolved exception into a reviewable pull request. On any unresolved exception, click **Fix with AI**: a [Runner](/docs/runbooks/agents) picks the task up, reads the exception (type, error message, and stack trace), clones the GitHub repository linked to the service that threw it, writes a fix on a new branch, and opens a pull request.

Every pull request is reviewed and merged by a human. The Runner never merges its own changes — it can push branches and open PRs, nothing more.

## How a fix run works

1. You click **Fix with AI** on an unresolved exception.
2. A fix task is created and picked up by an available Runner with the **执行 AI 代码修复** capability.
3. The Runner fetches the exception details — exception type, error message, and stack trace.
4. It clones the linked repository into an ephemeral workspace and creates a branch (named `oneuptime-fix-exception-` followed by the first characters of the run id).
5. A code agent, powered by your project's LLM provider, analyzes the codebase and writes the fix. The LLM calls are executed by the OneUptime server — the Runner container never holds your provider's API key — and every call is metered and logged in the AI logs.
6. The Runner commits, pushes the branch, opens a pull request, and deletes the workspace.

The exception page shows the task's live status. The task's detail page (under **AI** > **Tasks**) keeps the full run log — including a line for every file the Runner read or wrote and every command it ran — and links to every pull request the task opened.

Each fix run is capped by server-enforced loop budgets: at most **40 LLM calls** and **100,000 output tokens** per run. A run that hits its budget finishes with a summary of the work done so far instead of looping forever. Fix runs also count against the project's daily autonomous AI token budget, if one is set.

## Prerequisites

Three things must be in place before a fix task can run. The exception page checks all of them up front and shows a readiness checklist, so you can see exactly what is missing before a task is created.

### 1. An LLM provider

- **OneUptime Cloud**: zero-config — if your project has no LLM provider of its own, agent tasks use the shared global provider and the usage is billed as metered AI tokens, exactly like every other AI feature. To use your own keys instead, configure a provider under **项目设置** > **人工智能** > **LLM 提供商** — a project-owned provider always takes precedence.
- **Self-hosted**: a project-owned provider works the same way, but the zero-config path is to set the `GLOBAL_LLM_PROVIDER_*` environment variables once on your OneUptime server (in `config.env` for Docker Compose, or via Helm values) — a global provider is registered automatically at startup, and every project's AI features, including agent tasks, use it. For a local Ollama:

```bash
GLOBAL_LLM_PROVIDER_TYPE=Ollama
GLOBAL_LLM_PROVIDER_BASE_URL=http://your-ollama-host:11434
GLOBAL_LLM_PROVIDER_MODEL_NAME=llama3
# No GLOBAL_LLM_PROVIDER_API_KEY needed — Ollama is keyless.
```

Any supported provider works — see [LLM Providers](/docs/ai/llm-provider) for all providers and the full list of environment variables.

### 2. GitHub connected through the GitHub App

Connect GitHub under **代码仓库** using **Connect with GitHub App** — installing the app imports all of its repositories automatically and keeps them in sync. The GitHub App is the only connection the Runner can push through (GitLab is on the roadmap).

You do **not** map repositories to services: OneUptime resolves the right repository at fix time by matching the exception's stack-trace file paths against your connected repositories (falling back to repository-name matching and, when the project has exactly one repository, to that repository). The readiness checklist on the exception page shows which repository resolved.

### 3. A Runner with AI code fixes enabled

- **OneUptime Cloud**: the shared Runner fleet is available automatically — there is nothing to run.
- **Self-hosted**: the Runner container runs by default — the Docker Compose install includes the `runner` service, and the Helm chart deploys it (`runner.enabled`, default `true`). It registers itself with your instance automatically (no credentials to copy) and works on AI code fixes out of the box. The Runner idles cheaply when no LLM provider is configured; tasks fail early with guidance until one is set up.

To run an additional Runner elsewhere (for example on a machine closer to your repositories):

1. Create a Runner under **设置** > **Runbook 代理** and use **显示设置说明** on its row for a pre-filled install command. The key is shown once — save it securely. The command looks like:

```bash
docker run --name oneuptime-runner --restart unless-stopped \
  -e ONEUPTIME_RUNNER_ID=<runner-id> \
  -e ONEUPTIME_RUNNER_KEY=<runner-key> \
  -e ONEUPTIME_URL=<your-oneuptime-url> \
  -d oneuptime/runner:release
```

2. Enable **执行 AI 代码修复** on the Runner — the capability is off by default, and the Runner adopts the change on its next heartbeat (about a minute); no restart needed.

Any way of running the container works (Docker Compose, Kubernetes, and so on) as long as these environment variables are set and the container can reach your OneUptime instance over HTTPS:

| Variable               | Description                                                    |
| ---------------------- | -------------------------------------------------------------- |
| `ONEUPTIME_RUNNER_ID`  | The Runner id from the dashboard                               |
| `ONEUPTIME_RUNNER_KEY` | The Runner key shown when the Runner was created               |
| `ONEUPTIME_URL`        | Your OneUptime instance URL (`https://oneuptime.com` on Cloud) |

The Runner shows as connected on the **设置** > **Runbook 代理** page within a minute or two. If it does not, check the container logs (`docker logs oneuptime-runner`) for credential or network errors.

> Before OneUptime 12, AI code fixes ran on a separate **AI Agent** component (the `oneuptime/ai-agent` image with `AI_AGENT_*` variables). That component merged into the Runner — if you still run one, see the [v11 → v12 upgrade guide](/docs/installation/upgrading) for how to replace it.

## When a fix fails

- **The run errors** (the fix could not be applied, the repository was unreachable, the LLM call failed): the task's error is shown on the exception page with the reason, and you can retry the fix from there. The full run log is on the task's detail page.
- **The Runner crashes mid-run**: a run whose heartbeat goes stale for more than about ten minutes is failed with an error. It is never requeued automatically — the Runner may already have pushed a partial fix branch — but you can retry the fix from the exception page.
- **No Runner is online**: a queued task that waits more than 30 minutes while no Runner with the **执行 AI 代码修复** capability is connected is failed automatically, with guidance to check the Runner — it will not show "in progress" forever. (If a Runner is online but busy, queued tasks simply wait their turn.)

## Privacy

The repository clone lives in an ephemeral workspace inside the Runner container and is deleted when the run finishes, whether it succeeded or failed. The Runner container never holds your LLM provider's API key — LLM calls are executed by the OneUptime server on the Runner's behalf. OneUptime does not retain your repository and does not train on your code; the task's run log keeps a short preview of each step's output (a few hundred characters) so you can audit what the Runner did, and those previews can include code snippets. Run a self-hosted Runner with your own LLM provider (including local Ollama) and your code never leaves your infrastructure.

## On the roadmap

Planned, but **not available today**:

- **GitLab support** — repository connections are currently GitHub App only.
- **Richer telemetry context** — feeding related traces, logs, and metrics around the exception into the fix, beyond the stack trace.
- **Verification loop** — building the project and running its tests against the fix before the pull request is opened.
