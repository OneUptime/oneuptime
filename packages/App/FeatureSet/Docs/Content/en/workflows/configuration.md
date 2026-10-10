# Workflow Configuration & Safety

What to know before you point a workflow at real traffic: how to turn it on safely, who can do what, how secrets and URLs stay private, what a workflow's steps may change, and the limits every run works within.

:::cards
- [Going live](#turning-a-workflow-on-or-off): Test with Run Workflow, then leave the workflow on.
- [Permissions](#permissions): The workflow roles, and the single permissions behind them.
- [What steps can do](#what-workflow-steps-can-do): Steps act as a Project Admin of the workflow's project.
- [Limits](#plan-limits): Runs per plan, run time, and calls between workflows.
:::

## Turning a workflow on or off

Every workflow has an **Enabled** switch at the top of its **Builder**, and on its **Overview** page. When it's off, the workflow doesn't run — webhook calls, incoming email, scheduled times, and OneUptime events are all ignored, and so are **Run Workflow** and **Run just this step**. New workflows start disabled.

Use this switch as your "ready to go" gate:

:::steps
1. Build the workflow.
2. Click **Run Workflow** on the **Builder** with realistic values. A disabled workflow can't run even by hand, so the Builder asks to turn it on first: click **Turn on and run**.
3. Open the run and check that every block went where you expected. See [Runs](/docs/workflows/runs-and-logs).
4. Leave **Enabled** on if it's ready. If it isn't, switch it off until it is: while it's on, its trigger fires on real events.
:::

Turning a workflow off stops new runs from starting. A run already in progress finishes, but a run waiting on a **Sleep** block is cancelled when it wakes.

## Archiving a workflow

Archive a workflow you no longer need but want to keep. An archived workflow:

- **Never runs**, from any trigger. Manual runs and **Run just this step**, webhook calls, schedules, OneUptime events, incoming email, and other workflows' **Execute Workflow** steps are all refused. A webhook call to an archived workflow gets an error that says the workflow is archived.
- **Stops runs that are waiting.** A run sleeping in a **Sleep** step is cancelled when it wakes up, and a run that was queued but hadn't started yet ends with "Workflow was archived before this run started, so it did not run."
- **Leaves the Workflows list.** Find it under **Workflows → Advanced → Archived**.
- **Keeps everything.** Its steps, variables, owners, labels, and run history stay as they were.

To archive one workflow, open it, go to **Settings** and click **Archive**. To archive several, select them in the **Workflows** list and choose **Archive**.

To bring a workflow back, open **Workflows → Advanced → Archived**, select it and choose **Unarchive**, or open it and click **Unarchive** on the banner at the top of its pages.

Archiving and the **Enabled** switch are separate. Archiving doesn't touch the switch, so a workflow that was on runs again as soon as it is unarchived, and one that was off stays off. The **Archived** page shows which is which in its **When Unarchived** column.

An exported workflow never carries its archived state, so an imported copy is never archived.

## Owners and labels

| What            | Where                                   | What it does                                                                                                                                         |
| --------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Owners**      | The workflow's **Owners** page          | The users and teams responsible for the workflow. A role limited to what its team owns reaches the workflows that team owns.                         |
| **Labels**      | The workflow's **Overview** page        | Tags for grouping workflows, by team, integration or environment. Filter the **Workflows** list by label, and limit a role to some labels.           |
| **Label Rules** | **Workflows → Settings → Label Rules**  | Label new workflows automatically, by patterns in their name or description.                                                                         |
| **Owner Rules** | **Workflows → Settings → Owner Rules**  | Assign owners to new workflows automatically.                                                                                                        |

See [Label & owner rules](/docs/configuration/label-and-owner-rules) for how the rules match.

## Secrets

Mark a variable as a **secret** if it holds something sensitive: its value is then scrubbed out of run logs and step traces. No variable's value can be read back once it is saved, secret or not, in the dashboard or over the API, and once a variable is secret, it stays secret.

Use secret variables for:

- API keys for outside services.
- Authentication tokens.
- Webhook signing keys.
- Anything you wouldn't want someone with read-only access to see.

Don't paste a secret directly into a block — values like `Authorization: Bearer eyJh...` end up visible in the workflow and the logs. Use `{{global.variables.MY_SECRET}}` instead.

If the secret is an OAuth access token that expires, make the variable an [OAuth 2.0 variable](/docs/workflows/variables#oauth-20-variables-tokens-that-refresh-themselves). OneUptime then fetches the token from your identity provider and refreshes it whenever a workflow is about to use an expired one. OAuth 2.0 variables are always secret, and their credentials are encrypted in the database.

## Exporting and importing workflows

You can move a workflow between projects, or between a self-hosted install and OneUptime Cloud, as a JSON file.

:::tabs
@tab Export
Open the workflow, go to **Settings** and click **Export Workflow**. To put several workflows in one file, select them in the **Workflows** list and choose **Export JSON**.
@tab Import
On the **Workflows** list, click **Import JSON** and pick a file exported from any OneUptime project. A workflow whose name the project already has is imported with "(Imported)" after its name.
:::

The file holds the workflow's name, description, enabled state, and its graph. It deliberately does not hold:

- **The webhook secret key.** A fresh one is generated when the workflow is created, so an imported workflow has a different webhook URL — copy it from the new workflow's Webhook trigger. Anything calling the original has to be repointed.
- **The incoming email address.** An imported workflow with an Incoming Email trigger gets an address of its own — copy it from the new workflow's trigger. Anything emailing the original has to be given the new address.
- **Global variables.** A block that reads `{{global.variables.MY_SECRET}}` keeps that reference, but the value is not in the file. Create the variables in the destination project before you run the imported workflow.
- **Owners and labels.** Your project's own label and owner rules run against the imported workflow, the same as if you had created it by hand.

An imported workflow is always created **disabled**, even if it was enabled where it was exported from — its graph can point at monitors, on-call policies, or other workflows that don't exist in the destination project. Review it, enable it, test it with **Run Workflow**, and then leave it on. Duplicating a workflow behaves the same way, so a copy never starts firing alongside the original before you've edited it.

Because the graph travels verbatim, anything typed straight into a block travels with it. That's the practical reason to keep credentials in secret variables: exporting a workflow with a hardcoded token hands that token to whoever receives the file.

## Webhook security

Webhook triggers give you a unique URL. Anyone who knows the URL can hit it. To protect against accidental or unwanted callers:

- Treat the URL like a password. Don't share it publicly or commit it to a public repo. The Webhook trigger masks the URL's secret key until you click **Show**, and **Copy URL** copies the URL without showing it.
- If the URL leaks, click the Webhook trigger in the **Builder** and click **Reset URL**. The workflow gets a new URL and the old one stops working at once.
- If the trigger says its URL ends in the workflow's ID, reset it. Workflows created before webhook URLs had a secret key of their own use the workflow's ID instead, and anyone who can open the workflow can see that.
- For sensitive workflows, ask the calling system to send a shared token as a header (like `X-Webhook-Token`) and check it with an **If / Else** block before doing anything important. Save the expected token as a secret variable.
- For very sensitive workflows, prefer a OneUptime event trigger and a manual import step instead of a public webhook.

Only people who can edit the workflow — **Project Owner**, **Project Admin**, **Workflow Admin** or **Edit Workflow** — can see or reset its webhook URL. Anyone with the URL can start the workflow from anywhere, without signing in, so everyone else sees a note saying who to ask instead. That includes a **Workflow Member**, who runs the workflow by hand from the **Builder**.

## Incoming email security

The Incoming Email trigger gives the workflow an address of its own, and anyone who knows the address can email it. The part before the `@` is the workflow's secret key, so treat the address like a password:

- Don't publish it or put it in a public repo. The trigger masks the key until you click **Show**, and **Copy address** copies the address without showing it.
- If the address leaks, click the Incoming Email trigger in the **Builder** and click **Reset address**. The workflow gets a new address, and email to the old one is ignored from then on.
- Anyone can put any sender on an email, so **From** is not proof of who sent it. Before a workflow does anything important, check something only the real sender knows — a token in the subject or a header — with an **If / Else** block. Save the expected token as a secret variable.
- The key is masked in everything the run receives — **To**, **CC**, the headers and the bodies — because the run's log is visible to anyone who can read the workflow's runs.

Only people who can edit the workflow — **Project Owner**, **Project Admin**, **Workflow Admin** or **Edit Workflow** — can see or reset its address. Everyone else sees a note saying who to ask.

## Outbound network access

API and other HTTP blocks make their requests from OneUptime, and the IRC block connects from OneUptime to the IRC server's port. If you self-host, make sure your installation can reach the services you're calling. If you use OneUptime Cloud, our outbound IP ranges are listed in [IP Addresses](/docs/configuration/ip-addresses) so you can allow them on the other side.

Which addresses a block may reach depends on the block:

| Blocks                                                  | Loopback, link-local, cloud metadata                                     | Private network addresses                                                                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| **API** blocks and **Run Custom JavaScript** requests   | Refused, unless the exact host is named in `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` | Refused, unless a self-hosted administrator allows them with `ALLOW_PRIVATE_NETWORK_WEBHOOKS` or `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` |
| **Send Email**, **IRC** and OAuth 2.0 token URLs        | Refused                                                                  | Refused on OneUptime Cloud. Allowed on a self-hosted install, unless `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` is `true`                 |
| Slack, Microsoft Teams, Discord and Telegram            | Refused                                                                  | Refused: each sends only to its own service's addresses                                                                             |

See [Private Network Access](/docs/self-hosted/private-network-access) for how a self-hosted administrator opens these up.

## AI components

**Generate Text with AI** sends one request to an LLM: the project's default LLM provider, or the installation's global provider when the project has none. Set providers up under **Project Settings → AI → LLM Providers**, and never put a provider's API key or an endpoint of your own in a workflow.

What the provider receives, and what the model can do with it:

- **Only what you put in the block.** OneUptime sends a fixed safety instruction, then the block's **System Instructions**, **Prompt** and **Context**, with their references filled in. **Context** goes last, after a marker, and the safety instruction tells the model that everything after the marker is untrusted data, even text that looks like instructions.
- **Nothing else.** The trigger's data, the workflow's history, other blocks' outputs, project records, telemetry and secrets are never attached. They leave OneUptime only when you reference them in one of those three settings.
- **Text, and no tools.** The model can't query OneUptime, make HTTP requests or change data. A provider's additional parameters pass only an allowlist of generation-only tuning fields: they can't replace the messages, add tools, web search or other data sources, ask for anything but text or for several answers, stream, have the provider keep the request, or raise the block's output limit. Fields OneUptime doesn't know are dropped.
- **The model is your administrator's choice.** If generation has to stay offline, pick a model that doesn't retrieve anything on its own on the provider's side.

What is logged:

- The run's log hides the block's **System Instructions**, **Prompt**, **Context** and **Response**. Later blocks can still use them during the run, and a block you insert one into logs it by its own rules, so inserting one is a choice to show it.
- The provider, model, token counts, **LLM Log ID** and a safe error message stay visible, for operations and billing. A provider's raw error is kept out of every log, because a provider can repeat the request in it.
- Each call is listed under **Project Settings → AI → AI Logs** with its provider, model, status, tokens, cost and billing, without the prompt, the response or the raw error.

What it needs, and what it costs:

- **Enable AI** must be on, under **Project Settings → AI → AI Features**. On OneUptime Cloud, the project also needs the Growth plan or above and a paid subscription. Self-hosted installations without billing have no plan gate.
- Calls through a costed global provider use the project's AI credits.
- Every call counts toward the [project's own daily AI limits](/docs/ai/ai-sre#the-projects-own-daily-limits), when a project owner sets them. Once a limit is reached, the block takes **Error** without contacting the model, until midnight UTC.

| Limit                                                        | Value                                                                 |
| ------------------------------------------------------------ | --------------------------------------------------------------------- |
| **System Instructions**, **Prompt** and **Context** together | 50,000 characters                                                     |
| **Temperature**                                              | From `0` to `1`                                                       |
| **Maximum Output Tokens**                                    | From `1` to `4096`, `1024` by default                                 |
| One request                                                  | Tried once, for 60 seconds at most                                    |
| Calls at the same time                                       | 3 per project. Any more take **Error**, and a later run can try again. |

Validation, configuration, access, limit, credit, concurrency, provider and timeout failures all take the **Error** path, with the reason in **Error**. Connect that path before the workflow goes live.

> [!WARNING]
> Every value you reference is data you send to the provider. Don't put a secret variable in the prompt or the context unless the provider is approved to receive it. A self-hosted local provider such as Ollama keeps requests inside your own infrastructure; a hosted provider receives them under its own data-processing terms.

## Permissions

Workflows respect your project's role-based access control. The three workflow roles:

- **Workflow Admin** — builds workflows: creates, changes, runs and deletes them, and manages the variables they use.
- **Workflow Member** — uses them: opens workflows and their runs, and runs a workflow by hand with **Run Workflow**. A member can't create, change or delete a workflow, or run one of its steps on its own.
- **Workflow Viewer** — reads workflows and their runs.

**Project Owner** and **Project Admin** can do everything a Workflow Admin can. **Project Member** can create and delete workflows, but not change or run them.

The single permissions, for a team or an API key that needs exactly one thing:

- **Create / Read / Edit / Delete Workflow** — the basic permissions on the workflow itself. Changing a workflow, including turning it on or off and archiving it, takes **Edit Workflow**; **Delete Workflow** only deletes.
- **Edit Workflow** — also what it takes to run one step on its own with **Run just this step**, and to see or reset a workflow's webhook URL and incoming email address. Running a whole workflow by hand takes **Edit Workflow**, **Workflow Admin** or **Workflow Member**.
- **Read Workflow Log** — needed to view runs.
- **Create / Read / Edit / Delete Workflow Variables** — managing global and workflow variables.

A run by hand only reaches workflows you can open: a role limited to some labels, or to the workflows your team owns, runs only those. Someone who can't run a workflow sees **Run Workflow** greyed out, with the reason in its tooltip.

Give the people who build automation **Workflow Admin**, and the people who only start it **Workflow Member**. Save variable edit access for the people who manage your project's secrets. See [Users, Teams & Permissions](/docs/permissions/index) for how roles are granted.

## What workflow steps can do

The steps that read and change OneUptime records — the Find, Create, Update and Delete components, and the On Create, On Update and On Delete triggers — act as a **Project Admin** of the workflow's project. Whoever built the workflow, a step meets the same checks a Project Admin meets in the dashboard and the API:

- **Only the workflow's own project.** A step reads and writes the records of the project the workflow belongs to and no other, and an Update never moves a record to another project.
- **Only what a Project Admin may do.** A step can grant only the team and API key permissions a Project Admin holds itself, so it can't hand out **Project Owner**, billing or project-deletion permissions, and it can't add someone to a team whose permissions go beyond a Project Admin's, such as the owners' team. A step can't read who created a probe or an AI agent, which only project owners see.
- **Not the read of settings that hold credentials.** A Project Admin may read runbook credentials, SMTP servers, call and SMS providers, SNMP credentials, video call connections and API keys, but a step is never lent that, whoever built or saved the workflow. A step can't name one of these settings, such as the SMTP server a status page sends email with or the API key a permission is granted to, and it can't make a change that takes the read of runbook credentials: letting OneUptime AI run its commands without asking, turning on **Runs AI Remediation Commands** for a Runner, assigning an SSH credential to a Runner that runs OneUptime AI's commands, or naming a runbook credential, such as in a runbook's steps. The step is refused, and its run log says a person who may read them (**Read Runbook Credential**, the read permission of that kind of setting, or a Project Owner or Project Admin) has to make the change. A step that keeps the setting a record names already, or clears it, is not refused.
- **Only what your plan includes.** On OneUptime Cloud, a step that creates or changes something your plan doesn't include is refused with the plan it needs, just as the dashboard is. Self-hosted installations without billing have no plan limits.
- **Nothing OneUptime keeps for itself.** These are refused to everyone, workflows included:
  - editing or deleting a feed entry (incident, alert, episode, monitor, on-call policy and scheduled maintenance feeds);
  - writing a notification log (SMS, call, email, WhatsApp, Telegram, push, webhook and workspace message logs);
  - values OneUptime sets as things happen: whether a custom domain's CNAME is verified, a team's protection switches (**Is Team Editable**, **Is Team Deleteable**, **Is Permissions Editable**, **Should Have At Least One Member**), which incident role is the primary one and whether it can be deleted, whether an owner or member has been notified, reminder times and counts, who is on call on a schedule now and next, an on-call run's progress, an SLO's current burn rate and error budget, a monitor paused by an incident or a maintenance event, a status page private user's password reset token and last sign-in, the facts a service reports about itself (version, runtime, cloud), and a detection rule's or threat feed's last run;
  - declaring an incident from a template by sending `createdIncidentTemplateId` to **Create One Incident** — pick the template under the step's **Incident Template** setting instead: the step then declares the incident from it, as a Project Admin, and records the template;
  - changing which record a record belongs to after it is created, such as the monitor an owner row is for or the incident a note is on.
- **As no person.** A record a workflow creates names no creator, and the audit log names the workflow, by its name at the time, as who made the change.

When a check refuses a step, the step takes its **Error** output without making the refused change, and the run log names the step and the reason in plain words, for example *"Create One Team Permission" was refused. Workflow steps can do only what a Project Admin of this project can do: …*. Read it under the workflow's [Runs](/docs/workflows/runs-and-logs). A Create Many step creates its records one at a time and stops at the first one refused: the records it created before that one are kept.

Steps that talk to other systems — API, Email, Slack, Microsoft Teams, Discord, Telegram, IRC, Custom Code and Generate Text with AI — don't read or change OneUptime records, so none of this changes them.

## Plan limits

On OneUptime Cloud, workflows need the Growth plan or above, and each plan allows a number of runs in any 30 days:

| Plan       | Runs in the last 30 days |
| ---------- | ------------------------ |
| Growth     | 500                      |
| Scale      | 2,000                    |
| Enterprise | No practical limit       |

The window rolls: every run the project records, by hand or from a trigger, counts for 30 days. On the Growth and Scale plans, the **Workflows** page shows a **Workflow Runs** card with how many the project has used. Once the limit is reached, new runs are recorded with the status **Execution Exceeded Current Plan** and don't execute, and the same happens while the subscription is unpaid. Self-hosted installations without billing have no limit.

## How long a run can take

| Limit                           | Default            | Self-hosted setting             |
| ------------------------------- | ------------------ | ------------------------------- |
| A run, from its start or from waking after a **Sleep** | 2 minutes | `WORKFLOW_TIMEOUT_IN_MS`        |
| A **Run Custom JavaScript** block | 5 seconds        | `WORKFLOW_SCRIPT_TIMEOUT_IN_MS` |
| A **Sleep** block               | 30 days at most    | —                               |

The runner checks the deadline before and after every block, and marks an overdue run **Timeout** as soon as control returns. It can't interrupt a block mid-way, so blocks that wait on the network have time limits of their own: a Generate Text with AI request gives up after at most 60 seconds, and an OAuth 2.0 token request after 20. A wait on a **Sleep** block doesn't count toward a run's time: the run is put aside and gets a fresh 2 minutes when it wakes.

## Limit on calling other workflows

The **Execute Workflow** component lets one workflow start another. To prevent loops where workflow A starts B, which starts A again, a chain of workflows that start each other is refused when it would loop back to a workflow already in it, or go deeper than 10 workflows. The **Execute Workflow** block then takes its **Error** output, and the error shows the chain.

If you have a real need for a long chain (like a job that processes one item per run), it's usually simpler to loop inside a single workflow using **Run Custom JavaScript**.

## When workflows aren't the right tool

A few cases where you should reach for something else:

- **Heavy computation or large datasets** — workflows are designed for light glue work, not number crunching. Run heavy work in your own infrastructure and let a workflow kick it off.
- **Long-running active computation** — a run has 2 minutes by default. For a passive delay such as "do A, wait two hours, do B," use the **Sleep** component; it puts the run aside and resumes it later without occupying a worker.
- **Step-by-step incident response with humans in the loop** — that's what [Runbooks](/docs/runbooks/index) are for. Workflows are for unattended automation.

## Next steps

:::cards
- [Workflows Overview](/docs/workflows/index): The big picture, and a first workflow end to end.
- [Components](/docs/workflows/components): What every block needs, returns and may reach.
- [Runbooks](/docs/runbooks/index): When people need to make the decisions along the way.
:::
