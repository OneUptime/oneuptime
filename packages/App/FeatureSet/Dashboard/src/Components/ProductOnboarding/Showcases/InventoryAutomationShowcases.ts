import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceShowcase,
  ShowcaseStatus,
} from "../../ResourceShowcase/ResourceShowcase";
import { PRODUCT_EXAMPLE_DESCRIPTION } from "../ProductOnboarding";

/*
 * How Inventory, Network, Dashboards, Workflows, Runbooks and Forms
 * explain themselves (ProductOnboarding). The example's names and values
 * are drawn as written; its words are translation keys.
 */

export const INVENTORY_SHOWCASE: ResourceShowcase = {
  icon: IconProp.Cube,
  eyebrow: translationKey("Inventory"),
  title: translationKey("Everything you run, in one list"),
  description: translationKey(
    "Send OpenTelemetry data or connect infrastructure, and what OneUptime finds shows up here. You can also add things by hand.",
  ),
  highlights: [],
  steps: [
    translationKey("Send telemetry or connect your infrastructure"),
    translationKey("What is found is listed on its own"),
    translationKey("Add owners, labels and your own fields"),
  ],
  features: [],
  preview: {
    name: "prod",
    subtitle: translationKey("Inventory"),
    badge: translationKey("Live"),
    description: PRODUCT_EXAMPLE_DESCRIPTION,
    stats: [
      { label: translationKey("Hosts"), value: 42 },
      { label: translationKey("Services"), value: 18 },
      { label: translationKey("Databases"), value: 6 },
      { label: translationKey("Devices"), value: 120 },
    ],
    chart: {
      label: translationKey("Assets"),
      values: [140, 144, 150, 152, 158, 160, 168, 172, 176, 180, 184, 186],
      range: translationKey("Last 30 days"),
    },
    rows: [
      {
        name: "web-01",
        detail: translationKey("Host"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Online"),
      },
      {
        name: "orders-db",
        detail: translationKey("Database"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Online"),
      },
      {
        name: "core-sw-02",
        detail: translationKey("Network device"),
        status: ShowcaseStatus.Warning,
        statusText: translationKey("Degraded"),
      },
    ],
  },
};

export const NETWORK_SHOWCASE: ResourceShowcase = {
  icon: IconProp.Signal,
  eyebrow: translationKey("Network"),
  title: translationKey("Watch every switch, router and access point"),
  description: translationKey(
    "A probe inside your network reads your devices over SNMP: their interfaces, traffic, errors and health, grouped by site.",
  ),
  highlights: [],
  steps: [
    translationKey("Add a site and a probe inside your network"),
    translationKey("Add devices, or let a scan find them"),
    translationKey("Get an alert when a device or a link goes down"),
  ],
  features: [],
  preview: {
    name: "core-sw-01",
    subtitle: translationKey("Switch"),
    badge: translationKey("Up"),
    description: PRODUCT_EXAMPLE_DESCRIPTION,
    stats: [
      { label: translationKey("Interfaces"), value: 48 },
      { label: translationKey("Traffic"), value: { gigabitsPerSecond: 1.2 } },
      { label: translationKey("Errors"), value: 0 },
      { label: translationKey("CPU"), value: { percent: 12 } },
    ],
    chart: {
      label: translationKey("Traffic"),
      values: [0.6, 0.7, 0.8, 0.9, 1.1, 1.2, 1.3, 1.2, 1.1, 1.2, 1.3, 1.2],
    },
    rows: [
      {
        name: "core-sw-01",
        detail: translationKey("Switch"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Up"),
      },
      {
        name: "edge-rtr-01",
        detail: translationKey("Router"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Up"),
      },
      {
        name: "ap-floor-3",
        detail: translationKey("Access point"),
        status: ShowcaseStatus.Critical,
        statusText: translationKey("Down"),
      },
    ],
  },
};

export const DASHBOARDS_SHOWCASE: ResourceShowcase = {
  icon: IconProp.ChartPie,
  eyebrow: translationKey("Dashboards"),
  title: translationKey("Build the views your team checks every day"),
  description: translationKey(
    "Your own views of metrics, logs, traces, monitors and incidents, arranged the way your team wants them. Start from a template or an empty dashboard.",
  ),
  highlights: [],
  steps: [
    translationKey("Create a dashboard"),
    translationKey("Add charts, values, tables and logs"),
    translationKey("Share it, or show it on a screen"),
  ],
  features: [],
  preview: {
    name: "checkout-overview",
    subtitle: translationKey("Dashboard"),
    badge: translationKey("Live"),
    description: PRODUCT_EXAMPLE_DESCRIPTION,
    stats: [
      { label: translationKey("Requests"), value: 1920 },
      { label: translationKey("Error rate"), value: { percent: 0.4 } },
      { label: translationKey("Latency"), value: { milliseconds: 184 } },
      { label: translationKey("Availability"), value: { percent: 99.98 } },
    ],
    chart: {
      label: translationKey("Requests"),
      values: [120, 132, 128, 140, 152, 148, 160, 158, 150, 162, 170, 166],
    },
    rows: [
      {
        name: "api.example.com",
        detail: translationKey("Monitor"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Operational"),
      },
      {
        name: "checkout-api",
        detail: translationKey("Service"),
        status: ShowcaseStatus.Warning,
        statusText: translationKey("Degraded"),
      },
      {
        name: "INC-42",
        detail: translationKey("Incident"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Resolved"),
      },
    ],
  },
};

export const WORKFLOWS_SHOWCASE: ResourceShowcase = {
  icon: IconProp.FlowDiagram,
  eyebrow: translationKey("Workflows"),
  title: translationKey("Automate what happens next"),
  description: translationKey(
    "No-code automations that run when something happens, such as posting to Slack when an incident is created. Start from a template or build your own.",
  ),
  highlights: [],
  steps: [
    translationKey("Create a workflow"),
    translationKey("Pick what starts it, such as a new incident"),
    translationKey("Add steps, such as a Slack message or an API call"),
  ],
  features: [],
  preview: {
    name: "incident-to-slack",
    subtitle: translationKey("Workflow"),
    badge: translationKey("Enabled"),
    description: PRODUCT_EXAMPLE_DESCRIPTION,
    stats: [
      { label: translationKey("Runs"), value: 214 },
      { label: translationKey("Succeeded"), value: 211 },
      { label: translationKey("Failed"), value: 3 },
      { label: translationKey("Steps"), value: 4 },
    ],
    chart: {
      label: translationKey("Runs"),
      values: [24, 30, 28, 35, 31, 29, 33, 36, 30, 34, 38, 32],
      range: translationKey("Last 7 days"),
    },
    rows: [
      {
        name: "#214",
        detail: translationKey("Incident created"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Success"),
      },
      {
        name: "#213",
        detail: translationKey("Incident created"),
        status: ShowcaseStatus.Warning,
        statusText: translationKey("Running"),
      },
      {
        name: "#212",
        detail: translationKey("Incident created"),
        status: ShowcaseStatus.Critical,
        statusText: translationKey("Failed"),
      },
    ],
  },
};

export const RUNBOOKS_SHOWCASE: ResourceShowcase = {
  icon: IconProp.BookOpen,
  eyebrow: translationKey("Runbooks"),
  title: translationKey("Write down how you fix things, once"),
  description: translationKey(
    "Reusable response procedures: ordered checklists of manual or automated steps.",
  ),
  highlights: [],
  steps: [
    translationKey("Create a runbook"),
    translationKey("Add manual and automated steps"),
    translationKey("Run it from an incident, or let a trigger start it"),
  ],
  features: [],
  preview: {
    name: "restart-checkout",
    subtitle: translationKey("Runbook"),
    badge: translationKey("Enabled"),
    description: PRODUCT_EXAMPLE_DESCRIPTION,
    stats: [
      { label: translationKey("Steps"), value: 4 },
      { label: translationKey("Executions"), value: 38 },
      { label: translationKey("Succeeded"), value: 36 },
      { label: translationKey("Failed"), value: 2 },
    ],
    chart: {
      label: translationKey("Executions"),
      values: [2, 3, 1, 4, 2, 3, 5, 2, 3, 4, 3, 6],
      range: translationKey("Last 30 days"),
    },
    rows: [
      {
        name: "1",
        detail: translationKey("Check the error rate"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Completed"),
      },
      {
        name: "2",
        detail: translationKey("Restart the service"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Completed"),
      },
      {
        name: "3",
        detail: translationKey("Confirm checkout works"),
        status: ShowcaseStatus.Warning,
        statusText: translationKey("Running"),
      },
    ],
  },
};

export const FORMS_SHOWCASE: ResourceShowcase = {
  icon: IconProp.ClipboardDocumentList,
  eyebrow: translationKey("Forms"),
  title: translationKey("Let anyone report a problem or ask for a change"),
  description: translationKey(
    "A form is a page anyone with its link can fill in, without an account. Each answer creates an incident or a maintenance event.",
  ),
  highlights: [],
  steps: [
    translationKey("Create a form"),
    translationKey("Add the questions to ask"),
    translationKey(
      "Share its link: each answer becomes an incident or an event",
    ),
  ],
  features: [],
  preview: {
    name: "report-a-problem",
    subtitle: translationKey("Form"),
    badge: translationKey("Published"),
    description: PRODUCT_EXAMPLE_DESCRIPTION,
    stats: [
      { label: translationKey("Questions"), value: 5 },
      { label: translationKey("Submissions"), value: 48 },
      { label: translationKey("Incidents"), value: 31 },
      { label: translationKey("This week"), value: 6 },
    ],
    chart: {
      label: translationKey("Submissions"),
      values: [3, 4, 2, 5, 3, 6, 4, 5, 3, 6, 5, 6],
      range: translationKey("Last 30 days"),
    },
    rows: [
      {
        name: "#48",
        detail: translationKey("Incident"),
        status: ShowcaseStatus.Warning,
        statusText: translationKey("Created"),
      },
      {
        name: "#47",
        detail: translationKey("Scheduled Maintenance"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Scheduled"),
      },
      {
        name: "#46",
        detail: translationKey("Incident"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Resolved"),
      },
    ],
  },
};
