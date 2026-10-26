import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceShowcase,
  ShowcaseStatus,
} from "../ResourceShowcase/ResourceShowcase";

// What Cloud > All Environments shows while the project has no environment.
const CLOUD_ENVIRONMENT_SHOWCASE: ResourceShowcase = {
  icon: IconProp.Cloud,
  eyebrow: translationKey("Cloud monitoring"),
  title: translationKey("See every cloud environment your apps run in"),
  description: translationKey(
    "Point your app's OpenTelemetry at OneUptime with a cloud resource detector. Each environment, from ECS to Cloud Run to App Service, shows up with its instances, logs, traces and metrics.",
  ),
  highlights: [
    translationKey("Appears within a minute"),
    translationKey("AWS, Google Cloud and Azure"),
    translationKey("Named for you"),
  ],
  features: [
    {
      icon: IconProp.MagnifyingGlass,
      title: translationKey("Found, not configured"),
      description: translationKey(
        "One environment for each platform, account and region, named after them.",
      ),
    },
    {
      icon: IconProp.ChartBar,
      title: translationKey("How it is doing"),
      description: translationKey(
        "CPU, memory, requests, error rate and p95 latency for the whole environment.",
      ),
    },
    {
      icon: IconProp.Squares,
      title: translationKey("Every instance"),
      description: translationKey(
        "Each task or replica, running or stale, with its own CPU and memory.",
      ),
    },
    {
      icon: IconProp.ArrowTrendingUp,
      title: translationKey("Busiest instances first"),
      description: translationKey(
        "The instances using the most CPU, so a hot one stands out.",
      ),
    },
    {
      icon: IconProp.Logs,
      title: translationKey("Logs, traces and metrics"),
      description: translationKey(
        "Everything an environment sends, already filtered to it.",
      ),
    },
    {
      icon: IconProp.Layers,
      title: translationKey("Your fleet at a glance"),
      description: translationKey(
        "How many environments are connected, how many went quiet, and how many instances are live.",
      ),
    },
  ],
  preview: {
    name: "AWS ECS · us-east-1 · 123456789012",
    subtitle: translationKey("AWS · 12 running tasks"),
    stats: [
      { label: translationKey("CPU"), value: "48%" },
      { label: translationKey("Memory"), value: "6.4 GB" },
      { label: translationKey("Instances"), value: "12" },
      { label: translationKey("Error rate"), value: "0.3%" },
    ],
    chart: {
      label: translationKey("Requests"),
      values: [
        41, 44, 48, 46, 51, 57, 55, 60, 58, 63, 67, 64, 69, 66, 71, 68, 73, 70,
        75, 72, 76, 74,
      ],
    },
    rows: [
      {
        name: "checkout-task-7f3a",
        detail: translationKey("Task · 52% CPU · 512 MB"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Running"),
      },
      {
        name: "checkout-task-1c9e",
        detail: translationKey("Task · last seen 18 minutes ago"),
        status: ShowcaseStatus.Warning,
        statusText: translationKey("Stale"),
      },
      {
        name: "api-task-4b21",
        detail: translationKey("Task · 31% CPU · 380 MB"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Running"),
      },
      {
        name: "worker-task-9d07",
        detail: translationKey("Task · 44% CPU · 610 MB"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Running"),
      },
    ],
  },
};

export default CLOUD_ENVIRONMENT_SHOWCASE;
