import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceShowcase,
  ShowcaseStatus,
} from "../../ResourceShowcase/ResourceShowcase";
import { PRODUCT_EXAMPLE_DESCRIPTION } from "../ProductOnboarding";

/*
 * How the observability products explain themselves (ProductOnboarding):
 * Logs, Metrics, Traces, Profiles, Exceptions, AI / LLM, Data
 * Observability, Topology and Services. The example's names and values are
 * drawn as written; its words are translation keys.
 */

const LIVE: string = translationKey("Live");

export const LOGS_SHOWCASE: ResourceShowcase = {
  icon: IconProp.Logs,
  eyebrow: translationKey("Logs"),
  title: translationKey("Search every log line in one place"),
  description: translationKey(
    "Send logs with OpenTelemetry, Fluent Bit or syslog. Search them as they arrive, and get alerted on the lines that matter.",
  ),
  highlights: [],
  steps: [
    translationKey("Send your first logs"),
    translationKey("Search and filter them as they arrive"),
    translationKey("Create a monitor to be alerted on a pattern"),
  ],
  features: [],
  preview: {
    name: "checkout-api",
    subtitle: translationKey("Service"),
    badge: LIVE,
    description: PRODUCT_EXAMPLE_DESCRIPTION,
    stats: [
      { label: translationKey("Logs"), value: { abbreviated: 1_200_000 } },
      { label: translationKey("Errors"), value: 214 },
      { label: translationKey("Warnings"), value: 1031 },
      { label: translationKey("Services"), value: 6 },
    ],
    chart: {
      label: translationKey("Errors"),
      values: [4, 3, 5, 4, 6, 28, 34, 12, 5, 4, 3, 4],
    },
    rows: [
      {
        name: "payments",
        detail: translationKey("Payment provider timed out"),
        status: ShowcaseStatus.Critical,
        statusText: translationKey("Error"),
      },
      {
        name: "checkout-api",
        detail: translationKey("Retrying the request"),
        status: ShowcaseStatus.Warning,
        statusText: translationKey("Warning"),
      },
      {
        name: "web",
        detail: translationKey("Order placed"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Info"),
      },
    ],
  },
};

export const METRICS_SHOWCASE: ResourceShowcase = {
  icon: IconProp.Heartbeat,
  eyebrow: translationKey("Metrics"),
  title: translationKey("Chart any number your systems report"),
  description: translationKey(
    "Send metrics with OpenTelemetry. Chart them, put them on dashboards, and get alerted when a value crosses a line.",
  ),
  highlights: [],
  steps: [
    translationKey("Send your first metrics"),
    translationKey("Chart them and add them to a dashboard"),
    translationKey("Create a monitor to be alerted on a threshold"),
  ],
  features: [],
  preview: {
    name: "checkout-api",
    subtitle: translationKey("Service"),
    badge: LIVE,
    description: PRODUCT_EXAMPLE_DESCRIPTION,
    stats: [
      { label: translationKey("Requests"), value: 1920 },
      { label: translationKey("Latency"), value: { milliseconds: 184 } },
      { label: translationKey("Error rate"), value: { percent: 0.4 } },
      { label: translationKey("CPU"), value: { percent: 38 } },
    ],
    chart: {
      label: translationKey("Latency"),
      values: [180, 176, 190, 184, 178, 210, 260, 230, 196, 188, 181, 184],
    },
    rows: [
      {
        name: "http.server.request.duration",
        detail: translationKey("Histogram"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Healthy"),
      },
      {
        name: "process.cpu.utilization",
        detail: translationKey("Gauge"),
        status: ShowcaseStatus.Warning,
        statusText: translationKey("Warning"),
      },
      {
        name: "db.client.connections.usage",
        detail: translationKey("Gauge"),
        status: ShowcaseStatus.Critical,
        statusText: translationKey("Critical"),
      },
    ],
    alert: {
      title: translationKey("Alert created"),
      description: translationKey(
        "Database connections stayed above 90% for 5 minutes.",
      ),
    },
  },
};

export const TRACES_SHOWCASE: ResourceShowcase = {
  icon: IconProp.Waterfall,
  eyebrow: translationKey("Traces"),
  title: translationKey("Follow one request through every service"),
  description: translationKey(
    "Send traces with OpenTelemetry and see each request as it moves through your services: where the time goes, and where it fails.",
  ),
  highlights: [],
  steps: [
    translationKey("Send your first traces"),
    translationKey("Find a slow or failing request"),
    translationKey("Open its trace to see which service is to blame"),
  ],
  features: [],
  preview: {
    name: "POST /api/checkout",
    subtitle: translationKey("Trace"),
    badge: LIVE,
    description: PRODUCT_EXAMPLE_DESCRIPTION,
    stats: [
      { label: translationKey("Duration"), value: { seconds: 1.24 } },
      { label: translationKey("Spans"), value: 38 },
      { label: translationKey("Services"), value: 5 },
      { label: translationKey("Errors"), value: 1 },
    ],
    chart: {
      label: translationKey("Latency"),
      values: [210, 190, 220, 205, 198, 480, 1240, 640, 230, 210, 205, 200],
    },
    rows: [
      {
        name: "checkout-api",
        detail: translationKey("Server"),
        status: ShowcaseStatus.Healthy,
        statusText: { milliseconds: 120 },
      },
      {
        name: "SELECT orders",
        detail: translationKey("Client"),
        status: ShowcaseStatus.Warning,
        statusText: { milliseconds: 840 },
      },
      {
        name: "payments",
        detail: translationKey("Server"),
        status: ShowcaseStatus.Critical,
        statusText: translationKey("Error"),
      },
    ],
  },
};

export const PROFILES_SHOWCASE: ResourceShowcase = {
  icon: IconProp.Fire,
  eyebrow: translationKey("Profiles"),
  title: translationKey("See which code uses your CPU and memory"),
  description: translationKey(
    "Send continuous profiles and see, as a flame graph, which functions use the most CPU and memory in production.",
  ),
  highlights: [],
  steps: [
    translationKey("Send your first profiles"),
    translationKey("Open a service's flame graph"),
    translationKey("Find the functions that cost the most"),
  ],
  features: [],
  preview: {
    name: "checkout-api",
    subtitle: translationKey("CPU profile"),
    badge: LIVE,
    description: PRODUCT_EXAMPLE_DESCRIPTION,
    stats: [
      { label: translationKey("CPU"), value: { percent: 38 } },
      { label: translationKey("Memory"), value: { megabytes: 412 } },
      { label: translationKey("Functions"), value: 1240 },
      { label: translationKey("Samples"), value: 48_210 },
    ],
    chart: {
      label: translationKey("CPU"),
      values: [30, 32, 31, 35, 38, 44, 52, 41, 37, 36, 38, 38],
    },
    rows: [
      {
        name: "encoding/json.Marshal",
        detail: translationKey("CPU"),
        status: ShowcaseStatus.Critical,
        statusText: { percent: 31 },
      },
      {
        name: "net/http.(*conn).serve",
        detail: translationKey("CPU"),
        status: ShowcaseStatus.Warning,
        statusText: { percent: 18 },
      },
      {
        name: "runtime.mallocgc",
        detail: translationKey("Memory"),
        status: ShowcaseStatus.Healthy,
        statusText: { percent: 9 },
      },
    ],
  },
};

export const EXCEPTIONS_SHOWCASE: ResourceShowcase = {
  icon: IconProp.Bug,
  eyebrow: translationKey("Exceptions"),
  title: translationKey("Every exception, grouped and counted"),
  description: translationKey(
    "Exceptions your services report through OpenTelemetry are grouped by where they happened, counted, and linked to the requests that raised them.",
  ),
  highlights: [],
  steps: [
    translationKey("Send your first exceptions"),
    translationKey("Each one is grouped and counted as it arrives"),
    translationKey("Assign, resolve or archive it"),
  ],
  features: [],
  preview: {
    name: "TimeoutError",
    subtitle: translationKey("Unresolved"),
    badge: LIVE,
    description: PRODUCT_EXAMPLE_DESCRIPTION,
    stats: [
      { label: translationKey("Occurrences"), value: 214 },
      { label: translationKey("Services"), value: 2 },
      { label: translationKey("Unresolved"), value: 7 },
      { label: translationKey("Resolved"), value: 31 },
    ],
    chart: {
      label: translationKey("Occurrences"),
      values: [2, 3, 2, 4, 3, 18, 26, 9, 4, 3, 2, 3],
    },
    rows: [
      {
        name: "TimeoutError",
        detail: translationKey("Unresolved"),
        status: ShowcaseStatus.Critical,
        statusText: 214,
      },
      {
        name: "KeyError",
        detail: translationKey("Unresolved"),
        status: ShowcaseStatus.Warning,
        statusText: 18,
      },
      {
        name: "NullPointerException",
        detail: translationKey("Resolved"),
        status: ShowcaseStatus.Healthy,
        statusText: 0,
      },
    ],
  },
};

export const LLM_SHOWCASE: ResourceShowcase = {
  icon: IconProp.Sparkles,
  eyebrow: translationKey("AI / LLM"),
  title: translationKey("See what your AI features say, and what they cost"),
  description: translationKey(
    "Send your LLM calls as OpenTelemetry traces. See every conversation with its tokens, cost and latency, and the calls that failed.",
  ),
  highlights: [],
  steps: [
    translationKey("Send your LLM calls as OpenTelemetry traces"),
    translationKey("See each conversation with its tokens and cost"),
    translationKey("Create a monitor to be alerted on errors or spend"),
  ],
  features: [],
  preview: {
    name: "support-assistant",
    subtitle: translationKey("Service"),
    badge: LIVE,
    description: PRODUCT_EXAMPLE_DESCRIPTION,
    stats: [
      { label: translationKey("Conversations"), value: 1204 },
      { label: translationKey("Tokens"), value: { abbreviated: 3_100_000 } },
      { label: translationKey("Cost"), value: { usDollars: 42.18 } },
      { label: translationKey("Error rate"), value: { percent: 0.6 } },
    ],
    chart: {
      label: translationKey("Cost"),
      values: [4, 5, 6, 5, 7, 6, 8, 7, 6, 9, 8, 7],
      range: translationKey("Last 7 days"),
    },
    rows: [
      {
        name: "chat-large",
        detail: translationKey("Model"),
        status: ShowcaseStatus.Healthy,
        statusText: { seconds: 1.1 },
      },
      {
        name: "chat-small",
        detail: translationKey("Model"),
        status: ShowcaseStatus.Healthy,
        statusText: { seconds: 1.4 },
      },
      {
        name: "embed-small",
        detail: translationKey("Model"),
        status: ShowcaseStatus.Warning,
        statusText: translationKey("Error"),
      },
    ],
  },
};

/*
 * Data Observability's first steps are the ones that make it useful, in
 * order: the page's own button (Connect a Database), then the database's
 * recommended alerts - monitors a person turns on, as nobody is told of a
 * table until they are - then who owns which tables, and the checks on
 * what they hold. A connected table is watched by itself; it alerts nobody
 * by itself, so the example says Late, as the product does, not Stale.
 */
export const DATA_OBSERVABILITY_SHOWCASE: ResourceShowcase = {
  icon: IconProp.TableCells,
  eyebrow: translationKey("Data Observability"),
  title: translationKey("Know when your data is late, wrong or changed"),
  description: translationKey(
    "Connect a database and every table in it is watched within minutes: its rows, size, columns and when it last changed, against its own usual rhythm. Only the catalog is read, so no value leaves the database. Turn on its recommended alerts, and a table's owners hear when it is late, loses rows or changes its columns.",
  ),
  highlights: [],
  steps: [
    translationKey("Connect a database"),
    translationKey("Turn on its recommended alerts"),
    translationKey("Say who owns which tables"),
    translationKey("Add checks on the values that matter"),
  ],
  features: [
    {
      icon: IconProp.Database,
      title: translationKey("Most databases and warehouses"),
      description: translationKey(
        "PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, MongoDB and the major warehouses, connected by OneUptime or by a probe inside your network.",
      ),
    },
    {
      icon: IconProp.CheckCircle,
      title: translationKey("Checks, dbt tests and pipelines"),
      description: translationKey(
        "Test what tables hold, bring your dbt tests, and send pipeline runs from Airflow, dbt or Spark to see which failed run made a table late.",
      ),
    },
    {
      icon: IconProp.ChartBar,
      title: translationKey("Charts and alerts"),
      description: translationKey(
        "Every number is a metric: chart it, put it on a dashboard, or alert on it with a learned baseline.",
      ),
    },
  ],
  preview: {
    name: "orders-db",
    subtitle: translationKey("PostgreSQL"),
    badge: translationKey("Connected"),
    description: PRODUCT_EXAMPLE_DESCRIPTION,
    stats: [
      { label: translationKey("Tables"), value: 184 },
      { label: translationKey("Rows"), value: { abbreviated: 92_000_000 } },
      { label: translationKey("Size"), value: { gigabytes: 48 } },
      // public.payments, late: a column added (public.customers) needs nobody.
      { label: translationKey("Needs Attention"), value: 1 },
    ],
    chart: {
      label: translationKey("Rows"),
      values: [80, 81, 82, 83, 85, 86, 87, 88, 89, 90, 91, 92],
      range: translationKey("Last 7 days"),
    },
    rows: [
      {
        name: "public.orders",
        detail: translationKey("Freshness"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Healthy"),
      },
      {
        name: "public.payments",
        detail: translationKey("Freshness"),
        status: ShowcaseStatus.Critical,
        statusText: translationKey("Late"),
      },
      {
        name: "public.customers",
        detail: translationKey("Schema"),
        status: ShowcaseStatus.Warning,
        statusText: translationKey("Changed"),
      },
    ],
  },
};

export const TOPOLOGY_SHOWCASE: ResourceShowcase = {
  icon: IconProp.FlowDiagram,
  eyebrow: translationKey("Topology"),
  title: translationKey("See how your services connect"),
  description: translationKey(
    "Topology draws your services and the calls between them from their traces, so you can see where a problem starts and what it reaches.",
  ),
  highlights: [],
  steps: [
    translationKey("Send your first traces"),
    translationKey(
      "Services and the calls between them are drawn on their own",
    ),
    translationKey("Click a service to see its health and its neighbors"),
  ],
  features: [],
  preview: {
    name: "checkout-api",
    subtitle: translationKey("Service"),
    badge: LIVE,
    description: PRODUCT_EXAMPLE_DESCRIPTION,
    stats: [
      { label: translationKey("Services"), value: 12 },
      { label: translationKey("Requests"), value: 8410 },
      { label: translationKey("Error rate"), value: { percent: 0.4 } },
      { label: translationKey("Latency"), value: { milliseconds: 184 } },
    ],
    chart: {
      label: translationKey("Requests"),
      values: [120, 132, 128, 140, 152, 148, 160, 158, 150, 162, 170, 166],
    },
    rows: [
      {
        name: "web → checkout-api",
        detail: translationKey("Requests"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Healthy"),
      },
      {
        name: "checkout-api → postgres",
        detail: translationKey("Database"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Healthy"),
      },
      {
        name: "checkout-api → payments",
        detail: translationKey("Requests"),
        status: ShowcaseStatus.Critical,
        statusText: translationKey("Error"),
      },
    ],
  },
};

export const SERVICES_SHOWCASE: ResourceShowcase = {
  icon: IconProp.SquareStack,
  eyebrow: translationKey("Services"),
  title: translationKey("Everything about a service on one page"),
  description: translationKey(
    "The applications and microservices you run. Each service brings together its logs, traces, metrics, exceptions, incidents and owners in one place.",
  ),
  highlights: [],
  steps: [
    translationKey(
      "Add a service, or send telemetry and it shows up on its own",
    ),
    translationKey("See its logs, traces, metrics and exceptions together"),
    translationKey("Add its owners, so the right team is told"),
  ],
  features: [],
  preview: {
    name: "checkout-api",
    subtitle: translationKey("Service"),
    badge: LIVE,
    description: PRODUCT_EXAMPLE_DESCRIPTION,
    stats: [
      { label: translationKey("Requests"), value: 1920 },
      { label: translationKey("Error rate"), value: { percent: 0.4 } },
      { label: translationKey("Latency"), value: { milliseconds: 184 } },
      { label: translationKey("Exceptions"), value: 3 },
    ],
    chart: {
      label: translationKey("Requests"),
      values: [120, 132, 128, 140, 152, 148, 160, 158, 150, 162, 170, 166],
    },
    rows: [
      {
        name: "payments",
        detail: translationKey("Service"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Healthy"),
      },
      {
        name: "inventory",
        detail: translationKey("Service"),
        status: ShowcaseStatus.Warning,
        statusText: translationKey("Degraded"),
      },
      {
        name: "notifications",
        detail: translationKey("Service"),
        status: ShowcaseStatus.Critical,
        statusText: translationKey("Offline"),
      },
    ],
  },
};
