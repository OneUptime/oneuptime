import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceShowcase,
  ShowcaseStatus,
} from "../ResourceShowcase/ResourceShowcase";

/*
 * What App Platforms shows - its Overview, All Apps and All Environments -
 * while the project has no environment. Its eyebrow names the product the
 * reader is in: the environments were Cloud's until App Platforms split out
 * of it.
 *
 * It sells what the product shows once telemetry arrives: every app and its
 * deploys, not only the environments they run in. It used to promise "your
 * fleet at a glance" as connected and quiet environments, a strip the
 * Overview no longer draws (#5511's UI review).
 */
const CLOUD_ENVIRONMENT_SHOWCASE: ResourceShowcase = {
  icon: IconProp.Cloud,
  eyebrow: translationKey("App Platforms"),
  title: translationKey("See every app your cloud platforms run"),
  description: translationKey(
    "Point your app's OpenTelemetry at OneUptime with a cloud resource detector. Each app, from ECS to Cloud Run to App Service, shows up with its deploys, instances, logs, traces and metrics.",
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
        "Each app named as your cloud console names it, in an environment for each platform, account and region.",
      ),
    },
    {
      icon: IconProp.ChartBar,
      title: translationKey("How it is doing"),
      description: translationKey(
        "Requests, error rate and p95 latency for each app, CPU and memory for its instances.",
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
      icon: IconProp.RocketLaunch,
      title: translationKey("Deploys and rollbacks"),
      description: translationKey(
        "Every new revision, spotted from your telemetry and marked on the charts.",
      ),
    },
    {
      icon: IconProp.Logs,
      title: translationKey("Logs, traces and metrics"),
      description: translationKey(
        "Everything an app sends, already filtered to it.",
      ),
    },
    {
      icon: IconProp.Layers,
      title: translationKey("Your fleet at a glance"),
      description: translationKey(
        "How many apps run, the deploys of the last day, and how many instances are live.",
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
