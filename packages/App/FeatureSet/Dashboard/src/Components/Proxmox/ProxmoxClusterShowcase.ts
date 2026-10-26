import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceShowcase,
  ShowcaseStatus,
} from "../ResourceShowcase/ResourceShowcase";

// What Proxmox > All Clusters shows while the project has no cluster.
const PROXMOX_CLUSTER_SHOWCASE: ResourceShowcase = {
  icon: IconProp.Proxmox,
  eyebrow: translationKey("Proxmox monitoring"),
  title: translationKey("See every node, VM and container in Proxmox"),
  description: translationKey(
    "Run one agent per cluster with a read-only API token, or use Proxmox VE 9's native push. Nodes, guests, storage, backups and replication show up on their own.",
  ),
  highlights: [
    translationKey("One agent per cluster"),
    translationKey("Read-only API token"),
    translationKey("Nothing to install on your nodes"),
  ],
  features: [
    {
      icon: IconProp.ShieldCheck,
      title: translationKey("Health, with reasons"),
      description: translationKey(
        "Healthy, degraded or unhealthy, with a list of exactly what is wrong.",
      ),
    },
    {
      icon: IconProp.Layers,
      title: translationKey("Every node and guest"),
      description: translationKey(
        "Nodes, VMs, LXC containers and storage, each with a page and metrics of its own.",
      ),
    },
    {
      icon: IconProp.Archive,
      title: translationKey("Backup coverage"),
      description: translationKey(
        "The guests that are in no backup job, found before you need one.",
      ),
    },
    {
      icon: IconProp.ArrowPath,
      title: translationKey("Replication and HA"),
      description: translationKey(
        "Last and failed syncs for every replication job, and HA resources in error.",
      ),
    },
    {
      icon: IconProp.BellRinging,
      title: translationKey("Alerts for Proxmox"),
      description: translationKey(
        "Recommended monitors for offline nodes, guests down, quorum at risk and storage filling up.",
      ),
    },
    {
      icon: IconProp.Sparkles,
      title: translationKey("AI that can look around"),
      description: translationKey(
        "Ask the AI agent what went wrong. It looks with read-only API calls, and fixes only what you allow.",
      ),
    },
  ],
  preview: {
    name: "pve-prod",
    subtitle: translationKey("Proxmox VE 8.2.4 · 3 nodes · 44 guests"),
    stats: [
      { label: translationKey("Nodes online"), value: "3/3" },
      { label: translationKey("CPU"), value: "34.6%" },
      { label: translationKey("Memory"), value: "62.1%" },
      { label: translationKey("Backed up"), value: "42/44" },
    ],
    chart: {
      label: translationKey("Cluster CPU"),
      values: [
        28, 30, 29, 33, 31, 35, 38, 36, 34, 37, 40, 38, 35, 33, 36, 39, 37, 34,
        36, 35, 33, 35,
      ],
    },
    rows: [
      {
        name: "web-01",
        detail: translationKey("VM 101 · pve1"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Running"),
      },
      {
        name: "ci-runner",
        detail: translationKey("VM 105 · pve3 · starts on boot"),
        status: ShowcaseStatus.Warning,
        statusText: translationKey("Stopped"),
      },
      {
        name: "db-01",
        detail: translationKey("VM 102 · pve2"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Running"),
      },
      {
        name: "dns",
        detail: translationKey("LXC 201 · pve3"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Running"),
      },
    ],
    alert: {
      title: translationKey("Guest down"),
      description: translationKey(
        "ci-runner (VM 105) stopped on pve3, though it is set to start on boot.",
      ),
    },
  },
};

export default PROXMOX_CLUSTER_SHOWCASE;
