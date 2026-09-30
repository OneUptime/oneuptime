import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  SetupGuideContent,
  SetupGuideOption,
  SetupGuideStep,
  SetupGuideTopic,
  codeBlock,
  resolveSetupGuideOption,
} from "../../../Components/SetupGuide/SetupGuide";

/*
 * The helm release and namespace every Kubernetes agent command the
 * Dashboard shows uses: the install guide below, and the one-command
 * upgrades on the cluster's AI agent page (KubernetesAiAccessSetup.ts),
 * which import these. `helm upgrade` of a release that does not exist fails
 * with "has no deployed releases", so the two must never drift - hence one
 * definition. The chart itself is `oneuptime/kubernetes-agent`, which is
 * not the release.
 */
export const KUBERNETES_AGENT_HELM_RELEASE: string = "kubernetes-agent";
export const KUBERNETES_AGENT_HELM_NAMESPACE: string = "oneuptime-agent";
export const KUBERNETES_AGENT_HELM_REPO_URL: string =
  "https://helm-chart.oneuptime.com";

// The name the guide suggests when it is not installing for a known cluster.
export const KUBERNETES_EXAMPLE_CLUSTER_NAME: string = "my-cluster";

/*
 * Where the cluster runs. The chart only distinguishes three presets
 * (KubernetesAgentPreset); the guide offers the managed services by name
 * because that is how people know their cluster, and because connecting
 * kubectl to each one is a different command.
 */
export type KubernetesPlatform =
  | "standard"
  | "eks"
  | "gke"
  | "aks"
  | "gke-autopilot"
  | "eks-fargate";

// The chart's `preset` value (HelmChart/Public/kubernetes-agent/values.yaml).
export type KubernetesAgentPreset =
  | "standard"
  | "gke-autopilot"
  | "eks-fargate";

export const KUBERNETES_PLATFORMS: Array<SetupGuideOption<KubernetesPlatform>> =
  [
    {
      key: "standard",
      label: "Standard Kubernetes",
      description:
        "Self-managed clusters — kubeadm, k3s, RKE, minikube, kind and others.",
    },
    {
      key: "eks",
      label: "Amazon EKS",
      description: "EKS with EC2 or managed node groups.",
    },
    {
      key: "gke",
      label: "Google GKE",
      description: "GKE Standard clusters with node pools.",
    },
    {
      key: "aks",
      label: "Azure AKS",
      description: "Azure Kubernetes Service.",
    },
    {
      key: "gke-autopilot",
      label: "GKE Autopilot",
      description: "Fully managed GKE: no host access, no privileged pods.",
    },
    {
      key: "eks-fargate",
      label: "EKS Fargate",
      description: "Pods on AWS Fargate: no nodes, so no DaemonSets.",
    },
  ];

export const DEFAULT_KUBERNETES_PLATFORM: KubernetesPlatform = "standard";

export function resolveKubernetesPlatform(
  platform: string | null | undefined,
): KubernetesPlatform {
  return (
    resolveSetupGuideOption(KUBERNETES_PLATFORMS, platform) ||
    DEFAULT_KUBERNETES_PLATFORM
  );
}

export function getKubernetesAgentPreset(
  platform: KubernetesPlatform,
): KubernetesAgentPreset {
  if (platform === "gke-autopilot" || platform === "eks-fargate") {
    return platform;
  }
  return "standard";
}

/*
 * GKE Autopilot and EKS Fargate reject privileged pods and hostPath, so the
 * chart's API-mode preset is needed there, and the eBPF DaemonSet (which
 * must run privileged to load eBPF programs) has to be turned off.
 */
function isRestrictedPlatform(platform: KubernetesPlatform): boolean {
  return getKubernetesAgentPreset(platform) !== "standard";
}

export interface KubernetesSetupGuideOptions {
  oneuptimeUrl: string;
  apiKey: string;
  platform: KubernetesPlatform;
  /*
   * The cluster the guide installs for (a cluster's own Documentation tab).
   * Omitted on the product pages, where the guide suggests a name instead.
   */
  clusterName?: string | undefined;
}

