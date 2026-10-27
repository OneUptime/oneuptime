import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceShowcase,
  ShowcaseStatus,
} from "../ResourceShowcase/ResourceShowcase";

// What VMware > All vCenters shows while the project has no vCenter.
const VMWARE_VCENTER_SHOWCASE: ResourceShowcase = {
  icon: IconProp.VMware,
  eyebrow: translationKey("VMware monitoring"),
  title: translationKey("See every host, VM and datastore in vSphere"),
  description: translationKey(
    "Connect a vCenter with a read-only account, and a OneUptime probe collects it every two minutes, with no agent to run. The VMware Agent sends the same data if you prefer one.",
  ),
  highlights: [
    translationKey("No agent required"),
    translationKey("Read-only vSphere user"),
    translationKey("Collected every 2 minutes"),
  ],
  features: [
    {
      icon: IconProp.ShieldCheck,
      title: translationKey("Health, with reasons"),
      description: translationKey(
        "Hosts not responding, CPU ready, memory swapping and datastores filling up, named on the overview.",
      ),
    },
    {
      icon: IconProp.Layers,
      title: translationKey("The full inventory"),
      description: translationKey(
        "Hosts, VMs, templates, datastores, clusters and resource pools, each with a page of its own.",
      ),
    },
    {
      icon: IconProp.CPUChip,
      title: translationKey("Contention, VM by VM"),
      description: translationKey(
        "CPU ready, ballooned and swapped memory for every VM, so a noisy neighbor stands out.",
      ),
    },
    {
      icon: IconProp.Disc,
      title: translationKey("Datastore capacity"),
      description: translationKey(
        "The fullest datastore at a glance, with warnings at 80% and 90%.",
      ),
    },
    {
      icon: IconProp.BellRinging,
      title: translationKey("Alerts for vSphere"),
      description: translationKey(
        "Recommended monitors from host saturation to vSAN latency, ready to turn on.",
      ),
    },
    {
      icon: IconProp.Sparkles,
      title: translationKey("AI that can look around"),
      description: translationKey(
        "Ask the AI agent what went wrong. It looks with read-only govc commands, and fixes only what you allow.",
      ),
    },
  ],
  preview: {
    name: "vcenter-prod",
    subtitle: translationKey("2 clusters · 8 ESXi hosts · 156 VMs"),
    stats: [
      { label: translationKey("Hosts"), value: "8/8" },
      { label: translationKey("Host CPU"), value: "41.3%" },
      { label: translationKey("Host memory"), value: "68.9%" },
      { label: translationKey("Fullest datastore"), value: "86.7%" },
    ],
    chart: {
      label: translationKey("Host CPU"),
      values: [
        33, 36, 35, 39, 42, 40, 38, 43, 47, 44, 41, 45, 48, 44, 42, 46, 43, 40,
        42, 44, 41, 41,
      ],
    },
    rows: [
      {
        name: "web-prod-01",
        detail: translationKey("VM · esx-01"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Running"),
      },
      {
        name: "analytics-etl-02",
        detail: translationKey("VM · esx-03 · CPU ready 12.4%"),
        status: ShowcaseStatus.Warning,
        statusText: translationKey("Contention"),
      },
      {
        name: "sql-prod-02",
        detail: translationKey("VM · esx-02"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Running"),
      },
      {
        name: "k8s-worker-03",
        detail: translationKey("VM · esx-04"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Running"),
      },
    ],
    alert: {
      title: translationKey("VM CPU ready contention"),
      description: translationKey(
        "analytics-etl-02 waited for a CPU 12.4% of the time on esx-03.",
      ),
    },
  },
};

export default VMWARE_VCENTER_SHOWCASE;
