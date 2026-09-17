# Ask AI — The Observability Copilot

Ask AI is OneUptime's built-in chat over your project's data. It answers questions about logs, traces, metrics, exceptions, incidents, alerts, monitors, on-call, status pages, SLOs, runbooks, workflows and probes — and it can act (create incidents, acknowledge alerts, page on-call, post notes, open pull requests) with your approval. Every factual claim in an answer is backed by a citation chip showing the exact query it ran.

Open it from the **Ask AI** sparkles button in the header, with **Cmd/Ctrl + I** from anywhere in the dashboard, or with the **Ask AI** button on incident, alert and monitor pages. There is also a full-page workspace under **AI** > **Chat**; each conversation there has its own URL, so a thread can be bookmarked or pasted into an incident channel.

## What it can see

Ask AI answers only from tool results — it queries your project live rather than answering from memory. Its read tools cover:

- **Telemetry**: log search and histograms, trace aggregations and span trees, metrics, exceptions, and anomaly checks against learned baselines.
- **Infrastructure**: hosts, Docker, Podman, Kubernetes, Docker Swarm, Proxmox, VMware vCenter, Ceph, serverless functions, cloud environments, IoT fleets and network devices. Ask about accessible inventory, reported connection state, metric trends, log severity counts and trace operation summaries. Infrastructure queries include telemetry associated with both a service and an infrastructure resource.
- **Incident response**: incidents and alerts (including state filters — "what is active right now?"), their full activity timelines (state changes, internal and public notes, feed), owners, and free-text search over past incidents to reuse prior resolutions.
- **On-call**: who is on call right now, policies and escalation chains, and whether recent pages were delivered and acknowledged.
- **The AI's own work**: the results of autonomous AI SRE investigations and AI Insights, so "what did the AI find?" is answered from the posted analysis instead of re-derived from scratch.
- **Platform**: monitors (with status filters), status pages and their subscribers, SLOs, runbook content, workflow runs, probe health, teams, and connected code repositories.

## Page context

Ask AI knows what page you opened it from. On an incident page, "why did this happen?" means that incident — the composer shows a context chip you can detach. If you navigate to another page while the panel is open, the context follows you. The conversation also remembers its original subject server-side, so follow-up turns keep resolving "this incident" even days later.

Infrastructure lists and resource pages offer questions for the selected resource type. For example, open a Kubernetes cluster and ask "Which metrics changed over the last 24 hours?", or open a Docker host and ask "Summarize log severity and trace errors over the last six hours." Evidence links return to the relevant resource page. Reads respect your project, resource and telemetry permissions, including ownership and label restrictions.

On child pages, the context also records the selected pod, container, VM, process or other child. The current infrastructure tools query the parent resource's telemetry; they cannot establish child-specific measurements from a child name alone. The assistant states this scope and does not infer a Kubernetes namespace that the page does not supply. Connection state is not workload health, and missing telemetry does not establish that a resource is healthy.

## Actions and permission modes

Every conversation has a permission mode:

- **Read-only** — action tools are withheld entirely; the AI can only query.
- **Ask for approval** (default) — the AI proposes an action and you approve or deny each one on an approval card before it runs.
- **Auto-run** — actions the model requests run immediately. Use with care.

Actions include creating incidents, acknowledging/resolving incidents and alerts, changing severity, posting **internal** notes (never visible on status pages), posting public status-page updates (clearly separate, since those notify subscribers), paging an on-call policy, running runbooks, starting an autonomous investigation, and proposing code changes as pull requests.

## Steering a conversation

- **Stop**: while the AI is investigating, the send button becomes a stop button — cancel a run at any time and ask something else immediately.
- **Feedback**: rate any answer with thumbs up/down. Ratings are stored with the message so answer quality can be measured over time.
- **Cost**: each answer's footer shows tokens, cost, and how many queries were run, and every query is listed as a citation chip that deep-links to the underlying data.

## Requirements

Ask AI uses your project's configured LLM provider (see [LLM Providers](/docs/ai/llm-provider)). On OneUptime Cloud it works out of the box with metered AI tokens; self-hosted deployments configure a provider or the global provider environment variables. Answers are only as good as the model behind them — small self-hosted models without reliable tool-calling will underperform.
