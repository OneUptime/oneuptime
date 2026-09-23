# AI SRE — Autonomous Investigations

OneUptime AI is your AI Site Reliability Engineer. The moment a new incident or alert is declared, it wakes up, investigates it across your own telemetry — logs, metrics, traces, exceptions, monitors, and recent changes — and posts a cited root cause analysis to the incident or alert timeline, usually before the on-call engineer has finished reading the page.

Every claim in the analysis carries a citation that deep-links to the exact data that supports it, and the investigation itself is **strictly read-only**: OneUptime AI can never change anything in your project while investigating.

## What the investigation posts

When an investigation finishes, OneUptime AI posts a root cause analysis with these sections:

- **Summary** — one or two sentences a paged engineer can read in five seconds.
- **Most likely root cause** — the hypothesis, with only the confidence the evidence supports, each factual claim cited. If the telemetry is insufficient, the AI says so plainly and lists what it checked instead of guessing.
- **Evidence** — the key findings that support or rule out the hypothesis, each cited.
- **Suggested next steps** — concrete actions for the on-call engineer.

For incidents, the analysis is posted to the incident feed **and** as an incident internal note (where responders collaborate). For alerts, it is posted to the alert feed.

While the investigation runs, the incident or alert page shows a live **AI Investigation** panel that narrates each step — which tools ran, what they found, and how long they took — so you can watch it think. If an investigation fails, the panel shows the failure reason rather than a silent gap.

## Enabling AI investigations

Autonomous investigations are **off by default**. To enable them:

1. **Configure an LLM provider.** Self-hosted installations bring their own key (or run fully air-gapped with local Ollama) — see [LLM Providers](/docs/ai/llm-provider). OneUptime Cloud users can use the pre-configured global provider, billed as metered AI tokens.
2. **Make sure AI is enabled for the project** (it is by default) — Project Settings > AI > AI Credits > Enable AI.
3. **Opt in per signal type:**
   - Incidents: **Incidents > AI > Investigation** — toggle _Automatically Investigate Incidents_.
   - Alerts: **Alerts > AI > Investigation** — toggle _Automatically Investigate Alerts_.

Incidents and alerts are configured independently, so you can give each signal type its own concurrency cap, daily token budget, fix-task budget, and follow-up pull request policy. Changing an alert AI setting does not change the corresponding incident setting, or vice versa.

