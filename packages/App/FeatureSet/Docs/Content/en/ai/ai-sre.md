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

An investigation runs until it is done: it has **no time limit** and no small query budget, so it can run every query and kubectl or infrastructure command it needs. A long command output (a `kubectl describe node` of a busy node, a pod's logs) is never cut off — OneUptime AI reads it a page at a time. If you want a hard stop, set an **investigation time limit** per signal type (see **Cost controls** below).

## Talk to OneUptime AI about the incident

The **AI Investigation** card ends with a conversation — **Ask OneUptime AI** — shared by everyone who can see the incident or alert. It is one card whatever happened above it: under a report you ask follow-ups, and when no automatic investigation ran (or it stopped before reporting) the first suggestion is **What is the root cause?**, which has OneUptime AI investigate on demand.

- **Ask follow-up questions** — "which pods use the most memory?", "what changed right before this started?", "is anything else affected?". OneUptime AI builds on its report, queries fresh data (and runs read-only kubectl or infrastructure commands where it has access), and cites every claim.
- **Ask it to act** — "acknowledge this incident", "post a status update saying we're investigating", "page the database on-call", "raise the severity". It uses the same actions as Ask AI and always acts **with your own permissions**, so it can never do more than you could.
- **Choose how it acts** with the switch in the message box, which says beside it what the chosen mode means: _Auto-run_ (the default — it acts on a clear request right away), _Ask to act_ (it shows an approval card first, which anyone on the incident can approve or deny), or _Read-only_.
- **One shared thread.** Every question shows who asked it, everyone sees the same conversation live, and anyone can stop an answer in progress. Charts and tables in an answer are shown to the person who asked; everyone else sees the cited answer. Each answer lists its **Sources**, and a source with a page of its own (logs, metrics, a monitor) opens it. A long thread opens on its newest messages, with a button above them (for example **Show 6 earlier messages**) that brings back the rest.

## Enabling AI investigations

Autonomous investigations are **on by default for new projects**. So is every other AI feature on this page: postmortem drafts, automatic code fixes and AI Insights. A project created before this default keeps its setting; turn investigations on as in step 3, or with **Turn on** on any Kubernetes cluster's **AI agent** page (Project Owner or Project Admin). To check or change them:

1. **Configure an LLM provider.** Self-hosted installations bring their own key (or run fully air-gapped with local Ollama) — see [LLM Providers](/docs/ai/llm-provider). OneUptime Cloud users can use the pre-configured global provider, billed as metered AI tokens, so the project needs AI credits (Project Settings > AI Credits) or auto-recharge.
2. **Make sure AI is enabled for the project** (it is by default) — Project Settings > AI > AI Features > Enable AI.
3. **Choose per signal type** (both on for new projects):
   - Incidents: **Incidents > Settings > AI** — turn on _Investigate new incidents_.
   - Alerts: **Alerts > Settings > AI** — turn on _Investigate new alerts_.

Each AI behaviour on those pages is a switch that saves as soon as you flip it; there is no Save button. The incident page has four, under **What OneUptime AI does**: _Investigate new incidents_, _Draft a postmortem when an incident resolves_, _Open a fix pull request when an investigation finds a code change_ and _Open a pull request that adds missing telemetry_. The alert page has the same, without the postmortem. Project Owners and Project Admins can change them; for everyone else each switch is locked and says which permission it needs.

The pages say two things only when they are true. If **Enable AI** is off, nothing on them runs, and the page says so at the top with the Enable AI switch itself for those who may change it (Project Owners, and anyone with Manage Billing); everyone else is told who can. If the project has no LLM provider OneUptime AI can use — none at all, or providers but none set as the default — the page says that too, with a link to **Project Settings > AI > LLM Providers**. On OneUptime Cloud the global provider counts, so nothing is said there.

Incidents and alerts are configured independently, so you can give each signal type its own concurrency cap, daily token budget, fix-task budget, and follow-up pull request policy. None of those limits applies until you set it — they are folded under **More settings** at the bottom of each page; see **Cost controls** below. Changing an alert AI setting does not change the corresponding incident setting, or vice versa.

One further setting builds on top of investigations: **Open a fix pull request when an investigation finds a code change** (on for new projects, a switch of its own on each signal type's AI settings page) lets an investigation that confidently identifies a repository code change open a fix pull request automatically — see **Automatic code fixes** below.

## Cluster access — let OneUptime AI run kubectl

Out of the box, an investigation can only use the telemetry your agents ship. For a Kubernetes signal that is often not enough: "pods stuck in Pending" is a scheduling problem you diagnose by describing the pod and reading its events, not by looking at a metric. The **Kubernetes AI agent** lets OneUptime AI do exactly that — and, if you allow it, fix what it finds.

Each cluster has an **AI** section in the dashboard (Kubernetes → cluster → AI):

- **Agent** — the cluster's **AI agent** page: whether the agent is connected, what AI may do on the cluster, and anything that needs attention, each with the step that fixes it. The same explanation appears on the incident's investigation panel when AI had to investigate with OneUptime data only.
- **Insights** — the cluster's **AI Insights** page: what OneUptime AI investigated and changed on the cluster (see [Everything AI did on a cluster](#everything-ai-did-on-a-cluster)).

The cluster's **Overview** ends with an **AI agent** card that sums the AI agent page up: whether the agent is connected, whether **Investigate with kubectl** is on, how fixes run (**Off**, **Ask for approval**, **Automatic** or **Bypass approval**) and what needs attention, with a link to the AI agent page, where they are changed.

### The Kubernetes AI agent — on by default, read-only

The [OneUptime Kubernetes agent](/docs/telemetry/kubernetes-agent) chart runs the Kubernetes AI agent by default: one small pod (`component=ai-agent`, image `oneuptime/kubernetes-ai-agent`) with a **read-only** ServiceAccount. It connects with the API key the chart already uses, so there is nothing to set up in the dashboard: within a minute the cluster's AI agent page shows it as **Connected** and **Investigate with kubectl** is on — unless someone already chose AI settings for the cluster there, which are kept as they are.

On an agent installed before the Kubernetes AI agent existed, refresh your chart index first, then upgrade:

```bash
helm repo update
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set aiAgent.enabled=true
```

`kubernetes-agent` in `oneuptime-agent` is the release name and namespace the dashboard's install instructions use; if you installed the agent with other names, use yours (`helm list -A | grep kubernetes-agent` shows them). Without `helm repo update`, Helm may resolve the chart you installed from, which does not know `aiAgent` and fails with `Additional property aiAgent is not allowed`. On a self-hosted OneUptime, upgrade OneUptime before the chart — see [Upgrading the Agent](/docs/telemetry/kubernetes-agent#upgrading-the-agent). To run the chart without the AI agent, pass `--set aiAgent.enabled=false`.

**Test connection**, in the **⋯** menu next to the agent's status on the AI agent page, runs `kubectl version` and `kubectl auth can-i --list` through the agent and shows the results: what it can reach and what it may do. If the page says the agent is not connected, read its log with `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`. A key with a **Pinned Service Name** cannot register the agent — give the chart a key without one. When the server refuses a registration, the log says whether the refusal clears on its own (a previous agent pod that still reports in, or the old in-cluster Runner still shutting down during an upgrade) or what to change. **Reset agent**, in the same menu, makes the server forget the agent's key once you confirm it; the pod reconnects on its own within a few minutes.

The Kubernetes AI agent is not a Runner and never appears under Runbooks → Runners. It only ever uses its own ServiceAccount, so OneUptime never hands it a credential, it is never used as a Bash/SSH host for runbooks, and it is never accepted as an auto-remediation rule's command Runner.

### Letting AI fix what it finds

Fixes are off until you turn them on, and that takes one chart flag. Grant write access — ideally only in the namespaces AI may fix, and with node operations off:

```bash
helm repo update
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set aiAgent.enabled=true \
  --set aiAgent.remediation.enabled=true \
  --set "aiAgent.remediation.namespaces={web,api}" \
  --set aiAgent.remediation.nodeOperations=false
```

Or cluster-wide:

```bash
helm repo update
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set aiAgent.enabled=true \
  --set aiAgent.remediation.enabled=true \
  --set-json 'aiAgent.remediation.namespaces=[]'
```

Replace `{web,api}` with the namespaces AI may fix. Every namespace you list must already exist: the chart creates one RoleBinding in each and never creates a namespace, so a missing one fails the whole install or upgrade — the collector included — with `namespaces "api" not found`. Create it first, or take it off the list; take a namespace off the list before you delete it. With `--reuse-values`, leaving the flag out keeps the list stored on the release, so to go back to cluster-wide pass `--set-json 'aiAgent.remediation.namespaces=[]'` (Helm 3.10+), as the second command does — not `={}`, which Helm reads as one empty name and the chart refuses. `--set aiAgent.remediation.namespaces=null` does not reset a stored list under `--reuse-values`: Helm keeps the stored list. `aiAgent.remediation.nodeOperations=false` keeps fixes off nodes; set it to `true` to let AI cordon, uncordon, drain and taint nodes (a drain, a taint or a patch of a node still waits for a human).

Then choose how fixes run under **What AI may do** on the AI agent page. If nobody has chosen AI settings for the cluster yet, granting write access starts fixes in **Ask for approval**. Otherwise the cluster keeps the mode its AI agent page shows (**Off** until someone changes it), because the server never flips a switch an operator owns: pick the mode there after the upgrade. The only project switch fixes need is **Enable AI** (Project Settings > AI > AI Features), which is on unless someone turned it off.

### Which incidents a cluster's fixes act on

A cluster's fixes need no Auto Remediation Rule: OneUptime AI fixes every incident and alert the cluster is linked to, in the mode its AI agent page sets. What it is not linked to, it does not touch — however clearly the cause sits in the cluster. An incident or alert is linked to a cluster when:

- the telemetry it was raised from names the cluster (a metric, log or trace monitor on the cluster's data);
- its monitor is a Kubernetes monitor of the cluster;
- its monitor is linked to the cluster under **Monitor → Overview → Linked Resources** — the way to link a website, API or synthetic monitor to the cluster that serves what it checks;
- someone picked the cluster under **Other Affected Resources** when declaring it (picking a linked monitor adds it there for you).

Each incident and alert says on its **Remediation** card whether it was linked to a cluster and what the cluster's fixes did; see [What auto-remediation did](#what-auto-remediation-did). The same holds for an infrastructure resource and its AI agent.

### Who may change it

Turning fixes on — any move from **Off** to another mode — and loosening them — switching to **Automatic** or **Bypass approval**, writing the kubectl allowlist, binding a Runner or credential, or removing that binding from a cluster that has a Kubernetes AI agent — takes a Project Owner, a Project Admin or the **Edit Auto Remediation Rule** permission, the same people who may create a fully automatic remediation rule. Binding a credential also needs the **Read Runbook Credential** permission, unless you are a Project Owner or Project Admin. **Reset agent** takes the same people as turning fixes on. Tightening it — **Off**, going back to **Ask for approval**, clearing the allowlist — is open to anyone who may edit the cluster.

### What an investigation may run

With access, an investigation runs **read-only** kubectl through the AI agent — `get`, `describe`, `logs`, `events`, `top`, `rollout status/history`, `auth can-i` — as many commands as it needs, and cites each command like any other evidence. Output is never cut off: the agent keeps up to a megabyte of it, and OneUptime AI reads a long output a page at a time. Three independent checks keep it read-only: the policy that tiers every command, the server that refuses to enqueue anything else for an investigation, and the AI agent, which re-checks the same policy before spawning kubectl. "Read-only — nothing in your systems was changed" stays literally true.

### How fixes work

**Fixes** on the AI agent page have four settings:

- **Off** — AI only investigates.
- **Ask for approval** — after the root cause analysis, OneUptime AI diagnoses with kubectl and composes the smallest kubectl plan that addresses the cause, for example `kubectl rollout restart deployment/web -n web`. The plan appears on the incident with its rationale, expected effect and rollback; a human approves it with one click, and OneUptime runs exactly those commands. If the monitors do not recover, the rollback runs and OneUptime AI composes one more plan — again for approval — with the failed attempt in front of it, so it takes a different approach or says what a human should look at.
- **Automatic** — safe changes run on their own; a riskier change never does. When the round could only find riskier fixes, it ends by proposing exactly those for one-click approval. When it also ran a safe fix, the riskier one stays in the analysis and is proposed only if verification shows the safe fix did not recover the monitors — by the follow-up round, which asks for approval. Allowlist a riskier command's shape on the AI agent page and it runs on its own too. Automatic mode also resolves the signal once verification confirms the monitors recovered, and it is circuit-broken to three unattended fixes per cluster per hour: past that, or while another unattended OneUptime AI round is still changing or verifying the same cluster, a round proposes its plan for approval instead of running it.
- **Bypass approval** — AI does not ask. Every change the policy allows, riskier ones included, runs on its own, and so does the follow-up round after a failed verification; the signal resolves itself once verification confirms recovery. What needs a human in every mode (below) still waits for one. A round also proposes its plan for approval instead of executing it, and says why on the incident, when:
  - the hourly circuit breaker (three unattended fixes per cluster per hour) has tripped, or cannot be checked;
  - another unattended OneUptime AI round is still changing, or still verifying a fix on, the same cluster — an alert and an incident of one monitor are the usual case — or that cannot be checked;
  - it is the follow-up round after a fix whose rollback did not complete.

A **safe** change touches exactly one named object: `rollout restart/undo/pause/resume`, `scale` (to anything but 0), deleting a named pod, `cordon`/`uncordon`, and `label`/`annotate` on one named pod, Deployment, StatefulSet, DaemonSet, ReplicaSet, Job or CronJob with an ordinary key (not a reserved one such as `*.kubernetes.io/…` or `*.k8s.io/…`). Everything else the policy allows is **riskier**: the same verbs on a bare kind (`rollout restart deployment`), on several objects, with a selector or with `--all`; `scale` to 0; deleting a job; `taint`; `drain`; `patch`; `set image/env/resources`; `create`; deleting with `--force`; and labels or annotations on any other kind or with a reserved key.

Some lines hold in **every** mode, Bypass approval included, and no allowlist entry changes them:

- A write in **kube-system**, **kube-public** or **kube-node-lease** always needs a human. A custom resource is judged by the namespace it is written in, even one whose name looks like a built-in cluster-scoped kind (`nodes.example.com`, `namespaces.example.com`).
- A `drain`, a `taint` or a `patch` of a node always needs a human. Draining a node evicts pods in every namespace — the three above and the agent's own included — and a `NoExecute` taint evicts them too, whether `kubectl taint` sets it or a `patch` of the node does.
- The AI agent never changes anything in its own namespace — a fix there could scale the Kubernetes agent, or the AI agent itself, away — nor anything outside the namespaces its chart lets it write (`aiAgent.remediation.namespaces`), nor a node when its chart turned node operations off (`aiAgent.remediation.nodeOperations=false`). OneUptime reads that scope from what the AI agent reports and refuses such a fix when OneUptime AI proposes it and again when someone approves it, so it never reaches the AI agent as a failed fix; the AI agent refuses it too, before it spawns `kubectl`.
- Destructive commands (below) never run, even with a human approving them.

The Automatic-mode allowlist is matched word by word against the parsed command, not as free text: `*` stands for exactly one word (an image, a name), never for extra objects, flags or a second `-n`, and every flag the command uses must be written out in the entry. `kubectl set image deployment/web * -n web` allows a new image for `web` in `web`, nothing else. An entry must spell out its verb — and the subcommand of `rollout`, `set` or `create` — rather than use `*` for it, and must be more than one word after the optional leading `kubectl`; an entry that breaks these rules, such as `scale` or `kubectl *`, could never pre-approve a change and is refused when you save it.

Some commands **never** run, whatever the mode and even with human approval. The command policy refuses them, and it is enforced three times — by the server's tool, by the server's enqueue chokepoint, and by the AI agent before it spawns `kubectl`: `exec`, `attach`, `cp`, `port-forward`, `proxy`, `debug`, `run`, `edit`, `apply`, `replace`, `diff`, kubectl plugins and any other verb not on its list, any file input (`-f`, `-k`) or file-reading output format (`-o jsonpath-file=`, `-o go-template-file=`, `-o custom-columns-file=`, `--template`, and a bare `-o jsonpath`/`go-template`/`custom-columns` without its inline template), credential, impersonation (`--as`, `--as-group`, `--as-uid`, `--as-user-extra`), cluster-selection, `--kuberc`, raw-API and verbose-logging flags, Secret objects in **any** verb — OneUptime AI never reads, changes, deletes or creates a Secret, and `create secret`, `create token` and `set env --resolve` are refused with them — anything that grants RBAC (`create role`, `create clusterrole`, `create rolebinding`, `create clusterrolebinding`, `set subject`), `certificate approve`, `set serviceaccount`, `create deployment`, `create cronjob` or `create job` with `--image` (`create job --from=cronjob/…` stays a riskier change), `expose --overrides` or `--override-type` (the override can make kubectl create a Job, a ClusterRoleBinding or any other kind of object instead of a Service), a `patch` body that is not JSON (kubectl would read it as YAML, whose tags can spell a field no check sees), patches that change a pod template's ServiceAccount, volumes or security settings (host ports, the user-namespace opt-out `hostUsers` and the runtime class `runtimeClassName` included), patches that replace a whole part of a pod template instead of setting fields in it (a strategic-merge `$patch: replace`, a merge patch that sets a whole `containers` list, or a JSON patch that replaces or removes the pod spec) — which would drop those settings without naming them — a label or annotation on Namespace objects picked by `--all` or a selector instead of by name, any write — `patch`, `label`, `annotate`, `set` — to RBAC objects, CustomResourceDefinitions, APIServices, admission webhook configurations or admission policies, `--all-namespaces` writes, `delete --all`, and deleting namespaces, nodes, volumes, CRDs or cluster roles. Flags are parsed the way kubectl parses them, so a denied flag or kind cannot hide behind another: combined short flags are split letter by letter (`-As` is caught), optional-value flags (`--cascade`, `--dry-run`, `--validate`) never swallow the next word, and every flag except `-n`/`--namespace`, `--request-timeout` and `--match-server-version` must come after the verb (and after the subcommand of `rollout`, `set`, `create`, `auth`, `cluster-info` and `top`), because kubectl picks the command before it parses flags. The AI agent ships its own pinned kubectl (v1.36.4) and turns kuberc off, so a kuberc file cannot add defaults or aliases to a command after the policy has checked it. It hands each command a private kubeconfig for its own ServiceAccount that points at the mounted token file, never a copy of the token.

### What the AI agent's RBAC does, and does not, bound

The chart's RBAC is a separate layer from the policy, and it bounds **where** the AI agent may write, not what a write may do. Read-only access (get/list/watch, pod logs) is granted cluster-wide. `aiAgent.remediation.enabled` adds patch/update on Deployments, StatefulSets, DaemonSets, ReplicaSets and their scale subresource, Jobs, CronJobs, Pods and HPAs; create on Jobs and HPAs; and delete on Pods and Jobs only. `aiAgent.remediation.nodeOperations` (on by default) adds cordon, uncordon, taint and drain on nodes, cluster-wide; set it to `false` and the chart grants no node RBAC and tells the AI agent (`ONEUPTIME_KUBECTL_ALLOW_NODE_OPERATIONS=false`), which then refuses cordon, uncordon, drain, taint and label/annotate/patch on a node before it spawns kubectl — and, since the AI agent reports the switch, OneUptime refuses such a fix already when it is proposed or approved. It never grants Secrets, `exec`, `attach`, `port-forward`, ServiceAccount tokens, impersonation, CRDs or RBAC writes, so deleting any other kind, or labelling a Service, ConfigMap, Ingress, Namespace or PVC, fails at the API server with `Forbidden` even when a human approved it. The two layers are not copies of each other: to RBAC, `apply`, `edit`, `replace`, `--all-namespaces` writes and `delete --all` are ordinary patch, update and delete calls, and only the policy stops them.

Be clear about what that write access amounts to, though: **patch/update on workloads, pods and CronJobs, and create on Jobs, in a namespace is equivalent to running any image as any ServiceAccount in that namespace and reading its Secrets.** A pod template can name any image, ServiceAccount and Secret volume, and RBAC has no "patch, but not the pod template" verb — that no rule names `exec` or Secrets does not change it. That is why the policy refuses changing which ServiceAccount, security settings, volumes, command or Secret wiring a pod runs with (pod-template security patches, patches that replace the pod spec or a whole `containers` list, `set serviceaccount`, `create … --image`, `expose --overrides`, non-JSON patch bodies), why the protected namespaces always need a human, and why `aiAgent.remediation.namespaces` exists. The policy does **not** refuse changing an image: `set image`, or a patch of an image field, is a riskier change — the new image runs as the workload's own ServiceAccount, with its Secrets — that a human approves, unless the cluster bypasses approvals or its allowlist names the command. Without `aiAgent.remediation.namespaces`, the write role is bound cluster-wide — kube-system, kube-public, kube-node-lease and the agent's own namespace included, since RBAC cannot leave namespaces out of a cluster-wide binding — and there the policy and the AI agent hold the line, not RBAC. With it, the chart binds the role in exactly the namespaces you list, OneUptime refuses a write anywhere else when it is proposed or approved, and the AI agent refuses it again before it spawns kubectl.

### Everything AI did on a cluster

The cluster's **AI Insights** page (AI → Insights) shows what OneUptime AI investigated and changed there: each investigation with its incident or alert and its summary, each fix it proposed or ran with its status, and every kubectl command — investigation or fix — with the command, its status and when it ran.

### Through a Runner instead (advanced)

A cluster that does not run the chart — one that sends Kubernetes telemetry some other way — can give OneUptime AI kubectl access through a Runner you run (Runbooks → Runners). Bind the Runner and a Kubernetes credential (API server URL + ServiceAccount token, under Runbooks → Runner Credentials) to the cluster with the API or Terraform (the cluster's **AI Access Runner** and **AI Access Credential**), and turn on **Runs AI Remediation Commands** for that Runner. Fixes through a Runner need no project switch beyond **Enable AI**. To limit where such a Runner may write, start it with `ONEUPTIME_KUBECTL_WRITE_NAMESPACES` (and `ONEUPTIME_KUBECTL_ALLOW_NODE_OPERATIONS=false` to keep fixes off nodes): the Runner reports those limits, so OneUptime refuses a fix outside them when it is proposed or approved, before it reaches the Runner, and the Runner refuses it again. A cluster bound to a Runner keeps using it even when the Kubernetes AI agent is installed; the AI agent page then shows which Runner and credential it goes through and, once the AI agent is connected, offers **Switch to the AI agent** in the **⋯** menu next to the agent's status.

Clusters set up with an earlier chart (`aiAccess.enabled=true`) reach OneUptime AI through the previous in-cluster Runner until the chart is upgraded. The upgrade replaces that Runner with the Kubernetes AI agent and carries its settings over — see [Upgrading the Agent](/docs/telemetry/kubernetes-agent#upgrading-the-agent).

## Infrastructure access — Docker, Podman, Swarm, Proxmox, VMware, Ceph, databases and hosts

The same kind of access exists for the rest of your infrastructure. A resource AI agent (image `oneuptime/resource-ai-agent`) runs next to the collector of a Docker or Podman host, a Docker Swarm cluster, a Proxmox cluster, a VMware vCenter, a Ceph cluster or a database server — or on its own on a Linux host — and lets OneUptime AI run read-only commands there while it investigates (`docker logs`, `pvesh get`, `govc vm.info`, `ceph health detail`, a fixed catalog of database diagnostics, `systemctl status`, `journalctl`, …) and, only when you start the agent with `ONEUPTIME_AI_ALLOW_WRITES=true` and turn fixes on for the resource, apply fixes with the same four modes and the same three checks as a Kubernetes cluster. Each such resource has the same **AI agent** and **Insights** pages. See [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents) for how to install them, what each one may run, and its security model.

## Quiet mode

An investigation that cannot determine a cause posts its analysis to the timeline **without** pinging your Slack/Teams workspace or the on-call. A non-answer should never page anyone — the analysis is there when someone looks, but nobody is woken up for "inconclusive". Confident analyses notify the workspace normally.

Whether an analysis counts as confident is decided by a server-verified signal, not by what the analysis text says: an investigation that gathered no evidence (no successful telemetry queries, no citations) is always treated as inconclusive, and otherwise a separate constrained check classifies the analysis. If that check itself fails, OneUptime AI errs on the side of notifying — quiet mode fails louder, never silent.

## Automatic code fixes

A confident analysis that recommends a repository code change can go one step further than notifying: it opens the fix. The switch **Open a fix pull request when an investigation finds a code change** is set independently under **Incidents > Settings > AI** and **Alerts > Settings > AI** (both are **on by default for new projects**; a project created before this default keeps its setting). Nothing opens until the project has a GitHub-App-connected repository and a Runner with the code-fix capability. A signal type with this setting enabled automatically queues the same fix task as the **Open Fix PR from this analysis** button on the investigation panel: an AI agent task that turns the posted analysis into a pull request, ready for review. The button uses the same recommendation and is hidden for analyses whose remedy is operational, infrastructure-only, external, an expected denial, a user error, or inconclusive.

A second switch beside it, **Open a pull request that adds missing telemetry**, is for the investigations that end inconclusive because the logs, traces or metrics they needed were missing: OneUptime AI opens a pull request that adds that instrumentation to the code paths involved, for your team to review. It needs a repository connected through the GitHub App, and is on for new projects too.

The same constrained, server-verified classification that decides confidence also decides whether a repository change is appropriate. Only a positive code-fix classification offers or automatically opens the pull request. An investigation that gathered no server-verified evidence, recommends a non-code remedy, or whose classification failed never opens one — PR creation always fails toward doing nothing. Everything else matches the manual button: the pull request opens ready for review, needs a GitHub-App-connected repository and a Runner with the code-fix capability, counts against that signal type's daily fix-task limit and the repository's open-PR cap when either is set, and at most one fix task per incident or alert can be active at a time. The investigation itself stays read-only — the fix runs as a separate, fully-logged agent task. See [Fix Tasks](/docs/ai/ai-agent) for how fix pull requests work, including the build-and-test verification that runs before each pull request opens.

## Auto-remediation waits for the analysis

If the project uses auto-remediation rules (rules under **Incidents > Rules > Auto Remediation Rules** and **Alerts > Rules > Auto Remediation Rules** that match new incidents and alerts to remediation runbooks — suggested or fully automatic), their ordering relative to investigations is deliberate — **RCA first**:

- When a new incident or alert **enqueues an AI investigation**, auto-remediation for that incident or alert is deferred until the investigation **settles** — any terminal outcome: the analysis is posted, the run errors out after its retries, it expires in the queue, or it goes stale. Only then do the remediation rules run, so the remediation planner always has the posted root cause analysis as input instead of racing it.
- When **no investigation is enqueued** (investigations disabled, or a severity floor, cooldown or budget you set skipped it), remediation fires immediately when the incident or alert is created, exactly as before. Auto-remediation never depends on the AI investigation lane being enabled.

An investigation that fails, expires, or goes stale still releases remediation — the deferral delays remediation until the outcome is known; it never cancels it.

While remediation waits, the incident's or alert's **Remediation** card says so, and shows what happened once the investigation settles.

Auto-remediation does depend on **Enable AI** (Project Settings > AI > AI Features), the project's one AI switch: with it off, no auto-remediation rule runs — not even one that starts a runbook without AI — and no cluster or resource is fixed.

## What auto-remediation did

Every incident and alert has a **Remediation** card that says what auto-remediation did with it — including when it did nothing. Each time the engine evaluates the incident or alert, it records one line per way it can be fixed:

- **Each Kubernetes cluster it is linked to** — OneUptime AI started a fix (and whether it asks for approval or runs on its own); fixes are off on the cluster; fixes are on but blocked, with the reason and the next step the cluster's AI agent page gives; the cluster already has a fix for it; or the fix could not start.
- **Each infrastructure resource it is linked to** — the same, and that another linked resource got the one AI fix an incident gets.
- **The Auto Remediation Rules** — none is set up, none matched (and how many were checked), or what each matching rule did: proposed or started a runbook, had AI compose commands or pick a runbook, or could not, and why.
- **The project** — **Enable AI** is off, so nothing runs; the incident already has the most fixes it can get; or the evaluation stopped on an error.

When the incident is linked to no cluster and no infrastructure resource at all, the card says so in one line — the most common reason nothing was fixed — with a link to each of its monitors, where you can link them to what they watch so the next incident they raise is linked. Each line links to where it is changed: the cluster's or resource's AI agent page, the Auto Remediation Rules, the AI settings or the LLM providers. Incidents and alerts created before this was recorded show the card only when something was proposed.

## Cost controls

Every limit below is optional, and none applies until you set it: with automatic investigation on, every new incident and alert is investigated, whatever its severity, and nothing caps how many investigations or fix tasks run. Alert volume can be much higher than incident volume, so these are the controls to reach for when you want a ceiling.

They are folded under **More settings** at the bottom of each signal type's AI settings page, in three cards that each edit on one page: **Which incidents are investigated** (or alerts: the severity floor and the cooldown), **Investigation limits** (the concurrency cap and the time limit) and **Daily limits** (the token and fix-task limits). Folded, the section names the three cards and says what the defaults do — every incident (or alert) is investigated, whatever its severity, and nothing limits how much OneUptime AI does — and, once a limit is set, shows the card that holds it.

| Control                   | Behavior                                                                                                                                                                                                                                                                                                                                                                                                     | Where to configure                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| Severity floor            | Only incidents or alerts at or above a minimum severity are investigated. Unset (the default) means **every severity**.                                                                                                                                                                                                                                                                                      | Incidents or Alerts > Settings > AI |
| Re-investigation cooldown | A repeat incident or alert from a monitor that was investigated within the cooldown is not investigated again — the first analysis stands. Unset (the default) or 0 means **no cooldown**: every incident and alert is investigated. At most 1440 minutes (a day).                                                                                                                                           | Incidents or Alerts > Settings > AI |
| Concurrency cap           | How many investigations of this signal type run at once. Incidents and alerts have separate pools. Unset (the default) means **no limit**: every investigation starts right away. A cap you set is at least 1, with no maximum; only then do queued investigations wait for a free slot, and they expire after 30 minutes.                                                                                   | Incidents or Alerts > Settings > AI |
| Investigation time limit  | Optional. Stop an investigation after this many minutes and report what it found. Unset (the default) means **no time limit** — the investigation runs until it is done, with only a runaway guard of 100 LLM calls and 300 tool calls. A completed investigation additionally spends one tiny confidence-classification call (20 output tokens max), metered and counted against the daily token limit.     | Incidents or Alerts > Settings > AI |
| Daily token limit         | Optional maximum tokens per UTC day for autonomous AI work linked to this signal type, including investigations, remediation, and follow-up fix tasks. Incident and alert usage is counted separately. When one limit is reached, only that signal type's AI work is paused until the next day — interactive AI chat is never blocked. Unset (the default) means **no limit**; set **0** to pause that lane. | Incidents or Alerts > Settings > AI |
| Daily fix-task limit      | Maximum incident- or alert-linked fix tasks created per UTC day. Each signal type has its own limit. Unset (the default) means **no limit**; set 0 to pause that lane's fix tasks.                                                                                                                                                                                                                           | Incidents or Alerts > Settings > AI |

AI work outside incidents and alerts — insight triage, and fix tasks for exceptions, insights and performance regressions — has no setting and none of these limits. Its pull requests count against a repository's **Max Open Fix Pull Requests** (on the repository's **Settings** page) once you set one; unset means no cap, and 0 blocks AI fix pull requests for that repository.

## Trust and safety

- **Read-only, always.** Autonomous investigations run with a curated set of read-only tools (metric, log, trace, exception, and change queries — including `baseline_anomaly`, which judges a metric against its learned hour-of-week normal range). The AI cannot acknowledge, resolve, page, or modify anything from an investigation.
- **Citations are minted server-side** from tool calls that actually executed — the model cannot fabricate a citation to data it never read.
- **Full audit trail.** Every investigation is recorded as an AI run with an ordered event trail (every LLM call and tool call), and every LLM call is metered in the AI Logs page (Project Settings > AI > AI Logs) with token counts and cost.
- **Secrets are redacted** from tool results before anything is sent to the LLM (tokens, credentials, key patterns).
- **Self-host = zero third-party egress.** With your own LLM provider (including local Ollama), telemetry never leaves your infrastructure.

## Auto-postmortem

Separately from investigations, OneUptime AI can draft a postmortem automatically when an incident is resolved. It is its own switch — **Draft a postmortem when an incident resolves**, on the incident AI settings page (Incidents > Settings > AI) — so you can investigate without drafting, or draft without investigating. It is **on by default for new projects**; a project created before this default keeps its setting. The draft never overwrites an existing postmortem note. This uses the same LLM provider and appears in the incident's postmortem tab for human review.

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

When an LLM provider is configured, each new insight also gets a **triage analysis**: a read-only, cited AI investigation — same engine, same audit trail, and same per-run budget as autonomous investigations — that assesses the likely root cause, the blast radius, and the one next action worth taking. Insight triage is not attached to an incident or alert, so it never consumes either the incident or alert token budget. The result is saved to the insight page. Without a provider you still get the insights; you just skip the AI triage.

Optionally, OneUptime AI can also open a **fix pull request** for the insight types with the strongest evidence: new and spiking exceptions (through the existing exception-fix pipeline) and trace latency regressions (grounded in the span evidence recorded on the insight). Error-log spikes and metric drift are never auto-fixed. Every automatic fix PR opens ready for review and requires human review — auto-merge does not exist. AI work outside incidents and alerts has no daily fix-task limit, so the only cap these pull requests meet is the repository's open-PR cap, if you set one.

All three settings are **on by default for new projects** (a project created before this default keeps its setting), at **AI > Insights > Settings**. Each is a switch that saves as soon as you flip it:

1. **Watch telemetry for problems** — turns on the watch loop, the inbox, and triage.
2. **Open a fix pull request when an insight points at your code** — turns on fix-task creation for eligible insights. This needs the same setup as the manual "Fix with AI" flow: a GitHub-App-connected repository and an LLM provider.
3. **Archive exceptions that are expected** — exception groups the triage classifies as expected denials (refused sign-ins, plan limits, scanners tripping intentional validation) are archived, so they stop showing as unresolved. User errors and infrastructure conditions never are, and you can bring an archived group back from the **Archived** tab.

With **Enable AI** off, insights are still found (the detectors use no AI), but none is triaged, archived or fixed; the settings page says so at the top. Without an LLM provider OneUptime AI can use, it says that insights are not triaged.

Every insight has **Confirm** and **Dismiss** buttons — use them even when you don't act on the finding. Your confirm/dismiss votes are how each detector's precision gets measured, and that measured precision is what decides which insight types earn more automation over time. Dismissing also keeps the same finding out of your inbox for the next 7 days.

## Requirements and limits

- An LLM provider must be configured (project-specific or the cloud global provider).
- Investigations trigger on **newly created** incidents and alerts only — turning the switches on does not investigate historical signals.
- The `baseline_anomaly` check needs about two weeks of metric history before its hour-of-week baselines are reliable; before that it reports "insufficient baseline data" rather than guessing.
- On OneUptime Cloud with the global provider, investigations consume metered AI tokens (see Project Settings > AI Credits). Bring your own provider key for unmetered usage.
