import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceShowcase,
  ShowcaseStatus,
} from "../../ResourceShowcase/ResourceShowcase";
import { PRODUCT_EXAMPLE_DESCRIPTION } from "../ProductOnboarding";

/*
 * How Security Events, Data Security, Insights and Code explain themselves
 * (ProductOnboarding). The example's names and values are drawn as
 * written; its words are translation keys.
 */

export const SECURITY_EVENTS_SHOWCASE: ResourceShowcase = {
  icon: IconProp.ShieldExclamation,
  eyebrow: translationKey("Security Events"),
  title: translationKey("Find threats in the data you already send"),
  description: translationKey(
    "Threats are found in your logs and in the security tools you use, and grouped into cases for your team to investigate.",
  ),
  highlights: [],
  steps: [
    translationKey("Turn on the sources and detections you need"),
    translationKey("Detections check every event as it arrives"),
    translationKey("Investigate the cases they open, and close them"),
  ],
  features: [],
  preview: {
    name: "prod-aws",
    subtitle: translationKey("Security events"),
    badge: translationKey("Live"),
    description: PRODUCT_EXAMPLE_DESCRIPTION,
    stats: [
      { label: translationKey("Events"), value: "48,210" },
      { label: translationKey("Cases"), value: "3" },
      { label: translationKey("Sources"), value: "4" },
      { label: translationKey("Critical"), value: "1" },
    ],
    chart: {
      label: translationKey("Events"),
      values: [310, 290, 330, 300, 320, 860, 410, 330, 300, 310, 320, 305],
      range: translationKey("Last 24 hours"),
    },
    rows: [
      {
        name: "CASE-12",
        detail: translationKey("Sign-in from a new country"),
        status: ShowcaseStatus.Critical,
        statusText: translationKey("Critical"),
      },
      {
        name: "CASE-11",
        detail: translationKey("Root account used"),
        status: ShowcaseStatus.Warning,
        statusText: translationKey("High"),
      },
      {
        name: "CASE-10",
        detail: translationKey("Storage bucket made public"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Resolved"),
      },
    ],
  },
};

export const DATA_SECURITY_SHOWCASE: ResourceShowcase = {
  icon: IconProp.ShieldCheck,
  eyebrow: translationKey("Data Security"),
  title: translationKey("Know where your sensitive data is"),
  description: translationKey(
    "Connect a database and its columns are scanned for sensitive data, such as email addresses and card numbers. See where it is and what to fix.",
  ),
  highlights: [],
  steps: [
    translationKey("Connect a database"),
    translationKey("Columns that hold sensitive data are found and labeled"),
    translationKey("Fix the issues it finds"),
  ],
  features: [],
  preview: {
    name: "customers-db",
    subtitle: translationKey("PostgreSQL"),
    badge: translationKey("Connected"),
    description: PRODUCT_EXAMPLE_DESCRIPTION,
    stats: [
      { label: translationKey("Tables"), value: "212" },
      { label: translationKey("Columns"), value: "1,846" },
      { label: translationKey("Data types"), value: "9" },
      { label: translationKey("Issues"), value: "4" },
    ],
    chart: {
      label: translationKey("Issues"),
      values: [9, 9, 8, 8, 7, 7, 6, 6, 5, 5, 4, 4],
      range: translationKey("Last 30 days"),
    },
    rows: [
      {
        name: "users.email",
        detail: translationKey("Email address"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Encrypted"),
      },
      {
        name: "payments.card_number",
        detail: translationKey("Card number"),
        status: ShowcaseStatus.Critical,
        statusText: translationKey("Not encrypted"),
      },
      {
        name: "settings.api_key",
        detail: translationKey("Secret"),
        status: ShowcaseStatus.Warning,
        statusText: translationKey("Review"),
      },
    ],
  },
};

export const AI_INSIGHTS_SHOWCASE: ResourceShowcase = {
  icon: IconProp.LightBulb,
  eyebrow: translationKey("Insights"),
  title: translationKey("Problems found for you, before they page anyone"),
  description: translationKey(
    "OneUptime AI watches this project's telemetry and files a quiet insight when something looks off. It never pages anyone.",
  ),
  highlights: [],
  steps: [
    translationKey("Send telemetry or connect your infrastructure"),
    translationKey("AI reads it and files an insight when something looks off"),
    translationKey("Open an insight to see what changed and what to do"),
  ],
  features: [],
  preview: {
    name: "checkout-api",
    subtitle: translationKey("Service"),
    badge: translationKey("New"),
    description: PRODUCT_EXAMPLE_DESCRIPTION,
    stats: [
      { label: translationKey("Insights"), value: "5" },
      { label: translationKey("Services"), value: "12" },
      { label: translationKey("Hosts"), value: "8" },
      { label: translationKey("Resolved"), value: "17" },
    ],
    chart: {
      label: translationKey("Latency"),
      values: [180, 182, 179, 185, 190, 205, 230, 262, 290, 320, 340, 352],
      range: translationKey("Last 7 days"),
    },
    rows: [
      {
        name: "checkout-api",
        detail: translationKey("Latency is climbing since the last deploy"),
        status: ShowcaseStatus.Warning,
        statusText: translationKey("New"),
      },
      {
        name: "orders-db",
        detail: translationKey("Disk will be full in about 6 days"),
        status: ShowcaseStatus.Critical,
        statusText: translationKey("New"),
      },
      {
        name: "web",
        detail: translationKey("Error rate is back to normal"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Resolved"),
      },
    ],
  },
};

export const CODE_SHOWCASE: ResourceShowcase = {
  icon: IconProp.Code,
  eyebrow: translationKey("Code"),
  title: translationKey("Ask AI to work in your code"),
  description: translationKey(
    "Connect GitHub and ask OneUptime AI to work in your repositories: fix a bug, write tests, explain the code. It opens a pull request for you to review.",
  ),
  highlights: [],
  steps: [
    translationKey("Connect GitHub"),
    translationKey("Pick a repository and say what to do"),
    translationKey("Review the pull request it opens"),
  ],
  features: [],
  preview: {
    name: "example/shop",
    subtitle: translationKey("Repository"),
    badge: translationKey("Connected"),
    description: PRODUCT_EXAMPLE_DESCRIPTION,
    stats: [
      { label: translationKey("Tasks"), value: "12" },
      { label: translationKey("Pull requests"), value: "9" },
      { label: translationKey("Merged"), value: "7" },
      { label: translationKey("Open"), value: "2" },
    ],
    chart: {
      label: translationKey("Tasks"),
      values: [0, 1, 0, 2, 1, 1, 3, 2, 1, 2, 3, 2],
      range: translationKey("Last 30 days"),
    },
    rows: [
      {
        name: "#231",
        detail: translationKey("Fix the flaky checkout test"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Merged"),
      },
      {
        name: "#232",
        detail: translationKey("Retry failed payment calls"),
        status: ShowcaseStatus.Warning,
        statusText: translationKey("Open"),
      },
      {
        name: "#233",
        detail: translationKey("Explain the cache layer"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Completed"),
      },
    ],
  },
};
