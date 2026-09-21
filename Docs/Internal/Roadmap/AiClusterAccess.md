# AI cluster access — OneUptime AI with a terminal on the cluster

**Status:** shipped for Kubernetes (investigation + remediation). Hosts, Docker, Podman and the other resource kinds are the next epic and reuse every layer below except the executor.

## The problem this solves

An AI investigation could only read the telemetry the agents ship. For a Kubernetes signal that is frequently not enough: "pods stuck in Pending" is diagnosed by describing the pod and reading its events, which no metric carries. The investigation on the alert that started this work finished "without a report" for exactly that reason.

Remediation existed (the `AutoRemediationRule` + `RemediationExecution` lane: policy-checked Bash/SSH commands on opted-in Runners) but reaching a cluster took five steps: create a Runner, install it, create a Kubernetes credential, assign it, write a rule that composes commands. Customers got lost.

## What shipped

One helm flag gives OneUptime AI kubectl on a cluster; the cluster's **AI** page is the single place that says what AI may do and what is missing.

```
helm upgrade … --set aiAccess.enabled=true [--set aiAccess.remediation.enabled=true]
```

| Layer | Where | What it does |
| --- | --- | --- |
| Policy | `Common/Utils/AiRemediation/KubectlPolicy.ts` | Pure, three-place kubectl policy: tokenizes a one-line command into an argv (shell quoting only; kubectl is never spawned through a shell) and tiers it `Read` / `SafeWrite` / `RiskyWrite` / `Denied`. Credential/cluster-selection/raw-API/file/verbose flags, exec/cp/port-forward/apply/edit, `--all-namespaces` writes and deleting namespaces/nodes/volumes/secrets/CRDs are Denied even with approval. |
| Model | `KubernetesCluster` (+ `RunnerJob.kubernetesClusterId`, `AutoRemediationSuggestion.kubernetesClusterId`) | `aiAccessRunnerId`, `aiAccessCredentialId`, `isAiInvestigationEnabled`, `aiRemediationMode` (Disabled / RequireApproval / Automatic), `aiKubectlCommandAllowlist`, `aiAccessLastVerifiedAt`, `aiAccessLastError`. Migration `AddKubernetesClusterAiAccess1794000000000`. |
| Readiness | `Common/Server/Services/KubernetesClusterAiAccessService.ts` | Computes `KubernetesClusterAiAccessStatus` from current configuration: every reason AI cannot (fully) use the cluster is a `gap` with a next step and a `blocks` scope, and readiness is derived only from gaps. Also resolves the clusters a signal is about (the subject's `kubernetesClusters` relation, falling back to the Kubernetes monitor step's `clusterIdentifier`). |
| Registration | `POST /runner-ingest/register-kubernetes-agent` (ingestion-key auth, new `TelemetryIngestSurface.KubernetesAgentRunner`) | The chart's Runner exchanges the collector's ingestion key + `clusterName` for a Runner identity. First bind turns investigation on and remediation to "ask for approval" when the chart granted writes; re-registration rotates the key and never touches the operator's switches; a cluster an operator bound elsewhere is never stolen. |
| Jobs | `RunnerJobService.enqueueAiKubectlCommand`, `RunnerJobOrigin.AiInvestigation`, `RunbookStepType.Kubectl` | The chokepoint re-runs the policy, refuses non-Read for investigations, and stores an argv payload. Both AI origins are gated on `Runner.canRunAiCommands`. A credential-less kubectl job is only served to a Runner that reported itself in-cluster. |
| Investigation | `Common/Server/Utils/AI/ClusterAccess/*` | `KubectlInvestigationToolkit` (`list_cluster_access`, `run_kubectl`, Read tier only, 8 per run), `ClusterAccessContext` (deterministic prompt section + persona addendum + the human sentence), `KubectlJobRunner` (enqueue, wait with heartbeat, record outcome, redact/cap). Wired into both investigation runners; `InvestigationRequest.additionalInstructions` appends to the persona. |
| Remediation | `RemediationCommandTools` (+ `CommandPlanExecutor`, `RemediationExecutionRunner`, `AutoRemediationRuleEngineService`) | Cluster targets in the toolkit (`stepType: Kubectl`, `kubernetesClusterId`); FullAuto runs Read/SafeWrite inline, RiskyWrite only when the cluster allowlist names it; rollbacks must be safe. The rule engine starts a cluster-level suggestion for every remediation-ready cluster with no rule involved (Automatic → FullAuto + auto-resolve, RequireApproval → Suggest). The verifier's failure path starts one follow-up round, always for approval, capped at 2 rounds per subject per cluster. |
| Runner | `packages/Runner/Services/KubectlExecutor.ts`, kubernetes-agent mode in `Config.ts` / `RegisterRunner.ts` / `Heartbeat.ts` | Re-runs the policy on the argv, refuses writes when `ONEUPTIME_KUBECTL_ALLOW_WRITES=false`, writes a private temporary kubeconfig for credential-based access, spawns pinned kubectl (in the image) with a minimal environment. Heartbeats carry the Kubernetes posture. |
| Chart | `HelmChart/Public/kubernetes-agent/templates/ai-runner.yaml` | Own ServiceAccount + ClusterRole (read-only; write verbs only with `aiAccess.remediation.enabled`), locked-down Deployment. `tests/ai-runner_test.yaml` asserts the RBAC by rendering. |
| Dashboard | `Pages/Kubernetes/View/AI.tsx`, `Components/AI/ClusterAccessNotice.tsx`, `RemediationSuggestionCard`, `InvestigationPanel` | The cluster AI page (status, checklist, one-command setup, settings, access test, command history). The investigation panel says "investigated with OneUptime data only — no kubectl access to X, why, and where to fix it" and counts kubectl commands. Kubectl plans render with cluster and tier. |

## Trust model, in one paragraph

Three independent checks keep an investigation read-only: the toolkit refuses non-Read tiers, the enqueue chokepoint refuses non-Read for the investigation origin, and the Runner refuses non-Read for that origin before spawning. Three independent bounds limit remediation: RBAC (the chart grants only what the fix policy can express), the policy (tiers + the cluster allowlist), and the Runner's local write switch. The model never sees a credential: an in-cluster Runner uses its ServiceAccount, an external Runner gets the credential resolved at claim time and written to a private temp file for the life of one command.

## Next epics

- **Hosts / Docker / Podman / other resources.** The same shape: a per-resource AI page, a readiness status with gaps, a Runner binding, and a resource-specific executor with a tiered policy (`systemctl`/`journalctl`/`docker`/`podman` reads; restarts as SafeWrite). The infrastructure agents are push-only today; the Runner (or a Runner mode inside the agent image) is the control channel.
- **Plan preview in the investigation panel.** Today the remediation card sits below the investigation. A single timeline (investigating → commands → root cause → fix → approval → verification) is the next UI step.
- **Per-namespace scoping.** Bind a Runner with a namespace-scoped Role instead of a ClusterRole for teams that only own part of a cluster.
