import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceShowcase,
  ShowcaseStatus,
} from "../ResourceShowcase/ResourceShowcase";

// What Docker Swarm > All Clusters shows while the project has no cluster.
const DOCKER_SWARM_CLUSTER_SHOWCASE: ResourceShowcase = {
  icon: IconProp.DockerSwarm,
  eyebrow: translationKey("Docker Swarm monitoring"),
  title: translationKey("See every node, service and task in your swarm"),
  description: translationKey(
    "Install the agent on one manager node. Nodes, services, tasks and stacks show up on their own, and you see the moment a service runs short of replicas.",
  ),
  highlights: [
    translationKey("Installed on one manager"),
    translationKey("Inventory within 5 minutes"),
    translationKey("No changes to your services"),
  ],
  features: [
    {
      icon: IconProp.Layers,
      title: translationKey("The whole swarm"),
      description: translationKey(
        "Nodes, services, tasks, stacks, networks, volumes, secrets and configs, kept up to date.",
      ),
    },
    {
      icon: IconProp.CheckCircle,
      title: translationKey("Replicas, converged"),
      description: translationKey(
        "Running against desired replicas for every service, grouped by stack.",
      ),
    },
    {
      icon: IconProp.ShieldCheck,
      title: translationKey("Health at a glance"),
      description: translationKey(
        "Healthy, degraded or unhealthy, with every failing node, service and task named.",
      ),
    },
    {
      icon: IconProp.ChartBar,
      title: translationKey("Task resources"),
      description: translationKey(
        "CPU and memory for every task, on every node.",
      ),
    },
    {
      icon: IconProp.Logs,
      title: translationKey("Logs and metrics"),
      description: translationKey(
        "Container logs and every metric the agent collects, ready to search and chart.",
      ),
    },
    {
      icon: IconProp.BellRinging,
      title: translationKey("Alerts for tasks"),
      description: translationKey(
        "Recommended monitors for tasks that go down or use too much CPU or memory.",
      ),
    },
  ],
  preview: {
    name: "swarm-prod-01",
    subtitle: translationKey("3 managers · 2 workers · Docker 27.3.1"),
    stats: [
      { label: translationKey("Nodes ready"), value: "5/5" },
      { label: translationKey("Services"), value: "13/14" },
      { label: translationKey("Tasks running"), value: "41/42" },
      { label: translationKey("Stacks"), value: "4" },
    ],
    chart: {
      label: translationKey("Cluster CPU"),
      values: [
        24, 27, 25, 29, 33, 31, 28, 34, 38, 35, 32, 36, 39, 35, 33, 37, 41, 38,
        34, 36, 33, 35,
      ],
    },
    rows: [
      {
        name: "shop_web",
        detail: translationKey("Replicated · 4 of 4 running"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Converged"),
      },
      {
        name: "billing_worker",
        detail: translationKey("Replicated · 2 of 3 running"),
        status: ShowcaseStatus.Warning,
        statusText: translationKey("Degraded"),
      },
      {
        name: "shop_api",
        detail: translationKey("Replicated · 6 of 6 running"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Converged"),
      },
      {
        name: "monitoring_node-exporter",
        detail: translationKey("Global · 5 of 5 running"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Converged"),
      },
    ],
    alert: {
      title: translationKey("Task down"),
      description: translationKey(
        "A billing_worker task stopped running on worker-2.",
      ),
    },
  },
};

export default DOCKER_SWARM_CLUSTER_SHOWCASE;
