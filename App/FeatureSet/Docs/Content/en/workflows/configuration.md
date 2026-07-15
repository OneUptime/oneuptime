# Configuration & Safety

This page covers the settings and safety limits worth knowing about before you point a workflow at real traffic.

## Turning a workflow on or off

Every workflow has an **Enabled** switch in **Settings**. When it's off, the workflow doesn't run — webhook calls, scheduled times, and OneUptime events are all ignored. New workflows start disabled.

Use this switch as your "ready to go" gate:

1. Build the workflow.
2. Click **Run Manually** with a realistic payload.
3. Check the **Logs** — make sure every block went where you expected.
4. Flip **Enabled** on.

Turning a workflow off doesn't stop runs that are already in progress; it just stops new ones from starting.

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

## How long a run can take

Each execution attempt has a wall-clock deadline. The runner checks it before and after every component and marks an overdue run **Timeout** as soon as control returns. Components that perform network or script work also need their own timeouts because the runner cannot forcibly interrupt arbitrary component code.

The AI component derives its provider-request timeout from the remaining workflow time and caps it at 60 seconds, leaving a small margin for logging and cleanup.

## Limit on calling other workflows

The **Execute Workflow** component lets one workflow call another. To prevent accidental loops where workflow A calls B which calls A again, there's a cap on how deep the chain can go. A run that goes past the limit ends with a clear error.

If you have a real need for a long chain (like a job that processes one item per run), it's usually simpler to loop inside a single workflow using **Custom Code**.

## Webhook security

Webhook triggers give you a unique URL. Anyone who knows the URL can hit it. To protect against accidental or unwanted callers:

- Treat the URL like a password. Don't share it publicly or commit it to a public repo.
- For sensitive workflows, ask the calling system to send a shared token as a header (like `X-Webhook-Token`) and check it with a **Conditions** block before doing anything important. Save the expected token as a secret variable.
- For very sensitive workflows, prefer a OneUptime event trigger and a manual import step instead of a public webhook.

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

Workflows respect your project's role-based access control. The relevant permissions:

- **Create / Read / Edit / Delete Workflow** — the basic permissions on the workflow itself.
- **Run Workflow** — needed to click **Run Manually** or trigger a workflow via API.
- **Read Workflow Log** — needed to view runs.
- **Read / Create / Edit / Delete Workflow Variable** — control over the global variables list.

Most engineers should have create/edit/read on workflows but not on variables. Save variable edit access for the people who manage your project's secrets.

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
