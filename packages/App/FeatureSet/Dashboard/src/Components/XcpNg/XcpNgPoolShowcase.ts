import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceShowcase,
  ShowcaseStatus,
} from "../ResourceShowcase/ResourceShowcase";

/*
 * What XCP-ng > Pools shows while the project has no pool, and what the
 * product's "How it works" explains (ProductOnboardings). One agent next to
 * a Xen Orchestra reads every pool that Xen Orchestra manages, through Xen
 * Orchestra's own OpenMetrics plugin, so the example is one pool of them.
 */
const XCP_NG_POOL_SHOWCASE: ResourceShowcase = {
  icon: IconProp.XcpNg,
  eyebrow: translationKey("XCP-ng monitoring"),
  title: translationKey("See every pool, host and VM in XCP-ng"),
  description: translationKey(
    "Run one agent next to Xen Orchestra and every pool it manages shows up here, with its hosts, VMs and storage repositories. It reads Xen Orchestra's OpenMetrics plugin, so no root password ever reaches OneUptime.",
  ),
  highlights: [
    translationKey("One agent per Xen Orchestra"),
    translationKey("Xen Orchestra's OpenMetrics plugin"),
    translationKey("Nothing to install on your hosts"),
  ],
  features: [
    {
      icon: IconProp.ShieldCheck,
      title: translationKey("Health, with reasons"),
      description: translationKey(
        "Hosts halted or in maintenance, VMs that stopped and pools Xen Orchestra lost, named on the overview.",
      ),
    },
    {
      icon: IconProp.Layers,
      title: translationKey("Every host and VM"),
      description: translationKey(
        "Hosts, VMs and storage repositories, each with a page and metrics of its own. Control domains stay out of the way.",
      ),
    },
    {
      icon: IconProp.Database,
      title: translationKey("Storage repositories filling up"),
      description: translationKey(
        "How full each storage repository is, and what its virtual disks hold, before it runs out.",
      ),
    },
    {
      icon: IconProp.Signal,
      title: translationKey("Throughput you can trust"),
      description: translationKey(
        "Network and disk throughput read as the per-second rates XAPI reports, as Xen Orchestra's own charts draw them.",
      ),
    },
    {
      icon: IconProp.BellRinging,
      title: translationKey("Alerts for XCP-ng"),
      description: translationKey(
        "Recommended monitors for a host offline, a VM that stopped, a storage repository filling up and a pool Xen Orchestra lost.",
      ),
    },
    {
      icon: IconProp.FlowDiagram,
      title: translationKey("The pool as one map"),
      description: translationKey(
        "Topology draws the pool's hosts, the VMs each one runs and the storage repositories they use.",
      ),
    },
  ],
  preview: {
    name: "prod-pool",
    subtitle: translationKey("Xen Orchestra xo-paris · 3 hosts · 42 VMs"),
    stats: [
      {
        label: translationKey("Hosts running"),
        value: { count: 3, outOf: 3 },
      },
      { label: translationKey("VMs running"), value: { count: 40, outOf: 42 } },
      { label: translationKey("CPU"), value: { percent: 38.2 } },
      { label: translationKey("Storage"), value: { percentUsed: 71 } },
    ],
    chart: {
      label: translationKey("Pool CPU"),
      values: [
        31, 33, 32, 36, 35, 38, 41, 39, 37, 40, 43, 41, 38, 36, 39, 42, 40, 37,
        39, 38, 36, 38,
      ],
    },
    rows: [
      {
        name: "web-01",
        detail: translationKey("VM · xcp-host-1"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Running"),
      },
      {
        name: "ci-runner",
        detail: translationKey("VM · xcp-host-2 · stopped after running"),
        status: ShowcaseStatus.Warning,
        statusText: translationKey("Halted"),
      },
      {
        name: "db-01",
        detail: translationKey("VM · xcp-host-3"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Running"),
      },
      {
        name: "backup-proxy",
        detail: translationKey("VM · xcp-host-1"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Running"),
      },
    ],
    alert: {
      title: translationKey("VM stopped"),
      description: translationKey(
        "ci-runner is Halted on xcp-host-2, though it was running this morning.",
      ),
    },
  },
};

export default XCP_NG_POOL_SHOWCASE;