/**
 * The `--set` flags the install command adds for a platform, after the
 * connection values every install needs.
 */
export function getKubernetesPlatformInstallFlags(
  platform: KubernetesPlatform,
): Array<string> {
  if (!isRestrictedPlatform(platform)) {
    return [];
  }
  return [
    `--set preset=${getKubernetesAgentPreset(platform)}`,
    "--set ebpf.enabled=false",
  ];
}

function helmInstallCommand(data: {
  oneuptimeUrl: string;
  apiKey: string;
  clusterName: string;
  flags: Array<string>;
}): string {
  return [
    `helm install ${KUBERNETES_AGENT_HELM_RELEASE} oneuptime/kubernetes-agent`,
    `  --namespace ${KUBERNETES_AGENT_HELM_NAMESPACE}`,
    "  --create-namespace",
    `  --set oneuptime.url="${data.oneuptimeUrl}"`,
    `  --set oneuptime.apiKey="${data.apiKey}"`,
    `  --set clusterName="${data.clusterName}"`,
    ...data.flags.map((flag: string): string => {
      return `  ${flag}`;
    }),
  ].join(" \\\n");
}

/*
 * A configuration change to an installed agent. --reuse-values keeps the
 * install's values (URL, key, cluster name, preset) and applies only what
 * is passed on top.
 */
export function getKubernetesAgentUpgradeCommand(flags: Array<string>): string {
  return [
    `helm upgrade ${KUBERNETES_AGENT_HELM_RELEASE} oneuptime/kubernetes-agent`,
    `  --namespace ${KUBERNETES_AGENT_HELM_NAMESPACE}`,
    "  --reuse-values",
    ...flags.map((flag: string): string => {
      return `  ${flag}`;
    }),
  ].join(" \\\n");
}

function getPrerequisites(platform: KubernetesPlatform): Array<string> {
  const lines: Array<string> = [
    "A Kubernetes cluster running v1.23 or later",
    "`kubectl` and `helm` (v3) installed on your machine",
  ];

  if (platform === "eks") {
    lines.push("The AWS CLI (`aws`), signed in to the cluster's account");
  } else if (platform === "eks-fargate") {
    lines.push(
      "The AWS CLI (`aws`) and `eksctl`, signed in to the cluster's account",
    );
  } else if (platform === "gke" || platform === "gke-autopilot") {
    lines.push(
      "The Google Cloud CLI (`gcloud`) with the `gke-gcloud-auth-plugin` component",
    );
  } else if (platform === "aks") {
    lines.push("The Azure CLI (`az`), signed in to the cluster's subscription");
  }

  return lines;
}

function getConnectStep(platform: KubernetesPlatform): SetupGuideStep {
  const check: string = "kubectl get nodes";

  switch (platform) {
    case "eks":
      return {
        title: "Connect kubectl to your EKS cluster",
        description:
          "Add the cluster to your kubeconfig, then check that kubectl can reach it.",
        markdown: codeBlock(
          "bash",
          `aws eks update-kubeconfig --region <region> --name <cluster-name>\n${check}`,
        ),
      };
    case "eks-fargate":
      return {
        title: "Connect kubectl to your EKS cluster",
        description:
          "Add the cluster to your kubeconfig, and give the agent's namespace a Fargate profile so its pods can be scheduled.",
        markdown: `${codeBlock(
          "bash",
          `aws eks update-kubeconfig --region <region> --name <cluster-name>\n${check}`,
        )}

Pods run on Fargate only in namespaces a Fargate profile selects. Create one for \`${KUBERNETES_AGENT_HELM_NAMESPACE}\` — without it the agent's pods stay \`Pending\`:

${codeBlock(
  "bash",
  `eksctl create fargateprofile \\
  --cluster <cluster-name> \\
  --region <region> \\
  --name ${KUBERNETES_AGENT_HELM_NAMESPACE} \\
  --namespace ${KUBERNETES_AGENT_HELM_NAMESPACE}`,
)}`,
      };
    case "gke":
    case "gke-autopilot":
      return {
        title: "Connect kubectl to your GKE cluster",
        description:
          "Fetch the cluster's credentials, then check that kubectl can reach it.",
        markdown: codeBlock(
          "bash",
          `gcloud container clusters get-credentials <cluster-name> \\
  --location <region-or-zone> \\
  --project <project-id>
${check}`,
        ),
      };
    case "aks":
      return {
        title: "Connect kubectl to your AKS cluster",
        description:
          "Fetch the cluster's credentials, then check that kubectl can reach it.",
        markdown: codeBlock(
          "bash",
          `az aks get-credentials --resource-group <resource-group> --name <cluster-name>\n${check}`,
        ),
      };
    default:
      return {
        title: "Check kubectl points at your cluster",
        description:
          "Helm installs into whichever cluster your current kubectl context points at.",
        markdown: `${codeBlock("bash", `kubectl config current-context\n${check}`)}

Wrong cluster? Switch with \`kubectl config use-context <context-name>\`.`,
      };
  }
}

