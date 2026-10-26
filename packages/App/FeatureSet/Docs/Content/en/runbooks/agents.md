# Runbook Agents

A **Runbook Agent**, called a **Runner** in the dashboard, is a small self-hosted process that runs the JavaScript, Bash, SSH and kubectl steps of your runbooks **inside your own infrastructure**. The OneUptime Worker never runs your scripts: it queues them, and the Runner the step's author picked claims each one, runs it and posts the result back. This page is for whoever installs and operates Runners. A step that picks no Runner runs on the project's [default Runner](#the-projects-default-runner), if you set one; a JavaScript step otherwise runs on a [global Runner](#global-runners), one OneUptime runs for every project.

:::cards
- [Install a Runner](#install-a-runner): From the dashboard to a connected container, in five steps.
- [Point a step at a Runner](#point-a-step-at-a-runner): Bind a step to the Runner that should run it.
- [The project's default Runner](#the-projects-default-runner): The Runner a step or a code repository works on when it picks none.
- [Global Runners](#global-runners): The Runners OneUptime runs for every project, and what they run.
- [Timeouts](#timeouts): Claim and execution timeouts, and how they interact.
- [Environment variables](#environment-variables): What the container reads when it starts.
:::

## How it works

```mermaid title="What crosses the network between a Runner and OneUptime"
flowchart TB
    subgraph cloud["OneUptime"]
        direction LR
        worker["Worker queues the step"]
        ingest["Runner API"]
    end
    subgraph yours["Your infrastructure"]
        direction LR
        runner["Runner container"]
        targets["Hosts, clusters, internal services"]
    end
    worker --> ingest
    runner -->|"Outbound HTTPS, Runner ID and key"| ingest
    ingest -->|"Claimed job, with its secrets"| runner
    runner -->|"Script, SSH or Kubernetes API"| targets
```

1. You create a Runner in OneUptime. OneUptime generates an ID and a secret key for it.
2. You run the Runner container on a host inside your infrastructure, with that ID and key and your OneUptime URL.
3. The Runner asks OneUptime for work every 5 seconds, and reports that it is alive every 60 seconds.
4. When you write a JavaScript, Bash, SSH or kubectl step, you pick the Runner from a dropdown under the step's **More fields**. The step is bound to that Runner. A step that picks none runs on the project's default Runner, if you set one, and a JavaScript step otherwise on **Global Runner**.
5. When the step runs, the Worker queues a job with `targetAgentId` set to that Runner. Only that Runner can claim it.
6. The Runner runs the job locally — `bash -c <script>` for Bash and kubectl, an `isolated-vm` sandbox for JavaScript, an SSH connection that runs the script with bash on the machine — captures the result, hides the step's secrets in it, and posts it back. The Worker resumes the runbook with the result.

The Runner only needs **outbound HTTPS** to your OneUptime instance. It does not accept any inbound connections.

What a Runner holds is its ID and key. It receives everything else with the job it claims: a script, with the [runbook variables](/docs/runbooks/variables) it names filled in, and an SSH step's key or password or a kubectl step's kubeconfig. It gets a secret only when the secret lets it use it. That is why anyone holding a Runner's key can act as that Runner: treat the key like the secrets it may use.

## Why scripts run on a Runner

Running scripts on the OneUptime Worker had two problems:

- **Trust boundary.** Anyone who could author a runbook could run code on the Worker, with access to whatever the Worker could reach.
- **Reach.** Most useful steps act on _your_ infrastructure ("restart this service", "look up a record in our internal database"), not on OneUptime's.

With Runners, those steps run on a host you control, and you decide what that host can do. HTTP request and AI steps still run on the Worker, because they need nothing from your network.

## Global Runners

Global Runners are the Runners OneUptime runs for every project. A JavaScript step that picks no Runner of its own runs on one, unless the project has a [default Runner](#the-projects-default-runner), so you can write one before you install anything. **Runbooks → Runners** lists them under **Global Runners**, above your own Runners, and a JavaScript step's **Runner** dropdown offers **Global Runner** first, or right after the project's default Runner. A Bash, SSH or kubectl step's dropdown shows it last, greyed out, saying **Runs JavaScript steps only.** Those steps run on a Runner of your own, inside your network, never on one every project shares.

| | Global Runner | Your own Runner |
| --- | --- | --- |
| Steps it runs | JavaScript | JavaScript, Bash, SSH and kubectl |
| What a step can reach | Public internet addresses | What its host can reach |
| Longest a step runs | 5 minutes | 1 hour |
| Secret variables | The ones you let global Runners use | The ones that list it |
| OneUptime AI's Bash commands | Never | For the AI rules that pick it |

A global Runner runs the steps of many projects, so each step is kept apart from every other:

- Each step runs in an `isolated-vm` sandbox of its own, made for that step and thrown away after it: no files, no processes, no environment variables, and nothing kept from one step to the next.
- Its HTTP requests reach public internet addresses only, never a private, loopback or link-local address or a cloud metadata endpoint, so a global Runner never reaches your network.
- It gets a secret variable only when the variable's **Global Runners can use it** switch is on, and only for a step of the variable's own project.
- A project runs at most three steps on global Runners at once, so no project keeps them to itself.

Pick one of your own Runners for a step that must reach your network, or to keep the step on hosts you control. To keep every step on your own Runners, turn **Use global Runners** off at the bottom of **Runbooks → Runners**. A JavaScript step that picks no Runner then runs on the project's default Runner or, with none set, fails, saying so, until it picks one of yours; a step that picks one of your Runners keeps it either way. A code repository that picks no Runner in its settings in Code works on the project's default Runner too or, with none set, on a global Runner, and needs one of yours while the switch is off; see [Code](/docs/ai/ai-agent#pick-the-repositorys-runner).

### Where global Runners come from

On OneUptime Cloud, OneUptime runs them. A self-hosted install runs one of its own by default, as it runs its own global probes: the `global-runner` service in Docker Compose, and the `globalRunner` deployment in the Helm chart. It holds its own key, `GLOBAL_RUNNER_KEY`, and nothing else of the server's.

A master admin can add more, to run steps from other hosts: in the Admin Dashboard, open **Settings**, then **Global Runners**, create one, and run the command its **Show ID and Key** gives on a host that can reach the internet.

To turn the bundled one off, set `GLOBAL_RUNNER_REPLICAS=0` in Docker Compose's `config.env`, or `globalRunner.enabled` to `false` in the Helm chart. With no global Runner at all, **Runbooks → Runners** lists your own Runners only, and every JavaScript step picks one of them.

## Before you begin

- **A host with Docker** inside your infrastructure, that can reach your OneUptime URL over HTTPS and the systems your steps act on.
- **A role that creates Runners.** Project Owner, Project Admin, Project Member and Runbook Admin can create one. Only a Project Owner, Project Admin or Runbook Admin can see a Runner's key, which the setup command contains.

## Install a Runner

### 1. Create the agent record

Go to **Runbooks → Runners** and create a new agent. Click **Create Runner** and fill in its fields, all on one page:

| Field | Where | Notes |
| --- | --- | --- |
| **Name** | On the page | A friendly name, usually where it runs and what it can reach, such as `prod-eu-west-1`. This is what you pick when you write a step. |
| **Description** | On the page | Optional. A sentence on what this host can reach. |
| **Runs Runbooks** | Under **More fields** | On by default. Lets this Runner take runbook steps. |
| **Labels** | Under **More fields** | Optional. |

A Runner picks up a change to its capabilities on its next heartbeat; there is no need to restart it. AI is not a capability. A code repository picks the Runner AI works in it on, in its settings in Code, and the Runner's page lists the repositories that pick it. An AI rule picks the Runner OneUptime AI runs its commands on: picking a Runner there is what lets OneUptime AI's commands run on it.

### 2. Copy the install command

On the Runner's row, click **Show setup instructions**. The **Runner setup** dialog shows a `docker run` command preloaded with this Runner's ID and key. The same command is on the Runner's own page, under **Setup Instructions**.

Only a Project Owner, Project Admin or Runbook Admin can read the key. Anyone else sees "You do not have permission to view this Runner's key" instead of the command.

### 3. Run it on a host inside your infrastructure

Run the command on a host in your environment that can:

- reach your OneUptime instance over HTTPS, and
- do what your steps need to do, such as reach other hosts over SSH, call a cluster's API server or talk to a database.

```bash
docker run --name oneuptime-runner --restart unless-stopped \
  -e ONEUPTIME_RUNNER_ID=<runner-id> \
  -e ONEUPTIME_RUNNER_KEY=<runner-key> \
  -e ONEUPTIME_URL=https://oneuptime.yourdomain.com \
  -d oneuptime/runner:release
```

### 4. Verify the agent is connected

Go back to **Runbooks → Runners**. Within a minute of the container starting, the Runner's **Status** should read **Connected**, with a fresh **Last Seen**. On the Runner's own page, the **Runner Status** card shows its **Runner Version** and **Host**. If it stays **Never connected** or **Disconnected**, see [Troubleshooting](#troubleshooting).

### 5. Keep the agent up to date

When an agent runs an older version than your OneUptime, a warning sign appears beside its **Runner Version** on its page. Select it to see how to upgrade: pull the new image and remove the container, then run the install command from step 2 again. An agent the Kubernetes agent chart installed is upgraded with the chart instead.

```bash
docker pull oneuptime/runner:release
docker rm -f oneuptime-runner
```

## Point a step at a Runner

:::steps
### Add a step that runs on a Runner

In your runbook's **Steps**, add a JavaScript, Bash, SSH or kubectl step.

### Pick the Runner

Open the step's **More fields**: its **Runner** dropdown lists every Runner in the project, with whether it is connected, and the folded line names the Runner the step runs on. If the project has none yet, the step says so and points you to **Runbooks › Runners**. The first choice is what a step that picks no Runner runs on: the project's [default Runner](#the-projects-default-runner), marked **Project default**, or else, for a JavaScript step, **Global Runner**.

### Save the steps

Click **Save Steps**. When a run reaches the step, the Worker queues a job for that Runner's ID, and only that Runner can claim it. A step on **Global Runner** waits for whichever global Runner is free.
:::

Bash is executed with `bash -c`. JavaScript runs in an `isolated-vm` sandbox on the Runner, with no filesystem or process access; it can call public HTTP APIs with `axios`, but not addresses on a private network. An SSH or kubectl step signs in with a secret [runbook variable](/docs/runbooks/variables), which must list the step's Runner under **Your Runners that can use it**.

Need more than one Runner? Create them, then point each step at the one that fits. For redundancy, run a second Runner and split your steps between them, or keep a backup runbook whose steps target the other Runner.

## The project's default Runner

A project can make one of its own Runners its default, as it makes one Twilio configuration its default. Every runbook step that picks no Runner then runs on it: Bash, SSH and kubectl steps, and JavaScript steps, which would otherwise run on a global Runner. So does AI in every code repository that picks no Runner in its settings in Code.

To make a Runner the default, go to **Runbooks → Runners**, open the **⋯** menu on the Runner's row, click **Set as Project Default** and confirm with **Make Project Default**. Or open the Runner, and on its **Project Default** card turn on **Use as the project default**. The list marks the default **Project default**, beside its name, and so does a step's **Runner** dropdown, on its first choice. A project has one default Runner: making another Runner the default replaces it. **Stop Using as Project Default**, in the same menu, or the switch on the Runner's page, stops using it.

Where a step that picks no Runner runs:

| The project | A JavaScript step | A Bash, SSH or kubectl step |
| --- | --- | --- |
| Has a default Runner | The default Runner | The default Runner |
| Has none, and uses global Runners | A global Runner | Nowhere: the step fails, saying it has no Runner |
| Has none, and does not use global Runners | Nowhere: the step fails, saying so | Nowhere: the step fails, saying it has no Runner |

A step that picked a Runner keeps it, whatever the default is, and a JavaScript step can still pick **Global Runner** itself. Setting a default changes no saved step.

The default is one of the project's own Runners that runs runbook steps: not a global Runner, not the in-cluster Runner the Kubernetes agent installed, and not one with **Runs Runbooks** off. While a Runner is the default, its **Runs Runbooks** stays on. When the default is not connected, a step's dropdown says so, and a step on it waits for it, as for any Runner, until its claim timeout.

Runbook steps and code repositories that pick no Runner use the default, and move with it when another Runner becomes the default. An AI rule picks its own Runner, and a new rule starts on the default.

## Operational notes

### Timeouts

Two timeouts apply to every step that runs on a Runner:

| Timeout | Default | What it controls |
| --- | --- | --- |
| **Claim timeout** | 2 minutes | How long the Worker waits for the selected Runner to claim the job. If the Runner doesn't pick it up in time, the step fails as timed out and the runbook moves on (or stops, depending on **Continue on failure**). |
| **Execution timeout** | 30 seconds | How long the Runner lets the step run before stopping it. Bash gets `SIGKILL`; JavaScript's sandbox is torn down. |

Both are configurable per step. Open **Runbooks › your runbook › Steps**, expand the step, and set **Execution timeout** and **Claim timeout** (in seconds) under its **More fields**. Leave a field blank to use the default. Each accepts 1 second to 1 hour; values outside that range are clamped when the step runs.

The Worker's overall wait window is `claim timeout + execution timeout + a few seconds`. Pick numbers that match the step.

Two things to keep in mind when you lower the claim timeout:

- The Runner asks for work on a poll cycle (`ONEUPTIME_RUNNER_POLL_INTERVAL_MS`, 5 seconds by default). A claim timeout shorter than one poll cycle can expire before a perfectly healthy Runner has even seen the job, and the step then fails with the same message an offline Runner causes.
- A Runner runs one job at a time by default (`ONEUPTIME_RUNNER_CONCURRENCY`). While a long step occupies it, other steps pointed at the same Runner wait out their own claim timeouts. If you raise an execution timeout to minutes, raise the claim timeout on the steps that share that Runner to match, or give them a different Runner.

### Lease and heartbeat

```mermaid title="A job between OneUptime and its Runner"
sequenceDiagram
    participant O as OneUptime
    participant R as Runner
    O->>O: Queue a job for this Runner
    R->>O: Claim the next job
    O-->>R: The job, with a 30-second lease
    loop Every 10 seconds while it runs
        R->>O: Renew the lease
    end
    R->>O: Post the result
    O->>O: Record the output and continue the run
```

When a Runner claims a job, it gets a short lease (30 seconds by default). While the step runs, the Runner renews the lease every 10 seconds. If the Runner dies or loses its network mid-script, the lease expires and the Worker marks the job `TimedOut` rather than waiting forever.

Bash child processes are **not** automatically cancelled when the lease expires (a JavaScript sandbox is also left to finish, if it ever does), but the Worker stops waiting for them, and the Runner cannot submit a result once another claim has taken over. Design scripts to be safe to re-run if you care about exactly-once.

### If the OneUptime Worker restarts mid-step

A runbook execution runs on one Worker from start to finish, so a deploy or a crash can interrupt it while a step is in flight. What happens next depends on whether the execution gets picked back up:

- **It resumes.** The Worker that picks it up finds the job your step already created and **re-attaches to it**. It waits on that job rather than sending your Runner a second copy of the script. If the Runner had already finished, the recorded result is used as-is. A step is dispatched to a Runner at most once per execution.
- **It does not resume.** If the execution is never picked back up, a sweep marks it `Failed` once it has outlived the claim and execution window its current step was configured for, with a message naming that step. An execution never hangs in `Running`.

The one thing this cannot tell you is how far a script got before the Worker vanished. A step that was mid-run is reported as failed with a note that it may have partially run: check the target system before running the runbook again.

### No agent online

If the selected Runner is offline when the step runs, the job waits as `Pending` until the claim timeout elapses, and then the step fails with "No runbook agent picked up this step before the wait window expired." The **Runners** page is where you confirm coverage before running a runbook in anger. A step on a global Runner fails with "No global Runner picked up this step before the wait window expired." instead.

### Output cap

Combined stdout and stderr are capped at **50 KB** per step. Longer output is cut off with a marker. If you need a full log, write it to your log store or object storage inside the script and `echo` the URL.

### Cancellation

Cancelling a runbook execution, from the execution page or the API, immediately marks all of its `Pending`, `Claimed` and `Running` jobs as `Cancelled`. A Runner that's already mid-script finishes its work, but the server does not accept its result, and no later step in the runbook is dispatched.

### Concurrency

Each Runner runs one job at a time by default. To allow more, set `ONEUPTIME_RUNNER_CONCURRENCY` on the container, but remember the Runner shares the host with whatever else lives there.

## Environment variables

The Runner reads these on startup:

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `ONEUPTIME_URL` | yes | — | Base URL of your OneUptime instance, such as `https://oneuptime.yourdomain.com`. |
| `ONEUPTIME_RUNNER_ID` | yes | — | The Runner's ID, from its setup command. |
| `ONEUPTIME_RUNNER_KEY` | yes | — | The Runner's secret key, from its setup command. |
| `ONEUPTIME_RUNNER_POLL_INTERVAL_MS` | no | `5000` | How often the Runner asks for new jobs. A value under `1000` falls back to the default. |
| `ONEUPTIME_RUNNER_HEARTBEAT_INTERVAL_MS` | no | `60000` | How often the Runner reports that it is alive. A value under `5000` falls back to the default. |
| `ONEUPTIME_RUNNER_JOB_HEARTBEAT_INTERVAL_MS` | no | `10000` | How often the Runner renews a running job's lease. A value under `1000` falls back to the default. |
| `ONEUPTIME_RUNNER_CONCURRENCY` | no | `1` | Maximum simultaneous jobs on this Runner. |
| `ONEUPTIME_RUNNER_ENABLE_RUNBOOKS` | no | — | Set to `false` to stop this Runner taking runbook steps, whatever the dashboard says. It can only turn the capability off. |
| `ONEUPTIME_RUNNER_ENABLE_CODE_FIXES` | no | — | Set to `false` to stop this Runner taking AI code-fix runs, even for a code repository that picks it. |
| `ONEUPTIME_RUNNER_ENABLE_AI_COMMANDS` | no | — | Set to `false` to stop this Runner running AI remediation commands, whatever the dashboard says. |

## Rotating an agent key

If a key leaks, reset it. The old key stops working immediately.

:::steps
### Reset the key

Open the Runner from **Runbooks → Runners**, click **Reset Runner Key** and confirm. The Runner stops connecting until it has the new key.

### Run the container with the new key

Copy the new command from the Runner's **Setup Instructions**, remove the old container and run the new command on the same host:

```bash
docker rm -f oneuptime-runner
```

### Check that it reconnects

On **Runbooks → Runners**, the Runner's **Status** goes back to **Connected** within a minute.
:::

## Permissions

Managing agents lives under the existing Runbooks permission group:

- `CreateRunner`, `EditRunner`, `DeleteRunner`, `ReadRunner` — manage agent records.
- `RunbookAdmin`, `RunbookMember`, `RunbookViewer` (roles) — `RunbookAdmin` builds runbooks, their rules and the Runners they run on, and runs them. `RunbookMember` opens runbooks and their runs and runs them — it starts a run, completes or skips its steps and cancels it — but creates, changes and deletes no runbook or Runner. `RunbookViewer` reads runbooks and their runs and runs nothing. `RunbookAdmin` bundles all of the granular permissions above.
- Global Runners belong to no project: only a master admin adds, changes or removes one, in the Admin Dashboard. Everyone who can read a project's Runners sees them, and turning **Use global Runners** off takes the permission to edit the project.

Triggering a runbook (and so dispatching its steps to Runners) takes a role that runs runbooks — `ProjectOwner`, `ProjectAdmin`, `ProjectMember`, `RunbookAdmin` or `RunbookMember` — or `CreateRunbookExecution`; completing, skipping or cancelling a run also accepts `EditRunbookExecution`. A role runs only the runbooks its scope reaches.

A Runner's key is readable only by Project Owners, Project Admins and Runbook Admins.

## Agent-facing API

For the curious: the Runner uses these endpoints, mounted under `/runner-ingest`. The pre-merge path `/runbook-agent-ingest` is still served for agents that have not been redeployed yet, so upgrading the server does not break them. They are authenticated by the Runner's ID and key in the JSON body (`agentId` and `agentKey`), or in the `x-agent-id` and `x-agent-key` headers.

| Endpoint | Purpose |
| --- | --- |
| `POST /heartbeat` | Liveness. Updates the Runner's last-seen time, version and host information, and returns the capabilities the project granted it. |
| `POST /claim-next-job` | Atomically claim the oldest `Pending` job targeted at this Runner's ID. Returns `{ job: null }` when there is nothing to do. A global Runner claims the oldest step that waits for any global Runner instead. |
| `POST /job/:jobId/heartbeat` | Refresh the job's lease. Returns 404 once the lease has lapsed or the job is terminal. |
| `POST /job/:jobId/result` | Submit the final outcome. Ignored if the lease has already moved on. |
| `POST /disconnect` | Sign off on a clean shutdown. |

You should not need to call these by hand: the bundled Runner does. They're documented here so you can build your own agent if you have a constraint that ours doesn't fit.

## Troubleshooting

:::details The Runner stays Never connected or Disconnected
- Check the container logs with `docker logs oneuptime-runner` for authentication errors or network failures.
- Check that the host can reach your OneUptime URL, for example with `curl`.
- Check that the ID and key were copied without whitespace, and that `ONEUPTIME_URL` is the address you open OneUptime at.

**Never connected** means the Runner has never reported in. **Disconnected** means it did, but not in the last 5 minutes.
:::

:::details Steps fail with "No runbook agent picked up this step before the wait window expired."
The step's Runner did not claim the job within its claim timeout. Check that the Runner is **Connected**, that **Runs Runbooks** is on for it, and that it is not busy with a long step: it runs one job at a time unless you raise `ONEUPTIME_RUNNER_CONCURRENCY`. A claim timeout shorter than the poll interval fails the same way.
:::

:::details Steps fail with "The runbook agent stopped responding while this step was running."
The Runner claimed the job, then stopped renewing its lease: it crashed, restarted or lost its network. Check that it is online, then check the target system before you run the runbook again.
:::

:::details The Runner logs "No capability is enabled"
Every capability is off for this Runner. Turn on **Runs Runbooks** on the Runner's page in OneUptime. It picks the change up on its next heartbeat.
:::

:::details A step fails because its Runner may not use a secret variable
The step names a secret variable that does not let its Runner use it, so the Runner was not handed it and the step was not run. The error names the secret and what to change. Under **Runbooks → Settings → Global Variables**, or the runbook's **Settings → Variables**, add the Runner under **Your Runners that can use it**, or turn **Global Runners can use it** on for a step on a global Runner. Or pick a Runner the secret lets use it.
:::

:::details A kubectl step fails because its Runner is too old
The step failed with "This kubectl step runs a script, and this Runner is too old to run one, so it was not run." A Runner older than kubectl scripts cannot run one. A Kubernetes step moved to a kubectl script when you upgraded still runs on it, as the action it was written as, until its script or kubeconfig is changed. Update the Runner, as [Keep the agent up to date](#5-keep-the-agent-up-to-date) shows, then run the runbook again.
:::

## Next steps

:::cards
- [Authoring a Runbook](/docs/runbooks/authoring): Write the steps that run on your Runner.
- [Runbook Variables](/docs/runbooks/variables): The values and secrets your steps use, and the Runners that get them.
- [Runbook Configuration & Safety](/docs/runbooks/configuration): Limits, permissions and hardening.
:::
