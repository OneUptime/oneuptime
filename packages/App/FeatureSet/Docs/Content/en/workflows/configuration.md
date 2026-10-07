# Configuration & Safety

This page covers the settings and safety limits worth knowing about before you point a workflow at real traffic.

## Turning a workflow on or off

Every workflow has an **Enabled** switch at the top of its **Builder**, and on its **Overview** page. When it's off, the workflow doesn't run — webhook calls, incoming email, scheduled times, and OneUptime events are all ignored, and so are **Run Workflow** and **Run just this step**. New workflows start disabled.

Use this switch as your "ready to go" gate:

1. Build the workflow.
2. Click **Run Workflow** on the **Builder** with realistic values. A disabled workflow can't run even by hand, so the Builder asks to turn it on first: click **Turn on and run**.
3. Check the **Logs** — make sure every block went where you expected.
4. Leave **Enabled** on if it's ready. If it isn't, switch it off until it is: while it's on, its trigger fires on real events.

Turning a workflow off doesn't stop runs that are already in progress; it just stops new ones from starting.

## Archiving a workflow

Archive a workflow you no longer need but want to keep. An archived workflow:

- **Never runs**, from any trigger. Manual runs and **Run this step**, webhook calls, schedules, OneUptime events, incoming email, and other workflows' **Run Workflow** steps are all refused. A webhook call to an archived workflow gets an error that says the workflow is archived.
- **Stops runs that are waiting.** A run sleeping in a **Sleep** step is cancelled when it wakes up, and a run that was queued but hadn't started yet ends with "Workflow was archived before this run started, so it did not run."
- **Leaves the Workflows list.** Find it under **Workflows → Advanced → Archived**.
- **Keeps everything.** Its steps, variables, owners, labels, and run history stay as they were.

To archive one workflow, open it and go to **Settings → Archive workflow**. To archive several, select them in the **Workflows** list and choose **Archive**.

To bring a workflow back, open **Workflows → Advanced → Archived**, select it and choose **Unarchive**, or open it and click **Unarchive** on the banner at the top of its pages.

Archiving and the **Enabled** switch are separate. Archiving doesn't touch the switch, so a workflow that was on runs again as soon as it is unarchived, and one that was off stays off. The **Archived** page shows which is which in its **When Unarchived** column.

An exported workflow never carries its archived state, so an imported copy is never archived.

## Owners and labels

- **Owners** — users and teams listed as owners get access to the workflow and can opt in to notifications when it fails. Set them under **Settings → Owners**.
- **Labels** — tags for grouping workflows. The workflow list lets you filter by label, which makes a busy project a lot easier to navigate. Useful when you have workflows organized by team, integration, or environment.
- **Label rules** — under **Workflows → Settings → Label Rules**, automatically apply labels to new workflows based on name or description patterns.
- **Owner rules** — under **Workflows → Settings → Owner Rules**, automatically assign owners to new workflows.

## Secrets

Mark a global variable as a **secret** if it contains something sensitive. The value is hidden from normal API and UI reads after you save it, and workflow logging scrubs the resolved value before the run log is persisted.

Use secret variables for:

- API keys for outside services.
- Authentication tokens.
- Webhook signing keys.
- Anything you wouldn't want someone with read-only access to see.

Don't paste a secret directly into a block — values like `Authorization: Bearer eyJh...` end up visible in the workflow and the logs. Use `{{global.variables.MY_SECRET}}` instead.