function getInstallStep(data: {
  oneuptimeUrl: string;
  apiKey: string;
  platform: KubernetesPlatform;
  clusterName: string;
  isClusterNameKnown: boolean;
}): SetupGuideStep {
  const command: string = `helm repo add oneuptime ${KUBERNETES_AGENT_HELM_REPO_URL}
helm repo update

${helmInstallCommand({
  oneuptimeUrl: data.oneuptimeUrl,
  apiKey: data.apiKey,
  clusterName: data.clusterName,
  flags: getKubernetesPlatformInstallFlags(data.platform),
})}`;

  const notes: Array<string> = [];

  if (data.isClusterNameKnown) {
    notes.push(
      `This installs the agent for **\`${data.clusterName}\`** — keep \`clusterName\` exactly as it is, or the data registers as a new cluster.`,
    );
  } else {
    notes.push(
      `Replace \`${data.clusterName}\` with a name for this cluster, such as \`prod-us-east-1\`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.`,
    );
  }

  if (isRestrictedPlatform(data.platform)) {
    const platformName: string =
      data.platform === "gke-autopilot" ? "GKE Autopilot" : "EKS Fargate";
    notes.push(
      `\`preset=${getKubernetesAgentPreset(data.platform)}\` collects pod logs through the Kubernetes API instead of reading them from each node, and \`ebpf.enabled=false\` leaves out eBPF tracing, which needs privileged pods that ${platformName} does not allow.`,
    );
  }

  if (data.apiKey === SETUP_GUIDE_API_KEY_PLACEHOLDER) {
    notes.push(
      `Pick an ingestion key in step 1 to fill in \`${SETUP_GUIDE_API_KEY_PLACEHOLDER}\`.`,
    );
  }

  return {
    title: "Install the agent",
    description:
      "Add the OneUptime Helm repository and install the agent with Helm.",
    markdown: `${codeBlock("bash", command)}

${notes.join("\n\n")}`,
  };
}

