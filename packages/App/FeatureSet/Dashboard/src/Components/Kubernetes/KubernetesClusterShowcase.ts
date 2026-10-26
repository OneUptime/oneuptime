import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceShowcase,
  ShowcaseStatus,
} from "../ResourceShowcase/ResourceShowcase";

// What Kubernetes > All Clusters shows while the project has no cluster.
const KUBERNETES_CLUSTER_SHOWCASE: ResourceShowcase = {
  icon: IconProp.Kubernetes,
  eyebrow: translationKey("Kubernetes monitoring"),
  title: translationKey("See every cluster, node and pod in one place"),
  description: translationKey(
    "Install the OneUptime agent with one Helm command. Every workload, metric, event and log shows up on its own, with traces that need no code changes.",
  ),
  highlights: [
    translationKey("One Helm command"),
    translationKey("Data within a minute or two"),
    translationKey("EKS, GKE, AKS and more"),
  ],
  features: [
    {
      icon: IconProp.Layers,
      title: translationKey("Every workload, mapped"),
      description: translationKey(
        "Namespaces, pods, deployments, StatefulSets, DaemonSets, jobs and nodes, each with a page of its own.",
      ),
    },
    {
      icon: IconProp.ChartBar,
      title: translationKey("Health at a glance"),
      description: translationKey(
        "Availability, CPU, memory and filesystem for the cluster, and why it is degraded when it is.",
      ),
    },
    {
      icon: IconProp.Logs,
      title: translationKey("Events and logs"),
      description: translationKey(
        "Warnings first, like OOM kills and crash loops, next to the pod logs that explain them.",
      ),
    },
    {
      icon: IconProp.Waterfall,
      title: translationKey("Traces without code changes"),
      description: translationKey(
        "eBPF traces of the requests between your services, on by default.",
      ),
    },
    {
      icon: IconProp.BellRinging,
      title: translationKey("Alerts that matter"),
      description: translationKey(
        "Recommended monitors for crash loops, pods stuck in Pending, nodes not ready and failing jobs.",
      ),
    },
    {
      icon: IconProp.CurrencyDollar,
      title: translationKey("Costs and right-sizing"),
      description: translationKey(
        "What each namespace and workload costs, how much sits idle, and what you could save.",
      ),
    },
  ],
  preview: {
    name: "prod-eu-west",
    subtitle: translationKey("12 nodes · 248 pods · 9 namespaces"),
    stats: [
      { label: translationKey("Availability"), value: "99.98%" },
      { label: translationKey("CPU"), value: "63%" },
      { label: translationKey("Memory"), value: "312 GB" },
      { label: translationKey("Filesystem"), value: "41%" },
    ],
    chart: {
      label: translationKey("Cluster CPU"),
      values: [
        38, 42, 40, 47, 52, 49, 55, 61, 58, 63, 60, 66, 62, 58, 64, 70, 67, 63,
        65, 61, 66, 63,
      ],
    },
    rows: [
      {
        name: "checkout-api-7d4f9",
        detail: translationKey("Pod · production"),
        status: ShowcaseStatus.Healthy,
        statusText: "Running",
      },
      {
        name: "orders-sync-6f7c9",
        detail: translationKey("Pod · production · 14 restarts"),
        status: ShowcaseStatus.Critical,
        statusText: "CrashLoopBackOff",
      },
      {
        name: "redis-0",
        detail: translationKey("Pod · data"),
        status: ShowcaseStatus.Healthy,
        statusText: "Running",
      },
      {
        name: "payments-worker-5c8d7",
        detail: translationKey("Pod · production"),
        status: ShowcaseStatus.Healthy,
        statusText: "Running",
      },
    ],
    alert: {
      title: translationKey("CrashLoopBackOff detected"),
      description: translationKey(
        "orders-sync has restarted 14 times. The on-call engineer was paged.",
      ),
    },
  },
};

export default KUBERNETES_CLUSTER_SHOWCASE;
