# AI Agents — Fix Exceptions with a Pull Request

Sentinel turns an unresolved exception into a reviewable pull request. On any unresolved exception, click **Fix with Sentinel**: the agent reads the exception (type, error message, and stack trace), clones the GitHub repository linked to the service that threw it, writes a fix on a new branch, and opens a pull request.

Every pull request is reviewed and merged by a human. The agent never merges its own changes — it can push branches and open PRs, nothing more.

## How a fix run works

1. You click **Fix with Sentinel** on an unresolved exception.
2. A fix task is created and picked up by an available agent.
3. The agent fetches the exception details — exception type, error message, and stack trace.
4. It clones the linked repository into an ephemeral workspace and creates a branch (named like `oneuptime-fix-exception-<task-id>`).
5. A code agent, powered by your project's LLM provider, analyzes the codebase and writes the fix.
6. The agent commits, pushes the branch, opens a pull request, and deletes the workspace.

The exception page shows the task's live status. The task's detail page (under **Sentinel** > **Tasks**) keeps the full run log and links to every pull request the task opened.

## Prerequisites

Three things must be in place before the agent can fix anything. The exception page checks all of them up front and shows a readiness checklist, so you can see exactly what is missing before a task is created.

### 1. An LLM provider

- **OneUptime Cloud**: agent tasks always run with an LLM provider your project owns — configure one under **Project Settings** > **Sentinel** > **LLM Providers**. The shared global provider (the one billed as metered AI tokens) is **not** usable for agent tasks.
- **Self-hosted**: a project-owned provider works the same way, but the zero-config path is to set the `GLOBAL_LLM_PROVIDER_*` environment variables once on your OneUptime server (in `config.env` for Docker Compose, or via Helm values) — a global provider is registered automatically at startup, and every project's AI features, including agent tasks, use it. For a local Ollama:

```bash
GLOBAL_LLM_PROVIDER_TYPE=Ollama
GLOBAL_LLM_PROVIDER_BASE_URL=http://your-ollama-host:11434
GLOBAL_LLM_PROVIDER_MODEL_NAME=llama3
# No GLOBAL_LLM_PROVIDER_API_KEY needed — Ollama is keyless.
```

Any supported provider works — see [LLM Providers](/docs/ai/llm-provider) for all providers and the full list of environment variables.

### 2. GitHub connected through the GitHub App

Connect GitHub under **Code Repositories** using **Connect with GitHub App** — installing the app imports all of its repositories automatically and keeps them in sync. The GitHub App is the only connection the agent can push through (GitLab is on the roadmap).

You do **not** map repositories to services: OneUptime resolves the right repository at fix time by matching the exception's stack-trace file paths against your connected repositories (falling back to repository-name matching and, when the project has exactly one repository, to that repository). The readiness checklist on the exception page shows which repository resolved and why.

### 3. An agent online

- **OneUptime Cloud**: the shared agent fleet is available automatically — there is nothing to run.
- **Self-hosted**: the agent container runs by default — the Docker Compose install includes the `ai-agent` service, and the Helm chart deploys it (`aiAgent.enabled`, default `true`). It registers itself with your instance automatically (no credentials to copy) and shows up on the agents page. The agent idles cheaply when no LLM provider is configured; tasks fail early with guidance until one is set up.

To run an additional agent elsewhere (for example on a machine closer to your repositories), create an agent under **Settings** > **Sentinel** > **AI Agents**. You will get an `AI_AGENT_ID` and an `AI_AGENT_KEY` (the key is shown once — save it securely). Then run the agent container:

```bash
docker run --name oneuptime-ai-agent --network host \
  -e AI_AGENT_KEY=<ai-agent-key> \
  -e AI_AGENT_ID=<ai-agent-id> \
  -e ONEUPTIME_URL=<your-oneuptime-url> \
  -d oneuptime/ai-agent:release
```

The agent page in the dashboard shows this command pre-filled with your agent's credentials. Any way of running the container works (Docker Compose, Kubernetes, and so on) as long as these environment variables are set and the container can reach your OneUptime instance over HTTPS:

| Variable        | Description                                                          |
| --------------- | -------------------------------------------------------------------- |
| `AI_AGENT_KEY`  | The agent key shown when the agent was created                       |
| `AI_AGENT_ID`   | The agent ID from the dashboard                                      |
| `ONEUPTIME_URL` | Your OneUptime instance URL (`https://oneuptime.com` on Cloud)       |

The agent shows as connected on the **Settings** > **Sentinel** > **AI Agents** page within a few minutes. If it does not, check the container logs (`docker logs oneuptime-ai-agent`) for credential or network errors.

## When a fix fails

- **The run errors** (the fix could not be applied, the repository was unreachable, the LLM call failed): the task's error is shown on the exception page with the reason, and you can retry the fix from there. The full run log is on the task's detail page.
- **The agent crashes mid-run**: a task stuck in progress for more than 30 minutes is automatically reset and retried.
- **No agent is online**: a queued task that waits more than 30 minutes while no agent is connected is failed automatically, with guidance to check the agent container — it will not show "in progress" forever. (If an agent is online but busy, queued tasks simply wait their turn.)

## Privacy

The repository clone lives in an ephemeral workspace inside the agent container and is deleted when the run finishes, whether it succeeded or failed. OneUptime does not store your code or train on it. Run a self-hosted agent with your own LLM provider (including local Ollama) and your code never leaves your infrastructure.

## On the roadmap

Planned, but **not available today**:

- **GitLab support** — repository connections are currently GitHub App only.
- **Richer telemetry context** — feeding related traces, logs, and metrics around the exception into the fix, beyond the stack trace.
- **Verification loop** — building the project and running its tests against the fix before the pull request is opened.