If the secret is an OAuth access token that expires, make the variable an [OAuth 2.0 variable](/docs/workflows/variables#oauth-20-variables-tokens-that-refresh-themselves). OneUptime then fetches the token from your identity provider and refreshes it whenever a workflow is about to use an expired one. OAuth 2.0 variables are always secret, and their credentials are encrypted in the database.

## Exporting and importing workflows

You can move a workflow between projects, or between a self-hosted install and OneUptime Cloud, as a JSON file.

- **Export** — open the workflow and use **Export Workflow** under **Settings**. From the workflow list you can also select several workflows and export them into a single file.
- **Import** — on the **Workflows** list, click **Import JSON** and pick a file exported from any OneUptime project.

The file holds the workflow's name, description, enabled state, and its graph. It deliberately does not hold:

- **The webhook secret key.** A fresh one is generated when the workflow is created, so an imported workflow has a different webhook URL — copy it from the new workflow's Webhook trigger. Anything calling the original has to be repointed.
- **The incoming email address.** An imported workflow with an Incoming Email trigger gets an address of its own — copy it from the new workflow's trigger. Anything emailing the original has to be given the new address.
- **Global variables.** A block that reads `{{global.variables.MY_SECRET}}` keeps that reference, but the value is not in the file. Create the variables in the destination project before you run the imported workflow.
- **Owners and labels.** Your project's own label and owner rules run against the imported workflow, the same as if you had created it by hand.

An imported workflow is always created **disabled**, even if it was enabled where it was exported from — its graph can point at monitors, on-call policies, or other workflows that don't exist in the destination project. Review it, enable it, test it with **Run Workflow**, and then leave it on. Duplicating a workflow behaves the same way, so a copy never starts firing alongside the original before you've edited it.

Because the graph travels verbatim, anything typed straight into a block travels with it. That's the practical reason to keep credentials in secret variables: exporting a workflow with a hardcoded token hands that token to whoever receives the file.

## How long a run can take

Each execution attempt has a wall-clock deadline. The runner checks it before and after every component and marks an overdue run **Timeout** as soon as control returns. Components that perform network or script work also need their own timeouts because the runner cannot forcibly interrupt arbitrary component code.

The AI component derives its provider-request timeout from the remaining workflow time and caps it at 60 seconds, leaving a small margin for logging and cleanup.

## Limit on calling other workflows

The **Execute Workflow** component lets one workflow call another. To prevent accidental loops where workflow A calls B which calls A again, there's a cap on how deep the chain can go. A run that goes past the limit ends with a clear error.

If you have a real need for a long chain (like a job that processes one item per run), it's usually simpler to loop inside a single workflow using **Custom Code**.

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
- Anyone can put any sender on an email, so **From** is not proof of who sent it. Before a workflow does anything important, check something only the real sender knows — a token in the subject or a header — with a **Conditions** block. Save the expected token as a secret variable.
- The key is masked in everything the run receives — **To**, **CC**, the headers and the bodies — because the run's log is visible to anyone who can read the workflow's runs.

Only people who can edit the workflow — **Project Owner**, **Project Admin**, **Workflow Admin** or **Edit Workflow** — can see or reset its address. Everyone else sees a note saying who to ask.

## Outbound network access

API and other HTTP blocks make their requests from OneUptime. If you self-host, make sure your installation can reach the services you're calling. If you use OneUptime Cloud, our outbound IP ranges are listed in [IP Addresses](/docs/configuration/ip-addresses) so you can allow them on the other side.

## AI components

**Generate Text with AI** sends one request through OneUptime's configured LLM gateway. It uses the project's default LLM provider, or the installation's global provider when the project does not have one. Configure providers under **Project Settings → AI → LLM Providers**; never put a provider API key or an arbitrary model endpoint in the workflow itself.

The AI component has an explicit egress boundary:

- OneUptime sends a fixed component-safety instruction plus the resolved **System Instructions**, **Prompt**, and serialized **Context** to the configured provider. Context is appended after an explicit marker at the end of the user message; the fixed instruction says everything after that marker remains untrusted data even when it contains tags or instructions.
- It does not automatically attach the trigger payload, workflow history, other component outputs, project records, telemetry, or secrets. Data leaves only when you reference it in one of those three inputs.
- It sends no tool definitions or provider-native capability fields. The model cannot query OneUptime, make HTTP requests, or mutate project data through this component. The configured provider/model remains an administrator trust boundary, so installations that require strictly offline generation should select a model without intrinsic provider-managed retrieval.
- Provider-level additional parameters are restricted to an allowlist of generation-only tuning fields. They cannot replace the workflow messages, add tools or provider-native web search/data sources, enable non-text modalities, request multiple choices, enable streaming, retain the request through provider storage flags, or raise this component's output-token cap. Unknown future capability fields are dropped by default.
- System Instructions, Prompt, Context, and generated Response values are redacted from this AI component's own argument and return-value entries in the automatic workflow execution log. They remain available to downstream components while the run is executing. If you insert one into another component, that component's logging policy applies and may record the resolved value; treat reuse as an explicit disclosure. Provider/model names, token counts, the LLM Log ID, and safe error messages remain visible for operations and billing. Raw provider error bodies are excluded from workflow logs, LLM logs, application logs, and traces because a provider can echo request content.

Treat every referenced variable as data you are intentionally sending to the provider. In particular, do not insert a secret global variable into the prompt or context unless that disclosure is required and the provider is approved to receive it. A self-hosted local provider such as Ollama can keep the request inside your own infrastructure; a hosted provider receives the request under that provider's data-processing terms.

Each call is recorded in **Project Settings → AI → AI Logs**, including provider, model, status, tokens, cost, and billing information. Prompt and response previews and raw provider error details are not stored in the AI log. Calls through a costed global provider consume the project's AI credit balance. Workflow AI also counts toward the project's daily autonomous AI token budget; when the budget is exhausted, the component takes its **Error** path without contacting the model. Project AI must be enabled. On OneUptime Cloud, the subscription must be paid and the Growth plan (or a plan that includes Growth features) is required; self-hosted installations with billing disabled do not have this plan gate.

Built-in bounds keep unattended calls finite: System Instructions, Prompt, and serialized Context are capped at 50,000 combined characters; Temperature must be from `0` through `1`; Maximum Output Tokens must be from `1` through `4096` (default `1024`); and the provider request is attempted once and times out after at most 60 seconds. No more than three workflow AI calls run concurrently per project; additional calls take the **Error** path and can be retried by a later workflow run. Validation, configuration, access, budget, balance, concurrency, provider, and timeout failures all take the **Error** path and populate the **Error** output. Connect that path before enabling a production workflow.

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
- **Read / Create / Edit / Delete Workflow Variable** — control over the global variables list.

A run by hand only reaches workflows you can open: a role limited to some labels, or to the workflows your team owns, runs only those. Someone who can't run a workflow sees **Run Workflow** greyed out, with the reason in its tooltip.

Give the people who build automation **Workflow Admin**, and the people who only start it **Workflow Member**. Save variable edit access for the people who manage your project's secrets.

## What workflow steps can do

The steps that read and change OneUptime records — the Find, Create, Update and Delete components, and the On Create, On Update and On Delete triggers — act as a **Project Admin** of the workflow's project. Whoever built the workflow, a step meets the same checks a Project Admin meets in the dashboard and the API:

- **Only the workflow's own project.** A step reads and writes the records of the project the workflow belongs to and no other, and an Update never moves a record to another project.
- **Only what a Project Admin may do.** A step can grant only the team and API key permissions a Project Admin holds itself, so it can't hand out **Project Owner**, billing or project-deletion permissions, and it can't add someone to a team whose permissions go beyond a Project Admin's, such as the owners' team. A step can't read who created a probe or an AI agent, which only project owners see.
- **Only what your plan includes.** On OneUptime Cloud, a step that creates or changes something your plan doesn't include is refused with the plan it needs, just as the dashboard is. Self-hosted installations without billing have no plan limits.
- **Nothing OneUptime keeps for itself.** These are refused to everyone, workflows included:
  - editing or deleting a feed entry (incident, alert, episode, monitor, on-call policy and scheduled maintenance feeds);
  - writing a notification log (SMS, call, email, WhatsApp, Telegram, push, webhook and workspace message logs);
  - values OneUptime sets as things happen: whether a custom domain's CNAME is verified, a team's protection switches (**Is Team Editable**, **Is Team Deleteable**, **Is Permissions Editable**, **Should Have At Least One Member**), which incident role is the primary one and whether it can be deleted, whether an owner or member has been notified, reminder times and counts, who is on call on a schedule now and next, an on-call run's progress, an SLO's current burn rate and error budget, a monitor paused by an incident or a maintenance event, a status page private user's password reset token and last sign-in, the facts a service reports about itself (version, runtime, cloud), and a detection rule's or threat feed's last run;
  - declaring an incident from a template by sending `createdIncidentTemplateId` to **Create One Incident** — read the template with a **Find One Incident Template** step and pass its values instead;
  - changing which record a record belongs to after it is created, such as the monitor an owner row is for or the incident a note is on.
- **As no person.** A record a workflow creates names no creator, and the audit log names the workflow, by its name at the time, as who made the change.

When a check refuses a step, the step takes its **Error** output without making the refused change, and the run log names the step and the reason in plain words, for example *"Create One Team Permission" was refused. Workflow steps can do only what a Project Admin of this project can do: …*. Read it under the workflow's [Runs](/docs/workflows/runs-and-logs). A Create Many step creates its records one at a time and stops at the first one refused: the records it created before that one are kept.

Steps that talk to other systems — API, Email, Slack, Microsoft Teams, Discord, Telegram, Custom Code and Generate Text with AI — don't read or change OneUptime records, so none of this changes them.

## Plan limits

OneUptime Cloud caps the number of runs per month on smaller plans. Your current limit is shown under **Project Settings → Billing**. When you reach it, new triggers are rejected until the next billing cycle. Self-hosted installations don't have this limit.

## When workflows aren't the right tool

A few cases where you should reach for something else:

- **Heavy computation or large datasets** — workflows are designed for light glue work, not number crunching. Run heavy work in your own infrastructure and let a workflow kick it off.
- **Long-running active computation** — a single execution attempt is meant to finish quickly. For a passive delay such as "do A, wait two hours, do B," use the **Sleep** component; it persists the run and resumes it later without occupying a worker.
- **Step-by-step incident response with humans in the loop** — that's what [Runbooks](/docs/runbooks/index) are for. Workflows are for unattended automation.

## Where to read next

- [Workflows Overview](/docs/workflows/index) — the big picture.
- [Components](/docs/workflows/components) — block-by-block reference.
- [Runbooks](/docs/runbooks/index) — when to use a runbook instead.
