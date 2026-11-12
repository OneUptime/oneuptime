import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceShowcase,
  ShowcaseStatus,
} from "../../ResourceShowcase/ResourceShowcase";
import { PRODUCT_EXAMPLE_DESCRIPTION } from "../ProductOnboarding";

/*
 * How the Essentials explain themselves (ProductOnboarding): Monitors,
 * Incidents, Alerts, On-Call, Status Pages, Scheduled Maintenance and SLOs.
 * The example's names and values are drawn as written; its words are
 * translation keys.
 */

export const MONITORS_SHOWCASE: ResourceShowcase = {
  icon: IconProp.AltGlobe,
  eyebrow: translationKey("Monitors"),
  title: translationKey("Know something is down before your users do"),
  description: translationKey(
    "Monitors check your websites, APIs, servers and other resources on a schedule, and can open an incident or alert when a check fails.",
  ),
  highlights: [],
  steps: [
    translationKey("Create a monitor"),
    translationKey("Choose what it checks and how often"),
    translationKey("Get an incident or an alert when a check fails"),
  ],
  features: [],
  preview: {
    name: "shop.example.com",
    subtitle: translationKey("Website"),
    badge: translationKey("Operational"),
    description: PRODUCT_EXAMPLE_DESCRIPTION,
    stats: [
      { label: translationKey("Availability"), value: { percent: 99.98 } },
      { label: translationKey("Response time"), value: { milliseconds: 182 } },
      { label: translationKey("Status Code"), value: "200" },
      { label: translationKey("Probes"), value: 3 },
    ],
    chart: {
      label: translationKey("Response time"),
      values: [180, 176, 190, 184, 178, 240, 196, 182, 179, 188, 181, 183],
    },
    rows: [
      {
        name: "api.example.com",
        detail: translationKey("API"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Operational"),
      },
      {
        name: "db.example.com:5432",
        detail: translationKey("Port"),
        status: ShowcaseStatus.Warning,
        statusText: translationKey("Degraded"),
      },
      {
        name: "checkout.example.com",
        detail: translationKey("Website"),
        status: ShowcaseStatus.Critical,
        statusText: translationKey("Offline"),
      },
    ],
    alert: {
      title: translationKey("Incident created"),
      description: translationKey(
        "checkout.example.com is offline. The on-call engineer was paged.",
      ),
    },
  },
};

export const INCIDENTS_SHOWCASE: ResourceShowcase = {
  icon: IconProp.Alert,
  eyebrow: translationKey("Incidents"),
  title: translationKey("Run every outage from one place"),
  description: translationKey(
    "An incident is a problem that affects your users, like an outage or a slowdown. Declare one to page on-call, track the fix and update your status page.",
  ),
  highlights: [],
  steps: [
    translationKey("Declare an incident, or let a monitor open one"),
    translationKey("Page on-call and post updates as you work"),
    translationKey("Resolve it and write the postmortem"),
  ],
  features: [],
  preview: {
    name: "INC-42",
    subtitle: translationKey("Checkout is slow"),
    badge: translationKey("Resolved"),
    description: PRODUCT_EXAMPLE_DESCRIPTION,
    stats: [
      { label: translationKey("Severity"), value: "SEV 1" },
      { label: translationKey("Duration"), value: { clock: "00:21:07" } },
      { label: translationKey("Monitors"), value: 2 },
      { label: translationKey("Subscribers"), value: 1284 },
    ],
    chart: {
      label: translationKey("Error rate"),
      values: [1, 1, 2, 1, 9, 22, 26, 24, 12, 3, 1, 1],
    },
    rows: [
      {
        name: "09:41",
        detail: translationKey("Opened by a monitor"),
        status: ShowcaseStatus.Critical,
        statusText: translationKey("Identified"),
      },
      {
        name: "09:43",
        detail: translationKey("On-call engineer paged"),
        status: ShowcaseStatus.Warning,
        statusText: translationKey("Acknowledged"),
      },
      {
        name: "10:02",
        detail: translationKey("Fix deployed"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Resolved"),
      },
    ],
  },
};

export const ALERTS_SHOWCASE: ResourceShowcase = {
  icon: IconProp.ExclaimationCircle,
  eyebrow: translationKey("Alerts"),
  title: translationKey("Catch problems before your users notice"),
  description: translationKey(
    "Alerts flag problems for your team to look into before users are affected. Unlike incidents, they never appear on status pages.",
  ),
  highlights: [],
  steps: [
    translationKey("Let a monitor raise an alert, or create one"),
    translationKey("Your on-call policy notifies the right person"),
    translationKey("Acknowledge it, fix it and resolve it"),
  ],
  features: [],
  preview: {
    name: "ALT-118",
    subtitle: translationKey("Disk almost full"),
    badge: translationKey("Acknowledged"),
    // Amber, as its row below draws it: acknowledged, not yet resolved.
    badgeStatus: ShowcaseStatus.Warning,
    description: PRODUCT_EXAMPLE_DESCRIPTION,
    stats: [
      { label: translationKey("Severity"), value: "P2" },
      { label: translationKey("Disk usage"), value: { percent: 91 } },
      { label: translationKey("Monitors"), value: 1 },
      { label: translationKey("Open alerts"), value: 3 },
    ],
    chart: {
      label: translationKey("Disk usage"),
      values: [62, 64, 66, 69, 71, 74, 78, 81, 84, 87, 89, 91],
      range: translationKey("Last 24 hours"),
    },
    rows: [
      {
        name: "ALT-118",
        detail: translationKey("Disk almost full"),
        status: ShowcaseStatus.Warning,
        statusText: translationKey("Acknowledged"),
      },
      {
        name: "ALT-117",
        detail: translationKey("High memory usage"),
        status: ShowcaseStatus.Critical,
        statusText: translationKey("Created"),
      },
      {
        name: "ALT-116",
        /*
         * Not "Certificate expires soon": the SSL monitor's documentation
         * leads a paragraph with that, in its own words in each language.
         */
        detail: translationKey("Certificate expiring soon"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Resolved"),
      },
    ],
  },
};

export const ON_CALL_SHOWCASE: ResourceShowcase = {
  icon: IconProp.Call,
  eyebrow: translationKey("On-Call"),
  title: translationKey("The right person hears about it, every time"),
  description: translationKey(
    "On-call policies decide who is notified when an incident or alert opens, and who is next if nobody acknowledges it.",
  ),
  highlights: [],
  steps: [
    translationKey("Create an on-call policy"),
    translationKey("Add schedules or people to each escalation rule"),
    translationKey("Connect it to monitors, incidents and alerts"),
  ],
  features: [],
  preview: {
    name: "payments-primary",
    subtitle: translationKey("Escalation rules"),
    badge: translationKey("Active"),
    description: PRODUCT_EXAMPLE_DESCRIPTION,
    stats: [
      { label: translationKey("Rules"), value: 3 },
      { label: translationKey("Schedules"), value: 2 },
      { label: translationKey("Users"), value: 8 },
      { label: translationKey("Teams"), value: 2 },
    ],
    chart: {
      label: translationKey("Pages sent"),
      values: [2, 1, 3, 0, 1, 4, 2, 1, 0, 2, 5, 1],
      range: translationKey("Last 7 days"),
    },
    rows: [
      {
        name: "1",
        detail: translationKey("Primary on-call, by SMS and call"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Acknowledged"),
      },
      {
        name: "2",
        detail: translationKey("Secondary on-call, after 10 minutes"),
        status: ShowcaseStatus.Warning,
        statusText: translationKey("Waiting"),
      },
      {
        name: "3",
        detail: translationKey("Engineering manager, after 20 minutes"),
        status: ShowcaseStatus.Warning,
        statusText: translationKey("Waiting"),
      },
    ],
  },
};

export const STATUS_PAGES_SHOWCASE: ResourceShowcase = {
  icon: IconProp.CheckCircle,
  eyebrow: translationKey("Status Pages"),
  title: translationKey("Tell your customers what is going on"),
  description: translationKey(
    "Status pages show your customers what is working and what is not — live monitor status, incidents and scheduled maintenance, on a page you can make public or private.",
  ),
  highlights: [],
  steps: [
    translationKey("Create a status page"),
    translationKey("Add the monitors your customers care about"),
    translationKey("Share its link, or put it on your own domain"),
  ],
  features: [],
  preview: {
    name: "status.example.com",
    subtitle: translationKey("Public status page"),
    badge: translationKey("Operational"),
    description: PRODUCT_EXAMPLE_DESCRIPTION,
    stats: [
      { label: translationKey("Availability"), value: { percent: 99.95 } },
      { label: translationKey("Components"), value: 6 },
      { label: translationKey("Subscribers"), value: 1284 },
      { label: translationKey("Incidents"), value: 1 },
    ],
    chart: {
      label: translationKey("Availability"),
      values: [100, 100, 100, 99.9, 100, 100, 98.7, 100, 100, 100, 100, 100],
      range: translationKey("Last 90 days"),
    },
    rows: [
      {
        name: "app.example.com",
        detail: translationKey("Component"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Operational"),
      },
      {
        name: "api.example.com",
        detail: translationKey("Component"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Operational"),
      },
      {
        name: "pay.example.com",
        detail: translationKey("Component"),
        status: ShowcaseStatus.Warning,
        statusText: translationKey("Degraded"),
      },
    ],
  },
};

export const SCHEDULED_MAINTENANCE_SHOWCASE: ResourceShowcase = {
  icon: IconProp.Clock,
  eyebrow: translationKey("Scheduled Maintenance"),
  title: translationKey("Announce planned work before it starts"),
  description: translationKey(
    "Plan maintenance ahead of time. Subscribers are told before it starts, and your status pages show it while it runs.",
  ),
  highlights: [],
  steps: [
    translationKey("Schedule a maintenance event"),
    translationKey("Pick the monitors and status pages it affects"),
    translationKey("Subscribers are told before, during and after"),
  ],
  features: [],
  preview: {
    name: "orders-db-upgrade",
    subtitle: translationKey("Sunday, 02:00 to 04:00"),
    badge: translationKey("Scheduled"),
    description: PRODUCT_EXAMPLE_DESCRIPTION,
    stats: [
      { label: translationKey("Monitors"), value: 4 },
      { label: translationKey("Status Pages"), value: 2 },
      { label: translationKey("Subscribers"), value: 1284 },
      { label: translationKey("Duration"), value: { clock: "02:00:00" } },
    ],
    chart: {
      label: translationKey("Requests"),
      values: [42, 40, 38, 30, 12, 4, 3, 5, 18, 34, 40, 41],
      range: translationKey("Last 24 hours"),
    },
    rows: [
      {
        name: "01:00",
        detail: translationKey("Subscribers notified"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Scheduled"),
      },
      {
        name: "02:00",
        detail: translationKey("Maintenance started"),
        status: ShowcaseStatus.Warning,
        statusText: translationKey("Ongoing"),
      },
      {
        name: "03:40",
        detail: translationKey("Maintenance finished"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Completed"),
      },
    ],
  },
};

export const SLOS_SHOWCASE: ResourceShowcase = {
  icon: IconProp.Gauge,
  eyebrow: translationKey("SLOs"),
  title: translationKey("Know how much downtime you have left"),
  description: translationKey(
    "Reliability targets measured from monitor uptime. Each SLO tracks its error budget and alerts you before the budget runs out.",
  ),
  highlights: [],
  steps: [
    translationKey("Create an SLO"),
    translationKey("Pick its monitors and a target, such as 99.9%"),
    translationKey("Get an alert before the error budget runs out"),
  ],
  features: [],
  preview: {
    name: "checkout-availability",
    subtitle: translationKey("Target 99.9% over 30 days"),
    badge: translationKey("Healthy"),
    description: PRODUCT_EXAMPLE_DESCRIPTION,
    stats: [
      { label: translationKey("Target"), value: { percent: 99.9 } },
      { label: translationKey("Current"), value: { percent: 99.96 } },
      { label: translationKey("Error budget"), value: { percent: 61 } },
      { label: translationKey("Burn rate"), value: { burnRate: 0.4 } },
    ],
    chart: {
      label: translationKey("Error budget"),
      values: [100, 98, 96, 95, 90, 84, 80, 76, 72, 68, 64, 61],
      range: translationKey("Last 30 days"),
    },
    rows: [
      {
        name: "checkout-availability",
        detail: translationKey("Error budget"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Healthy"),
      },
      {
        name: "api-availability",
        detail: translationKey("Error budget"),
        status: ShowcaseStatus.Warning,
        statusText: translationKey("At risk"),
      },
      {
        name: "login-availability",
        detail: translationKey("Error budget"),
        status: ShowcaseStatus.Critical,
        statusText: translationKey("Exhausted"),
      },
    ],
  },
};