// What `kubectl get pods` shows on a healthy install, per preset.
function getExpectedPods(preset: KubernetesAgentPreset): {
  listing: string;
  explanation: string;
} {
  const release: string = KUBERNETES_AGENT_HELM_RELEASE;
  const header: string =
    "NAME                                          READY   STATUS    RESTARTS   AGE";
  const row: (name: string) => string = (name: string): string => {
    return `${name.padEnd(46)}1/1     Running   0          1m`;
  };

  if (preset === "eks-fargate") {
    return {
      listing: [
        header,
        row(`${release}-xxxxxxxxxx-xxxxx`),
        row(`${release}-ai-agent-xxxxxxxxxx-xxxxx`),
        row(`${release}-logs-yyyyyyyyyy-yyyyy`),
      ].join("\n"),
      explanation:
        "Three Deployments — the collector, the Kubernetes AI agent and the pod log reader. Fargate never schedules DaemonSets, so there are no per-node pods.",
    };
  }

  if (preset === "gke-autopilot") {
    return {
      listing: [
        header,
        row(`${release}-xxxxxxxxxx-xxxxx`),
        row(`${release}-ai-agent-xxxxxxxxxx-xxxxx`),
        row(`${release}-logs-yyyyyyyyyy-yyyyy`),
        row(`${release}-logs-xxxxx`),
      ].join("\n"),
      explanation:
        "The collector, the Kubernetes AI agent and the pod log reader, plus one node collector per node for kubelet metrics.",
    };
  }

  return {
    listing: [
      header,
      row(`${release}-xxxxxxxxxx-xxxxx`),
      row(`${release}-ai-agent-xxxxxxxxxx-xxxxx`),
      row(`${release}-ebpf-xxxxx`),
      row(`${release}-logs-xxxxx`),
    ].join("\n"),
    explanation:
      "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node.",
  };
}

function getVerifyStep(platform: KubernetesPlatform): SetupGuideStep {
  const expected: { listing: string; explanation: string } = getExpectedPods(
    getKubernetesAgentPreset(platform),
  );

  return {
    title: "Verify the installation",
    description: "Check that the agent's pods are running.",
    markdown: `${codeBlock("bash", `kubectl get pods -n ${KUBERNETES_AGENT_HELM_NAMESPACE}`)}

You should see:

${codeBlock("output", expected.listing)}

${expected.explanation} Once they are \`Running\`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.

**Kubernetes AI agent (on by default, read-only).** The \`${KUBERNETES_AGENT_HELM_RELEASE}-ai-agent\` pod lets OneUptime AI investigate incidents and alerts on this cluster with read-only kubectl — \`get\`, \`describe\`, \`logs\`, \`events\`, \`top\` — using the same API key, and it can change nothing unless you give it write access later. Open the cluster and go to **AI → Agent** to see it. Don't want it? Add \`--set aiAgent.enabled=false\` to the install command.`,
  };
}

