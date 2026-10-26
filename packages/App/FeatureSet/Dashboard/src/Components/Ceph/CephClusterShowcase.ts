import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceShowcase,
  ShowcaseStatus,
} from "../ResourceShowcase/ResourceShowcase";

// What Ceph > All Clusters shows while the project has no cluster.
const CEPH_CLUSTER_SHOWCASE: ResourceShowcase = {
  icon: IconProp.Ceph,
  eyebrow: translationKey("Ceph monitoring"),
  title: translationKey(
    "See your Ceph cluster's health, and when it will fill up",
  ),
  description: translationKey(
    "Enable Ceph's prometheus module and run the agent on a Docker host that can reach your managers. Health checks, OSDs, placement groups and pools show up on their own.",
  ),
  highlights: [
    translationKey("One agent per cluster"),
    translationKey("Uses Ceph's own metrics"),
    translationKey("Data in about a minute"),
  ],
  features: [
    {
      icon: IconProp.ShieldCheck,
      title: translationKey("Health, with reasons"),
      description: translationKey(
        "Ceph's health and every active health check, with its severity.",
      ),
    },
    {
      icon: IconProp.ArrowTrendingUp,
      title: translationKey("When it will fill up"),
      description: translationKey(
        "How long until the cluster is near full, and each pool's days to full, at the current growth.",
      ),
    },
    {
      icon: IconProp.Disc,
      title: translationKey("Every OSD"),
      description: translationKey(
        "Up or down, in or out, with the usage, placement groups and latency of each OSD.",
      ),
    },
    {
      icon: IconProp.Squares,
      title: translationKey("Placement groups and pools"),
      description: translationKey(
        "Degraded and undersized placement groups, and each pool's usage, objects and IOPS.",
      ),
    },
    {
      icon: IconProp.BellRinging,
      title: translationKey("Alerts for Ceph"),
      description: translationKey(
        "Recommended monitors for OSDs down, monitor quorum, near-full pools and slow operations.",
      ),
    },
    {
      icon: IconProp.Sparkles,
      title: translationKey("AI that can look around"),
      description: translationKey(
        "Ask the AI agent what went wrong. It runs ceph commands like health detail and osd tree to find out.",
      ),
    },
  ],
  preview: {
    name: "ceph-prod",
    subtitle: translationKey("Reef 18.2.4 · 12 OSDs · 3 monitors · 8 pools"),
    stats: [
      { label: translationKey("Capacity used"), value: "62.4%" },
      { label: translationKey("OSDs up"), value: "11/12" },
      { label: translationKey("Mons in quorum"), value: "3/3" },
      { label: translationKey("Degraded PGs"), value: "34" },
    ],
    chart: {
      label: translationKey("Capacity used"),
      values: [
        55.2, 55.6, 56.1, 56.4, 56.9, 57.3, 57.6, 58.2, 58.5, 58.9, 59.4, 59.7,
        60.1, 60.4, 60.8, 61.1, 61.3, 61.6, 61.9, 62.0, 62.2, 62.4,
      ],
    },
    rows: [
      {
        name: "osd.0",
        detail: translationKey("node-01 · ssd · 2.1 of 3.8 TB"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Up · In"),
      },
      {
        name: "osd.7",
        detail: translationKey("node-03 · ssd · 2.4 of 3.8 TB"),
        status: ShowcaseStatus.Critical,
        statusText: translationKey("Down · In"),
      },
      {
        name: "osd.1",
        detail: translationKey("node-01 · ssd · 1.9 of 3.8 TB"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Up · In"),
      },
      {
        name: "osd.2",
        detail: translationKey("node-02 · ssd · 2.0 of 3.8 TB"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Up · In"),
      },
    ],
    alert: {
      title: translationKey("OSD down"),
      description: translationKey(
        "osd.7 on node-03 is down, and 34 placement groups are degraded.",
      ),
    },
  },
};

export default CEPH_CLUSTER_SHOWCASE;