One further setting builds on top of investigations: **Enable Automatic Code Fixes** (off by default and configured independently on each signal type's AI settings page) lets an investigation that confidently identifies a repository code change open a fix pull request automatically — see **Automatic code fixes** below.

## Cluster access — let OneUptime AI run kubectl

Out of the box, an investigation can only use the telemetry your agents ship. For a Kubernetes signal that is often not enough: "pods stuck in Pending" is a scheduling problem you diagnose by describing the pod and reading its events, not by looking at a metric. OneUptime AI can do exactly that when a cluster gives it access — and, if you allow it, fix what it finds.

Everything is configured on the cluster's **AI** page (Kubernetes → cluster → AI). The page is also the "what is missing" checklist: every reason OneUptime AI cannot (fully) use the cluster is listed there with the step that fixes it, and the same explanation appears on the incident's investigation panel when AI had to investigate with OneUptime data only.

### One flag to connect a cluster

If the cluster runs the [OneUptime Kubernetes agent](/docs/telemetry/kubernetes-agent), one extra flag installs a small in-cluster Runner that registers itself to the cluster — no Runner to create, no key to copy. Refresh your chart index first, then upgrade the agent:

```bash
helm repo update
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set aiAccess.enabled=true
```

`kubernetes-agent` in `oneuptime-agent` is the release name and namespace the dashboard's install instructions use; if you installed the agent with other names, use yours (`helm list -A | grep kubernetes-agent` shows them). Without `helm repo update`, Helm may resolve the chart you installed from, which does not know `aiAccess` and fails with `Additional property aiAccess is not allowed`.

Within a minute the cluster's AI page shows the Runner as Connected and turns **Let AI investigate with kubectl** on — unless someone already chose AI settings for the cluster there, which are kept as they are. The command works on a release whose values predate `aiAccess`, because every `aiAccess.*` value has a fallback in the chart. On Helm 3.14+, `--reset-then-reuse-values` is the safer flag than `--reuse-values`, which never picks up a newer chart's defaults.

To also let OneUptime AI fix what it finds, grant write access as a separate step — and, ideally, only in the namespaces it may fix:

```bash
helm repo update
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set aiAccess.enabled=true \
  --set aiAccess.remediation.enabled=true \
  --set "aiAccess.remediation.namespaces={web,api}"
```

Leave out the last line to grant it cluster-wide on a release that has never listed namespaces. Every namespace you list must already exist: the chart creates one RoleBinding in each and never creates a namespace, so a missing one fails the whole install or upgrade — the agent's collector included — with `namespaces "api" not found`. Create it first, or take it off the list; take a namespace off the list before you delete it. With `--reuse-values`, leaving the flag out keeps the list stored on the release, so to go back to cluster-wide pass `--set aiAccess.remediation.namespaces=null` (or `--set-json 'aiAccess.remediation.namespaces=[]'`) — not `={}`, which Helm reads as one empty name and the chart refuses.

If this is the cluster's **first** registration, it starts in **ask for approval** — unless someone already picked AI settings on the cluster's AI page before the chart was installed: then the Runner is bound and every setting is kept exactly as chosen. A cluster that was already registered — read-only first, writes later — keeps whatever remediation mode its AI page has (**Off** until you change it), because the server never flips a switch an operator owns: pick the mode on the AI page after the upgrade.

Any other Runner works too: bind it on the AI page together with a Kubernetes credential (API server URL + ServiceAccount token, under Project Settings → Runner Credentials) and turn on "Runs AI Remediation Commands" for that Runner. The agent's own in-cluster Runner is different: it only ever uses its own ServiceAccount, so OneUptime never hands it a credential, it is never used as a Bash/SSH host for runbooks, and it is never accepted as an auto-remediation rule's command Runner. Its Runner (`kubernetes-agent/<cluster>`) cannot be renamed and cannot be given the **Runs Runbooks** or **Runs AI Code Fixes** capability; its page in Project Settings → Runners leaves those settings out. It registers with the agent's ingestion key, and a key with a **Pinned Service Name** cannot register it. When the server refuses a registration, the Runner's log says whether the refusal clears on its own (a previous Runner pod that still heartbeats) or what to change.

### Who may change it

Loosening what AI may do on a cluster — switching remediation to **Automatic** or **Bypass approval**, writing the kubectl allowlist, or binding a Runner or credential — takes a Project Owner, a Project Admin or the **Edit Auto Remediation Rule** permission, the same people who may create a fully automatic remediation rule. Binding a credential also needs the **Read Runbook Credential** permission, unless you are a Project Owner or Project Admin. Tightening it — **Off**, **Ask for approval**, clearing the allowlist or the binding — is open to anyone who may edit the cluster.

### What an investigation may run

With access, an investigation runs **read-only** kubectl through the Runner — `get`, `describe`, `logs`, `events`, `top`, `rollout status/history`, `auth can-i` — and cites each command like any other evidence. Three independent checks keep it read-only: the policy that tiers every command, the server that refuses to enqueue anything else for an investigation, and the Runner, which re-checks the same policy before spawning kubectl. "Read-only — nothing in your systems was changed" stays literally true.

### How fixes work

**AI remediation** on the cluster's AI page has four settings:

- **Off** — AI only investigates.
- **Ask for approval** — after the root cause analysis, OneUptime AI diagnoses with kubectl and composes the smallest kubectl plan that addresses the cause, for example `kubectl rollout restart deployment/web -n web`. The plan appears on the incident with its rationale, expected effect and rollback; a human approves it with one click, and OneUptime runs exactly those commands. If the monitors do not recover, the rollback runs and OneUptime AI composes one more plan — again for approval — with the failed attempt in front of it, so it takes a different approach or says what a human should look at.
- **Automatic** — safe changes run on their own; a riskier change never does. When the round could only find riskier fixes, it ends by proposing exactly those for one-click approval. When it also ran a safe fix, the riskier one stays in the analysis and is proposed only if verification shows the safe fix did not recover the monitors — by the follow-up round, which asks for approval. Allowlist a riskier command's shape on the AI page and it runs on its own too. Automatic mode also resolves the signal once verification confirms the monitors recovered, and it is circuit-broken to three unattended fixes per cluster per hour: past that, or while another unattended OneUptime AI round is still changing or verifying the same cluster, a round proposes its plan for approval instead of running it.
- **Bypass approval** — AI does not ask. Every change the policy allows, riskier ones included, runs on its own, and so does the follow-up round after a failed verification; the signal resolves itself once verification confirms recovery. What needs a human in every mode (below) still waits for one. A round also proposes its plan for approval instead of executing it, and says why on the incident, when:
  - the hourly circuit breaker (three unattended fixes per cluster per hour) has tripped, or cannot be checked;
  - another unattended OneUptime AI round is still changing, or still verifying a fix on, the same cluster — an alert and an incident of one monitor are the usual case — or that cannot be checked;
  - it is the follow-up round after a fix whose rollback did not complete.

A **safe** change touches exactly one named object: `rollout restart/undo/pause/resume`, `scale` (to anything but 0), deleting a named pod, `cordon`/`uncordon`, and `label`/`annotate` on one named pod, Deployment, StatefulSet, DaemonSet, ReplicaSet, Job or CronJob with an ordinary key (not a reserved one such as `*.kubernetes.io/…` or `*.k8s.io/…`). Everything else the policy allows is **riskier**: the same verbs on a bare kind (`rollout restart deployment`), on several objects, with a selector or with `--all`; `scale` to 0; deleting a job; `taint`; `drain`; `patch`; `set image/env/resources`; `create`; deleting with `--force`; and labels or annotations on any other kind or with a reserved key.

Some lines hold in **every** mode, Bypass approval included, and no allowlist entry changes them:

- A write in **kube-system**, **kube-public** or **kube-node-lease** always needs a human. A custom resource is judged by the namespace it is written in, even one whose name looks like a built-in cluster-scoped kind (`nodes.example.com`, `namespaces.example.com`).
- A `drain` or a `taint` always needs a human. Draining a node evicts pods in every namespace — the three above and the agent's own included — and a `NoExecute` taint evicts them too.
- The Runner never changes anything in its own namespace — a fix there could scale the agent, or the Runner itself, away — nor anything outside the namespaces its chart lets it write (`aiAccess.remediation.namespaces`), nor a node when its chart turned node operations off (`aiAccess.remediation.nodeOperations=false`). OneUptime reads that scope from what the Runner reports and refuses such a fix when OneUptime AI proposes it and again when someone approves it, so it never reaches the Runner as a failed fix; the Runner refuses it too, before it spawns `kubectl`.
- Destructive commands (below) never run, even with a human approving them.

The Automatic-mode allowlist is matched word by word against the parsed command, not as free text: `*` stands for exactly one word (an image, a name), never for extra objects, flags or a second `-n`, and every flag the command uses must be written out in the entry. `kubectl set image deployment/web * -n web` allows a new image for `web` in `web`, nothing else. An entry must spell out its verb — and the subcommand of `rollout`, `set` or `create` — rather than use `*` for it, and must be more than one word after the optional leading `kubectl`; an entry that breaks these rules, such as `scale` or `kubectl *`, could never pre-approve a change and is refused when you save it.

Some commands **never** run, whatever the mode and even with human approval. The command policy refuses them, and it is enforced three times — by the server's tool, by the server's enqueue chokepoint, and by the Runner before it spawns `kubectl`: `exec`, `attach`, `cp`, `port-forward`, `proxy`, `debug`, `run`, `edit`, `apply`, `replace`, `diff`, kubectl plugins and any other verb not on its list, any file input (`-f`, `-k`) or file-reading output format (`-o jsonpath-file=`, `-o go-template-file=`, `-o custom-columns-file=`, `--template`, and a bare `-o jsonpath`/`go-template`/`custom-columns` without its inline template), credential, impersonation (`--as`, `--as-group`, `--as-uid`, `--as-user-extra`), cluster-selection, `--kuberc`, raw-API and verbose-logging flags, Secret objects in **any** verb — OneUptime AI never reads, changes, deletes or creates a Secret, and `create secret`, `create token` and `set env --resolve` are refused with them — anything that grants RBAC (`create role`, `create clusterrole`, `create rolebinding`, `create clusterrolebinding`, `set subject`), `certificate approve`, `set serviceaccount`, `create deployment`, `create cronjob` or `create job` with `--image` (`create job --from=cronjob/…` stays a riskier change), a `patch` body that is not JSON (kubectl would read it as YAML, whose tags can spell a field no check sees), patches that change a pod template's ServiceAccount, volumes or security settings, patches that replace a whole part of a pod template instead of setting fields in it (a strategic-merge `$patch: replace`, a merge patch that sets a whole `containers` list, or a JSON patch that replaces or removes the pod spec) — which would drop those settings without naming them — a label or annotation on Namespace objects picked by `--all` or a selector instead of by name, any write — `patch`, `label`, `annotate`, `set` — to RBAC objects, CustomResourceDefinitions, APIServices, admission webhook configurations or admission policies, `--all-namespaces` writes, `delete --all`, and deleting namespaces, nodes, volumes, CRDs or cluster roles. Flags are parsed the way kubectl parses them, so a denied flag or kind cannot hide behind another: combined short flags are split letter by letter (`-As` is caught), optional-value flags (`--cascade`, `--dry-run`, `--validate`) never swallow the next word, and every flag except `-n`/`--namespace`, `--request-timeout` and `--match-server-version` must come after the verb (and after the subcommand of `rollout`, `set`, `create`, `auth`, `cluster-info` and `top`), because kubectl picks the command before it parses flags. The Runner ships its own pinned kubectl (v1.36.4) and turns kuberc off, so a kuberc file on the Runner cannot add defaults or aliases to a command after the policy has checked it.

### What the in-cluster Runner's RBAC does, and does not, bound

The chart's RBAC is a separate layer from the policy, and it bounds **where** the Runner may write, not what a write may do. Read-only access (get/list/watch, pod logs) is granted cluster-wide. `aiAccess.remediation.enabled` adds patch/update on Deployments, StatefulSets, DaemonSets, ReplicaSets and their scale subresource, Jobs, CronJobs, Pods and HPAs; create on Jobs and HPAs; and delete on Pods and Jobs only. `aiAccess.remediation.nodeOperations` (on by default) adds cordon, uncordon, taint and drain on nodes, cluster-wide; set it to `false` and the chart grants no node RBAC and tells the Runner (`ONEUPTIME_KUBECTL_ALLOW_NODE_OPERATIONS=false`), which then refuses cordon, uncordon, drain, taint and label/annotate/patch on a node before it spawns kubectl — and, since the Runner reports the switch, OneUptime refuses such a fix already when it is proposed or approved. It never grants Secrets, `exec`, `attach`, `port-forward`, ServiceAccount tokens, impersonation, CRDs or RBAC writes, so deleting any other kind, or labelling a Service, ConfigMap, Ingress, Namespace or PVC, fails at the API server with `Forbidden` even when a human approved it. The two layers are not copies of each other: to RBAC, `apply`, `edit`, `replace`, `--all-namespaces` writes and `delete --all` are ordinary patch, update and delete calls, and only the policy stops them.

Be clear about what that write access amounts to, though: **patch/update on workloads, pods and CronJobs, and create on Jobs, in a namespace is equivalent to running any image as any ServiceAccount in that namespace and reading its Secrets.** A pod template can name any image, ServiceAccount and Secret volume, and RBAC has no "patch, but not the pod template" verb — that no rule names `exec` or Secrets does not change it. That is why the policy refuses changing which ServiceAccount, security settings, volumes, command or Secret wiring a pod runs with (pod-template security patches, patches that replace the pod spec or a whole `containers` list, `set serviceaccount`, `create … --image`, non-JSON patch bodies), why the protected namespaces always need a human, and why `aiAccess.remediation.namespaces` exists. The policy does **not** refuse changing an image: `set image`, or a patch of an image field, is a riskier change — the new image runs as the workload's own ServiceAccount, with its Secrets — that a human approves, unless the cluster bypasses approvals or its allowlist names the command. Without `aiAccess.remediation.namespaces`, the write role is bound cluster-wide — kube-system, kube-public, kube-node-lease and the agent's own namespace included, since RBAC cannot leave namespaces out of a cluster-wide binding — and there the policy and the Runner hold the line, not RBAC. With it, the chart binds the role in exactly the namespaces you list, OneUptime refuses a write anywhere else when it is proposed or approved, and the Runner refuses it again before it spawns kubectl.

Every command — investigation or fix — is recorded on the cluster's AI page under **Commands OneUptime AI ran on this cluster**: the command, its status and when it ran.

## Quiet mode

An investigation that cannot determine a cause posts its analysis to the timeline **without** pinging your Slack/Teams workspace or the on-call. A non-answer should never page anyone — the analysis is there when someone looks, but nobody is woken up for "inconclusive". Confident analyses notify the workspace normally.

Whether an analysis counts as confident is decided by a server-verified signal, not by what the analysis text says: an investigation that gathered no evidence (no successful telemetry queries, no citations) is always treated as inconclusive, and otherwise a separate constrained check classifies the analysis. If that check itself fails, OneUptime AI errs on the side of notifying — quiet mode fails louder, never silent.

## Automatic code fixes

For projects that opt in, a confident analysis that recommends a repository code change can go one step further than notifying: it opens the fix. **Enable Automatic Code Fixes** is configured independently under **Incidents > AI > Investigation** and **Alerts > AI > Investigation** (both are **off by default**). A signal type with this setting enabled automatically queues the same fix task as the **Open Fix PR from this analysis** button on the investigation panel: an AI agent task that turns the posted analysis into a pull request, ready for review. The button uses the same recommendation and is hidden for analyses whose remedy is operational, infrastructure-only, external, an expected denial, a user error, or inconclusive.

The same constrained, server-verified classification that decides confidence also decides whether a repository change is appropriate. Only a positive code-fix classification offers or automatically opens the pull request. An investigation that gathered no server-verified evidence, recommends a non-code remedy, or whose classification failed never opens one — PR creation always fails toward doing nothing. Everything else matches the manual button: the pull request opens ready for review, needs a GitHub-App-connected repository and a Runner with the code-fix capability, counts against that signal type's daily fix-task budget and each repository's open-PR cap, and at most one fix task per incident or alert can be active at a time. The investigation itself stays read-only — the fix runs as a separate, fully-logged agent task. See [Fix Tasks](/docs/ai/ai-agent) for how fix pull requests work, including the build-and-test verification that runs before each pull request opens.

## Auto-remediation waits for the analysis

If the project uses auto-remediation rules (rules on the incident and alert settings pages that match new incidents and alerts to remediation runbooks — suggested or fully automatic), their ordering relative to investigations is deliberate — **RCA first**:

- When a new incident or alert **enqueues an AI investigation**, auto-remediation for that incident or alert is deferred until the investigation **settles** — any terminal outcome: the analysis is posted, the run errors out after its retries, it expires in the queue, or it goes stale. Only then do the remediation rules run, so the remediation planner always has the posted root cause analysis as input instead of racing it.
- When **no investigation is enqueued** (investigations disabled, the alert below the severity floor, the cooldown or a budget skipped it), remediation fires immediately when the incident or alert is created, exactly as before. Auto-remediation never depends on the AI investigation lane being enabled.

An investigation that fails, expires, or goes stale still releases remediation — the deferral delays remediation until the outcome is known; it never cancels it.

## Cost controls

Alert volume can be much higher than incident volume, so autonomous investigations are gated by several cost controls:

| Control                            | Behavior                                                                                                                                                                                                                                                                                                                                                             | Where to configure                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Severity floor (alerts)            | Only alerts at or above a minimum severity are investigated. Default: the project's **top two severity tiers**.                                                                                                                                                                                                                                                      | Alerts > AI > Investigation              |
| Re-investigation cooldown (alerts) | Repeat alerts from the same monitor within the cooldown are not re-investigated — the first analysis stands. Default **30 minutes**; set 0 to disable.                                                                                                                                                                                                               | Alerts > AI > Investigation              |
| Concurrency cap                    | How many investigations of this signal type run at once. Incidents and alerts have separate pools. Default **3** per pool (1–25); queued investigations wait for a free slot and expire after 30 minutes.                                                                                                                                                            | Incidents or Alerts > AI > Investigation |
| Per-run budget                     | Each investigation is capped at 8 LLM calls, 12 tool calls, 150 seconds, and 2,000 output tokens. A completed investigation additionally spends one tiny confidence-classification call (20 output tokens max), metered and counted against the daily token limit.                                                                                                   | Built in                                 |
| Daily token limit                  | Optional maximum tokens per UTC day for autonomous AI work linked to this signal type, including investigations, remediation, and follow-up fix tasks. Incident and alert usage is counted separately. When one limit is reached, only that signal type's AI work is paused until the next day — interactive AI chat is never blocked. Set **0** to pause that lane. | Incidents or Alerts > AI > Investigation |
| Daily fix-task limit               | Maximum incident- or alert-linked fix tasks created per UTC day. Each signal type has its own limit. Default **25**; set 0 to pause that lane's fix tasks.                                                                                                                                                                                                           | Incidents or Alerts > AI > Investigation |

## Trust and safety

- **Read-only, always.** Autonomous investigations run with a curated set of read-only tools (metric, log, trace, exception, and change queries — including `baseline_anomaly`, which judges a metric against its learned hour-of-week normal range). The AI cannot acknowledge, resolve, page, or modify anything from an investigation.
- **Citations are minted server-side** from tool calls that actually executed — the model cannot fabricate a citation to data it never read.
- **Full audit trail.** Every investigation is recorded as an AI run with an ordered event trail (every LLM call and tool call), and every LLM call is metered in the AI Logs page (Project Settings > AI > AI Logs) with token counts and cost.
- **Secrets are redacted** from tool results before anything is sent to the LLM (tokens, credentials, key patterns).
- **Self-host = zero third-party egress.** With your own LLM provider (including local Ollama), telemetry never leaves your infrastructure.

## Auto-postmortem

Separately from investigations, OneUptime AI can draft a postmortem automatically when an incident is resolved. The draft never overwrites an existing postmortem note. This uses the same LLM provider and appears in the incident's postmortem tab for human review.

## Insights — proactive detection

Investigations react to incidents and alerts. **AI Insights** watch for problems before anything pages: every 15 minutes, deterministic detectors scan your telemetry for trouble that has not (yet) tripped a monitor. There is **no AI in the watch loop** — the detectors are statistical checks with fixed thresholds, so the always-on part of the feature spends no tokens and cannot hallucinate a finding. The thresholds are deliberately conservative: an insight means something genuinely moved, not that a number wiggled.

What the detectors watch:

| Detector                  | Fires when                                                                                                                                                                                                                                                                                 | Severity                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| New exceptions            | An exception first seen in the last 24 hours has already occurred 3+ times                                                                                                                                                                                                                 | Medium; High at 50+ occurrences                                                                         |
| Exception spikes          | An established exception jumps to 10+ occurrences in the last hour, at 5×+ its normal hourly rate — including a long-dormant exception waking up                                                                                                                                           | Medium; High at 10×                                                                                     |
| Error-log spikes          | Project-wide Error/Fatal log volume reaches 100+ in the last hour, at 3×+ the prior day's hourly average; the insight names the top contributing services                                                                                                                                  | Medium; High at 10×                                                                                     |
| Trace latency regressions | A service's p99 latency over the last hour is at least 1 second and 2×+ its prior-24-hour p99, with enough traffic to be meaningful. The detector drills into a representative slow trace and records what it found — N+1 query patterns, dominant slow spans — as evidence on the insight | Medium; High at 4×                                                                                      |
| Metric drift              | A metric's average this week has moved 50%+ versus the same metric last week                                                                                                                                                                                                               | Always Low — drift direction says nothing about whether the change is bad, so drift is never auto-fixed |

Each finding becomes an **insight** in a quiet inbox — **AI > Insights** in the dashboard. Insights **never page anyone and never open incidents**; they wait until someone looks. A recurring finding refreshes its existing insight (last seen, occurrence count) instead of piling up duplicates, a finding you dismiss stays out of your inbox for 7 days, and each scan files at most 10 new insights per project.

When an LLM provider is configured, each new insight also gets a **triage analysis**: a read-only, cited AI investigation — same engine, same audit trail, and same per-run budget as autonomous investigations — that assesses the likely root cause, the blast radius, and the one next action worth taking. Insights use the separate **Daily Background AI Token Limit** under **Project Settings > AI > AI Guardrails**, so they cannot consume either the incident or alert budget. The result is saved to the insight page. Without a provider you still get the insights; you just skip the AI triage.

Optionally, OneUptime AI can also open a **fix pull request** for the insight types with the strongest evidence: new and spiking exceptions (through the existing exception-fix pipeline) and trace latency regressions (grounded in the span evidence recorded on the insight). Error-log spikes and metric drift are never auto-fixed. Every automatic fix PR opens ready for review, counts against the **Daily Other AI Fix Task Limit** under **Project Settings > AI > AI Guardrails** and each repository's open-PR cap, and requires human review — auto-merge does not exist.

Both settings are **off by default**, at **AI > Insights > Settings**:

1. **Enable AI Insights** — turns on the watch loop, the inbox, and triage.
2. **Automatically open fix PRs from insights** — turns on fix-task creation for eligible insights. This needs the same setup as the manual "Fix with AI" flow: a GitHub-App-connected repository and an LLM provider.

Every insight has **Confirm** and **Dismiss** buttons — use them even when you don't act on the finding. Your confirm/dismiss votes are how each detector's precision gets measured, and that measured precision is what decides which insight types earn more automation over time. Dismissing also keeps the same finding out of your inbox for the next 7 days.

## Requirements and limits

- An LLM provider must be configured (project-specific or the cloud global provider).
- Investigations trigger on **newly created** incidents and alerts only — enabling the toggles does not investigate historical signals.
- The `baseline_anomaly` check needs about two weeks of metric history before its hour-of-week baselines are reliable; before that it reports "insufficient baseline data" rather than guessing.
- On OneUptime Cloud with the global provider, investigations consume metered AI tokens (see Project Settings > AI Credits). Bring your own provider key for unmetered usage.