function getAdvancedTopics(
  platform: KubernetesPlatform,
): Array<SetupGuideTopic> {
  const topics: Array<SetupGuideTopic> = [
    {
      title: "Monitor only some namespaces",
      summary:
        "Restrict pod logs and eBPF tracing to the namespaces you choose. kube-system is skipped by default.",
      markdown: `Namespace rules decide what the agent collects from each namespace. To collect pod logs and eBPF data only from \`default\`, \`production\` and \`staging\`:

${codeBlock(
  "bash",
  getKubernetesAgentUpgradeCommand([
    `--set-json 'namespaceFilters.rules=[{"action":"include","namespaces":["default","production","staging"],"scopes":["podLogs","ebpfDiscovery"]}]'`,
  ]),
)}

To keep everything but stop the logs of noisy namespaces, exclude them from \`podLogs\` only:

${codeBlock(
  "bash",
  getKubernetesAgentUpgradeCommand([
    `--set-json 'namespaceFilters.rules=[{"action":"exclude","namespaces":["kube-system"],"scopes":["podLogs","ebpfDiscovery"]},{"action":"exclude","namespaces":["noisy-*"],"scopes":["podLogs"]}]'`,
  ]),
)}

- **Scopes:** \`podLogs\` (container stdout/stderr), \`ebpfDiscovery\` (eBPF traces and metrics), \`metrics\` (namespaced metrics) and \`traces\` (every span).
- **Patterns** match the whole namespace name and accept \`*\`, as in \`team-*\`. An \`exclude\` rule always wins over an \`include\` rule.
- **Setting the rules replaces the default one**, which excludes \`kube-system\` from \`podLogs\` and \`ebpfDiscovery\`. Keep it in your list, as in the second example, if you still want that.
- Node and cluster metrics have no namespace, so they are always kept.`,
    },
    {
      title: "Control pod log collection",
      summary:
        "Keep only important log lines, turn pod logs off, or change how they are read.",
      markdown: `**Only send important lines.** Drop pod log lines below a severity before they leave the cluster:

${codeBlock("bash", getKubernetesAgentUpgradeCommand(["--set filters.logs.minSeverity=WARN"]))}

Accepts \`TRACE\`, \`DEBUG\`, \`INFO\`, \`WARN\`, \`ERROR\` and \`FATAL\`: \`WARN\` keeps warnings, errors and fatal lines. The severity is read from the log line itself (\`[ERROR]\`, \`level=warn\`, \`"level":"info"\`). Kubernetes events are never dropped by this.

**Turn pod logs off.** Metrics are not affected — the node collector keeps running for kubelet and cAdvisor metrics, it just stops reading pod logs:

${codeBlock("bash", getKubernetesAgentUpgradeCommand(["--set logs.enabled=false"]))}

**Change how logs are read.** The preset picks this for you; an explicit \`logs.mode\` always wins over it:

- \`logs.mode=daemonset\` — reads \`/var/log/pods\` on every node through hostPath (lowest overhead; needs hostPath).
- \`logs.mode=api\` — a Deployment tails pod logs through the Kubernetes API (works on any cluster).
- \`logs.mode=disabled\` — no pod logs.

${codeBlock("bash", getKubernetesAgentUpgradeCommand(["--set logs.mode=api"]))}`,
    },
  ];

  if (platform === "standard") {
    topics.push({
      title: "Collect control plane metrics",
      summary:
        "API server, scheduler, controller manager and etcd metrics on self-managed clusters.",
      markdown: `${codeBlock("bash", getKubernetesAgentUpgradeCommand(["--set controlPlane.enabled=true"]))}

Only for self-managed clusters: managed services (EKS, GKE, AKS) do not expose their control plane metrics.`,
    });
  }

  topics.push({
    title: "Track what workloads cost",
    summary:
      "Spend per namespace, workload and pod — with idle capacity and efficiency — on the cluster's Costs page.",
    markdown: `${codeBlock("bash", getKubernetesAgentUpgradeCommand(["--set cost.enabled=true"]))}

That alone is a complete install: the chart bundles the open-source OpenCost engine (plus the small Prometheus it needs) and prices your nodes and volumes from your cloud provider's public list prices — no credentials required. It adds two small pods; the first data appears after the first full hour.

- **Already running Kubecost or OpenCost?** Point the agent at it instead, and nothing is bundled: add \`--set cost.engine.url=http://opencost.opencost.svc.cluster.local:9003\` (or your Kubecost service).
- **On-prem or bare metal?** Set a rate card with \`--set cost.opencost.customPricing.enabled=true\` (USD per resource-hour — see the chart's \`values.yaml\`).

Full guide: [Kubernetes Cost Observability](/docs/telemetry/kubernetes-cost).`,
  });

  if (isRestrictedPlatform(platform)) {
    topics.push({
      title: "Application traces (eBPF)",
      summary: "Why eBPF auto-instrumentation is off on this platform.",
      markdown: `On other clusters the agent runs [OpenTelemetry eBPF Instrumentation](https://opentelemetry.io/docs/zero-code/obi/) on every node to capture HTTP, gRPC and SQL traces with no code changes. Loading eBPF programs needs privileged pods, which this platform does not allow, so the install command turns it off with \`ebpf.enabled=false\`.

To get traces here, instrument your services with an [OpenTelemetry SDK](/docs/telemetry/open-telemetry) and send them to OneUptime directly.`,
    });
  } else {
    topics.push({
      title: "Application traces (eBPF)",
      summary:
        "Traces, request metrics and the service map from every pod, with no code changes. On by default.",
      markdown: `The agent runs [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) on every node. It captures HTTP/HTTPS, gRPC and SQL/Redis traffic from Go, .NET, Java, Node.js, Python, Ruby and Rust services — no SDK and no sidecar — and ships traces, request (RED) metrics and service-graph data through the collector.

**Requirements:** Linux kernel **5.8+** with BTF (the default on Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). The eBPF pods run **privileged**, which they need to load eBPF programs.

**Turn it off** if your nodes run an older kernel, if privileged pods are not allowed, or if your services already send traces with OpenTelemetry SDKs and you don't want duplicates:

${codeBlock("bash", getKubernetesAgentUpgradeCommand(["--set ebpf.enabled=false"]))}

**Choose the signals.** Each family is switched with \`--set ebpf.features.<name>=false\` (or \`=true\`):

| \`ebpf.features.*\` | Default | What it adds |
|---|---|---|
| \`httpMetrics\` | on | HTTP/gRPC request rate, errors and latency per service |
| \`spanMetrics\` | on | Per-span request/response size and duration |
| \`serviceGraph\` | on | Caller → callee edges; drives the service map |
| \`hostMetrics\` | on | CPU and memory per instrumented process |
| \`networkMetrics\` | on | Pod-to-pod TCP/UDP flow counters |
| \`networkInterZoneMetrics\` | off | Inter-zone network metrics (doubles their cardinality) |
| \`tcpStats\` | on | Node-level TCP RTT, failed-connection and retransmit counters |

**Cross-service trace propagation** — linking a request that crosses pod A → pod B into a single trace — is **off by default**. Turn it on with \`--set ebpf.contextPropagation=true\` only after reading this: it works by rewriting traffic that is already in flight (widening plaintext HTTP requests in the kernel, and appending a TCP option to TLS and raw TCP), and a mistake in that byte accounting desynchronizes the stream — the reported symptom is transfers through an L7 proxy such as nginx hanging once a response passes ~64KB. An OpenTelemetry SDK propagates \`traceparent\` in userspace without any of that, and is the safer option.`,
    });
  }

  topics.push(
    {
      title: "Tag the cluster with project labels",
      summary:
        "Attach labels such as team or environment to the cluster and everything it reports.",
      markdown: `${codeBlock(
        "bash",
        getKubernetesAgentUpgradeCommand([
          "--set oneuptime.labels.team=payments",
          "--set oneuptime.labels.env=production",
        ]),
      )}

Each \`oneuptime.labels.<key>=<value>\` becomes the label \`<key>:<value>\` on the cluster, and on the services and hosts it reports. Labels are matched case-insensitively, so an existing \`Production\` label is reused; labels added in the OneUptime UI are never removed by the agent.`,
    },
    {
      title: "Upgrade or uninstall the agent",
      summary:
        "Move to the latest chart and keep your settings, or remove the agent.",
      markdown: `**Upgrade** to the latest chart. \`--reuse-values\` keeps your existing configuration (preset, cluster name, filters); add any new \`--set\` flags on top of it:

${codeBlock("bash", `helm repo update\n${getKubernetesAgentUpgradeCommand([])}`)}

**Uninstall** the agent and its namespace:

${codeBlock(
  "bash",
  `helm uninstall ${KUBERNETES_AGENT_HELM_RELEASE} --namespace ${KUBERNETES_AGENT_HELM_NAMESPACE}\nkubectl delete namespace ${KUBERNETES_AGENT_HELM_NAMESPACE}`,
)}${
        platform === "eks-fargate"
          ? `

Then remove the Fargate profile: \`eksctl delete fargateprofile --cluster <cluster-name> --name ${KUBERNETES_AGENT_HELM_NAMESPACE}\`.`
          : ""
      }`,
    },
    {
      title: "What the agent collects",
      summary:
        "Node, pod and container metrics, events, pod logs, traces and more.",
      markdown: getCollectedDataMarkdown(platform),
    },
  );

  return topics;
}

function getCollectedDataMarkdown(platform: KubernetesPlatform): string {
  const rows: Array<string> = ["| Category | Data |", "|----------|------|"];

  if (platform === "eks-fargate") {
    rows.push(
      "| **Cluster metrics** | Node conditions, allocatable resources, pod and workload counts |",
    );
  } else {
    rows.push(
      "| **Node metrics** | CPU, memory, filesystem and network usage |",
      "| **Pod and container metrics** | CPU, memory, network I/O and restarts |",
      "| **Cluster metrics** | Node conditions, allocatable resources, pod and workload counts |",
    );
  }

  rows.push(
    "| **Kubernetes events** | Warnings, errors and scheduling events |",
    isRestrictedPlatform(platform)
      ? "| **Pod logs** | stdout/stderr of every container, read through the Kubernetes API |"
      : "| **Pod logs** | stdout/stderr of every container, read from each node |",
  );

  if (!isRestrictedPlatform(platform)) {
    rows.push(
      "| **Application traces** *(eBPF)* | HTTP, gRPC and SQL/Redis spans from every pod — no SDK or code changes |",
      "| **Request metrics and service graph** *(eBPF)* | Request rate, errors and latency per service, and caller → callee edges for the service map |",
      "| **Network flows** *(eBPF)* | Pod-to-pod TCP/UDP byte and packet counters |",
    );
  }

  rows.push(
    "| **Workload costs** *(opt-in, `cost.enabled=true`)* | Spend per namespace, workload and pod, with idle capacity and efficiency |",
  );

  const notes: Array<string> = [];
  if (platform === "eks-fargate") {
    notes.push(
      "Fargate never schedules DaemonSets, so node, pod and container metrics are not available there.",
    );
  } else if (platform === "gke-autopilot") {
    notes.push(
      "Autopilot blocks hostPath, so node metrics that read the host's `/proc` and `/sys` (disk I/O, inodes, NIC errors) are not collected; kubelet and cAdvisor metrics are.",
    );
  }

  return [rows.join("\n"), ...notes].join("\n\n");
}

function getTroubleshootingTopics(
  platform: KubernetesPlatform,
  clusterName: string,
): Array<SetupGuideTopic> {
  const namespace: string = KUBERNETES_AGENT_HELM_NAMESPACE;
  const release: string = KUBERNETES_AGENT_HELM_RELEASE;
  const topics: Array<SetupGuideTopic> = [];

  if (platform === "eks-fargate") {
    topics.push({
      title: "Agent pods stay Pending",
      markdown: `Fargate only schedules pods in namespaces that a Fargate profile selects. Check that one exists for \`${namespace}\`:

${codeBlock("bash", "eksctl get fargateprofile --cluster <cluster-name>")}

If there is none, create it. Fargate is chosen when a pod is created, so pods that were already pending stay pending — restart the agent's Deployments once the profile is active:

${codeBlock(
  "bash",
  `eksctl create fargateprofile \\
  --cluster <cluster-name> \\
  --region <region> \\
  --name ${namespace} \\
  --namespace ${namespace}
kubectl rollout restart deployment -n ${namespace}`,
)}`,
    });
  }

  if (!isRestrictedPlatform(platform)) {
    topics.push({
      title: "Install fails with a hostPath or Pod Security error",
      markdown: `Your cluster blocks \`hostPath\` volumes or privileged pods. That is normal on **GKE Autopilot** and **EKS Fargate** — pick that platform at the top of this guide and follow its steps.

On any other cluster with a restrictive Pod Security policy, remove the failed release:

${codeBlock(
  "bash",
  `helm uninstall ${KUBERNETES_AGENT_HELM_RELEASE} --namespace ${KUBERNETES_AGENT_HELM_NAMESPACE}`,
)}

Then run the install command again with \`--set preset=gke-autopilot --set ebpf.enabled=false\` added. That preset reads pod logs through the Kubernetes API instead of hostPath and applies a hardened security context, and turning eBPF off leaves out the privileged eBPF pods.`,
    });
  }

  topics.push(
    {
      title: 'Cluster shows as "Disconnected"',
      markdown: `1. Check that the agent's pods are running: \`kubectl get pods -n ${namespace}\`
2. Check the collector's logs: \`kubectl logs -n ${namespace} deployment/${release}\`
3. Verify the OneUptime URL and ingestion key in the install command are correct.
4. Make sure the cluster can reach your OneUptime instance over the network.`,
    },
    {
      title: 'AI → Agent shows "Offline" or "Not installed"',
      markdown: `1. Check the AI agent's pod: \`kubectl get pods -n ${namespace} -l component=ai-agent\`
2. Check its logs: \`kubectl logs -n ${namespace} -l component=ai-agent --tail=100\`
3. No pod? Upgrade the chart (see **Upgrade the agent** under Advanced) and add \`--set aiAgent.enabled=true\`.`,
    },
    {
      title: "No metrics appearing",
      markdown: `1. Check that the cluster name matches: this guide installs **\`${clusterName}\`**.
2. Verify the agent's RBAC permissions: \`kubectl get clusterrolebinding | grep ${release}\`
3. Look for export errors in the collector's logs: \`kubectl logs -n ${namespace} deployment/${release}\``,
    },
  );

  if (isRestrictedPlatform(platform)) {
    topics.push({
      title: "No pod logs appearing",
      markdown: `Pod logs are read through the Kubernetes API on this platform.

1. Check that the log reader is ready: \`kubectl get pods -n ${namespace} -l component=log-collector\`
2. Check its logs: \`kubectl logs -n ${namespace} deployment/${release}-logs\`
3. Its \`/healthz\` endpoint reports the number of active log streams and the last export error.
4. On very large clusters one reader can fall behind — split the namespaces across separate releases with \`namespaceFilters\`.`,
    });
  } else {
    topics.push(
      {
        title: "eBPF pods crash or fail to start",
        markdown: `${codeBlock("bash", `kubectl logs -n ${namespace} -l component=ebpf-instrument --tail=200`)}

- **Kernel too old or no BTF.** eBPF needs Linux 5.8+ with BTF — check with \`uname -r\` on a node. If you can't upgrade, turn eBPF off with \`--set ebpf.enabled=false\`.
- **Privileged pods blocked.** Some locked-down clusters reject them. Turn eBPF off.
- **\`debugfs\` / \`tracefs\` not available on the host.** Turn off just the TCP stats family: \`--set ebpf.features.tcpStats=false\`.`,
      },
      {
        title: "No application traces",
        markdown: `1. Check the eBPF pods are healthy: \`kubectl get pods -n ${namespace} -l component=ebpf-instrument\`
2. Turn on OBI's debug output to confirm it sees traffic: \`--set ebpf.printTraces=true --set ebpf.logLevel=debug\`, then read \`kubectl logs -n ${namespace} -l component=ebpf-instrument --tail=200\`.
3. If spans show up there but not in OneUptime, check the collector's logs for export errors: \`kubectl logs -n ${namespace} deployment/${release}\``,
      },
    );
  }

  return topics;
}

/**
 * The Kubernetes agent install guide for one platform, filled in with the
 * reader's OneUptime URL and ingestion key.
 */
export function getKubernetesSetupGuide(
  options: KubernetesSetupGuideOptions,
): SetupGuideContent {
  const platform: KubernetesPlatform = options.platform;
  const knownClusterName: string = (options.clusterName || "").trim();
  const clusterName: string =
    knownClusterName || KUBERNETES_EXAMPLE_CLUSTER_NAME;

  return {
    prerequisites: getPrerequisites(platform),
    steps: [
      getConnectStep(platform),
      getInstallStep({
        oneuptimeUrl: options.oneuptimeUrl,
        apiKey: options.apiKey,
        platform: platform,
        clusterName: clusterName,
        isClusterNameKnown: Boolean(knownClusterName),
      }),
      getVerifyStep(platform),
    ],
    advanced: getAdvancedTopics(platform),
    troubleshooting: getTroubleshootingTopics(platform, clusterName),
    links: [
      {
        title: "Kubernetes agent documentation",
        url: "/docs/telemetry/kubernetes-agent",
      },
    ],
  };
}
