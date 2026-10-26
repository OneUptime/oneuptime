import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceShowcase,
  ShowcaseStatus,
} from "../ResourceShowcase/ResourceShowcase";

// What Docker > All Hosts shows while the project has no Docker host.
const DOCKER_HOST_SHOWCASE: ResourceShowcase = {
  icon: IconProp.Docker,
  eyebrow: translationKey("Docker monitoring"),
  title: translationKey("See every container on every Docker host"),
  description: translationKey(
    "Run the OneUptime agent with one docker run command. Every container's CPU, memory, network and logs show up on their own, and you hear about restart loops before your users do.",
  ),
  highlights: [
    translationKey("One docker run command"),
    translationKey("Data in about a minute"),
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
        "Compose projects, containers, images, networks and volumes, and how they connect.",
      ),
    },
    {
      icon: IconProp.BellRinging,
      title: translationKey("Alerts for containers"),
      description: translationKey(
        "Recommended monitors for restart loops, CPU throttling, high memory and containers that stop.",
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
    name: "prod-docker-01",
    subtitle: translationKey("23 containers · Ubuntu 24.04"),
    stats: [
      { label: translationKey("Containers"), value: "23" },
      { label: translationKey("Avg CPU"), value: "18%" },
      { label: translationKey("Avg memory"), value: "41%" },
      { label: translationKey("Processes"), value: "186" },
    ],
    chart: {
      label: translationKey("Average CPU"),
      values: [
        14, 16, 15, 19, 17, 21, 18, 16, 20, 23, 19, 17, 22, 26, 21, 18, 20, 17,
        19, 21, 18, 18,
      ],
    },
    rows: [
      {
        name: "api-gateway",
        detail: "nginx:1.27-alpine",
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Running"),
      },
      {
        name: "worker-queue",
        detail: translationKey("acme/worker:2.3.1 · 5 restarts"),
        status: ShowcaseStatus.Critical,
        statusText: translationKey("Restarting"),
      },
      {
        name: "postgres-primary",
        detail: "postgres:16",
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Running"),
      },
      {
        name: "redis-cache",
        detail: "redis:7.4",
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Running"),
      },
    ],
    alert: {
      title: translationKey("Container restart loop"),
      description: translationKey(
        "worker-queue restarted 5 times in 15 minutes.",
      ),
    },
  },
};

export default DOCKER_HOST_SHOWCASE;
