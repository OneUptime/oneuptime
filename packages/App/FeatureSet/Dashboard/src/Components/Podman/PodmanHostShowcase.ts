import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceShowcase,
  ShowcaseStatus,
} from "../ResourceShowcase/ResourceShowcase";

// What Podman > All Hosts shows while the project has no Podman host.
const PODMAN_HOST_SHOWCASE: ResourceShowcase = {
  icon: IconProp.Podman,
  eyebrow: translationKey("Podman monitoring"),
  title: translationKey("See every container on every Podman host"),
  description: translationKey(
    "Run the OneUptime agent with one podman run command, rootful or rootless. Every container's CPU, memory, network and logs show up on their own.",
  ),
  highlights: [
    translationKey("One podman run command"),
    translationKey("Rootless works too"),
    translationKey("No changes to your containers"),
  ],
  features: [
    {
      icon: IconProp.Squares,
      title: translationKey("Every container"),
      description: translationKey(
        "CPU, memory, network and image for each container, with a page of its own.",
      ),
    },
    {
      icon: IconProp.ChartBar,
      title: translationKey("The whole host"),
      description: translationKey(
        "Average and peak CPU and memory across containers, and the busiest ones right now.",
      ),
    },
    {
      icon: IconProp.Logs,
      title: translationKey("Container logs"),
      description: translationKey(
        "Every container's logs, searchable, with the severity read from each line.",
      ),
    },
    {
      icon: IconProp.FlowDiagram,
      title: translationKey("Topology"),
      description: translationKey(
        "Containers, images, networks and volumes, and how they connect.",
      ),
    },
    {
      icon: IconProp.BellRinging,
      title: translationKey("Alerts for containers"),
      description: translationKey(
        "Recommended monitors for high CPU and memory, restarts and process count.",
      ),
    },
    {
      icon: IconProp.Sparkles,
      title: translationKey("AI that can look around"),
      description: translationKey(
        "Ask the AI agent what went wrong. It looks with read-only commands, and fixes only what you allow.",
      ),
    },
  ],
  preview: {
    name: "prod-podman-01",
    subtitle: translationKey("14 containers · RHEL 9.4"),
    stats: [
      { label: translationKey("Containers"), value: "14" },
      { label: translationKey("Avg CPU"), value: "12%" },
      { label: translationKey("Avg memory"), value: "47%" },
      { label: translationKey("Processes"), value: "96" },
    ],
    chart: {
      label: translationKey("Average CPU"),
      values: [
        9, 11, 10, 13, 12, 15, 13, 11, 14, 16, 13, 12, 15, 17, 14, 12, 13, 11,
        12, 14, 12, 12,
      ],
    },
    rows: [
      {
        name: "web",
        detail: "nginx:1.27",
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Running"),
      },
      {
        name: "report-builder",
        detail: translationKey("acme/reports:1.8 · 93% memory"),
        status: ShowcaseStatus.Warning,
        statusText: translationKey("High memory"),
      },
      {
        name: "postgres",
        detail: "postgres:16",
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Running"),
      },
      {
        name: "cache",
        detail: "valkey:8",
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Running"),
      },
    ],
    alert: {
      title: translationKey("High container memory usage"),
      description: translationKey(
        "report-builder has used 93% of its memory for 5 minutes.",
      ),
    },
  },
};

export default PODMAN_HOST_SHOWCASE;
