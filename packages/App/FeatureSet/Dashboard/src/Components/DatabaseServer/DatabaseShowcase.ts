import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceShowcase,
  ShowcaseStatus,
} from "../ResourceShowcase/ResourceShowcase";

// What Databases > All Databases shows while the project has no database.
const DATABASE_SHOWCASE: ResourceShowcase = {
  icon: IconProp.Database,
  eyebrow: translationKey("Database monitoring"),
  title: translationKey("See every database your apps depend on"),
  description: translationKey(
    "OneUptime finds databases in your traces and containers, or add one by hand. See the latency and errors of the queries your apps send, and the engine's own health from the Database Agent.",
  ),
  highlights: [
    translationKey("Found in your traces"),
    translationKey("Read-only login"),
    translationKey("Nothing installed on the server"),
  ],
  features: [
    {
      icon: IconProp.MagnifyingGlass,
      title: translationKey("Found, not configured"),
      description: translationKey(
        "Databases show up from your apps' traces and from your Kubernetes, Docker and Podman workloads.",
      ),
    },
    {
      icon: IconProp.ChartBar,
      title: translationKey("Query latency and errors"),
      description: translationKey(
        "Queries, error rate and p95 latency, as the apps that call each database see them.",
      ),
    },
    {
      icon: IconProp.ServerStack,
      title: translationKey("Who is calling it"),
      description: translationKey(
        "Every service that queries a database, busiest first, with its own latency and errors.",
      ),
    },
    {
      icon: IconProp.Gauge,
      title: translationKey("Engine health"),
      description: translationKey(
        "Connections, replication lag, commits and size from the Database Agent, chosen for each engine.",
      ),
    },
    {
      icon: IconProp.BellRinging,
      title: translationKey("Monitors for each engine"),
      description: translationKey(
        "Recommended monitors, like connections nearly exhausted or replica lag, ready to turn on.",
      ),
    },
    {
      icon: IconProp.Sparkles,
      title: translationKey("AI diagnostics"),
      description: translationKey(
        "Read-only checks of sessions, locks and long-running queries on PostgreSQL, MySQL, Redis and MongoDB.",
      ),
    },
  ],
  preview: {
    name: "orders-pg",
    subtitle: translationKey("PostgreSQL 16.4 · Kubernetes · prod-us-east"),
    stats: [
      { label: translationKey("Queries"), value: "482k" },
      { label: translationKey("Error rate"), value: "0.3%" },
      { label: translationKey("p95 latency"), value: "14 ms" },
      { label: translationKey("Calling services"), value: "4" },
    ],
    chart: {
      label: translationKey("Queries from applications"),
      values: [
        22, 24, 23, 27, 31, 30, 34, 38, 36, 41, 44, 42, 47, 45, 49, 52, 50, 55,
        53, 57, 56, 60,
      ],
    },
    rows: [
      {
        name: "replication_lag",
        detail: translationKey("0.4 s behind the primary"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Healthy"),
      },
      {
        name: "connections",
        detail: translationKey("191 of 200 in use"),
        status: ShowcaseStatus.Critical,
        statusText: translationKey("Near limit"),
      },
      {
        name: "commits",
        detail: translationKey("1.9k per second"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Normal"),
      },
      {
        name: "database_size",
        detail: translationKey("412 GB"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("Normal"),
      },
    ],
    alert: {
      title: translationKey("Connections nearly exhausted"),
      description: translationKey(
        "orders-pg is using 95% of max_connections. An alert was opened.",
      ),
    },
  },
};

export default DATABASE_SHOWCASE;
